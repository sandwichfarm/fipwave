import { FipsTrafficClass, isFipsTrafficClass } from '../../../packages/bridge/src/protocol.js';

export type PacketResult = { accepted: true } | { accepted: false; reason: 'not-armed' | 'stale' | 'invalid' | 'acoustic_queue_full' | 'acoustic_not_ready' | 'acoustic_packet_bounds' | 'acoustic_class_invalid' };

/** A complete opaque FIPS packet plus source-authored local scheduling metadata. */
export interface FipsPacketEnvelope {
  readonly bytes: Uint8Array;
  readonly trafficClass: FipsTrafficClass;
}

export interface FipsPacketAdapter {
  arm(epoch: number, generation: number): void;
  invalidate(): void;
  receive(packet: Uint8Array, trafficClass: FipsTrafficClass, epoch: number, generation: number): PacketResult;
  send(packet: Uint8Array, trafficClass?: FipsTrafficClass): PacketResult;
}

export interface FipsPacketAdapterOptions {
  onPacket(envelope: FipsPacketEnvelope): PacketResult | void;
  emitPacket(envelope: FipsPacketEnvelope): void;
}

function validPacket(packet: Uint8Array): boolean {
  return packet instanceof Uint8Array && packet.byteLength > 0 && packet.byteLength <= 256 * 1024 - 32;
}

function envelope(packet: Uint8Array, trafficClass: FipsTrafficClass): FipsPacketEnvelope | undefined {
  if (!validPacket(packet) || !isFipsTrafficClass(trafficClass)) return undefined;
  return Object.freeze({ bytes: packet.slice(), trafficClass });
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
    receive(packet, trafficClass, epoch, generation) {
      const rejected = active(epoch, generation);
      if (rejected) return rejected;
      const accepted = envelope(packet, trafficClass);
      if (!accepted) return { accepted: false, reason: 'invalid' };
      return options.onPacket(accepted) ?? { accepted: true };
    },
    send(packet, trafficClass = FipsTrafficClass.Ordinary) {
      if (!lifecycle) return { accepted: false, reason: 'not-armed' };
      const accepted = envelope(packet, trafficClass);
      if (!accepted) return { accepted: false, reason: 'invalid' };
      options.emitPacket(accepted);
      return { accepted: true };
    },
  };
}
