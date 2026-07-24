import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkFipsComposeSource, validateFipsComposeTopology } from '../scripts/check-compose.mjs';
import { assertFipsRuntimeInspect, parseFipsComposeSmokeArgs } from '../scripts/fips-compose-smoke.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function topology() {
  return {
    services: {
      bridge: {
        ports: ['127.0.0.1:4310:4310'],
        privileged: false,
      },
      fips: {
        network_mode: 'service:bridge',
        devices: ['/dev/net/tun:/dev/net/tun'],
        cap_add: ['NET_ADMIN'],
        security_opt: ['no-new-privileges:true'],
        privileged: false,
      },
    },
  };
}

test('the committed FIPS Compose source is a loopback-only shared namespace', async () => {
  const [compose, bridgeDockerfile, fipsDockerfile] = await Promise.all([
    readFile(path.join(root, 'compose.fips.yml'), 'utf8'),
    readFile(path.join(root, 'Dockerfile.bridge'), 'utf8'),
    readFile(path.join(root, 'vendor/fips/Dockerfile'), 'utf8'),
  ]);
  assert.deepEqual(checkFipsComposeSource(compose, bridgeDockerfile, fipsDockerfile).publishedPorts, ['127.0.0.1:4310:4310']);
});

test('Compose topology rejects namespace, bind, port, and privilege widening mutations', () => {
  assert.deepEqual(validateFipsComposeTopology(topology()).publishedPorts, ['127.0.0.1:4310:4310']);
  const fips = topology().services.fips;
  const bridge = topology().services.bridge;
  assert.throws(() => validateFipsComposeTopology({ services: { bridge: { ...bridge, ports: ['4310:4310'] }, fips } }), /loopback/);
  assert.throws(() => validateFipsComposeTopology({ services: { bridge, fips: { ...fips, network_mode: 'host' } } }), /namespace/);
  assert.throws(() => validateFipsComposeTopology({ services: { bridge, fips: { ...fips, network_mode: 'service:other' } } }), /namespace/);
  assert.throws(() => validateFipsComposeTopology({ services: { bridge: { ...bridge, ports: ['127.0.0.1:4310:4310', '127.0.0.1:4311:4311'] }, fips } }), /publish exactly/);
  assert.throws(() => validateFipsComposeTopology({ services: { bridge, fips: { ...fips, cap_add: ['NET_ADMIN', 'SYS_ADMIN'] } } }), /capabilities/);
  assert.throws(() => validateFipsComposeTopology({ services: { bridge, fips: { ...fips, privileged: true } } }), /privileged/);
  assert.throws(() => validateFipsComposeTopology({ services: { bridge, fips: { ...fips, devices: [] } } }), /device/);
});

test('owned runtime smoke accepts one role and rejects unsafe inspected topology', () => {
  assert.deepEqual(parseFipsComposeSmokeArgs(['--role', 'a']), { role: 'a', timeoutMs: 60_000 });
  assert.throws(() => parseFipsComposeSmokeArgs(['--role', 'c']), /role/);
  const inspected = [
    { Name: '/owned_bridge', HostConfig: { Privileged: false, NetworkMode: 'owned_default', CapAdd: null }, NetworkSettings: { Ports: { '4310/tcp': [{ HostIp: '127.0.0.1', HostPort: '4310' }] } } },
    { Name: '/owned_fips', HostConfig: { Privileged: false, NetworkMode: 'container:owned_bridge', CapAdd: ['NET_ADMIN'], Devices: [{ PathOnHost: '/dev/net/tun', PathInContainer: '/dev/net/tun' }], SecurityOpt: ['no-new-privileges:true'] }, NetworkSettings: { Ports: {} } },
  ];
  assert.doesNotThrow(() => assertFipsRuntimeInspect(inspected));
  inspected[1].HostConfig.CapAdd = ['NET_ADMIN', 'SYS_ADMIN'];
  assert.throws(() => assertFipsRuntimeInspect(inspected), /capabilities/);
});

test('both Compose build contexts exclude generated build outputs', async () => {
  const [bridgeIgnore, fipsIgnore] = await Promise.all([
    readFile(path.join(root, '.dockerignore'), 'utf8'),
    readFile(path.join(root, 'vendor/fips/.dockerignore'), 'utf8'),
  ]);
  for (const pattern of ['node_modules', 'dist', 'target', 'vendor/fips/target', '.git', '.planning', '.artifacts']) {
    assert.match(bridgeIgnore, new RegExp(`^${pattern.replaceAll('/', '\\/').replaceAll('.', '\\.')}$`, 'm'));
  }
  assert.match(fipsIgnore, /^target$/m);
  assert.match(fipsIgnore, /^\.git$/m);
});
