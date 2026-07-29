import { describe, expect, it } from 'vitest';

import { AcousticSession, type AcousticModem, type AcousticSessionOptions, type AcousticTransmitMode } from './acoustic-session.js';
import { decodeFas1, encodeFas1, Fas1Sender, Fas1UnitType } from './acoustic-protocol.js';
import { SerialTransmissionQueue } from './quiet-client.js';

class FakeModem implements AcousticModem {
  #handler: ((unit: Uint8Array) => void) | undefined;
  peer: FakeModem | undefined;
  readonly sent: Uint8Array[] = [];
  readonly sentModes: AcousticTransmitMode[] = [];
  shouldDeliver: ((unit: Uint8Array) => boolean) | undefined;
  transform: ((unit: Uint8Array) => Uint8Array) | undefined;
  readonly appliedCandidates: string[] = [];

  send(unit: Uint8Array, mode: AcousticTransmitMode = 'data'): void {
    this.sent.push(unit.slice());
    this.sentModes.push(mode);
    if (this.shouldDeliver?.(unit) === false) return;
    if (this.peer && this.peer.#handler) this.peer.#handler(this.transform ? this.transform(unit.slice()) : unit.slice());
  }

  onUnit(handler: (unit: Uint8Array) => void): () => void {
    this.#handler = handler;
    return () => { if (this.#handler === handler) this.#handler = undefined; };
  }

  applyCandidate(candidate: { id: string }): void { this.appliedCandidates.push(candidate.id); }
}

class DeferredModem extends FakeModem {
  defer = false;
  readonly pending: Array<{ release(): void; reject(error: Error): void }> = [];

  override send(unit: Uint8Array, mode: AcousticTransmitMode = 'data'): void | Promise<void> {
    if (!this.defer) return super.send(unit, mode);
    return new Promise<void>((resolve, reject) => {
      this.pending.push({
        release: () => { super.send(unit, mode); resolve(); },
        reject,
      });
    });
  }

  releaseNext(): void { this.pending.shift()?.release(); }
  rejectNext(error = new Error('playback failed')): void { this.pending.shift()?.reject(error); }
}

/**
 * Silent end-to-end modem seam with the same asynchronous FIFO contract as
 * QuietClient. Unlike FakeModem, a send does not reach the peer synchronously.
 */
class SerialLoopbackModem implements AcousticModem {
  #handler: ((unit: Uint8Array) => void) | undefined;
  #queue = new SerialTransmissionQueue();
  #tail: Promise<void> = Promise.resolve();
  #active = 0;
  pending = 0;
  maxActive = 0;
  loopback = false;
  peer: SerialLoopbackModem | undefined;
  readonly sent: Uint8Array[] = [];

  send(unit: Uint8Array): Promise<void> {
    const copied = unit.slice();
    this.pending += 1;
    const completion = this.#queue.enqueue(async () => {
      this.#active += 1;
      this.maxActive = Math.max(this.maxActive, this.#active);
      await Promise.resolve();
      this.sent.push(copied);
      if (this.loopback) this.#handler?.(copied.slice());
      const peer = this.peer;
      if (peer) peer.#handler?.(copied.slice());
      this.#active -= 1;
    });
    this.#tail = completion.finally(() => { this.pending -= 1; }).catch(() => undefined);
    return completion;
  }

  onUnit(handler: (unit: Uint8Array) => void): () => void {
    this.#handler = handler;
    return () => { if (this.#handler === handler) this.#handler = undefined; };
  }

  applyCandidate(): void {}

  async settle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.#tail;
      await current;
    } while (current !== this.#tail);
  }
}

class FakeTimers {
  #callbacks = new Map<number, { callback: () => void; dueAtMs: number }>();
  #next = 1;
  #nowMs = 0;
  setTimeout(callback: () => void, delayMs = 0): ReturnType<typeof setTimeout> { const id = this.#next++; this.#callbacks.set(id, { callback, dueAtMs: this.#nowMs + delayMs }); return id as unknown as ReturnType<typeof setTimeout>; }
  clearTimeout(handle: ReturnType<typeof setTimeout>): void { this.#callbacks.delete(handle as unknown as number); }
  count(delayMs: number): number { return [...this.#callbacks.values()].filter((entry) => entry.dueAtMs - this.#nowMs === delayMs).length; }
  runAll(): void {
    const nextDueAtMs = Math.min(...[...this.#callbacks.values()].map((entry) => entry.dueAtMs));
    this.#nowMs = nextDueAtMs;
    const callbacks = [...this.#callbacks.entries()].filter(([, entry]) => entry.dueAtMs === nextDueAtMs);
    for (const [id] of callbacks) this.#callbacks.delete(id);
    for (const [, entry] of callbacks) entry.callback();
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

function options(role: 'A' | 'B', modem: AcousticModem): AcousticSessionOptions {
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
  it('reaches readiness and transfers byte-perfect packets both ways through the asynchronous serialized playback contract', async () => {
    const aModem = new SerialLoopbackModem();
    const bModem = new SerialLoopbackModem();
    aModem.peer = bModem;
    bModem.peer = aModem;
    // Real laptop microphones decode their own speaker output. Sender-role
    // binding must make that loopback inert while retaining peer delivery.
    aModem.loopback = true;
    bModem.loopback = true;
    const receivedA: Uint8Array[] = [];
    const receivedB: Uint8Array[] = [];
    const a = new AcousticSession({ ...options('A', aModem), onPacket: (packet) => receivedA.push(packet) });
    const b = new AcousticSession({ ...options('B', bModem), onPacket: (packet) => receivedB.push(packet) });
    const settleSerializedPair = async (): Promise<void> => {
      let idleSweeps = 0;
      for (let round = 0; round < 64; round += 1) {
        await aModem.settle();
        await bModem.settle();
        await a.settle();
        await b.settle();
        await Promise.resolve();
        idleSweeps = aModem.pending + bModem.pending === 0 ? idleSweeps + 1 : 0;
        if (idleSweeps === 2) return;
      }
      throw new Error('serialized acoustic pair did not settle');
    };

    expect(a.start()).toBe(true);
    await settleSerializedPair();

    expect({ a: a.snapshot, b: b.snapshot }).toMatchObject({
      a: { state: 'Ready', ready: true, turnOwner: 'A' },
      b: { state: 'Ready', ready: true, turnOwner: 'A' },
    });
    expect(a.snapshot.sessionId).toBe(b.snapshot.sessionId);
    expect(a.snapshot.settingsDigest).toEqual(b.snapshot.settingsDigest);
    expect(a.snapshot.ledger).toHaveLength(8);
    expect(b.snapshot.ledger).toHaveLength(8);

    const toB = Uint8Array.from({ length: 257 }, (_, index) => index & 0xff);
    const toA = Uint8Array.from({ length: 257 }, (_, index) => (255 - index) & 0xff);
    expect(a.enqueuePacket(toB, 'ordinary').accepted).toBe(true);
    await settleSerializedPair();
    expect(receivedB).toEqual([toB]);
    expect(b.enqueuePacket(toA, 'ordinary').accepted).toBe(true);
    await settleSerializedPair();
    expect(receivedA).toEqual([toA]);

    expect(aModem.maxActive).toBe(1);
    expect(bModem.maxActive).toBe(1);
    expect(aModem.pending + bModem.pending).toBe(0);
  });

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

  it('marks only identity, capability, commitment, and reset units for robust ceremony transmission', async () => {
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession(options('A', aModem)); const b = new AcousticSession(options('B', bModem));
    a.start(); await settlePair(a, b);
    const sent = [...aModem.sent.map((raw, index) => ({ unit: decodeFas1(raw), mode: aModem.sentModes[index] })), ...bModem.sent.map((raw, index) => ({ unit: decodeFas1(raw), mode: bModem.sentModes[index] }))];
    for (const entry of sent) {
      const ceremony = [Fas1UnitType.Hello, Fas1UnitType.HelloAck, Fas1UnitType.Caps, Fas1UnitType.Commit, Fas1UnitType.CommitAck, Fas1UnitType.Reset].includes(entry.unit.type);
      expect(entry.mode).toBe(ceremony ? 'ceremony' : 'data');
    }
    expect(sent.some((entry) => entry.unit.type === Fas1UnitType.Probe && entry.mode === 'data')).toBe(true);
  });

  it('re-handshakes but skips calibration on an exact same-epoch proven-settings resume', async () => {
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    let aNonce = 1; let bNonce = 20; let measurements = 0;
    const nonce = (value: number): Uint8Array => { const output = new Uint8Array(16); output[0] = value; output[8] = 0x80; return output; };
    const a = new AcousticSession({ ...options('A', aModem), nonce: () => nonce(aNonce++), measureProbe: (probe) => { measurements += 1; return options('A', aModem).measureProbe(probe); } });
    const b = new AcousticSession({ ...options('B', bModem), nonce: () => nonce(bNonce++), measureProbe: (probe) => { measurements += 1; return options('B', bModem).measureProbe(probe); } });
    a.start(); await settlePair(a, b);
    expect({ a: a.snapshot.ready, b: b.snapshot.ready, measurements }).toEqual({ a: true, b: true, measurements: 8 });
    const firstDigest = a.snapshot.settingsDigest;

    a.reset(0); b.reset(0);
    expect(a.start()).toBe(true);
    await settlePair(a, b);

    expect({ a: a.snapshot.ready, b: b.snapshot.ready }).toEqual({ a: true, b: true });
    expect(a.snapshot.settingsDigest).toEqual(firstDigest);
    expect(a.snapshot.ledger).toHaveLength(0);
    expect(b.snapshot.ledger).toHaveLength(0);
    expect(measurements).toBe(8);
    expect(a.snapshot.counters.warmResumes).toBe(1);
    expect(b.snapshot.counters.warmResumes).toBe(1);

    a.reset(1); b.reset(1);
    a.start(); await settlePair(a, b);
    expect(measurements).toBe(16);
    expect(a.snapshot.ledger).toHaveLength(8);
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
    const identityOffset = 3;
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

  it('brings both peers to Ready through the two-frame fast bootstrap without calibration probes', async () => {
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    let aReady = 0; let bReady = 0;
    const a = new AcousticSession({ ...options('A', aModem), fastBootstrap: true, onReady: () => { aReady += 1; } });
    const b = new AcousticSession({ ...options('B', bModem), fastBootstrap: true, onReady: () => { bReady += 1; } });

    a.start();
    await Promise.all([a.settle(), b.settle()]);

    expect(a.snapshot).toMatchObject({ state: 'Ready', ready: true, ledger: [] });
    expect(b.snapshot).toMatchObject({ state: 'Ready', ready: true, ledger: [] });
    expect({ aReady, bReady }).toEqual({ aReady: 1, bReady: 1 });
    expect(aModem.sent.map((raw) => decodeFas1(raw).type)).toEqual([Fas1UnitType.Hello]);
    expect(bModem.sent.map((raw) => decodeFas1(raw).type)).toEqual([Fas1UnitType.HelloAck]);
  });

  it('piggybacks fast-control acknowledgements on the three-message FIPS handshake', async () => {
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const receivedA: Uint8Array[] = []; const receivedB: Uint8Array[] = [];
    let a: AcousticSession; let b: AcousticSession;
    a = new AcousticSession({
      ...options('A', aModem),
      fastBootstrap: true,
      onPacket: (packet) => {
        receivedA.push(packet);
        if (packet[0] === 2) a.enqueuePacket(Uint8Array.of(3), 'control');
      },
    });
    b = new AcousticSession({
      ...options('B', bModem),
      fastBootstrap: true,
      onPacket: (packet) => {
        receivedB.push(packet);
        if (packet[0] === 1) b.enqueuePacket(Uint8Array.of(2), 'control');
      },
    });

    a.start();
    await settlePair(a, b);
    aModem.sent.splice(0); bModem.sent.splice(0);

    expect(a.enqueuePacket(Uint8Array.of(1), 'control')).toMatchObject({ accepted: true });
    await settlePair(a, b);
    await Promise.resolve();
    await settlePair(a, b);

    expect(receivedA).toEqual([Uint8Array.of(2)]);
    expect(receivedB).toEqual([Uint8Array.of(1), Uint8Array.of(3)]);
    const units = [...aModem.sent, ...bModem.sent].map(decodeFas1);
    expect(units.filter((unit) => unit.type === Fas1UnitType.Data)).toHaveLength(3);
    expect(units.filter((unit) => unit.type === Fas1UnitType.Ack)).toHaveLength(0);
    expect(units.some((unit) => unit.type === Fas1UnitType.TurnEnd)).toBe(false);
    expect(units.filter((unit) => unit.type === Fas1UnitType.Data).every((unit) => (unit.sequence & 0x8000_0000) !== 0)).toBe(true);
    expect(units.filter((unit) => unit.type === Fas1UnitType.Data).map((unit) => unit.sequence & 0x7fff_ffff)).toEqual([0, 1, 1]);
  });

  it('sends one bounded standalone ACK when a fast-control packet has no immediate response', async () => {
    const timers = new FakeTimers();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession({ ...options('A', aModem), fastBootstrap: true });
    const b = new AcousticSession({ ...options('B', bModem), timers, fastBootstrap: true });

    a.start();
    await settlePair(a, b);
    aModem.sent.splice(0); bModem.sent.splice(0);
    expect(a.enqueuePacket(Uint8Array.of(1), 'control')).toMatchObject({ accepted: true });
    expect(bModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Ack)).toHaveLength(0);

    timers.runAll();
    expect(bModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Ack)).toHaveLength(1);
  });

  it('falls back to an ordinary calibration HELLO after bounded fast-bootstrap misses', async () => {
    const timers = new FakeTimers(); const modem = new FakeModem();
    const a = new AcousticSession({ ...options('A', modem), timers, fastBootstrap: true });

    a.start();
    for (let attempt = 0; attempt < 3; attempt += 1) { await a.settle(); timers.runAll(); }
    await a.settle();

    const finalHello = decodeFas1(modem.sent.at(-1)!);
    expect(finalHello.type).toBe(Fas1UnitType.Hello);
    // Handshake v2: byte 2 carries the explicit fast-bootstrap request.
    expect(finalHello.body[2]).toBe(0);
    expect(a.snapshot).toMatchObject({ state: 'HelloSent', ready: false });
  });

  it('does not allow duplicate or out-of-order controls to skip the legal sequence', () => {
    const modem = new FakeModem();
    const b = new AcousticSession(options('B', modem));
    const rawCaps = encodeFas1({ type: Fas1UnitType.Caps, flags: Fas1Sender.A, sessionId: 1n, sequence: 1, packetId: 0, fragmentIndex: 0, fragmentCount: 0, packetLength: 0, body: new Uint8Array(32) });
    b.receive(rawCaps);
    b.receive(rawCaps);
    expect(b.snapshot.state).toBe('Listening');
  });

  it('retries a lost capability frame and completes the handshake without operator ordering', async () => {
    const timers = new FakeTimers();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    let droppedCaps = false;
    aModem.shouldDeliver = (raw) => {
      if (!droppedCaps && decodeFas1(raw).type === Fas1UnitType.Caps) { droppedCaps = true; return false; }
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), timers });
    const b = new AcousticSession({ ...options('B', bModem), timers });

    a.start();
    expect({ a: a.snapshot.state, b: b.snapshot.state }).toEqual({ a: 'CapsSent', b: 'HelloAckSent' });
    await settlePair(a, b);
    timers.runAll();
    await settlePair(a, b);

    expect(droppedCaps).toBe(true);
    expect({ a: a.snapshot.ready, b: b.snapshot.ready }).toEqual({ a: true, b: true });
    expect(a.snapshot.counters.retries + b.snapshot.counters.retries).toBeGreaterThan(0);
  });

  it('replays B capability after its first reply is lost and A retries from CapsSent', async () => {
    const timers = new FakeTimers();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    let droppedCapsReply = false;
    bModem.shouldDeliver = (raw) => {
      if (!droppedCapsReply && decodeFas1(raw).type === Fas1UnitType.Caps) {
        droppedCapsReply = true;
        return false;
      }
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), timers });
    const b = new AcousticSession({ ...options('B', bModem), timers });

    a.start();
    expect(droppedCapsReply).toBe(true);
    expect({ a: a.snapshot.state, b: b.snapshot.state }).toEqual({ a: 'CapsSent', b: 'CalibratingAToB' });
    await settlePair(a, b);
    timers.runAll();
    await settlePair(a, b);

    expect({ a: a.snapshot.ready, b: b.snapshot.ready }).toEqual({ a: true, b: true });
    expect(a.snapshot.counters.retries).toBeGreaterThan(0);
    expect(b.snapshot.counters.duplicates).toBeGreaterThan(0);
  });

  it('starts each handshake retry timeout only after the preceding playback completes', async () => {
    const timers = new FakeTimers();
    const modem = new DeferredModem();
    modem.defer = true;
    const a = new AcousticSession({ ...options('A', modem), timers });

    expect(a.start()).toBe(true);
    expect(modem.pending).toHaveLength(1);
    expect(timers.count(2_500)).toBe(0);

    modem.releaseNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(timers.count(2_500)).toBe(1);

    timers.runAll();
    expect(modem.pending).toHaveLength(1);
    expect(timers.count(2_500)).toBe(0);
    modem.releaseNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(timers.count(2_500)).toBe(1);
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
  it('applies the exact configured candidate before each literal-direction probe', async () => {
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const candidates = [{ ...candidate, id: 'quiet-safe-1' }, { ...candidate, id: 'quiet-safe-2', payloadBytes: 97 }];
    const a = new AcousticSession({ ...options('A', aModem), candidates });
    const b = new AcousticSession({ ...options('B', bModem), candidates });
    a.start(); await settlePair(a, b);
    expect(aModem.appliedCandidates).toEqual(['quiet-safe-1', 'quiet-safe-1', 'quiet-safe-1', 'quiet-safe-1', 'quiet-safe-2', 'quiet-safe-2', 'quiet-safe-2', 'quiet-safe-2', 'quiet-safe-2']);
    expect(bModem.appliedCandidates).toEqual(['quiet-safe-1', 'quiet-safe-1', 'quiet-safe-1', 'quiet-safe-1', 'quiet-safe-2', 'quiet-safe-2', 'quiet-safe-2', 'quiet-safe-2', 'quiet-safe-2']);
  });

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

  it('retries a lost calibration report and replays the cached observation without stalling the sweep', async () => {
    const timers = new FakeTimers();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    let droppedReport = false;
    aModem.shouldDeliver = (raw) => {
      if (!droppedReport && decodeFas1(raw).type === Fas1UnitType.Report) { droppedReport = true; return false; }
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), timers });
    const b = new AcousticSession({ ...options('B', bModem), timers });

    a.start();
    expect(droppedReport).toBe(true);
    expect({ a: a.snapshot.state, b: b.snapshot.state }).toEqual({ a: 'CalibratingBToA', b: 'CalibratingBToA' });
    await settlePair(a, b);
    timers.runAll();
    await settlePair(a, b);

    expect({ a: a.snapshot.ready, b: b.snapshot.ready }).toEqual({ a: true, b: true });
    expect(a.snapshot.ledger).toHaveLength(8);
    expect(b.snapshot.ledger).toHaveLength(8);
    expect(a.snapshot.counters.duplicates).toBeGreaterThan(0);
    expect(b.snapshot.counters.retries).toBeGreaterThan(0);
  });

  it('retries a lost commit acknowledgement and replays the committed digest without stalling readiness', async () => {
    const timers = new FakeTimers();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    let droppedCommitAck = false;
    aModem.shouldDeliver = (raw) => {
      if (!droppedCommitAck && decodeFas1(raw).type === Fas1UnitType.CommitAck) { droppedCommitAck = true; return false; }
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), timers });
    const b = new AcousticSession({ ...options('B', bModem), timers });

    a.start();
    await settlePair(a, b);
    expect(droppedCommitAck).toBe(true);
    expect({ a: a.snapshot.state, b: b.snapshot.state }).toEqual({ a: 'AwaitingHeartbeat', b: 'Committing' });
    timers.runAll();
    await settlePair(a, b);

    expect({ a: a.snapshot.ready, b: b.snapshot.ready }).toEqual({ a: true, b: true });
    expect(a.snapshot.counters.duplicates).toBeGreaterThan(0);
    expect(b.snapshot.counters.retries).toBeGreaterThan(0);
  });

  it('retries COMMIT until a lost bootstrap heartbeat is received and acknowledged', async () => {
    const timers = new FakeTimers();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    let droppedBootstrapHeartbeat = false;
    aModem.shouldDeliver = (raw) => {
      if (!droppedBootstrapHeartbeat && decodeFas1(raw).type === Fas1UnitType.Heartbeat) {
        droppedBootstrapHeartbeat = true;
        return false;
      }
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), timers });
    const b = new AcousticSession({ ...options('B', bModem), timers });

    a.start();
    await settlePair(a, b);
    expect(droppedBootstrapHeartbeat).toBe(true);
    expect({ a: a.snapshot.state, b: b.snapshot.state }).toEqual({ a: 'AwaitingHeartbeat', b: 'AwaitingHeartbeat' });
    timers.runAll();
    await settlePair(a, b);

    expect({ a: a.snapshot.ready, b: b.snapshot.ready }).toEqual({ a: true, b: true });
    expect(a.snapshot.counters.duplicates).toBeGreaterThan(0);
    expect(b.snapshot.counters.retries).toBeGreaterThan(0);
  });

  it('sweeps a failed warm candidate through later fallbacks and commits different literal directional winners', async () => {
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const candidates = [
      { ...candidate, id: 'warm-bootstrap', payloadBytes: 96, playbackGain: 1 },
      { ...candidate, id: 'full-frame-fallback', payloadBytes: 217, playbackGain: 1 },
      { ...candidate, id: 'gain-fallback', payloadBytes: 96, playbackGain: 2 },
    ];
    const aOptions = options('A', aModem); const bOptions = options('B', bModem);
    // A receives B→A observations and selects the warm candidate; B receives
    // A→B observations where that warm candidate clips and must continue.
    const a = new AcousticSession({ ...aOptions, candidates, measureProbe: (probe) => ({ received: true, bytePerfect: true, corrupt: false, missing: false, duplicate: false, discontinuity: false, latencyMs: 10 + probe.candidateIndex, signalDb: -20, clipping: false, confidence: 1 }) });
    const b = new AcousticSession({ ...bOptions, candidates, measureProbe: (probe) => ({ received: true, bytePerfect: probe.candidateIndex !== 0, corrupt: probe.candidateIndex === 0, missing: false, duplicate: false, discontinuity: false, latencyMs: probe.candidateIndex === 1 ? 30 : 10, signalDb: -20, clipping: probe.candidateIndex === 0, confidence: 1 }) });
    a.start();
    await settlePair(a, b);
    expect(aModem.appliedCandidates).toContain('full-frame-fallback');
    expect(bModem.appliedCandidates).toContain('gain-fallback');
    expect(a.snapshot.settings?.aToB.playbackGain).toBe(2);
    expect(a.snapshot.settings?.bToA).toMatchObject({ payloadBytes: 96, playbackGain: 1 });
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

  it('keeps retrying recoverable calibration loss but rejects a mismatched COMMIT digest', async () => {
    const timers = new FakeTimers(); const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    aModem.shouldDeliver = (raw) => decodeFas1(raw).type !== Fas1UnitType.Probe;
    const a = new AcousticSession({ ...options('A', aModem), timers }); const b = new AcousticSession({ ...options('B', bModem), timers });
    a.start();
    for (let round = 0; round < 10; round += 1) timers.runAll();
    expect(a.snapshot).toMatchObject({ state: 'CalibratingAToB', ready: false });
    expect(b.snapshot).toMatchObject({ state: 'CalibratingAToB', ready: false });
    expect(a.snapshot.counters.retries).toBeGreaterThanOrEqual(10);

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
    expect(aModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Parity)).toHaveLength(4);
    expect(bModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Ack)).toHaveLength(2);

    expect(b.enqueuePacket(bPacket, 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 16; round += 1) timers.runAll();
    expect(receivedA).toHaveLength(1);
    expect(receivedA[0]).toEqual(bPacket);
  });

  it('recovers one missing DATA fragment from parity without another acoustic turn', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const received: Uint8Array[] = []; let dropped = false;
    aModem.shouldDeliver = (raw) => {
      const unit = decodeFas1(raw);
      if (unit.type === Fas1UnitType.Data && unit.fragmentIndex === 2 && !dropped) { dropped = true; return false; }
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), clock, timers });
    const b = new AcousticSession({ ...options('B', bModem), clock, timers, onPacket: (packet) => received.push(packet) });
    a.start(); await settlePair(a, b);
    expect(a.enqueuePacket(new Uint8Array(1_357).fill(7), 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 32; round += 1) timers.runAll();
    expect(received).toHaveLength(1);
    const data = aModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Data);
    expect(data.filter((unit) => unit.fragmentIndex === 2)).toHaveLength(1);
    expect(data.filter((unit) => unit.fragmentIndex >= 4)).toHaveLength(11);
    expect(b.snapshot.counters.recoveredFragments).toBe(1);
    expect(a.snapshot.counters.parityFramesTx).toBe(4);
    expect(a.snapshot.counters.deliveredBytesTx).toBe(1_357);
    expect(b.snapshot.counters.deliveredBytesRx).toBe(1_357);
  });

  it('falls back to bitmap retransmission when two DATA frames in one parity group are erased', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const received: Uint8Array[] = []; const erased = new Set([1, 2]);
    aModem.shouldDeliver = (raw) => {
      const unit = decodeFas1(raw);
      if (unit.type === Fas1UnitType.Data && erased.delete(unit.fragmentIndex)) return false;
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), clock, timers });
    const b = new AcousticSession({ ...options('B', bModem), clock, timers, onPacket: (packet) => received.push(packet) });
    a.start(); await settlePair(a, b);
    expect(a.enqueuePacket(new Uint8Array(400).fill(0x5a), 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 16; round += 1) timers.runAll();
    expect(received).toHaveLength(1);
    const data = aModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Data);
    expect(data.filter((unit) => unit.fragmentIndex === 1)).toHaveLength(2);
    expect(data.filter((unit) => unit.fragmentIndex === 2)).toHaveLength(2);
    expect(b.snapshot.counters.recoveredFragments).toBe(1);
    expect(a.snapshot.counters.retries).toBeGreaterThan(0);
  });

  it('preserves one token owner after a lost ACK and still drains queued packets in both directions', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const receivedA: Uint8Array[] = []; const receivedB: Uint8Array[] = []; let droppedAck = false;
    bModem.shouldDeliver = (raw) => {
      if (!droppedAck && decodeFas1(raw).type === Fas1UnitType.Ack) { droppedAck = true; return false; }
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), clock, timers, onPacket: (packet) => receivedA.push(packet) });
    const b = new AcousticSession({ ...options('B', bModem), clock, timers, onPacket: (packet) => receivedB.push(packet) });
    a.start(); await settlePair(a, b);

    expect(b.enqueuePacket(Uint8Array.of(0xb0), 'ordinary').accepted).toBe(true);
    expect(a.enqueuePacket(Uint8Array.of(0xa0), 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 32; round += 1) timers.runAll();

    expect(droppedAck).toBe(true);
    expect(receivedA).toEqual([Uint8Array.of(0xb0)]);
    expect(receivedB).toEqual([Uint8Array.of(0xa0)]);
    expect(a.snapshot.turnOwner).toBe(b.snapshot.turnOwner);
  });

  it('ignores a held prior-session/packet ACK while a new packet has its own active turn', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const receivedA: Uint8Array[] = []; const receivedB: Uint8Array[] = []; let heldAck: Uint8Array | undefined; let heldCurrentAck: Uint8Array | undefined; let hold = true; let holdCurrent = false;
    bModem.shouldDeliver = (raw) => {
      const unit = decodeFas1(raw);
      if (unit.type === Fas1UnitType.Ack && hold && !heldAck) { heldAck = raw.slice(); return false; }
      if (unit.type === Fas1UnitType.Ack && holdCurrent && !heldCurrentAck) { heldCurrentAck = raw.slice(); return false; }
      return true;
    };
    const a = new AcousticSession({ ...options('A', aModem), clock, timers, onPacket: (packet) => receivedA.push(packet) });
    const b = new AcousticSession({ ...options('B', bModem), clock, timers, onPacket: (packet) => receivedB.push(packet) });
    a.start(); await settlePair(a, b);

    expect(a.enqueuePacket(Uint8Array.of(1), 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 8; round += 1) timers.runAll();
    expect(heldAck).toBeDefined();
    hold = false;
    for (let round = 0; round < 16; round += 1) timers.runAll();
    expect(receivedB).toEqual([Uint8Array.of(1)]);

    // B owns the next turn after A's acknowledged packet; give it one packet
    // so that A owns a fresh turn before queuing A's next packet.
    expect(b.enqueuePacket(Uint8Array.of(2), 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 16; round += 1) timers.runAll();
    expect(receivedA).toEqual([Uint8Array.of(2)]);

    holdCurrent = true;
    expect(a.enqueuePacket(Uint8Array.of(3), 'ordinary').accepted).toBe(true);
    a.receive(heldAck!); // old packet ID/session ACK is deliberately reordered.
    for (let round = 0; round < 12; round += 1) timers.runAll();
    expect(heldCurrentAck).toBeDefined();
    expect(a.snapshot.counters.retries).toBeGreaterThan(0);
    expect(aModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Data && unit.packetId === 2)).toHaveLength(2);
    holdCurrent = false;
    a.receive(heldCurrentAck!);
    expect(receivedB).toEqual([Uint8Array.of(1), Uint8Array.of(3)]);

    const oldSessionAck = heldAck!.slice();
    a.reset(2); b.reset(2);
    a.receive(oldSessionAck);
    expect(a.snapshot).toMatchObject({ epoch: 2, ready: false, state: 'Idle' });
  });
});

