import { createHash, randomBytes } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';

export interface IsolationChallenge { readonly schemaVersion: 1; readonly challenge: string; }
export interface IsolationSnapshot {
  readonly expectedPeerPublicKey: string; readonly targetIpv6: string; readonly build: string; readonly epoch: number; readonly settingsId: string; readonly observedAtMs: number;
  readonly transport: Readonly<{ transportId: number; type: 'sound'; state: 'active'; workerUp: true; acousticReady: true }>;
  readonly link: Readonly<{ linkId: number; peerPublicKey: string }>;
}
export interface IsolationAttestation extends IsolationSnapshot { readonly schemaVersion: 1; readonly challenge: string; readonly snapshotDigest: string; }
export interface IsolationResponder { attest(challenge: IsolationChallenge): Promise<IsolationAttestation>; listen(): Promise<void>; close(): Promise<void>; }
export interface IsolationResponderOptions { readonly now: () => number; readonly snapshot: () => Promise<IsolationSnapshot>; readonly host?: string; readonly port?: number; }
export interface IsolationAttestationRequestOptions {
  readonly now: () => number;
  readonly sourceHost: string;
  readonly targetHost: string;
  readonly port: number;
  readonly expectedPeerPublicKey: string;
  readonly expectedTargetIpv6: string;
  readonly expectedBuild: string;
  readonly expectedEpoch: number;
  readonly expectedSettingsId: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

const MAX_BYTES = 1024; const CHALLENGE_BYTES = 32; const WINDOW_MS = 60_000; const REPLAY_TTL_MS = 120_000; const MAX_REPLAYS = 32; const MAX_PER_MINUTE = 6;
function fail(code: string): never { throw new Error(code); }
function challenge(value: unknown): IsolationChallenge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('challenge_invalid');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || input.schemaVersion !== 1 || typeof input.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.challenge) || Buffer.from(input.challenge, 'base64url').byteLength !== CHALLENGE_BYTES) fail('challenge_invalid');
  return Object.freeze({ schemaVersion: 1, challenge: input.challenge });
}
function challengeText(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, 'base64url').byteLength !== CHALLENGE_BYTES) fail('attestation_invalid');
  return value;
}
function snapshot(value: IsolationSnapshot, now: number): IsolationSnapshot {
  if (!value || typeof value !== 'object' || !value.transport || !value.link || !/^npub1[0-9a-z]+$/.test(value.expectedPeerPublicKey) || !/^fd[0-9a-f]{2}:[0-9a-f:]+$/i.test(value.targetIpv6) || !/^[a-f0-9]{40}$/i.test(value.build) || !Number.isSafeInteger(value.epoch) || value.epoch < 0 || typeof value.settingsId !== 'string' || value.settingsId.length === 0 || !Number.isSafeInteger(value.observedAtMs) || now - value.observedAtMs > WINDOW_MS || value.observedAtMs > now + 1_000 || value.transport.type !== 'sound' || value.transport.state !== 'active' || value.transport.workerUp !== true || value.transport.acousticReady !== true || !Number.isSafeInteger(value.transport.transportId) || !Number.isSafeInteger(value.link.linkId) || value.link.peerPublicKey !== value.expectedPeerPublicKey) fail('snapshot_invalid');
  return Object.freeze({ ...value, transport: Object.freeze({ ...value.transport }), link: Object.freeze({ ...value.link }) });
}
function canonical(value: IsolationSnapshot & IsolationChallenge): string { return JSON.stringify({ build: value.build, challenge: value.challenge, epoch: value.epoch, expectedPeerPublicKey: value.expectedPeerPublicKey, link: value.link, observedAtMs: value.observedAtMs, schemaVersion: 1, settingsId: value.settingsId, targetIpv6: value.targetIpv6, transport: value.transport }); }
export function parseIsolationAttestation(value: unknown): IsolationAttestation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('attestation_invalid');
  const input = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'challenge', 'expectedPeerPublicKey', 'targetIpv6', 'build', 'epoch', 'settingsId', 'observedAtMs', 'transport', 'link', 'snapshotDigest'];
  if (Object.keys(input).length !== keys.length || keys.some((key) => !(key in input)) || typeof input.snapshotDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.snapshotDigest)) fail('attestation_invalid');
  const base = snapshot(input as unknown as IsolationSnapshot, Number((input as unknown as IsolationAttestation).observedAtMs)); const request = Object.freeze({ schemaVersion: 1 as const, challenge: challengeText(input.challenge) });
  const digest = createHash('sha256').update(canonical({ ...base, ...request })).digest('hex');
  if (digest !== input.snapshotDigest) fail('attestation_invalid');
  return Object.freeze({ ...base, ...request, snapshotDigest: digest });
}
export function createIsolationResponder(options: IsolationResponderOptions): IsolationResponder {
  const replay = new Map<string, number>(); const requests: number[] = []; let socket: Socket | undefined;
  const attest = async (value: IsolationChallenge): Promise<IsolationAttestation> => {
    const now = options.now(); const request = challenge(value);
    for (const [key, at] of replay) if (now - at > REPLAY_TTL_MS) replay.delete(key);
    while (requests.length > 0 && now - (requests[0] ?? now) > WINDOW_MS) requests.shift();
    if (requests.length >= MAX_PER_MINUTE) fail('rate_limited'); if (replay.has(request.challenge)) fail('challenge_replayed');
    replay.set(request.challenge, now); requests.push(now);
    let current: IsolationSnapshot;
    try { current = snapshot(await options.snapshot(), now); } catch (error) { replay.delete(request.challenge); requests.pop(); throw error; }
    if (replay.size > MAX_REPLAYS) replay.delete(replay.keys().next().value as string);
    const response = Object.freeze({ schemaVersion: 1 as const, challenge: request.challenge, ...current, snapshotDigest: createHash('sha256').update(canonical({ ...current, ...request })).digest('hex') });
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > MAX_BYTES) fail('attestation_oversize'); return response;
  };
  return Object.freeze({
    attest,
    async listen(): Promise<void> {
      if (socket) return; socket = createSocket('udp6');
      socket.on('message', (body, remote) => { if (body.byteLength > MAX_BYTES || remote.family !== 'IPv6') return; let request: IsolationChallenge; try { request = challenge(JSON.parse(body.toString('utf8'))); } catch { return; }
        void attest(request).then((response) => socket?.send(Buffer.from(JSON.stringify(response)), remote.port, remote.address)).catch(() => undefined); });
      try {
        await new Promise<void>((resolve, reject) => { socket?.once('error', reject); socket?.bind(options.port ?? 45_900, options.host ?? '::', () => { socket?.off('error', reject); resolve(); }); });
      } catch (error) {
        const current = socket; socket = undefined; current?.close(); throw error;
      }
    },
    async close(): Promise<void> { if (!socket) return; const current = socket; socket = undefined; await new Promise<void>((resolve) => current.close(() => resolve())); },
  });
}

