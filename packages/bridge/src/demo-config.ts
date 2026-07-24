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

export interface DemoConfig {
  readonly inputRole: DemoRoleInput;
  readonly role: DemoRole;
  readonly identity: PrivateDemoIdentity;
  readonly peer: PrivateDemoIdentity;
  readonly bridge: Readonly<{ host: typeof LOOPBACK_HOST; port: number; browserPath: '/bridge/browser'; fipsPath: '/bridge/fips' }>;
  readonly fips: Readonly<{ linkMtu: 1357; expectedPeerPublicKey: string }>;
  readonly codecCapabilities: readonly ['quiet'];
  readonly audioDefaults: Readonly<{ sampleRate: 48_000; channels: 1 }>;
  readonly timings: Readonly<{ retryMs: 1_000; heartbeatMs: 5_000 }>;
}

export interface PublicDemoConfig {
  readonly role: DemoRole;
  readonly identityPublicKey: string;
  readonly peerPublicKey: string;
  readonly bridge: Readonly<{ host: typeof LOOPBACK_HOST; port: number; browserPath: '/bridge/browser'; fipsPath: '/bridge/fips' }>;
  readonly fips: Readonly<{ linkMtu: 1357; expectedPeerPublicKey: string }>;
  readonly codecCapabilities: readonly ['quiet'];
  readonly audioDefaults: Readonly<{ sampleRate: 48_000; channels: 1 }>;
  readonly timings: Readonly<{ retryMs: 1_000; heartbeatMs: 5_000 }>;
}

/** Replace only these disposable demo identities; public projections never select nsecs. */
const IDENTITIES: DemoIdentityTable = Object.freeze({
  a: Object.freeze({ publicKey: 'npub1fipwavea000000000000000000000000000000000000000000000000000', nsec: 'nsec1fipwavea000000000000000000000000000000000000000000000000000' }),
  b: Object.freeze({ publicKey: 'npub1fipwaveb000000000000000000000000000000000000000000000000000', nsec: 'nsec1fipwaveb000000000000000000000000000000000000000000000000000' }),
});

const BRIDGE = Object.freeze({ host: LOOPBACK_HOST, port: 0, browserPath: '/bridge/browser' as const, fipsPath: '/bridge/fips' as const });
const CODEC_CAPABILITIES = Object.freeze(['quiet'] as const);
const AUDIO_DEFAULTS = Object.freeze({ sampleRate: 48_000 as const, channels: 1 as const });
const TIMINGS = Object.freeze({ retryMs: 1_000 as const, heartbeatMs: 5_000 as const });

function fail(): never {
  throw new Error('demo role must be literal a or b');
}

export function resolveDemoConfig(input?: string): DemoConfig {
  if (input !== 'a' && input !== 'b') fail();
  const role: DemoRole = input === 'a' ? 'A' : 'B';
  const identity = IDENTITIES[input];
  const peer = IDENTITIES[input === 'a' ? 'b' : 'a'];
  return Object.freeze({
    inputRole: input,
    role,
    identity,
    peer,
    bridge: BRIDGE,
    fips: Object.freeze({ linkMtu: 1357 as const, expectedPeerPublicKey: peer.publicKey }),
    codecCapabilities: CODEC_CAPABILITIES,
    audioDefaults: AUDIO_DEFAULTS,
    timings: TIMINGS,
  });
}

/** Deliberate allowlist: browser state can never inherit a private identity field. */
export function toPublicDemoConfig(config: DemoConfig): PublicDemoConfig {
  return Object.freeze({
    role: config.role,
    identityPublicKey: config.identity.publicKey,
    peerPublicKey: config.peer.publicKey,
    bridge: config.bridge,
    fips: config.fips,
    codecCapabilities: config.codecCapabilities,
    audioDefaults: config.audioDefaults,
    timings: config.timings,
  });
}
