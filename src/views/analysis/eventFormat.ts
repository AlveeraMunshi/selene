/**
 * Turning a `SimEvent` into a log line.
 *
 * Kept out of the component and written as one exhaustive switch so that a
 * new event type added to the union is a TYPE ERROR here rather than a row
 * that silently renders as an empty string. That is the whole reason this is
 * a separate module with a `never` check at the bottom.
 *
 * Nothing is summarised away: every field an event carries is printed, since
 * the log is the thing a reader checks the prose against.
 */

import type { SimEvent } from '@/core/types'
import type { ToneExtended } from '@/ui'
import { fmtCell, fmtPercent, humanizeCode } from '@/lib/format'

export interface EventLine {
  title: string
  detail: string
  tone: ToneExtended
}

export function describeEvent(e: SimEvent): EventLine {
  switch (e.type) {
    case 'mission-started':
      return { title: 'Mission started', detail: '', tone: 'info' }

    case 'plan-computed':
      return {
        title: 'Plan computed',
        detail: `route cost ${e.routeCost.toFixed(2)} · decision ${e.decisionId}`,
        tone: 'default',
      }

    case 'plan-failed':
      return { title: 'Plan failed', detail: humanizeCode(e.reason), tone: 'danger' }

    case 'hazard-discovered':
      return {
        title: 'Hazard discovered',
        detail: `${fmtCell(e.cell)} · severity ${fmtPercent(e.severity)}${
          e.onRoute ? ' · on the route being driven' : ' · off route'
        }`,
        // Only an on-route discovery is a risk to the mission; an off-route
        // one is just new knowledge, and amber is reserved for risk.
        tone: e.onRoute ? 'warn' : 'default',
      }

    case 'replan-triggered':
      return { title: 'Replan triggered', detail: e.trigger, tone: 'warn' }

    case 'waypoint-reached':
      return {
        title: `Waypoint ${e.index + 1} reached`,
        detail: fmtCell(e.cell),
        tone: 'good',
      }

    case 'intervention-required':
      return {
        title: 'Operator decision required',
        detail: humanizeCode(e.reason),
        tone: 'warn',
      }

    case 'intervention-resolved':
      return { title: 'Operator chose', detail: e.optionId, tone: 'info' }

    case 'battery-low':
      return { title: 'Battery low', detail: fmtPercent(e.battery, 1), tone: 'danger' }

    case 'mission-complete':
      return { title: 'Mission complete', detail: '', tone: 'good' }

    case 'mission-failed':
      return { title: 'Mission failed', detail: e.reason, tone: 'danger' }

    case 'mission-aborted':
      return { title: 'Mission aborted', detail: '', tone: 'warn' }

    default: {
      // Exhaustiveness guard: adding a SimEvent variant must break the build
      // here rather than produce a blank row at runtime.
      const never: never = e
      return { title: String((never as { type?: string }).type ?? 'Unknown'), detail: '', tone: 'default' }
    }
  }
}
