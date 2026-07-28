import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { decodeFrame, encodeFrame, encodePcmPayload, MessageType, PcmEncoding } from '../packages/bridge/src/protocol.js';
import { resolveDemoConfig } from '../packages/bridge/src/demo-config.js';
import { CYRINX_DEADLINE_MS, writeMachineReport, type MachineReport, type TunEvidence } from '../packages/bridge/src/report.js';
import { renderFipsConfig, startProductionRunner, type ProductionRunner } from '../packages/bridge/src/runner.js';
import { CYRINX_TRANSMIT_SETTLE_MS } from '../packages/bridge/src/qualification-session.js';
import type { CyrinxWorkerRuntime } from '../packages/bridge/src/server.js';
import manifest from '../fixtures/corpus/manifest.json' with { type: 'json' };

const runners: ProductionRunner[] = [];
afterEach(async () => { await Promise.all(runners.splice(0).map((runner) => runner.close())); });

async function fixtureUi(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-ui-')); await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'index.html'), '<main>Arm modem</main>'); await writeFile(path.join(directory, 'assets', 'app.js'), 'window.__fipwave = true;'); return directory;
}
async function reportPath(name: string): Promise<string> { return path.join(await mkdtemp(path.join(tmpdir(), `fipwave-${name}-`)), 'machine.json'); }
function pcm(epoch: number, sequence: bigint): Buffer {
  return encodeFrame({ type: MessageType.PCM_CAPTURE, epoch, sequence, sampleRate: 48_000, channels: 1, encoding: PcmEncoding.FLOAT32_LE, payload: encodePcmPayload(0n, Buffer.alloc(4)) });
}
function frame(type: MessageType, epoch: number, sequence: bigint, payload: object = {}): Buffer {
  return encodeFrame({ type, epoch, sequence, payload: Buffer.from(JSON.stringify(payload)) });
}
function resetFrame(epoch: number, sequence: bigint): Buffer {
  return encodeFrame({ type: MessageType.RESET, epoch, sequence, payload: Buffer.alloc(0) });
}
function audioSettings(epoch: number, sequence: bigint): Buffer {
  return frame(MessageType.AUDIO_SETTINGS, epoch, sequence, { browserVersion: 'Chromium test', microphoneLabel: 'Test microphone', contextState: 'running', inputDeviceSampleRate: 44_100, inputDeviceChannels: 2, contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
}
function qualificationResult(epoch: number, sequence: bigint, caseId: string, overrides: Record<string, unknown> = {}): Buffer {
  const digest = manifest.cases.find((entry) => entry.id === caseId)?.sha256; if (!digest) throw new Error(`missing test corpus case ${caseId}`);
  return frame(MessageType.QUALIFICATION_RESULT, epoch, sequence, { caseId, digest, acquisitionMs: 1, airtimeMs: 1, deliveryCount: 1, bytePerfect: true, coldAcquired: caseId === 'a-to-b-256-01' || caseId === 'b-to-a-256-01', complete: true, corrupt: false, missing: 0, duplicates: 0, queues: { captureHighWaterBytes: 1, captureHighWaterMs: 1, playbackHighWaterBytes: 1, playbackHighWaterMs: 1, discontinuities: 0 }, ...overrides });
}
function qualifyingCases(direction: 'A → B' | 'B → A'): string[] {
  return manifest.cases.filter((entry) => entry.direction === direction && (entry.size === 1536 || Number(entry.id.slice(-2)) <= 19)).map((entry) => entry.id);
}
async function openSocket(runner: ProductionRunner, expectSnapshot = true): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${runner.port}/bridge`, { origin: `http://127.0.0.1:${runner.port}` });
  const initial = expectSnapshot ? nextText(socket) : undefined;
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  if (initial) expect(await initial).toMatchObject({ kind: 'cyrinx-session' });
  return socket;
}
function nextText(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => socket.on('message', function listener(value, binary) { if (binary) return; socket.off('message', listener); resolve(JSON.parse(value.toString()) as Record<string, unknown>); }));
}
class SocketInbox {
  readonly texts: Array<Record<string, unknown>> = [];
  readonly binaries: Buffer[] = [];
  private textWaiters: Array<(value: Record<string, unknown>) => void> = [];
  private binaryWaiters: Array<(value: Buffer) => void> = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (value, binary) => {
      if (binary) {
        const body = Buffer.from(value as Buffer);
        const waiter = this.binaryWaiters.shift();
        if (waiter) waiter(body); else this.binaries.push(body);
        return;
      }
      const body = JSON.parse(value.toString()) as Record<string, unknown>;
      const waiter = this.textWaiters.shift();
      if (waiter) waiter(body); else this.texts.push(body);
    });
  }

  text(): Promise<Record<string, unknown>> {
    const queued = this.texts.shift();
    return queued ? Promise.resolve(queued) : new Promise((resolve) => this.textWaiters.push(resolve));
  }

  binary(): Promise<Buffer> {
    const queued = this.binaries.shift();
    return queued ? Promise.resolve(queued) : new Promise((resolve) => this.binaryWaiters.push(resolve));
  }
}
async function openInbox(runner: ProductionRunner, expected: Record<string, unknown> = { codec: 'idle', stage: 'idle', instruction: null, terminal: false }): Promise<SocketInbox> {
  const socket = new WebSocket(`ws://127.0.0.1:${runner.port}/bridge`, { origin: `http://127.0.0.1:${runner.port}` });
  const inbox = new SocketInbox(socket);
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  expect(await inbox.text()).toMatchObject({ kind: 'cyrinx-session', ...expected });
  return inbox;
}
type CyrinxInstructionSnapshot = Record<string, unknown> & {
  instruction: { action: 'transmit' | 'listen'; caseId: string; direction: 'A → B' | 'B → A'; cold: boolean };
};
async function advanceCyrinxCase(
  inbox: SocketInbox,
  snapshot: CyrinxInstructionSnapshot,
  sequence: bigint,
): Promise<{ snapshot: Record<string, unknown>; sequence: bigint }> {
  const instruction = snapshot.instruction;
  inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, sequence++, {
    action: 'accept_cyrinx_instruction',
    caseId: instruction.caseId,
    direction: instruction.direction,
  }));
  if (instruction.action === 'transmit') {
    await inbox.binary();
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, sequence++, {
      action: 'playback_complete',
      caseId: instruction.caseId,
      direction: instruction.direction,
    }));
  } else {
    inbox.socket.send(pcm(1, sequence++));
    expect(await inbox.text()).toMatchObject({ kind: 'cyrinx-result', caseId: instruction.caseId, accepted: true });
  }
  return { snapshot: await inbox.text(), sequence };
}

