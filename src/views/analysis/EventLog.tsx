/**
 * The complete event log for a mission.
 *
 * Oldest first, which is the opposite of the live decision stream and is
 * deliberate: during a mission you want the latest thing, and afterwards you
 * read the mission as a story from the beginning.
 */

import { useMemo } from 'react'

import type { SimEvent } from '@/core/types'
import { Panel, Timeline, type TimelineItem } from '@/ui'
import { describeEvent } from './eventFormat'

export function EventLog({ events }: { events: SimEvent[] }) {
  const items = useMemo<TimelineItem[]>(
    () =>
      events.map((e, i) => {
        const line = describeEvent(e)
        return {
          // Events carry no id, and two can legitimately share a tick and a
          // type, so the index is the only stable key available.
          id: `${e.type}-${e.tick}-${i}`,
          tick: e.tick,
          title: line.title,
          detail: line.detail || undefined,
          tone: line.tone,
        }
      }),
    [events],
  )

  return (
    <Panel
      title="Event log"
      subtitle={`${events.length} event${events.length === 1 ? '' : 's'}, oldest first`}
      scroll
      className="min-h-0"
    >
      <Timeline items={items} emptyLabel="No events recorded" />
    </Panel>
  )
}
