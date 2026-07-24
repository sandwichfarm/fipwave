import { describe, expect, it, vi } from 'vitest';

import { FipsTrafficClass } from '../../../packages/bridge/src/protocol.js';
import { AcousticSessionAdapter } from './acoustic-session-adapter.js';
import type { AcousticSessionSnapshot, AcousticTrafficClass } from './acoustic-session.js';

function session(ready = false) {
  let snapshot: Pick<AcousticSessionSnapshot, 'epoch' | 'ready' | 'state'> = { epoch: 7, ready, state: ready ? 'Ready' : 'AwaitingHeartbeat' };
  return {
    get snapshot() { return snapshot; },
    queued: [] as Array<{ bytes: Uint8Array; trafficClass: string }>,
    enqueuePacket(bytes: Uint8Array, trafficClass: AcousticTrafficClass) {
      this.queued.push({ bytes: bytes.slice(), trafficClass });
      return { accepted: true };
    },
    reset: vi.fn((epoch: number) => { snapshot = { epoch, ready: false, state: 'Idle' }; }),
    markHeartbeatMissed: vi.fn(() => { snapshot = { ...snapshot, ready: false, state: 'Degraded' }; }),
    setReady(value: boolean) { snapshot = { ...snapshot, ready: value, state: value ? 'Ready' : 'AwaitingHeartbeat' }; },
  };
}

describe('AcousticSessionAdapter', () => {
  it('admits only complete copied FIPS packets after a committed current heartbeat and emits reassembled bytes once', () => {
    const link = session(false);
    const emit = vi.fn();
    const controls = { ready: vi.fn(), disarm: vi.fn() };
    const adapter = new AcousticSessionAdapter({ session: link, emitPacket: emit, controls });
    const packet = Uint8Array.from({ length: 1_357 }, (_, index) => index & 0xff);

    expect(adapter.receiveFips(packet, FipsTrafficClass.Heartbeat, 7)).toEqual({ accepted: false, reason: 'not-armed' });
    expect(link.queued).toHaveLength(0);
    link.setReady(true); adapter.refresh();
    expect(adapter.receiveFips(packet, FipsTrafficClass.Heartbeat, 7)).toEqual({ accepted: true });
    packet[0] = 99;
    expect(link.queued).toEqual([{ bytes: Uint8Array.from({ length: 1_357 }, (_, index) => index & 0xff), trafficClass: 'heartbeat' }]);

    const delivered = Uint8Array.from({ length: 1_357 }, (_, index) => (255 - index) & 0xff);
    expect(adapter.deliver(delivered, FipsTrafficClass.Ordinary)).toEqual({ accepted: true });
    delivered[0] = 0;
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ bytes: Uint8Array.from({ length: 1_357 }, (_, index) => (255 - index) & 0xff) }));
    expect(controls.ready).toHaveBeenCalledWith(7);
  });

  it('disarms before reset/degradation and rejects late-generation callbacks', () => {
    const link = session(true);
    const controls = { ready: vi.fn(), disarm: vi.fn() };
    const adapter = new AcousticSessionAdapter({ session: link, emitPacket: vi.fn(), controls });
    adapter.refresh();
    const generation = adapter.generation;
    adapter.reset(8);
    expect(controls.disarm).toHaveBeenCalledWith(7);
    expect(adapter.receiveFips(new Uint8Array([1]), FipsTrafficClass.Control, 7, generation)).toEqual({ accepted: false, reason: 'stale' });
    link.setReady(true); adapter.refresh();
    adapter.markDegraded();
    expect(adapter.ready).toBe(false);
    expect(adapter.deliver(new Uint8Array([1]), FipsTrafficClass.Control, generation)).toEqual({ accepted: false, reason: 'stale' });
  });
});
