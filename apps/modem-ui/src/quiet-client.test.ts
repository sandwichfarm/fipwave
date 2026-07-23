import { describe, expect, it } from 'vitest';

import { QUIET_DATA_BYTES, QUIET_ENVELOPE_BYTES, QuietReceiverEvidence, decodeFragment, encodeFragment, fragmentCase, type CorpusCase } from './quiet-client.js';

const entry: CorpusCase = { id: 'a-to-b-256-01', direction: 'A → B', size: 256, pattern: 'all-zero', sha256: '5341e6b2646979a70e57653007a1f310169421ec9bdd9f1a5648f75ade005af1' };

describe('Quiet fixed audible envelope', () => {
  it('keeps a 32-byte application envelope and 221-byte data ceiling', () => {
    const fragments = fragmentCase({ epoch: 7, sender: 'A', caseIndex: 0, entry, payload: new Uint8Array(256) });
    expect(QUIET_ENVELOPE_BYTES).toBe(32); expect(QUIET_DATA_BYTES).toBe(221); expect(fragments).toHaveLength(2);
    const encoded = encodeFragment(fragments[0]!); expect(encoded.byteLength).toBeLessThanOrEqual(253);
    expect(decodeFragment(encoded)).toMatchObject({ epoch: 7, sender: 'A', direction: 'A → B', caseId: entry.id, fragmentIndex: 0, fragmentCount: 2 });
  });

  it('deduplicates receiver fragments and reports a corrupt duplicate rather than controlling a sender', async () => {
    const receiver = new QuietReceiverEvidence(); const fragments = fragmentCase({ epoch: 7, sender: 'A', caseIndex: 0, entry, payload: new Uint8Array(256) });
    expect(await receiver.accept(encodeFragment(fragments[0]!))).toBeUndefined();
    expect(await receiver.accept(encodeFragment(fragments[0]!))).toBeUndefined();
    const complete = await receiver.accept(encodeFragment(fragments[1]!));
    expect(complete).toMatchObject({ complete: true, corrupt: false, duplicates: 1, deliveryCount: 2 });
  });
});
