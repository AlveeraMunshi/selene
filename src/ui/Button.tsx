/**
 * Button — the only clickable affordance in the system.
 *
 * WHY FOUR VARIANTS AND NO MORE: a mission-control screen has exactly four
 * kinds of action. The one the operator is meant to take (primary, and there
 * is at most one per panel), the ones they may take (secondary), the ones
 * that are merely available and should not compete for attention (ghost), and
 * the one that destroys something (danger). A fifth variant would mean the
 * hierarchy had stopped being a hierarchy.
 *
 * `danger` is a tinted outline rather than a solid red slab on purpose. Solid
 * red is the loudest thing this palette can produce and it is reserved for a
 * live hazard reading; a button that aborts a mission should be unmistakable
 * without out-shouting the telemetry that tells you whether to press it.
 */
import type { ComponentPropsWithRef, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon. Decorative — the label carries the meaning. */
  icon?: LucideIcon
  /** Shows a spinner and blocks interaction without changing the layout. */
  loading?: boolean
  /** Stretch to the width of the container. */
  full?: boolean
  children?: ReactNode
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink border-transparent hover:bg-accent-strong active:bg-accent ' +
    'disabled:bg-accent/30 disabled:text-accent-ink/60',
  secondary:
    'bg-surface-2 text-ink border-line hover:bg-surface-3 hover:border-line-strong ' +
    'active:bg-surface-2',
  ghost:
    'bg-transparent text-ink-muted border-transparent hover:bg-surface-2 hover:text-ink ' +
    'active:bg-surface-1',
  danger:
    'bg-danger/10 text-danger-strong border-danger/35 hover:bg-danger/18 ' +
    'hover:border-danger/55 active:bg-danger/12',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-2xs gap-1.5',
  md: 'h-8 px-3 text-[0.8125rem] gap-2',
  lg: 'h-10 px-4 text-sm gap-2',
}

const ICON_PX: Record<ButtonSize, number> = { sm: 13, md: 14, lg: 16 }

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  full = false,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'focus-ring inline-flex shrink-0 select-none items-center justify-center',
        'rounded-control border font-medium whitespace-nowrap',
        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-instrument)]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT[variant],
        SIZE[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {/* The spinner replaces the icon rather than being appended, so the
          button never changes width while it is working. */}
      {loading ? (
        <Spinner size={ICON_PX[size]} label="Working" labelHidden />
      ) : Icon ? (
        <Icon size={ICON_PX[size]} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      ) : null}
      {children}
    </button>
  )
}
