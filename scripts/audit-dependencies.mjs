import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NODE_VERSION = '22.23.1';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_AUDIT_PATH = path.join(
  PROJECT_ROOT,
  '.planning/phases/01-qualify-the-demo-substrate/dependency-audit.json',
);

export const EXPECTED_PACKAGES = Object.freeze({
  vite: {
    version: '8.1.5',
    repository: 'https://github.com/vitejs/vite',
  },
  typescript: {
    version: '7.0.2',
    repository: 'https://github.com/microsoft/typescript',
  },
  vitest: {
    version: '4.1.10',
    repository: 'https://github.com/vitest-dev/vitest',
  },
  '@playwright/test': {
    version: '1.61.1',
    repository: 'https://github.com/microsoft/playwright',
  },
  ws: {
    version: '8.21.1',
    repository: 'https://github.com/websockets/ws',
  },
  eslint: {
    version: '10.7.0',
    repository: 'https://github.com/eslint/eslint',
  },
  '@types/node': {
    version: '26.1.1',
    repository: 'https://github.com/definitelytyped/definitelytyped',
  },
  '@types/ws': {
    version: '8.18.1',
    repository: 'https://github.com/definitelytyped/definitelytyped',
  },
});

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return match.slice(1).map((part) => Number(part ?? 0));
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] > right[index] ? 1 : -1;
    }
  }

  return 0;
}

function matchesComparator(version, comparator) {
  const trimmed = comparator.trim();
  if (!trimmed || trimmed === '*' || trimmed.toLowerCase() === 'x') {
    return true;
  }

  const caret = trimmed.match(/^\^\s*(.+)$/);
  if (caret) {
    const base = parseVersion(caret[1]);
    if (!base || compareVersions(version, base) < 0) {
      return false;
    }
    const upper = base[0] > 0
      ? [base[0] + 1, 0, 0]
      : base[1] > 0
        ? [0, base[1] + 1, 0]
        : [0, 0, base[2] + 1];
    return compareVersions(version, upper) < 0;
  }

  const tilde = trimmed.match(/^~\s*(.+)$/);
  if (tilde) {
    const base = parseVersion(tilde[1]);
    return Boolean(
      base
      && compareVersions(version, base) >= 0
      && version[0] === base[0]
      && version[1] === base[1],
    );
  }

  const match = trimmed.match(/^(<=|>=|<|>|=)?\s*(v?\d+(?:\.\d+){0,2})$/);
  if (!match) {
    return false;
  }

  const target = parseVersion(match[2]);
  const comparison = compareVersions(version, target);
  switch (match[1] ?? '=') {
    case '>=':
      return comparison >= 0;
    case '<=':
      return comparison <= 0;
    case '>':
      return comparison > 0;
    case '<':
      return comparison < 0;
    default:
      return comparison === 0;
  }
}

export function isNodeEngineCompatible(range, nodeVersion = NODE_VERSION) {
  if (range === undefined || range === null || range === '') {
    return true;
  }
  if (typeof range !== 'string') {
    return false;
  }

  const version = parseVersion(nodeVersion);
  if (!version) {
    return false;
  }

  return range.split('||').some((alternative) => {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    return comparators.length > 0
      && comparators.every((comparator) => matchesComparator(version, comparator));
  });
}

export function normalizeRepository(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }

  let normalized = raw.trim()
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/')
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/\.git(?:#.*)?$/i, '')
    .replace(/\/$/, '');

  if (!/^https:\/\/github\.com\//i.test(normalized)) {
    return null;
  }

  normalized = normalized.toLowerCase();
  return normalized;
}

function exactPackageNames() {
  return Object.keys(EXPECTED_PACKAGES).sort();
}

function validateRecord(record) {
  const errors = [];
  if (!isObject(record)) {
    return ['package record must be an object'];
  }

  const expected = EXPECTED_PACKAGES[record.name];
  if (!expected) {
    return [`unapproved package ${String(record.name)}`];
  }
  if (record.version !== expected.version) {
    errors.push(`${record.name} must be ${expected.version}`);
  }
  if (!isObject(record.engines)) {
    errors.push(`${record.name} must include declared engines`);
  } else if (!isNodeEngineCompatible(record.engines.node)) {
    errors.push(`${record.name} has an incompatible Node engine`);
  }
  if (normalizeRepository(record.repository) !== expected.repository) {
    errors.push(`${record.name} repository is not the approved upstream`);
  }
  if (typeof record.integrity !== 'string' || !record.integrity.startsWith('sha512-')) {
    errors.push(`${record.name} must include npm dist.integrity`);
  }
  if (!isTimestamp(record.publishedAt)) {
    errors.push(`${record.name} must include a publication timestamp`);
  }
  if (!isTimestamp(record.fetchedAt)) {
    errors.push(`${record.name} must include a registry fetch timestamp`);
  }
  if (record.auditResult !== 'pass') {
    errors.push(`${record.name} audit result must pass`);
  }

  return errors;
}

