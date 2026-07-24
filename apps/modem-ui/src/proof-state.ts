export type ProofEvidenceClass = 'Fixture' | 'Loopback' | 'Open air' | 'human_needed';
export type ProofReason = 'ready' | 'peer_missing' | 'peer_not_sound' | 'link_missing' | 'link_inactive' | 'transport_missing' | 'transport_not_ready' | 'acoustic_stale' | 'acoustic_epoch_mismatch' | 'isolation_failed' | 'isolation_stale' | 'isolation_epoch_mismatch' | 'target_mismatch' | 'snapshot_stale' | 'proof_unavailable';
export type ProofMode = 'loading' | 'refreshing' | 'blocked' | 'ready' | 'running' | 'nonphysical' | 'open-air' | 'human-needed' | 'failed' | 'error';

export interface ProofCounters { readonly completeTx: number | null; readonly completeRx: number | null; readonly acousticTx: number | null; readonly acousticRx: number | null; readonly fragmentsTx: number | null; readonly fragmentsRx: number | null; readonly integrityFailures: number | null; readonly retries: number | null; }
export interface ProofSnapshot {
  readonly pingReady: boolean;
  readonly reason: ProofReason;
  readonly evidenceClass: ProofEvidenceClass;
  readonly peer: Readonly<{ identity: string; verified: boolean }>;
  readonly link: Readonly<{ id: number | null; verified: boolean }>;
  readonly transport: Readonly<{ epoch: number | null; verified: boolean }>;
  readonly isolationVerified: boolean;
  readonly counters: ProofCounters;
}
export interface ProofOutcome { readonly exitCode: 0 | 1 | 2; readonly sequence: number | null; readonly latencyMs: number | null; readonly lossPercent: number | null; readonly safeReason: string | null; }
export interface ProofState { readonly mode: ProofMode; readonly snapshot?: ProofSnapshot; readonly outcome?: ProofOutcome; readonly needsRefresh: boolean; readonly message: string; }

const reasons = new Set<ProofReason>(['ready', 'peer_missing', 'peer_not_sound', 'link_missing', 'link_inactive', 'transport_missing', 'transport_not_ready', 'acoustic_stale', 'acoustic_epoch_mismatch', 'isolation_failed', 'isolation_stale', 'isolation_epoch_mismatch', 'target_mismatch', 'snapshot_stale', 'proof_unavailable']);
const evidence = new Set<ProofEvidenceClass>(['Fixture', 'Loopback', 'Open air', 'human_needed']);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown, maximum = 128): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9:._-]+$/.test(value);
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => key in value);
const nullableCount = (value: unknown): number | null | undefined => value === null ? null : finite(value) ? value : undefined;

function reasonCopy(reason: ProofReason): string {
  return ({ ready: 'Ready to run one kernel ICMPv6 ping from Role A.', peer_missing: 'Waiting for authenticated Sound peer', peer_not_sound: 'Waiting for authenticated Sound peer', link_missing: 'Waiting for active Sound link', link_inactive: 'Waiting for active Sound link', transport_missing: 'Waiting for active Sound link', transport_not_ready: 'Disarmed — current acoustic session is not ready', acoustic_stale: 'Disarmed — current acoustic session is not ready', acoustic_epoch_mismatch: 'Disarmed — current acoustic session is not ready', isolation_failed: 'Waiting for paired Role B isolation proof', isolation_stale: 'Waiting for paired Role B isolation proof', isolation_epoch_mismatch: 'Waiting for paired Role B isolation proof', target_mismatch: 'Waiting for configured Role B target', snapshot_stale: 'Waiting for a current snapshot', proof_unavailable: 'Waiting for a current snapshot' })[reason];
}

