/**
 * SELENE benchmark harness.
 *
 *   npx tsx bench/run.ts                  full sweep, tables to stdout,
 *                                         machine-readable bench/out/results.json
 *   npx tsx bench/run.ts --ci             reproducibility gate only; non-zero exit
 *                                         if any mission diverges from bench/golden.json
 *   npx tsx bench/run.ts --update-golden  recompute and write bench/golden.json
 *   npx tsx bench/run.ts --help           flags
 *
 * WHAT THIS FILE IS AND IS NOT. It is orchestration, CLI parsing and
 * rendering. Every measurement lives in `bench/experiments/*`, and every
 * number that reaches stdout or the JSON came out of one of those — nothing
 * is computed here. That separation is what makes it possible to say of any
 * published figure which experiment produced it.
 *
 * DETERMINISM. Everything except the `timing` section reproduces exactly: the
 * same command on the same commit prints the same tables. The timing section
 * is a measurement of the machine and is segregated for that reason.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runAdmissibility, type AdmissibilityResult } from './experiments/admissibility'
import {
  runClosedLoop,
  runOpenLoop,
  type ClosedLoopResult,
  type OpenLoopResult,
} from './experiments/baseline'
import { runHeuristicSweep, type HeuristicResult } from './experiments/heuristic'
import {
  computeGolden,
  runReproducibility,
  type CaseDigest,
  type ReproducibilityResult,
} from './experiments/reproducibility'
import {
  runSliderSensitivity,
  runSupervised,
  runSweep,
  type SliderSensitivity,
  type SupervisedCell,
  type SweepResult,
} from './experiments/sweep'
import { runTiming, type TimingResult } from './experiments/timing'
import { heading, num, signedPct, spread, subheading, table } from './lib/table'

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = resolve(HERE, 'golden.json')
const OUT_PATH = resolve(HERE, 'out/results.json')

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  ci: boolean
  updateGolden: boolean
  seeds: number
  repeats: number
  terrains: number
  only: Set<string> | null
  help: boolean
}

const ALL_EXPERIMENTS = [
  'reproducibility',
  'admissibility',
  'baseline',
  'sweep',
  'heuristic',
  'timing',
] as const

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    ci: false,
    updateGolden: false,
    seeds: 12,
    repeats: 15,
    terrains: 40,
    only: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value`)
      return v
    }
    switch (a) {
      case '--ci':
        opts.ci = true
        break
      case '--update-golden':
        opts.updateGolden = true
        break
      case '--quick':
        opts.seeds = 4
        opts.repeats = 5
        opts.terrains = 10
        break
      case '--seeds':
        opts.seeds = Number(next())
        break
      case '--repeats':
        opts.repeats = Number(next())
        break
      case '--terrains':
        opts.terrains = Number(next())
        break
      case '--only':
        opts.only = new Set(next().split(','))
        break
      case '--help':
      case '-h':
        opts.help = true
        break
      default:
        throw new Error(`unknown flag: ${a}`)
    }
  }
  if (!Number.isFinite(opts.seeds) || opts.seeds < 1) throw new Error('--seeds must be >= 1')
  if (!Number.isFinite(opts.repeats) || opts.repeats < 1) throw new Error('--repeats must be >= 1')
  if (!Number.isFinite(opts.terrains) || opts.terrains < 1) throw new Error('--terrains must be >= 1')
  if (opts.only) {
    for (const name of opts.only) {
      if (!(ALL_EXPERIMENTS as readonly string[]).includes(name)) {
        throw new Error(`--only: unknown experiment "${name}"; known: ${ALL_EXPERIMENTS.join(',')}`)
      }
    }
  }
  return opts
}

const HELP = `SELENE benchmark harness

  npx tsx bench/run.ts [flags]

  --ci              reproducibility gate only; exits non-zero on any divergence
  --update-golden   recompute bench/golden.json and exit
  --quick           4 seeds, 5 timing repeats, 10 admissibility terrains
  --seeds N         seeds per sweep cell (default 12)
  --repeats N       timed repeats per timing row (default 15)
  --terrains N      terrains per admissibility cell (default 40)
  --only a,b        run a subset: ${ALL_EXPERIMENTS.join(', ')}
  -h, --help        this text

Machine-readable output is written to bench/out/results.json (gitignored).`

// ---------------------------------------------------------------------------
// Golden file
// ---------------------------------------------------------------------------

function readGolden(): Record<string, CaseDigest> | null {
  try {
    const raw = readFileSync(GOLDEN_PATH, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'cases' in parsed) {
      return (parsed as { cases: Record<string, CaseDigest> }).cases
    }
    return null
  } catch {
    return null
  }
}

function writeGolden(): void {
  const cases = computeGolden()
  const body = {
    // A note in the file itself, because this is the one committed artefact a
    // reviewer will open without any surrounding context.
    note:
      'Digests of the deterministic output of fixed missions. Regenerate with ' +
      '`npx tsx bench/run.ts --update-golden`. A change here means engine behaviour ' +
      'changed; that is sometimes correct and never accidental. planMsTotal is ' +
      'excluded from the metrics digest because it is wall-clock.',
    cases,
  }
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(body, null, 2)}\n`)
  console.log(`wrote ${Object.keys(cases).length} golden digests to bench/golden.json`)
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderReproducibility(r: ReproducibilityResult): string {
  const rows = r.cases.map((c) => [
    c.id,
    c.outcome,
    String(c.ticks),
    c.liveStable ? 'yes' : 'NO',
    c.replayMatches ? 'yes' : 'NO',
    c.goldenMatches === null ? 'missing' : c.goldenMatches ? 'yes' : 'NO',
    c.digest.events,
    c.description,
  ])
  const out = [
    table(
      [
        { header: 'case' },
        { header: 'outcome' },
        { header: 'ticks', align: 'r' },
        { header: 'stable' },
        { header: 'replay' },
        { header: 'golden' },
        { header: 'event digest' },
        { header: 'what it covers' },
      ],
      rows,
    ),
  ]
  if (r.missingGolden.length > 0) {
    out.push(`\nNo golden entry for: ${r.missingGolden.join(', ')} (run --update-golden)`)
  }
  for (const f of r.failures) out.push(`FAIL ${f}`)
  return out.join('\n')
}

function renderAdmissibility(r: AdmissibilityResult): string {
  const rows = r.cells.map((c) => [
    num(c.riskTolerance, 2),
    String(c.compared),
    c.maxAbsGap.toExponential(1),
    c.maxRelGapPct.toExponential(1),
    String(c.violations),
    spread(c.nodesVsOraclePct, 1),
    `${c.aStarWins}/${c.compared}`,
  ])
  return [
    `A* (h admissible, w=1) against the uniform-cost oracle, ${r.terrainsPerCell} terrains per row,`,
    `48x48, equality tolerance ${r.tolerance.toExponential(0)}.`,
    `The unit test asserts the same equality over N=${r.unitTestN} terrains at riskTolerance 0.55.`,
    '',
    table(
      [
        { header: 'risk' },
        { header: 'terrains', align: 'r' },
        { header: 'max |Δcost|', align: 'r' },
        { header: 'max Δ%', align: 'r' },
        { header: 'violations', align: 'r' },
        { header: 'A* nodes as % of oracle' },
        { header: 'A* expands fewer' },
      ],
      rows,
    ),
    '',
    r.pass
      ? 'PASS — A* returned the uniform-cost optimum on every terrain at every risk level.'
      : 'FAIL — A* exceeded the uniform-cost optimum; the heuristic is not admissible.',
  ].join('\n')
}

function renderOpenLoop(r: OpenLoopResult): string {
  const out: string[] = [
    `Risk-aware A* vs shortest-distance, same belief, same start and goal, same hard constraints.`,
    `riskTolerance ${r.riskTolerance}, energyPriority ${r.energyPriority}. Arms:`,
    `  risk-aware         weightsFor(config), constraintsFor(config)`,
    `  shortest-distance  {distance:1, slope:0, hazard:0, energy:0}, SAME constraints`,
    `  shortest-uncapped  distance-only weights, hazard ceiling opened to 0.95`,
  ]

  for (const s of r.scenarios) {
    out.push(subheading(`${s.scenarioId} — ${s.seeds} seeds`))
    out.push(
      table(
        [
          { header: 'arm' },
          { header: 'routed', align: 'r' },
          { header: 'distance m' },
          { header: 'energy Wh' },
          { header: 'peak hazard' },
          { header: 'mean hazard' },
          { header: 'climb % of Wh' },
          { header: 'nodes expanded' },
        ],
        s.arms.map((a) => [
          a.arm,
          `${a.routed}/${a.attempted}`,
          spread(a.distanceM, 0),
          spread(a.energyWh, 1),
          spread(a.peakHazard, 3),
          spread(a.meanHazard, 4),
          spread(a.climbSharePct, 1),
          spread(a.nodesExpanded, 0),
        ]),
      ),
    )
    out.push('')
    out.push('  paired per-seed change, risk-aware relative to each baseline:')
    out.push(
      table(
        [
          { header: '  vs' },
          { header: 'pairs', align: 'r' },
          { header: 'distance' },
          { header: 'energy' },
          { header: 'peak hazard' },
          { header: 'mean hazard' },
          { header: 'nodes' },
          { header: 'mean-haz wins' },
        ],
        s.comparisons.map((c) => [
          `  ${c.baseline}`,
          String(c.pairs),
          signedPct(c.distancePct.median),
          signedPct(c.energyPct.median),
          signedPct(c.peakHazardPct.median),
          signedPct(c.meanHazardPct.median),
          signedPct(c.nodesExpandedPct.median, 0),
          `${c.meanHazardWins.wins}/${c.meanHazardWins.n}`,
        ]),
      ),
    )
  }
  return out.join('\n')
}

function renderClosedLoop(r: ClosedLoopResult): string {
  const out: string[] = [r.note, '']
  for (const s of r.scenarios) {
    out.push(subheading(s.scenarioId))
    out.push(
      table(
        [
          { header: 'arm' },
          { header: 'complete' },
          { header: 'failed', align: 'r' },
          { header: 'unroutable', align: 'r' },
          { header: 'distance m' },
          { header: 'energy Wh' },
          { header: 'replans' },
          { header: 'haz on route' },
          { header: 'peak haz driven' },
        ],
        s.arms.map((a) => [
          a.arm,
          `${a.completed}/${a.seeds}`,
          String(a.failed),
          String(a.unroutable),
          spread(a.distanceM, 0),
          spread(a.energyWh, 1),
          spread(a.replans, 1),
          spread(a.hazardsOnRoute, 1),
          spread(a.peakHazardTraversed, 3),
        ]),
      ),
    )
    out.push(
      `  paired over ${s.pairs} seeds where both completed: distance ` +
        `${signedPct(s.distancePct.median)}, peak hazard driven ` +
        `${num(s.peakHazardAbs.median, 3)} absolute (${signedPct(s.peakHazardPct.median)}), ` +
        `replans ${num(s.replansAbs.median, 1)}, hazards on route ` +
        `${num(s.hazardsOnRouteAbs.median, 1)}; risk-aware peak lower on ` +
        `${s.peakHazardWins.wins}/${s.peakHazardWins.n}, tied ${s.peakHazardWins.ties}.`,
    )
  }
  return out.join('\n')
}

function renderSweep(r: SweepResult): string {
  const out: string[] = [
    `Closed loop, autonomous, ${r.seedsPerCell} seeds per cell, ${r.missionsRun} missions.`,
    `Continuous columns pool missions that drove; completion rate is over all seeds.`,
  ]
  const scenarioIds = [...new Set(r.cells.map((c) => c.scenarioId))]
  for (const id of scenarioIds) {
    out.push(subheading(id))
    out.push(
      table(
        [
          { header: 'risk' },
          { header: 'energy' },
          { header: 'complete' },
          { header: 'unroutable', align: 'r' },
          { header: 'distance m' },
          { header: 'energy Wh' },
          { header: 'battery left' },
          { header: 'replans' },
          { header: 'haz on route' },
          { header: 'peak haz driven' },
          { header: 'plans' },
        ],
        r.cells
          .filter((c) => c.scenarioId === id)
          .map((c) => [
            num(c.riskTolerance, 2),
            num(c.energyPriority, 2),
            `${c.outcomes.complete}/${c.seeds}`,
            String(c.outcomes.unroutable),
            spread(c.distanceM, 0),
            spread(c.energyWh, 1),
            spread(c.batteryRemaining, 3),
            spread(c.replans, 1),
            spread(c.hazardsOnRoute, 1),
            spread(c.peakHazardTraversed, 3),
            spread(c.planCount, 0),
          ]),
      ),
    )
  }
  return out.join('\n')
}

function renderSliders(rows: readonly SliderSensitivity[]): string {
  return [
    'Each row holds the seed and the other slider fixed, moves one slider from `from` to `to`,',
    'and differences the same mission against itself. "route changed" counts seeds where the',
    'driven trail differs at all — the bluntest possible test that the slider is wired up.',
    '',
    table(
      [
        { header: 'scenario' },
        { header: 'slider' },
        { header: 'from -> to' },
        { header: 'other held' },
        { header: 'pairs', align: 'r' },
        { header: 'route changed' },
        { header: 'distance' },
        { header: 'energy' },
        { header: 'peak haz driven' },
        { header: 'replans' },
      ],
      rows.map((r) => [
        r.scenarioId,
        r.slider,
        `${num(r.from, 2)} -> ${num(r.to, 2)}`,
        num(r.held, 2),
        String(r.pairs),
        `${r.routeChanged}/${r.pairs}`,
        signedPct(r.distancePct.median),
        signedPct(r.energyPct.median),
        num(r.peakHazardAbs.median, 3),
        num(r.replansAbs.median, 1),
      ]),
    ),
  ].join('\n')
}

function renderSupervised(cells: readonly SupervisedCell[]): string {
  return table(
    [
      { header: 'scenario' },
      { header: 'risk' },
      { header: 'held', align: 'r' },
      { header: 'completed', align: 'r' },
      { header: 'unroutable', align: 'r' },
      { header: 'failed', align: 'r' },
      { header: 'held at tick' },
      { header: 'reasons' },
    ],
    cells.map((c) => [
      c.scenarioId,
      num(c.riskTolerance, 2),
      `${c.held}/${c.seeds}`,
      String(c.completed),
      String(c.unroutable),
      String(c.failed),
      spread(c.heldAtTick, 0),
      Object.entries(c.reasons)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} x${v}`)
        .join(', ') || '-',
    ]),
  )
}

function renderHeuristic(r: HeuristicResult): string {
  const out: string[] = [
    'Weighted A*: heuristicWeight w multiplies an admissible heuristic.',
    'Suboptimality is measured against the uniform-cost oracle, not against w=1.',
    '',
    table(
      [{ header: 'scenario' }, { header: 'oracle nodes expanded' }],
      r.oracleNodes.map((o) => [o.scenarioId, spread(o.nodesExpanded, 0)]),
    ),
  ]
  const ids = [...new Set(r.cells.map((c) => c.scenarioId))]
  for (const id of ids) {
    out.push(subheading(id))
    out.push(
      table(
        [
          { header: 'w' },
          { header: 'routed', align: 'r' },
          { header: 'nodes expanded' },
          { header: '% of oracle nodes' },
          { header: 'cost above optimum' },
          { header: 'distance m' },
          { header: 'peak hazard' },
        ],
        r.cells
          .filter((c) => c.scenarioId === id)
          .map((c) => [
            num(c.heuristicWeight, 2),
            `${c.routed}/${c.seeds}`,
            spread(c.nodesExpanded, 0),
            spread(c.nodesVsOraclePct, 1),
            spread(c.suboptimalityPct, 2),
            spread(c.distanceM, 0),
            spread(c.peakHazard, 3),
          ]),
      ),
    )
  }
  return out.join('\n')
}

function renderTiming(r: TimingResult): string {
  return [
    `Wall clock on ${r.platform}, node ${r.nodeVersion}. Median [p25-p75] milliseconds,`,
    'after warm-up. These are the only numbers here that do not reproduce exactly.',
    '',
    table(
      [
        { header: 'scenario' },
        { header: 'plan() one leg' },
        { header: 'nodes', align: 'r' },
        { header: 'createSimulation()' },
        { header: 'full mission' },
        { header: 'ticks', align: 'r' },
        { header: 'repeats' },
      ],
      r.rows.map((row) => [
        row.scenarioId,
        spread(row.planCall.ms, 3),
        String(row.nodesExpanded),
        spread(row.createSimulation.ms, 2),
        spread(row.fullMission.ms, 1),
        String(row.ticks),
        `${row.planCall.repeats}/${row.fullMission.repeats}`,
      ]),
    ),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Results {
  generatedAt: string
  options: Omit<Options, 'only'> & { only: string[] | null }
  reproducibility?: ReproducibilityResult
  admissibility?: AdmissibilityResult
  openLoop?: OpenLoopResult
  closedLoop?: ClosedLoopResult
  sweep?: SweepResult
  sliders?: SliderSensitivity[]
  supervised?: SupervisedCell[]
  heuristic?: HeuristicResult
  timing?: TimingResult
}

/** Supervised risk levels. 0.25 is the one the repository's notes quote. */
const SUPERVISED_RISKS = [0.15, 0.25, 0.45] as const

