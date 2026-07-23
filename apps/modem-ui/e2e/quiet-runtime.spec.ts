import { expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';

test('production Quiet page receives immutable runner identity and only loads the fixed audible profile assets', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(`${origin}/`);
  await expect(page.getByText('Machine: playwright · Role: A · Evidence: Loopback')).toBeVisible();
  await expect(page.getByText('Report target: .artifacts/qualification/playwright.json')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arm modem' })).toBeEnabled();
  expect(requests).toContain(`${origin}/qualification-config`);
  expect(await page.locator('select').count()).toBe(0);
  await expect(page.getByText('audible-7k-channel-0')).toHaveCount(0);
});
