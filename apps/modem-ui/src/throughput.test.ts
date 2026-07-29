import { describe, expect, it } from 'vitest';

import { formatBitRate, ThroughputTracker } from './throughput.js';

describe('ThroughputTracker', () => {
  it('reports rolling acknowledged/delivered payload bits and decays to zero', () => {
    const tracker = new ThroughputTracker(3_000);
    expect(tracker.sample(0, { txBytes: 0, rxBytes: 0 })).toEqual({ txBitsPerSecond: 0, rxBitsPerSecond: 0 });
    expect(tracker.sample(1_000, { txBytes: 125, rxBytes: 250 })).toEqual({ txBitsPerSecond: 1_000, rxBitsPerSecond: 2_000 });
    expect(tracker.sample(4_500, { txBytes: 125, rxBytes: 250 })).toEqual({ txBitsPerSecond: 0, rxBitsPerSecond: 0 });
  });

  it('resets safely when an epoch replaces monotonic counters', () => {
    const tracker = new ThroughputTracker();
    tracker.sample(1_000, { txBytes: 1_000, rxBytes: 1_000 });
    tracker.sample(2_000, { txBytes: 2_000, rxBytes: 3_000 });
    expect(tracker.sample(3_000, { txBytes: 0, rxBytes: 0 })).toEqual({ txBitsPerSecond: 0, rxBitsPerSecond: 0 });
    expect(tracker.sample(4_000, { txBytes: 125, rxBytes: 0 })).toEqual({ txBitsPerSecond: 1_000, rxBitsPerSecond: 0 });
  });

  it('formats live rates using bps, kbps, and Mbps thresholds', () => {
    expect(formatBitRate(0)).toBe('0 bps');
    expect(formatBitRate(999)).toBe('999 bps');
    expect(formatBitRate(1_250)).toBe('1.3 kbps');
    expect(formatBitRate(125_000)).toBe('125 kbps');
    expect(formatBitRate(1_250_000)).toBe('1.3 Mbps');
    expect(() => formatBitRate(-1)).toThrow();
  });
});
