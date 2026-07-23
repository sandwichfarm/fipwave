import { expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';

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
  await expect(page.getByText('Quiet armed · audible-7k-channel-0 · epoch 2')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Bridge delivery: Quiet audio settings accepted for epoch 2')).toBeVisible();
  expect([...assets]).toEqual(expect.arrayContaining([
    ['/codec-assets/quiet.js', 200],
    ['/codec-assets/libfec.js', 200],
    ['/codec-assets/quiet-emscripten.js', 200],
    ['/codec-assets/quiet-emscripten.js.mem', 200],
    ['/codec-assets/quiet-profiles.json', 200],
  ]));
  await expect(page.getByText('Passed independent receiver evidence')).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset / re-arm' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Bridge delivery: Audio settings accepted for epoch 3')).toBeVisible();
  await expect(page.getByText(/Local epoch: 3/)).toBeVisible();

  await page.getByRole('button', { name: 'Start Cyrinx qualification' }).click();
  await expect(page.getByText('Quiet armed · audible-7k-channel-0 · epoch 4')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Bridge delivery: Quiet audio settings accepted for epoch 4')).toBeVisible();
  await expect(page.getByText('Passed independent receiver evidence')).toHaveCount(0);
});
