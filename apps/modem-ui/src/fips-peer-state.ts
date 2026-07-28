export type FipsPeerReason =
  | 'ready'
  | 'peer_missing'
  | 'peer_not_sound'
  | 'link_missing'
  | 'link_inactive'
  | 'transport_missing'
  | 'transport_not_ready'
  | 'acoustic_stale'
  | 'acoustic_epoch_mismatch'
  | 'snapshot_stale';

export interface FipsPeerStatus {
  readonly peerReady: boolean;
  readonly reason: FipsPeerReason;
}

const reasons = new Set<FipsPeerReason>([
  'ready',
  'peer_missing',
  'peer_not_sound',
  'link_missing',
  'link_inactive',
  'transport_missing',
  'transport_not_ready',
  'acoustic_stale',
  'acoustic_epoch_mismatch',
  'snapshot_stale',
]);

export function parseFipsPeerStatus(value: unknown): FipsPeerStatus | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !('peerReady' in input) || !('reason' in input)) return undefined;
  if (typeof input.peerReady !== 'boolean' || !reasons.has(input.reason as FipsPeerReason)) return undefined;
  if (input.peerReady !== (input.reason === 'ready')) return undefined;
  return Object.freeze({ peerReady: input.peerReady, reason: input.reason as FipsPeerReason });
}
