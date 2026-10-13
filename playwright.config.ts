import { defineConfig } from '@playwright/test';

const remoteURL = process.env.PLAYWRIGHT_BASE_URL;
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome';
if (!['chrome', 'chromium'].includes(browserChannel)) {
  throw new Error('PLAYWRIGHT_BROWSER_CHANNEL must be chrome or chromium.');
}

export default defineConfig({
  testDir: 'tests',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    channel: browserChannel,
    baseURL: remoteURL || 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: remoteURL ? undefined : {
    command: 'npm start',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
  workers: 1,
});