export function validateAudit(audit) {
  const errors = [];
  if (!isObject(audit)) {
    return { ok: false, errors: ['audit must be an object'] };
  }
  if (audit.schemaVersion !== 1) {
    errors.push('audit schemaVersion must be 1');
  }
  if (audit.nodeVersion !== NODE_VERSION) {
    errors.push(`audit nodeVersion must be ${NODE_VERSION}`);
  }
  if (!isTimestamp(audit.generatedAt)) {
    errors.push('audit must include generatedAt');
  }
  if (audit.auditResult !== 'pass') {
    errors.push('audit result must pass');
  }
  if (!Array.isArray(audit.packages)) {
    errors.push('audit packages must be an array');
    return { ok: false, errors };
  }

  const expectedNames = exactPackageNames();
  const actualNames = audit.packages.map((record) => record?.name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    errors.push('audit must contain exactly the approved package set');
  }

  for (const record of audit.packages) {
    errors.push(...validateRecord(record));
  }

  return { ok: errors.length === 0, errors };
}

function directDependenciesFromLockfile(lockfile) {
  const rootPackage = lockfile?.packages?.[''];
  if (!isObject(rootPackage)) {
    return null;
  }

  const direct = {};
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!isObject(rootPackage[field])) {
      continue;
    }
    for (const [name, version] of Object.entries(rootPackage[field])) {
      direct[name] = version;
    }
  }
  return direct;
}

export function validateLockfile(lockfile, audit) {
  const errors = [];
  const auditValidation = validateAudit(audit);
  if (!auditValidation.ok) {
    return { ok: false, errors: ['cannot check lockfile with an invalid audit', ...auditValidation.errors] };
  }
  if (!isObject(lockfile?.packages)) {
    return { ok: false, errors: ['lockfile packages must be an object'] };
  }

  const direct = directDependenciesFromLockfile(lockfile);
  if (!direct) {
    return { ok: false, errors: ['lockfile root package is missing'] };
  }

  const expectedNames = exactPackageNames();
  const actualNames = Object.keys(direct).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    errors.push('lockfile direct dependency set diverges from the audit');
  }

  for (const record of audit.packages) {
    if (direct[record.name] !== record.version) {
      errors.push(`${record.name} direct version diverges from the audit`);
    }
    const installed = lockfile.packages[`node_modules/${record.name}`];
    if (!isObject(installed)) {
      errors.push(`${record.name} is missing from lockfile packages`);
      continue;
    }
    if (installed.version !== record.version) {
      errors.push(`${record.name} installed version diverges from the audit`);
    }
    if (installed.integrity !== record.integrity) {
      errors.push(`${record.name} integrity diverges from the audit`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function assertPinnedNodeRuntime() {
  const activeVersion = process.versions.node;
  if (activeVersion !== NODE_VERSION) {
    fail(`audit generation requires Node ${NODE_VERSION}; active Node is ${activeVersion}`);
  }
}

async function fetchPackageRecord(name) {
  const expected = EXPECTED_PACKAGES[name];
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    fail(`npm registry request for ${name} failed with ${response.status}`);
  }

  const packument = await response.json();
  const manifest = packument?.versions?.[expected.version];
  if (!isObject(manifest)) {
    fail(`npm registry is missing ${name}@${expected.version}`);
  }

  return {
    name,
    version: manifest.version,
    engines: isObject(manifest.engines) ? manifest.engines : {},
    repository: normalizeRepository(manifest.repository),
    integrity: manifest.dist?.integrity,
    publishedAt: packument.time?.[expected.version],
    fetchedAt: new Date().toISOString(),
    auditResult: 'pass',
  };
}

export async function generateAudit() {
  assertPinnedNodeRuntime();
  const packages = await Promise.all(exactPackageNames().map(fetchPackageRecord));
  const audit = {
    schemaVersion: 1,
    nodeVersion: NODE_VERSION,
    generatedAt: new Date().toISOString(),
    auditResult: 'pass',
    packages,
  };
  const validation = validateAudit(audit);
  if (!validation.ok) {
    fail(`refusing to write invalid audit:\n${validation.errors.map((error) => `- ${error}`).join('\n')}`);
  }

  return audit;
}

async function writeAuditAtomically(audit, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
}

async function readJson(inputPath) {
  try {
    return JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (error) {
    fail(`could not read JSON from ${inputPath}: ${error.message}`);
  }
}

function reportValidation(result) {
  if (!result.ok) {
    fail(result.errors.join('\n'));
  }
}

async function main(args) {
  const [command, firstPath, secondPath] = args;
  if (command === '--check') {
    if (!firstPath || secondPath) {
      fail('usage: audit-dependencies.mjs --check <audit-path>');
    }
    reportValidation(validateAudit(await readJson(path.resolve(firstPath))));
    return;
  }
  if (command === '--check-lock') {
    if (!firstPath || args.length > 3) {
      fail('usage: audit-dependencies.mjs --check-lock <lockfile-path> [audit-path]');
    }
    const auditPath = path.resolve(secondPath ?? DEFAULT_AUDIT_PATH);
    reportValidation(validateLockfile(
      await readJson(path.resolve(firstPath)),
      await readJson(auditPath),
    ));
    return;
  }
  if (command && args.length > 1) {
    fail('usage: audit-dependencies.mjs [audit-path]');
  }

  const outputPath = path.resolve(command ?? DEFAULT_AUDIT_PATH);
  await writeAuditAtomically(await generateAudit(), outputPath);
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`dependency audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
