export type PacketResult = { accepted: true } | { accepted: false; reason: 'not-armed' | 'stale' | 'invalid' };

export interface FipsPacketAdapter {
  arm(epoch: number, generation: number): void;
  invalidate(): void;
  receive(packet: Uint8Array, epoch: number, generation: number): PacketResult;
  send(packet: Uint8Array): PacketResult;
}

export interface FipsPacketAdapterOptions {
  onPacket(packet: Uint8Array): void;
  emitPacket(packet: Uint8Array): void;
}

function validPacket(packet: Uint8Array): boolean {
  return packet instanceof Uint8Array && packet.byteLength > 0 && packet.byteLength <= 256 * 1024 - 32;
}

/** Complete opaque FIPS packets only; codec, PCM, fragmentation and retries stay below this boundary. */
export function createFipsPacketAdapter(options: FipsPacketAdapterOptions): FipsPacketAdapter {
  let lifecycle: { epoch: number; generation: number } | undefined;
  const active = (epoch: number, generation: number): PacketResult | undefined => {
    if (!lifecycle) return { accepted: false, reason: 'not-armed' };
    if (lifecycle.epoch !== epoch || lifecycle.generation !== generation) return { accepted: false, reason: 'stale' };
    return undefined;
  };
  return {
    arm(epoch, generation) { lifecycle = { epoch, generation }; },
    invalidate() { lifecycle = undefined; },
    receive(packet, epoch, generation) {
      const rejected = active(epoch, generation);
      if (rejected) return rejected;
      if (!validPacket(packet)) return { accepted: false, reason: 'invalid' };
      options.onPacket(packet.slice());
      return { accepted: true };
    },
    send(packet) {
      if (!lifecycle) return { accepted: false, reason: 'not-armed' };
      if (!validPacket(packet)) return { accepted: false, reason: 'invalid' };
      options.emitPacket(packet.slice());
      return { accepted: true };
    },
  };
}
