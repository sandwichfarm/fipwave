import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateTunEvidence } from '../packages/bridge/src/report.js';
import { checkComposeSource, validateComposeTopology, validateDockerInspect } from '../scripts/check-compose.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function renderedCompose() {
  return {
    services: {
      'tun-preflight': {
        devices: ['/dev/net/tun:/dev/net/tun'],
        cap_add: ['NET_ADMIN'],
        security_opt: ['no-new-privileges:true'],
        privileged: false,
        network_mode: 'none',
      },
    },
  };
}

function inspect() {
  return {
    HostConfig: {
      Devices: [{ PathOnHost: '/dev/net/tun', PathInContainer: '/dev/net/tun' }],
      CapAdd: ['NET_ADMIN'],
      SecurityOpt: ['no-new-privileges:true'],
      Privileged: false,
      NetworkMode: 'none',
      PortBindings: {},
    },
  };
}

describe('least-privilege Docker/TUN preflight', () => {
  it('renders the checked repository topology as stable static TunEvidence', async () => {
    const composeSource = await readFile(path.join(root, 'compose.preflight.yml'), 'utf8');
    const dockerfileSource = await readFile(path.join(root, 'docker', 'preflight.Dockerfile'), 'utf8');
    const evidence = checkComposeSource(composeSource, dockerfileSource);

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      source: 'static',
      status: 'passed',
      interfaceName: 'fips-preflight0',
      ipv6Address: 'fd42:6677:6677::1/64',
      authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] },
    });
    expect(validateTunEvidence(evidence)).toEqual(evidence);
    expect(JSON.stringify(evidence)).toBe(JSON.stringify(checkComposeSource(composeSource, dockerfileSource)));
  });

  it('rejects missing or broader rendered Compose authority regardless of input order', () => {
    expect(() => validateComposeTopology(renderedCompose())).not.toThrow();
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], devices: [] } } })).toThrow('device');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], cap_add: ['NET_ADMIN', 'SYS_ADMIN'] } } })).toThrow('capabilities');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], security_opt: null } } })).toThrow('security options');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], privileged: true } } })).toThrow('privileged');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], network_mode: 'host' } } })).toThrow('host network');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], ports: ['0.0.0.0:8787:8787'] } } })).toThrow('loopback');
  });

  it('rejects inspect authority drift and accepts only the exact inspected set', () => {
    expect(() => validateDockerInspect(inspect())).not.toThrow();
    expect(() => validateDockerInspect({ HostConfig: { ...inspect().HostConfig, CapAdd: ['SYS_ADMIN', 'NET_ADMIN'] } })).toThrow('capabilities');
    expect(() => validateDockerInspect({ HostConfig: { ...inspect().HostConfig, Devices: null } })).toThrow('devices');
    expect(() => validateDockerInspect({ HostConfig: { ...inspect().HostConfig, SecurityOpt: [] } })).toThrow('security options');
    expect(() => validateDockerInspect({ HostConfig: { ...inspect().HostConfig, NetworkMode: 'host' } })).toThrow('host network');
  });
});
