/**
 * Identity and wall-clock, both of which core/ is forbidden to touch.
 *
 * `MissionRecord.createdAt` is documented as the only wall-clock value in the
 * system and `toRecord()` takes it as an argument precisely so that the engine
 * stays deterministic. This module is the single place that argument is
 * produced, so there is one answer to "where did the timestamp come from".
 */

export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * `crypto.randomUUID` is unavailable on insecure origins and in some test
 * environments, so the fallback is a timestamp plus entropy. Mission ids are
 * local keys, not security tokens; collision resistance within one browser
 * profile is the whole requirement.
 */
export function newMissionId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `m-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}
