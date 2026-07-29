export interface ThroughputTotals {
  readonly txBytes: number;
  readonly rxBytes: number;
}

export interface ThroughputRate {
  readonly txBitsPerSecond: number;
  readonly rxBitsPerSecond: number;
}

interface Sample extends ThroughputTotals {
  readonly atMs: number;
}

function validCounter(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Rolling payload-rate tracker over monotonic acknowledged/delivered totals. */
export class ThroughputTracker {
  #samples: Sample[] = [];

  constructor(private readonly windowMs = 3_000) {
    if (!Number.isSafeInteger(windowMs) || windowMs < 250 || windowMs > 60_000) throw new Error('throughput window is invalid');
  }

  reset(): void {
    this.#samples = [];
  }

  sample(atMs: number, totals: ThroughputTotals): ThroughputRate {
    if (!Number.isFinite(atMs) || atMs < 0 || !validCounter(totals.txBytes) || !validCounter(totals.rxBytes)) throw new Error('throughput sample is invalid');
    const previous = this.#samples.at(-1);
    if (previous && (atMs < previous.atMs || totals.txBytes < previous.txBytes || totals.rxBytes < previous.rxBytes)) this.reset();
    this.#samples.push({ atMs, ...totals });
    const cutoff = atMs - this.windowMs;
    while (this.#samples.length > 2 && this.#samples[1]!.atMs <= cutoff) this.#samples.shift();
    const first = this.#samples[0]!;
    const elapsedSeconds = (atMs - first.atMs) / 1_000;
    if (elapsedSeconds <= 0) return Object.freeze({ txBitsPerSecond: 0, rxBitsPerSecond: 0 });
    return Object.freeze({
      txBitsPerSecond: Math.max(0, ((totals.txBytes - first.txBytes) * 8) / elapsedSeconds),
      rxBitsPerSecond: Math.max(0, ((totals.rxBytes - first.rxBytes) * 8) / elapsedSeconds),
    });
  }
}

export function formatBitRate(bitsPerSecond: number): string {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond < 0) throw new Error('bit rate is invalid');
  if (bitsPerSecond < 1_000) return `${Math.round(bitsPerSecond)} bps`;
  if (bitsPerSecond < 1_000_000) return `${(bitsPerSecond / 1_000).toFixed(bitsPerSecond < 100_000 ? 1 : 0)} kbps`;
  return `${(bitsPerSecond / 1_000_000).toFixed(bitsPerSecond < 100_000_000 ? 1 : 0)} Mbps`;
}
