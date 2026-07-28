import { describe, expect, it, vi } from 'vitest';

import { resolveDemoConfig } from '../src/demo-config.js';
import { createProofController, projectPublicPeerExecution, projectPublicProofExecution } from '../src/proof-controller.js';

const now = 1_700_000_000_000;
const peer = { npub: resolveDemoConfig('a').peer.publicKey, connectivity: 'connected', link_id: 1, transport_type: 'sound', authenticated_at_ms: now, last_seen_ms: now };
const link = { link_id: 1, transport_id: 2, state: 'connected', created_at_ms: now, stats: { packets_sent: 0, packets_recv: 0, bytes_sent: 0, bytes_recv: 0, last_recv_ms: now } };
const transport = { transport_id: 2, type: 'sound', state: 'up', mtu: 1357, stats: { worker_up: true, acoustic_ready: true, epoch: 7 } };
type ControlQuery = 'peers' | 'links' | 'transports' | 'sessions';
const controlResult = (kind: ControlQuery) => (
  kind === 'peers'
    ? { peers: [peer] }
    : kind === 'links'
      ? { links: [link] }
      : kind === 'transports'
        ? { transports: [transport] }
        : { sessions: [] }
);

describe('proof controller', () => {
  it('reports an authenticated FIPS peer without waiting for isolation proof', async () => {
    const isolation = vi.fn(async () => ({ accepted: false, epoch: 7, observedAtMs: now, targetIpv6: 'fd00::2' }));
    const controller = createProofController({
      config: resolveDemoConfig('a'),
      targetIpv6: 'fd00::2',
      control: {
        query: async (kind: ControlQuery) => controlResult(kind),
      },
      acousticStatus: () => ({ epoch: 7, ready: true, observedAtMs: now }),
      isolation,
      now: () => now,
      execFile: vi.fn(),
    });

    const status = await controller.peerStatus();
    expect(status).toMatchObject({
      peerReady: true,
      reason: 'ready',
      join: {
        peerReady: true,
        peer,
        link,
        transport,
      },
    });
    expect(isolation).not.toHaveBeenCalled();
    expect(projectPublicPeerExecution(status)).toEqual({ peerReady: true, reason: 'ready' });
  });

  it('opens the peer gate before a send-path FIPS session exists', async () => {
    const isolation = vi.fn(async () => ({ accepted: false, epoch: 7, observedAtMs: now, targetIpv6: 'fd00::2' }));
    const query = vi.fn(async (kind: ControlQuery) => controlResult(kind));
    const controller = createProofController({
      config: resolveDemoConfig('a'),
      targetIpv6: 'fd00::2',
      control: { query },
      acousticStatus: () => ({ epoch: 7, ready: true, observedAtMs: now }),
      isolation,
      now: () => now,
      execFile: vi.fn(),
    });

    await expect(controller.peerStatus()).resolves.toMatchObject({
      peerReady: true,
      reason: 'ready',
    });
    expect(isolation).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalledWith('sessions');
  });

  it('does not start the slower isolation request while the peer table is still disconnected', async () => {
    const isolation = vi.fn(async () => ({ accepted: false, epoch: 7, observedAtMs: now, targetIpv6: 'fd00::2' }));
    const controller = createProofController({
      config: resolveDemoConfig('a'),
      targetIpv6: 'fd00::2',
      control: {
        query: async (kind: ControlQuery) => kind === 'peers' ? { peers: [] } : controlResult(kind),
      },
      acousticStatus: () => ({ epoch: 7, ready: true, observedAtMs: now }),
      isolation,
      now: () => now,
      execFile: vi.fn(),
    });

    await expect(controller.status()).resolves.toMatchObject({
      pingReady: false,
      reason: 'peer_missing',
    });
    expect(isolation).not.toHaveBeenCalled();
  });

  it('keeps authenticated peer facts when the later isolation gate is unavailable', async () => {
    const controller = createProofController({
      config: resolveDemoConfig('a'),
      targetIpv6: 'fd00::2',
      control: {
        query: async (kind: ControlQuery) => controlResult(kind),
      },
      acousticStatus: () => ({ epoch: 7, ready: true, observedAtMs: now }),
      isolation: async () => ({ accepted: false, epoch: 7, observedAtMs: now, targetIpv6: 'fd00::2' }),
      now: () => now,
      execFile: vi.fn(),
    });

    await expect(controller.status()).resolves.toMatchObject({
      pingReady: false,
      reason: 'isolation_failed',
      join: {
        pingReady: false,
        reason: 'isolation_failed',
        peer,
        link,
        transport,
      },
    });
  });

  it('refreshes peer authority after a slow successful isolation round trip', async () => {
    let current = now;
    const query = vi.fn(async (kind: ControlQuery) => controlResult(kind));
    const controller = createProofController({
      config: resolveDemoConfig('a'),
      targetIpv6: 'fd00::2',
      control: { query },
      acousticStatus: () => ({ epoch: 7, ready: true, observedAtMs: current }),
      isolation: async () => {
        current += 70_000;
        return { accepted: true, epoch: 7, observedAtMs: current, targetIpv6: 'fd00::2' };
      },
      now: () => current,
      execFile: vi.fn(),
    });

    await expect(controller.status()).resolves.toMatchObject({
      pingReady: true,
      reason: 'ready',
      evidenceClass: 'Fixture',
    });
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('coalesces concurrent slow proof refreshes into one isolation round trip', async () => {
    let releaseIsolation!: (value: { accepted: true; epoch: 7; observedAtMs: number; targetIpv6: string }) => void;
    const isolation = vi.fn(() => new Promise<{ accepted: true; epoch: 7; observedAtMs: number; targetIpv6: string }>((resolve) => {
      releaseIsolation = resolve;
    }));
    const query = vi.fn(async (kind: ControlQuery) => controlResult(kind));
    const controller = createProofController({
      config: resolveDemoConfig('a'),
      targetIpv6: 'fd00::2',
      control: { query },
      acousticStatus: () => ({ epoch: 7, ready: true, observedAtMs: now }),
      isolation,
      now: () => now,
      execFile: vi.fn(),
    });

    const first = controller.status();
    const second = controller.status();
    await vi.waitFor(() => expect(isolation).toHaveBeenCalledTimes(1));
    releaseIsolation({ accepted: true, epoch: 7, observedAtMs: now, targetIpv6: 'fd00::2' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ pingReady: true }),
      expect.objectContaining({ pingReady: true }),
    ]);
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('runs only the pinned one-packet in-namespace ping after every fresh gate agrees', async () => {
    const query = vi.fn(async (kind: ControlQuery) => controlResult(kind));
    const execFile = vi.fn(async () => ({ exitCode: 0, stdout: '1 packets transmitted, 1 received, 0% packet loss\nrtt min/avg/max = 1.000/1.000/1.000 ms', stderr: '' }));
    const controller = createProofController({ config: resolveDemoConfig('a'), targetIpv6: 'fd00::2', control: { query }, acousticStatus: () => ({ epoch: 7, ready: true, observedAtMs: now }), isolation: async () => ({ accepted: true, epoch: 7, observedAtMs: now, targetIpv6: 'fd00::2' }), now: () => now, execFile });

    await expect(controller.ping()).resolves.toMatchObject({ evidenceClass: 'Fixture', pingReady: true, result: { exitCode: 0 } });
    expect(execFile).toHaveBeenCalledWith('/usr/bin/ping', ['-6', '-n', '-c', '1', '-W', '15', 'fd00::2'], expect.objectContaining({ timeout: 20_000, maxBuffer: 65_536 }));
  });

  it.each([
    ['wrong acoustic epoch', { epoch: 6, ready: true, observedAtMs: now }, { epoch: 7, accepted: true, observedAtMs: now, targetIpv6: 'fd00::2' }],
    ['failed isolation', { epoch: 7, ready: true, observedAtMs: now }, { epoch: 7, accepted: false, observedAtMs: now, targetIpv6: 'fd00::2' }],
  ])('fails closed and never launches ping for %s', async (_name, acousticStatus, isolation) => {
    const execFile = vi.fn();
    const controller = createProofController({ config: resolveDemoConfig('a'), targetIpv6: 'fd00::2', control: { query: async (kind: ControlQuery) => controlResult(kind) }, acousticStatus: () => acousticStatus, isolation: async () => isolation, now: () => now, execFile });
    await expect(controller.ping()).resolves.toMatchObject({ pingReady: false, reason: expect.any(String), evidenceClass: 'human_needed' });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('keeps raw process output out of the browser-facing proof projection', async () => {
    const controller = createProofController({ config: resolveDemoConfig('a'), targetIpv6: 'fd00::2', control: { query: async (kind: ControlQuery) => controlResult(kind) }, acousticStatus: () => ({ epoch: 7, ready: true, observedAtMs: now }), isolation: async () => ({ accepted: true, epoch: 7, observedAtMs: now, targetIpv6: 'fd00::2' }), now: () => now, execFile: async () => ({ exitCode: 1, stdout: 'private network detail', stderr: 'private command error' }) });

    const projected = projectPublicProofExecution(await controller.ping());

    expect(projected).not.toHaveProperty('raw');
    expect(JSON.stringify(projected)).not.toContain('private');
  });
});
