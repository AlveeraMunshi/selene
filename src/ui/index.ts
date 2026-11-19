/**
 * The SELENE design system, public surface.
 *
 * WHY A BARREL: every view imports from `@/ui` and nothing imports a
 * component file directly. That is what lets a component be split, renamed or
 * re-implemented without touching a single view, and it is the reason the
 * names below are a frozen contract — Agent E codes against this list.
 *
 * Nothing in here knows anything about rovers, terrain or planning. The
 * design system takes numbers, strings and tones; the views do the domain
 * work. Keeping that line sharp is what makes the Gallery a complete review
 * of the system rather than a review of one screen.
 */

export { cn } from './cn'
export type { ClassValue } from './cn'

export { Badge } from './Badge'
export type { BadgeProps } from './Badge'

export { Button } from './Button'
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button'

export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { Field } from './Field'
export type { FieldProps } from './Field'

export { KeyValue } from './KeyValue'
export type { KeyValueProps, KeyValueRow } from './KeyValue'

export { Meter } from './Meter'
export type { MeterProps } from './Meter'

export { Panel } from './Panel'
export type { PanelProps } from './Panel'

export { Select } from './Select'
export type { SelectOption, SelectProps } from './Select'

export { Slider } from './Slider'
export type { SliderMark, SliderProps } from './Slider'

export { Spinner } from './Spinner'
export type { SpinnerProps } from './Spinner'

export { Stat } from './Stat'
export type { StatProps } from './Stat'

export { Tabs } from './Tabs'
export type { TabItem, TabsProps } from './Tabs'

export { Timeline } from './Timeline'
export type { TimelineItem, TimelineProps } from './Timeline'

export { Toggle } from './Toggle'
export type { ToggleProps } from './Toggle'

/** Semantic tone, shared by every component that takes a `tone` prop. */
export { toneBorder, toneChip, toneFill, toneText } from './tones'
export type { Tone, ToneExtended } from './tones'

/** The living specimen sheet. Mount it on a route to review the system. */
export { Gallery } from './Gallery'
