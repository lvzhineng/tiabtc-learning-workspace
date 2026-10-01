import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  tsconfig: './tsconfig.json',
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3011', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', viewport: { width: 1600, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 3011 --strictPort',
    url: 'http://127.0.0.1:3011', reuseExistingServer: false,
    timeout: 30_000,
  },
});
