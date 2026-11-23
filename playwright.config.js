import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  testMatch: '**/*.browser.js',
  use: {
    browserName: 'chromium',
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  },
});