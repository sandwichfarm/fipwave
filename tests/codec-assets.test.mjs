import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkCodecCache, validateCodecLock } from '../scripts/fetch-codec-assets.mjs';

function asset(filename, body, overrides = {}) {
  return {
    filename,
    url: `https://example.test/${filename}`,
    sha256: createHash('sha256').update(body).digest('hex'),
    sizeLimit: 1024,
    browserServing: true,
    mimeType: 'application/javascript',
    upstream: { revision: 'test' },
    license: 'BSD-3-Clause',
    ...overrides,
  };
}

test('codec lock rejects non-HTTPS URLs, traversal, duplicate names, and invalid serving entries', () => {
  const first = asset('quiet.js', 'quiet');
  assert.throws(() => validateCodecLock({ schemaVersion: 1, assets: [{ ...first, url: 'http://example.test/quiet.js' }] }), /HTTPS/);
  assert.throws(() => validateCodecLock({ schemaVersion: 1, assets: [{ ...first, filename: '../quiet.js' }] }), /filename/);
  assert.throws(() => validateCodecLock({ schemaVersion: 1, assets: [first, first] }), /duplicate/);
  assert.throws(() => validateCodecLock({ schemaVersion: 1, assets: [{ ...first, browserServing: true, mimeType: 'text/plain' }] }), /MIME/);
});

test('network-free cache check validates every byte and rejects missing, extra, or altered assets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-codec-cache-'));
  const lock = validateCodecLock({ schemaVersion: 1, assets: [asset('quiet.js', 'quiet'), asset('LICENSE', 'license', { browserServing: true, mimeType: 'text/plain; charset=utf-8' })] });
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'quiet.js'), 'quiet');
  await writeFile(path.join(directory, 'LICENSE'), 'license');
  await checkCodecCache(lock, directory);
  await writeFile(path.join(directory, 'unexpected.js'), 'nope');
  await assert.rejects(checkCodecCache(lock, directory), /unexpected/);
});
