import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PINNED_IMAGE = 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c';
const INTERFACE_NAME = 'fips-preflight0';
const IPV6_ADDRESS = 'fd42:6677:6677::1/64';
const AUTHORITY_CHECKS = ['imagePinned', 'tunDevice', 'netAdmin', 'noNewPrivileges', 'notPrivileged', 'sysAdminAbsent', 'hostNetworkAbsent', 'loopbackPortsOnly'];
const LIFECYCLE_CHECKS = ['interfaceCreated', 'ipv6Assigned', 'cleanupComplete'];

function fail(message) { throw new Error(`Compose preflight ${message}`); }
function exactSet(value, expected, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) fail(`${label} must be present`);
  const actual = [...value].sort();
  const canonical = [...expected].sort();
  if (new Set(actual).size !== actual.length || actual.length !== canonical.length || actual.some((entry, index) => entry !== canonical[index])) fail(`${label} must be exactly ${canonical.join(', ')}`);
  return canonical;
}
function composeDevice(entry) {
  if (typeof entry === 'string') return entry === '/dev/net/tun:/dev/net/tun' ? '/dev/net/tun' : undefined;
  if (entry && typeof entry === 'object' && entry.source === '/dev/net/tun' && entry.target === '/dev/net/tun') return '/dev/net/tun';
  return undefined;
}
function inspectDevice(entry) {
  return entry && typeof entry === 'object' && entry.PathOnHost === '/dev/net/tun' && entry.PathInContainer === '/dev/net/tun' ? '/dev/net/tun' : undefined;
}
function inspectCapabilities(value) {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => entry === 'CAP_NET_ADMIN' ? 'NET_ADMIN' : entry);
}
function loopbackPorts(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) && (typeof value !== 'object' || value === null)) fail(`${label} are invalid`);
  const entries = Array.isArray(value) ? value : Object.values(value).flat().map((binding) => `${binding?.HostIp ?? ''}:${binding?.HostPort ?? ''}`);
  if (entries.some((entry) => {
    const rendered = typeof entry === 'string' ? entry : `${entry?.host_ip ?? entry?.HostIp ?? ''}:${entry?.published ?? entry?.HostPort ?? ''}`;
    return !(/^127\.0\.0\.1:\d+/.test(rendered) || /^\[::1\]:\d+/.test(rendered));
  })) fail(`${label} must bind loopback only`);
  return entries.map((entry) => typeof entry === 'string' ? entry : `${entry?.host_ip ?? entry?.HostIp ?? ''}:${entry?.published ?? entry?.HostPort ?? ''}`).sort();
}
function evidence(source, authorities, checks) {
  const allChecks = Object.fromEntries([...AUTHORITY_CHECKS, ...LIFECYCLE_CHECKS].map((check) => [check, checks[check] ?? 'not_run']));
  return {
    schemaVersion: 1,
    source,
    status: Object.values(allChecks).includes('failed') ? 'failed' : 'passed',
    image: PINNED_IMAGE,
    interfaceName: INTERFACE_NAME,
    ipv6Address: IPV6_ADDRESS,
    authorities,
    checks: allChecks,
    errors: [],
  };
}
function expectedAuthorities({ devices, capabilities, securityOptions, privileged, networkMode, publishedPorts }) {
  return { devices, capabilities, securityOptions, privileged, networkMode, publishedPorts };
}

function fipsService(rendered) {
  const bridge = rendered?.services?.bridge;
  const fips = rendered?.services?.fips;
  if (!bridge || !fips || typeof bridge !== 'object' || typeof fips !== 'object') fail('bridge and fips services are required');
  return { bridge, fips };
}

