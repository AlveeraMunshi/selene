/**
 * Scrub through a finished mission.
 *
 * Seeking steps forward from the nearest keyframe rather than from the start
 * (see `lib/replay.ts`), which is what makes dragging this smooth instead of
 * re-simulating a thousand ticks per input event.
 *
 * "Drive the live map" is a separate control from the scrubber on purpose:
 * reconstructing a mission is what the chart and this slider need, and
 * silently replacing whatever is on the Mission tab because someone clicked
 * a row in a list would be hostile.
 */

import { Badge, Button, Panel, Slider } from '@/ui'
import { fmtClock } from '@/lib/format'
import { TICK_SECONDS } from '@/core/types'
import type { ReplayView } from '@/state/missionStore'

export interface ReplayScrubberProps {
  replay: ReplayView
  onSeek: (tick: number) => void
  onActivate: () => void
  onDeactivate: () => void
}

export function ReplayScrubber({ replay, onSeek, onActivate, onDeactivate }: ReplayScrubberProps) {
  const { session, tick, active } = replay
  const total = session.totalTicks

  return (
    <Panel
      title="Replay"
      subtitle={
        session.truncated
          ? 'This record could not be replayed to its end; the reconstruction stops short.'
          : undefined
      }
      actions={
        active ? (
          <Button variant="secondary" size="sm" onClick={onDeactivate}>
            Stop driving the map
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onActivate}>
            Drive the live map
          </Button>
        )
      }
    >
      <div className="grid gap-3">
        <Slider
          label="Position"
          value={tick}
          min={0}
          max={Math.max(total, 1)}
          step={1}
          onChange={onSeek}
          format={(v) => `${fmtClock(v * TICK_SECONDS)}  ·  tick ${v}`}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => onSeek(0)} disabled={tick === 0}>
            Start
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSeek(tick - 1)}
            disabled={tick === 0}
            aria-label="Step back one tick"
          >
            &minus;1
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSeek(tick + 1)}
            disabled={tick >= total}
            aria-label="Step forward one tick"
          >
            +1
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onSeek(total)} disabled={tick >= total}>
            End
          </Button>
          <span className="ml-auto">
            {active ? <Badge tone="info">Driving the map</Badge> : null}
          </span>
        </div>
      </div>
    </Panel>
  )
}
