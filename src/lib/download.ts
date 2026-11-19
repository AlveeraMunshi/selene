/**
 * Browser file download.
 *
 * Lives at the app edge because it touches the DOM and `URL.createObjectURL`,
 * neither of which may appear in core/. The object URL is revoked on the next
 * frame rather than synchronously: revoking before the click has been
 * processed cancels the download in some browsers.
 */

export function downloadJson(filename: string, value: unknown): void {
  let blob: Blob
  try {
    blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  } catch {
    // A record that will not serialise is a contract violation upstream, but it
    // must not throw out of a click handler and blank the app.
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

/** Safe-ish filename fragment: a mission id or scenario name in a path. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
