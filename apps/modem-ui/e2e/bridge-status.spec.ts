import { expect, test } from '@playwright/test';

test('renders the local-only bridge transport definition list and recovery consequence', async ({ page }) => {
  await page.route('**/qualification-config', (route) => route.fulfill({ json: { machineId: 'fipwave-a', role: 'A', reportTarget: '/tmp/report.json', tunEvidence: 'none', evidenceMode: 'Loopback', evidenceClass: 'Loopback' } }));
  await page.goto('http://127.0.0.1:5173/');

  const card = page.getByRole('heading', { name: 'Bridge and FIPS transport' }).locator('..');
  await expect(card).toBeVisible();
  await expect(card.locator('dl')).toBeVisible();
  for (const label of ['Configuration', 'Browser audio', 'Local bridge', 'FIPS sound transport', 'Epoch', 'Queue health', 'Last accepted/error', 'Complete packets TX/RX', 'Sound MTU']) await expect(card.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText('No local bridge activity yet')).toBeVisible();
  await expect(page.getByText('Starts a new local epoch and clears unsent local bridge data.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset and reconnect' })).toBeVisible();
  await expect(page.getByText(/peer connected|ready for ping|sound link established/i)).toHaveCount(0);
});

test('keeps long safe content and diagnostic tables inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route('**/qualification-config', (route) => route.fulfill({ json: { machineId: 'fipwave-a', role: 'A', reportTarget: '/tmp/report.json', tunEvidence: 'none', evidenceMode: 'Loopback', evidenceClass: 'Loopback' } }));
  await page.goto('http://127.0.0.1:5173/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole('searchbox', { name: 'Filter corpus cases' })).toBeVisible();
});
