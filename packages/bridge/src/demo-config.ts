import { LOOPBACK_HOST } from './server.js';

export type DemoRoleInput = 'a' | 'b';
export type DemoRole = 'A' | 'B';

interface PrivateDemoIdentity {
  readonly publicKey: string;
  readonly nsec: string;
}

interface DemoIdentityTable {
  readonly a: PrivateDemoIdentity;
  readonly b: PrivateDemoIdentity;
}

interface BridgeConfig {
  readonly host: typeof LOOPBACK_HOST;
  readonly browserPort: number;
  readonly fipsPort: number;
  readonly fipsUrl: string;
  readonly browserPath: '/bridge/browser';
  readonly fipsPath: '/bridge/fips';
}

interface RetryConfig { readonly maxAttempts: number; readonly minDelayMs: number; readonly maxDelayMs: number; }
interface HeartbeatConfig { readonly intervalMs: number; readonly deadLinkTimeoutMs: number; }
interface AudioDefaults { readonly sampleRate: 48_000; readonly channels: 1; readonly echoCancellation: false; readonly noiseSuppression: false; readonly autoGainControl: false; }
interface CalibrationCandidate { readonly id: string; readonly profileId: 'quiet-audible-7k-v1'; readonly codec: 'quiet'; readonly profile: 'audible-7k-channel-0'; readonly payloadBytes: number; readonly repetition: 1; readonly guardMs: 750; readonly playbackGain: number; readonly ackTimeoutMs: 4_000; }
interface AcousticConfig {
  readonly protocol: Readonly<{ maximumBodyBytes: 217; maximumPacketBytes: 1357; maxFragments: 16 }>;
  readonly arq: Readonly<{ windowSize: 4; maxAttempts: 3; maxQueuedPackets: 4; deliveredIdHistory: 32 }>;
  readonly calibration: Readonly<{ maxCandidates: 3; probesPerDirection: 4; deadlineMs: 120_000; maximumPlaybackGain: 2 }>;
}
type TransportPolicy = Readonly<{ readonly kind: 'sound' }> | Readonly<{ readonly kind: 'udp'; readonly outboundOnly: true; readonly acceptConnections: false; readonly advertise: false }>;
interface ProofConfig { readonly port: 45_900; readonly challengeBytes: 32; readonly timeoutMs: 45_000; readonly maxAttempts: 2; readonly maxRequestsPerMinute: 6; readonly replayCacheEntries: 32; readonly replayTtlMs: 120_000; readonly freshnessMs: 60_000; }

export interface DemoConfig {
  readonly inputRole: DemoRoleInput;
  readonly role: DemoRole;
  readonly identity: PrivateDemoIdentity;
  readonly peer: PrivateDemoIdentity;
  readonly bridge: BridgeConfig;
  readonly fips: Readonly<{ linkMtu: number; expectedPeerPublicKey: string; ipv6Address: string; targetIpv6: string; transports: readonly TransportPolicy[] }>;
  readonly proof: ProofConfig;
  readonly codecCapabilities: readonly ['quiet'];
  readonly audioDefaults: AudioDefaults;
  readonly calibrationCandidates: readonly CalibrationCandidate[];
  readonly acoustic: AcousticConfig;
  readonly retries: RetryConfig;
  readonly heartbeat: HeartbeatConfig;
}

export interface PublicDemoConfig {
  readonly role: DemoRole;
  readonly identityPublicKey: string;
  readonly peerPublicKey: string;
  readonly bridge: Readonly<{ host: typeof LOOPBACK_HOST; browserPort: number; fipsPort: number; browserPath: '/bridge/browser'; fipsPath: '/bridge/fips' }>;
  readonly fips: Readonly<{ linkMtu: number; expectedPeerPublicKey: string; ipv6Address: string; targetIpv6: string; transportKinds: readonly ('sound' | 'udp')[] }>;
  readonly proof: ProofConfig;
  readonly codecCapabilities: readonly ['quiet'];
  readonly audioDefaults: AudioDefaults;
  readonly calibrationCandidates: readonly CalibrationCandidate[];
  readonly acoustic: AcousticConfig;
  readonly retries: RetryConfig;
  readonly heartbeat: HeartbeatConfig;
}