/** Validate the production shared-namespace topology without accepting defaults silently. */
export function validateFipsComposeTopology(rendered) {
  const { bridge, fips } = fipsService(rendered);
  const publishedPorts = loopbackPorts(bridge.ports, 'bridge published ports');
  if (publishedPorts.length !== 1) fail('bridge must publish exactly one browser port');
  if (fips.ports !== undefined && fips.ports !== null && (!Array.isArray(fips.ports) || fips.ports.length !== 0)) fail('fips must not publish a packet port');
  if (fips.network_mode !== 'service:bridge') fail('fips network namespace must target service:bridge');
  if (bridge.network_mode === 'host' || fips.network_mode === 'host') fail('host network is forbidden');
  if (bridge.privileged !== undefined && bridge.privileged !== false) fail('bridge privileged mode must be false');
  if (fips.privileged !== false) fail('fips privileged mode must be false');
  exactSet((fips.devices ?? []).map(composeDevice).filter(Boolean), ['/dev/net/tun'], 'fips device');
  exactSet(fips.cap_add, ['NET_ADMIN'], 'fips capabilities');
  exactSet(fips.security_opt, ['no-new-privileges:true'], 'fips security options');
  return { publishedPorts };
}

/** Source gate keeps role authority generated at runtime rather than committed. */
export function checkFipsComposeSource(composeSource, bridgeDockerfile, fipsDockerfile) {
  if (!bridgeDockerfile.includes('FROM node:22.23.1-bookworm-slim')) fail('bridge image must pin Node 22.23.1');
  if (!fipsDockerfile.includes('FROM rust:1.94.1-bookworm')) fail('fips image must pin Rust 1.94.1');
  if (!fipsDockerfile.includes('pkg-config') || !fipsDockerfile.includes('libdbus-1-dev')) fail('fips build image must provide dbus build dependencies');
  if (!fipsDockerfile.includes('libdbus-1-3')) fail('fips runtime image must provide dbus runtime dependency');
  if (/\bnsec\b/i.test(composeSource)) fail('compose must not contain role secrets');
  if (!/^\s+network_mode:\s+service:bridge\s*$/m.test(composeSource)) fail('fips namespace target is missing');
  if (!/^\s+-\s+"127\.0\.0\.1:\$\{BROWSER_PORT:-4310\}:4310"\s*$/m.test(composeSource)) fail('browser port must bind host loopback explicitly');
  return validateFipsComposeTopology({
    services: {
      bridge: {
        ports: ['127.0.0.1:4310:4310'],
        privileged: /^\s+privileged:\s+false\s*$/m.test(composeSource) ? false : true,
      },
      fips: {
        network_mode: /^\s+network_mode:\s+service:bridge\s*$/m.test(composeSource) ? 'service:bridge' : undefined,
        devices: /^\s+devices:\s*\n\s+-\s+\/dev\/net\/tun:\/dev\/net\/tun\s*$/m.test(composeSource) ? ['/dev/net/tun:/dev/net/tun'] : [],
        cap_add: /^\s+cap_add:\s*\n\s+-\s+NET_ADMIN\s*$/m.test(composeSource) ? ['NET_ADMIN'] : [],
        security_opt: /^\s+security_opt:\s*\n\s+-\s+no-new-privileges:true\s*$/m.test(composeSource) ? ['no-new-privileges:true'] : [],
        privileged: (composeSource.match(/^\s+privileged:\s+false\s*$/gm) ?? []).length >= 2 ? false : true,
      },
    },
  });
}

