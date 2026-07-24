export type BridgeStatus = 'loading' | 'idle' | 'arming' | 'ready' | 'disconnected' | 'overflow' | 'rejected' | 'resetting';
export type QueueHealth = 'clear' | 'overflow' | 'rejected' | 'unknown';
export interface BridgeSnapshot {
  role: 'A' | 'B'; configuration: 'ready'; browserAudio: 'armed' | 'not-armed'; localBridge: 'ready' | 'disconnected'; soundTransport: 'started' | 'waiting';
  epoch: number; queueHealth: QueueHealth; queueItems: number; queueBytes: number; txPackets: number; rxPackets: number; soundMtu: number; lastEventAt: string; lastError: string | null;
}
export interface BridgeState extends BridgeSnapshot { status: BridgeStatus; stale: boolean; }
export type BridgeAction =
  | { type: 'snapshot'; snapshot: BridgeSnapshot }
  | { type: 'reset-start' }
  | { type: 'reset-ack'; epoch: number }
  | { type: 'reset-failed'; reason: string };

const fields = ['role', 'configuration', 'browserAudio', 'localBridge', 'soundTransport', 'epoch', 'queueHealth', 'queueItems', 'queueBytes', 'txPackets', 'rxPackets', 'soundMtu', 'lastEventAt', 'lastError'];
const errorText = (value: string): string => value.replace(/[\r\n]+/g, ' ').replace(/nsec[0-9a-z]+/gi, '[redacted]').slice(0, 240);
const safeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const nonNegative = (value: unknown): value is number => safeInteger(value) && value >= 0;
function fallback(): BridgeState {
  return { role: 'A', configuration: 'ready', browserAudio: 'not-armed', localBridge: 'disconnected', soundTransport: 'waiting', epoch: 0, queueHealth: 'unknown', queueItems: 0, queueBytes: 0, txPackets: 0, rxPackets: 0, soundMtu: 1357, lastEventAt: new Date(0).toISOString(), lastError: null, status: 'loading', stale: false };
}

/** Strictly admits bounded scalar bridge facts; raw frames, secrets and partial documents stay outside the DOM. */
export function validateBridgeSnapshot(input: unknown): BridgeSnapshot | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  const soundMtu = value.soundMtu;
  const lastError = value.lastError;
  if (Object.keys(value).length !== fields.length || Object.keys(value).some((key) => !fields.includes(key))) return undefined;
  if ((value.role !== 'A' && value.role !== 'B') || value.configuration !== 'ready' || (value.browserAudio !== 'armed' && value.browserAudio !== 'not-armed') || (value.localBridge !== 'ready' && value.localBridge !== 'disconnected') || (value.soundTransport !== 'started' && value.soundTransport !== 'waiting') || !nonNegative(value.epoch) || !['clear', 'overflow', 'rejected', 'unknown'].includes(String(value.queueHealth)) || !nonNegative(value.queueItems) || !nonNegative(value.queueBytes) || !nonNegative(value.txPackets) || !nonNegative(value.rxPackets) || !safeInteger(soundMtu) || soundMtu < 1357 || typeof value.lastEventAt !== 'string' || !Number.isFinite(Date.parse(value.lastEventAt)) || (lastError !== null && (typeof lastError !== 'string' || lastError !== errorText(lastError)))) return undefined;
  return Object.freeze({ role: value.role, configuration: 'ready', browserAudio: value.browserAudio, localBridge: value.localBridge, soundTransport: value.soundTransport, epoch: value.epoch, queueHealth: value.queueHealth as QueueHealth, queueItems: value.queueItems, queueBytes: value.queueBytes, txPackets: value.txPackets, rxPackets: value.rxPackets, soundMtu, lastEventAt: value.lastEventAt, lastError });
}

export function reduceBridgeState(current: BridgeState | undefined, action: BridgeAction): BridgeState {
  const state = current ?? fallback();
  if (action.type === 'snapshot') {
    if (action.snapshot.epoch < state.epoch || state.status === 'resetting' && action.snapshot.epoch === state.epoch) return state;
    const status: BridgeStatus = action.snapshot.queueHealth === 'overflow' ? 'overflow' : action.snapshot.queueHealth === 'rejected' ? 'rejected' : action.snapshot.localBridge === 'ready' && action.snapshot.browserAudio === 'armed' ? 'ready' : action.snapshot.localBridge === 'disconnected' ? 'disconnected' : 'idle';
    return { ...action.snapshot, status, stale: status === 'disconnected' };
  }
  if (action.type === 'reset-start') return { ...state, status: 'resetting', stale: true };
  if (action.type === 'reset-ack') {
    if (state.status !== 'resetting' || action.epoch !== state.epoch + 1) return state;
    return { ...state, epoch: action.epoch, browserAudio: 'not-armed', localBridge: 'disconnected', soundTransport: 'waiting', queueHealth: 'clear', queueItems: 0, queueBytes: 0, txPackets: 0, rxPackets: 0, lastError: null, lastEventAt: new Date().toISOString(), status: 'idle', stale: false };
  }
  return { ...state, status: 'disconnected', stale: true, lastError: errorText(action.reason) };
}
