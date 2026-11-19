/**
 * Failure-tolerant localStorage.
 *
 * WHY EVERY CALL IS WRAPPED: `localStorage` throws rather than returning null
 * in three situations this app will really meet — Safari private browsing
 * (access throws on read), a full origin quota (write throws QuotaExceeded),
 * and an embedded context with storage blocked (the property access itself
 * throws). Saved missions are a convenience; losing them must never take the
 * running mission down with them, so nothing in here can propagate.
 */

/** Bumped when the stored shape changes; a mismatch discards rather than migrates. */
const SCHEMA_VERSION = 1

interface Envelope<T> {
  v: number
  data: T
}

/**
 * Probe once rather than per call. A browser that throws on `window.localStorage`
 * throws every time, and catching it on every keystroke is needless.
 */
let backend: Storage | null | undefined

function storage(): Storage | null {
  if (backend !== undefined) return backend
  try {
    const s = window.localStorage
    // A getter that exists can still throw on use; prove it round-trips.
    const probe = '__selene_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    backend = s
  } catch {
    backend = null
  }
  return backend
}

/** True when persistence is unavailable, so the UI can say so honestly. */
export function isPersistenceAvailable(): boolean {
  return storage() !== null
}

export function readJson<T>(key: string, fallback: T): T {
  const s = storage()
  if (!s) return fallback
  try {
    const raw = s.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as Envelope<T>
    // An envelope from a previous schema is discarded, not coerced: guessing at
    // the shape of old data is how a stale record crashes a view.
    if (!parsed || typeof parsed !== 'object' || parsed.v !== SCHEMA_VERSION) return fallback
    return parsed.data
  } catch {
    return fallback
  }
}

/** Returns false when the write did not happen, so callers can warn instead of lying. */
export function writeJson<T>(key: string, data: T): boolean {
  const s = storage()
  if (!s) return false
  try {
    const envelope: Envelope<T> = { v: SCHEMA_VERSION, data }
    s.setItem(key, JSON.stringify(envelope))
    return true
  } catch {
    return false
  }
}

export function removeKey(key: string): boolean {
  const s = storage()
  if (!s) return false
  try {
    s.removeItem(key)
    return true
  } catch {
    return false
  }
}

export const STORAGE_KEYS = {
  missions: 'selene.missions',
  renderOptions: 'selene.renderOptions',
} as const
