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
function loopbackPorts(value, label) {
  if (value === undefined) return [];
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

export function validateComposeTopology(rendered) {
  const service = rendered?.services?.['tun-preflight'];
  if (!service || typeof service !== 'object') fail('tun-preflight service is missing');
  const devices = exactSet((service.devices ?? []).map(composeDevice).filter(Boolean), ['/dev/net/tun'], 'device');
  const capabilities = exactSet(service.cap_add, ['NET_ADMIN'], 'capabilities');
  const securityOptions = exactSet(service.security_opt, ['no-new-privileges:true'], 'security options');
  if (service.privileged !== false) fail('privileged mode must be false');
  if (service.network_mode === 'host') fail('host network is forbidden');
  if (service.network_mode !== 'none') fail('network mode must be none');
  const publishedPorts = loopbackPorts(service.ports, 'published ports');
  return evidence('static', expectedAuthorities({ devices, capabilities, securityOptions, privileged: false, networkMode: 'none', publishedPorts }), Object.fromEntries(AUTHORITY_CHECKS.map((check) => [check, 'passed'])));
}

export function validateDockerInspect(inspected) {
  const host = Array.isArray(inspected) ? inspected[0]?.HostConfig : inspected?.HostConfig;
  if (!host || typeof host !== 'object') fail('inspect HostConfig is missing');
  const devices = exactSet((host.Devices ?? []).map(inspectDevice).filter(Boolean), ['/dev/net/tun'], 'devices');
  const capabilities = exactSet(host.CapAdd, ['NET_ADMIN'], 'capabilities');
  const securityOptions = exactSet(host.SecurityOpt, ['no-new-privileges:true'], 'security options');
  if (host.Privileged !== false) fail('privileged mode must be false');
  if (host.NetworkMode === 'host') fail('host network is forbidden');
  if (host.NetworkMode !== 'none') fail('network mode must be none');
  const publishedPorts = loopbackPorts(host.PortBindings, 'published ports');
  return evidence('inspect', expectedAuthorities({ devices, capabilities, securityOptions, privileged: false, networkMode: 'none', publishedPorts }), Object.fromEntries(AUTHORITY_CHECKS.map((check) => [check, 'passed'])));
}

export function checkComposeSource(composeSource, dockerfileSource) {
  if (!dockerfileSource.includes(`FROM ${PINNED_IMAGE}`)) fail('Dockerfile image is not the pinned readable Alpine reference');
  const topology = {
    services: {
      'tun-preflight': {
        devices: /^\s+devices:\s*\n\s+-\s+\/dev\/net\/tun:\/dev\/net\/tun\s*$/m.test(composeSource) ? ['/dev/net/tun:/dev/net/tun'] : [],
        cap_add: /^\s+cap_add:\s*\n\s+-\s+NET_ADMIN\s*$/m.test(composeSource) ? ['NET_ADMIN'] : [],
        security_opt: /^\s+security_opt:\s*\n\s+-\s+no-new-privileges:true\s*$/m.test(composeSource) ? ['no-new-privileges:true'] : [],
        privileged: /^\s+privileged:\s+false\s*$/m.test(composeSource) ? false : undefined,
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
  if (inspectIndex >= 0) fail('--inspect-json requires --compose-json');
  const [composeSource, dockerfileSource] = await Promise.all([
    readFile(path.join(root, 'compose.preflight.yml'), 'utf8'),
    readFile(path.join(root, 'docker', 'preflight.Dockerfile'), 'utf8'),
  ]);
  console.log(JSON.stringify(checkComposeSource(composeSource, dockerfileSource)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
