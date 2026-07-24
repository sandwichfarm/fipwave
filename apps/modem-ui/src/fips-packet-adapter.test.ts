import { describe, expect, it, vi } from 'vitest';

import { createFipsPacketAdapter } from './fips-packet-adapter.js';

describe('FipsPacketAdapter', () => {
  it('delivers complete opaque bytes exactly once only for the armed generation', () => {
    const received = vi.fn();
    const emitted = vi.fn();
    const adapter = createFipsPacketAdapter({ onPacket: received, emitPacket: emitted });
    const bytes = new Uint8Array([0, 1, 2, 255]);

    expect(adapter.receive(bytes, 7, 3)).toEqual({ accepted: false, reason: 'not-armed' });
    adapter.arm(7, 3);
    expect(adapter.receive(bytes, 7, 3)).toEqual({ accepted: true });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0]?.[0]).toEqual(bytes);
    expect(received.mock.calls[0]?.[0]).not.toBe(bytes);
    expect(adapter.receive(bytes, 6, 3)).toEqual({ accepted: false, reason: 'stale' });
    expect(adapter.receive(bytes, 7, 2)).toEqual({ accepted: false, reason: 'stale' });
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('emits complete bytes only while armed and invalidates old lifecycle work', () => {
    const received = vi.fn();
    const emitted = vi.fn();
    const adapter = createFipsPacketAdapter({ onPacket: received, emitPacket: emitted });
    const bytes = new Uint8Array([9, 8, 7]);

    expect(adapter.send(bytes)).toEqual({ accepted: false, reason: 'not-armed' });
    adapter.arm(4, 1);
    expect(adapter.send(bytes)).toEqual({ accepted: true });
    expect(emitted).toHaveBeenCalledWith(bytes);
    adapter.invalidate();
    expect(adapter.send(bytes)).toEqual({ accepted: false, reason: 'not-armed' });
    expect(adapter.receive(bytes, 4, 1)).toEqual({ accepted: false, reason: 'not-armed' });
  });
});
