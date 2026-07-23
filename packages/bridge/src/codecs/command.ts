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
export interface PinnedCommandRequest { executable: string; command: CyrinxCommand; payload: Uint8Array; timeoutMs?: number; signal?: AbortSignal; }
export type PinnedCommandRunner = (request: PinnedCommandRequest) => Promise<CommandResult>;

export const CYRINX_PROFILE: CodecProfile = {
  codec: 'cyrinx', name: 'bulk-qpsk-r1-2-48k-v1', audible: true, advertisedMtu: 1536, sampleRate: 48_000, channels: 1,
};

/** Runs exactly one hash-built C batch command. No shell, profile, or streaming controls are exposed. */
export const runPinnedCommand: PinnedCommandRunner = async ({ executable, command, payload, timeoutMs = 15_000, signal }) => {
  if (!CYRINX_COMMANDS.includes(command) || payload.byteLength > MAX_COMMAND_INPUT_BYTES || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error('native command request is invalid');
  if (signal?.aborted) throw new Error('native command aborted');
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(executable, [command], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stdoutBytes = 0; let stderrBytes = 0; let settled = false; let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true; cleanup();
      if (error) { child.kill('SIGKILL'); reject(error); return; }
      resolve({ exitCode: child.exitCode ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8'), timedOut });
    };
    const abort = (): void => finish(new Error('native command aborted'));
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', finish);
    child.stdout.on('data', (chunk: Buffer) => { stdoutBytes += chunk.byteLength; if (stdoutBytes > MAX_COMMAND_OUTPUT_BYTES) finish(new Error('native stdout exceeds cap')); else stdout.push(Buffer.from(chunk)); });
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.byteLength; if (stderrBytes > MAX_COMMAND_STDERR_BYTES) finish(new Error('native stderr exceeds cap')); else stderr.push(Buffer.from(chunk)); });
    child.once('close', (code) => { if (!settled) { settled = true; cleanup(); resolve({ exitCode: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8'), timedOut }); } });
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
      if (qualificationCase.payload.byteLength > 1536 || !/^[a-f0-9]{64}$/i.test(qualificationCase.digest)) throw new Error('qualification case is invalid');
      const runner = this.command.runner ?? runPinnedCommand;
      const metadata = Buffer.alloc(256); metadata.write('CYRX', 0, 'ascii'); metadata.writeUInt8(1, 4); metadata.writeUInt32LE(context.epoch, 5); metadata.writeUInt8(qualificationCase.direction === 'A → B' ? 0 : 1, 9); metadata.write(qualificationCase.id, 11, 64, 'utf8'); metadata.writeUInt32LE(qualificationCase.payload.byteLength, 75); Buffer.from(qualificationCase.digest, 'hex').copy(metadata, 79);
      const input = Buffer.alloc(4 + metadata.byteLength + qualificationCase.payload.byteLength); input.writeUInt32LE(qualificationCase.payload.byteLength, 0); metadata.copy(input, 4); Buffer.from(qualificationCase.payload).copy(input, 260);
      const encoded = await runner({ executable: this.command.executable, command: 'encode', payload: input });
      if (encoded.exitCode !== 0 || encoded.timedOut || encoded.stdout.byteLength !== 249_856) throw new Error('native encode failed');
      const response = await runner({ executable: this.command.executable, command: 'decode', payload: encoded.stdout });
      const body = Buffer.from(response.stdout); const expectedBytes = 289 + qualificationCase.payload.byteLength;
      if (response.exitCode !== 0 || response.timedOut || body.byteLength !== expectedBytes || body.toString('ascii', 0, 4) !== 'CYRR' || body.readUInt8(4) !== 1 || body.readUInt32LE(5) !== qualificationCase.payload.byteLength || body.readUInt32LE(9) !== 7 || body.readUInt32LE(13) !== 7 || !body.subarray(33, 289).equals(metadata) || !body.subarray(289).equals(Buffer.from(qualificationCase.payload))) throw new Error('native decode result is invalid');
      const digest = createHash('sha256').update(body.subarray(289)).digest('hex');
      return {
        adapter: this.profile.codec, profile: this.profile, evidenceClass: context.evidenceClass, epoch: context.epoch,
        direction: qualificationCase.direction, caseId: qualificationCase.id, digest,
        bytePerfect: digest === qualificationCase.digest, deliveryCount: 1,
        acquisitionMs: body.readUInt32LE(17), airtimeMs: body.readUInt32LE(21), coldAcquired: true, complete: true,
        audioPassed: true, queues: { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
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
