# SELENE design system

A premium aerospace mission-control instrument, not a dashboard template.
Everything visual lives in two places and nowhere else:

| | |
|---|---|
| `src/styles/theme.css` | every token, as a CSS custom property in Tailwind v4's `@theme` |
| `src/ui/**` | the components, one per file |
| `src/ui/index.ts` | the public barrel — views import from here and never from a component file |
| `src/ui/Gallery.tsx` | every component, variant and state on one page: how the design gets reviewed |

`src/styles/theme.css` must be imported once, at the app entry
(`src/main.tsx`), before anything renders.

---

## The one rule: colour is semantic

| Token | Means | Used for |
|---|---|---|
| `accent` — ice cyan | **live** | current selection, live telemetry, the one primary action per region |
| `warn` — amber | **caution** | a risk the operator should look at |
| `danger` — desaturated red | **breach** | a limit crossed, a failure, a destructive action |
| `good` — green | **nominal** | within limits, succeeded, reached |
| `info` — periwinkle | **notice** | non-risk information. Deliberately neither cyan nor amber |

**Amber and red are reserved. They never decorate.** An amber pixel anywhere
on screen means the same thing as every other amber pixel — that is the only
reason a glance at the screen is worth anything mid-mission. A red divider, a
red hover state or an amber "new" badge destroys that property for every other
red and amber on the page.

Accent is used sparingly for the same reason in the other direction: if
everything is cyan, nothing is. Across the whole component set it appears
seven times.

---

## Tokens

### Surfaces — depth by value, never by shadow

| Token | Value | Use |
|---|---|---|
| `void` | `#070A0F` | the page; nothing sits behind it |
| `surface-0` | `#0B0F16` | app chrome: rails, headers, footers |
| `surface-1` | `#10151E` | panels |
| `surface-2` | `#161C27` | inputs, raised rows inside a panel |
| `surface-3` | `#1E2633` | hover / pressed |
| `line` | `rgb(255 255 255 / .07)` | hairline border |
| `line-strong` | `rgb(255 255 255 / .13)` | hairline on hover / emphasis |

Borders are low-alpha white rather than a hard grey, so an edge reads as a
line of light rather than a drawn rule.

### Ink

| Token | Value | Use |
|---|---|---|
| `ink` | `#E4ECF6` | values, headings |
| `ink-muted` | `#9FADC0` | body copy, secondary text |
| `ink-dim` | `#6A7A8E` | eyebrow labels, units, captions |
| `ink-faint` | `#475466` | disabled, rails, placeholder |

### Semantic

| Token | Base | Strong | Dim |
|---|---|---|---|
| `accent` | `#5CC8E8` | `#84DCF5` | `#2C7A90` |
| `good` | `#4FBE8C` | `#71D4A6` | `#27694B` |
| `warn` | `#E3A13F` | `#F2B862` | `#7A5620` |
| `danger` | `#D4636B` | `#E8838A` | `#75333A` |
| `info` | `#8B9FE8` | `#A8B8F2` | `#40497A` |

`accent-ink` (`#04161D`) is the only text colour permitted on a solid accent
fill.

### Type, geometry, motion

| Token | Value | Notes |
|---|---|---|
| `--font-sans` | Inter → system stack | all UI text |
| `--font-mono` | SF Mono / JetBrains Mono → system | all changing numerals |
| `--text-2xs` | `11px` | eyebrow labels, units, captions |
| `--radius-control` | `6px` | anything you can click |
| `--radius-panel` | `10px` | anything that contains things |
| `--radius-pill` | `999px` | meters, dots, the toggle track |
| `--spacing` | `0.25rem` | 4px base; every gap is a multiple |
| `--shadow-panel` | 1px inset highlight | not a drop shadow |
| `--shadow-pop` | soft, large | only for things that genuinely float |
| `--ease-instrument` | `cubic-bezier(.2,0,0,1)` | the only easing |
| `--duration-fast` / `--duration-base` | `120ms` / `170ms` | the only two durations |

There are exactly **two radii** in the system, plus the pill. Never introduce
a third, and never mix more than two on one element.

