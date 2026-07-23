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

  it('does not let a failed ERROR handoff mask the owned case failure', () => {
    const watchdog = new CyrinxCaseWatchdog(() => { throw new Error('socket send failed'); });
    watchdog.arm(listenCase);

    expect(() => watchdog.fail(listenCase)).not.toThrow();
  });

  it('treats completion and authoritative cancellation as silent terminal paths', () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const watchdog = new CyrinxCaseWatchdog(failed);

    watchdog.arm(listenCase);
    expect(watchdog.complete(listenCase)).toBe(true);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);

    watchdog.arm(transmitCase);
    watchdog.cancel();
    expect(watchdog.fail(transmitCase)).toBe(false);
    vi.advanceTimersByTime(CYRINX_BROWSER_CASE_TIMEOUT_MS);
    expect(failed).not.toHaveBeenCalled();
  });
});
