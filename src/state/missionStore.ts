/**
 * The mission store: one source of truth for configuration, the live
 * simulation, playback, saved records and replay.
 *
 * THREE THINGS IN HERE ARE LOAD-BEARING AND EASY TO GET WRONG.
 *
 * 1. THE TICKER LIVES OUTSIDE REACT AND OUTSIDE THE STORE STATE.
 *    The interval handle is a module variable, not a store field, so that
 *    starting and stopping playback never publishes a state change and never
 *    re-renders anything. A generation counter invalidates callbacks that were
 *    already queued when the ticker was stopped — clearInterval alone does not
 *    cancel a callback the event loop has already picked up, and a stale one
 *    stepping a finished mission is the obvious failure mode here.
 *
 * 2. THE ENGINE IS PURE, SO THE STORE ONLY EVER SWAPS STATE.
 *    `step()` returns a new SimState and the fields it did not touch keep
 *    their identity. That is what lets `useDecisions()` subscribe to
 *    `state.decisions` by reference and re-render only when a decision is
 *    actually added, rather than twice a second for the whole mission.
 *
 * 3. RENDERING IS NOT DRIVEN BY REACT.
 *    The canvas reads the live state through the renderer's own rAF loop. The
 *    only React components that subscribe to the whole SimState are leaves
 *    that render a single element; everything else selects the narrowest
 *    slice it needs. See `selectors.ts`.
 */

import { create } from 'zustand'

import {
  abortMission as engineAbort,
  computeMetrics,
  createSimulation,
  resolveIntervention as engineResolve,
  step,
  toRecord,
} from '@/core/engine'
import { getScenario, SCENARIOS } from '@/core/scenarios'
import type {
  Cell,
  MissionConfig,
  MissionMetrics,
  MissionRecord,
  SimState,
} from '@/core/types'
import type { RenderOptions } from '@/render'

import { downloadJson, slugify } from '@/lib/download'
import { newMissionId, nowIso } from '@/lib/ids'
import { computePreview, type RoutePreview } from '@/lib/preview'
import { buildReplaySession, seekReplay as seekSession, type ReplaySession } from '@/lib/replay'
import { isPersistenceAvailable, readJson, STORAGE_KEYS, writeJson } from '@/lib/persist'

import {
  BASE_TICK_HZ,
  INITIAL_RENDER_OPTIONS,
  defaultConfigFor,
  firstScenario,
  type Speed,
} from './defaults'

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished'

export interface ReplayView {
  session: ReplaySession
  /** Tick the scrubber is parked on. */
  tick: number
  /** State at that tick; what the analysis map renders. */
  state: SimState
  /**
   * Whether the replay has taken over the MISSION view's map.
   *
   * Selecting a record in Analysis has to reconstruct it -- the chart and the
   * scrubber both need the frames -- but silently replacing whatever the
   * operator is watching on the Mission tab would be hostile. So building the
   * session and driving the live map are two separate things.
   */
  active: boolean
}

export interface MissionStore {
  // --- configuration (the planner's draft) --------------------------------
  config: MissionConfig

  // --- live simulation ----------------------------------------------------
  state: SimState | null
  status: RunStatus
  speed: Speed
  /** Set when a mission finishes; null while one is running. */
  metrics: MissionMetrics | null

  // --- route preview ------------------------------------------------------
  preview: RoutePreview | null
  previewPending: boolean
  /** Set when the planner itself threw, which is a bug worth surfacing. */
  previewError: string | null

  // --- presentation -------------------------------------------------------
  renderOptions: RenderOptions
  selectedDecisionId: string | null

  // --- saved missions and replay -----------------------------------------
  missions: MissionRecord[]
  persistenceAvailable: boolean
  selectedMissionId: string | null
  replay: ReplayView | null

  // --- configuration actions ---------------------------------------------
  setScenario: (scenarioId: string) => void
  setStart: (cell: Cell) => void
  toggleWaypoint: (cell: Cell) => void
  clearWaypoints: () => void
  setRisk: (value: number) => void
  setEnergyPriority: (value: number) => void
  setBatteryReserve: (value: number) => void
  setMaxSlope: (deg: number) => void
  setAutonomyLevel: (level: MissionConfig['autonomyLevel']) => void
  setSeed: (seed: number) => void
  previewRoute: () => void

  // --- mission actions ----------------------------------------------------
  launch: () => void
  play: () => void
  pause: () => void
  stepOnce: () => void
  reset: () => void
  setSpeed: (speed: Speed) => void
  resolveIntervention: (optionId: string) => void
  abort: () => void

  // --- records ------------------------------------------------------------
  saveMission: () => MissionRecord | null
  loadRecord: (missionId: string) => void
  startReplay: (missionId: string) => void
  seekReplay: (tick: number) => void
  stopReplay: () => void
  exportRecord: (missionId: string) => void