function parseResult(value: unknown): ProofOutcome | undefined {
  const input = record(value); if (!input || !exact(input, ['exitCode', 'sequence', 'latencyMs', 'lossPercent', 'safeReason'])) return undefined;
  const exitCode = input.exitCode;
  if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2) return undefined;
  const sequence = nullableCount(input.sequence); const latencyMs = input.latencyMs === null ? null : typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs) && input.latencyMs >= 0 && input.latencyMs <= 120_000 ? input.latencyMs : undefined; const lossPercent = input.lossPercent === null ? null : typeof input.lossPercent === 'number' && Number.isFinite(input.lossPercent) && input.lossPercent >= 0 && input.lossPercent <= 100 ? input.lossPercent : undefined;
  if (sequence === undefined || latencyMs === undefined || lossPercent === undefined || (input.safeReason !== null && !text(input.safeReason, 80))) return undefined;
  return Object.freeze({ exitCode, sequence, latencyMs, lossPercent, safeReason: input.safeReason as string | null });
}

/** Parses only the current bounded 04-03 public ProofExecution projection. */
export function parseProofSnapshot(value: unknown): Readonly<{ snapshot?: ProofSnapshot; outcome?: ProofOutcome; loading?: true }> | undefined {
  const input = record(value); if (!input) return undefined;
  if (exact(input, ['state', 'pingReady', 'reason', 'result']) && input.state === 'loading' && input.pingReady === false && input.reason === 'proof_unavailable' && input.result === null) return Object.freeze({ loading: true });
  const allowed = ['pingReady', 'reason', 'evidenceClass', 'join', 'result'];
  if (Object.keys(input).some((key) => !allowed.includes(key)) || typeof input.pingReady !== 'boolean' || !reasons.has(input.reason as ProofReason) || !evidence.has(input.evidenceClass as ProofEvidenceClass)) return undefined;
  const join = record(input.join); if (!join || typeof join.pingReady !== 'boolean' || !reasons.has(join.reason as ProofReason)) return undefined;
  const peerInput = join.peer === undefined ? undefined : record(join.peer); const linkInput = join.link === undefined ? undefined : record(join.link); const transportInput = join.transport === undefined ? undefined : record(join.transport);
  if (peerInput && (!exact(peerInput, ['npub', 'connectivity', 'link_id', 'transport_type', 'authenticated_at_ms', 'last_seen_ms']) || !text(peerInput.npub, 128) || !text(peerInput.connectivity, 32) || !finite(peerInput.link_id) || !text(peerInput.transport_type, 32) || !timestamp(peerInput.authenticated_at_ms) || !timestamp(peerInput.last_seen_ms))) return undefined;
  if (linkInput && (!exact(linkInput, ['link_id', 'transport_id', 'state', 'created_at_ms', 'stats']) || !finite(linkInput.link_id) || !finite(linkInput.transport_id) || !text(linkInput.state, 32) || !timestamp(linkInput.created_at_ms) || !record(linkInput.stats))) return undefined;
  if (transportInput && (!exact(transportInput, ['transport_id', 'type', 'state', 'mtu', 'stats']) || !finite(transportInput.transport_id) || !text(transportInput.type, 32) || !text(transportInput.state, 32) || !finite(transportInput.mtu) || !record(transportInput.stats))) return undefined;
  if (input.result !== undefined && input.result !== null && !parseResult(input.result)) return undefined;
  const stats = transportInput?.stats as Record<string, unknown> | undefined;
  const counter = (key: string): number | null => stats && key in stats ? nullableCount(stats[key]) ?? null : null;
  const peer = Object.freeze({ identity: peerInput ? peerInput.npub as string : 'Waiting for a current snapshot', verified: peerInput?.connectivity === 'connected' && peerInput?.transport_type === 'sound' });
  const link = Object.freeze({ id: linkInput ? linkInput.link_id as number : null, verified: linkInput?.state === 'active' && peerInput?.link_id === linkInput?.link_id });
  const transport = Object.freeze({ epoch: counter('epoch'), verified: transportInput?.type === 'sound' && transportInput?.state === 'active' && stats?.worker_up === true && stats?.acoustic_ready === true });
  const snapshot = Object.freeze({ pingReady: input.pingReady && join.pingReady && input.reason === 'ready' && join.reason === 'ready', reason: input.reason as ProofReason, evidenceClass: input.evidenceClass as ProofEvidenceClass, peer, link, transport, isolationVerified: input.reason === 'ready', counters: Object.freeze({ completeTx: counter('complete_tx'), completeRx: counter('complete_rx'), acousticTx: counter('acoustic_tx'), acousticRx: counter('acoustic_rx'), fragmentsTx: counter('fragments_tx'), fragmentsRx: counter('fragments_rx'), integrityFailures: counter('integrity_failures'), retries: counter('retries') }) });
  return input.result ? Object.freeze({ snapshot, outcome: parseResult(input.result)! }) : Object.freeze({ snapshot });
}

