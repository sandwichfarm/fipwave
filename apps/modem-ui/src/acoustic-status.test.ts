import { describe, expect, it } from 'vitest';

import { parseAcousticPublicStatus } from './acoustic-status.js';

const valid = { phase: 'Ready', evidenceClass: 'Fixture', peer: 'configured', epoch: 7, commitAcknowledged: true, currentHeartbeat: true, ready: true, txPackets: 1, rxPackets: 1, retries: 0, dropped: 0, duplicates: 0, queuedPackets: 0, queuedBytes: 0, reason: null };

describe('AcousticPublicStatus', () => {
  it('admits only the exact scalar secret-safe schema', () => {
    expect(parseAcousticPublicStatus(valid)).toEqual(valid);
    expect(parseAcousticPublicStatus({ ...valid, packet: 'deadbeef' })).toBeUndefined();
    expect(parseAcousticPublicStatus({ ...valid, reason: 'raw error: nsec1secret' })).toBeUndefined();
    expect(parseAcousticPublicStatus({ ...valid, ready: false })).toBeUndefined();
  });
});