function fakeCyrinxWorker(): CyrinxWorkerRuntime & {
  begin: ReturnType<typeof vi.fn<CyrinxWorkerRuntime['begin']>>;
  receiveCapture: ReturnType<typeof vi.fn<CyrinxWorkerRuntime['receiveCapture']>>;
  reset: ReturnType<typeof vi.fn<CyrinxWorkerRuntime['reset']>>;
} {
  let active: Parameters<CyrinxWorkerRuntime['begin']>[0] | undefined;
  let playbackSequence = 0n;
  const begin = vi.fn<CyrinxWorkerRuntime['begin']>(async (value, epoch, mode) => {
    active = value;
    if (mode === 'listen') return undefined;
    const output = encodeFrame({
      type: MessageType.PCM_PLAYBACK,
      flags: 1,
      epoch,
      sequence: playbackSequence++,
      sampleRate: 48_000,
      channels: 1,
      encoding: PcmEncoding.FLOAT32_LE,
      payload: encodePcmPayload(0n, Buffer.alloc(4)),
    });
    return output;
  });
  const receiveCapture = vi.fn<CyrinxWorkerRuntime['receiveCapture']>(async () => {
    if (!active) return undefined;
    return {
      epoch: 1,
      direction: active.direction,
      caseId: active.id,
      digest: active.digest,
      acquisitionMs: 1,
      airtimeMs: 1,
      complete: true,
      corrupt: false,
      missing: 0,
      duplicates: 0,
      deliveryCount: 1,
      bytePerfect: true,
      coldAcquired: true,
      queues: { captureHighWaterBytes: 64, captureHighWaterMs: 1, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
    };
  });
  return { begin, receiveCapture, reset: vi.fn(() => { active = undefined; }) };
}
function exactTun(): TunEvidence {
  return { schemaVersion: 1, source: 'exact_host', status: 'passed', image: 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c', interfaceName: 'fips-preflight0', ipv6Address: 'fd42:6677:6677::1/64', authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] }, checks: { imagePinned: 'passed', tunDevice: 'passed', netAdmin: 'passed', noNewPrivileges: 'passed', notPrivileged: 'passed', sysAdminAbsent: 'passed', hostNetworkAbsent: 'passed', loopbackPortsOnly: 'passed', interfaceCreated: 'passed', ipv6Assigned: 'passed', cleanupComplete: 'passed' }, errors: [] };
}

describe('production runner', () => {
  it('renders the role-owned sound worker configuration without browser authority', () => {
    const rendered = renderFipsConfig(resolveDemoConfig('a'));
    expect(rendered).toContain('bridge_url: "ws://127.0.0.1:4310/bridge/fips"');
    expect(rendered).toContain('peer_addr: "sound-b"');
    expect(rendered).toContain('mtu: 1357');
    expect(rendered).toContain('nsec: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"');
    expect(rendered).toContain('npub: "npub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2"');
    expect(rendered).toContain('transport: sound');
    expect(rendered).toContain('addr: "sound-b"');
    expect(rendered).toContain('connect_policy: auto_connect');
    expect(rendered).toContain('auto_reconnect: true');
    expect(rendered).toContain('heartbeat_interval_secs: 60');
    expect(rendered).toContain('link_dead_timeout_secs: 600');
    expect(rendered).toContain('after_secs: 3600');
    expect(rendered).toContain('after_messages: 65536');
    expect(rendered).toContain('handshake_timeout_secs: 300');
    expect(rendered).toContain('handshake_resend_interval_ms: 15000');
    expect(rendered).toContain('mode: minimal');
    expect(rendered).toContain('control:');
    expect(rendered).toContain('socket_path: "/run/fips/control.sock"');
    expect(rendered).not.toContain('peers: []');
    expect(rendered).not.toContain('codec:');
  });

  it('renders B with only Sound and A with the non-advertised outbound-only UDP client posture', () => {
    const a = renderFipsConfig(resolveDemoConfig('a'));
    const b = renderFipsConfig(resolveDemoConfig('b'));
    expect(a).toContain('  udp:');
    expect(a).toContain('    outbound_only: true');
    expect(a).toContain('    accept_connections: false');
    expect(a).toContain('    advertise_on_nostr: false');
    expect(a.match(/transport: sound/g)).toHaveLength(1);
    expect(b).not.toContain('  udp:');
    expect(b.match(/^  sound:/gm)).toHaveLength(1);
    expect(b.match(/transport: sound/g)).toHaveLength(1);
    expect(b).toContain('connect_policy: manual');
    expect(b).toContain('auto_reconnect: false');
  });

  it('consumes a resolved config and closes only the bridge it successfully created', async () => {
    const bridgeClose = vi.fn(async () => {});
    const createBridge = vi.fn(async () => ({
      port: 4_310,
      sendPcmPlayback: vi.fn(),
      startCyrinx: vi.fn(async () => ({ codec: 'quiet' as const, reasonCode: null, deadlineAtMs: 1 })),
      reset: vi.fn(async () => 2),
      close: bridgeClose,
      state: vi.fn(() => ({ epoch: 1, rejectedFrames: 0, overflowedQueues: [], discontinuities: 0, queueCounts: {}, stampedResults: [], packetCounters: { browserToFips: 0, fipsToBrowser: 0 }, evidenceClass: 'Loopback' as const, acousticReady: false as const, peerConnected: false as const, pingReady: false as const })),
    }));
    const runner = await startProductionRunner({
      machineId: 'laptop-a', report: await reportPath('resolved-config'), tunEvidence: 'none', uiDir: await fixtureUi(),
      demoConfig: resolveDemoConfig('a'), createBridgeServerForTests: createBridge,
    });

    expect(runner.config).toMatchObject({ role: 'A', bridge: { browserPort: 4_310 } });
    expect(JSON.stringify(runner.config)).not.toMatch(/nsec1/i);
    await runner.close();
    await runner.close();
    expect(bridgeClose).toHaveBeenCalledOnce();
  });

  it('configures Role B image reception to trust Role A rather than its own target address', async () => {
    const imageClose = vi.fn(async () => {});
    const createImageTransfer = vi.fn(() => ({
      role: 'B' as const,
      send: vi.fn(async () => ({ transferId: '0000000000000000', bands: 0 })),
      status: () => ({ transferId: null, width: 0, height: 0, receivedRows: 0, complete: false, revision: 0, bands: [] }),
      close: imageClose,
    }));
    const runner = await startProductionRunner({
      machineId: 'laptop-b',
      report: await reportPath('image-peer-address'),
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      demoConfig: resolveDemoConfig('b'),
      createImageTransferForTests: createImageTransfer,
      createBridgeServerForTests: async () => ({
        port: 4_311,
        sendPcmPlayback: () => {},
        startCyrinx: async () => ({ codec: 'quiet', reasonCode: null, deadlineAtMs: 1 }),
        reset: async () => 2,
        close: async () => {},
        state: () => ({ epoch: 1, rejectedFrames: 0, overflowedQueues: [], discontinuities: 0, queueCounts: {}, stampedResults: [], packetCounters: { browserToFips: 0, fipsToBrowser: 0 }, evidenceClass: 'Loopback', acousticReady: false, peerConnected: false, pingReady: false }),
      }),
    });
    runners.push(runner);

    expect(createImageTransfer).toHaveBeenCalledWith({
      role: 'B',
      localIpv6: resolveDemoConfig('b').fips.ipv6Address,
      peerIpv6: resolveDemoConfig('a').fips.ipv6Address,
    });
  });

  it('publishes the FIPS config atomically only after the bridge listener is ready', async () => {
    const configPath = path.join(await mkdtemp(path.join(tmpdir(), 'fipwave-runtime-')), 'fips.yaml');
    const bridgeClose = vi.fn(async () => {});
    let listenerReady = false;
    const runner = await startProductionRunner({
      machineId: 'laptop-a', role: 'A', port: 0, report: await reportPath('config-order'), tunEvidence: 'none', uiDir: await fixtureUi(), fipsConfigOutput: configPath,
      createBridgeServerForTests: async () => {
        listenerReady = true;
        await expect(readFile(configPath, 'utf8')).rejects.toThrow();
        return { port: 4_310, sendPcmPlayback: () => {}, startCyrinx: async () => ({ codec: 'quiet', reasonCode: null, deadlineAtMs: 1 }), reset: async () => 2, close: bridgeClose, state: () => ({ epoch: 1, rejectedFrames: 0, overflowedQueues: [], discontinuities: 0, queueCounts: {}, stampedResults: [], packetCounters: { browserToFips: 0, fipsToBrowser: 0 }, evidenceClass: 'Loopback', acousticReady: false, peerConnected: false, pingReady: false }) };
      },
      afterBridgeStartedForTests: async () => {
        expect(listenerReady).toBe(true);
        expect(await readFile(configPath, 'utf8')).toContain('bridge_url:');
      },
    });
    await runner.close();
    expect(bridgeClose).toHaveBeenCalledOnce();
  });

  it('cleans the owned bridge after partial startup failure without exposing internal configuration', async () => {
    const bridgeClose = vi.fn(async () => {});
    await expect(startProductionRunner({
      machineId: 'laptop-a', report: await reportPath('startup-failure'), tunEvidence: 'none', uiDir: await fixtureUi(),
      demoConfig: resolveDemoConfig('a'),
      createBridgeServerForTests: async () => ({ port: 4_310, sendPcmPlayback: () => {}, startCyrinx: async () => ({ codec: 'quiet', reasonCode: null, deadlineAtMs: 1 }), reset: async () => 2, close: bridgeClose, state: () => ({ epoch: 1, rejectedFrames: 0, overflowedQueues: [], discontinuities: 0, queueCounts: {}, stampedResults: [], packetCounters: { browserToFips: 0, fipsToBrowser: 0 }, evidenceClass: 'Loopback', acousticReady: false, peerConnected: false, pingReady: false }) }),
      afterBridgeStartedForTests: async () => { throw new Error('nsec1must-not-leak'); },
    })).rejects.toThrow('runner startup failed');
    expect(bridgeClose).toHaveBeenCalledOnce();
  });

  it('serves built UI plus immutable runner-owned codec, timeout, build, role, path, and evidence authority', async () => {
    const runner = await startProductionRunner({ machineId: 'laptop-a', role: 'A', port: 0, report: await reportPath('config'), tunEvidence: 'evidence/tun.json', evidenceMode: 'Loopback', uiDir: await fixtureUi() }); runners.push(runner);
    expect(await (await fetch(`http://127.0.0.1:${runner.port}/assets/app.js`)).text()).toContain('__fipwave');
    const first = await (await fetch(`http://127.0.0.1:${runner.port}/qualification-config`)).json();
    expect(first).toMatchObject({ machineId: 'laptop-a', role: 'A', evidenceClass: 'Loopback', tunEvidenceSource: 'static', codec: { id: 'quiet', profile: 'audible-7k-channel-0', audible: true, advertisedMtu: 1357 }, qualification: { deadLinkTimeoutMs: 30_000, cyrinxDeadlineMs: 5_400_000, fallback: { state: 'available' } } });
    expect(first.buildCommit).not.toBe('workspace');
    expect(await (await fetch(`http://127.0.0.1:${runner.port}/qualification-config`)).json()).toEqual(first);
  });

  it('acks every accepted result exactly and persists a selectable-threshold 24-case Loopback report with one Missing placeholder', async () => {
    const target = await reportPath('complete'); const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi() }); runners.push(runner);
    const socket = await openSocket(runner); const settingsAck = nextText(socket); socket.send(audioSettings(1, 0n)); expect(await settingsAck).toMatchObject({ physicalQualification: false });
    let sequence = 1n;
    for (const caseId of qualifyingCases('A → B')) {
      const ack = nextText(socket); socket.send(qualificationResult(1, sequence++, caseId));
      expect(await ack).toEqual({ kind: 'qualification-result', caseId, epoch: 1, accepted: true });
    }
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report).toMatchObject({ evidenceClass: 'Loopback', complete: true, machine: { hostName: 'laptop-b' }, audio: { microphoneLabel: 'Test microphone', contextState: 'running', inputDeviceSampleRate: 44_100, inputDeviceChannels: 2, contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1 }, runner: { role: 'B' } });
    expect(report.results).toHaveLength(25);
    expect(report.results.filter((entry) => entry.observed)).toHaveLength(24);
    expect(report.results.find((entry) => entry.caseId === 'a-to-b-256-20')).toMatchObject({ observed: false, receivedSha256: null, missing: 1 });
    socket.close();
  });

  it('preserves corrupt and duplicate evidence with precise reasons instead of dropping the report', async () => {
    const target = await reportPath('failed'); const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi() }); runners.push(runner);
    const socket = await openSocket(runner); const settingsAck = nextText(socket); socket.send(audioSettings(1, 0n)); await settingsAck;
    const caseId = 'a-to-b-256-01'; const corruptAck = nextText(socket);
    socket.send(qualificationResult(1, 1n, caseId, { digest: 'f'.repeat(64), bytePerfect: false, corrupt: true })); expect(await corruptAck).toEqual({ kind: 'qualification-result', caseId, epoch: 1, accepted: true });
    socket.send(qualificationResult(1, 2n, caseId, { coldAcquired: false })); await new Promise((resolve) => socket.once('close', resolve));
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report.reasonCodes).toEqual(expect.arrayContaining(['bad_digest', 'duplicate_case']));
    expect(report.results.find((entry) => entry.caseId === caseId)).toMatchObject({ observed: true, duplicates: 1, deliveryCount: 2 });
  });

  it('rejects Quiet cold authority on a later or noncanonical receive result', async () => {
    const target = await reportPath('quiet-cold-spoof');
    const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi() });
    runners.push(runner);
    const socket = await openSocket(runner);
    const settings = nextText(socket); socket.send(audioSettings(1, 0n)); await settings;
    socket.send(qualificationResult(1, 1n, 'a-to-b-256-02', { coldAcquired: true }));
    await new Promise((resolve) => socket.once('close', resolve));
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report.reasonCodes).toContain('quiet_cold_case_invalid');
    expect(report.results.every((entry) => entry.observed === false)).toBe(true);
  });

  it('serializes writes and leaves a new-epoch invalidating report after a reset races an older write', async () => {
    const target = await reportPath('race'); let release!: () => void; let started!: () => void; let blocked = false;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const writeStarted = new Promise<void>((resolve) => { started = resolve; });
    const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi(), reportWriterForTests: async (file, report) => { if (!blocked && report.epoch === 1 && report.results.some((entry) => entry.observed)) { blocked = true; started(); await gate; } return writeMachineReport(file, report); } }); runners.push(runner);
    const socket = await openSocket(runner); const settingsAck = nextText(socket); socket.send(audioSettings(1, 0n)); await settingsAck;
    socket.send(qualificationResult(1, 1n, 'a-to-b-256-01')); await writeStarted;
    const reset = runner.reset(); release(); expect(await reset).toBe(2);
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report).toMatchObject({ epoch: 2, complete: false });
    expect(report.results.every((entry) => entry.observed === false)).toBe(true);
    socket.close();
  });

  it('prevents multi-tab evidence combination and permits reconnect only after RESET', async () => {
    const target = await reportPath('tabs'); const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi() }); runners.push(runner);
    const first = await openSocket(runner); const settingsAck = nextText(first); first.send(audioSettings(1, 0n)); await settingsAck;
    const second = await openSocket(runner, false); await new Promise((resolve) => second.once('close', resolve));
    first.close(); await new Promise((resolve) => first.once('close', resolve));
    const premature = await openSocket(runner); premature.send(audioSettings(1, 0n)); await new Promise((resolve) => premature.once('close', resolve));
    await runner.reset();
    const afterReset = await openSocket(runner); expect(afterReset.readyState).toBe(WebSocket.OPEN); afterReset.close();
  });

  it('stamps the Cyrinx deadline before the runner build and atomically preserves a build-failure Quiet fallback in the canonical report', async () => {
    const target = await reportPath('cyrinx-fallback'); let now = 1_000; let sawBuild = false;
    const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi(), nowForTests: () => now, cyrinxBuildForTests: async () => { sawBuild = true; now = 1_050; throw new Error('build failed'); } }); runners.push(runner);
    expect(await runner.startCyrinx()).toEqual({ codec: 'quiet', reasonCode: 'cyrinx_build_failed', deadlineAtMs: 5_401_000 });
    expect(sawBuild).toBe(true);
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report).toMatchObject({ codec: { id: 'quiet', profile: 'audible-7k-channel-0' }, qualification: { deadline: { startedAtMs: 1_000, deadlineAtMs: 5_401_000, elapsedMs: 50 }, fallback: { state: 'activated', reasonCode: 'cyrinx_build_failed' } } });
    expect(await runner.startCyrinx()).toEqual({ codec: 'quiet', reasonCode: 'cyrinx_build_failed', deadlineAtMs: 5_401_000 });
  });

  it('runs build and digital gates before exact role-aware cold/corpus stages and accepts only native receive results', async () => {
    const target = await reportPath('cyrinx-success');
    const worker = fakeCyrinxWorker();
    const gateOrder: string[] = [];
    const settleDelays: number[] = [];
    const clearDeadline = vi.fn();
    let now = 20_000;
    const runner = await startProductionRunner({
      machineId: 'laptop-a',
      role: 'A',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      nowForTests: () => now,
      cyrinxBuildForTests: async () => { gateOrder.push('build'); now += 1; },
      cyrinxDigitalForTests: async () => { gateOrder.push('digital'); now += 1; },
      cyrinxWorkerForTests: worker,
      cyrinxSettleForTests: async (delayMs) => { settleDelays.push(delayMs); now += delayMs; },
      cyrinxTimerForTests: { set: () => 1, clear: clearDeadline },
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    inbox.socket.send(audioSettings(1, 0n));
    await inbox.text();

    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 1n, { action: 'start_cyrinx' }));
    expect(await inbox.text()).toMatchObject({ stage: 'build', instruction: null });
    expect(await inbox.text()).toMatchObject({ stage: 'digital', instruction: null });
    let snapshot = await inbox.text();
    expect(snapshot).toMatchObject({
      codec: 'cyrinx',
      stage: 'cold-a-to-b',
      instruction: { action: 'transmit', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B', cold: true },
    });
    expect(gateOrder).toEqual(['build', 'digital']);
    expect(worker.begin).not.toHaveBeenCalled();

    let sequence = 2n;
    let acceptedCases = 0;
    for (;;) {
      if (snapshot.stage === 'complete') break;
      const instruction = snapshot.instruction as { action: 'transmit' | 'listen'; caseId: string; direction: 'A → B' | 'B → A'; cold: boolean };
      inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, sequence++, { action: 'accept_cyrinx_instruction', caseId: instruction.caseId, direction: instruction.direction }));
      acceptedCases += 1;
      if (instruction.action === 'transmit') {
        const playback = await inbox.binary();
        expect(decodeFrame(playback)).toMatchObject({ type: MessageType.PCM_PLAYBACK, epoch: 1 });
        expect(worker.receiveCapture).toHaveBeenCalledTimes(acceptedCases - worker.begin.mock.calls.filter((call) => call[2] === 'transmit').length);
        inbox.socket.send(pcm(1, sequence++));
        await new Promise((resolve) => setTimeout(resolve, 0));
        inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, sequence++, { action: 'playback_complete', caseId: instruction.caseId, direction: instruction.direction }));
        snapshot = await inbox.text();
      } else {
        inbox.socket.send(pcm(1, sequence++));
        expect(await inbox.text()).toMatchObject({ kind: 'cyrinx-result', epoch: 1, caseId: instruction.caseId, direction: instruction.direction, accepted: true, cold: instruction.cold });
        snapshot = await inbox.text();
      }
    }

    expect(acceptedCases).toBe(52);
    expect(settleDelays).toHaveLength(52);
    expect(settleDelays.every((delayMs) => delayMs === CYRINX_TRANSMIT_SETTLE_MS)).toBe(true);
    expect(CYRINX_TRANSMIT_SETTLE_MS).toBeGreaterThan(Math.ceil(131_072 / 48_000 * 1_000) + 1_300);
    expect(worker.begin.mock.calls.slice(0, 4).map((call) => [call[0].id, call[2]])).toEqual([
      ['cyrinx-cold-a-to-b', 'transmit'],
      ['cyrinx-cold-b-to-a', 'listen'],
      ['a-to-b-256-01', 'transmit'],
      ['a-to-b-256-02', 'transmit'],
    ]);
    expect(snapshot).toMatchObject({ codec: 'cyrinx', stage: 'complete', instruction: null, terminal: true });
    expect(clearDeadline).toHaveBeenCalledOnce();
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report).toMatchObject({
      codec: { id: 'cyrinx', profile: 'bulk-qpsk-r1-2-48k-v1', advertisedMtu: 1536 },
      complete: true,
      qualification: {
        deadline: { startedAtMs: 20_000, deadlineAtMs: 20_000 + CYRINX_DEADLINE_MS, elapsedMs: 2 + 52 * CYRINX_TRANSMIT_SETTLE_MS },
        physicalGate: 'not_physical',
        fallback: { state: 'available', reasonCode: null },
      },
    });
    expect(report.results).toHaveLength(25);
    expect(report.results.every((entry) => entry.direction === 'B → A' && !entry.caseId.startsWith('cyrinx-cold-'))).toBe(true);
    inbox.socket.close();
  });

  it('holds both roles at the same case barrier before the cold direction change', async () => {
    let nowA = 10_000;
    let nowB = 10_000;
    let releaseA!: () => void;
    let releaseB!: () => void;
    const settleA = vi.fn((delayMs: number) => new Promise<void>((resolve) => {
      releaseA = () => { nowA += delayMs; resolve(); };
    }));
    const settleB = vi.fn((delayMs: number) => new Promise<void>((resolve) => {
      releaseB = () => { nowB += delayMs; resolve(); };
    }));
    const workerA = fakeCyrinxWorker();
    const workerB = fakeCyrinxWorker();
    const runnerA = await startProductionRunner({
      machineId: 'paired-a', role: 'A', port: 0, report: await reportPath('paired-a'), tunEvidence: 'none', uiDir: await fixtureUi(),
      nowForTests: () => nowA, cyrinxBuildForTests: async () => undefined, cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: workerA, cyrinxSettleForTests: settleA,
    });
    const runnerB = await startProductionRunner({
      machineId: 'paired-b', role: 'B', port: 0, report: await reportPath('paired-b'), tunEvidence: 'none', uiDir: await fixtureUi(),
      nowForTests: () => nowB, cyrinxBuildForTests: async () => undefined, cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: workerB, cyrinxSettleForTests: settleB,
    });
    runners.push(runnerA, runnerB);
    const inboxA = await openInbox(runnerA);
    const inboxB = await openInbox(runnerB);
    await Promise.all([runnerA.startCyrinx(), runnerB.startCyrinx()]);
    for (let index = 0; index < 3; index += 1) { await inboxA.text(); await inboxB.text(); }

    inboxA.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'accept_cyrinx_instruction', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await inboxA.binary();
    inboxB.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'accept_cyrinx_instruction', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await vi.waitFor(() => expect(workerB.begin).toHaveBeenCalledOnce());
    inboxB.socket.send(pcm(1, 1n));
    await vi.waitFor(() => expect(settleB).toHaveBeenCalledWith(CYRINX_TRANSMIT_SETTLE_MS));
    inboxA.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 1n, { action: 'playback_complete', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await vi.waitFor(() => expect(settleA).toHaveBeenCalledWith(CYRINX_TRANSMIT_SETTLE_MS));
    expect(inboxA.texts).toEqual([]);
    expect(inboxB.texts).toEqual([]);

    releaseA();
    releaseB();
    expect(await inboxB.text()).toMatchObject({ kind: 'cyrinx-result', caseId: 'cyrinx-cold-a-to-b', accepted: true });
    expect(await inboxA.text()).toMatchObject({ instruction: { action: 'listen', caseId: 'cyrinx-cold-b-to-a', direction: 'B → A' } });
    expect(await inboxB.text()).toMatchObject({ instruction: { action: 'transmit', caseId: 'cyrinx-cold-b-to-a', direction: 'B → A' } });
    inboxA.socket.close();
    inboxB.socket.close();
  });

  it('expires without another browser frame, broadcasts immutable timeout fallback, and RESET cannot retry Cyrinx', async () => {
    const target = await reportPath('cyrinx-timeout');
    const worker = fakeCyrinxWorker();
    let now = 5_000;
    let expire!: () => void;
    const runner = await startProductionRunner({
      machineId: 'laptop-b',
      role: 'B',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      nowForTests: () => now,
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: worker,
      cyrinxTimerForTests: {
        set: (callback) => { expire = callback; return 1; },
        clear: vi.fn(),
      },
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'start_cyrinx' }));
    await inbox.text();
    await inbox.text();
    expect(await inbox.text()).toMatchObject({ stage: 'cold-a-to-b' });

    // The monotonic timer remains authoritative even if the wall clock moves
    // backward while the process is running.
    now = 1;
    const timeoutSnapshot = inbox.text();
    expire();
    expect(await timeoutSnapshot).toMatchObject({
      codec: 'quiet',
      stage: 'quiet',
      deadline: { elapsedMs: CYRINX_DEADLINE_MS },
      fallback: { state: 'activated', reasonCode: 'cyrinx_deadline_expired' },
      terminal: true,
    });
    expect(worker.reset).toHaveBeenCalledOnce();

    await runner.reset();
    expect(await runner.startCyrinx()).toEqual({
      codec: 'quiet',
      reasonCode: 'cyrinx_deadline_expired',
      deadlineAtMs: 5_000 + CYRINX_DEADLINE_MS,
    });
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report).toMatchObject({
      epoch: 2,
      codec: { id: 'quiet' },
      qualification: {
        deadline: { startedAtMs: 5_000, deadlineAtMs: 5_000 + CYRINX_DEADLINE_MS, elapsedMs: CYRINX_DEADLINE_MS },
        fallback: { state: 'activated', reasonCode: 'cyrinx_deadline_expired' },
      },
    });
    inbox.socket.close();
  });

  it.each([
    ['completion mutation', 3],
    ['completion write', 4],
  ] as const)('persists a deadline transition that occurs exactly at the %s boundary', async (_boundary, boundaryCall) => {
    const target = await reportPath('cyrinx-persist-boundary');
    const startAt = 1_000;
    const deadlineAt = startAt + CYRINX_DEADLINE_MS;
    let boundaryCalls = 0;
    let boundaryArmed = false;
    const runner = await startProductionRunner({
      machineId: 'persist-boundary',
      role: 'A',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      nowForTests: () => boundaryArmed && ++boundaryCalls >= boundaryCall ? deadlineAt : startAt,
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: fakeCyrinxWorker(),
      cyrinxSettleForTests: async () => undefined,
      cyrinxTimerForTests: { set: () => 1, clear: vi.fn() },
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    await runner.startCyrinx();
    await inbox.text(); await inbox.text(); const cold = await inbox.text() as CyrinxInstructionSnapshot;
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, {
      action: 'accept_cyrinx_instruction',
      caseId: cold.instruction.caseId,
      direction: cold.instruction.direction,
    }));
    await inbox.binary();
    boundaryArmed = true;
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 1n, {
      action: 'playback_complete',
      caseId: cold.instruction.caseId,
      direction: cold.instruction.direction,
    }));
    expect(await inbox.text()).toMatchObject({
      codec: 'quiet',
      stage: 'quiet',
      fallback: { reasonCode: 'cyrinx_deadline_expired' },
    });
    await vi.waitFor(async () => {
      const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
      expect(report).toMatchObject({
        codec: { id: 'quiet' },
        qualification: {
          deadline: { elapsedMs: CYRINX_DEADLINE_MS },
          fallback: { reasonCode: 'cyrinx_deadline_expired' },
        },
      });
    });
    inbox.socket.close();
  });

  it.each([
    ['build', 'cyrinx_build_failed'],
    ['digital', 'cyrinx_digital_roundtrip_failed'],
  ] as const)('preempts a blocked %s gate and acknowledges current-epoch RESET', async (blockedGate, reasonCode) => {
    let gateSignal: AbortSignal | undefined;
    const blocked = ({ signal }: { signal: AbortSignal }) => {
      gateSignal = signal;
      return new Promise<void>(() => undefined);
    };
    const runner = await startProductionRunner({
      machineId: `blocked-${blockedGate}`,
      role: 'A',
      port: 0,
      report: await reportPath(`blocked-${blockedGate}`),
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: blockedGate === 'build' ? blocked : async () => undefined,
      cyrinxDigitalForTests: blockedGate === 'digital' ? blocked : async () => undefined,
      cyrinxWorkerForTests: fakeCyrinxWorker(),
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'start_cyrinx' }));
    expect(await inbox.text()).toMatchObject({ stage: 'build' });
    if (blockedGate === 'digital') expect(await inbox.text()).toMatchObject({ stage: 'digital' });
    await vi.waitFor(() => expect(gateSignal).toBeDefined());

    inbox.socket.send(resetFrame(1, 1n));
    expect(decodeFrame(await inbox.binary())).toMatchObject({ type: MessageType.RESET, epoch: 2 });
    expect(gateSignal?.aborted).toBe(true);
    expect(await inbox.text()).toMatchObject({
      epoch: 2,
      codec: 'quiet',
      fallback: { reasonCode },
    });
    inbox.socket.close();
  });

  it.each([
    ['build', 0, 0],
    ['digital', 1, 0],
    ['cold-a-to-b', 1, 1],
  ] as const)('does not advance beyond a %s report write that returns after the deadline', async (boundaryStage, buildCalls, digitalCalls) => {
    const target = await reportPath(`stage-write-${boundaryStage}`);
    const startAt = 3_000;
    const deadlineAt = startAt + CYRINX_DEADLINE_MS;
    let now = startAt;
    let crossed = false;
    const build = vi.fn(async () => undefined);
    const digital = vi.fn(async () => undefined);
    const runner = await startProductionRunner({
      machineId: `stage-write-${boundaryStage}`,
      role: 'A',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      nowForTests: () => now,
      cyrinxBuildForTests: build,
      cyrinxDigitalForTests: digital,
      cyrinxWorkerForTests: fakeCyrinxWorker(),
      cyrinxTimerForTests: { set: () => 1, clear: vi.fn() },
      reportWriterForTests: async (file, report) => {
        if (!crossed && report.qualification?.cyrinx.stage === boundaryStage) {
          crossed = true;
          now = deadlineAt;
        }
        return writeMachineReport(file, report);
      },
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    await expect(runner.startCyrinx()).resolves.toEqual({
      codec: 'quiet',
      reasonCode: 'cyrinx_deadline_expired',
      deadlineAtMs: deadlineAt,
    });
    expect(build).toHaveBeenCalledTimes(buildCalls);
    expect(digital).toHaveBeenCalledTimes(digitalCalls);
    await vi.waitFor(() => expect(inbox.texts).toContainEqual(expect.objectContaining({
      codec: 'quiet',
      stage: 'quiet',
      fallback: expect.objectContaining({ reasonCode: 'cyrinx_deadline_expired' }),
    })));
    expect(inbox.texts).not.toContainEqual(expect.objectContaining({ stage: boundaryStage }));
    await vi.waitFor(async () => {
      const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
      expect(report).toMatchObject({
        codec: { id: 'quiet' },
        qualification: {
          cyrinx: { stage: 'quiet' },
          deadline: { elapsedMs: CYRINX_DEADLINE_MS },
          fallback: { reasonCode: 'cyrinx_deadline_expired' },
        },
      });
    });
    inbox.socket.close();
  });

  it('rejects browser-spoofed Cyrinx result/stage authority and never turns it into corpus evidence', async () => {
    const target = await reportPath('cyrinx-spoof');
    const runner = await startProductionRunner({
      machineId: 'laptop-b',
      role: 'B',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: fakeCyrinxWorker(),
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'start_cyrinx' }));
    await inbox.text(); await inbox.text(); await inbox.text();
    inbox.socket.send(qualificationResult(1, 1n, 'a-to-b-256-01'));
    await new Promise((resolve) => inbox.socket.once('close', resolve));
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report.results.every((entry) => entry.observed === false)).toBe(true);
    expect(report.complete).toBe(false);
    expect(runner.state().stampedResults).toEqual([]);
  });

  it('passes the post-RESET epoch into the digital gate and an active RESET irreversibly falls back', async () => {
    const target = await reportPath('cyrinx-reset-authority');
    const worker = fakeCyrinxWorker();
    const digitalContexts: Array<{ epoch: number; evidenceClass: MachineReport['evidenceClass']; nowMs: number }> = [];
    let now = 80_000;
    const runner = await startProductionRunner({
      machineId: 'laptop-a',
      role: 'A',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      nowForTests: () => now,
      cyrinxBuildForTests: async () => { now += 1; },
      cyrinxDigitalForTests: async (context) => {
        digitalContexts.push({ epoch: context.epoch, evidenceClass: context.evidenceClass, nowMs: context.nowMs });
        now += 1;
      },
      cyrinxWorkerForTests: worker,
    });
    runners.push(runner);

    expect(await runner.reset()).toBe(2);
    expect(await runner.startCyrinx()).toEqual({
      codec: 'cyrinx',
      reasonCode: null,
      deadlineAtMs: 80_000 + CYRINX_DEADLINE_MS,
    });
    expect(digitalContexts).toEqual([{ epoch: 2, evidenceClass: 'Loopback', nowMs: 80_001 }]);

    expect(await runner.reset()).toBe(3);
    expect(await runner.startCyrinx()).toEqual({
      codec: 'quiet',
      reasonCode: 'cyrinx_cold_a_to_b_failed',
      deadlineAtMs: 80_000 + CYRINX_DEADLINE_MS,
    });
    expect(digitalContexts).toHaveLength(1);
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report).toMatchObject({
      epoch: 3,
      codec: { id: 'quiet' },
      qualification: {
        deadline: { startedAtMs: 80_000, deadlineAtMs: 80_000 + CYRINX_DEADLINE_MS, elapsedMs: 2 },
        fallback: { state: 'activated', reasonCode: 'cyrinx_cold_a_to_b_failed' },
      },
    });
  });

  it('maps digital failure exactly once and suppresses a late native receive after active RESET', async () => {
    const digitalTarget = await reportPath('cyrinx-digital-failure');
    const digitalRunner = await startProductionRunner({
      machineId: 'laptop-a',
      role: 'A',
      port: 0,
      report: digitalTarget,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => { throw new Error('digital mismatch'); },
      cyrinxWorkerForTests: fakeCyrinxWorker(),
    });
    runners.push(digitalRunner);
    expect(await digitalRunner.startCyrinx()).toMatchObject({ codec: 'quiet', reasonCode: 'cyrinx_digital_roundtrip_failed' });
    expect((JSON.parse(await readFile(digitalTarget, 'utf8')) as MachineReport).qualification?.fallback).toEqual({
      codecId: 'quiet',
      state: 'activated',
      reasonCode: 'cyrinx_digital_roundtrip_failed',
    });

    const target = await reportPath('cyrinx-late-native');
    const worker = fakeCyrinxWorker();
    let release!: (result: Awaited<ReturnType<CyrinxWorkerRuntime['receiveCapture']>>) => void;
    worker.receiveCapture.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const runner = await startProductionRunner({
      machineId: 'laptop-b',
      role: 'B',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: worker,
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    await runner.startCyrinx();
    await inbox.text(); await inbox.text();
    const cold = await inbox.text() as { instruction: { caseId: string; direction: 'A → B' } };
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'accept_cyrinx_instruction', caseId: cold.instruction.caseId, direction: cold.instruction.direction }));
    await vi.waitFor(() => expect(worker.begin).toHaveBeenCalledOnce());
    inbox.socket.send(pcm(1, 1n));
    await vi.waitFor(() => expect(worker.receiveCapture).toHaveBeenCalledOnce());
    await runner.reset();
    const active = worker.begin.mock.calls[0]![0];
    release({
      epoch: 1,
      direction: active.direction,
      caseId: active.id,
      digest: active.digest,
      acquisitionMs: 1,
      airtimeMs: 1,
      complete: true,
      corrupt: false,
      missing: 0,
      duplicates: 0,
      deliveryCount: 1,
      bytePerfect: true,
      coldAcquired: true,
      queues: { captureHighWaterBytes: 1, captureHighWaterMs: 1, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report).toMatchObject({ epoch: 2, complete: false, qualification: { fallback: { reasonCode: 'cyrinx_cold_a_to_b_failed' } } });
    expect(report.results.every((entry) => entry.observed === false)).toBe(true);
    expect(runner.state().stampedResults).toEqual([]);
    inbox.socket.close();
  });

  it('preempts serialized native/settle work for current-epoch WS RESET and ERROR', async () => {
    const resetWorker = fakeCyrinxWorker();
    let releaseCapture: ((value: undefined) => void) | undefined;
    resetWorker.receiveCapture.mockImplementationOnce(() => new Promise((resolve) => { releaseCapture = resolve; }));
    resetWorker.reset.mockImplementation(() => { releaseCapture?.(undefined); });
    const resetRunner = await startProductionRunner({
      machineId: 'preempt-reset', role: 'B', port: 0, report: await reportPath('preempt-reset'), tunEvidence: 'none', uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined, cyrinxDigitalForTests: async () => undefined, cyrinxWorkerForTests: resetWorker,
    });
    runners.push(resetRunner);
    const resetInbox = await openInbox(resetRunner);
    await resetRunner.startCyrinx();
    await resetInbox.text(); await resetInbox.text(); await resetInbox.text();
    resetInbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'accept_cyrinx_instruction', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await vi.waitFor(() => expect(resetWorker.begin).toHaveBeenCalledOnce());
    resetInbox.socket.send(pcm(1, 1n));
    await vi.waitFor(() => expect(resetWorker.receiveCapture).toHaveBeenCalledOnce());
    resetInbox.socket.send(resetFrame(1, 2n));
    expect(decodeFrame(await resetInbox.binary())).toMatchObject({ type: MessageType.RESET, epoch: 2 });
    expect(await resetInbox.text()).toMatchObject({ epoch: 2, codec: 'quiet', fallback: { reasonCode: 'cyrinx_cold_a_to_b_failed' } });

    let settleStarted!: () => void;
    const settling = new Promise<void>((resolve) => { settleStarted = resolve; });
    const errorWorker = fakeCyrinxWorker();
    const errorRunner = await startProductionRunner({
      machineId: 'preempt-error', role: 'A', port: 0, report: await reportPath('preempt-error'), tunEvidence: 'none', uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined, cyrinxDigitalForTests: async () => undefined, cyrinxWorkerForTests: errorWorker,
      cyrinxSettleForTests: () => { settleStarted(); return new Promise<void>(() => undefined); },
    });
    runners.push(errorRunner);
    const errorInbox = await openInbox(errorRunner);
    await errorRunner.startCyrinx();
    await errorInbox.text(); await errorInbox.text(); await errorInbox.text();
    errorInbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'accept_cyrinx_instruction', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await errorInbox.binary();
    errorInbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 1n, { action: 'playback_complete', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await settling;
    errorInbox.socket.send(frame(MessageType.ERROR, 1, 2n));
    expect(await errorInbox.text()).toMatchObject({
      kind: 'acoustic-capability',
      epoch: 1,
      capability: expect.any(String),
    });
    expect(await errorInbox.text()).toMatchObject({
      codec: 'quiet',
      fallback: { state: 'activated', reasonCode: 'cyrinx_cold_a_to_b_failed' },
    });
    const errorReport = JSON.parse(await readFile(errorRunner.config.reportTarget, 'utf8')) as MachineReport;
    expect(errorReport.qualification?.fallback.state).toBe('activated');
    resetInbox.socket.close();
    errorInbox.socket.close();
  });

  it.each([
    ['stale RESET', () => resetFrame(2, 2n)],
    ['stale ERROR', () => frame(MessageType.ERROR, 2, 2n)],
    ['RESET with a payload', () => frame(MessageType.RESET, 1, 2n)],
    ['malformed ERROR', () => encodeFrame({ type: MessageType.ERROR, epoch: 1, sequence: 2n, payload: Buffer.from('{') })],
    ['sequence-replayed RESET', () => resetFrame(1, 1n)],
    ['sequence-replayed ERROR', () => frame(MessageType.ERROR, 1, 1n)],
  ])('does not preempt native work for an unsafe urgent %s frame', async (_label, urgentFrame) => {
    const worker = fakeCyrinxWorker();
    let releaseCapture: ((value: undefined) => void) | undefined;
    worker.receiveCapture.mockImplementationOnce(() => new Promise((resolve) => { releaseCapture = resolve; }));
    const runner = await startProductionRunner({
      machineId: `unsafe-urgent-${String(_label).replaceAll(' ', '-').toLowerCase()}`,
      role: 'B',
      port: 0,
      report: await reportPath('unsafe-urgent'),
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: worker,
      cyrinxSettleForTests: async () => undefined,
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    await runner.startCyrinx();
    await inbox.text(); await inbox.text(); await inbox.text();
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'accept_cyrinx_instruction', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await vi.waitFor(() => expect(worker.begin).toHaveBeenCalledOnce());
    inbox.socket.send(pcm(1, 1n));
    await vi.waitFor(() => expect(worker.receiveCapture).toHaveBeenCalledOnce());

    inbox.socket.send(urgentFrame());
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(worker.reset).not.toHaveBeenCalled();

    const closed = new Promise((resolve) => inbox.socket.once('close', resolve));
    releaseCapture?.(undefined);
    await closed;
  });

  it.each([
    ['stale RESET', () => resetFrame(2, 2n)],
    ['malformed ERROR', () => encodeFrame({ type: MessageType.ERROR, epoch: 1, sequence: 2n, payload: Buffer.from('{') })],
    ['sequence-replayed ERROR', () => frame(MessageType.ERROR, 1, 1n)],
  ])('does not preempt settle work for an unsafe urgent %s frame', async (_label, urgentFrame) => {
    const worker = fakeCyrinxWorker();
    let releaseSettle: (() => void) | undefined;
    const runner = await startProductionRunner({
      machineId: `unsafe-settle-${String(_label).replaceAll(' ', '-').toLowerCase()}`,
      role: 'A',
      port: 0,
      report: await reportPath('unsafe-settle'),
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: worker,
      cyrinxSettleForTests: () => new Promise<void>((resolve) => { releaseSettle = resolve; }),
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    await runner.startCyrinx();
    await inbox.text(); await inbox.text(); await inbox.text();
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'accept_cyrinx_instruction', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await inbox.binary();
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 1n, { action: 'playback_complete', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await vi.waitFor(() => expect(releaseSettle).toBeTypeOf('function'));

    inbox.socket.send(urgentFrame());
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(worker.reset).not.toHaveBeenCalled();

    const closed = new Promise((resolve) => inbox.socket.once('close', resolve));
    releaseSettle?.();
    await closed;
  });

  it('does not let an out-of-order urgent frame overtake a safely received queued sequence', async () => {
    const worker = fakeCyrinxWorker();
    let releaseCapture: ((value: undefined) => void) | undefined;
    worker.receiveCapture.mockImplementationOnce(() => new Promise((resolve) => { releaseCapture = resolve; }));
    const runner = await startProductionRunner({
      machineId: 'urgent-overtake',
      role: 'B',
      port: 0,
      report: await reportPath('urgent-overtake'),
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: worker,
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    await runner.startCyrinx();
    await inbox.text(); await inbox.text(); await inbox.text();
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'accept_cyrinx_instruction', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await vi.waitFor(() => expect(worker.begin).toHaveBeenCalledOnce());
    inbox.socket.send(pcm(1, 1n));
    await vi.waitFor(() => expect(worker.receiveCapture).toHaveBeenCalledOnce());

    inbox.socket.send(frame(MessageType.HELLO, 1, 5n));
    inbox.socket.send(resetFrame(1, 4n));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(worker.reset).not.toHaveBeenCalled();

    const closed = new Promise((resolve) => inbox.socket.once('close', resolve));
    releaseCapture?.(undefined);
    await closed;
  });

  it('reserves a valid urgent sequence synchronously so its duplicate cannot preempt twice', async () => {
    const worker = fakeCyrinxWorker();
    let releaseCapture: ((value: undefined) => void) | undefined;
    worker.receiveCapture.mockImplementationOnce(() => new Promise((resolve) => { releaseCapture = resolve; }));
    worker.reset.mockImplementation(() => { releaseCapture?.(undefined); });
    const runner = await startProductionRunner({
      machineId: 'urgent-duplicate',
      role: 'B',
      port: 0,
      report: await reportPath('urgent-duplicate'),
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: worker,
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    await runner.startCyrinx();
    await inbox.text(); await inbox.text(); await inbox.text();
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { action: 'accept_cyrinx_instruction', caseId: 'cyrinx-cold-a-to-b', direction: 'A → B' }));
    await vi.waitFor(() => expect(worker.begin).toHaveBeenCalledOnce());
    inbox.socket.send(pcm(1, 1n));
    await vi.waitFor(() => expect(worker.receiveCapture).toHaveBeenCalledOnce());

    const closed = new Promise((resolve) => inbox.socket.once('close', resolve));
    inbox.socket.send(frame(MessageType.ERROR, 1, 2n));
    inbox.socket.send(frame(MessageType.ERROR, 1, 2n));
    await closed;
    expect(worker.reset).toHaveBeenCalledOnce();
  });

  it('revokes an unacknowledged final-case report when ERROR arrives during its durable write', async () => {
    const target = await reportPath('final-write-error');
    let releaseFinalWrite!: () => void;
    let finalWriteStarted!: () => void;
    let blocked = false;
    const finalWriteGate = new Promise<void>((resolve) => { releaseFinalWrite = resolve; });
    const finalWrite = new Promise<void>((resolve) => { finalWriteStarted = resolve; });
    const runner = await startProductionRunner({
      machineId: 'final-write-error',
      role: 'A',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: fakeCyrinxWorker(),
      cyrinxSettleForTests: async () => undefined,
      reportWriterForTests: async (file, report) => {
        if (!blocked && report.qualification?.cyrinx.stage === 'complete') {
          blocked = true;
          finalWriteStarted();
          await finalWriteGate;
        }
        return writeMachineReport(file, report);
      },
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    await runner.startCyrinx();
    await inbox.text(); await inbox.text();
    let snapshot = await inbox.text() as CyrinxInstructionSnapshot;
    let sequence = 0n;
    for (let index = 0; index < 51; index += 1) {
      const advanced = await advanceCyrinxCase(inbox, snapshot, sequence);
      snapshot = advanced.snapshot as CyrinxInstructionSnapshot;
      sequence = advanced.sequence;
    }
    const finalInstruction = snapshot.instruction;
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, sequence++, {
      action: 'accept_cyrinx_instruction',
      caseId: finalInstruction.caseId,
      direction: finalInstruction.direction,
    }));
    if (finalInstruction.action === 'transmit') {
      await inbox.binary();
      inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, sequence++, {
        action: 'playback_complete',
        caseId: finalInstruction.caseId,
        direction: finalInstruction.direction,
      }));
    } else {
      inbox.socket.send(pcm(1, sequence++));
    }
    await finalWrite;

    inbox.socket.send(frame(MessageType.ERROR, 1, sequence++));
    releaseFinalWrite();
    expect(await inbox.text()).toMatchObject({
      kind: 'acoustic-capability',
      epoch: 1,
      capability: expect.any(String),
    });
    expect(await inbox.text()).toMatchObject({
      codec: 'quiet',
      stage: 'quiet',
      fallback: { reasonCode: 'cyrinx_corpus_failed' },
    });
    await vi.waitFor(async () => {
      const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
      expect(report).toMatchObject({
        codec: { id: 'quiet' },
        complete: false,
        qualification: {
          cyrinx: { stage: 'quiet' },
          fallback: { state: 'activated', reasonCode: 'cyrinx_corpus_failed' },
        },
      });
    });
    expect(inbox.texts).not.toContainEqual(expect.objectContaining({ kind: 'cyrinx-result', caseId: finalInstruction.caseId }));
    inbox.socket.close();
  });

  it('overwrites final-case success when its durable write returns after the immutable deadline', async () => {
    const target = await reportPath('final-write-deadline');
    const startAt = 2_000;
    const deadlineAt = startAt + CYRINX_DEADLINE_MS;
    let now = startAt;
    let crossedDeadline = false;
    const runner = await startProductionRunner({
      machineId: 'final-write-deadline',
      role: 'A',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      nowForTests: () => now,
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: fakeCyrinxWorker(),
      cyrinxSettleForTests: async () => undefined,
      cyrinxTimerForTests: { set: () => 1, clear: vi.fn() },
      reportWriterForTests: async (file, report) => {
        if (!crossedDeadline && report.qualification?.cyrinx.stage === 'complete') {
          crossedDeadline = true;
          now = deadlineAt;
        }
        return writeMachineReport(file, report);
      },
    });
    runners.push(runner);
    const inbox = await openInbox(runner);
    await runner.startCyrinx();
    await inbox.text(); await inbox.text();
    let snapshot = await inbox.text() as CyrinxInstructionSnapshot;
    let sequence = 0n;
    for (let index = 0; index < 51; index += 1) {
      const advanced = await advanceCyrinxCase(inbox, snapshot, sequence);
      snapshot = advanced.snapshot as CyrinxInstructionSnapshot;
      sequence = advanced.sequence;
    }
    const finalInstruction = snapshot.instruction;
    inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, sequence++, {
      action: 'accept_cyrinx_instruction',
      caseId: finalInstruction.caseId,
      direction: finalInstruction.direction,
    }));
    if (finalInstruction.action === 'transmit') {
      await inbox.binary();
      inbox.socket.send(frame(MessageType.QUALIFICATION_CASE, 1, sequence++, {
        action: 'playback_complete',
        caseId: finalInstruction.caseId,
        direction: finalInstruction.direction,
      }));
    } else {
      inbox.socket.send(pcm(1, sequence++));
    }

    expect(await inbox.text()).toMatchObject({
      codec: 'quiet',
      stage: 'quiet',
      deadline: { elapsedMs: CYRINX_DEADLINE_MS },
      fallback: { reasonCode: 'cyrinx_deadline_expired' },
    });
    await vi.waitFor(async () => {
      const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
      expect(report).toMatchObject({
        codec: { id: 'quiet' },
        complete: false,
        qualification: {
          cyrinx: { stage: 'quiet' },
          deadline: { elapsedMs: CYRINX_DEADLINE_MS },
          fallback: { state: 'activated', reasonCode: 'cyrinx_deadline_expired' },
        },
      });
    });
    expect(inbox.texts).not.toContainEqual(expect.objectContaining({ kind: 'cyrinx-result', caseId: finalInstruction.caseId }));
    expect(inbox.texts).not.toContainEqual(expect.objectContaining({ stage: 'complete' }));
    inbox.socket.close();
  });

  it('turns an unexpected active owner disconnect into stable fallback and requires RESET on replacement', async () => {
    const target = await reportPath('cyrinx-owner-disconnect');
    const worker = fakeCyrinxWorker();
    const runner = await startProductionRunner({
      machineId: 'laptop-b',
      role: 'B',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: worker,
    });
    runners.push(runner);
    const ownerInbox = await openInbox(runner);
    await runner.startCyrinx();
    await ownerInbox.text(); await ownerInbox.text(); await ownerInbox.text();
    ownerInbox.socket.close();
    await new Promise((resolve) => ownerInbox.socket.once('close', resolve));

    await vi.waitFor(async () => {
      const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
      expect(report).toMatchObject({
        epoch: 1,
        codec: { id: 'quiet' },
        qualification: {
          fallback: { state: 'activated', reasonCode: 'cyrinx_cold_a_to_b_failed' },
        },
      });
    });
    expect(worker.reset).toHaveBeenCalledOnce();

    const invalidReplacement = await openInbox(runner, { codec: 'quiet', stage: 'quiet', terminal: true });
    invalidReplacement.socket.send(audioSettings(1, 0n));
    await new Promise((resolve) => invalidReplacement.socket.once('close', resolve));

    const resetReplacement = await openInbox(runner, { codec: 'quiet', stage: 'quiet', terminal: true });
    resetReplacement.socket.send(resetFrame(1, 0n));
    expect(decodeFrame(await resetReplacement.binary())).toMatchObject({ type: MessageType.RESET, epoch: 2 });
    expect(await resetReplacement.text()).toMatchObject({
      kind: 'cyrinx-session',
      epoch: 2,
      codec: 'quiet',
      fallback: { reasonCode: 'cyrinx_cold_a_to_b_failed' },
    });
    resetReplacement.socket.close();
  });

  it('allows a pre-existing Quiet fallback owner to reload only through current-epoch RESET', async () => {
    const runner = await startProductionRunner({
      machineId: 'quiet-reload',
      role: 'A',
      port: 0,
      report: await reportPath('quiet-reload'),
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => { throw new Error('expected build failure'); },
    });
    runners.push(runner);
    const ownerInbox = await openInbox(runner);
    await expect(runner.startCyrinx()).resolves.toMatchObject({ codec: 'quiet', reasonCode: 'cyrinx_build_failed' });
    await ownerInbox.text();
    await ownerInbox.text();
    ownerInbox.socket.close();
    await new Promise((resolve) => ownerInbox.socket.once('close', resolve));

    const invalidReplacement = await openInbox(runner, { codec: 'quiet', stage: 'quiet', terminal: true });
    invalidReplacement.socket.send(audioSettings(1, 0n));
    await new Promise((resolve) => invalidReplacement.socket.once('close', resolve));

    const resetReplacement = await openInbox(runner, { codec: 'quiet', stage: 'quiet', terminal: true });
    resetReplacement.socket.send(resetFrame(1, 0n));
    expect(decodeFrame(await resetReplacement.binary())).toMatchObject({ type: MessageType.RESET, epoch: 2 });
    expect(await resetReplacement.text()).toMatchObject({ epoch: 2, codec: 'quiet', fallback: { reasonCode: 'cyrinx_build_failed' } });
    resetReplacement.socket.close();
  });

  it('does not reinterpret a late owner close after RESET as another Cyrinx failure', async () => {
    const target = await reportPath('cyrinx-late-owner-close');
    const worker = fakeCyrinxWorker();
    const runner = await startProductionRunner({
      machineId: 'laptop-a',
      role: 'A',
      port: 0,
      report: target,
      tunEvidence: 'none',
      uiDir: await fixtureUi(),
      cyrinxBuildForTests: async () => undefined,
      cyrinxDigitalForTests: async () => undefined,
      cyrinxWorkerForTests: worker,
    });
    runners.push(runner);
    const ownerInbox = await openInbox(runner);
    await runner.startCyrinx();
    await ownerInbox.text(); await ownerInbox.text(); await ownerInbox.text();
    expect(await runner.reset()).toBe(2);
    const resetsAfterOperatorReset = worker.reset.mock.calls.length;
    const beforeClose = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    ownerInbox.socket.close();
    await new Promise((resolve) => ownerInbox.socket.once('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(worker.reset).toHaveBeenCalledTimes(resetsAfterOperatorReset);
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(beforeClose);
    const replacement = await openInbox(runner, { epoch: 2, codec: 'quiet', stage: 'quiet', terminal: true });
    const accepted = replacement.text();
    replacement.socket.send(audioSettings(2, 0n));
    expect(await accepted).toMatchObject({ physicalQualification: false });
    replacement.socket.close();
  });

  it('does not count routine control-frame aging as an acoustic discontinuity', async () => {
    let now = 0; const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: await reportPath('aging'), tunEvidence: 'none', uiDir: await fixtureUi(), nowForTests: () => now }); runners.push(runner);
    const socket = await openSocket(runner); socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { caseId: 'one' })); await new Promise((resolve) => setTimeout(resolve, 10));
    now = 6_000; socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 1n, { caseId: 'two' })); await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runner.state()).toMatchObject({ discontinuities: 0, queueCounts: { QUALIFICATION_CASE: 1 } }); socket.close();
  });

  it('never lets the initial browser choose an epoch that can overflow RESET', async () => {
    const runner = await startProductionRunner({
      machineId: 'epoch-boundary', role: 'A', port: 0, report: await reportPath('epoch-boundary'), tunEvidence: 'none', uiDir: await fixtureUi(),
    });
    runners.push(runner);
    const socket = await openSocket(runner);
    socket.send(audioSettings(0xffff_ffff, 0n));
    await new Promise((resolve) => socket.once('close', resolve));
    expect(runner.state().epoch).toBe(1);
    await expect(runner.reset()).resolves.toBe(2);
  });

  it('fails physical mode closed for dirty/default build identities and any non-passed exact-host field', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-physical-')); const tunPath = path.join(directory, 'tun.json'); await writeFile(tunPath, JSON.stringify(exactTun()));
    const base = { machineId: 'laptop-a', role: 'A' as const, port: 0, report: path.join(directory, 'machine.json'), tunEvidence: tunPath, physicalOpenAir: true, uiDir: await fixtureUi() };
    await expect(startProductionRunner({ ...base, buildIdentityForTests: { commit: 'workspace', os: 'test', architecture: 'test', dirty: false } })).rejects.toThrow('clean resolved git HEAD');
    await expect(startProductionRunner({ ...base, buildIdentityForTests: { commit: 'a'.repeat(40), os: 'test', architecture: 'test', dirty: true } })).rejects.toThrow('clean resolved git HEAD');
    const failed = exactTun(); failed.checks.cleanupComplete = 'failed'; await writeFile(tunPath, JSON.stringify(failed));
    await expect(startProductionRunner({ ...base, buildIdentityForTests: { commit: 'a'.repeat(40), os: 'test', architecture: 'test', dirty: false } })).rejects.toThrow('tun_passed_status_inconsistent');
  });
});
