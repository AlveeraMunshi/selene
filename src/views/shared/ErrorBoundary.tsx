/**
 * Error boundary for the app shell.
 *
 * WHY: a throw anywhere in the render tree unmounts the whole app and leaves a
 * white page, which on a simulation tool is indistinguishable from a hang. A
 * readable panel that names the error and offers a reset is the difference
 * between "it broke" and a bug report.
 *
 * Still a class component because React has no hook equivalent; `getDerivedStateFromError`
 * and `componentDidCatch` have no functional form.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown above the error; identifies which region failed. */
  label?: string
  /** Called when the user asks to recover, e.g. to reset the store. */
  onReset?: () => void
}

interface State {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only sink available here; swallowing the stack would
    // make the panel below the ONLY record of what happened.
    console.error('[SELENE] render error', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  private handleReset = (): void => {
    this.setState({ error: null, componentStack: null })
    this.props.onReset?.()
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        className="m-4 max-w-3xl rounded-lg border border-red-500/40 bg-red-500/5 p-6 text-sm"
      >
        <p className="text-xs font-medium uppercase tracking-wider text-red-400">
          {this.props.label ?? 'Application error'}
        </p>
        <h2 className="mt-2 text-lg font-semibold text-neutral-100">
          Something in this view threw while rendering.
        </h2>
        <p className="mt-2 text-neutral-400">
          The simulation state is unchanged. Resetting re-mounts this view; if it throws again the
          message below is the thing to report.
        </p>
        <pre className="mt-4 max-h-48 overflow-auto rounded bg-black/40 p-3 text-xs text-red-300">
          {error.message}
          {componentStack ? `\n${componentStack}` : ''}
        </pre>
        <button
          type="button"
          onClick={this.handleReset}
          className="mt-4 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          Try again
        </button>
      </div>
    )
  }
}
