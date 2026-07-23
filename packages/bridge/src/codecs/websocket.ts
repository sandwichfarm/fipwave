import type { CodecAdapter, CodecProfile, QualificationCase, QualificationContext, AdapterResult } from './types.js';

export const QUIET_PROFILE: CodecProfile = {
  codec: 'quiet', name: 'quiet-prebuilt-audible', audible: true, advertisedMtu: 1357, sampleRate: 48_000, channels: 1,
};

export interface PlaybackSink<Chunk, Metrics> {
  validate(frame: ArrayBuffer, epoch: number): Chunk;
  enqueue(chunk: Chunk): Metrics;
}

/** The only browser playback route: validate the binary FWAV frame before queueing it. */
export function acceptBridgePlaybackFrame<Chunk, Metrics>(frame: ArrayBuffer, epoch: number, sink: PlaybackSink<Chunk, Metrics>): Metrics {
  return sink.enqueue(sink.validate(frame, epoch));
}

export interface BrowserQualificationClient {
  run(caseId: string, epoch: number): Promise<AdapterResult>;
  reset?(epoch: number): void;
}

/** Adapts the prebuilt browser Quiet path without granting codec-specific gate bypasses. */
export class BrowserWebSocketCodecAdapter implements CodecAdapter {
  readonly profile: CodecProfile;
  constructor(private readonly client: BrowserQualificationClient, profile: CodecProfile = QUIET_PROFILE) { this.profile = profile; }
  async qualify(qualificationCase: QualificationCase, context: QualificationContext): Promise<AdapterResult> {
    const result = await this.client.run(qualificationCase.id, context.epoch);
    return { ...result, adapter: this.profile.codec, profile: this.profile, epoch: context.epoch, direction: qualificationCase.direction, caseId: qualificationCase.id, evidenceClass: context.evidenceClass };
  }
  reset(nextEpoch: number): void { this.client.reset?.(nextEpoch); }
}
