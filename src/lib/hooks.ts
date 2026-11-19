/**
 * Small React hooks shared by the views.
 *
 * Kept out of the components that use them because each one has a subtlety —
 * a cleanup, a focus guard, a stale-closure trap — that is easy to get wrong
 * a second time if it is copied rather than imported.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * A stable callback that always sees the latest props.
 *
 * Needed by the keyboard and debounce hooks below: both register a long-lived
 * listener or timer, and a plain closure captured at registration time would
 * keep calling last render's handler against last render's state.
 */
export function useEventCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}

/**
 * Run `fn` after `delayMs` of quiet, cancelling any pending run.
 *
 * Used for the planner's live route preview: a slider drag fires dozens of
 * changes a second and each one would otherwise start an A* search.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const stable = useEventCallback(fn)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancel on unmount: a timer that fires into an unmounted tree is the
  // classic leak, and here it would also kick off a pointless search.
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  return useCallback(
    (...args: A) => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        stable(...args)
      }, delayMs)
    },
    [stable, delayMs],
  )
}

/** A keyboard shortcut: the bare key, plus whether it may repeat on hold. */
export interface Shortcut {
  /** `event.key`, matched case-insensitively. Use ' ' for space. */
  key: string
  run: () => void
  /** Held-down repeat is wanted for speed stepping, not for play/pause. */
  allowRepeat?: boolean
}

/**
 * True when the keystroke belongs to whatever the user is typing into.
 *
 * Without this, pressing space inside the mission-name box would pause the
 * mission and `r` would reset it mid-word. Checked against the event target
 * rather than `document.activeElement` so it is correct inside shadow roots
 * and during the brief moment focus is moving.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // A focused slider or button should still let space mean "activate the
  // control", not "pause the mission".
  const role = target.getAttribute('role')
  return role === 'slider' || role === 'textbox' || role === 'combobox'
}

export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true): void {
  const latest = useRef(shortcuts)
  useEffect(() => {
    latest.current = shortcuts
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Never shadow a browser or OS shortcut: cmd+R must still reload.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e.target)) return
      const hit = latest.current.find((s) => s.key.toLowerCase() === e.key.toLowerCase())
      if (!hit) return
      if (e.repeat && !hit.allowRepeat) return
      e.preventDefault()
      hit.run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/**
 * Subscribe to a media query.
 *
 * The mission view's three-column layout is primarily CSS, but two behaviours
 * genuinely differ rather than reflow — the decision inspector becomes a
 * stacked section instead of a side panel — and those need the boolean in JS.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  const get = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  }, [query])
  // Server snapshot is `false`: assume the wide layout, which is the one the
  // markup is written for, so hydration does not reshuffle the tree.
  return useSyncExternalStore(subscribe, get, () => false)
}

/** Observed CSS pixel size of an element, for sizing the canvas container. */
export function useElementSize<T extends HTMLElement>(): [
  (el: T | null) => void,
  { width: number; height: number },
] {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver | null>(null)

  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    if (typeof ResizeObserver === 'undefined') {
      setSize({ width: el.clientWidth, height: el.clientHeight })
      return
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const box = entry.contentRect
      setSize((prev) =>
        prev.width === box.width && prev.height === box.height
          ? prev
          : { width: box.width, height: box.height },
      )
    })
    ro.observe(el)
    observer.current = ro
    setSize({ width: el.clientWidth, height: el.clientHeight })
  }, [])

  useEffect(() => () => observer.current?.disconnect(), [])
  return [ref, size]
}
