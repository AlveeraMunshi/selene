/**
 * The application shell.
 *
 * WHY THE HEADER'S LIVE FIGURES ARE THEIR OWN COMPONENT: the mission clock
 * and the status badge change on every tick. If they were read here, every
 * tick would re-render App and therefore the entire active view. `MissionPulse`
 * is a leaf that subscribes to those two scalars and nothing else, so a tick
 * re-renders a span.
 *
 * WHY ALL THREE VIEWS ARE NOT MOUNTED AT ONCE: only the active one renders.
 * The alternative -- keeping them mounted and hiding two with CSS -- would
 * leave three canvases running their rAF loops and three copies of the
 * decision list subscribed to the store.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'

import { getScenario } from '@/core/scenarios'
import { Badge, Spinner, Tabs, type TabItem, type ToneExtended } from '@/ui'
import { fmtClock, humanizeCode } from '@/lib/format'
import { useKeyboardShortcuts, type Shortcut } from '@/lib/hooks'
import { SPEEDS, type Speed } from '@/state/defaults'
import { disposeMissionStore, initMissionStore, useMissionStore } from '@/state/missionStore'
import { useConfig, usePlayback, usePlaybackActions } from '@/state/selectors'

import { MissionView } from '@/views/MissionView'
import { PlannerView } from '@/views/PlannerView'
import { ErrorBoundary } from '@/views/shared/ErrorBoundary'

/**
 * Analysis is the only view that pulls in Recharts, which is roughly half
 * the bundle. Splitting it here means the planner and the mission -- the two
 * screens a first-time visitor actually waits for -- do not pay for a chart
 * library they never render.
 */
const AnalysisView = lazy(() =>
  import('@/views/AnalysisView').then((m) => ({ default: m.AnalysisView })),
)

type ViewId = 'planner' | 'mission' | 'analysis'

const TABS: TabItem[] = [
  { id: 'planner', label: 'Planner' },
  { id: 'mission', label: 'Mission' },
  { id: 'analysis', label: 'Analysis' },
]

export function App() {
  const [view, setView] = useState<ViewId>('planner')

  // The opening route preview, and one teardown for the whole app. The
  // store's ticker and preview timer are module-scoped, so nothing else will
  // clean them up on a hot reload.
  useEffect(() => {
    initMissionStore()
    return disposeMissionStore
  }, [])

  // Launching should take you to the thing you just launched; leaving the
  // operator on the planner watching nothing is the obvious papercut.
  const goToMission = useCallback(() => setView('mission'), [])

  useGlobalShortcuts()

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-surface-0 text-ink">
      <AppHeader view={view} onViewChange={setView} />

      <main
        role="tabpanel"
        aria-labelledby={`selene-tab-${view}`}
        className="min-h-0 grow overflow-hidden"
      >
        {/* Keyed on the view so a throw in one tab does not leave the error
            panel showing after the user has switched away from it. */}
        <ErrorBoundary key={view} label={`${view} view`}>
          {view === 'planner' ? <PlannerView onLaunched={goToMission} /> : null}
          {view === 'mission' ? <MissionView onGoToPlanner={() => setView('planner')} /> : null}
          {view === 'analysis' ? (
            <Suspense fallback={<ViewLoading />}>
              <AnalysisView />
            </Suspense>
          ) : null}
        </ErrorBoundary>
      </main>
    </div>
  )
}

function ViewLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner label="Loading analysis" size={20} />
    </div>
  )
}

function AppHeader({ view, onViewChange }: { view: ViewId; onViewChange: (v: ViewId) => void }) {
  const config = useConfig()
  const scenarioName = useMemo(() => {
    try {
      return getScenario(config.scenarioId).name
    } catch {
      return config.scenarioId
    }
  }, [config.scenarioId])

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-1 px-3 py-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">SELENE</span>
        <span className="hidden text-2xs text-ink-dim sm:inline">
          Autonomous lunar exploration lab
        </span>
      </div>

      <span className="truncate text-2xs text-ink-muted">{scenarioName}</span>

      <div className="ml-auto flex items-center gap-3">
        <MissionPulse />
        <Tabs
          tabs={TABS}
          active={view}
          onChange={(id) => onViewChange(id as ViewId)}
          aria-label="Application section"
        />
      </div>
    </header>
  )
}

/**
 * The clock and the status badge.
 *
 * This is the only part of the shell that subscribes to the ticking state,
 * which is why it is separated from `AppHeader`.
 */
function MissionPulse() {
  const playback = usePlayback()
  const elapsedS = useMissionStore((s) => s.state?.elapsedS ?? null)

  return (
    <div className="flex items-center gap-2">
      <span className="num text-2xs text-ink-muted">
        {elapsedS === null ? '--:--' : fmtClock(elapsedS)}
      </span>
      <Badge tone={statusTone(playback)}>
        {playback.awaitingOperator ? 'Awaiting operator' : humanizeCode(playback.status)}
      </Badge>
    </div>
  )
}

function statusTone(p: ReturnType<typeof usePlayback>): ToneExtended {
  if (p.awaitingOperator) return 'warn'
  if (p.status === 'running') return 'info'
  if (p.status === 'finished') return 'good'
  return 'default'
}

/**
 * Space play/pause, `[` and `]` for speed, `r` to reset.
 *
 * The hook refuses to fire while a text input is focused and while any
 * modifier is held, so cmd+R still reloads and typing a seed does not reset
 * the mission mid-word.
 */
function useGlobalShortcuts(): void {
  const playback = usePlayback()
  const actions = usePlaybackActions()

  const shortcuts = useMemo<Shortcut[]>(() => {
    const stepSpeed = (dir: 1 | -1) => () => {
      const i = SPEEDS.indexOf(playback.speed as Speed)
      const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? 1 : i) + dir))]
      if (next !== undefined) actions.setSpeed(next)
    }
    return [
      {
        key: ' ',
        run: () => {
          if (playback.status === 'running') actions.pause()
          else if (playback.canPlay) actions.play()
        },
      },
      { key: '[', run: stepSpeed(-1), allowRepeat: true },
      { key: ']', run: stepSpeed(1), allowRepeat: true },
      { key: 'r', run: actions.reset },
    ]
  }, [playback, actions])

  useKeyboardShortcuts(shortcuts)
}
