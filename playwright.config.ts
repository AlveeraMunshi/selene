import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : [['list']],
  use: {
    // The site is served from a project page, so the build carries a base of
    // /selene/ and the application sits under /app/ beneath it. Pointing
    // baseURL at the app means every spec can keep navigating to '/' and none
    // of them has to know where the site is mounted.
    baseURL: 'http://127.0.0.1:4173/selene/app/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // --host 127.0.0.1 is load-bearing, not decoration. `vite preview` binds
    // [::1] only by default, while `url` below probes 127.0.0.1, so the probe
    // never succeeds and the run dies after the full 180s timeout with a
    // message about the timeout rather than about the address. Locally
    // `reuseExistingServer` hides it whenever some correctly-bound server
    // happens to be up; CI sets that false, so it fails there every time.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort --host 127.0.0.1',
    // Probe the path the site is actually mounted at. The server 404s at the
    // origin root, which Playwright would accept as "up" while every test
    // then loaded a 404 page.
    url: 'http://127.0.0.1:4173/selene/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
