import { defineConfig } from '@playwright/test'
import process from 'node:process'

export default defineConfig({
  testDir: './browser-tests',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1600, height: 1050 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
  },
})
