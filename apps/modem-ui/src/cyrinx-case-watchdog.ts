// 2.731 s capture + the 15 s native bound leaves 7.269 s of browser scheduling
// headroom. The server's 4.5 s settle is an accepted-at barrier, not additive.
export const CYRINX_BROWSER_CASE_TIMEOUT_MS = 25_000;

export type CyrinxBrowserCaseMode = 'listen' | 'transmit';
export type CyrinxBrowserDirection = 'A → B' | 'B → A';

export interface CyrinxBrowserCase {
  epoch: number;
  caseId: string;
  direction: CyrinxBrowserDirection;
  mode: CyrinxBrowserCaseMode;
}

export interface CyrinxAuthoritativeCaseSnapshot {
  epoch: number;
  codec: 'idle' | 'cyrinx' | 'quiet' | 'unqualified';
  terminal: boolean;
  instruction?: CyrinxBrowserCase;
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

interface TimerApi {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

const defaultTimers: TimerApi = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

function identity(value: CyrinxBrowserCase): string {
  return `${value.epoch}\u0000${value.direction}\u0000${value.caseId}`;
}

export function sameCyrinxBrowserCase(left: CyrinxBrowserCase | undefined, right: CyrinxBrowserCase): boolean {
  return left !== undefined
    && left.epoch === right.epoch
    && left.direction === right.direction
    && left.caseId === right.caseId
    && left.mode === right.mode;
}

/**
 * Owns one browser-side Cyrinx case deadline. Repeated authoritative snapshots
 * for the same case cannot extend it, and cancellation never reports failure.
 */
export class CyrinxCaseWatchdog {
  #active: CyrinxBrowserCase | undefined;
  #transmitCompletionSent = false;
  #timer: TimerHandle | undefined;
  #reported = new Set<string>();

  constructor(
    private readonly onFailure: (value: CyrinxBrowserCase) => void,
    private readonly timeoutMs = CYRINX_BROWSER_CASE_TIMEOUT_MS,
    private readonly timers: TimerApi = defaultTimers,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Cyrinx browser case timeout is invalid');
  }

  arm(value: CyrinxBrowserCase): void {
    if (sameCyrinxBrowserCase(this.#active, value)) return;
    this.cancel();
    this.#active = value;
    this.#transmitCompletionSent = false;
    this.#timer = this.timers.setTimeout(() => {
      const active = this.#active;
      if (!active) return;
      this.#active = undefined;
      this.#transmitCompletionSent = false;
      this.#timer = undefined;
      this.emitOnce(active);
    }, this.timeoutMs);
  }

  owns(value: CyrinxBrowserCase): boolean {
    return sameCyrinxBrowserCase(this.#active, value);
  }

  markTransmitCompletionSent(value: CyrinxBrowserCase): boolean {
    if (value.mode !== 'transmit' || !sameCyrinxBrowserCase(this.#active, value)) return false;
    this.#transmitCompletionSent = true;
    return true;
  }

  completeTransmitAfterAuthoritativeSnapshot(snapshot: CyrinxAuthoritativeCaseSnapshot): boolean {
    const active = this.#active;
    if (
      !active
      || active.mode !== 'transmit'
      || active.epoch !== snapshot.epoch
      || !this.#transmitCompletionSent
    ) return false;
    const advanced = snapshot.codec !== 'cyrinx'
      || snapshot.terminal
      || (snapshot.instruction !== undefined && !sameCyrinxBrowserCase(active, snapshot.instruction));
    if (!advanced) return false;
    this.clearActive();
    return true;
  }

  fail(value: CyrinxBrowserCase): boolean {
    if (!sameCyrinxBrowserCase(this.#active, value)) return false;
    this.clearActive();
    this.emitOnce(value);
    return true;
  }

  complete(value: CyrinxBrowserCase): boolean {
    if (!sameCyrinxBrowserCase(this.#active, value)) return false;
    this.clearActive();
    return true;
  }

  cancel(): void {
    this.clearActive();
  }

  private clearActive(): void {
    if (this.#timer !== undefined) this.timers.clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#active = undefined;
    this.#transmitCompletionSent = false;
  }

  private emitOnce(value: CyrinxBrowserCase): void {
    const key = identity(value);
    if (this.#reported.has(key)) return;
    this.#reported.add(key);
    try {
      this.onFailure(value);
    } catch {
      // A best-effort ERROR handoff cannot replace the original case failure.
    }
  }
}
