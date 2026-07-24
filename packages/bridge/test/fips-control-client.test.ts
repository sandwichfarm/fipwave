import { Duplex } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createFipsControlClient } from '../src/fips-control-client.js';

class ControlSocket extends Duplex {
  readonly writes: Buffer[] = [];
  constructor(private readonly response: string | null) { super(); }
  override _read(): void {}
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.writes.push(Buffer.from(chunk)); callback();
  }
  override _final(callback: (error?: Error | null) => void): void {
    if (this.response !== null) this.push(Buffer.from(this.response));
    this.push(null); callback();
  }
}

describe('FIPS control client', () => {
  it('only sends exact allowlisted newline-delimited read-only commands', async () => {
    const socket = new ControlSocket('{"status":"ok","data":{"peers":[]}}\n');
    const client = createFipsControlClient({ socketPath: '/run/fips/control.sock', connect: () => socket });

    await expect(client.query('peers')).resolves.toEqual({ peers: [] });
    expect(Buffer.concat(socket.writes).toString('utf8')).toBe('{"command":"show_peers"}\n');
    await expect(client.query('show_status' as never)).rejects.toMatchObject({ code: 'query_invalid' });
    await client.close();
  });

  it('rejects malformed, extra, error, and partial responses without exposing daemon text', async () => {
    for (const response of [
      '{"status":"ok","data":{"peers":[]},"extra":true}\n',
      '{"status":"ok","data":{"links":[]}}\n',
      '{"status":"error","message":"secret daemon detail"}\n',
      '{"status":"ok","data":{"peers":[]}}',
      '{bad}\n',
    ]) {
      const client = createFipsControlClient({ socketPath: '/run/fips/control.sock', connect: () => new ControlSocket(response) });
      await expect(client.query('peers')).rejects.toMatchObject({ code: expect.stringMatching(/^(protocol_invalid|daemon_error)$/) });
      await client.close();
    }
  });

  it('serializes one in-flight query and close rejects queued work', async () => {
    let socket: ControlSocket | undefined;
    const client = createFipsControlClient({ socketPath: '/run/fips/control.sock', connect: () => {
      socket = new ControlSocket(null); return socket;
    } });
    const active = client.query('peers');
    const queued = client.query('links');
    const activeRejected = expect(active).rejects.toMatchObject({ code: 'client_closed' });
    const queuedRejected = expect(queued).rejects.toMatchObject({ code: 'client_closed' });
    await client.close();
    await activeRejected;
    await queuedRejected;
    expect(socket?.destroyed).toBe(true);
  });
});
