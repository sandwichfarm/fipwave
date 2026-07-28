import type { FipsConnectRequest, FipsControlClient } from './fips-control-client.js';

export type FipsPeerReconcileResult = 'waiting_for_acoustic' | 'connected' | 'connecting' | 'connect_initiated';

export interface FipsPeerReconcileOptions {
  readonly control: Pick<FipsControlClient, 'query' | 'connectPeer'>;
  readonly peer: FipsConnectRequest;
  readonly acousticReady: () => boolean;
}

export async function reconcileFipsPeer(options: FipsPeerReconcileOptions): Promise<FipsPeerReconcileResult> {
  if (!options.acousticReady()) return 'waiting_for_acoustic';
  const peerData = await options.control.query('peers');
  if (!('peers' in peerData)) throw new Error('fips_peer_query_invalid');
  if (peerData.peers.some((peer) => (
    peer.npub === options.peer.npub
    && peer.connectivity === 'connected'
    && peer.transport_type === 'sound'
  ))) return 'connected';
  const transportData = await options.control.query('transports');
  const linkData = await options.control.query('links');
  if (!('transports' in transportData) || !('links' in linkData)) throw new Error('fips_link_query_invalid');
  const soundTransportIds = new Set(
    transportData.transports
      .filter((transport) => transport.type === 'sound' && ['up', 'active'].includes(transport.state))
      .map((transport) => transport.transport_id),
  );
  if (linkData.links.some((link) => soundTransportIds.has(link.transport_id) && ['connected', 'active'].includes(link.state))) {
    return 'connecting';
  }
  await options.control.connectPeer(options.peer);
  return 'connect_initiated';
}

export interface FipsPeerReconciler {
  close(): Promise<void>;
}

export function createFipsPeerReconciler(
  options: FipsPeerReconcileOptions & Readonly<{ pollDelayMs?: number; retryDelayMs?: number }>,
): FipsPeerReconciler {
  const pollDelayMs = options.pollDelayMs ?? 250;
  const retryDelayMs = options.retryDelayMs ?? 15_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  const schedule = (delayMs: number): void => {
    if (!stopped) timer = setTimeout(run, delayMs);
  };
  const run = (): void => {
    if (stopped || inFlight) return;
    inFlight = reconcileFipsPeer(options)
      .then((result) => {
        schedule(result === 'connect_initiated' ? retryDelayMs : pollDelayMs);
      })
      .catch(() => schedule(pollDelayMs))
      .finally(() => { inFlight = undefined; });
  };
  schedule(0);
  return Object.freeze({
    async close(): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  });
}
