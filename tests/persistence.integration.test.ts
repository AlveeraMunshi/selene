/**
 * Storage, and what the app does when it is taken away.
 *
 * `src/lib/` has no unit tests of its own, and `persist.ts` is the module
 * most likely to take the whole application down when it misbehaves: it runs
 * at store construction, before anything has rendered, and `localStorage`
 * THROWS rather than returning null in the three situations the file's own
 * comment names -- Safari private browsing, a full origin quota, and an
 * embedded context with storage blocked.
 *
 * WHY EVERY TEST RE-IMPORTS THE MODULE. `persist.ts` probes the backend once
 * and caches the result in a module-scoped variable, which is the right
 * design (a browser that throws on `window.localStorage` throws every time)
 * and means a test that swaps the backend after import measures the previous
 * test's probe. `vi.resetModules()` plus a dynamic import is what makes each
 * case independent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MissionRecord } from '@/core/types'

type Persist = typeof import('@/lib/persist')

/** Load a fresh copy of the module against whatever storage is installed. */
async function freshPersist(): Promise<Persist> {
  vi.resetModules()
  return import('@/lib/persist')
}

/** The real descriptor, so each test can put jsdom's storage back. */
const realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')

function installThrowingStorage(message = 'denied'): void {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException(message, 'SecurityError')
    },
  })
}

/** A storage object that exists and refuses to write — the quota case. */
function installFullStorage(): void {
  const backing = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
      key: () => null,
      length: 0,
    },
  })
}

afterEach(() => {
  if (realStorage) Object.defineProperty(window, 'localStorage', realStorage)
  vi.restoreAllMocks()
})

describe('persist under a working backend', () => {
  beforeEach(() => {
    if (realStorage) Object.defineProperty(window, 'localStorage', realStorage)
    window.localStorage.clear()
  })

  it('round-trips a value and reports persistence available', async () => {
    const p = await freshPersist()
    expect(p.isPersistenceAvailable()).toBe(true)
    expect(p.writeJson('k', { a: 1 })).toBe(true)
    expect(p.readJson('k', null)).toEqual({ a: 1 })
  })

  it('returns the fallback for a missing key rather than null', async () => {
    const p = await freshPersist()
    expect(p.readJson('absent', 'fallback')).toBe('fallback')
  })

  it('discards a value written under a different schema version', async () => {
    const p = await freshPersist()
    // What an older build left behind. Guessing at its shape is how a stale
    // record crashes a view, so it must be dropped rather than coerced.
    window.localStorage.setItem('k', JSON.stringify({ v: 0, data: { a: 1 } }))
    expect(p.readJson('k', 'fallback')).toBe('fallback')
  })

  it('discards unparseable JSON', async () => {
    const p = await freshPersist()
    window.localStorage.setItem('k', '{not json')
    expect(p.readJson('k', 'fallback')).toBe('fallback')
  })

  it('discards a bare value stored without the envelope', async () => {
    const p = await freshPersist()
    window.localStorage.setItem('k', '"just a string"')
    expect(p.readJson('k', 'fallback')).toBe('fallback')
  })
})

describe('persist when localStorage throws on access', () => {
  beforeEach(() => installThrowingStorage())

  it('reports persistence unavailable instead of propagating', async () => {
    const p = await freshPersist()
    expect(p.isPersistenceAvailable()).toBe(false)
  })

  it('reads return the fallback and writes report failure, never throw', async () => {
    const p = await freshPersist()
    expect(() => p.readJson('k', 'fallback')).not.toThrow()
    expect(p.readJson('k', 'fallback')).toBe('fallback')
    expect(p.writeJson('k', { a: 1 })).toBe(false)
    expect(p.removeKey('k')).toBe(false)
  })
})

describe('persist when the quota is full', () => {
  beforeEach(() => installFullStorage())

  it('a failed write is reported rather than thrown', async () => {
    const p = await freshPersist()
    // The probe itself writes, so a storage that refuses every write reads as
    // unavailable. That is the honest answer: nothing this app saves would
    // survive.
    expect(p.isPersistenceAvailable()).toBe(false)
    expect(p.writeJson('k', { a: 1 })).toBe(false)
  })
})

describe('the store on top of hostile storage', () => {
  /**
   * The store calls `loadSavedMissions()` at construction. A record that is
   * missing the fields the views read must be dropped there rather than
   * reaching `MissionList`, which would otherwise throw on
   * `record.metrics.waypointsReached`.
   */
  function seed(rows: unknown): void {
    if (realStorage) Object.defineProperty(window, 'localStorage', realStorage)
    window.localStorage.clear()
    window.localStorage.setItem('selene.missions', JSON.stringify({ v: 1, data: rows }))
  }

  it('drops records missing config or metrics and keeps the sound ones', async () => {
    const sound = {
      version: 1,
      missionId: 'ok-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      config: { scenarioId: 'baseline-traverse' },
      resolutions: [],
      outcome: 'complete',
      metrics: { waypointsReached: 1, waypointsTotal: 1 },
      events: [],
      decisions: [],
    } as unknown as MissionRecord

    seed([
      { missionId: 'no-metrics', config: {} },
      { missionId: 'no-config', metrics: {} },
      { config: {}, metrics: {} }, // no id
      null,
      'not-an-object',
      sound,
    ])

    vi.resetModules()
    const { useMissionStore } = await import('@/state/missionStore')
    const missions = useMissionStore.getState().missions

    expect(missions).toHaveLength(1)
    expect(missions[0]!.missionId).toBe('ok-1')
  })

  it('a non-array payload loads as an empty list', async () => {
    seed({ not: 'an array' })
    vi.resetModules()
    const { useMissionStore } = await import('@/state/missionStore')
    expect(useMissionStore.getState().missions).toEqual([])
  })

  it('constructing the store with storage that throws does not throw', async () => {
    installThrowingStorage()
    vi.resetModules()
    const { useMissionStore } = await import('@/state/missionStore')
    const state = useMissionStore.getState()

    expect(state.missions).toEqual([])
    expect(state.persistenceAvailable).toBe(false)
    // Layer preferences fall back to the defaults rather than to undefined,
    // which would read as "every layer off".
    expect(state.renderOptions.showElevation).toBe(true)
    // And writing a preference is a no-op rather than an exception out of a
    // click handler.
    expect(() => state.setRenderOption('showSlope', true)).not.toThrow()
    expect(useMissionStore.getState().renderOptions.showSlope).toBe(true)
  })
})
