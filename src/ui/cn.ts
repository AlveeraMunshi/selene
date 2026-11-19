/**
 * `cn` — the one place class strings are merged.
 *
 * WHY: every component here takes a `className` so a caller can override its
 * spacing or colour. Plain concatenation leaves both the component's class and
 * the caller's in the string and the winner is whichever Tailwind emitted
 * last — which is a property of the build, not of the call site. `twMerge`
 * resolves conflicts by utility group so the caller always wins, and `clsx`
 * handles the conditional forms. Components never build class names any other
 * way.
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export type { ClassValue }
