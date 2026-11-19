/**
 * The error boundary, which is the one component whose job only happens when
 * something else has already gone wrong.
 *
 * PRODUCT_SPEC lists "Render context lost" among the states every screen
 * must handle, and names the treatment: "Error boundary with a readable
 * message and a reset." A boundary that renders but cannot recover, or that
 * swallows the stack, satisfies the first half and not the second -- so both
 * are asserted here.
 *
 * This is at component level rather than in `e2e/` deliberately: forcing a
 * real throw out of a view from Playwright would mean editing `src/` to add
 * a trigger, and a boundary tested through a trigger that only exists for
 * the test is a boundary tested against a fiction.
 */

import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ErrorBoundary } from '@/views/shared/ErrorBoundary'

/**
 * React logs every caught error to the console, and `componentDidCatch`
 * logs it again on purpose. Both are correct and both would otherwise bury
 * the test output in stack traces.
 */
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleError.mockRestore()
})

function Boom({ message = 'canvas context lost' }: { message?: string }): never {
  throw new Error(message)
}

/**
 * A child that throws while a flag is set and renders normally once it is
 * cleared.
 *
 * The flag lives OUTSIDE the component on purpose. Resetting the boundary
 * unmounts and remounts the child, so anything held in `useState` is back to
 * its initial value and the child throws for ever -- and React re-renders a
 * failing component an unspecified number of times in development, so a
 * counter is not deterministic either. A flag the TEST clears is both: it is
 * also the real shape of the fault this boundary exists for, since a lost
 * canvas context is a fact about the environment rather than about the
 * component instance.
 */
function makeFlakyChild(): { Child: () => ReactElement; recover: () => void } {
  let broken = true
  return {
    Child: function FlakyChild() {
      if (broken) throw new Error('transient render failure')
      return <p>recovered content</p>
    },
    recover: () => {
      broken = false
    },
  }
}

describe('ErrorBoundary', () => {
  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary label="planner view">
        <p>ordinary content</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('ordinary content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('catches a throwing child and names the region and the error', () => {
    render(
      <ErrorBoundary label="mission view">
        <Boom />
      </ErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('mission view')
    // The engine's own message, not a generic one. This is the difference
    // between "it broke" and a bug report.
    expect(alert).toHaveTextContent('canvas context lost')
    expect(alert).toHaveTextContent('Something in this view threw while rendering.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('says the simulation state is unchanged, because it is', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('The simulation state is unchanged')
  })

  it('keeps the stack rather than swallowing it', () => {
    render(
      <ErrorBoundary label="analysis view">
        <Boom message="unique-marker-9f2" />
      </ErrorBoundary>,
    )
    // The panel is the user's copy; the console is the only other sink, and
    // `componentDidCatch` writes to it on purpose.
    const calls = consoleError.mock.calls as unknown[][]
    const logged = calls.some((call) =>
      call.some((arg) => arg instanceof Error && arg.message === 'unique-marker-9f2'),
    )
    expect(logged, 'componentDidCatch should log the error it caught').toBe(true)
  })

  it('recovers when the operator asks it to, and calls back', async () => {
    const user = userEvent.setup()
    const onReset = vi.fn()
    const { Child, recover } = makeFlakyChild()

    render(
      <ErrorBoundary label="mission view" onReset={onReset}>
        <Child />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // Whatever broke has stopped being broken; the operator retries.
    recover()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('recovered content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a child that keeps throwing re-renders the panel rather than a blank page', async () => {
    const user = userEvent.setup()
    render(
      <ErrorBoundary label="mission view">
        <Boom message="still broken" />
      </ErrorBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('still broken')
  })
})
