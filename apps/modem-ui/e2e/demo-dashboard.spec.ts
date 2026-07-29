import { expect, test } from '@playwright/test';

const readyPeer = {
  peerReady: true,
  reason: 'ready',
};

async function loadDemo(page: import('@playwright/test').Page, role: 'A' | 'B') {
  await page.route('**/qualification-config', (route) => route.fulfill({
    json: {
      machineId: role === 'A' ? 'fipwave-a' : 'fipwave-b',
      peerMachineId: role === 'A' ? 'fipwave-b' : 'fipwave-a',
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
  await expect(page.getByTestId('image-transfer')).toHaveCount(0);
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
  await expect(page.getByTestId('image-transfer')).toHaveCount(0);
});

test('role A retains a manual fixed-image retry after a transient send failure', async ({ page }) => {
  let imagePosts = 0;
  await page.route('**/peer-status', (route) => route.fulfill({ json: readyPeer }));
  await page.route('**/image-transfer', (route) => {
    if (route.request().method() !== 'POST') {
      return route.fulfill({ json: { transferId: '0102030405060708', width: 96, height: 34, receivedRows: 34, complete: true, revision: 2, bands: [] } });
    }
    imagePosts += 1;
    return route.fulfill({
      status: imagePosts === 1 ? 409 : 202,
      json: imagePosts === 1 ? { error: 'peer_missing' } : { accepted: true, bands: 6 },
    });
  });
  await loadDemo(page, 'A');

  await expect(page.getByText('Image queued over the verified FIPS data path')).toBeVisible();
  await page.getByRole('button', { name: 'Retry image over FIPS' }).click();
  await expect(page.getByText('Image transfer failed — verify the current FIPS link and retry')).toBeVisible();
  await page.getByRole('button', { name: 'Retry image over FIPS' }).click();
  await expect.poll(() => imagePosts).toBe(2);
  await expect(page.getByText('Image queued over FIPS · 6 bands')).toBeVisible();
});

for (const role of ['A', 'B'] as const) {
  test(`role ${role} reveals its image surface in the stage only after the transfer actually starts`, async ({ page }) => {
    let imagePosts = 0;
    let transferStarted = false;
    await page.route('**/peer-status', (route) => route.fulfill({ json: readyPeer }));
    await page.route('**/image-transfer', (route) => {
      if (route.request().method() === 'POST') {
        imagePosts += 1;
        return route.fulfill({ json: { accepted: true, bands: 6 } });
      }
      if (!transferStarted) return route.fulfill({ json: { transferId: null, width: 0, height: 0, receivedRows: 0, complete: false, revision: 0, bands: [] } });
      return route.fulfill({
        json: role === 'A'
          ? { transferId: '0102030405060708', width: 96, height: 34, receivedRows: 34, complete: true, revision: 2, bands: [] }
          : { transferId: '0102030405060708', width: 1, height: 2, receivedRows: 1, complete: false, revision: 2, bands: [{ y: 0, rows: 1, rgbaBase64: 'AAAA/w==' }] },
      });
    });
    await loadDemo(page, role);

    await expect(page.getByTestId('image-transfer')).toHaveCount(0);
    transferStarted = true;
    const image = role === 'A' ? page.getByTestId('image-sender-preview') : page.getByTestId('image-receiver-canvas');
    await expect(image).toBeVisible();
    if (role === 'A') {
      await expect(page.getByRole('button', { name: 'Retry image over FIPS' })).toBeEnabled();
      expect(imagePosts).toBe(0);
    }
    else await expect(page.getByText('Loading over FIPS · 1/2 rows')).toBeVisible();
    const insideStage = await image.evaluate((node) => {
      const stage = document.querySelector<HTMLElement>('.demo-primary')!.getBoundingClientRect();
      const projection = node.getBoundingClientRect();
      return projection.left > stage.left + stage.width * 0.45 && projection.right <= stage.right && projection.bottom <= stage.bottom;
    });
    expect(insideStage).toBe(true);
  });
}

test('Debug mode retains the detailed qualification workflow', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/?debug=1');

  await expect(page.getByRole('heading', { name: 'Cyrinx qualification gate' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Corpus evidence' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Demo view' })).toBeVisible();
});
