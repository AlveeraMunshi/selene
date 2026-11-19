/**
 * Gallery — every component, every variant, every state, on one page.
 *
 * WHY THIS IS SHIPPED CODE AND NOT A STORYBOOK: the design system has to be
 * reviewable by someone who runs `npm run dev` and nothing else, and it has
 * to stay reviewable after the app around it changes. A single component that
 * imports the real barrel is the cheapest honest version of that — if a
 * component's props change and the Gallery stops compiling, the review
 * surface has been caught going stale by the typechecker.
 *
 * It also serves as the regression check a screenshot diff can be pointed at,
 * and as the place to look at loading, disabled, empty and danger states,
 * which are exactly the states nobody remembers to design until an operator
 * meets one at the worst moment.
 *
 * Mount it on a route (or temporarily from App) to review the system.
 */
import { useState, type ReactNode } from 'react'
import {
  Activity,
  BatteryMedium,
  CircleCheck,
  Compass,
  Crosshair,
  Download,
  Eye,
  Flag,
  Gauge,
  Info,
  Layers,
  ListTree,
  Map,
  Mountain,
  OctagonX,
  Pause,
  Play,
  Radar,
  Route,
  RotateCcw,
  Satellite,
  Settings2,
  TriangleAlert,
  Zap,
} from 'lucide-react'

import { Badge } from './Badge'
import { Button } from './Button'
import { cn } from './cn'
import { EmptyState } from './EmptyState'
import { Field } from './Field'
import { KeyValue } from './KeyValue'
import { Meter } from './Meter'
import { Panel } from './Panel'
import { Select } from './Select'
import { Slider } from './Slider'
import { Spinner } from './Spinner'
import { Stat } from './Stat'
import { Tabs } from './Tabs'
import { Timeline } from './Timeline'
import { Toggle } from './Toggle'
import type { Tone, ToneExtended } from './tones'

const TONES: Tone[] = ['default', 'good', 'warn', 'danger']
const TONES_EXT: ToneExtended[] = ['default', 'good', 'warn', 'danger', 'info']

/** A labelled band of the sheet. Not exported — the Gallery's own furniture. */
function Section({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-2">
        <h2 className="text-sm font-medium tracking-tight text-ink">{title}</h2>
        {note && <p className="text-2xs text-ink-dim">{note}</p>}
      </div>
      {children}
    </section>
  )
}

/** A captioned specimen cell. */
function Spec({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="min-w-0">
      <div className={cn('h-10 rounded-control border border-line', className)} />
      <div className="num mt-1 truncate text-2xs text-ink-dim">{name}</div>
    </div>
  )
}