/** One-use in-band UDP6 request. It accepts only the configured B fips0 source and exact current bindings. */
export async function requestIsolationAttestation(options: IsolationAttestationRequestOptions): Promise<IsolationAttestation> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxAttempts = options.maxAttempts ?? 2;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45_000 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) fail('request_invalid');
  const request = Object.freeze({ schemaVersion: 1 as const, challenge: randomBytes(CHALLENGE_BYTES).toString('base64url') });
  const body = Buffer.from(JSON.stringify(request), 'utf8');
  if (body.byteLength > MAX_BYTES) fail('request_invalid');
  let lastError = 'attestation_timeout';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await new Promise<IsolationAttestation>((resolve, reject) => {
        const client = createSocket('udp6'); let settled = false;
        const finish = (error?: Error, value?: IsolationAttestation): void => {
          if (settled) return; settled = true; clearTimeout(timer); client.removeAllListeners(); client.close(); if (error) reject(error); else resolve(value!);
        };
        const timer = setTimeout(() => finish(new Error('attestation_timeout')), timeoutMs);
        client.once('error', () => finish(new Error('attestation_transport_error')));
        client.on('message', (incoming, remote) => {
          if (incoming.byteLength > MAX_BYTES || remote.family !== 'IPv6' || remote.address !== options.targetHost || remote.port !== options.port) return;
          try {
            const attestation = parseIsolationAttestation(JSON.parse(incoming.toString('utf8')));
            const now = options.now();
            if (attestation.challenge !== request.challenge || attestation.expectedPeerPublicKey !== options.expectedPeerPublicKey || attestation.targetIpv6 !== options.expectedTargetIpv6 || attestation.build !== options.expectedBuild || attestation.epoch !== options.expectedEpoch || attestation.settingsId !== options.expectedSettingsId || now - attestation.observedAtMs > WINDOW_MS || attestation.observedAtMs > now + 1_000) fail('attestation_binding_invalid');
            finish(undefined, attestation);
          } catch (error) { finish(error instanceof Error ? error : new Error('attestation_invalid')); }
        });
        client.bind(0, options.sourceHost, () => { client.send(body, options.port, options.targetHost, (error) => { if (error) finish(new Error('attestation_transport_error')); }); });
      });
      return response;
    } catch (error) { lastError = error instanceof Error ? error.message : 'attestation_invalid'; }
  }
  fail(lastError);
}
