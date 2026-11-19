/**
 * Entry point.
 *
 * The theme import is first and is the only CSS import in the application:
 * every token the design system uses is declared there, so a component that
 * renders before it has loaded would flash unstyled.
 *
 * StrictMode is on deliberately, despite double-invoking effects in
 * development. The store's ticker and the renderer's rAF loop both have real
 * cleanup to get right, and StrictMode is what surfaces a missing one as a
 * doubled mission clock rather than as a slow leak nobody notices.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/theme.css'
import { App } from './App'
import { ErrorBoundary } from './views/shared/ErrorBoundary'

const container = document.getElementById('root')
if (!container) {
  throw new Error('No #root element: index.html and main.tsx disagree about the mount point.')
}

createRoot(container).render(
  <StrictMode>
    {/* An outer boundary so a throw in the shell itself -- above the
        per-view boundary -- still renders a message rather than a blank page. */}
    <ErrorBoundary label="Application shell">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
