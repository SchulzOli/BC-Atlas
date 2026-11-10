import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { STATE_PATH, config } from './helpers/env';

const viewport = { width: 1600, height: 900 };

/**
 * Sign-in is NOT a Playwright project: run `npm run login` once (headed, manual sign-in),
 * which writes .auth/state.json. Every test run reuses that storage state.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The whole recording flow runs in ONE test so that it ends up in ONE video.
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: config.baseUrl,
    storageState: fs.existsSync(STATE_PATH) ? STATE_PATH : undefined,
    viewport,
    video: { mode: 'on', size: viewport },
    screenshot: 'on',
    trace: 'on',
    acceptDownloads: true,
    locale: 'en-US',
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
    launchOptions: { slowMo: config.slowMo },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport },
    },
  ],
});
