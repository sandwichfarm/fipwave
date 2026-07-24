import { describe, expect, it } from 'vitest';

import { AcousticSession, type AcousticModem, type AcousticSessionOptions } from './acoustic-session.js';
import { decodeFas1, encodeFas1, Fas1UnitType } from './acoustic-protocol.js';

class FakeModem implements AcousticModem {
  #handler: ((unit: Uint8Array) => void) | undefined;
  peer: FakeModem | undefined;
  readonly sent: Uint8Array[] = [];
  shouldDeliver: ((unit: Uint8Array) => boolean) | undefined;
  transform: ((unit: Uint8Array) => Uint8Array) | undefined;

  send(unit: Uint8Array): void {
    this.sent.push(unit.slice());
    if (this.shouldDeliver?.(unit) === false) return;
    if (this.peer && this.peer.#handler) this.peer.#handler(this.transform ? this.transform(unit.slice()) : unit.slice());
  }

  onUnit(handler: (unit: Uint8Array) => void): () => void {
    this.#handler = handler;
    return () => { if (this.#handler === handler) this.#handler = undefined; };
  }
}

class FakeTimers {
  #callbacks = new Map<number, () => void>();
  #next = 1;
  setTimeout(callback: () => void): ReturnType<typeof setTimeout> { const id = this.#next++; this.#callbacks.set(id, callback); return id as unknown as ReturnType<typeof setTimeout>; }
  clearTimeout(handle: ReturnType<typeof setTimeout>): void { this.#callbacks.delete(handle as unknown as number); }
  runAll(): void {
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

class ManualClock {
  nowMs = 0;
  now(): number { return this.nowMs; }
}

const candidate = {
  id: 'quiet-bootstrap-96-v1',
  profileId: 'quiet-audible-7k-v1',
  payloadBytes: 96,
  repetition: 1,
  guardMs: 750,
  playbackGain: 1,
  ackTimeoutMs: 4_000,
} as const;

function options(role: 'A' | 'B', modem: FakeModem): AcousticSessionOptions {
  return {
    role,
    identity: role === 'A' ? 'npub-a' : 'npub-b',
    expectedPeer: role === 'A' ? 'npub-b' : 'npub-a',
    modem,
    clock: { now: () => 0 },
    timers: { setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimeout: () => undefined },
    nonce: () => new Uint8Array(role === 'A' ? Array(16).fill(1) : Array(16).fill(2)),
    profiles: ['quiet-audible-7k-v1'],
    ranges: { minPayloadBytes: 96, maxPayloadBytes: 217 },
    candidates: [candidate],
    calibration: { probesPerDirection: 4, maxCandidates: 3, deadlineMs: 120_000 },
    measureProbe: () => ({ received: true, bytePerfect: true, corrupt: false, missing: false, duplicate: false, discontinuity: false, latencyMs: 30, signalDb: -24, clipping: false, confidence: 1 }),
  };
}

async function settlePair(a: AcousticSession, b: AcousticSession): Promise<void> {
  for (let round = 0; round < 4; round += 1) await Promise.all([a.settle(), b.settle()]);
}

describe('AcousticSession bootstrap handshake', () => {
  it('allows only A to initiate and carries the pair into A-to-B calibration over encoded FAS1 units', () => {
    const aModem = new FakeModem();
    const bModem = new FakeModem();
    aModem.peer = bModem;
    bModem.peer = aModem;
    const a = new AcousticSession(options('A', aModem));
    const b = new AcousticSession(options('B', bModem));

    expect(b.start()).toBe(false);
    expect(a.start()).toBe(true);
    expect(a.snapshot.state).toBe('Committing');
    expect(b.snapshot.state).toBe('Committing');
    expect(aModem.sent.length).toBeGreaterThan(0);
    expect(bModem.sent.length).toBeGreaterThan(0);
  });

  it('reset atomically removes session authority and late units cannot revive it', () => {
    const aModem = new FakeModem();
    const bModem = new FakeModem();
    aModem.peer = bModem;
    bModem.peer = aModem;
    const a = new AcousticSession(options('A', aModem));
    new AcousticSession(options('B', bModem));
    a.start();
    const late = aModem.sent[0]!.slice();

    a.reset(2);
    expect(a.snapshot).toMatchObject({ state: 'Idle', epoch: 2, ready: false });
    expect(a.snapshot.sessionId).toBeUndefined();
    a.receive(late);
    expect(a.snapshot.state).toBe('Idle');
  });

  it('rejects every required HELLO binding before B can leave Listening', () => {
    const makeHello = (patch: (body: Uint8Array) => void): Uint8Array => {
      const source = new FakeModem();
      const a = new AcousticSession(options('A', source));
      a.start();
      const unit = decodeFas1(source.sent[0]!);
      const body = unit.body.slice(); patch(body);
      return encodeFas1({ ...unit, body });
    };
    const identityOffset = 2;
    const expectedOffset = (body: Uint8Array) => identityOffset + 1 + body[identityOffset]!;
    const nonceOffset = (body: Uint8Array) => expectedOffset(body) + 1 + body[expectedOffset(body)]!;
    const profileOffset = (body: Uint8Array) => nonceOffset(body) + 16;
    const rangeOffset = (body: Uint8Array) => {
      let offset = profileOffset(body) + 1;
      for (let index = 0; index < body[profileOffset(body)]!; index += 1) offset += 1 + body[offset]!;
      return offset;
    };
    const mutations: Array<(body: Uint8Array) => void> = [
      (body) => { body[identityOffset + 1] = (body[identityOffset + 1] ?? 0) ^ 1; },
      (body) => { const offset = expectedOffset(body) + 1; body[offset] = (body[offset] ?? 0) ^ 1; },
      (body) => { body[1] = 2; },
      (body) => { body.fill(0, nonceOffset(body), nonceOffset(body) + 16); },
      (body) => { body[profileOffset(body)] = 0; },
      (body) => { new DataView(body.buffer).setUint16(rangeOffset(body), 218, true); },
    ];
    for (const mutate of mutations) {
      const modem = new FakeModem();
      const b = new AcousticSession(options('B', modem));
      b.receive(makeHello(mutate));
      expect(b.snapshot.state).toBe('Listening');
    }
  });

  it('does not allow duplicate or out-of-order controls to skip the legal sequence', () => {
    const modem = new FakeModem();
    const b = new AcousticSession(options('B', modem));
    const rawCaps = encodeFas1({ type: Fas1UnitType.Caps, flags: 0, sessionId: 1n, sequence: 1, packetId: 0, fragmentIndex: 0, fragmentCount: 0, packetLength: 0, body: new Uint8Array(32) });
    b.receive(rawCaps);
    b.receive(rawCaps);
    expect(b.snapshot.state).toBe('Listening');
  });

  it('accepts an exact capability boundary and rejects a one-byte non-overlap before transition', () => {
    const exactA = new FakeModem(); const exactB = new FakeModem(); exactA.peer = exactB; exactB.peer = exactA;
    const a = new AcousticSession({ ...options('A', exactA), ranges: { minPayloadBytes: 96, maxPayloadBytes: 96 } });
    const b = new AcousticSession({ ...options('B', exactB), ranges: { minPayloadBytes: 96, maxPayloadBytes: 96 } });
    a.start();
    expect(b.snapshot.state).not.toBe('Listening');

    const rejectedA = new FakeModem(); const rejectedB = new FakeModem(); rejectedA.peer = rejectedB; rejectedB.peer = rejectedA;
    const outOfRangeA = new AcousticSession({ ...options('A', rejectedA), ranges: { minPayloadBytes: 96, maxPayloadBytes: 96 } });
    const outOfRangeB = new AcousticSession({ ...options('B', rejectedB), ranges: { minPayloadBytes: 97, maxPayloadBytes: 217 }, candidates: [{ ...candidate, payloadBytes: 97 }] });
    outOfRangeA.start();
    expect(outOfRangeB.snapshot.state).toBe('Listening');
  });

  it('keeps discovery and control on the exact executable conservative profile', () => {
    const modem = new FakeModem();
    expect(() => new AcousticSession({ ...options('A', modem), profiles: ['synthetic-frequency-7000'] })).toThrow('FAS1 profile ID is unsupported');
  });
});

describe('AcousticSession calibration, selection, and commitment', () => {
  it('executes four numbered A-to-B probes before four numbered B-to-A probes and automatically reaches readiness after COMMIT_ACK', async () => {
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession(options('A', aModem)); const b = new AcousticSession(options('B', bModem));
    a.start();
    await settlePair(a, b);
    expect({ a: a.snapshot, b: b.snapshot }).toMatchObject({ a: { state: 'Ready', ready: true }, b: { state: 'Ready', ready: true } });
    const probes = [...aModem.sent, ...bModem.sent].map((raw) => decodeFas1(raw)).filter((unit) => unit.type === Fas1UnitType.Probe);
    expect(probes).toHaveLength(8);
    expect(probes.slice(0, 4).map((probe) => probe.body[0])).toEqual([1, 1, 1, 1]);
    expect(probes.slice(4).map((probe) => probe.body[0])).toEqual([2, 2, 2, 2]);
  });

  it('selects directionally, preferring byte correctness, timing, then lower gain', async () => {
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const candidates = [
      { ...candidate, id: 'fast-gain-2', payloadBytes: 217, playbackGain: 2 },
      { ...candidate, id: 'reliable-gain-1', payloadBytes: 96, playbackGain: 1 },
    ];
    const aOptions = options('A', aModem); const bOptions = options('B', bModem);
    const a = new AcousticSession({ ...aOptions, candidates, measureProbe: (probe) => ({ received: true, bytePerfect: probe.candidateIndex === 1, corrupt: probe.candidateIndex === 0, missing: false, duplicate: false, discontinuity: false, latencyMs: 10, signalDb: -20, clipping: probe.candidateIndex === 0, confidence: 1 }) });
    const b = new AcousticSession({ ...bOptions, candidates, measureProbe: (probe) => ({ received: true, bytePerfect: true, corrupt: false, missing: false, duplicate: false, discontinuity: false, latencyMs: probe.candidateIndex === 0 ? 50 : 50, signalDb: -20, clipping: false, confidence: 1 }) });
    a.start();
    await settlePair(a, b);
    expect(a.snapshot.settings?.aToB.payloadBytes).toBe(96);
    expect(a.snapshot.settings?.bToA.playbackGain).toBe(1);
    expect(b.snapshot.settingsDigest).toEqual(a.snapshot.settingsDigest);
  });

  it('retains bounded corrupt, missing, duplicate, discontinuity, timing, signal, clipping, and confidence evidence', () => {
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession(options('A', aModem));
    const b = new AcousticSession({ ...options('B', bModem), measureProbe: () => ({ received: false, bytePerfect: false, corrupt: true, missing: true, duplicate: true, discontinuity: true, latencyMs: 42, signalDb: -37.5, clipping: true, confidence: 0.25 }) });
    a.start();
    const entry = b.snapshot.ledger[0]!;
    expect(entry.observation).toEqual({ received: false, bytePerfect: false, corrupt: true, missing: true, duplicate: true, discontinuity: true, latencyMs: 42, signalDb: -37.5, clipping: true, confidence: 0.25 });
  });

  it('enters a bounded safe error on deadline or a mismatched COMMIT digest', async () => {
    const timers = new FakeTimers(); const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    aModem.shouldDeliver = (raw) => decodeFas1(raw).type !== Fas1UnitType.Probe;
    const a = new AcousticSession({ ...options('A', aModem), timers }); const b = new AcousticSession({ ...options('B', bModem), timers });
    a.start(); timers.runAll();
    expect(a.snapshot).toMatchObject({ state: 'Error', ready: false, reason: 'acoustic_calibration_deadline' });
    expect(b.snapshot).toMatchObject({ state: 'Error', ready: false, reason: 'acoustic_calibration_deadline' });

    const cModem = new FakeModem(); const dModem = new FakeModem(); cModem.peer = dModem; dModem.peer = cModem;
    dModem.transform = (raw) => {
      const unit = decodeFas1(raw);
      return unit.type === Fas1UnitType.Commit ? encodeFas1({ ...unit, body: Uint8Array.from(unit.body, (byte, index) => index === 0 ? byte ^ 1 : byte) }) : raw;
    };
    const c = new AcousticSession(options('A', cModem)); const d = new AcousticSession(options('B', dModem));
    c.start(); await settlePair(c, d);
    expect(c.snapshot).toMatchObject({ state: 'Error', ready: false, reason: 'acoustic_commit_digest_mismatch' });
    expect(d.snapshot.ready).toBe(false);
  });
});

describe('AcousticSession packet, fragment, reassembly, retry, duplicate, and turn delivery', () => {
  it('round-trips one byte-identical 1357-byte packet in each direction exactly once through fifteen committed-size fragments', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const receivedA: Uint8Array[] = []; const receivedB: Uint8Array[] = [];
    const a = new AcousticSession({ ...options('A', aModem), clock, timers, onPacket: (packet) => receivedA.push(packet) });
    const b = new AcousticSession({ ...options('B', bModem), clock, timers, onPacket: (packet) => receivedB.push(packet) });
    a.start(); await settlePair(a, b);

    const aPacket = Uint8Array.from({ length: 1_357 }, (_, index) => index & 0xff);
    const bPacket = Uint8Array.from({ length: 1_357 }, (_, index) => (255 - index) & 0xff);
    expect(a.enqueuePacket(aPacket, 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 16; round += 1) timers.runAll();
    expect(receivedB).toHaveLength(1);
    expect(receivedB[0]).toEqual(aPacket);
    expect(aModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Data)).toHaveLength(15);

    expect(b.enqueuePacket(bPacket, 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 16; round += 1) timers.runAll();
    expect(receivedA).toHaveLength(1);
    expect(receivedA[0]).toEqual(bPacket);
  });

  it('retries only missing fragments and duplicate DATA or a lost ACK cannot redeliver a complete packet', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const received: Uint8Array[] = []; let dropped = false; let droppedAck = false;
    aModem.shouldDeliver = (raw) => {
      const unit = decodeFas1(raw);
      if (unit.type === Fas1UnitType.Data && unit.fragmentIndex === 2 && !dropped) { dropped = true; return false; }
      return true;
    };
    bModem.shouldDeliver = (raw) => {
      const unit = decodeFas1(raw);
      if (unit.type === Fas1UnitType.Ack && !droppedAck) { droppedAck = true; return false; }
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), clock, timers });
    const b = new AcousticSession({ ...options('B', bModem), clock, timers, onPacket: (packet) => received.push(packet) });
    a.start(); await settlePair(a, b);
    expect(a.enqueuePacket(new Uint8Array(1_357).fill(7), 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 32; round += 1) timers.runAll();
    expect(received).toHaveLength(1);
    const data = aModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Data);
    expect(data.filter((unit) => unit.fragmentIndex === 2).length).toBeGreaterThan(1);
    expect(data.filter((unit) => unit.fragmentIndex >= 4)).toHaveLength(11);
    expect(a.snapshot.counters.retries).toBeGreaterThan(0);
  });
});

describe('AcousticSession priority, backpressure, heartbeat, degraded recovery, and concurrency', () => {
  it('uses stable control, heartbeat, ordinary priority with FIFO within each class and rejects a fifth complete packet before retaining bytes', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession({ ...options('A', aModem), clock, timers }); const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b); b.heartbeat();
    expect(b.enqueuePacket(Uint8Array.of(1), 'ordinary').accepted).toBe(true);
    expect(b.enqueuePacket(Uint8Array.of(2), 'control').accepted).toBe(true);
    expect(b.enqueuePacket(Uint8Array.of(3), 'heartbeat').accepted).toBe(true);
    expect(b.enqueuePacket(Uint8Array.of(4), 'ordinary').accepted).toBe(true);
    expect(b.enqueuePacket(Uint8Array.of(5), 'ordinary')).toEqual({ accepted: false, reason: 'acoustic_queue_full' });
    expect(b.snapshot.counters).toMatchObject({ queuedPackets: 4, queuedBytes: 4 });

    expect(a.enqueuePacket(Uint8Array.of(9), 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 16; round += 1) timers.runAll();
    const bData = bModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Data).map((unit) => unit.body[0]);
    expect(bData).toEqual([2, 3, 1, 4]);
  });

  it('disarms once on repeated missed heartbeats, accepts only a current-session heartbeat for finite recovery, and reaches one terminal error on exhaustion', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession({ ...options('A', aModem), clock, timers }); const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b); b.heartbeat();
    a.markHeartbeatMissed(); a.markHeartbeatMissed();
    expect(a.snapshot).toMatchObject({ state: 'Degraded', ready: false, reason: 'acoustic_heartbeat_missed' });
    timers.runAll();
    expect(a.snapshot).toMatchObject({ state: 'Recovering', ready: false });
    b.heartbeat();
    expect(a.snapshot).toMatchObject({ state: 'Ready', ready: true });

    a.markHeartbeatMissed(); timers.runAll(); a.markHeartbeatMissed(); timers.runAll(); a.markHeartbeatMissed(); timers.runAll();
    expect(a.snapshot).toMatchObject({ state: 'Error', ready: false, reason: 'acoustic_recovery_exhausted' });
    expect(a.snapshot.counters.queuedPackets).toBe(0);
  });
});
