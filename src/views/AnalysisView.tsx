/**
 * Mission Analysis and Replay.
 *
 * A list on the left, one mission on the right. Everything on the right is
 * read off the selected `MissionRecord` or off a re-simulation of it; nothing
 * is carried over from the live store, so analysing a mission does not depend
 * on it being the one that just ran.
 *
 * The order down the page is the order the questions get asked: what
 * happened (metrics), how the power held up (chart), where it went (map and
 * scrubber), how that compared to the plan, what it was asked and what it
 * found, and finally the raw log.
 */

import { useEffect } from 'react'

import { EmptyState, Panel } from '@/ui'
import {
  useMissions,
  usePersistenceAvailable,
  useRecordActions,
  useReplay,
  useSelectedMission,
} from '@/state/selectors'
import { useMissionStore } from '@/state/missionStore'
import { MapCanvas } from '@/views/shared/MapCanvas'

import { EnergyChart } from './analysis/EnergyChart'
import { EventLog } from './analysis/EventLog'
import { InterventionsAndHazards } from './analysis/InterventionsAndHazards'
import { MetricsSummary } from './analysis/MetricsSummary'
import { MissionList } from './analysis/MissionList'
import { PlanVsExecuted } from './analysis/PlanVsExecuted'
import { ReplayScrubber } from './analysis/ReplayScrubber'

export function AnalysisView() {
  const missions = useMissions()
  const selected = useSelectedMission()
  const replay = useReplay()
  const actions = useRecordActions()
  const persistenceAvailable = usePersistenceAvailable()
  const selectedMissionId = useMissionStore((s) => s.selectedMissionId)

  // Auto-select the newest mission so the view is never a list beside an
  // empty panel. Only when nothing is selected, so it cannot fight the user.
  useEffect(() => {
    if (!selectedMissionId && missions.length > 0) {
      actions.loadRecord(missions[0].missionId)
    }
  }, [selectedMissionId, missions, actions])

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-y-auto p-3 min-[1100px]:grid-cols-[300px_minmax(0,1fr)] min-[1100px]:overflow-hidden">
      <MissionList
        missions={missions}
        selectedId={selectedMissionId}
        onSelect={actions.loadRecord}
        onExport={actions.exportRecord}
        persistenceAvailable={persistenceAvailable}
      />

      <div className="grid min-h-0 content-start gap-3 min-[1100px]:overflow-y-auto min-[1100px]:pr-1">
        {!selected ? (
          <Panel>
            <EmptyState
              title="No mission selected"
              body="Run a mission and it will appear in the list. Finished missions are saved automatically."
            />
          </Panel>
        ) : (
          <>
            <MetricsSummary metrics={selected.metrics} />

            {replay && replay.session.record.missionId === selected.missionId ? (
              <>
                <EnergyChart
                  series={replay.session.series}
                  batteryReserveFrac={selected.config.batteryReserveFrac}
                  cursorElapsedS={replay.state.elapsedS}
                />

                <Panel
                  flush
                  title="Traverse"
                  subtitle="The same renderer the live mission uses, driven by the scrubber."
                >
                  <div className="h-[380px]">
                    <MapCanvas state={replay.state} />
                  </div>
                </Panel>

                <ReplayScrubber
                  replay={replay}
                  onSeek={actions.seekReplay}
                  onActivate={() => actions.startReplay(selected.missionId)}
                  onDeactivate={actions.stopReplay}
                />
              </>
            ) : (
              <Panel title="Replay">
                <EmptyState
                  compact
                  title="This mission could not be reconstructed"
                  body="The stored record did not replay to an outcome, so there is no map or power trace for it. Its metrics and log below are still what the engine recorded."
                />
              </Panel>
            )}

            <PlanVsExecuted decisions={selected.decisions} metrics={selected.metrics} />
            <InterventionsAndHazards events={selected.events} />
            <div className="min-h-[300px]">
              <EventLog events={selected.events} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
