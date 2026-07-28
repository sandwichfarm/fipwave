import { describe, expect, it } from 'vitest';

import { parseFipsPeerStatus } from './fips-peer-state.js';

describe('FIPS peer state', () => {
  it('accepts only the dedicated authenticated-peer projection', () => {
    expect(parseFipsPeerStatus({ peerReady: true, reason: 'ready' })).toEqual({
      peerReady: true,
      reason: 'ready',
    });
    expect(parseFipsPeerStatus({ peerReady: true, reason: 'isolation_failed' })).toBeUndefined();
    expect(parseFipsPeerStatus({ peerReady: true, reason: 'ready', pingReady: false })).toBeUndefined();
  });

  it('keeps unauthenticated states false until every Sound peer fact agrees', () => {
    expect(parseFipsPeerStatus({ peerReady: false, reason: 'peer_missing' })).toEqual({
      peerReady: false,
      reason: 'peer_missing',
    });
    expect(parseFipsPeerStatus({ peerReady: false, reason: 'ready' })).toBeUndefined();
  });
});
