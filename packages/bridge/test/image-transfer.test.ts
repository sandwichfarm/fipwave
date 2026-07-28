import { describe, expect, it } from 'vitest';
import { decodeImageBand, encodeImageBand, validateRaster } from '../src/image-transfer.js';

describe('FIPS image transfer framing', () => {
  it('round trips a bounded raster band', () => {
    const transferId = Buffer.from('0102030405060708', 'hex');
    const rgba = Buffer.from(Uint8Array.from({ length: 96 * 2 * 4 }, (_, index) => index & 0xff));
    const decoded = decodeImageBand(encodeImageBand({ transferId, width: 96, height: 34, y: 4, rows: 2, rgba }));
    expect(decoded).toEqual({ transferId: '0102030405060708', width: 96, height: 34, y: 4, rows: 2, rgba });
  });

  it('rejects oversized geometry before trusting the payload', () => {
    const frame = Buffer.alloc(36);
    frame.write('FIMG'); frame[4] = 1; frame[5] = 1;
    frame.writeUInt16LE(65_535, 16); frame.writeUInt16LE(65_535, 18);
    frame.writeUInt16LE(1, 22); frame.writeUInt32LE(4, 24);
    expect(() => decodeImageBand(frame)).toThrow('image_width_invalid');
  });

  it('requires an exact RGBA raster', () => {
    expect(() => validateRaster(96, 34, Buffer.alloc(96 * 34 * 4 - 1))).toThrow('image_raster_invalid');
  });
});
