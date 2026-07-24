import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkFipsComposeSource, validateFipsComposeTopology } from '../scripts/check-compose.mjs';
import { assertFipsDaemonLogs, assertFipsRuntimeInspect, assertFipsSoundSnapshot, assertFipsTunRuntime, parseFipsComposeSmokeArgs } from '../scripts/fips-compose-smoke.mjs';

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
        cap_drop: ['ALL'],
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
  assert.match(compose, /^\s+-\s+fips-control:\/run\/fips:ro\s*$/m);
  assert.match(compose, /^\s+-\s+fips-control:\/run\/fips\s*$/m);
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
  assert.throws(() => validateFipsComposeTopology({ services: { bridge, fips: { ...fips, cap_drop: [] } } }), /dropped capabilities/);
  assert.throws(() => validateFipsComposeTopology({ services: { bridge, fips: { ...fips, privileged: true } } }), /privileged/);
  assert.throws(() => validateFipsComposeTopology({ services: { bridge, fips: { ...fips, devices: [] } } }), /device/);
});

test('owned runtime smoke accepts one role and rejects unsafe inspected topology', () => {
  assert.deepEqual(parseFipsComposeSmokeArgs(['--role', 'a']), { role: 'a', timeoutMs: 60_000 });
  assert.throws(() => parseFipsComposeSmokeArgs(['--role', 'c']), /role/);
  const inspected = [
    { Name: '/owned_bridge', HostConfig: { Privileged: false, NetworkMode: 'owned_default', CapAdd: null }, NetworkSettings: { Ports: { '4310/tcp': [{ HostIp: '127.0.0.1', HostPort: '4310' }] } } },
    { Name: '/owned_fips', Path: 'sh', Args: ['-ec', 'exec /usr/local/bin/fips --config /runtime/fips.yaml'], Config: { User: '0:0' }, State: { Running: true }, HostConfig: { Privileged: false, NetworkMode: 'container:owned_bridge', CapDrop: ['ALL'], CapAdd: ['NET_ADMIN'], Devices: [{ PathOnHost: '/dev/net/tun', PathInContainer: '/dev/net/tun' }], SecurityOpt: ['no-new-privileges:true'] }, NetworkSettings: { Ports: {} } },
  ];
  assert.doesNotThrow(() => assertFipsRuntimeInspect(inspected));
  inspected[1].HostConfig.CapAdd = ['NET_ADMIN', 'SYS_ADMIN'];
  assert.throws(() => assertFipsRuntimeInspect(inspected), /capabilities/);
  assert.deepEqual(assertFipsTunRuntime('0\n0000000000001000\n7: fips0: <POINTOPOINT,UP> mtu 1280 qdisc noop state UNKNOWN\ninet6 fd69:e08d:65cc:3a6b:9c2c:2ac4:bd40:5e4b/128 scope global\n', 'a'), { interface: 'fips0', mtu: 1280, ipv6Address: 'fd69:e08d:65cc:3a6b:9c2c:2ac4:bd40:5e4b' });
  assert.throws(() => assertFipsTunRuntime('0\n0000000000003000\n7: fips0: <UP> mtu 1280\ninet6 fd69:e08d:65cc:3a6b:9c2c:2ac4:bd40:5e4b/128 scope global\n', 'a'), /exactly effective NET_ADMIN/);
  assert.deepEqual(assertFipsDaemonLogs('Loaded config file\nTUN device active:\nNode started:\nstate: running\nFIPS running\nnpub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2', 'a'), { configuredPeer: 'npub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2', state: 'running' });
  assert.throws(() => assertFipsDaemonLogs('Node started: DEGRADED', 'a'), /missing runtime evidence/);
  assert.deepEqual(assertFipsSoundSnapshot({ peers: [{ npub: 'npub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2', connectivity: 'connected', link_id: 1, transport_type: 'sound' }], links: [{ link_id: 1, transport_id: 2, state: 'active' }], transports: [{ transport_id: 2, type: 'sound', state: 'active', stats: { worker_up: true, acoustic_ready: true, epoch: 1 } }, { transport_id: 3, type: 'udp', state: 'active', stats: {} }] }, 'a'), { transportId: 2, linkId: 1, epoch: 1 });
  assert.throws(() => assertFipsSoundSnapshot({ peers: [], links: [], transports: [{ transport_id: 2, type: 'udp', state: 'active', stats: {} }] }, 'b'), /Sound/);
});

test('both Compose build contexts exclude generated build outputs', async () => {
  const [bridgeIgnore, fipsIgnore] = await Promise.all([
    readFile(path.join(root, '.dockerignore'), 'utf8'),
    readFile(path.join(root, 'vendor/fips/.dockerignore'), 'utf8'),
  ]);
  for (const pattern of ['node_modules', 'dist', 'target', 'vendor/fips/target', '.git', '.planning']) {
    assert.match(bridgeIgnore, new RegExp(`^${pattern.replaceAll('/', '\\/').replaceAll('.', '\\.')}$`, 'm'));
  }
  assert.match(bridgeIgnore, /^\.artifacts\/\*$/m);
  assert.doesNotMatch(bridgeIgnore, /^!\.artifacts\//m, 'the image must build its verified codec cache on one Docker filesystem');
  assert.match(fipsIgnore, /^target$/m);
  assert.match(fipsIgnore, /^\.git$/m);
});
