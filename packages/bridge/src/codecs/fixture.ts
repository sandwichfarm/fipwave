import { createHash } from 'node:crypto';

import type { AdapterResult, CodecAdapter, CodecProfile, QualificationCase, QualificationContext } from './types.js';

export const FIXTURE_PROFILE: CodecProfile = {
  codec: 'fixture', name: 'fixture-loopback', audible: true, advertisedMtu: 1357, sampleRate: 48_000, channels: 1,
};

/** Deterministic non-physical adapter used to exercise the real gate and report path. */
export class FixtureCodecAdapter implements CodecAdapter {
  readonly profile = FIXTURE_PROFILE;

  async qualify(qualificationCase: QualificationCase, context: QualificationContext): Promise<AdapterResult> {
    const digest = createHash('sha256').update(qualificationCase.payload).digest('hex');
    return {
      adapter: 'fixture', profile: this.profile, evidenceClass: context.evidenceClass,
      epoch: context.epoch, direction: qualificationCase.direction, caseId: qualificationCase.id,
      digest, bytePerfect: digest === qualificationCase.digest, deliveryCount: 1,
      acquisitionMs: 0, airtimeMs: 0, coldAcquired: true, complete: true, audioPassed: true,
      queues: { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
    };
  }
}
