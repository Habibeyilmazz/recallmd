import { defineConfig } from 'playwright/test';

// End-to-end tests run against the production build (so the service worker is real).
// Build first: npm run build && npm run e2e
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4131', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview', url: 'http://localhost:4131', reuseExistingServer: !process.env.CI },
});
