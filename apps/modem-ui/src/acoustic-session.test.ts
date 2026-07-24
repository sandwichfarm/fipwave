import { describe, expect, it } from 'vitest';

import { AcousticSession, type AcousticModem, type AcousticSessionOptions } from './acoustic-session.js';

class FakeModem implements AcousticModem {
  #handler: ((unit: Uint8Array) => void) | undefined;
  peer: FakeModem | undefined;
  readonly sent: Uint8Array[] = [];

  send(unit: Uint8Array): void {
    this.sent.push(unit.slice());
    this.peer?.#handler?.(unit.slice());
  }

  onUnit(handler: (unit: Uint8Array) => void): () => void {
    this.#handler = handler;
    return () => { if (this.#handler === handler) this.#handler = undefined; };
  }
}

const candidate = {
  id: 'quiet-bootstrap-96-v1',
  profileId: 'quiet-audible-7k-v1',
  payloadBytes: 96,
  repetition: 1,
  guardMs: 750,
  playbackGain: 1,
  ackTimeoutMs: 1_500,
} as const;

function options(role: 'A' | 'B', modem: FakeModem): AcousticSessionOptions {
  return {
    role,
    identity: role === 'A' ? 'npub-a' : 'npub-b',
    expectedPeer: role === 'A' ? 'npub-b' : 'npub-a',
    modem,
    clock: { now: () => 0 },
    timers: { setTimeout: () => 0, clearTimeout: () => undefined },
    nonce: () => new Uint8Array(role === 'A' ? Array(16).fill(1) : Array(16).fill(2)),
    profiles: ['quiet-audible-7k-v1'],
    ranges: { minPayloadBytes: 96, maxPayloadBytes: 217 },
    candidates: [candidate],
    calibration: { probesPerDirection: 4, maxCandidates: 3, deadlineMs: 120_000 },
  };
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
    expect(a.snapshot.state).toBe('CalibratingAToB');
    expect(b.snapshot.state).toBe('CalibratingAToB');
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
    expect(a.snapshot).toMatchObject({ state: 'Idle', epoch: 2, ready: false, sessionId: undefined });
    (a as unknown as { receive(unit: Uint8Array): void }).receive(late);
    expect(a.snapshot.state).toBe('Idle');
  });
});
