/**
 * Landing page behaviour: two scroll reveals, both IntersectionObserver.
 *
 * Never a scroll listener. A `scroll` handler runs on every frame of every
 * wheel tick and each callback here reads layout, so the two together produce
 * a reflow per frame and a visibly janky page on a phone.
 */
import './landing.css'

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Heavy fade up as a block enters view. One observer for every target. */
function revealOnScroll() {
  const targets = document.querySelectorAll<HTMLElement>('.reveal')
  if (REDUCED) {
    targets.forEach((el) => el.classList.add('in'))
    return
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('in')
        io.unobserve(entry.target) // reveal is one way; stop paying for it
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.1 },
  )
  targets.forEach((el) => io.observe(el))
}

/**
 * The tagline section: each word warms from muted to full as it crosses the
 * trigger line, in reading order, rather than the block flipping at once.
 *
 * The words are wrapped here rather than in the markup so the HTML stays
 * readable and the copy stays editable as a sentence.
 */
function revealWordByWord() {
  const el = document.querySelector<HTMLElement>('[data-tagline]')
  if (!el) return

  const source = el.textContent ?? ''
  el.textContent = ''
  const words: HTMLElement[] = []
  for (const word of source.split(/\s+/).filter(Boolean)) {
    const span = document.createElement('span')
    span.className = 'w'
    span.textContent = word
    el.append(span, document.createTextNode(' '))
    words.push(span)
  }

  if (REDUCED) {
    words.forEach((w) => w.classList.add('on'))
    return
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const span = entry.target as HTMLElement
        // Stagger by reading order so the sentence warms left to right even
        // when a whole line crosses the trigger within one frame.
        const delay = words.indexOf(span) * 55
        window.setTimeout(() => span.classList.add('on'), delay)
        io.unobserve(span)
      }
    },
    { rootMargin: '0px 0px -30% 0px', threshold: 0.5 },
  )
  words.forEach((w) => io.observe(w))
}

/** Mark the section the reader is currently in, so the nav is never lying. */
function trackCurrentSection() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.nav-links a[href^="#"]')]
  if (links.length === 0) return
  const byId = new Map(links.map((a) => [a.getAttribute('href')!.slice(1), a]))
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const link = byId.get(entry.target.id)
        if (!link) continue
        link.setAttribute('aria-current', entry.isIntersecting ? 'true' : 'false')
        link.style.color = entry.isIntersecting ? 'var(--ink)' : ''
      }
    },
    { rootMargin: '-45% 0px -45% 0px' },
  )
  byId.forEach((_, id) => {
    const section = document.getElementById(id)
    if (section) io.observe(section)
  })
}

revealOnScroll()
revealWordByWord()
trackCurrentSection()
