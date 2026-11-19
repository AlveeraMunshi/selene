import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/**
 * Two entry points, because the site serves two different things:
 *
 *   index.html      the landing page — static, its own type and colour system,
 *                   no React, no Tailwind. It is a marketing surface and is
 *                   deliberately not built out of the application's design
 *                   tokens, which exist to make dense telemetry legible rather
 *                   than to sell anything.
 *   app/index.html  the application itself.
 *
 * `base` is the repository name because the site is served from a project
 * page at <account>.github.io/<repo>/. Getting this wrong produces a blank
 * page with 404s on every asset and no error anywhere obvious, so it is
 * overridable from the environment for anyone serving it from a root domain.
 */
const base = process.env.SELENE_BASE ?? '/selene/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      input: {
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
} as never)