/** Replace only these disposable demo identities; public projections never select nsecs. */
const IDENTITIES: DemoIdentityTable = Object.freeze({
  // Disposable demo public keys derived from the adjacent fixed secp256k1
  // nsecs. They are real NIP-19 npubs, not display-only placeholders.
  a: Object.freeze({ publicKey: 'npub1sjlh2c3x9w7kjsqg2ay080n2lff2uvt325vpan33ke34rn8l5jcqawh57m', nsec: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20' }),
  b: Object.freeze({ publicKey: 'npub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2', nsec: '0202020202020202020202020202020202020202020202020202020202020202' }),
});
const FIPS_IPV6 = Object.freeze({ a: 'fd69:e08d:65cc:3a6b:9c2c:2ac4:bd40:5e4b', b: 'fd46:f688:3bb:f389:e1df:f3e:3af3:9c30' });

const DEFAULTS = Object.freeze({
  bridge: Object.freeze({ browserPort: 4_310, fipsPort: 4_310, browserPath: '/bridge/browser' as const, fipsPath: '/bridge/fips' as const }),
  codecCapabilities: Object.freeze(['quiet'] as const),
  audioDefaults: Object.freeze({ sampleRate: 48_000 as const, channels: 1 as const, echoCancellation: false as const, noiseSuppression: false as const, autoGainControl: false as const }),
  calibrationCandidates: Object.freeze([
    Object.freeze({ id: 'quiet-bootstrap-96-v1', profileId: 'quiet-audible-7k-v1' as const, codec: 'quiet' as const, profile: 'audible-7k-channel-0' as const, payloadBytes: 96, repetition: 1 as const, guardMs: 750 as const, playbackGain: 1, ackTimeoutMs: 4_000 as const }),
    Object.freeze({ id: 'quiet-full-frame-v1', profileId: 'quiet-audible-7k-v1' as const, codec: 'quiet' as const, profile: 'audible-7k-channel-0' as const, payloadBytes: 217, repetition: 1 as const, guardMs: 750 as const, playbackGain: 1, ackTimeoutMs: 4_000 as const }),
    Object.freeze({ id: 'quiet-bootstrap-gain-2-v1', profileId: 'quiet-audible-7k-v1' as const, codec: 'quiet' as const, profile: 'audible-7k-channel-0' as const, payloadBytes: 96, repetition: 1 as const, guardMs: 750 as const, playbackGain: 2, ackTimeoutMs: 4_000 as const }),
  ]),
  acoustic: Object.freeze({ protocol: Object.freeze({ maximumBodyBytes: 217 as const, maximumPacketBytes: 1_357 as const, maxFragments: 16 as const }), arq: Object.freeze({ windowSize: 4 as const, maxAttempts: 3 as const, maxQueuedPackets: 4 as const, deliveredIdHistory: 32 as const }), calibration: Object.freeze({ maxCandidates: 3 as const, probesPerDirection: 4 as const, deadlineMs: 120_000 as const, maximumPlaybackGain: 2 as const }) }),
  retries: Object.freeze({ maxAttempts: 3, minDelayMs: 500, maxDelayMs: 2_000 }),
  heartbeat: Object.freeze({ intervalMs: 5_000, deadLinkTimeoutMs: 30_000 }),
  fips: Object.freeze({ linkMtu: 1_357 }),
  proof: Object.freeze({ port: 45_900 as const, challengeBytes: 32 as const, timeoutMs: 45_000 as const, maxAttempts: 2 as const, maxRequestsPerMinute: 6 as const, replayCacheEntries: 32 as const, replayTtlMs: 120_000 as const, freshnessMs: 60_000 as const }),
});

type UnknownRecord = Record<string, unknown>;
function fail(code: string): never { throw new Error(`demo config ${code}`); }
function record(value: unknown, code: string): UnknownRecord { if (!value || Array.isArray(value) || typeof value !== 'object') fail(code); return value as UnknownRecord; }
function exactKeys(value: UnknownRecord, allowed: readonly string[], code: string): void { if (Object.keys(value).some((key) => !allowed.includes(key))) fail(code); }
function integer(value: unknown, code: string, minimum: number, maximum: number): number { if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(code); return value as number; }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function fipsUrl(port: number): string { return `ws://${LOOPBACK_HOST}:${port}/bridge/fips`; }
function validateFipsUrl(value: unknown, port: number): string {
  if (typeof value !== 'string') fail('bridge_url_invalid');
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'ws:' || parsed.hostname !== LOOPBACK_HOST || parsed.port !== String(port) || parsed.pathname !== '/bridge/fips' || parsed.search || parsed.hash || parsed.username || parsed.password) fail('bridge_url_invalid');
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('demo config')) throw error;
    fail('bridge_url_invalid');
  }
}
function bridgeOverride(value: unknown): { browserPort?: number; fipsPort?: number; fipsUrl?: string } {
  const override = record(value, 'bridge_override_invalid'); exactKeys(override, ['browserPort', 'fipsPort', 'fipsUrl'], 'bridge_override_unknown_key');
  const result: { browserPort?: number; fipsPort?: number; fipsUrl?: string } = {};
  if ('browserPort' in override) result.browserPort = integer(override.browserPort, 'browser_port_invalid', 1, 65_535);
  if ('fipsPort' in override) result.fipsPort = integer(override.fipsPort, 'fips_port_invalid', 1, 65_535);
  if ('fipsUrl' in override) result.fipsUrl = typeof override.fipsUrl === 'string' ? override.fipsUrl : fail('bridge_url_invalid');
  return result;
}
function retryOverride(value: unknown): { maxAttempts?: number; minDelayMs?: number; maxDelayMs?: number } {
  const override = record(value, 'retries_override_invalid'); exactKeys(override, ['maxAttempts', 'minDelayMs', 'maxDelayMs'], 'retries_override_unknown_key');
  const result: { maxAttempts?: number; minDelayMs?: number; maxDelayMs?: number } = {};
  if ('maxAttempts' in override) result.maxAttempts = integer(override.maxAttempts, 'retry_attempts_invalid', 1, 3);
  if ('minDelayMs' in override) result.minDelayMs = integer(override.minDelayMs, 'retry_min_delay_invalid', 1, 60_000);
  if ('maxDelayMs' in override) result.maxDelayMs = integer(override.maxDelayMs, 'retry_max_delay_invalid', 1, 60_000);
  return result;
}
function acousticOverride(value: unknown): void { exactKeys(record(value, 'acoustic_override_invalid'), [], 'acoustic_override_unknown_key'); }
function heartbeatOverride(value: unknown): { intervalMs?: number; deadLinkTimeoutMs?: number } {
  const override = record(value, 'heartbeat_override_invalid'); exactKeys(override, ['intervalMs', 'deadLinkTimeoutMs'], 'heartbeat_override_unknown_key');
  const result: { intervalMs?: number; deadLinkTimeoutMs?: number } = {};
  if ('intervalMs' in override) result.intervalMs = integer(override.intervalMs, 'heartbeat_interval_invalid', 100, 60_000);
  if ('deadLinkTimeoutMs' in override) result.deadLinkTimeoutMs = integer(override.deadLinkTimeoutMs, 'heartbeat_timeout_invalid', 200, 300_000);
  return result;
}

