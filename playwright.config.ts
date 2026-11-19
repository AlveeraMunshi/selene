import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
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
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
