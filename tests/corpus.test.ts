import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { assertCorpusManifest, generateCorpus } from '../scripts/generate-corpus.mjs';

describe('qualification corpus', () => {
  it('freezes exactly 25 unique payloads in both literal directions', async () => {
    const corpus = generateCorpus();
    expect(corpus.cases).toHaveLength(50);
    for (const direction of ['A → B', 'B → A']) {
      const cases = corpus.cases.filter((entry) => entry.direction === direction);
      expect(cases.filter((entry) => entry.size === 256)).toHaveLength(20);
      expect(cases.filter((entry) => entry.size === 1536)).toHaveLength(5);
      expect(new Set(cases.map((entry) => entry.id))).toHaveLength(25);
    }
    expect(JSON.parse(await readFile('fixtures/corpus/manifest.json', 'utf8'))).toEqual(corpus);
  });

  it('detects changed seeds, case identities, directions, and digests', () => {
    const corpus = generateCorpus();
    expect(() => assertCorpusManifest({ ...corpus, seed: 'edited' })).toThrow('drifted');
    expect(() => assertCorpusManifest({ ...corpus, cases: [{ ...corpus.cases[0], id: 'edited' }, ...corpus.cases.slice(1)] })).toThrow('drifted');
    expect(() => assertCorpusManifest({ ...corpus, cases: [{ ...corpus.cases[0], direction: 'B → A' }, ...corpus.cases.slice(1)] })).toThrow('drifted');
    expect(() => assertCorpusManifest({ ...corpus, cases: [{ ...corpus.cases[0], sha256: '0'.repeat(64) }, ...corpus.cases.slice(1)] })).toThrow('drifted');
  });
});
