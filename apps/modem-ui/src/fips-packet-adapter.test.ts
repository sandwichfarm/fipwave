import { describe, expect, it, vi } from 'vitest';

import { FipsTrafficClass } from '../../../packages/bridge/src/protocol.js';
import { createFipsPacketAdapter } from './fips-packet-adapter.js';

describe('FipsPacketAdapter', () => {
  it('delivers copied complete opaque bytes and every validated class only for the armed generation', () => {
    const received = vi.fn();
    const emitted = vi.fn();
    const adapter = createFipsPacketAdapter({ onPacket: received, emitPacket: emitted });

    adapter.arm(7, 3);
    for (const trafficClass of [FipsTrafficClass.Control, FipsTrafficClass.Heartbeat, FipsTrafficClass.Ordinary]) {
      const bytes = new Uint8Array([trafficClass, 1, 2, 255]);
      expect(adapter.receive(bytes, trafficClass, 7, 3)).toEqual({ accepted: true });
      bytes[0] = 99;
      expect(received.mock.calls.at(-1)?.[0]).toEqual({ bytes: new Uint8Array([trafficClass, 1, 2, 255]), trafficClass });
      expect(received.mock.calls.at(-1)?.[0].bytes).not.toBe(bytes);
    }

    const bytes = new Uint8Array([0, 1, 2, 255]);
    expect(adapter.receive(bytes, FipsTrafficClass.Control, 6, 3)).toEqual({ accepted: false, reason: 'stale' });
    expect(adapter.receive(bytes, FipsTrafficClass.Control, 7, 2)).toEqual({ accepted: false, reason: 'stale' });
    expect(adapter.receive(bytes, 99 as FipsTrafficClass, 7, 3)).toEqual({ accepted: false, reason: 'invalid' });
    expect(received).toHaveBeenCalledTimes(3);
  });

  it('emits copied complete bytes with an explicit class and defaults legacy callers to ordinary', () => {
    const received = vi.fn();
    const emitted = vi.fn();
    const adapter = createFipsPacketAdapter({ onPacket: received, emitPacket: emitted });
    const bytes = new Uint8Array([9, 8, 7]);

    expect(adapter.send(bytes)).toEqual({ accepted: false, reason: 'not-armed' });
    adapter.arm(4, 1);
    expect(adapter.send(bytes, FipsTrafficClass.Heartbeat)).toEqual({ accepted: true });
    expect(adapter.send(bytes)).toEqual({ accepted: true });
    bytes[0] = 42;
    expect(emitted).toHaveBeenNthCalledWith(1, { bytes: new Uint8Array([9, 8, 7]), trafficClass: FipsTrafficClass.Heartbeat });
    expect(emitted).toHaveBeenNthCalledWith(2, { bytes: new Uint8Array([9, 8, 7]), trafficClass: FipsTrafficClass.Ordinary });
    expect(adapter.send(new Uint8Array([1]), 99 as FipsTrafficClass)).toEqual({ accepted: false, reason: 'invalid' });
    adapter.invalidate();
    expect(adapter.send(bytes)).toEqual({ accepted: false, reason: 'not-armed' });
    expect(adapter.receive(bytes, FipsTrafficClass.Control, 4, 1)).toEqual({ accepted: false, reason: 'not-armed' });
  });
});
