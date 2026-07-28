import { createConnection } from 'node:net';
import type { Duplex } from 'node:stream';

export const MAX_REQUEST_BYTES = 512;
export const MAX_RESPONSE_BYTES = 65_536;
export const CONNECT_TIMEOUT_MS = 500;
export const READ_TIMEOUT_MS = 1_500;
export const TOTAL_TIMEOUT_MS = 2_000;

export type FipsControlQuery = 'peers' | 'links' | 'transports' | 'sessions';
export interface FipsConnectRequest { readonly npub: string; readonly address: string; readonly transport: 'sound'; }
export interface FipsPeer { readonly npub: string; readonly connectivity: string; readonly link_id: number; readonly transport_type: string; readonly authenticated_at_ms: number; readonly last_seen_ms: number; }
export interface FipsLink { readonly link_id: number; readonly transport_id: number; readonly state: string; readonly created_at_ms: number; readonly stats: Readonly<Record<string, number>>; }
export interface FipsTransport { readonly transport_id: number; readonly type: string; readonly state: string; readonly mtu: number; readonly stats: Readonly<Record<string, unknown>>; }
export interface FipsSession { readonly npub: string; readonly state: string; }
export type FipsControlData = { readonly peers: readonly FipsPeer[] } | { readonly links: readonly FipsLink[] } | { readonly transports: readonly FipsTransport[] } | { readonly sessions: readonly FipsSession[] };

export class FipsControlError extends Error {
  constructor(readonly code: 'query_invalid' | 'client_closed' | 'connect_timeout' | 'read_timeout' | 'total_timeout' | 'transport_error' | 'protocol_invalid' | 'daemon_error' | 'aborted') { super(code); }
}

type StreamFactory = (socketPath: string) => Duplex;
export interface FipsControlClient {
  query(query: FipsControlQuery, signal?: AbortSignal): Promise<FipsControlData>;
  connectPeer(request: FipsConnectRequest, signal?: AbortSignal): Promise<FipsConnectRequest>;
  close(): Promise<void>;
}
export interface FipsControlClientOptions { readonly socketPath: string; readonly connect?: StreamFactory; }

const COMMANDS: Readonly<Record<FipsControlQuery, string>> = Object.freeze({ peers: 'show_peers', links: 'show_links', transports: 'show_transports', sessions: 'show_sessions' });
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2_048;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);

function parseRows(query: FipsControlQuery, data: unknown): FipsControlData {
  const body = object(data);
  const key = query;
  if (!body || !exactKeys(body, [key]) || !Array.isArray(body[key])) throw new FipsControlError('protocol_invalid');
  if (query === 'peers') {
    const rows = body.peers as unknown[];
    const peers = rows.map((row): FipsPeer => {
      const value = object(row);
      if (!value || !text(value.npub) || !text(value.connectivity) || !finite(value.link_id) || !text(value.transport_type) || !finite(value.authenticated_at_ms) || !finite(value.last_seen_ms)) throw new FipsControlError('protocol_invalid');
      return Object.freeze({ npub: value.npub, connectivity: value.connectivity, link_id: value.link_id, transport_type: value.transport_type, authenticated_at_ms: value.authenticated_at_ms, last_seen_ms: value.last_seen_ms });
    });
    return Object.freeze({ peers: Object.freeze(peers) });
  }
  if (query === 'links') {
    const rows = body.links as unknown[];
    const links = rows.map((row): FipsLink => {
      const value = object(row); const stats = object(value?.stats);
      if (!value || !stats || !finite(value.link_id) || !finite(value.transport_id) || !text(value.state) || !finite(value.created_at_ms) || !Object.values(stats).every(finite)) throw new FipsControlError('protocol_invalid');
      return Object.freeze({ link_id: value.link_id, transport_id: value.transport_id, state: value.state, created_at_ms: value.created_at_ms, stats: Object.freeze({ ...stats } as Record<string, number>) });
    });
    return Object.freeze({ links: Object.freeze(links) });
  }
  if (query === 'sessions') {
    const rows = body.sessions as unknown[];
    const sessions = rows.map((row): FipsSession => {
      const value = object(row);
      if (!value || !text(value.npub) || !text(value.state)) throw new FipsControlError('protocol_invalid');
      return Object.freeze({ npub: value.npub, state: value.state });
    });
    return Object.freeze({ sessions: Object.freeze(sessions) });
  }
  const rows = body.transports as unknown[];
  const transports = rows.map((row): FipsTransport => {
    const value = object(row); const stats = object(value?.stats);
    if (!value || !stats || !finite(value.transport_id) || !text(value.type) || !text(value.state) || !finite(value.mtu)) throw new FipsControlError('protocol_invalid');
    return Object.freeze({ transport_id: value.transport_id, type: value.type, state: value.state, mtu: value.mtu, stats: Object.freeze({ ...stats }) });
  });
  return Object.freeze({ transports: Object.freeze(transports) });
}

function parseEnvelope(bytes: Buffer): unknown {
  let decoded: string;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new FipsControlError('protocol_invalid'); }
  let envelope: unknown;
  try { envelope = JSON.parse(decoded); } catch { throw new FipsControlError('protocol_invalid'); }
  const value = object(envelope);
  if (!value || !text(value.status)) throw new FipsControlError('protocol_invalid');
  if (value.status === 'error' && exactKeys(value, ['status', 'message']) && text(value.message)) throw new FipsControlError('daemon_error');
  if (value.status !== 'ok' || !exactKeys(value, ['status', 'data'])) throw new FipsControlError('protocol_invalid');
  return value.data;
}