### Custom utilities

| Utility | Does |
|---|---|
| `num` | monospace + `tabular-nums` + `slashed-zero`. **Every changing numeral.** |
| `eyebrow` | 11px, uppercase, `.09em` tracking, `ink-dim`. Every field label. |
| `focus-ring` | 2px accent outline on `:focus-visible`, 2px offset |

---

## Rules a contributor must follow

1. **No hex values in a component.** If a colour is needed and no token fits,
   add the token to `theme.css` and justify it in the colour table above.
2. **Every changing numeral gets `num`.** Telemetry, costs, coordinates,
   timers, tick numbers, counts. With proportional figures a battery readout
   visibly twitches as digits change width and the eye cannot hold a reading.
   `Stat` and `KeyValue` default `mono` to `true`; pass `mono={false}` only
   for words.
3. **Class names are literal strings.** Tailwind scans source text, so
   `` `text-${tone}` `` produces no CSS at all. Tone classes live as full
   literal strings in `src/ui/tones.ts`, written out once.
4. **Merge classes with `cn`.** Never concatenate. `cn` is clsx + tailwind-merge,
   which is what makes a caller's `className` actually win over the
   component's own.
5. **Labels recede, values dominate.** Small uppercase tracked label, large
   quiet value. Never the reverse.
6. **One primary button per region.** A second one means the hierarchy has
   stopped being a hierarchy.
7. **Never fabricate telemetry to fill a space.** Use `EmptyState` and say what
   will appear here and what produces it.
8. **Keyboard first.** Native elements wherever one exists (`Slider` is a real
   `<input type=range>`, `Select` a real `<select>`, `Toggle` a `role="switch"`
   button). Focus is never removed without `focus-ring` replacing it.
9. **Motion is purposeful or absent.** Fade or travel a few pixels over
   120–170ms with `--ease-instrument`. **Numbers never animate** — a reader
   must not wait for a value, which is why `Meter` transitions its colour and
   snaps its width. Everything is disabled under `prefers-reduced-motion`.
10. **Banned outright:** neon glow, heavy gradients, glassmorphism,
    rounded-everything, emoji, decorative chrome, fake sci-fi reticles.
11. **The design system knows nothing about rovers.** It takes numbers,
    strings and tones; the views do the domain work. That line is what makes
    the Gallery a complete review of the system rather than of one screen.

---

## Components

| Component | For | Accessibility |
|---|---|---|
| `Button` | the four kinds of action: primary / secondary / ghost / danger | `aria-busy` while loading; width is constant because the spinner replaces the icon |
| `Panel` | the container everything lives in; owns its own scroll | `<section aria-labelledby>` when titled |
| `Slider` | a mission parameter | native range; `<label for>`; `aria-valuetext` carries the *formatted* value |
| `Stat` | one telemetry reading | `num` by default |
| `Meter` | a level within a known range | `role="meter"` + `aria-valuenow/min/max`; clamps out-of-range input |
| `Badge` | a one-word state | never interactive, no hover |
| `Tabs` | switch which inspector shows | `role="tablist"/"tab"`, `aria-selected`, roving tabindex, ←/→/Home/End with wrap |
| `Toggle` | a binary setting that applies now | `role="switch"` + `aria-checked`; whole row is the hit target |
| `Select` | one of a short known list | native `<select>`, skin only |
| `EmptyState` | honest absence | quiet: dim text, no accent |
| `Spinner` | work in progress | `role="status" aria-live="polite"` |
| `Field` | label a control that cannot label itself | `role="group" aria-labelledby` — never a `<label for>` pointing at an id it cannot know |
| `KeyValue` | the facts behind a decision | real `<dl>/<dt>/<dd>` |
| `Timeline` | the decision and event log | rows are `<button>` **only** when they have an `onClick`, so 200 inert events stay out of the tab order |

`Tabs` deliberately does **not** set `aria-controls`, because it does not own
the panel it switches and a dangling reference is worse than an omitted
optional attribute. Give your panel `role="tabpanel"` and
``aria-labelledby={`selene-tab-${active}`}``.