/** Exact-schema, fail-closed optional overrides for tests and later launch orchestration. */
export function resolveDemoConfig(input?: string, overrides?: unknown): DemoConfig {
  if (input !== 'a' && input !== 'b') throw new Error('demo config role must be literal a or b');
  const raw = overrides === undefined ? {} : record(overrides, 'override_invalid');
  exactKeys(raw, ['bridge', 'fips', 'retries', 'heartbeat', 'peerPublicKey', 'acoustic'], 'override_unknown_key');
  if ('peerPublicKey' in raw) fail('peer_mapping_is_fixed');
  if ('acoustic' in raw) acousticOverride(raw.acoustic);

  const bridgePatch = 'bridge' in raw ? bridgeOverride(raw.bridge) : {};
  const browserPort = bridgePatch.browserPort ?? DEFAULTS.bridge.browserPort;
  const localFipsPort = bridgePatch.fipsPort ?? DEFAULTS.bridge.fipsPort;
  // One local bridge owns both browser and FIPS paths. Allowing these ports to
  // drift would make a valid-looking browser UI talk to a different listener.
  if (browserPort !== localFipsPort) fail('bridge_ports_must_match');
  const bridge: BridgeConfig = { host: LOOPBACK_HOST, browserPort, fipsPort: localFipsPort, fipsUrl: validateFipsUrl(bridgePatch.fipsUrl ?? fipsUrl(localFipsPort), localFipsPort), browserPath: DEFAULTS.bridge.browserPath, fipsPath: DEFAULTS.bridge.fipsPath };

  const fipsPatch = 'fips' in raw ? record(raw.fips, 'fips_override_invalid') : {};
  exactKeys(fipsPatch, ['linkMtu'], 'fips_override_unknown_key');
  const linkMtu = 'linkMtu' in fipsPatch ? integer(fipsPatch.linkMtu, 'sound_mtu_invalid', 1_357, 65_535) : DEFAULTS.fips.linkMtu;

  const retries = { ...DEFAULTS.retries, ...('retries' in raw ? retryOverride(raw.retries) : {}) };
  if (retries.minDelayMs > retries.maxDelayMs) fail('retry_bounds_invalid');
  const heartbeat = { ...DEFAULTS.heartbeat, ...('heartbeat' in raw ? heartbeatOverride(raw.heartbeat) : {}) };
  if (heartbeat.deadLinkTimeoutMs <= heartbeat.intervalMs) fail('heartbeat_bounds_invalid');

  const role: DemoRole = input === 'a' ? 'A' : 'B';
  const identity = IDENTITIES[input];
  const peer = IDENTITIES[input === 'a' ? 'b' : 'a'];
  const transports: readonly TransportPolicy[] = input === 'a'
    ? [Object.freeze({ kind: 'sound' as const }), Object.freeze({ kind: 'udp' as const, outboundOnly: true as const, acceptConnections: false as const, advertise: false as const })]
    : [Object.freeze({ kind: 'sound' as const })];
  return freeze({
    inputRole: input,
    role,
    identity,
    peer,
    bridge,
    fips: { linkMtu, expectedPeerPublicKey: peer.publicKey, ipv6Address: FIPS_IPV6[input], targetIpv6: FIPS_IPV6.b, transports },
    proof: { ...DEFAULTS.proof },
    codecCapabilities: [...DEFAULTS.codecCapabilities] as ['quiet'],
    audioDefaults: { ...DEFAULTS.audioDefaults },
    calibrationCandidates: DEFAULTS.calibrationCandidates.map((candidate) => ({ ...candidate })),
    acoustic: { protocol: { ...DEFAULTS.acoustic.protocol }, arq: { ...DEFAULTS.acoustic.arq }, calibration: { ...DEFAULTS.acoustic.calibration } },
    retries,
    heartbeat,
  });
}

