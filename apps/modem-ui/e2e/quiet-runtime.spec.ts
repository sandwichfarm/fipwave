import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const requestedPort = Number(process.env.FIPWAVE_E2E_PORT ?? '4173');
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65_535) throw new Error('FIPWAVE_E2E_PORT must be a valid unprivileged TCP port');
const origin = `http://127.0.0.1:${requestedPort}`;
const reportPath = path.resolve('.artifacts/qualification/playwright.json');

async function canonicalFallback() {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as { qualification: { deadline: { startedAtMs: number; deadlineAtMs: number } } } & Record<string, unknown>;
  expect(report).toMatchObject({
    evidenceClass: 'Loopback', complete: false,
    codec: { id: 'quiet', profile: 'audible-7k-channel-0', advertisedMtu: 1357 },
    qualification: { physicalGate: 'not_physical', fallback: { codecId: 'quiet', state: 'activated', reasonCode: 'cyrinx_build_failed' } },
  });
  expect(report.qualification.deadline.deadlineAtMs - report.qualification.deadline.startedAtMs).toBe(5_400_000);
  return report;
}

test('production Quiet route performs verified RESET, arm, teardown, and re-arm without claiming acoustic success', async ({ page }) => {
  const assets = new Map<string, number>();
  page.on('response', (response) => {
    if (response.url().includes('/codec-assets/')) assets.set(new URL(response.url()).pathname, response.status());
  });
  await page.goto(`${origin}/`);
  await expect(page.getByText('Machine: playwright · Role: A · Evidence: Loopback')).toBeVisible();
  await expect(page.getByText('Report target: .artifacts/qualification/playwright.json')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arm modem' })).toBeEnabled();
  expect(await page.locator('select').count()).toBe(0);
  await expect(page.getByText('audible-7k-channel-0')).toHaveCount(0);

  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible();
  await expect(page.getByText('Bridge delivery: Audio settings accepted for epoch 1')).toBeVisible();
  await expect(page.getByRole('row', { name: 'Input-device sample rate 44100' })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Input-device channels 2' })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Codec capture PCM channels 1' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '48000', exact: true })).toHaveCount(2);

  await page.getByRole('button', { name: 'Start Cyrinx qualification' }).click();
  await expect(page.getByText('Quiet armed and listening · audible-7k-channel-0 · send A → B when the operator is ready · epoch 2')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Bridge delivery: Quiet audio settings accepted for epoch 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Quiet A → B corpus' })).toBeEnabled();
  expect([...assets]).toEqual(expect.arrayContaining([
    ['/codec-assets/quiet.js', 200],
    ['/codec-assets/libfec.js', 200],
    ['/codec-assets/quiet-emscripten.js', 200],
    ['/codec-assets/quiet-emscripten.js.mem', 200],
    ['/codec-assets/quiet-profiles.json', 200],
  ]));
  await expect(page.getByText('Passed independent receiver evidence')).toHaveCount(0);

  const firstReport = await canonicalFallback();

  await page.getByRole('button', { name: 'Reset and reconnect' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible({ timeout: 30_000 });
  // Quiet is already runner-selected, so the intermediate reset/arm epoch may
  // advance immediately to its Quiet-owned epoch before the DOM can render it.
  await expect(page.getByText('Quiet armed and listening · audible-7k-channel-0 · send A → B when the operator is ready · epoch 4')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Bridge delivery: Quiet audio settings accepted for epoch 4')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Quiet A → B corpus' })).toBeEnabled();
  await expect(page.getByText(/Local epoch: 4/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Cyrinx qualification' })).toHaveCount(0);
  await expect(page.getByText('Passed independent receiver evidence')).toHaveCount(0);
  const secondReport = await canonicalFallback();
  expect(secondReport.qualification.deadline).toEqual(firstReport.qualification.deadline);
});
