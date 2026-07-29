import { describe, expect, it } from 'vitest';

import { resolveDemoConfig, toPublicDemoConfig } from '../src/demo-config.js';

describe('demo configuration authority', () => {
  it('resolves only literal lower-case roles into frozen, display-ready configuration', () => {
    const config = resolveDemoConfig('a');

    expect(config).toMatchObject({
      inputRole: 'a',
      role: 'A',
      bridge: { host: '127.0.0.1', browserPath: '/bridge/browser', fipsPath: '/bridge/fips' },
      fips: { linkMtu: 1357 },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => resolveDemoConfig()).toThrow('role must be literal a or b');
    expect(() => resolveDemoConfig('A')).toThrow('role must be literal a or b');
    expect(() => resolveDemoConfig('gateway')).toThrow('role must be literal a or b');
  });

  it('projects an allowlisted public configuration without either private nsec', () => {
    const config = resolveDemoConfig('a');
    const publicConfig = toPublicDemoConfig(config);
    const serialized = JSON.stringify(publicConfig);

    expect(publicConfig).toMatchObject({ role: 'A', bridge: { browserPath: '/bridge/browser', fipsPath: '/bridge/fips' } });
    expect(serialized).not.toContain(config.identity.nsec);
    expect(serialized).not.toContain(config.peer.nsec);
    expect(serialized).not.toMatch(/nsec1/i);
    expect(() => JSON.stringify(resolveDemoConfig('invalid'))).toThrow('role must be literal a or b');
  });

  it('resolves complementary canonical A/B defaults from one complete authority', () => {
    const a = resolveDemoConfig('a');
    const b = resolveDemoConfig('b');

    expect(a.peer.publicKey).toBe(b.identity.publicKey);
    expect(b.peer.publicKey).toBe(a.identity.publicKey);
    expect(a.calibrationCandidates).toEqual(b.calibrationCandidates);
    expect(a.calibrationCandidates.map((candidate) => candidate.profileId)).toEqual(['quiet-audible-7k-v1', 'quiet-audible-7k-v1', 'quiet-audible-7k-v1']);
    expect(a.calibrationCandidates.map((candidate) => ({ id: candidate.id, payloadBytes: candidate.payloadBytes, playbackGain: candidate.playbackGain, guardMs: candidate.guardMs, ackTimeoutMs: candidate.ackTimeoutMs }))).toEqual([
      { id: 'quiet-bootstrap-robust-v1', payloadBytes: 96, playbackGain: 1, guardMs: 75, ackTimeoutMs: 4_000 },
      { id: 'quiet-full-frame-fast-v1', payloadBytes: 217, playbackGain: 1, guardMs: 20, ackTimeoutMs: 4_000 },
      { id: 'quiet-bootstrap-loud-v1', payloadBytes: 96, playbackGain: 2, guardMs: 50, ackTimeoutMs: 4_000 },
    ]);
    expect(a.identity.publicKey).toBe('npub1sjlh2c3x9w7kjsqg2ay080n2lff2uvt325vpan33ke34rn8l5jcqawh57m');
    expect(b.identity.publicKey).toBe('npub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2');
    expect(a).toMatchObject({
      bridge: { browserPort: expect.any(Number), fipsPort: expect.any(Number), fipsUrl: expect.stringMatching(/^ws:\/\/127\.0\.0\.1:/) },
      codecCapabilities: expect.arrayContaining(['quiet']),
      audioDefaults: { sampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      calibrationCandidates: expect.any(Array),
      acoustic: {
        protocol: { maximumBodyBytes: 217, maximumPacketBytes: 1357, maxFragments: 16 },
        arq: { windowSize: 4, maxAttempts: 3, maxQueuedPackets: 16, deliveredIdHistory: 32 },
        calibration: { maxCandidates: 3, probesPerDirection: 1, deadlineMs: 120_000, maximumPlaybackGain: 2 },
      },
      retries: { maxAttempts: expect.any(Number), minDelayMs: expect.any(Number), maxDelayMs: expect.any(Number) },
      heartbeat: { intervalMs: expect.any(Number), deadLinkTimeoutMs: expect.any(Number) },
      fips: { linkMtu: 1357 },
    });
  });

  it('derives exact Sound-only B and outbound-only A transport/proof policies without secrets in the public projection', () => {
    const a = resolveDemoConfig('a');
    const b = resolveDemoConfig('b');
    expect(a.fips).toMatchObject({ targetIpv6: b.fips.ipv6Address, transports: [{ kind: 'sound' }, { kind: 'udp', outboundOnly: true, acceptConnections: false, advertise: false }] });
    expect(b.fips).toMatchObject({ targetIpv6: b.fips.ipv6Address, transports: [{ kind: 'sound' }] });
    expect(b.proof).toMatchObject({ port: 45900, challengeBytes: 32, timeoutMs: 45_000, maxAttempts: 2, maxRequestsPerMinute: 6, replayCacheEntries: 32, replayTtlMs: 120_000, freshnessMs: 60_000 });
    const serialized = JSON.stringify(toPublicDemoConfig(a));
    expect(serialized).toContain('45900');
    expect(serialized).not.toContain(a.identity.nsec);
    expect(serialized).not.toContain(b.identity.nsec);
  });

  it('layers exact validated overrides without mutating or thawing canonical defaults', () => {
    const canonical = resolveDemoConfig('a');
    const before = JSON.stringify(canonical);
    const overridden = resolveDemoConfig('a', {
      bridge: { browserPort: 4_410, fipsPort: 4_410 },
      retries: { maxAttempts: 3, minDelayMs: 600, maxDelayMs: 1_200 },
      heartbeat: { intervalMs: 2_000, deadLinkTimeoutMs: 8_000 },
      acoustic: { fastGuardMs: 150 },
    });

    expect(overridden).toMatchObject({ bridge: { browserPort: 4_410 }, retries: { maxAttempts: 3 }, heartbeat: { deadLinkTimeoutMs: 8_000 }, calibrationCandidates: [{ guardMs: 75 }, { guardMs: 150 }, { guardMs: 50 }] });
    expect(JSON.stringify(canonical)).toBe(before);
    expect(Object.isFrozen(overridden)).toBe(true);
    expect(Object.isFrozen(overridden.bridge)).toBe(true);
    expect(Object.isFrozen(overridden.calibrationCandidates)).toBe(true);
  });

  it.each([
    ['unknown key', { unknown: true }],
    ['wide bridge URL', { bridge: { fipsUrl: 'ws://bridge.example.test:4311/bridge/fips' } }],
    ['split bridge endpoints', { bridge: { browserPort: 4_410, fipsPort: 4_411 } }],
    ['small MTU', { fips: { linkMtu: 1356 } }],
    ['bad retry range', { retries: { maxAttempts: 0, minDelayMs: 1_000, maxDelayMs: 500 } }],
    ['inconsistent peer', { peerPublicKey: 'npub1other' }],
    ['synthetic frequency', { acoustic: { frequencyHz: 7_000 } }],
    ['synthetic sample rate', { acoustic: { sampleRate: 48_000 } }],
    ['synthetic playback speed', { acoustic: { playbackSpeed: 1.1 } }],
  ])('fails closed for %s without leaking private values', (_name, override) => {
    const a = resolveDemoConfig('a');
    expect(() => resolveDemoConfig('a', override)).toThrow('demo config');
    try {
      resolveDemoConfig('a', override);
    } catch (error) {
      const serialized = String(error);
      expect(serialized).not.toContain(a.identity.nsec);
      expect(serialized).not.toContain(a.peer.nsec);
    }
  });
});