  // --- presentation actions ----------------------------------------------
  setRenderOption: <K extends keyof RenderOptions>(key: K, value: RenderOptions[K]) => void
  selectDecision: (decisionId: string | null) => void
}

// ---------------------------------------------------------------------------
// Ticker — deliberately module scope, see note 1 at the top of the file
// ---------------------------------------------------------------------------

let tickerHandle: ReturnType<typeof setInterval> | null = null
/**
 * Incremented on every start and stop. A queued callback compares the
 * generation it captured against this and returns if it has been superseded.
 */
let tickerGeneration = 0

function stopTicker(): void {
  if (tickerHandle !== null) {
    clearInterval(tickerHandle)
    tickerHandle = null
  }
  tickerGeneration++
}

let previewTimer: ReturnType<typeof setTimeout> | null = null

function cancelPreview(): void {
  if (previewTimer !== null) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
}

/**
 * Tear everything down. Called from the app shell's unmount effect so that a
 * hot reload or a route change cannot leave an interval stepping a mission
 * nobody is watching.
 */
export function disposeMissionStore(): void {
  stopTicker()
  cancelPreview()
}

/**
 * Plan the opening preview.
 *
 * WHY THIS IS AN EXPLICIT CALL AND NOT DONE AT STORE CREATION: the store
 * starts with a scenario and its suggested waypoints already configured, so
 * there IS something to preview before the user touches anything -- and
 * every other preview is triggered by a config setter, which means without
 * this the planner sits on "Planning" forever until a slider is moved. It is
 * a call rather than a module side effect so that importing the store does
 * not generate terrain in a test or on a server.
 *
 * Idempotent: running it twice only re-plans, and React's StrictMode will.
 */
