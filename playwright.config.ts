import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/modem-ui/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/codec-assets.spec.ts',
  webServer: {
    command: 'vite --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
