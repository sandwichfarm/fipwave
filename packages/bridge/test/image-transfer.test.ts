import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixedDemoImageRaster, FIXED_DEMO_IMAGE_HEIGHT, FIXED_DEMO_IMAGE_WIDTH } from '../src/demo-image-raster.js';
import { createImageTransfer, decodeImageBand, encodeImageBand, IMAGE_BAND_MAX_BYTES, IMAGE_BAND_TARGET_ROWS, startAuthenticatedImageSender, validateRaster } from '../src/image-transfer.js';

afterEach(() => vi.useRealTimers());

describe('FIPS image transfer framing', () => {
  it('round trips a bounded raster band', () => {
    const transferId = Buffer.from('0102030405060708', 'hex');
    const rgba = Buffer.from(Uint8Array.from({ length: 96 * 2 * 4 }, (_, index) => index & 0xff));
    const decoded = decodeImageBand(encodeImageBand({ transferId, width: 96, height: 34, y: 4, rows: 2, rgba }));
    expect(decoded).toEqual({ transferId: '0102030405060708', width: 96, height: 34, y: 4, rows: 2, rgba });
  });

  it('fits the fixed banner below both IPv6 and acoustic queue bounds', () => {
    const rgba = Buffer.alloc(96 * IMAGE_BAND_TARGET_ROWS * 4);
    for (let index = 0; index < rgba.length; index += 4) {
      rgba[index] = index % 251;
      rgba[index + 1] = 96;
      rgba[index + 2] = 34;
      rgba[index + 3] = 255;
    }
    const frame = encodeImageBand({ transferId: Buffer.alloc(8), width: 96, height: 34, y: 0, rows: IMAGE_BAND_TARGET_ROWS, rgba });
    expect(32 + IMAGE_BAND_MAX_BYTES).toBeLessThanOrEqual(1_232);
    expect(frame.byteLength).toBeLessThanOrEqual(1_232);
    expect(Math.ceil(34 / IMAGE_BAND_TARGET_ROWS)).toBe(6);
  });

  it('rejects oversized geometry before trusting the payload', () => {
    const frame = Buffer.alloc(36);
    frame.write('FIMG'); frame[4] = 1; frame[5] = 2;
    frame.writeUInt16LE(65_535, 16); frame.writeUInt16LE(65_535, 18);
    frame.writeUInt16LE(1, 22); frame.writeUInt32LE(4, 24);
    expect(() => decodeImageBand(frame)).toThrow('image_width_invalid');
  });

  it('requires an exact RGBA raster', () => {
    expect(() => validateRaster(96, 34, Buffer.alloc(96 * 34 * 4 - 1))).toThrow('image_raster_invalid');
  });

  it('embeds the exact deterministic banner raster used by the runner', () => {
    const first = fixedDemoImageRaster();
    const second = fixedDemoImageRaster();
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(first).toHaveLength(FIXED_DEMO_IMAGE_WIDTH * FIXED_DEMO_IMAGE_HEIGHT * 4);
    expect(createHash('sha256').update(first).digest('hex')).toBe('696ab5fa45b3cfcd7c4374d406b53c4101575ae92088eb7141742edc59216064');
  });

  it('exposes the source image only after Role A has queued every FIPS band', async () => {
    const socket = Object.assign(new EventEmitter(), {
      bind: vi.fn(),
      send: vi.fn((_frame: Buffer, _port: number, _host: string, callback: (error?: Error) => void) => callback()),
      close: vi.fn((callback: () => void) => callback()),
    });
    const transfer = createImageTransfer({
      role: 'A',
      localIpv6: 'fd00::1',
      peerIpv6: 'fd00::2',
      socket: socket as never,
    });

    expect(transfer.status().transferId).toBeNull();
    const result = await transfer.send(FIXED_DEMO_IMAGE_WIDTH, FIXED_DEMO_IMAGE_HEIGHT, fixedDemoImageRaster());

    expect(result.bands).toBe(6);
    expect(transfer.status()).toMatchObject({
      transferId: result.transferId,
      width: FIXED_DEMO_IMAGE_WIDTH,
      height: FIXED_DEMO_IMAGE_HEIGHT,
      receivedRows: FIXED_DEMO_IMAGE_HEIGHT,
      complete: true,
      revision: 2,
    });
    await transfer.close();
  });

  it('auto-sends once only after the authoritative peer becomes ready', async () => {
    vi.useFakeTimers();
    const peerReady = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const send = vi.fn().mockResolvedValue(undefined);
    const sender = startAuthenticatedImageSender({ peerReady, send, retryMs: 1_500 });

    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sender.sent()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    sender.close();
  });

  it('retries a transient authenticated image send failure', async () => {
    vi.useFakeTimers();
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('socket_not_ready'))
      .mockResolvedValueOnce(undefined);
    const sender = startAuthenticatedImageSender({ peerReady: async () => true, send, retryMs: 1_500 });

    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sender.sent()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sender.sent()).toBe(true);
    sender.close();
  });

  it('resends after an authenticated peer disconnects and recovers', async () => {
    vi.useFakeTimers();
    const peerReady = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const send = vi.fn().mockResolvedValue(undefined);
    const sender = startAuthenticatedImageSender({ peerReady, send, retryMs: 1_500 });

    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sender.sent()).toBe(true);
    sender.close();
  });
});