describe('AcousticSession priority, backpressure, heartbeat, degraded recovery, and concurrency', () => {
  it('arms ARQ only after delayed TURN_END playback settles and makes late or failed playback inert', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new DeferredModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    // Keep the peer ACK from completing the active packet before the local
    // playback boundary has armed its timeout.
    bModem.shouldDeliver = (raw) => decodeFas1(raw).type !== Fas1UnitType.Ack;
    const a = new AcousticSession({ ...options('A', aModem), clock, timers });
    const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b);
    const beforeAckTimer = timers.count(candidate.ackTimeoutMs);

    aModem.defer = true;
    expect(a.enqueuePacket(Uint8Array.of(7), 'ordinary').accepted).toBe(true);
    expect(aModem.pending).toHaveLength(3); // DATA, parity, and final TURN_END.
    aModem.releaseNext(); await Promise.resolve();
    expect(timers.count(candidate.ackTimeoutMs)).toBe(beforeAckTimer);
    aModem.releaseNext(); await Promise.resolve(); await Promise.resolve();
    expect(timers.count(candidate.ackTimeoutMs)).toBe(beforeAckTimer);
    aModem.releaseNext(); await Promise.resolve(); await Promise.resolve();
    expect(timers.count(candidate.ackTimeoutMs)).toBe(beforeAckTimer + 1);

    // A completion which arrives after authority is reset cannot revive the
    // old turn or install another retry timer.
    const lateTimers = new FakeTimers(); const lateA = new DeferredModem(); const lateB = new FakeModem(); lateA.peer = lateB; lateB.peer = lateA;
    lateB.shouldDeliver = (raw) => decodeFas1(raw).type !== Fas1UnitType.Ack;
    const late = new AcousticSession({ ...options('A', lateA), clock, timers: lateTimers });
    const latePeer = new AcousticSession({ ...options('B', lateB), clock, timers: lateTimers });
    late.start(); await settlePair(late, latePeer);
    lateA.defer = true;
    expect(late.enqueuePacket(Uint8Array.of(9), 'ordinary').accepted).toBe(true);
    lateA.releaseNext(); await Promise.resolve();
    lateA.releaseNext(); await Promise.resolve();
    late.reset(2);
    const afterResetTimers = lateTimers.count(candidate.ackTimeoutMs);
    expect(late.snapshot).toMatchObject({ state: 'Idle', epoch: 2 });
    lateA.releaseNext(); await Promise.resolve(); await Promise.resolve();
    expect(lateTimers.count(candidate.ackTimeoutMs)).toBe(afterResetTimers);

    const failedTimers = new FakeTimers(); const failedA = new DeferredModem(); const failedB = new FakeModem(); failedA.peer = failedB; failedB.peer = failedA;
    failedB.shouldDeliver = (raw) => decodeFas1(raw).type !== Fas1UnitType.Ack;
    const failed = new AcousticSession({ ...options('A', failedA), clock, timers: failedTimers });
    const failedPeer = new AcousticSession({ ...options('B', failedB), clock, timers: failedTimers });
    failed.start(); await settlePair(failed, failedPeer);
    failedA.defer = true;
    expect(failed.enqueuePacket(Uint8Array.of(8), 'ordinary').accepted).toBe(true);
    failedA.rejectNext(); await Promise.resolve(); await Promise.resolve();
    expect(failed.snapshot).toMatchObject({ state: 'Degraded', ready: false, reason: 'acoustic_modem_playback_failed' });
    expect(failed.snapshot.counters.retries).toBe(0);
    failedA.releaseNext(); await Promise.resolve();
    expect(failed.snapshot.counters.retries).toBe(0);
  });

  it('treats queued packet work as liveness and sends an idle heartbeat only after data', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession({ ...options('A', aModem), clock, timers }); const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b);
    expect(a.snapshot.turnOwner).toBe('A');

    // B's timer fires while A owns the acoustic turn: it queues work but
    // cannot touch the modem. Queued FIPS data wins the next local turn.
    const bBefore = bModem.sent.length;
    expect(b.heartbeat()).toBe(true);
    expect(bModem.sent).toHaveLength(bBefore);
    expect(b.enqueuePacket(Uint8Array.of(0x42), 'ordinary').accepted).toBe(true);
    expect(a.heartbeat()).toBe(true);
    expect(decodeFas1(aModem.sent.at(-2)!).type).toBe(Fas1UnitType.Heartbeat);
    expect(decodeFas1(aModem.sent.at(-1)!).type).toBe(Fas1UnitType.TurnEnd);

    for (let round = 0; round < 24; round += 1) timers.runAll();
    const bUnits = bModem.sent.slice(bBefore).map(decodeFas1);
    const heartbeatIndex = bUnits.findIndex((unit) => unit.type === Fas1UnitType.Heartbeat);
    const dataIndex = bUnits.findIndex((unit) => unit.type === Fas1UnitType.Data);
    expect(dataIndex).toBeGreaterThanOrEqual(0);
    expect(heartbeatIndex).toBeGreaterThan(dataIndex);
  });

  it('uses stable control, heartbeat, ordinary priority with FIFO and bounds the FIPS control burst queue at sixteen packets', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession({ ...options('A', aModem), clock, timers }); const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b); b.heartbeat();
    expect(b.enqueuePacket(Uint8Array.of(1), 'ordinary').accepted).toBe(true);
    const control = b.enqueuePacket(Uint8Array.of(2), 'control');
    expect(control.accepted).toBe(true);
    expect(b.enqueuePacket(Uint8Array.of(2), 'control')).toEqual({ accepted: true, packetId: control.packetId });
    expect(b.enqueuePacket(Uint8Array.of(3), 'heartbeat').accepted).toBe(true);
    expect(b.enqueuePacket(Uint8Array.of(4), 'ordinary').accepted).toBe(true);
    for (let value = 5; value <= 16; value += 1) expect(b.enqueuePacket(Uint8Array.of(value), 'ordinary').accepted).toBe(true);
    expect(b.enqueuePacket(Uint8Array.of(17), 'ordinary')).toEqual({ accepted: false, reason: 'acoustic_queue_full' });
    expect(b.snapshot.counters).toMatchObject({ duplicates: 1, queuedPackets: 16, queuedBytes: 16 });

    expect(a.enqueuePacket(Uint8Array.of(9), 'ordinary').accepted).toBe(true);
    for (let round = 0; round < 16; round += 1) timers.runAll();
    const bData = bModem.sent.map(decodeFas1).filter((unit) => unit.type === Fas1UnitType.Data).map((unit) => unit.body[0]);
    expect(bData.slice(0, 4)).toEqual([2, 3, 1, 4]);
  });

  it('does not let outbound idle heartbeats postpone the inbound liveness deadline', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession({ ...options('A', aModem), clock, timers }); const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b);
    aModem.shouldDeliver = () => false; bModem.shouldDeliver = () => false;

    for (let turn = 0; turn < 20 && (a.snapshot.ready || b.snapshot.ready); turn += 1) timers.runAll();

    expect(a.snapshot).toMatchObject({ state: 'Degraded', ready: false, reason: 'acoustic_heartbeat_missed' });
    expect(b.snapshot).toMatchObject({ state: 'Degraded', ready: false, reason: 'acoustic_heartbeat_missed' });
  });

  it('does not let permanently queued FIPS work suppress acoustic recovery', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new DeferredModem(); const bModem = new DeferredModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession({ ...options('A', aModem), clock, timers }); const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b);
    aModem.shouldDeliver = () => false; bModem.shouldDeliver = () => false;
    aModem.defer = true; bModem.defer = true;
    expect(a.enqueuePacket(Uint8Array.of(0xa0), 'control').accepted).toBe(true);
    expect(b.enqueuePacket(Uint8Array.of(0xb0), 'control').accepted).toBe(true);

    for (let turn = 0; turn < 100 && (a.snapshot.ready || b.snapshot.ready); turn += 1) timers.runAll();

    expect(a.snapshot).toMatchObject({ state: 'Degraded', ready: false, reason: 'acoustic_heartbeat_missed' });
    expect(b.snapshot).toMatchObject({ state: 'Degraded', ready: false, reason: 'acoustic_heartbeat_missed' });
  });

  it('recovers simultaneous heartbeat loss with an A-initiated probe and a B reply', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession({ ...options('A', aModem), clock, timers }); const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b); b.heartbeat();
    a.markHeartbeatMissed(); b.markHeartbeatMissed();
    expect({ a: a.snapshot, b: b.snapshot }).toMatchObject({
      a: { state: 'Degraded', ready: false, reason: 'acoustic_heartbeat_missed' },
      b: { state: 'Degraded', ready: false, reason: 'acoustic_heartbeat_missed' },
    });
    timers.runAll();
    timers.runAll();
    expect({ a: a.snapshot, b: b.snapshot }).toMatchObject({
      a: { state: 'Ready', ready: true, turnOwner: 'A' },
      b: { state: 'Ready', ready: true, turnOwner: 'A' },
    });
  });

  it('waits for the negotiated guard before B answers a recovery heartbeat', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    const a = new AcousticSession({ ...options('A', aModem), clock, timers }); const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b);
    const bFramesBeforeRecovery = bModem.sent.length;

    a.markHeartbeatMissed(); b.markHeartbeatMissed();
    timers.runAll();

    expect(a.snapshot.state).toBe('Recovering');
    expect(b.snapshot.state).toBe('Ready');
    expect(bModem.sent).toHaveLength(bFramesBeforeRecovery);

    timers.runAll();
    expect({ a: a.snapshot, b: b.snapshot }).toMatchObject({
      a: { state: 'Ready', ready: true, turnOwner: 'A' },
      b: { state: 'Ready', ready: true, turnOwner: 'A' },
    });
  });

  it('restarts an exhausted session in place and resynchronizes a stale Ready peer', async () => {
    const timers = new FakeTimers(); const clock = new ManualClock();
    const aModem = new FakeModem(); const bModem = new FakeModem(); aModem.peer = bModem; bModem.peer = aModem;
    let nonceValue = 1;
    const a = new AcousticSession({
      ...options('A', aModem),
      clock,
      timers,
      nonce: () => {
        const nonce = new Uint8Array(16);
        nonce[0] = nonceValue++;
        return nonce;
      },
    });
    const b = new AcousticSession({ ...options('B', bModem), clock, timers });
    a.start(); await settlePair(a, b);
    const originalSessionId = a.snapshot.sessionId;
    aModem.shouldDeliver = () => false; bModem.shouldDeliver = () => false;
    a.markHeartbeatMissed();

    for (let turn = 0; turn < 24 && a.snapshot.state !== 'HelloSent'; turn += 1) timers.runAll();
    expect(a.snapshot).toMatchObject({ state: 'HelloSent', ready: false });
    expect(a.snapshot.sessionId).not.toBe(originalSessionId);
    expect(b.snapshot).toMatchObject({ state: 'Ready', sessionId: originalSessionId });
    expect(a.snapshot.counters.retries).toBeGreaterThanOrEqual(3);

    aModem.shouldDeliver = undefined; bModem.shouldDeliver = undefined;
    for (let turn = 0; turn < 24 && (!a.snapshot.ready || !b.snapshot.ready); turn += 1) {
      timers.runAll();
      await settlePair(a, b);
    }

    expect({ a: a.snapshot, b: b.snapshot }).toMatchObject({
      a: { state: 'Ready', ready: true, turnOwner: 'A' },
      b: { state: 'Ready', ready: true, turnOwner: 'A' },
    });
    expect(a.snapshot.sessionId).toBe(b.snapshot.sessionId);
    expect(a.snapshot.sessionId).not.toBe(originalSessionId);
    expect(a.snapshot.ledger).toHaveLength(0);
    expect(b.snapshot.ledger).toHaveLength(0);
    expect(a.snapshot.counters.warmResumes).toBe(1);
    expect(b.snapshot.counters.warmResumes).toBe(1);
  });
});
