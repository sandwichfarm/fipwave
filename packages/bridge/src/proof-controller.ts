import type { DemoConfig } from './demo-config.js';
import type { FipsControlClient } from './fips-control-client.js';
import { joinAuthenticatedSoundPeer, joinSoundProof, projectSoundProofResult, type AcousticProofStatus, type IsolationProofStatus, type PublicPingResult, type RawPingResult, type SoundPeerInput, type SoundPeerJoin, type SoundProofJoin } from './proof.js';

export interface ProofExecFile { (file: string, args: readonly string[], options: Readonly<{ timeout: number; maxBuffer: number; windowsHide: boolean }>): Promise<RawPingResult>; }
export interface ProofControllerOptions { readonly config: DemoConfig; readonly targetIpv6: string; readonly control: Pick<FipsControlClient, 'query'>; readonly acousticStatus: () => AcousticProofStatus; readonly isolation: () => Promise<IsolationProofStatus>; readonly now: () => number; readonly execFile: ProofExecFile; }
export interface PeerExecution { readonly peerReady: boolean; readonly reason: string; readonly join: SoundPeerJoin; }
export type PublicPeerExecution = Omit<PeerExecution, 'join'>;
export interface ProofExecution { readonly pingReady: boolean; readonly reason: string; readonly evidenceClass: 'Fixture' | 'human_needed'; readonly result?: PublicPingResult; readonly raw?: RawPingResult; readonly join: SoundProofJoin; }
export type PublicProofExecution = Omit<ProofExecution, 'raw'>;

export class ProofController {
  private statusInFlight: Promise<ProofExecution> | undefined;

  constructor(private readonly options: ProofControllerOptions) {}
  private async peerEvidence(): Promise<Readonly<{ input: SoundPeerInput; join: SoundPeerJoin }>> {
    const batchStartedAtMs = this.options.now();
    // Submit one adjacent snapshot batch to the serialized control client.
    // Awaiting each query separately lets frequent peer/proof polls interleave
    // between them and makes an otherwise-current batch fail as stale.
    const [peers, links, transports] = await Promise.all([
      this.options.control.query('peers'),
      this.options.control.query('links'),
      this.options.control.query('transports'),
    ]);
    const batchCompletedAtMs = this.options.now();
    const input = Object.freeze({
      expectedPeerPublicKey: this.options.config.fips.expectedPeerPublicKey,
      peers: (peers as { peers: unknown[] }).peers,
      links: (links as { links: unknown[] }).links,
      transports: (transports as { transports: unknown[] }).transports,
      acoustic: this.options.acousticStatus(),
      nowMs: this.options.now(),
      batchStartedAtMs,
      batchCompletedAtMs,
    }) as SoundPeerInput;
    return Object.freeze({ input, join: joinAuthenticatedSoundPeer(input) });
  }
  async peerStatus(): Promise<PeerExecution> {
    const { join } = await this.peerEvidence();
    return Object.freeze({ peerReady: join.peerReady, reason: join.reason, join });
  }
  private async evaluateStatus(): Promise<ProofExecution> {
    let peerEvidence = await this.peerEvidence();
    if (!peerEvidence.join.peerReady) {
      const peerJoin = peerEvidence.join;
      const join = Object.freeze({
        pingReady: false,
        reason: peerJoin.reason,
        ...(peerJoin.peer ? { peer: peerJoin.peer } : {}),
        ...(peerJoin.link ? { link: peerJoin.link } : {}),
        ...(peerJoin.transport ? { transport: peerJoin.transport } : {}),
      }) satisfies SoundProofJoin;
      return Object.freeze({ pingReady: false, reason: join.reason, evidenceClass: 'human_needed', join });
    }
    const isolation = await this.options.isolation();
    // The acoustic isolation round trip can legitimately take longer than the
    // peer snapshot freshness window. Re-read peer/link/transport authority
    // after it completes instead of rejecting a successful proof because the
    // pre-flight snapshot aged while bytes crossed the sound link.
    peerEvidence = await this.peerEvidence();
    if (!peerEvidence.join.peerReady) {
      const peerJoin = peerEvidence.join;
      const join = Object.freeze({
        pingReady: false,
        reason: peerJoin.reason,
        ...(peerJoin.peer ? { peer: peerJoin.peer } : {}),
        ...(peerJoin.link ? { link: peerJoin.link } : {}),
        ...(peerJoin.transport ? { transport: peerJoin.transport } : {}),
      }) satisfies SoundProofJoin;
      return Object.freeze({ pingReady: false, reason: join.reason, evidenceClass: 'human_needed', join });
    }
    const join = joinSoundProof({
      ...peerEvidence.input,
      targetIpv6: this.options.targetIpv6,
      isolation,
      nowMs: this.options.now(),
    });
    return Object.freeze({ pingReady: join.pingReady, reason: join.reason, evidenceClass: join.pingReady ? 'Fixture' : 'human_needed', join });
  }
  status(): Promise<ProofExecution> {
    if (this.statusInFlight) return this.statusInFlight;
    const running = this.evaluateStatus().finally(() => {
      if (this.statusInFlight === running) this.statusInFlight = undefined;
    });
    this.statusInFlight = running;
    return running;
  }
  async ping(): Promise<ProofExecution> {
    const status = await this.status();
    if (!status.pingReady) return status;
    try {
      const raw = await this.options.execFile('/usr/bin/ping', ['-6', '-n', '-c', '1', '-W', '15', this.options.targetIpv6], { timeout: 20_000, maxBuffer: 65_536, windowsHide: true });
      return Object.freeze({ ...status, result: projectSoundProofResult(raw), raw: Object.freeze({ ...raw }) });
    } catch {
      const raw = Object.freeze({ exitCode: 2, stdout: '', stderr: '' });
      return Object.freeze({ ...status, result: projectSoundProofResult(raw), raw });
    }
  }
}

export function createProofController(options: ProofControllerOptions): ProofController { return new ProofController(options); }

export function projectPublicPeerExecution(execution: PeerExecution): PublicPeerExecution {
  return Object.freeze({ peerReady: execution.peerReady, reason: execution.reason });
}

/** Deliberate public boundary: command output is retained only for local artifacts. */
export function projectPublicProofExecution(execution: ProofExecution): PublicProofExecution {
  const { raw: _raw, ...publicExecution } = execution;
  return Object.freeze(publicExecution);
}
