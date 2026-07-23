import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_PACKAGES,
  validateAudit,
  validateLockfile,
} from '../scripts/audit-dependencies.mjs';

const EXPECTED_NAMES = Object.keys(EXPECTED_PACKAGES);

function createRecord(name) {
  const expected = EXPECTED_PACKAGES[name];

  return {
    name,
    version: expected.version,
    engines: { node: '>=18.0.0' },
    repository: expected.repository,
    integrity: `sha512-${Buffer.from(name).toString('base64')}`,
    publishedAt: '2026-07-01T00:00:00.000Z',
    fetchedAt: '2026-07-23T00:00:00.000Z',
    auditResult: 'pass',
  };
}

function createAudit() {
  return {
    schemaVersion: 1,
    nodeVersion: '22.23.1',
    generatedAt: '2026-07-23T00:00:00.000Z',
    auditResult: 'pass',
    packages: EXPECTED_NAMES.map(createRecord),
  };
}

function createLockfile(audit = createAudit()) {
  const directDependencies = Object.fromEntries(
    audit.packages.map(({ name, version }) => [name, version]),
  );
  const installedPackages = Object.fromEntries(
    audit.packages.map(({ name, version, integrity }) => [
      `node_modules/${name}`,
      { version, integrity },
    ]),
  );

  return {
    lockfileVersion: 3,
    packages: {
      '': { devDependencies: directDependencies },
      ...installedPackages,
    },
  };
}

test('accepts the exact approved audit and matching lockfile', () => {
  const audit = createAudit();

  assert.deepEqual(validateAudit(audit), { ok: true, errors: [] });
  assert.deepEqual(validateLockfile(createLockfile(audit), audit), {
    ok: true,
    errors: [],
  });
});

test('rejects a missing package, extra direct package, and wrong version', () => {
  const missing = createAudit();
  missing.packages.pop();
  assert.equal(validateAudit(missing).ok, false);

  const extra = createAudit();
  extra.packages.push({ ...createRecord('vite'), name: 'unapproved' });
  assert.equal(validateAudit(extra).ok, false);

  const wrongVersion = createAudit();
  wrongVersion.packages[0].version = '0.0.0';
  assert.equal(validateAudit(wrongVersion).ok, false);
});

test('rejects incompatible Node engines, a wrong repository, and absent integrity', () => {
  const incompatibleEngine = createAudit();
  incompatibleEngine.packages[0].engines = { node: '<22.0.0' };
  assert.equal(validateAudit(incompatibleEngine).ok, false);

  const wrongRepository = createAudit();
  wrongRepository.packages[0].repository = 'https://github.com/example/typosquat';
  assert.equal(validateAudit(wrongRepository).ok, false);

  const missingIntegrity = createAudit();
  missingIntegrity.packages[0].integrity = '';
  assert.equal(validateAudit(missingIntegrity).ok, false);
});

test('rejects lockfiles with direct-version, integrity, missing, and added-package drift', () => {
  const audit = createAudit();

  const wrongVersion = createLockfile(audit);
  wrongVersion.packages['node_modules/vite'].version = '0.0.0';
  assert.equal(validateLockfile(wrongVersion, audit).ok, false);

  const wrongIntegrity = createLockfile(audit);
  wrongIntegrity.packages['node_modules/vite'].integrity = 'sha512-divergent';
  assert.equal(validateLockfile(wrongIntegrity, audit).ok, false);

  const missing = createLockfile(audit);
  delete missing.packages['node_modules/vite'];
  assert.equal(validateLockfile(missing, audit).ok, false);

  const added = createLockfile(audit);
  added.packages[''].devDependencies.unapproved = '1.0.0';
  added.packages['node_modules/unapproved'] = {
    version: '1.0.0',
    integrity: 'sha512-unapproved',
  };
  assert.equal(validateLockfile(added, audit).ok, false);
});
