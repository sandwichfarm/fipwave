import { describe, expect, it } from 'vitest';

import { safeConfigReason, safeUiReason } from './ui-errors.js';

describe('operator error rendering', () => {
  it('admits only fixed messages and reconstructed bounded audio templates', () => {
    expect(safeUiReason(new Error('Local bridge disconnected'), 'local bridge message was rejected')).toBe('Local bridge disconnected');
    expect(safeUiReason('input-device channel count is 3, not 1 or 2', 'browser audio unavailable')).toBe('input-device channel count is 3, not 1 or 2');
    expect(safeUiReason('context sample rate is 44100, not 48000', 'browser audio unavailable')).toBe('context sample rate is 44100, not 48000');
  });

  it.each([
    'Error: FWAV frame dump deadbeef at parser',
    'Error: failure at parser (main.ts:10:2)',
    'fetch failed for https://example.test/?nsec=nsec1secret',
    'raw packet bytes 00112233445566778899',
    `Local bridge disconnected\nat websocket`,
    'x'.repeat(241),
  ])('collapses unapproved raw text: %s', (candidate) => {
    expect(safeUiReason(candidate, 'local bridge message was rejected')).toBe('local bridge message was rejected');
  });

  it('admits only the two public configuration outcomes', () => {
    expect(safeConfigReason(new Error('runner qualification configuration is invalid'))).toBe('runner qualification configuration is invalid');
    expect(safeConfigReason(new Error('stack: config body nsec1secret'))).toBe('runner qualification configuration is unavailable');
  });
});
