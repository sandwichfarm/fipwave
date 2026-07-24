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
    expect(a).toMatchObject({
      bridge: { browserPort: expect.any(Number), fipsPort: expect.any(Number), fipsUrl: expect.stringMatching(/^ws:\/\/127\.0\.0\.1:/) },
      codecCapabilities: expect.arrayContaining(['quiet']),
      audioDefaults: { sampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      calibrationCandidates: expect.any(Array),
      retries: { maxAttempts: expect.any(Number), minDelayMs: expect.any(Number), maxDelayMs: expect.any(Number) },
      heartbeat: { intervalMs: expect.any(Number), deadLinkTimeoutMs: expect.any(Number) },
      fips: { linkMtu: 1357 },
    });
  });

  it('layers exact validated overrides without mutating or thawing canonical defaults', () => {
    const canonical = resolveDemoConfig('a');
    const before = JSON.stringify(canonical);
    const overridden = resolveDemoConfig('a', {
      bridge: { browserPort: 4_410 },
      retries: { maxAttempts: 4, minDelayMs: 600, maxDelayMs: 1_200 },
      heartbeat: { intervalMs: 2_000, deadLinkTimeoutMs: 8_000 },
    });

    expect(overridden).toMatchObject({ bridge: { browserPort: 4_410 }, retries: { maxAttempts: 4 }, heartbeat: { deadLinkTimeoutMs: 8_000 } });
    expect(JSON.stringify(canonical)).toBe(before);
    expect(Object.isFrozen(overridden)).toBe(true);
    expect(Object.isFrozen(overridden.bridge)).toBe(true);
    expect(Object.isFrozen(overridden.calibrationCandidates)).toBe(true);
  });

  it.each([
    ['unknown key', { unknown: true }],
    ['duplicate ports', { bridge: { browserPort: 4_311, fipsPort: 4_311 } }],
    ['wide bridge URL', { bridge: { fipsUrl: 'ws://bridge.example.test:4311/bridge/fips' } }],
    ['small MTU', { fips: { linkMtu: 1356 } }],
    ['bad retry range', { retries: { maxAttempts: 0, minDelayMs: 1_000, maxDelayMs: 500 } }],
    ['inconsistent peer', { peerPublicKey: 'npub1other' }],
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
