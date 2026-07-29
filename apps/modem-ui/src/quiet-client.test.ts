import { describe, expect, it, vi } from 'vitest';

import {
  QUIET_DATA_BYTES,
  QUIET_ENVELOPE_BYTES,
  QuietReceiverEvidence,
  SerialTransmissionQueue,
  closeAudioContexts,
  decodeFragment,
  decodeResetFrame,
  encodeControlFrame,
  encodeFragment,
  fragmentCase,
  resolveQuietTransmissionSettings,
  type CorpusCase,
} from './quiet-client.js';

const entry: CorpusCase = { id: 'a-to-b-256-01', direction: 'A → B', size: 256, pattern: 'all-zero', sha256: '5341e6b2646979a70e57653007a1f310169421ec9bdd9f1a5648f75ade005af1' };

describe('Quiet fixed audible envelope', () => {
  it('keeps a 32-byte application envelope and 221-byte data ceiling', () => {
    const fragments = fragmentCase({ epoch: 7, sender: 'A', caseIndex: 0, entry, payload: new Uint8Array(256) });
    expect(QUIET_ENVELOPE_BYTES).toBe(32); expect(QUIET_DATA_BYTES).toBe(221); expect(fragments).toHaveLength(2);
    const encoded = encodeFragment(fragments[0]!); expect(encoded.byteLength).toBeLessThanOrEqual(253);
    expect(decodeFragment(encoded)).toMatchObject({ epoch: 7, sender: 'A', direction: 'A → B', caseId: entry.id, fragmentIndex: 0, fragmentCount: 2 });
  });

  it('deduplicates receiver fragments and reports a corrupt duplicate rather than controlling a sender', async () => {
    const receiver = new QuietReceiverEvidence({ epoch: 7, localRole: 'B', startedAtMs: 100 });
    const fragments = fragmentCase({ epoch: 7, sender: 'A', caseIndex: 0, entry, payload: new Uint8Array(256) });
    expect(await receiver.accept(encodeFragment(fragments[0]!), 125)).toBeUndefined();
    expect(await receiver.accept(encodeFragment(fragments[0]!), 130)).toBeUndefined();
    const complete = await receiver.accept(encodeFragment(fragments[1]!), 155);
    expect(complete).toMatchObject({ complete: true, corrupt: false, duplicates: 1, deliveryCount: 2 });
  });

  it('rejects stale and impossible receive paths, flushes reset partials, and cannot replay them into the next epoch', async () => {
    const receiver = new QuietReceiverEvidence({ epoch: 7, localRole: 'B', startedAtMs: 100 });
    const fragments = fragmentCase({ epoch: 7, sender: 'A', caseIndex: 0, entry, payload: new Uint8Array(256) });
    const stale = fragmentCase({ epoch: 6, sender: 'A', caseIndex: 0, entry, payload: new Uint8Array(256) });
    const impossible = fragmentCase({ epoch: 7, sender: 'B', caseIndex: 0, entry, payload: new Uint8Array(256) });

    expect(await receiver.accept(encodeFragment(stale[0]!), 110)).toBeUndefined();
    expect(await receiver.accept(encodeFragment(impossible[0]!), 115)).toBeUndefined();
    expect(await receiver.accept(encodeFragment(fragments[0]!), 125)).toBeUndefined();
    expect(receiver.metrics()).toMatchObject({ captureHighWaterBytes: fragments[0]!.payload.byteLength, captureHighWaterMs: 0 });

    const flushed = receiver.reset({ epoch: 8, localRole: 'B', startedAtMs: 200 }, 175);
    expect(flushed).toEqual([
      expect.objectContaining({
        epoch: 7,
        caseId: entry.id,
        digest: null,
        acquisitionMs: 25,
        airtimeMs: 50,
        complete: false,
        missing: 1,
      }),
    ]);
    expect(await receiver.accept(encodeFragment(fragments[1]!), 210)).toBeUndefined();

    const fresh = fragmentCase({ epoch: 8, sender: 'A', caseIndex: 0, entry, payload: new Uint8Array(256) });
    expect(await receiver.accept(encodeFragment(fresh[0]!), 225)).toBeUndefined();
    expect(await receiver.accept(encodeFragment(fresh[1]!), 255)).toMatchObject({
      epoch: 8,
      acquisitionMs: 25,
      airtimeMs: 30,
      coldAcquired: true,
      complete: true,
      corrupt: false,
    });
    expect(receiver.metrics()).toMatchObject({
      captureHighWaterBytes: 256,
      captureHighWaterMs: 30,
    });
  });
});

describe('Quiet lifecycle and FWAV reset boundary', () => {
  const flushQueueStart = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('serializes modem transmissions instead of replacing an active transmitter', async () => {
    const queue = new SerialTransmissionQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.enqueue(async () => { events.push('start:first'); await firstGate; events.push('finish:first'); });
    const second = queue.enqueue(async () => { events.push('start:second'); events.push('finish:second'); });
    await flushQueueStart();
    expect(events).toEqual(['start:first']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['start:first', 'finish:first', 'start:second', 'finish:second']);
  });

  it('keeps ceremony settings compact without mutating the selected data candidate', () => {
    const selected = { playbackGain: 1, repetition: 1, guardMs: 100 };
    const ceremony = resolveQuietTransmissionSettings(selected, 'ceremony');
    selected.playbackGain = 2;
    selected.repetition = 3;
    selected.guardMs = 750;
    expect(ceremony).toEqual({ playbackGain: 1, repetition: 1, guardMs: 100 });
    expect(resolveQuietTransmissionSettings(selected, 'data')).toEqual({ playbackGain: 2, repetition: 3, guardMs: 750 });
  });

  it('invalidates queued prior-generation transmissions on reset before accepting fresh work', async () => {
    const queue = new SerialTransmissionQueue();
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => { releaseActive = resolve; });
    const events: string[] = [];

    const active = queue.enqueue(async () => { events.push('start:active'); await activeGate; events.push('finish:active'); });
    const stale = queue.enqueue(async () => { events.push('stale'); });
    const staleResult = stale.then(
      () => 'resolved',
      (error: unknown) => error instanceof Error ? error.message : String(error),
    );
    await flushQueueStart();
    queue.reset();
    const fresh = queue.enqueue(async () => { events.push('fresh'); });
    releaseActive();

    await active;
    expect(await staleResult).toContain('cancelled by reset');
    await fresh;
    expect(events).toEqual(['start:active', 'finish:active', 'fresh']);
  });

  it('closes every tracked live AudioContext and leaves already-closed contexts alone', async () => {
    const live = { state: 'running', close: vi.fn(async () => undefined) };
    const suspended = { state: 'suspended', close: vi.fn(async () => undefined) };
    const closed = { state: 'closed', close: vi.fn(async () => undefined) };
    const contexts = new Set([live, suspended, closed]) as unknown as Set<AudioContext>;
    await closeAudioContexts(contexts);
    expect(live.close).toHaveBeenCalledOnce();
    expect(suspended.close).toHaveBeenCalledOnce();
    expect(closed.close).not.toHaveBeenCalled();
    expect(contexts.size).toBe(0);
  });

  it('accepts only an empty server RESET for the exact next epoch', () => {
    const encoded = encodeControlFrame({ type: 8, epoch: 7, sequence: 0n });
    expect(decodeResetFrame(encoded, 6)).toBe(7);
    expect(() => decodeResetFrame(encoded, 7)).toThrow('next epoch');
    new DataView(encoded).setUint8(5, 4);
    expect(() => decodeResetFrame(encoded, 6)).toThrow('RESET');
  });
});
