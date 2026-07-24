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
});