export function combineExactHostEvidence(inspected, lifecycle) {
  const authority = validateDockerInspect(inspected);
  if (!lifecycle || lifecycle.schemaVersion !== 1 || lifecycle.source !== 'lifecycle' || lifecycle.status !== 'passed') {
    fail('exact-host lifecycle evidence must be passed');
  }
  const lifecycleAuthority = lifecycle.authorities;
  if (!lifecycleAuthority) fail('exact-host lifecycle identity or authority does not match inspect');
  const lifecycleDevices = exactSet(lifecycleAuthority.devices, ['/dev/net/tun'], 'lifecycle devices');
  const lifecycleCapabilities = exactSet(lifecycleAuthority.capabilities, ['NET_ADMIN'], 'lifecycle capabilities');
  const lifecycleSecurity = exactSet(lifecycleAuthority.securityOptions, ['no-new-privileges:true'], 'lifecycle security options');
  const lifecyclePorts = loopbackPorts(lifecycleAuthority.publishedPorts, 'lifecycle published ports');
  if (
    lifecycle.image !== PINNED_IMAGE
    || lifecycle.interfaceName !== INTERFACE_NAME
    || lifecycle.ipv6Address !== IPV6_ADDRESS
    || lifecycleAuthority.privileged !== false
    || lifecycleAuthority.networkMode !== 'none'
    || lifecycleDevices.some((value, index) => value !== authority.authorities.devices[index])
    || lifecycleCapabilities.some((value, index) => value !== authority.authorities.capabilities[index])
    || lifecycleSecurity.some((value, index) => value !== authority.authorities.securityOptions[index])
    || lifecyclePorts.length !== authority.authorities.publishedPorts.length
    || lifecyclePorts.some((value, index) => value !== authority.authorities.publishedPorts[index])
  ) {
    fail('exact-host lifecycle identity or authority does not match inspect');
  }
  if (
    !lifecycle.checks
    || AUTHORITY_CHECKS.some((check) => lifecycle.checks[check] !== 'not_run')
    || LIFECYCLE_CHECKS.some((check) => lifecycle.checks[check] !== 'passed')
    || !Array.isArray(lifecycle.errors)
    || lifecycle.errors.length !== 0
  ) {
    fail('exact-host lifecycle checks are incomplete');
  }
  return evidence(
    'exact_host',
    authority.authorities,
    Object.fromEntries([...AUTHORITY_CHECKS, ...LIFECYCLE_CHECKS].map((check) => [check, 'passed'])),
  );
}

export function validateComposeTopology(rendered) {
  const service = rendered?.services?.['tun-preflight'];
  if (!service || typeof service !== 'object') fail('tun-preflight service is missing');
  const devices = exactSet((service.devices ?? []).map(composeDevice).filter(Boolean), ['/dev/net/tun'], 'device');
  const capabilities = exactSet(service.cap_add, ['NET_ADMIN'], 'capabilities');
  const securityOptions = exactSet(service.security_opt, ['no-new-privileges:true'], 'security options');
  // `docker compose config --format json` omits explicit false values. The
  // repository source check below requires the declaration; the rendered
  // topology can safely normalize Docker's omitted default to false and the
  // exact host inspect verifies the effective value.
  if (service.privileged !== undefined && service.privileged !== false) fail('privileged mode must be false');
  if (service.network_mode === 'host') fail('host network is forbidden');
  if (service.network_mode !== 'none') fail('network mode must be none');
  const publishedPorts = loopbackPorts(service.ports, 'published ports');
  return evidence('static', expectedAuthorities({ devices, capabilities, securityOptions, privileged: false, networkMode: 'none', publishedPorts }), Object.fromEntries(AUTHORITY_CHECKS.map((check) => [check, 'passed'])));
}

export function validateDockerInspect(inspected) {
  const host = Array.isArray(inspected) ? inspected[0]?.HostConfig : inspected?.HostConfig;
  if (!host || typeof host !== 'object') fail('inspect HostConfig is missing');
  const devices = exactSet((host.Devices ?? []).map(inspectDevice).filter(Boolean), ['/dev/net/tun'], 'devices');
  // Docker Engine versions may expose the same Linux capability with or
  // without its kernel-level CAP_ prefix. Canonicalize that spelling only;
  // exactSet still rejects duplicates and every additional capability.
  const capabilities = exactSet(inspectCapabilities(host.CapAdd), ['NET_ADMIN'], 'capabilities');
  const securityOptions = exactSet(host.SecurityOpt, ['no-new-privileges:true'], 'security options');
  if (host.Privileged !== false) fail('privileged mode must be false');
  if (host.NetworkMode === 'host') fail('host network is forbidden');
  if (host.NetworkMode !== 'none') fail('network mode must be none');
  const publishedPorts = loopbackPorts(host.PortBindings, 'published ports');
  return evidence('inspect', expectedAuthorities({ devices, capabilities, securityOptions, privileged: false, networkMode: 'none', publishedPorts }), Object.fromEntries(AUTHORITY_CHECKS.map((check) => [check, 'passed'])));
}

