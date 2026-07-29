import { describe, expect, it } from 'vitest';
import { isBytePerfectResult, parseArgs } from '../scripts/self-loop-smoke.mjs';

describe('self-loop smoke harness', () => {
  it('parses bounded audio and runner options', () => {
    expect(parseArgs([
      '--output-volume', '45',
      '--input-volume', '70',
      '--playback-gain-percent', '200',
      '--messages-per-direction', '5',
      '--port-a', '4180',
      '--port-b', '4181',
      '--session-ready-timeout-ms', '90000',
      '--direction-timeout-ms', '120000',
    ])).toMatchObject({
      help: false,
      outputVolume: 45,
      inputVolume: 70,
      playbackGainPercent: 200,
      messagesPerDirection: 5,
      portA: 4180,
      portB: 4181,
      sessionReadyTimeoutMs: 90_000,
      directionTimeoutMs: 120_000,
    });
  });

  it('rejects unsafe or ambiguous options', () => {
    expect(() => parseArgs(['--output-volume', '101'])).toThrow('0 through 100');
    expect(() => parseArgs(['--messages-per-direction', '0'])).toThrow('1 through 25');
    expect(() => parseArgs(['--session-ready-timeout-ms', '999'])).toThrow('1000 through');
    expect(() => parseArgs(['--port-a', '4174', '--port-b', '4174'])).toThrow('must differ');
    expect(() => parseArgs(['--unknown', 'value'])).toThrow('usage:');
  });

  it('requires independently observed byte-perfect receiver evidence', () => {
    const good = {
      direction: 'A → B',
      epoch: 2,
      observed: true,
      complete: true,
      corrupt: false,
      missing: 0,
      duplicates: 0,
      deliveryCount: 1,
      bytePerfect: true,
      expectedSha256: 'expected',
      receivedSha256: 'expected',
    };
    expect(isBytePerfectResult(good, 'A → B', 2)).toBe(true);
    expect(isBytePerfectResult({ ...good, observed: false }, 'A → B', 2)).toBe(false);
    expect(isBytePerfectResult({ ...good, receivedSha256: 'different' }, 'A → B', 2)).toBe(false);
    expect(isBytePerfectResult({ ...good, direction: 'B → A' }, 'A → B', 2)).toBe(false);
    expect(isBytePerfectResult({ ...good, epoch: 3 }, 'A → B', 2)).toBe(false);
  });
});
