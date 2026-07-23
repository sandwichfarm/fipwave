import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { access } from 'node:fs/promises';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const executable = path.join(root, '.artifacts', 'build', 'cyrinx', 'cyrinx_batch');

function run(command, payload = Buffer.alloc(0)) {
  return spawnSync(executable, [command], { cwd: root, input: payload, maxBuffer: 512 * 1024, encoding: null });
}

function request(metadata, payload) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, metadata, payload]);
}

function metadata(payload, epoch = 7, direction = 0, caseId = 'a-to-b-1536-01') {
  const value = Buffer.alloc(256);
  value.write('CYRX', 0, 'ascii'); value.writeUInt8(1, 4); value.writeUInt32LE(epoch, 5); value.writeUInt8(direction, 9);
  value.write(caseId, 11, 'utf8'); value.writeUInt32LE(payload.length, 75);
  createHash('sha256').update(payload).digest().copy(value, 79);
  return value;
}

test('pinned Cyrinx batch binary has exact geometry and byte-perfect 256/1536 digital paths', async () => {
  await access(executable);
  const geometry = run('geometry');
  assert.equal(geometry.status, 0, geometry.stderr?.toString());
  assert.deepEqual(JSON.parse(geometry.stdout.toString()), {
    payloadBytes: 1792, blocks: 7, frameSamples: 62464, sampleRate: 48000,
    bitsPerBin: 2, rate: '1/2', nfft: 2048, cp: 768, symbols: 18, pilotEvery: 8, amp: 0.18,
  });

  for (const bytes of [256, 1536]) {
    const payload = Buffer.alloc(bytes, bytes === 256 ? 0x6b : 0xa5);
    const encoded = run('encode', request(metadata(payload), payload));
    assert.equal(encoded.status, 0, encoded.stderr?.toString());
    assert.equal(encoded.stdout.byteLength, 62464 * 4);
    const decoded = run('decode', encoded.stdout);
    assert.equal(decoded.status, 0, decoded.stderr?.toString());
    assert.equal(decoded.stdout.toString('ascii', 0, 4), 'CYRR');
    assert.equal(decoded.stdout.readUInt8(4), 1);
    assert.equal(decoded.stdout.readUInt32LE(5), bytes);
    assert.equal(decoded.stdout.readUInt32LE(9), 7);
    assert.equal(decoded.stdout.readUInt32LE(13), 7);
    assert.ok(Number.isFinite(decoded.stdout.readDoubleLE(17)));
    assert.deepEqual(decoded.stdout.subarray(25, 25 + 256), metadata(payload));
    assert.deepEqual(decoded.stdout.subarray(281, 281 + bytes), payload);
  }
});

test('build fails closed for missing or altered pinned assets without touching the verified cache', async () => {
  const isolated = await mkdtemp(path.join(tmpdir(), 'fipwave-cyrinx-assets-'));
  const script = path.join(root, 'scripts', 'build-cyrinx.mjs');
  const missing = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, CYRINX_ASSET_DIR: isolated, CYRINX_BUILD_DIR: path.join(isolated, 'build') }, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /cyrinx_build_failed:asset_missing/);
  const archive = await readFile(path.join(root, '.artifacts', 'codecs', 'cyrinx-ddbd0ce4.tar.gz'));
  await writeFile(path.join(isolated, 'cyrinx-ddbd0ce4.tar.gz'), Buffer.concat([archive, Buffer.from([0]) ]));
  const altered = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, CYRINX_ASSET_DIR: isolated, CYRINX_BUILD_DIR: path.join(isolated, 'build') }, encoding: 'utf8' });
  assert.notEqual(altered.status, 0);
  assert.match(altered.stderr, /cyrinx_build_failed:asset_hash_mismatch/);
});

test('batch framing rejects invalid metadata identity and digest before modulation', () => {
  const payload = Buffer.alloc(256, 9);
  const badDigest = metadata(payload); badDigest[79] ^= 1;
  const badEpoch = metadata(payload); badEpoch.writeUInt32LE(0, 5);
  const badDirection = metadata(payload); badDirection[9] = 2;
  const badCaseId = metadata(payload); badCaseId[11] = 0;
  for (const value of [badDigest, badEpoch, badDirection, badCaseId]) assert.notEqual(run('encode', request(value, payload)).status, 0);
});

test('Cyrinx batch rejects malformed, truncated, oversize, and trailing input', async () => {
  const payload = Buffer.alloc(1536, 4);
  const encoded = run('encode', request(metadata(payload), payload));
  assert.equal(encoded.status, 0, encoded.stderr?.toString());
  assert.notEqual(run('decode', encoded.stdout.subarray(0, -4)).status, 0);
  assert.notEqual(run('decode', Buffer.concat([encoded.stdout, Buffer.from([0])])).status, 0);
  const malformed = metadata(payload); malformed.write('NOPE', 0, 'ascii');
  assert.notEqual(run('encode', request(malformed, payload)).status, 0);
  assert.notEqual(run('encode', request(metadata(Buffer.alloc(1537)), Buffer.alloc(1537))).status, 0);
});
