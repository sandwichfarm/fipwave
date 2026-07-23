import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CYRINX_BROWSER_CASE_TIMEOUT_MS,
  CyrinxCaseWatchdog,
  type CyrinxBrowserCase,
} from './cyrinx-case-watchdog.js';

const listenCase: CyrinxBrowserCase = {
  epoch: 7,
  caseId: 'a-to-b-256-01',
  direction: 'A → B',
  mode: 'listen',
};
const transmitCase: CyrinxBrowserCase = {
  epoch: 7,
  caseId: 'b-to-a-256-01',
  direction: 'B → A',
  mode: 'transmit',
};
const nextTransmitCase: CyrinxBrowserCase = {
  epoch: 7,
  caseId: 'b-to-a-256-02',
  direction: 'B → A',
  mode: 'transmit',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('Cyrinx browser case watchdog', () => {
  it('allows one capture plus native timeout headroom while remaining an early-abandon bound', () => {
    const captureWindowMs = 2_731;
    const nativeBoundMs = 15_000;
    const schedulingHeadroomMs = CYRINX_BROWSER_CASE_TIMEOUT_MS - captureWindowMs - nativeBoundMs;

    expect(CYRINX_BROWSER_CASE_TIMEOUT_MS).toBe(25_000);
    expect(schedulingHeadroomMs).toBe(7_269);
    expect(CYRINX_BROWSER_CASE_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it('reports a stalled case once without allowing repeated snapshots to extend its deadline', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const watchdog = new CyrinxCaseWatchdog(failed);

    watchdog.arm(listenCase);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS / 2);
    watchdog.arm({ ...listenCase });
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS / 2 - 1);
    expect(failed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(failed).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith(listenCase);

    watchdog.arm(listenCase);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);
    expect(failed).toHaveBeenCalledOnce();
  });

  it('reports an immediate local failure once and suppresses its later timer', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const watchdog = new CyrinxCaseWatchdog(failed);

    watchdog.arm(transmitCase);
    expect(watchdog.fail(transmitCase)).toBe(true);
    expect(watchdog.fail(transmitCase)).toBe(false);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);
    expect(failed).toHaveBeenCalledOnce();
  });

  it('keeps a transmitted case owned until a current-epoch snapshot advances to the next case', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const watchdog = new CyrinxCaseWatchdog(failed);

    watchdog.arm(transmitCase);
    expect(watchdog.markTransmitCompletionSent(transmitCase)).toBe(true);
    expect(watchdog.owns(transmitCase)).toBe(true);
    expect(watchdog.completeTransmitAfterAuthoritativeSnapshot({
      epoch: transmitCase.epoch - 1,
      codec: 'cyrinx',
      terminal: false,
      instruction: { ...nextTransmitCase, epoch: transmitCase.epoch - 1 },
    })).toBe(false);
    expect(watchdog.owns(transmitCase)).toBe(true);
    expect(watchdog.completeTransmitAfterAuthoritativeSnapshot({
      epoch: transmitCase.epoch,
      codec: 'cyrinx',
      terminal: false,
      instruction: nextTransmitCase,
    })).toBe(true);
    expect(watchdog.owns(transmitCase)).toBe(false);
    watchdog.arm(nextTransmitCase);
    expect(watchdog.owns(nextTransmitCase)).toBe(true);
    watchdog.cancel();

    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);
    expect(failed).not.toHaveBeenCalled();
  });

  it('does not let repeated same-case snapshots complete or re-arm a transmit case around playback completion', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const watchdog = new CyrinxCaseWatchdog(failed);

    watchdog.arm(transmitCase);
    expect(watchdog.completeTransmitAfterAuthoritativeSnapshot({
      epoch: transmitCase.epoch,
      codec: 'cyrinx',
      terminal: false,
      instruction: transmitCase,
    })).toBe(false);
    watchdog.arm({ ...transmitCase });
    expect(watchdog.markTransmitCompletionSent(transmitCase)).toBe(true);
    expect(watchdog.completeTransmitAfterAuthoritativeSnapshot({
      epoch: transmitCase.epoch,
      codec: 'cyrinx',
      terminal: false,
      instruction: transmitCase,
    })).toBe(false);
    expect(watchdog.completeTransmitAfterAuthoritativeSnapshot({
      epoch: transmitCase.epoch,
      codec: 'cyrinx',
      terminal: false,
    })).toBe(false);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);

    expect(failed).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith(transmitCase);
  });

  it('treats a terminal current-epoch snapshot after playback completion as a silent completion', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const watchdog = new CyrinxCaseWatchdog(failed);

    watchdog.arm(transmitCase);
    expect(watchdog.markTransmitCompletionSent(transmitCase)).toBe(true);
    expect(watchdog.completeTransmitAfterAuthoritativeSnapshot({
      epoch: transmitCase.epoch,
      codec: 'cyrinx',
      terminal: true,
    })).toBe(true);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);

    expect(failed).not.toHaveBeenCalled();
  });

  it('treats authoritative fallback after playback completion as a silent terminal handoff', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const watchdog = new CyrinxCaseWatchdog(failed);

    watchdog.arm(transmitCase);
    expect(watchdog.markTransmitCompletionSent(transmitCase)).toBe(true);
    expect(watchdog.completeTransmitAfterAuthoritativeSnapshot({
      epoch: transmitCase.epoch,
      codec: 'quiet',
      terminal: false,
    })).toBe(true);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);

    expect(failed).not.toHaveBeenCalled();
  });

  it('does not let a failed ERROR handoff mask the owned case failure', () => {
    const watchdog = new CyrinxCaseWatchdog(() => { throw new Error('socket send failed'); });
    watchdog.arm(listenCase);

    expect(() => watchdog.fail(listenCase)).not.toThrow();
  });

  it('treats listener completion and reset or disconnect cancellation as silent terminal paths', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const watchdog = new CyrinxCaseWatchdog(failed);

    watchdog.arm(listenCase);
    expect(watchdog.complete(listenCase)).toBe(true);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);

    watchdog.arm(transmitCase);
    expect(watchdog.markTransmitCompletionSent(transmitCase)).toBe(true);
    watchdog.cancel();
    expect(watchdog.fail(transmitCase)).toBe(false);
    expect(watchdog.completeTransmitAfterAuthoritativeSnapshot({
      epoch: transmitCase.epoch,
      codec: 'cyrinx',
      terminal: true,
    })).toBe(false);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);
    expect(failed).not.toHaveBeenCalled();
  });
});
