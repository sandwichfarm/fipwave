import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_ROOT = path.join(ROOT, '.artifacts');
const CACHE_DIR = path.join(ARTIFACT_ROOT, 'codecs');
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HASH = /^[a-f0-9]{64}$/;
const TEXT_MIME = 'text/plain; charset=utf-8';

function fail(message) { throw new Error(`codec assets: ${message}`); }
function digest(body) { return createHash('sha256').update(body).digest('hex'); }
function expectedMime(filename) {
  if (filename.endsWith('.js')) return 'application/javascript';
  if (filename.endsWith('.mem')) return 'application/octet-stream';
  if (filename.endsWith('.json')) return 'application/json';
  if (filename.endsWith('.tar.gz')) return 'application/gzip';
  return TEXT_MIME;
}

/** Validate the hand-audited asset schema before touching cache or network. */
export function validateCodecLock(lock) {
  if (!lock || typeof lock !== 'object' || lock.schemaVersion !== 1 || !Array.isArray(lock.assets) || lock.assets.length === 0) fail('lock schemaVersion 1 requires a non-empty assets array');
  const names = new Set();
  for (const asset of lock.assets) {
    if (!asset || typeof asset !== 'object') fail('asset must be an object');
    const { filename, url, sha256, sizeLimit, browserServing, mimeType, upstream, license } = asset;
    if (typeof filename !== 'string' || !FILENAME.test(filename) || filename.includes('..')) fail('asset filename is invalid');
    if (names.has(filename)) fail(`duplicate asset filename: ${filename}`);
    names.add(filename);
    let parsed;
    try { parsed = new URL(url); } catch { fail(`asset ${filename} URL is invalid`); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail(`asset ${filename} URL must use HTTPS without credentials`);
    if (typeof sha256 !== 'string' || !HASH.test(sha256)) fail(`asset ${filename} SHA-256 is invalid`);
    if (!Number.isInteger(sizeLimit) || sizeLimit < 1 || sizeLimit > 64 * 1024 * 1024) fail(`asset ${filename} size limit is invalid`);
    if (typeof browserServing !== 'boolean') fail(`asset ${filename} browser serving flag is invalid`);
    if (typeof mimeType !== 'string' || mimeType !== expectedMime(filename)) fail(`asset ${filename} MIME type is invalid`);
    if (!upstream || typeof upstream !== 'object' || typeof upstream.revision !== 'string' || upstream.revision.length === 0) fail(`asset ${filename} upstream revision is invalid`);
    if (typeof license !== 'string' || license.length === 0) fail(`asset ${filename} license identity is invalid`);
  }
  return Object.freeze({ schemaVersion: 1, assets: Object.freeze(lock.assets.map((asset) => Object.freeze({ ...asset, upstream: Object.freeze({ ...asset.upstream }) }))) });
}

export async function checkCodecCache(lock, directory = CACHE_DIR) {
  const validated = validateCodecLock(lock);
  let entries;
  try { entries = await readdir(directory); } catch { fail(`cache is missing: ${directory}`); }
  const expected = new Set(validated.assets.map((asset) => asset.filename));
  for (const name of entries) if (!expected.has(name)) fail(`cache has unexpected file: ${name}`);
  for (const asset of validated.assets) {
    const target = path.join(directory, asset.filename);
    let metadata;
    try { metadata = await lstat(target); } catch { fail(`cache is missing required file: ${asset.filename}`); }
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`cache file is not a regular file: ${asset.filename}`);
    if (metadata.size > asset.sizeLimit) fail(`cache file exceeds size limit: ${asset.filename}`);
    const body = await readFile(target);
    if (digest(body) !== asset.sha256) fail(`cache SHA-256 mismatch: ${asset.filename}`);
  }
  return validated;
}

async function fetchPinned(asset) {
  let url = new URL(asset.url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (url.protocol !== 'https:') fail(`final URL is not HTTPS: ${asset.filename}`);
    const response = await fetch(url, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) fail(`redirect has no location: ${asset.filename}`);
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) fail(`download failed (${response.status}): ${asset.filename}`);
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > asset.sizeLimit)) fail(`download exceeds size limit: ${asset.filename}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > asset.sizeLimit) fail(`download exceeds size limit: ${asset.filename}`);
    if (digest(body) !== asset.sha256) fail(`download SHA-256 mismatch: ${asset.filename}`);
    return body;
  }
  fail(`too many redirects: ${asset.filename}`);
}

async function replaceCache(stage) {
  const backup = path.join(ARTIFACT_ROOT, `.codecs-backup-${randomUUID()}`);
  let movedExisting = false;
  try { await stat(CACHE_DIR); await rename(CACHE_DIR, backup); movedExisting = true; } catch (error) { if (error && error.code !== 'ENOENT') throw error; }
  try { await rename(stage, CACHE_DIR); } catch (error) { if (movedExisting) await rename(backup, CACHE_DIR); throw error; }
  if (movedExisting) await rm(backup, { recursive: true, force: true });
}

export async function fetchCodecCache(lock, directory = CACHE_DIR) {
  if (path.resolve(directory) !== CACHE_DIR) fail('cache replacement is limited to .artifacts/codecs');
  const validated = validateCodecLock(lock);
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const stage = await mkdtemp(path.join(ARTIFACT_ROOT, '.codecs-stage-'));
  try {
    for (const asset of validated.assets) await writeFile(path.join(stage, asset.filename), await fetchPinned(asset), { mode: 0o644 });
    await checkCodecCache(validated, stage);
    await replaceCache(stage);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return checkCodecCache(validated, CACHE_DIR);
}

async function main() {
  const lock = validateCodecLock(JSON.parse(await readFile(path.join(ROOT, 'codec-assets.lock.json'), 'utf8')));
  if (process.argv.slice(2).join(' ') === '--check') { await checkCodecCache(lock); process.stdout.write('Verified codec cache (network-free).\n'); return; }
  if (process.argv.length !== 2) fail('usage: fetch-codec-assets.mjs [--check]');
  await fetchCodecCache(lock); process.stdout.write('Fetched and verified codec cache.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
