import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { FixtureCodecAdapter } from '../../../packages/bridge/src/codecs/fixture.js';
import { CyrinxQualificationRun, QualificationGate, evaluateSelection } from './qualification.js';

const case256 = {
  id: 'a-to-b-256-01', direction: 'A → B' as const, size: 256 as const,
  digest: createHash('sha256').update(new Uint8Array(256)).digest('hex'), payload: new Uint8Array(256),
};

describe('codec-neutral qualification gate', () => {
  it('carries a fixture case through the adapter and keeps it human-needed', async () => {
    const adapter = new FixtureCodecAdapter();
    const result = await adapter.qualify(case256, { epoch: 7, evidenceClass: 'Fixture', nowMs: 1 });
    const gate = new QualificationGate({ expectedEpoch: 7, deadLinkTimeoutMs: 9_000 });

    expect(gate.accept(result)).toMatchObject({ decision: 'human_needed', reasonCodes: ['non_physical_evidence'] });
    expect(evaluateSelection([result], { expectedHosts: ['alpha', 'beta'] })).toMatchObject({ decision: 'human_needed' });
  });

  it.each([
    ['duplicate', { deliveryCount: 2 }],
    ['corrupt', { bytePerfect: false }],
    ['missing', { caseId: '' }],
    ['partial', { complete: false }],
    ['stale', { epoch: 6 }],
    ['queue overflow', { queues: { captureHighWaterBytes: 262145, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 } }],
  ])('hard-fails %s result evidence', async (_label, change) => {
    const adapter = new FixtureCodecAdapter();
    const base = await adapter.qualify(case256, { epoch: 7, evidenceClass: 'Fixture', nowMs: 1 });
    const result = { ...base, ...change };
    const gate = new QualificationGate({ expectedEpoch: 7, deadLinkTimeoutMs: 9_000 });

    expect(gate.accept(result)).toMatchObject({ decision: 'rejected' });
  });

  it('gives Cyrinx one non-extendable 90-minute gate before immediately entering Quiet', async () => {
    const fixture = await new FixtureCodecAdapter().qualify(case256, { epoch: 7, evidenceClass: 'Open air', nowMs: 1 });
    const cyrinx = { ...fixture, adapter: 'cyrinx' as const, profile: { ...fixture.profile, codec: 'cyrinx' as const, name: 'cyrinx-pinned' } };
    const quiet = { ...fixture, adapter: 'quiet' as const, profile: { ...fixture.profile, codec: 'quiet' as const, name: 'quiet-audible' } };
    const run = new CyrinxQualificationRun({ expectedEpoch: 7, deadLinkTimeoutMs: 9_000 });

    expect(run.start(100)).toMatchObject({ activeCodec: 'cyrinx', deadlineAtMs: 5_400_100 });
    expect(run.accept(cyrinx, 5_400_100)).toMatchObject({ activeCodec: 'quiet', reasonCodes: ['cyrinx_deadline_expired'] });
    expect(run.accept(quiet, 5_400_101)).toMatchObject({ activeCodec: 'quiet' });
    expect(run.start(5_400_102)).toMatchObject({ activeCodec: 'quiet', reasonCodes: ['cyrinx_deadline_expired'] });
  });

  it('makes a Cyrinx hard failure fall back once and a Quiet hard failure unqualified', async () => {
    const fixture = await new FixtureCodecAdapter().qualify(case256, { epoch: 7, evidenceClass: 'Open air', nowMs: 1 });
    const cyrinx = { ...fixture, adapter: 'cyrinx' as const, profile: { ...fixture.profile, codec: 'cyrinx' as const, name: 'cyrinx-pinned' }, bytePerfect: false };
    const quiet = { ...fixture, adapter: 'quiet' as const, profile: { ...fixture.profile, codec: 'quiet' as const, name: 'quiet-audible' }, queues: { ...fixture.queues, discontinuities: 1 } };
    const run = new CyrinxQualificationRun({ expectedEpoch: 7, deadLinkTimeoutMs: 9_000 });

    run.start(100);
    expect(run.accept(cyrinx, 101)).toMatchObject({ activeCodec: 'quiet', reasonCodes: ['bad_digest'] });
    expect(run.accept(quiet, 102)).toMatchObject({ activeCodec: 'unqualified', reasonCodes: ['queue_bound_exceeded'] });
  });
});
