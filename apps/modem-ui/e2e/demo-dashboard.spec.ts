import { expect, test } from '@playwright/test';

async function loadDemo(page: import('@playwright/test').Page, role: 'A' | 'B') {
  await page.route('**/qualification-config', (route) => route.fulfill({
    json: {
      machineId: role === 'A' ? 'fipwave-a' : 'fipwave-b',
      role,
      reportTarget: '/tmp/report.json',
      tunEvidence: 'none',
      evidenceMode: 'Loopback',
      evidenceClass: 'Loopback',
      fipsNetwork: {
        localPublicKey: role === 'A' ? 'npub1localaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : 'npub1localbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        peerPublicKey: role === 'A' ? 'npub1peerbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : 'npub1peeraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        localIpv6: role === 'A' ? 'fd69:e08d:65cc:3a6b:9c2c:2ac4:bd40:5e4b' : 'fd46:f688:3bb:f389:e1df:f3e:3af3:9c30',
        peerIpv6: role === 'A' ? 'fd46:f688:3bb:f389:e1df:f3e:3af3:9c30' : 'fd69:e08d:65cc:3a6b:9c2c:2ac4:bd40:5e4b',
      },
    },
  }));
  await page.goto('http://127.0.0.1:5173/?demo=1');
}

test('default audience dashboard fits a 1366×768 laptop viewport without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await loadDemo(page, 'A');

  await expect(page.getByTestId('demo-dashboard')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Node A' })).toBeVisible();
  await expect(page.getByText('gateway · fipwave-a')).toBeVisible();
  await expect(page.getByText('Node B · acoustically isolated peer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Idle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start / Connect' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Debug' })).toBeVisible();
  const network = page.locator('.demo-network-details');
  await expect(network).toHaveCSS('filter', 'blur(6px)');
  await page.getByRole('button', { name: 'Reveal FIPS details' }).click();
  await expect(page.getByText(/^Peer npub: npub1peerb/)).toBeVisible();
  await expect(page.getByText('Peer IPv6: fd46:f688:3bb:f389:e1df:f3e:3af3:9c30')).toBeVisible();
  await expect(network).toHaveCSS('filter', 'none');
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
});

test('role B names the isolated node, its gateway peer, and truthful waiting state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadDemo(page, 'B');

  await expect(page.getByRole('heading', { name: 'Node B' })).toBeVisible();
  await expect(page.getByText('acoustically isolated node · fipwave-b')).toBeVisible();
  await expect(page.getByText('Node A · Wi-Fi gateway peer')).toBeVisible();
  await expect(page.getByText('Acoustic: Not started')).toBeVisible();
  await expect(page.getByText('FIPS: Waiting for acoustic readiness')).toBeVisible();
});

test('Debug mode retains the detailed qualification workflow', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/?debug=1');

  await expect(page.getByRole('heading', { name: 'Cyrinx qualification gate' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Corpus evidence' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Demo view' })).toBeVisible();
});
