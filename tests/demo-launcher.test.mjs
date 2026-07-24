import assert from 'node:assert/strict';
import test from 'node:test';

import { composeInvocation, createDemoPlan, parseDemoArgs } from '../scripts/demo.mjs';

test('demo accepts only one literal role or check mode', () => {
  assert.deepEqual(parseDemoArgs(['a']), { mode: 'run', role: 'a' });
  assert.deepEqual(parseDemoArgs(['b']), { mode: 'run', role: 'b' });
  assert.deepEqual(parseDemoArgs(['--check']), { mode: 'check' });
  for (const args of [[], ['A'], ['c'], ['a', 'b'], ['--role', 'a'], ['--check', 'a']]) {
    assert.throws(() => parseDemoArgs(args), /usage/);
  }
});

test('demo plans derive every runtime input from the role', () => {
  const now = new Date('2026-07-24T10:00:00.000Z');
  const a = createDemoPlan('a', now);
  const b = createDemoPlan('b', now);
  assert.equal(a.project, 'fipwave_demo_a');
  assert.equal(b.project, 'fipwave_demo_b');
  assert.equal(a.machineId, 'fipwave-a');
  assert.equal(b.machineId, 'fipwave-b');
  assert.deepEqual(a.environment, {
    ROLE: 'A',
    MACHINE_ID: 'fipwave-a',
    BROWSER_PORT: '4310',
    DEMO_ARTIFACT_DIR: a.artifactDirectory,
  });
  assert.match(a.artifactDirectory, /\/\.artifacts\/demo\/20260724T100000000Z-a$/);
  assert.equal(a.origin, 'http://127.0.0.1:4310/#demo=1&playbackGain=2');
  assert.throws(() => createDemoPlan('A', now), /exactly a or b/);
});

test('Compose invocation is exact-project and argument-array only', () => {
  const plan = createDemoPlan('a', new Date('2026-07-24T10:00:00.000Z'));
  const invocation = composeInvocation(plan, ['up', '--detach', '--build', '--remove-orphans']);
  assert.equal(invocation.command, 'docker');
  assert.deepEqual(invocation.args, [
    'compose', '-p', 'fipwave_demo_a', '-f', 'compose.fips.yml',
    'up', '--detach', '--build', '--remove-orphans',
  ]);
  assert.equal(invocation.environment, plan.environment);
  assert.throws(() => composeInvocation(plan, ['up', 1]), /arguments/);
});
