import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/modem-ui/e2e',
  testMatch: '**/codec-assets.spec.ts',
  webServer: {
    command: 'npm run build && npm run start:runner -- --machine-id playwright --role A --port 4173 --report .artifacts/qualification/playwright.json --tun-evidence .artifacts/qualification/not-used.json --evidence-mode Loopback',
    url: 'http://127.0.0.1:4173/qualification-config',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