function parseResponse(query: FipsControlQuery, bytes: Buffer): FipsControlData {
  return parseRows(query, parseEnvelope(bytes));
}

function validConnectRequest(value: FipsConnectRequest): boolean {
  return Boolean(
    value
    && /^npub1[0-9a-z]+$/.test(value.npub)
    && value.npub.length <= 128
    && /^sound-[ab]$/.test(value.address)
    && value.transport === 'sound',
  );
}

function parseConnectResponse(expected: FipsConnectRequest, bytes: Buffer): FipsConnectRequest {
  const data = object(parseEnvelope(bytes));
  if (
    !data
    || !exactKeys(data, ['npub', 'address', 'transport'])
    || data.npub !== expected.npub
    || data.address !== expected.address
    || data.transport !== expected.transport
  ) throw new FipsControlError('protocol_invalid');
  return Object.freeze({ ...expected });
}

export function createFipsControlClient(options: FipsControlClientOptions): FipsControlClient {
  if (!options.socketPath || options.socketPath !== '/run/fips/control.sock') throw new FipsControlError('query_invalid');
  const createStream = options.connect ?? ((socketPath: string): Duplex => createConnection(socketPath));
  let closed = false; let active: Duplex | undefined; let running = false;
  const queue: Array<() => void> = [];
  const drain = (): void => { if (!running && queue.length > 0) queue.shift()?.(); };
  const request = <T>(encodedRequest: Buffer, parse: (bytes: Buffer) => T, signal?: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
    if (closed) { reject(new FipsControlError('client_closed')); return; }
    const run = (): void => {
      if (closed) { reject(new FipsControlError('client_closed')); drain(); return; }
      running = true;
      if (encodedRequest.byteLength > MAX_REQUEST_BYTES) { running = false; reject(new FipsControlError('query_invalid')); drain(); return; }
      let socket: Duplex;
      try { socket = createStream(options.socketPath); } catch { running = false; reject(new FipsControlError('transport_error')); drain(); return; }
      active = socket;
      let settled = false; let bytes = Buffer.alloc(0); let sawNewline = false;
      let connectTimer: ReturnType<typeof setTimeout>; let readTimer: ReturnType<typeof setTimeout>; let totalTimer: ReturnType<typeof setTimeout>;
      const cleanup = (): void => { clearTimeout(connectTimer); clearTimeout(readTimer); clearTimeout(totalTimer); signal?.removeEventListener('abort', abort); socket.removeListener('data', onData); socket.removeListener('end', onEnd); socket.removeListener('error', onError); socket.removeListener('connect', onConnect); };
      const finish = (error?: FipsControlError, data?: T): void => {
        if (settled) return; settled = true; cleanup(); if (active === socket) active = undefined; socket.destroy(); running = false;
        if (error) reject(error); else resolve(data!); drain();
      };
      const fail = (code: FipsControlError['code']): void => finish(new FipsControlError(closed ? 'client_closed' : code));
      const onConnect = (): void => clearTimeout(connectTimer);
      const abort = (): void => fail(signal?.aborted ? 'aborted' : 'transport_error');
      const onError = (): void => fail('transport_error');
      const onData = (chunk: Buffer): void => {
        bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
        if (bytes.byteLength > MAX_RESPONSE_BYTES) { fail('protocol_invalid'); return; }
        const index = bytes.indexOf(0x0a);
        if (index < 0) return;
        if (sawNewline || bytes.subarray(index + 1).some((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0d && byte !== 0x0a)) { fail('protocol_invalid'); return; }
        sawNewline = true;
      };
      const onEnd = (): void => {
        if (!sawNewline) { fail('protocol_invalid'); return; }
        const line = bytes.subarray(0, bytes.indexOf(0x0a));
        try { finish(undefined, parse(line)); } catch (error) { finish(error instanceof FipsControlError ? error : new FipsControlError('protocol_invalid')); }
      };
      connectTimer = setTimeout(() => fail('connect_timeout'), CONNECT_TIMEOUT_MS);
      readTimer = setTimeout(() => fail('read_timeout'), READ_TIMEOUT_MS);
      totalTimer = setTimeout(() => fail('total_timeout'), TOTAL_TIMEOUT_MS);
      socket.on('connect', onConnect); socket.on('data', onData); socket.once('end', onEnd); socket.once('error', onError);
      signal?.addEventListener('abort', abort, { once: true });
      socket.end(encodedRequest);
    };
    queue.push(run); drain();
  });
  const query = (kind: FipsControlQuery, signal?: AbortSignal): Promise<FipsControlData> => {
    if (!(kind in COMMANDS)) return Promise.reject(new FipsControlError('query_invalid'));
    return request(Buffer.from(`${JSON.stringify({ command: COMMANDS[kind] })}\n`, 'utf8'), (bytes) => parseResponse(kind, bytes), signal);
  };
  const connectPeer = (peer: FipsConnectRequest, signal?: AbortSignal): Promise<FipsConnectRequest> => {
    if (!validConnectRequest(peer)) return Promise.reject(new FipsControlError('query_invalid'));
    const encoded = Buffer.from(`${JSON.stringify({ command: 'connect', params: peer })}\n`, 'utf8');
    return request(encoded, (bytes) => parseConnectResponse(peer, bytes), signal);
  };
  return Object.freeze({ query, connectPeer, async close(): Promise<void> { if (closed) return; closed = true; active?.destroy(); while (queue.length > 0) queue.shift()?.(); } });
}