function fingerprint(snapshot: ProofSnapshot): string { return `${snapshot.peer.identity}:${snapshot.link.id ?? 'none'}:${snapshot.transport.epoch ?? 'none'}:${snapshot.transport.verified}`; }
const initial = (): ProofState => Object.freeze({ mode: 'loading', needsRefresh: false, message: 'Waiting for current proof facts…' });

export function reduceProofState(previous: ProofState | undefined, action: Readonly<{ type: 'refresh' | 'running' | 'snapshot' | 'error'; value?: unknown; source?: 'refresh' | 'ping' }>): ProofState {
  const state = previous ?? initial();
  if (action.type === 'refresh') return Object.freeze({ ...state, mode: 'refreshing', message: 'Refreshing proof status…' });
  if (action.type === 'running') return Object.freeze({ mode: 'running', ...(state.snapshot ? { snapshot: state.snapshot } : {}), needsRefresh: true, message: 'Running kernel ping in Role A FIPS namespace…' });
  if (action.type === 'error') return Object.freeze({ mode: 'error', ...(state.snapshot ? { snapshot: state.snapshot } : {}), needsRefresh: true, message: 'Proof status unavailable — proof_unavailable. Refresh proof status.' });
  const parsed = parseProofSnapshot(action.value);
  if (!parsed) return Object.freeze({ mode: 'error', ...(state.snapshot ? { snapshot: state.snapshot } : {}), needsRefresh: true, message: 'Proof status unavailable — proof_unavailable. Refresh proof status.' });
  if (parsed.loading || !parsed.snapshot) return Object.freeze({ mode: 'loading', needsRefresh: true, message: 'Waiting for current proof facts…' });
  const changed = state.snapshot && fingerprint(state.snapshot) !== fingerprint(parsed.snapshot);
  const fresh = action.source === 'refresh'; const invalidatedOutcome = Boolean(changed && state.outcome); const needsRefresh = action.source === 'ping' || (!fresh && state.needsRefresh) || invalidatedOutcome;
  const outcome = invalidatedOutcome || needsRefresh ? undefined : parsed.outcome;
  if (action.source === 'ping' && parsed.outcome) {
    const nonphysical = parsed.outcome.exitCode === 0 && parsed.snapshot.evidenceClass !== 'Open air';
    const openAir = parsed.outcome.exitCode === 0 && parsed.snapshot.evidenceClass === 'Open air';
    return Object.freeze({ mode: openAir ? 'open-air' : nonphysical ? 'nonphysical' : 'failed', snapshot: parsed.snapshot, outcome: parsed.outcome, needsRefresh: true, message: openAir ? 'Open-air ICMPv6 reply observed across the authenticated Sound link.' : nonphysical ? 'ICMPv6 reply observed. Physical Open-air proof is still required.' : 'Kernel ping did not receive an ICMPv6 reply. Check the Sound link, then refresh proof status.' });
  }
  if (!parsed.snapshot.pingReady || needsRefresh) return Object.freeze({ mode: parsed.snapshot.evidenceClass === 'human_needed' ? 'human-needed' : 'blocked', snapshot: parsed.snapshot, needsRefresh, message: parsed.snapshot.evidenceClass === 'human_needed' ? 'Human needed — matching two-laptop Open-air evidence is not available.' : `Ping is blocked — ${reasonCopy(parsed.snapshot.reason)}. Refresh proof status after recovery.` });
  return Object.freeze({ mode: 'ready', snapshot: parsed.snapshot, ...(outcome ? { outcome } : {}), needsRefresh: false, message: 'Ready to run one kernel ICMPv6 ping from Role A.' });
}
