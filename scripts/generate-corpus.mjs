import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const CORPUS_SEED = 'fipwave-phase-01-corpus-v1';
const DIRECTIONS = ['A → B', 'B → A'];
const PATTERNS = ['all-zero', 'all-ff', 'incrementing', 'alternating', 'pseudorandom'];

function bytesFor(size, pattern, index, direction) {
  const bytes = Buffer.alloc(size);
  if (pattern === 'all-ff') return bytes.fill(0xff);
  if (pattern === 'incrementing') return Buffer.from(bytes.map((_, offset) => (offset + index) & 0xff));
  if (pattern === 'alternating') return Buffer.from(bytes.map((_, offset) => ((offset + index) % 2 ? 0x55 : 0xaa)));
  if (pattern === 'pseudorandom') {
    let state = createHash('sha256').update(`${CORPUS_SEED}:${direction}:${size}:${index}`).digest().readUInt32LE(0);
    for (let offset = 0; offset < bytes.length; offset += 1) { state = (state * 1664525 + 1013904223) >>> 0; bytes[offset] = state >>> 24; }
  }
  return bytes;
}

export function generateCorpus() {
  const cases = [];
  for (const direction of DIRECTIONS) {
    for (const size of [256, 1536]) {
      const count = size === 256 ? 20 : 5;
      for (let index = 0; index < count; index += 1) {
        const pattern = PATTERNS[index % PATTERNS.length];
        const payload = bytesFor(size, pattern, index, direction);
        cases.push({ id: `${direction === 'A → B' ? 'a-to-b' : 'b-to-a'}-${size}-${String(index + 1).padStart(2, '0')}`, direction, size, pattern, sha256: createHash('sha256').update(payload).digest('hex') });
      }
    }
  }
  return { schemaVersion: 1, seed: CORPUS_SEED, cases };
}

async function main() {
  const manifestPath = new URL('../fixtures/corpus/manifest.json', import.meta.url);
  const generated = `${JSON.stringify(generateCorpus(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const existing = await readFile(manifestPath, 'utf8');
    if (existing !== generated) throw new Error('corpus manifest drifted from the committed seed');
    return;
  }
  await mkdir(new URL('../fixtures/corpus/', import.meta.url), { recursive: true });
  await writeFile(manifestPath, generated, 'utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
