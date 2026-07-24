import type { FipsControlData, FipsLink, FipsPeer, FipsTransport } from './fips-control-client.js';

export type ProofReason = 'ready' | 'peer_missing' | 'peer_not_sound' | 'link_missing' | 'link_inactive' | 'transport_missing' | 'transport_not_ready' | 'acoustic_stale' | 'acoustic_epoch_mismatch' | 'isolation_failed' | 'isolation_stale' | 'isolation_epoch_mismatch' | 'target_mismatch' | 'snapshot_stale';
export interface AcousticProofStatus { readonly epoch: number; readonly ready: boolean; readonly observedAtMs: number; }
export interface IsolationProofStatus { readonly accepted: boolean; readonly epoch: number; readonly observedAtMs: number; readonly targetIpv6: string; }
export interface SoundProofInput { readonly expectedPeerPublicKey: string; readonly targetIpv6: string; readonly peers: readonly FipsPeer[]; readonly links: readonly FipsLink[]; readonly transports: readonly FipsTransport[]; readonly acoustic: AcousticProofStatus; readonly isolation: IsolationProofStatus; readonly nowMs: number; readonly batchStartedAtMs: number; readonly batchCompletedAtMs: number; }
export interface SoundProofJoin { readonly pingReady: boolean; readonly reason: ProofReason; readonly peer?: FipsPeer; readonly link?: FipsLink; readonly transport?: FipsTransport; }
export interface RawPingResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string; }
export interface PublicPingResult { readonly exitCode: number; readonly sequence: number | null; readonly latencyMs: number | null; readonly lossPercent: number | null; readonly safeReason: string | null; }

const MAX_SNAPSHOT_AGE_MS = 60_000;
function ipv6(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^fd[0-9a-f]{2}:[0-9a-f:]+$/i.test(value) && value.length <= 64;
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function parseSoundProofInput(value: unknown): SoundProofInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('proof_input_invalid');
  const input = value as Record<string, unknown>;
  const required = ['expectedPeerPublicKey', 'targetIpv6', 'peers', 'links', 'transports', 'acoustic', 'isolation', 'nowMs', 'batchStartedAtMs', 'batchCompletedAtMs'];
  if (Object.keys(input).length !== required.length || required.some((key) => !(key in input)) || typeof input.expectedPeerPublicKey !== 'string' || !ipv6(input.targetIpv6) || !Array.isArray(input.peers) || !Array.isArray(input.links) || !Array.isArray(input.transports) || !integer(input.nowMs) || !integer(input.batchStartedAtMs) || !integer(input.batchCompletedAtMs)) throw new Error('proof_input_invalid');
  const acoustic = input.acoustic as AcousticProofStatus; const isolation = input.isolation as IsolationProofStatus;
  if (!acoustic || !isolation || !integer(acoustic.epoch) || typeof acoustic.ready !== 'boolean' || !integer(acoustic.observedAtMs) || !integer(isolation.epoch) || typeof isolation.accepted !== 'boolean' || !integer(isolation.observedAtMs) || !ipv6(isolation.targetIpv6)) throw new Error('proof_input_invalid');
  return Object.freeze({ expectedPeerPublicKey: input.expectedPeerPublicKey, targetIpv6: input.targetIpv6, peers: Object.freeze([...input.peers] as FipsPeer[]), links: Object.freeze([...input.links] as FipsLink[]), transports: Object.freeze([...input.transports] as FipsTransport[]), acoustic: Object.freeze({ ...acoustic }), isolation: Object.freeze({ ...isolation }), nowMs: input.nowMs, batchStartedAtMs: input.batchStartedAtMs, batchCompletedAtMs: input.batchCompletedAtMs });
}

export function joinSoundProof(value: unknown): SoundProofJoin {
  const input = parseSoundProofInput(value);
  if (input.batchCompletedAtMs < input.batchStartedAtMs || input.batchCompletedAtMs - input.batchStartedAtMs > 2_000 || input.nowMs - input.batchCompletedAtMs > MAX_SNAPSHOT_AGE_MS) return Object.freeze({ pingReady: false, reason: 'snapshot_stale' });
  const peer = input.peers.find((item) => item.npub === input.expectedPeerPublicKey && item.connectivity === 'connected');
  if (!peer) return Object.freeze({ pingReady: false, reason: 'peer_missing' });
  if (peer.transport_type !== 'sound') return Object.freeze({ pingReady: false, reason: 'peer_not_sound' });
  const link = input.links.find((item) => item.link_id === peer.link_id);
  if (!link) return Object.freeze({ pingReady: false, reason: 'link_missing' });
  if (link.state !== 'active') return Object.freeze({ pingReady: false, reason: 'link_inactive' });
  const transport = input.transports.find((item) => item.transport_id === link.transport_id);
  if (!transport) return Object.freeze({ pingReady: false, reason: 'transport_missing' });
  const stats = transport.stats;
  if (transport.type !== 'sound' || transport.state !== 'active' || stats.worker_up !== true || stats.acoustic_ready !== true || !integer(stats.epoch)) return Object.freeze({ pingReady: false, reason: 'transport_not_ready' });
  if (!input.acoustic.ready || input.nowMs - input.acoustic.observedAtMs > MAX_SNAPSHOT_AGE_MS) return Object.freeze({ pingReady: false, reason: 'acoustic_stale' });
  if (input.acoustic.epoch !== stats.epoch) return Object.freeze({ pingReady: false, reason: 'acoustic_epoch_mismatch' });
  if (!input.isolation.accepted) return Object.freeze({ pingReady: false, reason: 'isolation_failed' });
  if (input.nowMs - input.isolation.observedAtMs > MAX_SNAPSHOT_AGE_MS) return Object.freeze({ pingReady: false, reason: 'isolation_stale' });
  if (input.isolation.epoch !== stats.epoch) return Object.freeze({ pingReady: false, reason: 'isolation_epoch_mismatch' });
  if (input.isolation.targetIpv6 !== input.targetIpv6) return Object.freeze({ pingReady: false, reason: 'target_mismatch' });
  return Object.freeze({ pingReady: true, reason: 'ready', peer, link, transport });
}

export function projectSoundProofResult(raw: RawPingResult): PublicPingResult {
  const packet = /(?:(\d+)\s+packets? transmitted,\s*(\d+)\s+(?:packets? )?received,\s*(\d+(?:\.\d+)?)% packet loss)/.exec(raw.stdout);
  const latency = /(?:time[=<]([0-9]+(?:\.[0-9]+)?)\s*ms|=\s*[0-9.]+\/([0-9.]+)\/)/.exec(raw.stdout);
  const exitCode = Number.isInteger(raw.exitCode) && raw.exitCode >= 0 && raw.exitCode <= 255 ? raw.exitCode : 2;
  return Object.freeze({ exitCode, sequence: packet ? Number(packet[2]) : null, latencyMs: latency ? Number(latency[1] ?? latency[2]) : null, lossPercent: packet ? Number(packet[3]) : null, safeReason: exitCode === 0 ? null : exitCode === 1 ? 'ping_no_reply' : 'ping_failed' });
}

export function controlData<T extends keyof FipsControlData>(data: FipsControlData, key: T): FipsControlData[T] { return data[key]; }
