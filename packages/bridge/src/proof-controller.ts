import type { DemoConfig } from './demo-config.js';
import type { FipsControlClient, FipsControlData, FipsControlQuery } from './fips-control-client.js';
import { joinSoundProof, projectSoundProofResult, type AcousticProofStatus, type IsolationProofStatus, type PublicPingResult, type RawPingResult, type SoundProofJoin } from './proof.js';

export interface ProofExecFile { (file: string, args: readonly string[], options: Readonly<{ timeout: number; maxBuffer: number; windowsHide: boolean }>): Promise<RawPingResult>; }
export interface ProofControllerOptions { readonly config: DemoConfig; readonly targetIpv6?: string; readonly control: Pick<FipsControlClient, 'query'>; readonly acousticStatus: () => AcousticProofStatus; readonly isolation: () => Promise<IsolationProofStatus>; readonly now: () => number; readonly execFile: ProofExecFile; }
export interface ProofExecution { readonly pingReady: boolean; readonly reason: string; readonly evidenceClass: 'Fixture' | 'human_needed'; readonly result?: PublicPingResult; readonly raw?: RawPingResult; readonly join: SoundProofJoin; }
const DEFAULT_B_TARGET = 'fd00::2';

export class ProofController {
  constructor(private readonly options: ProofControllerOptions) {}
  async status(): Promise<ProofExecution> {
    const batchStartedAtMs = this.options.now();
    const peers = await this.options.control.query('peers');
    const links = await this.options.control.query('links');
    const transports = await this.options.control.query('transports');
    const batchCompletedAtMs = this.options.now();
    const join = joinSoundProof({ expectedPeerPublicKey: this.options.config.fips.expectedPeerPublicKey, targetIpv6: this.options.targetIpv6 ?? DEFAULT_B_TARGET, peers: (peers as { peers: unknown[] }).peers, links: (links as { links: unknown[] }).links, transports: (transports as { transports: unknown[] }).transports, acoustic: this.options.acousticStatus(), isolation: await this.options.isolation(), nowMs: this.options.now(), batchStartedAtMs, batchCompletedAtMs });
    return Object.freeze({ pingReady: join.pingReady, reason: join.reason, evidenceClass: join.pingReady ? 'Fixture' : 'human_needed', join });
  }
  async ping(): Promise<ProofExecution> {
    const status = await this.status();
    if (!status.pingReady) return status;
    try {
      const raw = await this.options.execFile('/usr/bin/ping', ['-6', '-n', '-c', '1', '-W', '15', this.options.targetIpv6 ?? DEFAULT_B_TARGET], { timeout: 20_000, maxBuffer: 65_536, windowsHide: true });
      return Object.freeze({ ...status, result: projectSoundProofResult(raw), raw: Object.freeze({ ...raw }) });
    } catch {
      const raw = Object.freeze({ exitCode: 2, stdout: '', stderr: '' });
      return Object.freeze({ ...status, result: projectSoundProofResult(raw), raw });
    }
  }
}

export function createProofController(options: ProofControllerOptions): ProofController { return new ProofController(options); }