export function initMissionStore(): void {
  useMissionStore.getState().previewRoute()
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const PREVIEW_DEBOUNCE_MS = 120

function loadSavedMissions(): MissionRecord[] {
  const rows = readJson<MissionRecord[]>(STORAGE_KEYS.missions, [])
  // Defensive: a hand-edited or partially-written entry must not crash the
  // analysis view on load. Anything without the fields the views read is
  // dropped rather than patched.
  return Array.isArray(rows)
    ? rows.filter((r) => r && typeof r.missionId === 'string' && !!r.config && !!r.metrics)
    : []
}

function loadRenderOptions(): RenderOptions {
  const saved = readJson<Partial<RenderOptions> | null>(STORAGE_KEYS.renderOptions, null)
  if (!saved || typeof saved !== 'object') return INITIAL_RENDER_OPTIONS
  // Merge rather than replace: a stored object from an older build is missing
  // whichever layer was added since, and `undefined` would read as "off".
  return {
    ...INITIAL_RENDER_OPTIONS,
    ...saved,
    hoverCell: null,
    selectedCell: null,
  }
}

export const useMissionStore = create<MissionStore>()((set, get) => {
  // ---- internal helpers, closed over set/get ------------------------------

  /** Re-plan the preview now. Safe to call at any time; never throws out. */
  function runPreview(): void {
    cancelPreview()
    const { config } = get()
    try {
      const preview = computePreview(config)
      set({ preview, previewPending: false, previewError: null })
    } catch (err) {
      set({
        preview: null,
        previewPending: false,
        previewError: err instanceof Error ? err.message : 'Route preview failed.',
      })
    }
  }

  /**
   * Every configuration setter calls this rather than each view remembering
   * to debounce. Putting the debounce here is what makes "the preview always
   * reflects the config" true by construction.
   */
  function schedulePreview(): void {
    cancelPreview()
    set({ previewPending: true })
    previewTimer = setTimeout(() => {
      previewTimer = null
      runPreview()
    }, PREVIEW_DEBOUNCE_MS)
  }

  /** Mutate the draft config and refresh the preview. */
  function patchConfig(patch: Partial<MissionConfig>): void {
    set((s) => ({ config: { ...s.config, ...patch } }))
    schedulePreview()
  }

  /** A mission has ended: stop the clock, compute metrics, keep the record. */
  function finalize(finished: SimState): void {
    stopTicker()
    const metrics = computeMetrics(finished)
    set({ state: finished, status: 'finished', metrics })
    persistRecord(finished)
  }

  function persistRecord(finished: SimState): MissionRecord | null {
    if (finished.outcome === null) return null
    const record = toRecord(finished, newMissionId(), nowIso())
    const missions = [record, ...get().missions]
    const ok = writeJson(STORAGE_KEYS.missions, missions)
    // The record is kept in memory whether or not the write landed, so the
    // analysis view works in a private window; only persistence across a
    // reload is lost, and `persistenceAvailable` says so.
    set({ missions, selectedMissionId: record.missionId, persistenceAvailable: ok })
    return record
  }

  /**
   * One simulation tick, plus the two conditions that must stop the clock.
   * Both are checked on the NEW state, because a step is what produces them.
   */
  function tickOnce(): void {
    const { state, status } = get()
    if (!state || state.outcome !== null) {
      stopTicker()
      return
    }
    // An intervention raised on a previous tick leaves `step()` a no-op by
    // D5, so there is nothing to be gained by calling it.
    if (state.pendingIntervention) {
      stopTicker()
      if (status === 'running') set({ status: 'paused' })
      return
    }

    const next = step(state)

    if (next.outcome !== null) {
      finalize(next)
      return
    }
    if (next.pendingIntervention) {
      stopTicker()
      set({ state: next, status: 'paused' })
      return
    }
    set({ state: next })
  }

  function startTicker(): void {
    stopTicker()
    const generation = ++tickerGeneration
    const hz = BASE_TICK_HZ * get().speed
    tickerHandle = setInterval(() => {
      // A callback already dispatched when the ticker was stopped still runs;
      // this is the guard that makes it harmless.
      if (generation !== tickerGeneration) return
      tickOnce()
    }, 1000 / hz)
  }

  // ---- initial state ------------------------------------------------------

  const scenario = firstScenario()
  const initialConfig = defaultConfigFor(scenario)

  return {
    config: initialConfig,

    state: null,
    status: 'idle',
    speed: 1,
    metrics: null,

    preview: null,
    previewPending: true,
    previewError: null,

    renderOptions: loadRenderOptions(),
    selectedDecisionId: null,

    missions: loadSavedMissions(),
    persistenceAvailable: isPersistenceAvailable(),
    selectedMissionId: null,
    replay: null,

    // ---- configuration ----------------------------------------------------

    setScenario(scenarioId) {
      let next
      try {
        next = getScenario(scenarioId)
      } catch {
        return
      }
      // Changing scenario replaces start and waypoints wholesale: cells from
      // the previous map have no meaning on this one and could be out of
      // bounds entirely.
      set({ config: defaultConfigFor(next) })
      schedulePreview()
    },

    setStart(cell) {
      patchConfig({ start: { ...cell } })
    },

    toggleWaypoint(cell) {
      const { waypoints } = get().config
      const at = waypoints.findIndex((w) => w.x === cell.x && w.y === cell.y)
      // Clicking an existing waypoint removes it; clicking empty ground appends.
      // Appending rather than inserting keeps the numbering the user sees
      // identical to the order the rover will drive.
      const nextWaypoints =
        at >= 0 ? waypoints.filter((_, i) => i !== at) : [...waypoints, { ...cell }]
      patchConfig({ waypoints: nextWaypoints })
    },

    clearWaypoints() {
      patchConfig({ waypoints: [] })
    },

    setRisk(value) {
      patchConfig({ riskTolerance: clamp01(value) })
    },
    setEnergyPriority(value) {
      patchConfig({ energyPriority: clamp01(value) })
    },
    setBatteryReserve(value) {
      patchConfig({ batteryReserveFrac: clamp01(value) })
    },
    setMaxSlope(deg) {
      patchConfig({ maxSlopeDeg: Math.max(1, Math.min(90, deg)) })
    },
    setAutonomyLevel(level) {
      // Autonomy does not change the route, only whether the engine stops to
      // ask, so this one does not need a fresh preview — but going through
      // patchConfig keeps "every setter refreshes" true and costs one search.
      patchConfig({ autonomyLevel: level })
    },
    setSeed(seed) {
      patchConfig({ seed: Math.floor(seed) })
    },

    previewRoute() {
      runPreview()
    },

    // ---- mission ----------------------------------------------------------

    launch() {
      const { config } = get()
      if (config.waypoints.length === 0) return
      stopTicker()
      const state = createSimulation(config)

      // A SUPERVISED MISSION IS ALREADY WAITING BEFORE THE FIRST TICK.
      // `createSimulation` plans the opening route and, under supervised
      // autonomy, raises an approval request for it -- so the state comes
      // back at tick 0 with `pendingIntervention` set and the rover in
      // `awaiting-approval`. Starting the clock anyway would show "running"
      // for half a second before the first tick discovered the request and
      // paused, which is exactly the "mission silently stopped" confusion
      // the intervention panel exists to prevent.
      if (state.outcome !== null) {
        set({ state, metrics: null, selectedDecisionId: null, replay: null })
        finalize(state)
        return
      }

      const waiting = state.pendingIntervention !== null
      set({
        state,
        status: waiting ? 'paused' : 'running',
        metrics: null,
        selectedDecisionId: null,
        // A new live mission takes the map back from any replay that was
        // being scrubbed, otherwise the canvas would show two missions.
        replay: null,
      })
      if (!waiting) startTicker()
    },

    play() {
      const { state, status } = get()
      if (!state || status === 'running') return
      if (state.outcome !== null) return
      // Playing into an outstanding intervention would spin the ticker against
      // a no-op `step()`; the operator has to answer first.
      if (state.pendingIntervention) return
      set({ status: 'running' })
      startTicker()
    },

    pause() {
      stopTicker()
      if (get().status === 'running') set({ status: 'paused' })
    },

    stepOnce() {
      const { state, status } = get()
      if (!state || state.outcome !== null || state.pendingIntervention) return
      if (status === 'running') stopTicker()
      tickOnce()
      if (get().status === 'running') set({ status: 'paused' })
    },

    reset() {
      stopTicker()
      set({ state: null, status: 'idle', metrics: null, selectedDecisionId: null })
    },

    setSpeed(speed) {
      set({ speed })
      // Restart rather than adjust: setInterval has no rate setter, and
      // leaving the old interval running is exactly the leak this file warns
      // about at the top.
      if (get().status === 'running') startTicker()
    },

    resolveIntervention(optionId) {
      const { state } = get()
      if (!state || !state.pendingIntervention) return
      const next = engineResolve(state, optionId)
      if (next.outcome !== null) {
        finalize(next)
        return
      }
      // Resolving can immediately raise the next request — a route accepted
      // into terrain that is still unsafe, for instance. Stay paused if so.
      if (next.pendingIntervention) {
        set({ state: next, status: 'paused' })
        return
      }
      set({ state: next, status: 'running' })
      startTicker()
    },

    abort() {
      const { state } = get()
      if (!state || state.outcome !== null) return
      finalize(engineAbort(state))
    },

    // ---- records ----------------------------------------------------------

    saveMission() {
      const { state } = get()
      if (!state || state.outcome === null) return null
      return persistRecord(state)
    },

    loadRecord(missionId) {
      const { missions, replay } = get()
      const record = missions.find((m) => m.missionId === missionId)
      if (!record) return
      // Already reconstructed: re-selecting the same mission must not pay for
      // a second re-simulation.
      if (replay && replay.session.record.missionId === missionId) {
        set({ selectedMissionId: missionId, selectedDecisionId: null })
        return
      }
      let session: ReplaySession
      try {
        session = buildReplaySession(record)
      } catch {
        // A record the engine cannot replay is still worth listing; the view
        // shows its stored metrics and says the reconstruction failed.
        set({ selectedMissionId: missionId, replay: null, selectedDecisionId: null })
        return
      }
      set({
        selectedMissionId: missionId,
        selectedDecisionId: null,
        // Parked at the end, because the first question asked of a finished
        // mission is what happened to it.
        replay: { session, tick: session.totalTicks, state: session.finalState, active: false },
      })
    },

    startReplay(missionId) {
      const { replay } = get()
      if (!replay || replay.session.record.missionId !== missionId) {
        get().loadRecord(missionId)
      }
      const next = get().replay
      if (!next) return
      // The replay drives the same renderer as a live mission, so a live
      // mission must not be ticking underneath it.
      stopTicker()
      set({
        replay: { ...next, active: true },
        status: get().status === 'running' ? 'paused' : get().status,
      })
    },

    seekReplay(tick) {
      const { replay } = get()
      if (!replay) return
      const clamped = Math.max(0, Math.min(Math.round(tick), replay.session.totalTicks))
      if (clamped === replay.tick) return
      const state = seekSession(replay.session, clamped)
      set({ replay: { ...replay, tick: clamped, state } })
    },

    stopReplay() {
      const { replay } = get()
      if (!replay) return
      // Keep the session: the chart and the scrubber still need it, and
      // rebuilding it on the next click would re-simulate the whole mission.
      set({ replay: { ...replay, active: false } })
    },

    exportRecord(missionId) {
      const record = get().missions.find((m) => m.missionId === missionId)
      if (!record) return
      const name = slugify(`${record.config.scenarioId}-${record.missionId}`)
      downloadJson(`selene-mission-${name}.json`, record)
    },

    // ---- presentation -----------------------------------------------------

    setRenderOption(key, value) {
      const renderOptions = { ...get().renderOptions, [key]: value }
      set({ renderOptions })
      // Persist only the layer preferences. Hover and selection are
      // transient, and they are also the two that change on every mouse
      // move -- writing them would hit localStorage at pointer rate.
      writeJson(STORAGE_KEYS.renderOptions, { ...renderOptions, hoverCell: null, selectedCell: null })
    },

    selectDecision(decisionId) {
      set({ selectedDecisionId: decisionId })
    },
  }
})

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

/** Scenario list is static; re-exported so views need one import, not two. */
export { SCENARIOS }