export function Gallery() {
  // Every interactive component gets real state so the sheet can be driven,
  // not just looked at — a disabled-looking slider that will not move is the
  // commonest way a specimen sheet lies about the system.
  const [risk, setRisk] = useState(0.45)
  const [slope, setSlope] = useState(22)
  const [energy, setEnergy] = useState(0.6)
  const [autonomy, setAutonomy] = useState(true)
  const [showHazard, setShowHazard] = useState(true)
  const [tab, setTab] = useState('route')
  const [scenario, setScenario] = useState('dynamic-hazard')
  const [selectedEvent, setSelectedEvent] = useState<string | null>('d3')
  const [busy, setBusy] = useState(false)

  return (
    <div className="min-h-screen bg-void text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface-0/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-baseline gap-3">
            <Satellite size={16} className="translate-y-0.5 text-accent" aria-hidden="true" />
            <h1 className="text-sm font-medium tracking-tight">SELENE design system</h1>
            <span className="num text-2xs text-ink-dim">v0.1</span>
          </div>
          <Badge tone="info" icon={Info}>
            specimen sheet
          </Badge>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1180px] flex-col gap-10 px-6 py-8">
        {/* ---------------------------------------------------------- */}
        <Section
          id="tokens"
          title="Tokens"
          note="Surfaces step by value, not by shadow. Amber and red are reserved for risk."
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
              <Swatch name="void" className="bg-void" />
              <Swatch name="surface-0" className="bg-surface-0" />
              <Swatch name="surface-1" className="bg-surface-1" />
              <Swatch name="surface-2" className="bg-surface-2" />
              <Swatch name="surface-3" className="bg-surface-3" />
              <Swatch name="accent" className="bg-accent" />
              <Swatch name="good" className="bg-good" />
              <Swatch name="warn" className="bg-warn" />
              <Swatch name="danger" className="bg-danger" />
            </div>

            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Spec label="ink">
                <p className="text-ink">Primary value text</p>
              </Spec>
              <Spec label="ink-muted">
                <p className="text-ink-muted">Secondary body copy</p>
              </Spec>
              <Spec label="ink-dim">
                <p className="text-ink-dim">Labels, units, captions</p>
              </Spec>
              <Spec label="ink-faint">
                <p className="text-ink-faint">Disabled, rails</p>
              </Spec>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <Spec label="Proportional figures — they jitter">
                <p className="text-xl tracking-tight">111.11 / 888.88 / 000.00</p>
              </Spec>
              <Spec label="num — tabular, the system default for telemetry">
                <p className="num text-xl tracking-tight">111.11 / 888.88 / 000.00</p>
              </Spec>
            </div>

            <div className="flex flex-wrap items-end gap-6">
              <Spec label="radius-control (6px)">
                <div className="h-10 w-20 rounded-control border border-line bg-surface-2" />
              </Spec>
              <Spec label="radius-panel (10px)">
                <div className="h-10 w-20 rounded-panel border border-line bg-surface-1" />
              </Spec>
              <Spec label="hairline">
                <div className="h-10 w-20 border-y border-line bg-surface-1" />
              </Spec>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="button" title="Button" note="One primary per region. Danger is outlined, never a red slab.">
          <div className="flex flex-col gap-5">
            {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-3">
                <span className="eyebrow w-20 shrink-0">{variant}</span>
                <Button variant={variant} size="sm" icon={Play}>
                  Small
                </Button>
                <Button variant={variant} size="md" icon={Play}>
                  Medium
                </Button>
                <Button variant={variant} size="lg" icon={Play}>
                  Large
                </Button>
                <Button variant={variant}>No icon</Button>
                <Button variant={variant} icon={Pause} aria-label="Icon only" />
                <Button variant={variant} loading>
                  Loading
                </Button>
                <Button variant={variant} disabled icon={Play}>
                  Disabled
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow w-20 shrink-0">full</span>
              <div className="w-64">
                <Button variant="primary" full icon={busy ? undefined : Play} loading={busy} onClick={() => {
                  setBusy(true)
                  window.setTimeout(() => setBusy(false), 1400)
                }}>
                  {busy ? 'Planning route' : 'Run plan (click me)'}
                </Button>
              </div>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="badge" title="Badge" note="Reports state. Never interactive.">
          <div className="flex flex-wrap items-center gap-2">
            {TONES_EXT.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
            <Badge tone="good" icon={CircleCheck}>
              nominal
            </Badge>
            <Badge tone="warn" icon={TriangleAlert}>
              hazard 0.62
            </Badge>
            <Badge tone="danger" icon={OctagonX}>
              reserve breach
            </Badge>
            <Badge tone="info" icon={Radar}>
              replanning
            </Badge>
            <Badge mono tone="default">
              tick 1842
            </Badge>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="stat" title="Stat" note="Label recedes, value dominates. Monospace by default.">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Distance" value="1 284.6" unit="m" />
            <Stat label="Energy drawn" value="312.4" unit="Wh" tone="warn" hint="of 480 Wh" />
            <Stat label="Battery" value="18.2" unit="%" tone="danger" hint="below reserve" />
            <Stat label="Waypoints" value="3 / 4" tone="good" />
            <Stat label="Mode" value="driving" mono={false} hint="autonomous" />
            <Stat label="Peak slope" value="24.8" unit="deg" compact />
            <Stat label="Nodes expanded" value="41 902" compact />
            <Stat label="Plan time" value="38.7" unit="ms" compact tone="good" />
            <Stat label="Replans" value="7" compact tone="warn" />
            <Stat label="Outcome" value="—" mono={false} compact hint="mission running" />
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="meter" title="Meter" note="A level within a known range. Width snaps; only colour transitions.">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Meter label="Observed" value={0.82} tone="default" caption="13 430 of 16 384 cells" />
            <Meter label="Battery" value={0.64} tone="good" caption="307 Wh remaining" />
            <Meter label="Route hazard" value={0.47} tone="warn" caption="peak 0.62 at (71, 38)" />
            <Meter label="Reserve margin" value={0.06} tone="danger" caption="below 15% floor" />
            <Meter label="No percentage" value={0.3} showPct={false} />
            <Meter label="Clamped from 1.8" value={1.8} tone="good" />
            <Meter label="Clamped from -0.5" value={-0.5} />
            <Meter value={0.5} label={undefined} caption="Unlabelled, aria-label applied" />
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="controls" title="Controls" note="Native elements with replaced chrome. Drive them with the keyboard.">
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="Mission parameters" subtitle="Changing these re-plans on the next tick">
              <div className="flex flex-col gap-5">
                <Slider
                  label="Risk tolerance"
                  value={risk}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={setRisk}
                  format={(v) => v.toFixed(2)}
                  marks={[
                    { value: 0, label: 'safe' },
                    { value: 0.5, label: '0.50' },
                    { value: 1, label: 'reckless' },
                  ]}
                  hint="Believed hazard above this is impassable."
                />
                <Slider
                  label="Max slope"
                  value={slope}
                  min={5}
                  max={40}
                  step={1}
                  onChange={setSlope}
                  format={(v) => `${v}°`}
                  hint="Hard climb limit, independent of cost weights."
                />
                <Slider
                  label="Energy priority"
                  value={energy}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setEnergy}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <Slider
                  label="Heuristic weight (disabled)"
                  value={1}
                  min={1}
                  max={3}
                  step={0.1}
                  onChange={() => {}}
                  format={(v) => v.toFixed(1)}
                  disabled
                  hint="Locked while a mission is running."
                />
              </div>
            </Panel>

            <Panel title="Autonomy" subtitle="Toggles take effect immediately">
              <div className="flex flex-col gap-4">
                <Toggle
                  label="Autonomous"
                  checked={autonomy}
                  onChange={setAutonomy}
                  hint="Drive through risk decisions without asking."
                />
                <Toggle
                  label="Hazard overlay"
                  checked={showHazard}
                  onChange={setShowHazard}
                  hint="Paint believed hazard on the terrain."
                />
                <Toggle label="Off state" checked={false} onChange={() => {}} />
                <Toggle label="Disabled, on" checked disabled onChange={() => {}} />
                <Toggle label="Disabled, off" checked={false} disabled onChange={() => {}} />
              </div>
            </Panel>

            <Panel title="Selection & fields">
              <div className="flex flex-col gap-4">
                <Select
                  label="Scenario"
                  value={scenario}
                  onChange={setScenario}
                  options={[
                    { value: 'baseline-traverse', label: 'Baseline traverse' },
                    { value: 'dynamic-hazard', label: 'Dynamic hazard' },
                    { value: 'competing-objectives', label: 'Competing objectives' },
                  ]}
                />
                <Select
                  label="Disabled"
                  value="supervised"
                  disabled
                  onChange={() => {}}
                  options={[{ value: 'supervised', label: 'Supervised' }]}
                />
                <Select
                  aria-label="Overlay, no visible label"
                  value="hazard"
                  onChange={() => {}}
                  options={[
                    { value: 'hazard', label: 'Hazard' },
                    { value: 'slope', label: 'Slope' },
                    { value: 'elevation', label: 'Elevation' },
                  ]}
                />
                <Field label="Playback" hint="Stepping is disabled while driving.">
                  <div className="flex gap-1.5">
                    <Button size="sm" icon={Play} aria-label="Play" />
                    <Button size="sm" icon={Pause} aria-label="Pause" />
                    <Button size="sm" icon={RotateCcw} aria-label="Restart" />
                    <Button size="sm" variant="danger" icon={OctagonX}>
                      Abort
                    </Button>
                  </div>
                </Field>
                <Field label="Goal cell" inline hint="Click the map to move it.">
                  <span className="num text-[0.8125rem] text-ink">71, 38</span>
                </Field>
              </div>
            </Panel>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="tabs" title="Tabs" note="Roving tabindex. Left/Right/Home/End move selection and focus.">
          <div className="flex flex-col gap-4">
            <div className="max-w-xl">
              <Tabs
                aria-label="Inspector"
                active={tab}
                onChange={setTab}
                tabs={[
                  { id: 'route', label: 'Route', icon: Route },
                  { id: 'decisions', label: 'Decisions', icon: ListTree, badge: 12 },
                  { id: 'terrain', label: 'Terrain', icon: Mountain },
                  { id: 'metrics', label: 'Metrics', icon: Gauge },
                  { id: 'export', label: 'Export', icon: Download, disabled: true },
                ]}
              />
            </div>
            <div
              role="tabpanel"
              aria-labelledby={`selene-tab-${tab}`}
              className="num rounded-panel border border-line bg-surface-1 p-4 text-2xs text-ink-dim"
            >
              active tab: {tab}
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="panel" title="Panel" note="Owns its own scroll. The page never scrolls in the real app.">
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel>
              <p className="text-2xs text-ink-dim">
                No header. A bare surface, costing no vertical space.
              </p>
            </Panel>

            <Panel
              title="With actions"
              subtitle="Header, subtitle and controls"
              actions={
                <>
                  <Button size="sm" variant="ghost" icon={Eye} aria-label="Toggle visibility" />
                  <Button size="sm" variant="ghost" icon={Settings2} aria-label="Settings" />
                </>
              }
            >
              <KeyValue
                rows={[
                  { k: 'Distance', v: '1 284.6 m' },
                  { k: 'Energy', v: '312.4 Wh', tone: 'warn' },
                  { k: 'Peak hazard', v: '0.62', tone: 'danger' },
                  { k: 'Peak slope', v: '24.8°' },
                  { k: 'Reason', v: 'lower-hazard-cost', tone: 'good' },
                ]}
              />
            </Panel>

            <Panel title="Scrolling body" subtitle="scroll" scroll className="h-[220px]">
              <KeyValue
                divided
                rows={Array.from({ length: 14 }, (_, i) => ({
                  k: `Candidate ${i + 1}`,
                  v: (1.2 + i * 0.37).toFixed(3),
                  tone: (i === 3 ? 'good' : i === 11 ? 'danger' : 'default') as Tone,
                }))}
              />
            </Panel>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="timeline" title="Timeline" note="Fixed monospace tick column. Rows are buttons only when they select something.">
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Decision log" scroll className="h-[320px]">
              <Timeline
                items={[
                  {
                    id: 'd1',
                    tick: 0,
                    title: 'Mission started',
                    detail: 'dynamic-hazard, seed 20261119',
                    tone: 'info',
                    icon: Flag,
                    onClick: () => setSelectedEvent('d1'),
                    active: selectedEvent === 'd1',
                  },
                  {
                    id: 'd2',
                    tick: 1,
                    title: 'Initial plan computed',
                    detail: '412 cells · 1 284.6 m · 41 902 nodes expanded',
                    tone: 'good',
                    icon: Route,
                    onClick: () => setSelectedEvent('d2'),
                    active: selectedEvent === 'd2',
                  },
                  {
                    id: 'd3',
                    tick: 318,
                    title: 'Hazard discovered on route',
                    detail: 'cell (71, 38) severity 0.62 — 11 cells ahead',
                    tone: 'warn',
                    icon: TriangleAlert,
                    onClick: () => setSelectedEvent('d3'),
                    active: selectedEvent === 'd3',
                  },
                  {
                    id: 'd4',
                    tick: 319,
                    title: 'Replan triggered',
                    detail: 'route-blocked · +84 m, −0.31 peak hazard',
                    tone: 'info',
                    icon: Radar,
                    onClick: () => setSelectedEvent('d4'),
                    active: selectedEvent === 'd4',
                  },
                  {
                    id: 'd5',
                    tick: 904,
                    title: 'Waypoint 2 reached',
                    tone: 'good',
                    icon: Crosshair,
                    onClick: () => setSelectedEvent('d5'),
                    active: selectedEvent === 'd5',
                  },
                  {
                    id: 'd6',
                    tick: 1412,
                    title: 'Battery reserve breach',
                    detail: 'projected 11.4% at goal, floor is 15%',
                    tone: 'danger',
                    icon: BatteryMedium,
                    onClick: () => setSelectedEvent('d6'),
                    active: selectedEvent === 'd6',
                  },
                  {
                    id: 'd7',
                    tick: 1413,
                    title: 'Awaiting operator decision',
                    detail: 'four options offered',
                    tone: 'warn',
                    icon: Activity,
                  },
                  { id: 'd8', tick: 1480, title: 'Inert row, no handler', detail: 'not focusable' },
                ]}
              />
            </Panel>

            <Panel title="Empty timeline">
              <Timeline items={[]} emptyLabel="No decisions yet" />
            </Panel>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="empty" title="EmptyState & Spinner" note="Honest absence beats fabricated telemetry.">
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="No mission">
              <EmptyState
                icon={Map}
                title="No mission running"
                body="Pick a scenario and press Run. The terrain, route and decision log appear here."
                action={
                  <Button variant="primary" size="sm" icon={Play}>
                    Run mission
                  </Button>
                }
              />
            </Panel>

            <Panel title="Compact, no action">
              <EmptyState compact icon={ListTree} title="Nothing selected" body="Pick a decision from the log." />
            </Panel>

            <Panel title="Spinner">
              <div className="flex flex-col gap-4">
                <Spinner size={14} label="Planning route" />
                <Spinner size={20} label="Replanning from tick 319" />
                <div className="text-accent">
                  <Spinner size={28} label="Inherits currentColor" />
                </div>
                <Spinner size={16} label="Screen-reader only" labelHidden />
              </div>
            </Panel>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="composed" title="Composed" note="The parts together, at real density.">
          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <Panel
              title="Rover telemetry"
              subtitle="tick 1 412 · 11m 46s simulated"
              actions={<Badge tone="warn" icon={TriangleAlert}>awaiting approval</Badge>}
            >
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Odometer" value="1 284.6" unit="m" compact />
                  <Stat label="Energy" value="312.4" unit="Wh" compact tone="warn" />
                  <Stat label="Heading" value="138.4" unit="deg" compact />
                  <Stat label="Speed" value="0.34" unit="m/s" compact />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Meter label="Battery" value={0.114} tone="danger" caption="floor 15%" />
                  <Meter label="Observed" value={0.82} caption="13 430 cells" />
                  <Meter label="Route hazard" value={0.47} tone="warn" caption="peak 0.62" />
                </div>
              </div>
            </Panel>

            <Panel title="Intervention required" subtitle="battery-reserve-breach">
              <div className="flex flex-col gap-3">
                <p className="text-[0.8125rem] leading-5 text-ink-muted">
                  The current route is projected to land at{' '}
                  <span className="num text-danger">11.4%</span> battery, below the{' '}
                  <span className="num text-ink">15%</span> reserve.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Button variant="primary" full icon={Compass}>
                    Take the longer safe route
                  </Button>
                  <Button variant="secondary" full icon={Zap}>
                    Raise risk tolerance to 0.70
                  </Button>
                  <Button variant="ghost" full icon={Layers}>
                    Skip this waypoint
                  </Button>
                  <Button variant="danger" full icon={OctagonX}>
                    Abort mission
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section id="tone-matrix" title="Tone matrix" note="Every tone on every component that takes one.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TONES.map((tone) => (
              <Panel key={tone} title={tone}>
                <div className="flex flex-col gap-3">
                  <Badge tone={tone}>{tone}</Badge>
                  <Stat label="Reading" value="42.8" unit="Wh" tone={tone} compact />
                  <Meter label="Level" value={0.58} tone={tone} />
                  <KeyValue rows={[{ k: 'Value', v: '0.618', tone }]} />
                  <Timeline
                    items={[{ id: `t-${tone}`, tick: 42, title: `${tone} entry`, tone, icon: Activity }]}
                  />
                </div>
              </Panel>
            ))}
          </div>
        </Section>

        <footer className="border-t border-line pt-4 pb-10 text-2xs text-ink-dim">
          Amber means caution and red means a breach — everywhere, without exception. See{' '}
          <span className="num">docs/DESIGN_SYSTEM.md</span>.
        </footer>
      </main>
    </div>
  )
}