export function checkComposeSource(composeSource, dockerfileSource) {
  if (!dockerfileSource.includes(`FROM ${PINNED_IMAGE}`)) fail('Dockerfile image is not the pinned readable Alpine reference');
  if (!/^\s+privileged:\s+false\s*$/m.test(composeSource)) fail('privileged mode must be explicitly false');
  const topology = {
    services: {
      'tun-preflight': {
        devices: /^\s+devices:\s*\n\s+-\s+\/dev\/net\/tun:\/dev\/net\/tun\s*$/m.test(composeSource) ? ['/dev/net/tun:/dev/net/tun'] : [],
        cap_add: /^\s+cap_add:\s*\n\s+-\s+NET_ADMIN\s*$/m.test(composeSource) ? ['NET_ADMIN'] : [],
        security_opt: /^\s+security_opt:\s*\n\s+-\s+no-new-privileges:true\s*$/m.test(composeSource) ? ['no-new-privileges:true'] : [],
        privileged: false,
        network_mode: /^\s+network_mode:\s+none\s*$/m.test(composeSource) ? 'none' : undefined,
      },
    },
  };
  if (/^\s+(ports|network_mode:\s+host):/m.test(composeSource)) fail('published ports or host network are forbidden in preflight topology');
  return validateComposeTopology(topology);
}

async function main() {
  const args = process.argv.slice(2);
  const composeIndex = args.indexOf('--compose-json');
  const inspectIndex = args.indexOf('--inspect-json');
  const lifecycleIndex = args.indexOf('--lifecycle-json');
  if (args.includes('--exact-host')) {
    const inspectPath = args[inspectIndex + 1];
    const lifecyclePath = args[lifecycleIndex + 1];
    if (inspectIndex < 0 || lifecycleIndex < 0 || !inspectPath || !lifecyclePath) {
      fail('--exact-host requires --inspect-json and --lifecycle-json paths');
    }
    const [inspected, lifecycle] = await Promise.all([
      readFile(inspectPath, 'utf8').then(JSON.parse),
      readFile(lifecyclePath, 'utf8').then(JSON.parse),
    ]);
    console.log(JSON.stringify(combineExactHostEvidence(inspected, lifecycle)));
    return;
  }
  if (args.includes('--fips-source')) {
    const [composeSource, bridgeDockerfile, fipsDockerfile] = await Promise.all([
      readFile(path.join(root, 'compose.fips.yml'), 'utf8'),
      readFile(path.join(root, 'Dockerfile.bridge'), 'utf8'),
      readFile(path.join(root, 'vendor', 'fips', 'Dockerfile'), 'utf8'),
    ]);
    console.log(JSON.stringify(checkFipsComposeSource(composeSource, bridgeDockerfile, fipsDockerfile)));
    return;
  }
  if (composeIndex >= 0) {
    const composePath = args[composeIndex + 1];
    if (!composePath) fail('--compose-json requires a path');
    console.log(JSON.stringify(validateComposeTopology(JSON.parse(await readFile(composePath, 'utf8')))));
    if (inspectIndex >= 0) {
      const inspectPath = args[inspectIndex + 1];
      if (!inspectPath) fail('--inspect-json requires a path');
      console.log(JSON.stringify(validateDockerInspect(JSON.parse(await readFile(inspectPath, 'utf8')))));
    }
    return;
  }
  if (inspectIndex >= 0) {
    const inspectPath = args[inspectIndex + 1];
    if (!inspectPath) fail('--inspect-json requires a path');
    console.log(JSON.stringify(validateDockerInspect(JSON.parse(await readFile(inspectPath, 'utf8')))));
    return;
  }
  const [composeSource, dockerfileSource] = await Promise.all([
    readFile(path.join(root, 'compose.preflight.yml'), 'utf8'),
    readFile(path.join(root, 'docker', 'preflight.Dockerfile'), 'utf8'),
  ]);
  console.log(JSON.stringify(checkComposeSource(composeSource, dockerfileSource)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
