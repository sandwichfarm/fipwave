import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { composeInvocation, createDemoPlan, parseDemoArgs, parseMacAudioHardware, waitForStop } from '../scripts/demo.mjs';
import { createLaunchPlan, parseStaggeredArgs } from '../scripts/demo-staggered.mjs';

test('demo accepts only one literal role or check mode', () => {
  assert.deepEqual(parseDemoArgs(['a']), { mode: 'run', role: 'a' });
  assert.deepEqual(parseDemoArgs(['b']), { mode: 'run', role: 'b' });
  assert.deepEqual(parseDemoArgs(['--check']), { mode: 'check' });
  for (const args of [[], ['A'], ['c'], ['a', 'b'], ['--role', 'a'], ['--check', 'a']]) {
    assert.throws(() => parseDemoArgs(args), /usage/);
  }
});

test('staggered demo launches one role, waits, then launches the peer on the other port', () => {
  assert.deepEqual(parseStaggeredArgs([]), { first: 'b', second: 'a', delayMs: 8_000 });
  assert.deepEqual(parseStaggeredArgs(['--first', 'a', '--delay-ms', '1200']), { first: 'a', second: 'b', delayMs: 1_200 });
  assert.deepEqual(createLaunchPlan({ first: 'b', second: 'a', delayMs: 5_000 }), [
    { role: 'b', port: 4311, delayBeforeMs: 0 },
    { role: 'a', port: 4310, delayBeforeMs: 5_000 },
  ]);
  assert.throws(() => parseStaggeredArgs(['--first', 'c']), /first role/);
  assert.throws(() => parseStaggeredArgs(['--delay-ms', '200000']), /delay-ms/);
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
    FAST_GUARD_MS: '250',
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

test('demo keeps termination signals absorbed until owned cleanup can finish', async () => {
  const signals = new EventEmitter();
  const browser = new EventEmitter();
  const stopped = waitForStop(browser, signals);
  assert.equal(signals.listenerCount('SIGINT'), 1);
  assert.equal(signals.listenerCount('SIGTERM'), 1);
  assert.equal(signals.listenerCount('SIGHUP'), 1);
  signals.emit('SIGINT');
  assert.equal(await stopped, 'SIGINT');
  assert.equal(signals.listenerCount('SIGTERM'), 1);
  assert.doesNotThrow(() => signals.emit('SIGTERM'));
});

test('demo preflight resolves compatible default macOS microphone and speaker facts', () => {
  const profile = [
    '        MacBook Pro Microphone:',
    '          Default Input Device: Yes',
    '          Current SampleRate: 48000',
    '        External Headphones:',
    '          Default Output Device: Yes',
    '          Current SampleRate: 44100',
  ].join('\n');
  assert.deepEqual(parseMacAudioHardware(profile), {
    input: { name: 'MacBook Pro Microphone', sampleRate: 48_000 },
    output: { name: 'External Headphones', sampleRate: 44_100 },
  });
  assert.throws(() => parseMacAudioHardware(profile.replace('Current SampleRate: 48000', 'Current SampleRate: 96000')), /unsupported 96000 Hz/);
  assert.throws(() => parseMacAudioHardware(profile.replace('Default Output Device: Yes', 'Default Output Device: No')), /no default speaker/);
});
