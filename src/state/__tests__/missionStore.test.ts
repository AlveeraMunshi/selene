/**
 * The ticker is the riskiest thing in the app workstream, so it gets the
 * tests: a leaked interval does not throw, it just quietly steps a mission
 * nobody is watching, at twice the rate the user asked for.
 *
 * These use fake timers and drive the real engine. The store is a module
 * singleton, so every test resets it first.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { disposeMissionStore, useMissionStore } from '@/state/missionStore'
import { defaultConfigFor, firstScenario } from '@/state/defaults'

/** 2 Hz base rate: one tick every 500 ms at 1x. */
const TICK_MS = 500

/**
 * Launch, and clear the opening approval request.
 *
 * Under supervised autonomy `createSimulation` plans the first route and
 * immediately asks for approval, so a freshly launched mission is paused at
 * tick 0. Every test about the CLOCK wants to be past that.
 */
function launchAndApprove() {
  const store = useMissionStore.getState()
  store.launch()
  const pending = useMissionStore.getState().state?.pendingIntervention
  if (pending) {
    const accept = pending.options.find((o) => o.action.type === 'accept-route') ?? pending.options[0]!
    useMissionStore.getState().resolveIntervention(accept.id)
  }
  return useMissionStore.getState()
}

function resetStore() {
  disposeMissionStore()
  useMissionStore.setState({
    config: defaultConfigFor(firstScenario()),
    state: null,
    status: 'idle',
    speed: 1,
    metrics: null,
    missions: [],
    selectedMissionId: null,
    replay: null,
    selectedDecisionId: null,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  resetStore()
})

afterEach(() => {
  disposeMissionStore()
  vi.useRealTimers()
})

describe('mission ticker', () => {
  it('pauses immediately when the opening plan needs approval', () => {
    useMissionStore.getState().launch()
    const s = useMissionStore.getState()
    // Supervised is the default config, so this is the expected opening.
    expect(s.state!.pendingIntervention).not.toBeNull()
    expect(s.status).toBe('paused')
    // And the clock must not be running behind the request.
    vi.advanceTimersByTime(TICK_MS * 10)
    expect(useMissionStore.getState().state!.tick).toBe(0)
  })

  it('advances the simulation while running', () => {
    launchAndApprove()
    expect(useMissionStore.getState().status).toBe('running')
    const before = useMissionStore.getState().state!.tick

    vi.advanceTimersByTime(TICK_MS * 10)

    expect(useMissionStore.getState().state!.tick).toBe(before + 10)
  })

  it('stops advancing when paused, and resumes on play', () => {
    launchAndApprove()
    vi.advanceTimersByTime(TICK_MS * 4)
    useMissionStore.getState().pause()
    const parked = useMissionStore.getState().state!.tick

    vi.advanceTimersByTime(TICK_MS * 20)
    expect(useMissionStore.getState().state!.tick).toBe(parked)
    expect(useMissionStore.getState().status).toBe('paused')

    useMissionStore.getState().play()
    vi.advanceTimersByTime(TICK_MS * 3)
    expect(useMissionStore.getState().state!.tick).toBe(parked + 3)
  })

  it('changes rate on setSpeed without leaving the old interval running', () => {
    launchAndApprove()
    vi.advanceTimersByTime(TICK_MS * 2)
    const at2 = useMissionStore.getState().state!.tick

    // 4x is one tick per 125 ms. Over one second that is exactly 8 ticks --
    // a leaked 1x interval would add two more.
    useMissionStore.getState().setSpeed(4)
    vi.advanceTimersByTime(1000)

    expect(useMissionStore.getState().state!.tick).toBe(at2 + 8)
  })

  it('steps exactly once from stepOnce and stays paused', () => {
    launchAndApprove()
    useMissionStore.getState().pause()
    const parked = useMissionStore.getState().state!.tick

    useMissionStore.getState().stepOnce()
    expect(useMissionStore.getState().state!.tick).toBe(parked + 1)
    expect(useMissionStore.getState().status).toBe('paused')

    // Nothing queued behind it.
    vi.advanceTimersByTime(TICK_MS * 10)
    expect(useMissionStore.getState().state!.tick).toBe(parked + 1)
  })

  it('stops the clock and holds position when an intervention is raised', () => {
    launchAndApprove()
    // Run until the next request appears rather than guessing the tick.
    for (let i = 0; i < 4000 && !useMissionStore.getState().state?.pendingIntervention; i++) {
      vi.advanceTimersByTime(TICK_MS)
      if (useMissionStore.getState().state?.outcome !== null) break
    }
    const s = useMissionStore.getState()
    if (!s.state?.pendingIntervention) return // scenario resolved without asking

    expect(s.status).toBe('paused')
    const parked = s.state.tick
    vi.advanceTimersByTime(TICK_MS * 20)
    expect(useMissionStore.getState().state!.tick).toBe(parked)

    // Resolving resumes it.
    const optionId = s.state.pendingIntervention.options[0]!.id
    useMissionStore.getState().resolveIntervention(optionId)
    expect(useMissionStore.getState().state!.pendingIntervention).toBeNull()
  })

  it('finishes, computes metrics and saves a record exactly once', () => {
    launchAndApprove()

    for (let i = 0; i < 40_000; i++) {
      const s = useMissionStore.getState()
      if (s.state?.outcome !== null && s.state !== null) break
      if (s.state?.pendingIntervention) {
        useMissionStore.getState().resolveIntervention(s.state.pendingIntervention.options[0]!.id)
        continue
      }
      vi.advanceTimersByTime(TICK_MS)
    }

    const s = useMissionStore.getState()
    expect(s.state!.outcome).not.toBeNull()
    expect(s.status).toBe('finished')
    expect(s.metrics).not.toBeNull()
    expect(s.metrics!.ticks).toBe(s.state!.tick)
    expect(s.missions).toHaveLength(1)

    // The clock must be stopped: a finished mission that keeps ticking is the
    // leak this whole test file exists for.
    const finalTick = s.state!.tick
    vi.advanceTimersByTime(TICK_MS * 50)
    expect(useMissionStore.getState().state!.tick).toBe(finalTick)
    expect(useMissionStore.getState().missions).toHaveLength(1)
  })

  it('abort ends the mission and records it', () => {
    launchAndApprove()
    vi.advanceTimersByTime(TICK_MS * 5)
    useMissionStore.getState().abort()

    const s = useMissionStore.getState()
    expect(s.state!.outcome).toBe('aborted')
    expect(s.status).toBe('finished')
    expect(s.missions).toHaveLength(1)

    const at = s.state!.tick
    vi.advanceTimersByTime(TICK_MS * 20)
    expect(useMissionStore.getState().state!.tick).toBe(at)
  })

  it('reset clears the mission and the clock', () => {
    launchAndApprove()
    vi.advanceTimersByTime(TICK_MS * 3)
    useMissionStore.getState().reset()

    expect(useMissionStore.getState().state).toBeNull()
    expect(useMissionStore.getState().status).toBe('idle')
    vi.advanceTimersByTime(TICK_MS * 10)
    expect(useMissionStore.getState().state).toBeNull()
  })

  it('dispose stops a running mission', () => {
    launchAndApprove()
    vi.advanceTimersByTime(TICK_MS * 2)
    const at = useMissionStore.getState().state!.tick

    disposeMissionStore()
    vi.advanceTimersByTime(TICK_MS * 20)
    expect(useMissionStore.getState().state!.tick).toBe(at)
  })
})

describe('configuration and preview', () => {
  it('toggles a waypoint off when the same cell is clicked twice', () => {
    const { toggleWaypoint } = useMissionStore.getState()
    const before = useMissionStore.getState().config.waypoints.length
    const cell = { x: 10, y: 10 }
    toggleWaypoint(cell)
    expect(useMissionStore.getState().config.waypoints).toHaveLength(before + 1)
    toggleWaypoint(cell)
    expect(useMissionStore.getState().config.waypoints).toHaveLength(before)
  })

  it('debounces the preview and plans once the input settles', () => {
    useMissionStore.getState().setRisk(0.2)
    useMissionStore.getState().setRisk(0.4)
    useMissionStore.getState().setRisk(0.6)
    expect(useMissionStore.getState().previewPending).toBe(true)

    vi.advanceTimersByTime(200)
    const after = useMissionStore.getState()
    expect(after.previewPending).toBe(false)
    expect(after.preview?.ok).toBe(true)
  })

  it('will not launch with no waypoints', () => {
    useMissionStore.getState().clearWaypoints()
    useMissionStore.getState().launch()
    expect(useMissionStore.getState().state).toBeNull()
    expect(useMissionStore.getState().status).toBe('idle')
  })
})
