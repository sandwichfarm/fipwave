import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { tmpdir } from 'node:os';

const missingCyrinxAssets = path.join(tmpdir(), `fipwave-e2e-missing-cyrinx-assets-${process.pid}`);
const requestedPort = Number(process.env.FIPWAVE_E2E_PORT ?? '4173');
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65_535) throw new Error('FIPWAVE_E2E_PORT must be a valid unprivileged TCP port');

export default defineConfig({
  testDir: './apps/modem-ui/e2e',
  testMatch: '**/{codec-assets,quiet-runtime}.spec.ts',
  webServer: {
    command: `npm run build && npm run start:runner -- --machine-id playwright --role A --port ${requestedPort} --report .artifacts/qualification/playwright.json --tun-evidence .artifacts/qualification/not-used.json --evidence-mode Loopback`,
    url: `http://127.0.0.1:${requestedPort}/qualification-config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, CYRINX_ASSET_DIR: missingCyrinxAssets },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } } }],
});
