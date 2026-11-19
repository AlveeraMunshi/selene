/**
 * Playback transport.
 *
 * Step-once exists because the interesting moments in a mission last one tick
 * -- a hazard appearing under the route, a replan firing -- and at 2 Hz they
 * are gone before you can read them.
 *
 * Every button's disabled state comes from the store's own view of what is
 * possible, so the UI cannot offer Play on a mission that is waiting for an
 * operator answer.
 */

import { Badge, Button, Select } from '@/ui'
import { SPEEDS, type Speed } from '@/state/defaults'
import { fmtMultiplier } from '@/lib/format'
import type { PlaybackSlice } from '@/state/selectors'

export interface TransportControlsProps {
  playback: PlaybackSlice
  onPlay: () => void
  onPause: () => void
  onStep: () => void
  onReset: () => void
  onAbort: () => void
  onSpeed: (speed: Speed) => void
  /** Replay drives the map from the scrubber, so live transport is inert. */
  replaying: boolean
}

const SPEED_OPTIONS = SPEEDS.map((s) => ({ value: String(s), label: fmtMultiplier(s) }))

export function TransportControls({
  playback,
  onPlay,
  onPause,
  onStep,
  onReset,
  onAbort,
  onSpeed,
  replaying,
}: TransportControlsProps) {
  if (replaying) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="info">Replay</Badge>
        <span className="text-2xs text-ink-dim">
          The map is showing a saved mission. Transport is the scrubber in Analysis.
        </span>
      </div>
    )
  }

  const running = playback.status === 'running'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        onClick={running ? onPause : onPlay}
        disabled={!running && !playback.canPlay}
        title={running ? 'Pause (space)' : 'Play (space)'}
      >
        {running ? 'Pause' : 'Play'}
      </Button>
      <Button variant="secondary" size="sm" onClick={onStep} disabled={!playback.canStep}>
        Step
      </Button>
      <Button variant="ghost" size="sm" onClick={onReset} disabled={!playback.hasMission}>
        Reset
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <Select
          value={String(playback.speed)}
          onChange={(v) => onSpeed(Number(v) as Speed)}
          options={SPEED_OPTIONS}
          aria-label="Playback speed"
          className="w-20"
        />
        <Button
          variant="danger"
          size="sm"
          onClick={onAbort}
          disabled={!playback.hasMission || playback.status === 'finished'}
          title="End the mission now and record it as aborted"
        >
          Abort
        </Button>
      </div>
    </div>
  )
}
