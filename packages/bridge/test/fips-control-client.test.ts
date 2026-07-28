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
  it('sends exact allowlisted newline-delimited commands', async () => {
    const socket = new ControlSocket('{"status":"ok","data":{"peers":[]}}\n');
    const client = createFipsControlClient({ socketPath: '/run/fips/control.sock', connect: () => socket });

    await expect(client.query('peers')).resolves.toEqual({ peers: [] });
    expect(Buffer.concat(socket.writes).toString('utf8')).toBe('{"command":"show_peers"}\n');
    await expect(client.query('show_status' as never)).rejects.toMatchObject({ code: 'query_invalid' });
    await client.close();
  });

  it('reads the authoritative end-to-end FIPS session state', async () => {
    const session = {
      npub: 'npub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2',
      state: 'established',
      is_initiator: true,
    };
    const socket = new ControlSocket(`{"status":"ok","data":{"sessions":[${JSON.stringify(session)}]}}\n`);
    const client = createFipsControlClient({ socketPath: '/run/fips/control.sock', connect: () => socket });

    await expect(client.query('sessions')).resolves.toEqual({
      sessions: [{ npub: session.npub, state: 'established' }],
    });
    expect(Buffer.concat(socket.writes).toString('utf8')).toBe('{"command":"show_sessions"}\n');
    await client.close();
  });

  it('initiates only the fixed sound peer and validates the echoed authority', async () => {
    const peer = {
      npub: 'npub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2',
      address: 'sound-b',
      transport: 'sound',
    } as const;
    const socket = new ControlSocket(`{"status":"ok","data":${JSON.stringify(peer)}}\n`);
    const client = createFipsControlClient({ socketPath: '/run/fips/control.sock', connect: () => socket });

    await expect(client.connectPeer(peer)).resolves.toEqual(peer);
    expect(Buffer.concat(socket.writes).toString('utf8')).toBe(`${JSON.stringify({ command: 'connect', params: peer })}\n`);
    await expect(client.connectPeer({ ...peer, address: '127.0.0.1:2121' } as never)).rejects.toMatchObject({ code: 'query_invalid' });
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
