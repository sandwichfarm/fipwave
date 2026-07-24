import { describe, expect, it, vi } from 'vitest';

import { resolveDemoConfig } from '../src/demo-config.js';
import { createProofController } from '../src/proof-controller.js';

const now = 1_700_000_000_000;
const peer = { npub: resolveDemoConfig('a').peer.publicKey, connectivity: 'connected', link_id: 1, transport_type: 'sound', authenticated_at_ms: now, last_seen_ms: now };
const link = { link_id: 1, transport_id: 2, state: 'active', created_at_ms: now, stats: { packets_sent: 0, packets_recv: 0, bytes_sent: 0, bytes_recv: 0, last_recv_ms: now } };
const transport = { transport_id: 2, type: 'sound', state: 'active', mtu: 1357, stats: { worker_up: true, acoustic_ready: true, epoch: 7 } };

describe('proof controller', () => {
  it('runs only the pinned one-packet in-namespace ping after every fresh gate agrees', async () => {
    const query = vi.fn(async (kind: 'peers' | 'links' | 'transports') => kind === 'peers' ? { peers: [peer] } : kind === 'links' ? { links: [link] } : { transports: [transport] });
    const execFile = vi.fn(async () => ({ exitCode: 0, stdout: '1 packets transmitted, 1 received, 0% packet loss\nrtt min/avg/max = 1.000/1.000/1.000 ms', stderr: '' }));
    const controller = createProofController({ config: resolveDemoConfig('a'), control: { query }, acousticStatus: () => ({ epoch: 7, ready: true, observedAtMs: now }), isolation: async () => ({ accepted: true, epoch: 7, observedAtMs: now, targetIpv6: 'fd00::2' }), now: () => now, execFile });

    await expect(controller.ping()).resolves.toMatchObject({ evidenceClass: 'Fixture', pingReady: true, result: { exitCode: 0 } });
    expect(execFile).toHaveBeenCalledWith('/usr/bin/ping', ['-6', '-n', '-c', '1', '-W', '15', 'fd00::2'], expect.objectContaining({ timeout: 20_000, maxBuffer: 65_536 }));
  });

  it.each([
    ['wrong acoustic epoch', { epoch: 6, ready: true, observedAtMs: now }, { epoch: 7, accepted: true, observedAtMs: now, targetIpv6: 'fd00::2' }],
    ['failed isolation', { epoch: 7, ready: true, observedAtMs: now }, { epoch: 7, accepted: false, observedAtMs: now, targetIpv6: 'fd00::2' }],
  ])('fails closed and never launches ping for %s', async (_name, acousticStatus, isolation) => {
    const execFile = vi.fn();
    const controller = createProofController({ config: resolveDemoConfig('a'), control: { query: async (kind: 'peers' | 'links' | 'transports') => kind === 'peers' ? { peers: [peer] } : kind === 'links' ? { links: [link] } : { transports: [transport] } }, acousticStatus: () => acousticStatus, isolation: async () => isolation, now: () => now, execFile });
    await expect(controller.ping()).resolves.toMatchObject({ pingReady: false, reason: expect.any(String), evidenceClass: 'human_needed' });
    expect(execFile).not.toHaveBeenCalled();
  });
});
