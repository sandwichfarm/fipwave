export type BridgeStatus = 'loading' | 'idle' | 'arming' | 'ready' | 'disconnected' | 'overflow' | 'rejected' | 'resetting';
export type QueueHealth = 'clear' | 'overflow' | 'rejected' | 'unknown';
export interface BridgeSnapshot {
  role: 'A' | 'B'; configuration: 'ready'; browserAudio: 'armed' | 'not-armed'; localBridge: 'ready' | 'disconnected'; soundTransport: 'started' | 'waiting';
  epoch: number; queueHealth: QueueHealth; queueItems: number; queueBytes: number; txPackets: number; rxPackets: number; soundMtu: number; lastEventAt: string; lastError: string | null;
}
export interface BridgeState {
  role: 'A' | 'B' | 'Unknown'; configuration: 'ready' | 'unknown'; browserAudio: 'armed' | 'not-armed' | 'unknown'; localBridge: 'ready' | 'disconnected' | 'unknown'; soundTransport: 'started' | 'waiting' | 'unknown';
  epoch: number; queueHealth: QueueHealth; queueItems: number; queueBytes: number; txPackets: number; rxPackets: number; soundMtu: number | null; lastEventAt: string | null; lastError: string | null; status: BridgeStatus; stale: boolean;
}
export type BridgeAction =
  | { type: 'snapshot'; snapshot: BridgeSnapshot }
  | { type: 'reset-start' }
  | { type: 'reset-ack'; epoch: number }
  | { type: 'reset-failed'; reason: string };

const fields = ['role', 'configuration', 'browserAudio', 'localBridge', 'soundTransport', 'epoch', 'queueHealth', 'queueItems', 'queueBytes', 'txPackets', 'rxPackets', 'soundMtu', 'lastEventAt', 'lastError'];
const safeBridgeError = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || /[\r\n]/.test(value)) return undefined;
  // The bridge only emits this allowlisted scalar form. Refusing everything
  // else prevents stack traces, URLs/query strings, secrets, and packet dumps
  // from becoming DOM or accessibility content.
  const match = /^Bridge rejected ([a-z0-9_]{1,80})\.$/.exec(value);
  return match ? `Bridge rejected ${match[1]}.` : undefined;
};
const safeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const nonNegative = (value: unknown): value is number => safeInteger(value) && value >= 0;
function fallback(): BridgeState {
  return { role: 'Unknown', configuration: 'unknown', browserAudio: 'unknown', localBridge: 'unknown', soundTransport: 'unknown', epoch: 0, queueHealth: 'unknown', queueItems: 0, queueBytes: 0, txPackets: 0, rxPackets: 0, soundMtu: null, lastEventAt: null, lastError: null, status: 'loading', stale: true };
}

/** Strictly admits bounded scalar bridge facts; raw frames, secrets and partial documents stay outside the DOM. */
export function validateBridgeSnapshot(input: unknown): BridgeSnapshot | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  const soundMtu = value.soundMtu;
  const lastError = value.lastError;
  const safeLastError = lastError === null ? null : safeBridgeError(lastError);
  if (Object.keys(value).length !== fields.length || Object.keys(value).some((key) => !fields.includes(key))) return undefined;
  if ((value.role !== 'A' && value.role !== 'B') || value.configuration !== 'ready' || (value.browserAudio !== 'armed' && value.browserAudio !== 'not-armed') || (value.localBridge !== 'ready' && value.localBridge !== 'disconnected') || (value.soundTransport !== 'started' && value.soundTransport !== 'waiting') || !nonNegative(value.epoch) || !['clear', 'overflow', 'rejected', 'unknown'].includes(String(value.queueHealth)) || !nonNegative(value.queueItems) || !nonNegative(value.queueBytes) || !nonNegative(value.txPackets) || !nonNegative(value.rxPackets) || !safeInteger(soundMtu) || soundMtu < 1357 || typeof value.lastEventAt !== 'string' || !Number.isFinite(Date.parse(value.lastEventAt)) || (lastError !== null && safeLastError !== lastError)) return undefined;
  return Object.freeze({ role: value.role, configuration: 'ready', browserAudio: value.browserAudio, localBridge: value.localBridge, soundTransport: value.soundTransport, epoch: value.epoch, queueHealth: value.queueHealth as QueueHealth, queueItems: value.queueItems, queueBytes: value.queueBytes, txPackets: value.txPackets, rxPackets: value.rxPackets, soundMtu, lastEventAt: value.lastEventAt, lastError: safeLastError ?? null });
}

export function reduceBridgeState(current: BridgeState | undefined, action: BridgeAction): BridgeState {
  const state = current ?? fallback();
  if (action.type === 'snapshot') {
    // RESET acknowledgement is the sole authority to leave resetting. A
    // newer status response can be in flight from a prior connection and must
    // not manufacture recovered state before that acknowledgement arrives.
    if (action.snapshot.epoch < state.epoch || state.status === 'resetting') return state;
    const status: BridgeStatus = action.snapshot.queueHealth === 'overflow' ? 'overflow' : action.snapshot.queueHealth === 'rejected' ? 'rejected' : action.snapshot.localBridge === 'ready' && action.snapshot.browserAudio === 'armed' ? 'ready' : action.snapshot.localBridge === 'disconnected' ? 'disconnected' : 'idle';
    return { ...action.snapshot, status, stale: status === 'disconnected' };
  }
  if (action.type === 'reset-start') return { ...state, status: 'resetting', stale: true };
  if (action.type === 'reset-ack') {
    if (state.status !== 'resetting' || action.epoch !== state.epoch + 1) return state;
    return { ...state, epoch: action.epoch, browserAudio: state.browserAudio === 'unknown' ? 'unknown' : 'not-armed', localBridge: state.localBridge === 'unknown' ? 'unknown' : 'disconnected', soundTransport: state.soundTransport === 'unknown' ? 'unknown' : 'waiting', queueHealth: 'clear', queueItems: 0, queueBytes: 0, txPackets: 0, rxPackets: 0, lastError: null, lastEventAt: new Date().toISOString(), status: 'idle', stale: false };
  }
  return { ...state, status: 'disconnected', stale: true, lastError: safeBridgeError(action.reason) ?? 'Bridge rejected bridge_status_unavailable.' };
}
