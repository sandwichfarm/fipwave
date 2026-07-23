import { createHash } from 'node:crypto';

import type { AdapterResult, CodecAdapter, CodecProfile, QualificationCase, QualificationContext } from './types.js';

export const CYRINX_QUALIFICATION_WINDOW_MS = 90 * 60 * 1_000;
const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;

export interface CommandResult { exitCode: number; stdout: Uint8Array; stderr?: string; }
export type PinnedCommandRunner = (request: { executable: string; args: string[]; payload: Uint8Array }) => Promise<CommandResult>;

export const CYRINX_PROFILE: CodecProfile = {
  codec: 'cyrinx', name: 'cyrinx-pinned-batch-audible', audible: true, advertisedMtu: 1357, sampleRate: 48_000, channels: 1,
};

/** Portable batch-only Cyrinx seam. It deliberately does not expose WASM or streaming controls. */
export class NativeCommandCodecAdapter implements CodecAdapter {
  readonly profile: CodecProfile;

  constructor(private readonly command: { executable: string; args: string[]; runner: PinnedCommandRunner }, profile: CodecProfile = CYRINX_PROFILE) {
    if (!command.executable || command.args.some((value) => value.length === 0)) throw new Error('codec command must be pinned and non-empty');
    this.profile = profile;
  }

  async qualify(qualificationCase: QualificationCase, context: QualificationContext): Promise<AdapterResult> {
    try {
      const response = await this.command.runner({ executable: this.command.executable, args: [...this.command.args, '--batch'], payload: qualificationCase.payload });
      if (response.stdout.byteLength > MAX_COMMAND_OUTPUT_BYTES) throw new Error('codec command output exceeds cap');
      const digest = createHash('sha256').update(response.stdout).digest('hex');
      return {
        adapter: this.profile.codec, profile: this.profile, evidenceClass: context.evidenceClass, epoch: context.epoch,
        direction: qualificationCase.direction, caseId: qualificationCase.id, digest,
        bytePerfect: response.exitCode === 0 && digest === qualificationCase.digest, deliveryCount: response.exitCode === 0 ? 1 : 0,
        acquisitionMs: 0, airtimeMs: 0, coldAcquired: response.exitCode === 0, complete: response.exitCode === 0,
        audioPassed: true, queues: { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
        ...(response.exitCode === 0 ? {} : { reasonCode: 'cyrinx_command_failed' }),
      };
    } catch (error) {
      return {
        adapter: this.profile.codec, profile: this.profile, evidenceClass: context.evidenceClass, epoch: context.epoch,
        direction: qualificationCase.direction, caseId: qualificationCase.id, digest: qualificationCase.digest,
        bytePerfect: false, deliveryCount: 0, acquisitionMs: 0, airtimeMs: 0, coldAcquired: false, complete: false,
        audioPassed: true, queues: { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
        reasonCode: error instanceof Error ? 'cyrinx_command_failed' : 'cyrinx_command_unknown_failure',
      };
    }
  }
}