/** Deliberate allowlist: browser state can never inherit a private identity field. */
export function toPublicDemoConfig(config: DemoConfig): PublicDemoConfig {
  return freeze({
    role: config.role,
    identityPublicKey: config.identity.publicKey,
    peerPublicKey: config.peer.publicKey,
    bridge: { host: config.bridge.host, browserPort: config.bridge.browserPort, fipsPort: config.bridge.fipsPort, browserPath: config.bridge.browserPath, fipsPath: config.bridge.fipsPath },
    fips: { linkMtu: config.fips.linkMtu, expectedPeerPublicKey: config.fips.expectedPeerPublicKey, ipv6Address: config.fips.ipv6Address, targetIpv6: config.fips.targetIpv6, transportKinds: config.fips.transports.map((transport) => transport.kind) },
    proof: { ...config.proof },
    codecCapabilities: [...config.codecCapabilities] as ['quiet'],
    audioDefaults: { ...config.audioDefaults },
    calibrationCandidates: config.calibrationCandidates.map((candidate) => ({ ...candidate })),
    acoustic: { protocol: { ...config.acoustic.protocol }, arq: { ...config.acoustic.arq }, calibration: { ...config.acoustic.calibration } },
    retries: { ...config.retries },
    heartbeat: { ...config.heartbeat },
  });
}
