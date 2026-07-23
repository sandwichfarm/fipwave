import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

import type { AdapterResult, CodecAdapter, CodecProfile, QualificationCase, QualificationContext } from './types.js';

export const CYRINX_QUALIFICATION_WINDOW_MS = 90 * 60 * 1_000;
export const MAX_COMMAND_INPUT_BYTES = 576 * 1024;
export const MAX_COMMAND_OUTPUT_BYTES = 576 * 1024;
export const MAX_COMMAND_STDERR_BYTES = 8 * 1024;
export const CYRINX_COMMANDS = ['geometry', 'encode', 'decode'] as const;
export type CyrinxCommand = typeof CYRINX_COMMANDS[number];

export interface CommandResult { exitCode: number; stdout: Uint8Array; stderr: string; timedOut: boolean; }
export type PinnedCommandRunner = (request: { executable: string; command: CyrinxCommand; payload: Uint8Array; timeoutMs?: number }) => Promise<CommandResult>;

export const CYRINX_PROFILE: CodecProfile = {
  codec: 'cyrinx', name: 'bulk-qpsk-r1-2-48k-v1', audible: true, advertisedMtu: 1792, sampleRate: 48_000, channels: 1,
};

/** Runs exactly one hash-built C batch command. No shell, profile, or streaming controls are exposed. */
export const runPinnedCommand: PinnedCommandRunner = async ({ executable, command, payload, timeoutMs = 15_000 }) => {
  if (!CYRINX_COMMANDS.includes(command) || payload.byteLength > MAX_COMMAND_INPUT_BYTES || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error('native command request is invalid');
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(executable, [command], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stdoutBytes = 0; let stderrBytes = 0; let settled = false; let timedOut = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill('SIGKILL'); reject(error); return; }
      resolve({ exitCode: child.exitCode ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8'), timedOut });
    };
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.once('error', finish);
    child.stdout.on('data', (chunk: Buffer) => { stdoutBytes += chunk.byteLength; if (stdoutBytes > MAX_COMMAND_OUTPUT_BYTES) finish(new Error('native stdout exceeds cap')); else stdout.push(Buffer.from(chunk)); });
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.byteLength; if (stderrBytes > MAX_COMMAND_STDERR_BYTES) finish(new Error('native stderr exceeds cap')); else stderr.push(Buffer.from(chunk)); });
    child.once('close', (code) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ exitCode: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8'), timedOut }); } });
    child.stdin.once('error', () => undefined);
    child.stdin.end(payload);
  });
};

/** Compatibility adapter for the existing codec-neutral gate; batch framing lives in cyrinx-worker. */
export class NativeCommandCodecAdapter implements CodecAdapter {
  readonly profile: CodecProfile;

  constructor(private readonly command: { executable: string; runner?: PinnedCommandRunner }, profile: CodecProfile = CYRINX_PROFILE) {
    if (!command.executable) throw new Error('codec command must be a pinned executable');
    this.profile = profile;
  }

  async qualify(qualificationCase: QualificationCase, context: QualificationContext): Promise<AdapterResult> {
    try {
      const response = await (this.command.runner ?? runPinnedCommand)({ executable: this.command.executable, command: 'encode', payload: qualificationCase.payload });
      if (response.stdout.byteLength > MAX_COMMAND_OUTPUT_BYTES) throw new Error('codec command output exceeds cap');
      const digest = createHash('sha256').update(response.stdout).digest('hex');
      return {
        adapter: this.profile.codec, profile: this.profile, evidenceClass: context.evidenceClass, epoch: context.epoch,
        direction: qualificationCase.direction, caseId: qualificationCase.id, digest,
        bytePerfect: response.exitCode === 0 && digest === qualificationCase.digest, deliveryCount: response.exitCode === 0 ? 1 : 0,
        acquisitionMs: 0, airtimeMs: 0, coldAcquired: response.exitCode === 0, complete: response.exitCode === 0,
        audioPassed: true, queues: { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
        ...(response.exitCode === 0 ? {} : { reasonCode: response.timedOut ? 'cyrinx_process_timeout' : 'cyrinx_command_failed' }),
      };
    } catch {
      return {
        adapter: this.profile.codec, profile: this.profile, evidenceClass: context.evidenceClass, epoch: context.epoch,
        direction: qualificationCase.direction, caseId: qualificationCase.id, digest: qualificationCase.digest,
        bytePerfect: false, deliveryCount: 0, acquisitionMs: 0, airtimeMs: 0, coldAcquired: false, complete: false,
        audioPassed: true, queues: { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
        reasonCode: 'cyrinx_command_failed',
      };
    }
  }
}
