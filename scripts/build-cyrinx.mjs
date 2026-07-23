import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archiveRoot = 'cyrinx-ddbd0ce4f78963403f96b0100eb49950b544aef8';
const buildRoot = process.env.CYRINX_BUILD_DIR ?? path.join(root, '.artifacts', 'build', 'cyrinx');
const assets = process.env.CYRINX_ASSET_DIR ?? path.join(root, '.artifacts', 'codecs');
const required = Object.freeze({
  'cyrinx-ddbd0ce4.tar.gz': 'efd01a2b7531ad3d2d97d3ea0b22e87d1e3c55914df01fa4d1afdfec9516de51',
  'cyrinx-LICENSE': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  'cyrinx-NOTICE': '8112cf1a4f408787adfcc13689cd3fd0ab881f45508db2fc986670b75d7ff6bf',
  'cyrinx-kissfft-COPYING': 'a2840585f8411be8e6826a31ef15ae65c950bd74a2437a73b013398a934ad0c6',
});
const sourceFiles = Object.freeze([
  'Sources/CCyrinx/cyrinx_bulk.c', 'Sources/CCyrinx/cyrinx_fft.c',
  'Sources/CCyrinx/kissfft/kiss_fft.c', 'Sources/CCyrinx/kissfft/kiss_fftr.c',
]);

function fail(reason) { throw new Error(`cyrinx_build_failed:${reason}`); }
const resolvedBuildRoot = path.resolve(buildRoot);
if (resolvedBuildRoot === path.parse(resolvedBuildRoot).root || resolvedBuildRoot === root || resolvedBuildRoot === path.resolve(assets) || resolvedBuildRoot.split(path.sep).filter(Boolean).length < 4) fail('build_root_unsafe');
function command(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) fail(`${file}:${result.error?.message ?? result.stderr?.trim() ?? result.status}`);
  return result.stdout;
}
function safeArchiveMembers(listing) {
  const prefix = `${archiveRoot}/`;
  for (const member of listing.split('\n').filter(Boolean)) {
    if (!member.startsWith(prefix) || member.includes('\\') || member.split('/').some((part) => part === '..' || part === '.')) fail('archive_path_invalid');
  }
}
async function verifiedAsset(filename, digest) {
  const file = path.join(assets, filename);
  if (!existsSync(file)) fail(`asset_missing:${filename}`);
  const body = await readFile(file);
  if (createHash('sha256').update(body).digest('hex') !== digest) fail(`asset_hash_mismatch:${filename}`);
  return file;
}
async function regularWithin(rootPath, relative) {
  const candidate = path.join(rootPath, relative); const metadata = await lstat(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`source_not_regular:${relative}`);
  const resolved = await realpath(candidate);
  if (!resolved.startsWith(`${rootPath}${path.sep}`)) fail(`source_escapes_root:${relative}`);
}

try {
  const archive = await verifiedAsset('cyrinx-ddbd0ce4.tar.gz', required['cyrinx-ddbd0ce4.tar.gz']);
  for (const [filename, digest] of Object.entries(required)) if (filename !== 'cyrinx-ddbd0ce4.tar.gz') await verifiedAsset(filename, digest);
  safeArchiveMembers(command('tar', ['-tzf', archive]));
  await rm(buildRoot, { recursive: true, force: true });
  await mkdir(buildRoot, { recursive: true });
  command('tar', ['-xzf', archive, '-C', buildRoot]);
  const sourceRoot = path.join(buildRoot, archiveRoot);
  for (const relative of [...sourceFiles, 'Sources/CCyrinx/include/cyrinx/cyrinx_bulk.h', 'Sources/CCyrinx/include/cyrinx/cyrinx_fft.h', 'Sources/CCyrinx/kissfft/kiss_fft.h', 'Sources/CCyrinx/kissfft/kiss_fftr.h', 'Sources/CCyrinx/kissfft/COPYING', 'LICENSE', 'NOTICE']) await regularWithin(sourceRoot, relative);
  const output = path.join(buildRoot, 'cyrinx_batch');
  command('cc', [
    '-std=c11', '-O2', '-Dkiss_fft_scalar=double',
    '-I', path.join(sourceRoot, 'Sources/CCyrinx/include'),
    '-I', path.join(sourceRoot, 'Sources/CCyrinx'),
    '-I', path.join(sourceRoot, 'Sources/CCyrinx/kissfft'),
    path.join(root, 'native/cyrinx_batch.c'),
    ...sourceFiles.map((relative) => path.join(sourceRoot, relative)),
    '-lm', '-o', output,
  ]);
  process.stdout.write(`${output}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'cyrinx_build_failed:unknown'}\n`);
  process.exitCode = 1;
}
