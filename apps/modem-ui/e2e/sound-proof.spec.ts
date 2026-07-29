import { expect, test } from '@playwright/test';

const readyProof = (result: unknown = undefined) => ({
  pingReady: true, reason: 'ready', evidenceClass: 'Fixture',
  join: {
    pingReady: true, reason: 'ready',
    peer: { npub: 'npub1soundpeer', connectivity: 'connected', link_id: 7, transport_type: 'sound', authenticated_at_ms: 1, last_seen_ms: 1 },
    link: { link_id: 7, transport_id: 3, state: 'active', created_at_ms: 1, stats: {} },
    transport: { transport_id: 3, type: 'sound', state: 'active', mtu: 1357, stats: { worker_up: true, acoustic_ready: true, epoch: 4, complete_tx: 2, complete_rx: 1, retries: 0 } },
  },
  ...(result === undefined ? {} : { result }),
});

async function configureProofPage(page: import('@playwright/test').Page, role: 'A' | 'B') {
  await page.route('**/qualification-config', (route) => route.fulfill({ json: { machineId: role === 'A' ? 'fipwave-a' : 'fipwave-b', peerMachineId: role === 'A' ? 'fipwave-b' : 'fipwave-a', role, reportTarget: '/tmp/report.json', tunEvidence: 'none', evidenceMode: 'Loopback', evidenceClass: 'Loopback' } }));
  await page.goto('http://127.0.0.1:5173/?debug=1');
}

test('Role A renders bounded proof facts, gates ping, and posts the exact ping request', async ({ page }) => {
  let current: unknown = { pingReady: false, reason: 'peer_missing', evidenceClass: 'human_needed', join: { pingReady: false, reason: 'peer_missing' } };
  let pingBody = '';
  await page.route('**/proof-status', (route) => route.fulfill({ json: current }));
  await page.route('**/proof-ping', async (route) => { pingBody = route.request().postData() ?? ''; await route.fulfill({ json: readyProof({ exitCode: 0, sequence: 1, latencyMs: 3.2, lossPercent: 0, safeReason: null }) }); });
  await configureProofPage(page, 'A');

  const card = page.getByRole('heading', { name: 'FIPS proof status' }).locator('..');
  await page.getByRole('button', { name: 'Refresh proof status' }).click();
  await expect(card.getByText('Evidence class', { exact: true })).toBeVisible();
  await expect(card.getByText('Waiting for authenticated Sound peer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run sound-only ping' })).toBeDisabled();

  current = readyProof();
  await page.getByRole('button', { name: 'Refresh proof status' }).click();
  const run = page.getByRole('button', { name: 'Run sound-only ping' });
  await expect(run).toBeEnabled();
  await run.click();
  expect(pingBody).toBe('{}');
  await expect(card.getByRole('status')).toHaveText('ICMPv6 reply observed. Physical Open-air proof is still required.');
  await expect(card.getByText('Open-air ICMPv6 reply observed across the authenticated Sound link.')).toHaveCount(0);
});

test('Role B remains an observer and proof rows wrap without page overflow', async ({ page }) => {
  await page.route('**/proof-status', (route) => route.fulfill({ json: readyProof() }));
  await page.setViewportSize({ width: 320, height: 720 });
  await configureProofPage(page, 'B');
  await page.getByRole('button', { name: 'Refresh proof status' }).click();
  await expect(page.getByText('Role B is the acoustically isolated node. The proof ping is issued from Role A.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run sound-only ping' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