function ciGate(): number {
  const golden = readGolden()
  if (!golden) {
    console.error(
      'bench: bench/golden.json is missing or unreadable.\n' +
        'The reproducibility gate cannot pass without it. Run:\n' +
        '  npx tsx bench/run.ts --update-golden\n' +
        'and commit the result.',
    )
    return 1
  }
  const r = runReproducibility(golden)
  console.log(heading('Reproducibility gate'))
  console.log(renderReproducibility(r))
  if (!r.pass) {
    console.error(
      `\nbench: FAILED — ${r.failures.length} divergence(s)` +
        (r.missingGolden.length ? `, ${r.missingGolden.length} case(s) with no golden entry` : '') +
        '.\nIf the engine changed on purpose, re-run with --update-golden and commit the diff.',
    )
    return 1
  }
  console.log(`\nbench: PASS — ${r.cases.length} missions reproduced exactly.`)
  return 0
}

function main(): number {
  let opts: Options
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`bench: ${(err as Error).message}\n`)
    console.error(HELP)
    return 2
  }
  if (opts.help) {
    console.log(HELP)
    return 0
  }
  if (opts.updateGolden) {
    writeGolden()
    return 0
  }
  if (opts.ci) return ciGate()

  const wants = (name: (typeof ALL_EXPERIMENTS)[number]) => !opts.only || opts.only.has(name)
  const started = performance.now()
  const results: Results = {
    generatedAt: new Date().toISOString(),
    options: { ...opts, only: opts.only ? [...opts.only] : null },
  }
  let failed = false

  if (wants('reproducibility')) {
    const r = runReproducibility(readGolden())
    results.reproducibility = r
    console.log(heading('1. Reproducibility'))
    console.log(renderReproducibility(r))
    // A missing golden entry is not a failure in a full run — only in --ci.
    if (r.failures.length > 0) failed = true
  }

  if (wants('admissibility')) {
    const r = runAdmissibility(opts.terrains)
    results.admissibility = r
    console.log(heading('2. Heuristic admissibility'))
    console.log(renderAdmissibility(r))
    if (!r.pass) failed = true
  }

  if (wants('baseline')) {
    const open = runOpenLoop(opts.seeds)
    results.openLoop = open
    console.log(heading('3. Risk-aware vs shortest-distance — open loop (planner only)'))
    console.log(renderOpenLoop(open))

    const closed = runClosedLoop(opts.seeds)
    results.closedLoop = closed
    console.log(heading('4. Risk-aware vs distance-dominant — closed loop (whole engine)'))
    console.log(renderClosedLoop(closed))
  }

  if (wants('sweep')) {
    const r = runSweep(opts.seeds)
    results.sweep = r
    console.log(heading('5. Closed-loop parameter sweep'))
    console.log(renderSweep(r))

    const sliders = runSliderSensitivity(opts.seeds)
    results.sliders = sliders
    console.log(heading('6. Slider sensitivity — paired, one seed at a time'))
    console.log(renderSliders(sliders))

    const sup = runSupervised(opts.seeds, SUPERVISED_RISKS)
    results.supervised = sup
    console.log(heading('7. Supervised autonomy — where the engine stops and asks'))
    console.log(renderSupervised(sup))
  }

  if (wants('heuristic')) {
    const r = runHeuristicSweep(opts.seeds)
    results.heuristic = r
    console.log(heading('8. Weighted A*'))
    console.log(renderHeuristic(r))
  }

  if (wants('timing')) {
    const r = runTiming(opts.repeats)
    results.timing = r
    console.log(heading('9. Timing'))
    console.log(renderTiming(r))
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, `${JSON.stringify(results, null, 2)}\n`)
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(`\nwrote bench/out/results.json in ${seconds}s`)
  if (failed) {
    console.error('bench: one or more checks FAILED (see above).')
    return 1
  }
  return 0
}

process.exitCode = main()
