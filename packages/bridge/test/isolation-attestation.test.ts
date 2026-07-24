import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createIsolationResponder, parseIsolationAttestation } from '../src/isolation-attestation.js';

const now = 1_700_000_000_000;
const challenge = randomBytes(32).toString('base64url');
const snapshot = {
  expectedPeerPublicKey: 'npub1peer', targetIpv6: 'fd46:f688:3bb:f389:e1df:f3e:3af3:9c30', build: 'a'.repeat(40), epoch: 7, settingsId: 'quiet-audible-7k-v1', observedAtMs: now,
  transport: { transportId: 2, type: 'sound', state: 'active', workerUp: true, acousticReady: true }, link: { linkId: 1, peerPublicKey: 'npub1peer' },
};

describe('isolation attestation', () => {
  it('returns one bounded nonce-bound Sound-only response with a canonical digest', async () => {
    const responder = createIsolationResponder({ now: () => now, snapshot: async () => snapshot });
    const response = await responder.attest({ schemaVersion: 1, challenge });
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(1024);
    expect(parseIsolationAttestation(response)).toMatchObject({ schemaVersion: 1, challenge, targetIpv6: snapshot.targetIpv6, expectedPeerPublicKey: snapshot.expectedPeerPublicKey, epoch: 7, snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await responder.close();
  });

  it('fails closed for bad source data, replay, malformed nonce, and rate excess', async () => {
    const responder = createIsolationResponder({ now: () => now, snapshot: async () => snapshot });
    await expect(responder.attest({ schemaVersion: 1, challenge: 'bad' })).rejects.toThrow('challenge_invalid');
    await responder.attest({ schemaVersion: 1, challenge });
    await expect(responder.attest({ schemaVersion: 1, challenge })).rejects.toThrow('challenge_replayed');
    const invalid = createIsolationResponder({ now: () => now, snapshot: async () => ({ ...snapshot, transport: { ...snapshot.transport, acousticReady: false } }) });
    await expect(invalid.attest({ schemaVersion: 1, challenge: randomBytes(32).toString('base64url') })).rejects.toThrow('snapshot_invalid');
    await responder.close(); await invalid.close();
  });
});
