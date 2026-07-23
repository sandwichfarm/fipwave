import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/modem-ui/e2e',
  testMatch: '**/*.spec.ts',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
