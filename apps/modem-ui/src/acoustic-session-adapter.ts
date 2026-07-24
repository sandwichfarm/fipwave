import { FipsTrafficClass } from '../../../packages/bridge/src/protocol.js';
import { createFipsPacketAdapter, type FipsPacketAdapter, type FipsPacketEnvelope, type PacketResult } from './fips-packet-adapter.js';
import type { AcousticQueueResult, AcousticSessionSnapshot, AcousticTrafficClass } from './acoustic-session.js';

/** The small complete-packet seam between FIPS and the FAS1 session. */
export interface AcousticSessionPort {
  readonly snapshot: Pick<AcousticSessionSnapshot, 'epoch' | 'ready' | 'state'>;
  enqueuePacket(packet: Uint8Array, trafficClass: AcousticTrafficClass): AcousticQueueResult;
  reset(epoch: number): void;
  markHeartbeatMissed(): void;
}

export interface AcousticSessionAdapterOptions {
  session: AcousticSessionPort;
  /** Sends one complete, reassembled packet towards the local FIPS bridge. */
  emitPacket(envelope: FipsPacketEnvelope): void;
  /** Bridge controls are authority projections, never audio-preflight facts. */
  controls: Readonly<{ ready(epoch: number): void; disarm(epoch: number): void }>;
}

function trafficClass(value: FipsTrafficClass): AcousticTrafficClass {
  return value === FipsTrafficClass.Control ? 'control' : value === FipsTrafficClass.Heartbeat ? 'heartbeat' : 'ordinary';
}

/**
 * Arms the opaque FIPS boundary only while a session snapshot has both a
 * matching COMMIT acknowledgement and a current heartbeat (`snapshot.ready`).
 * Quiet local playback completion deliberately has no path into this class.
 */
export class AcousticSessionAdapter {
  readonly fips: FipsPacketAdapter;
  #generation = 1;
  #armedEpoch: number | undefined;

  constructor(private readonly options: AcousticSessionAdapterOptions) {
    this.fips = createFipsPacketAdapter({
      onPacket: (envelope) => {
        const result = this.options.session.enqueuePacket(envelope.bytes, trafficClass(envelope.trafficClass));
        return result.accepted ? { accepted: true } : { accepted: false, reason: result.reason === 'acoustic_queue_full' ? 'acoustic_queue_full' : result.reason === 'acoustic_not_ready' ? 'acoustic_not_ready' : result.reason === 'acoustic_packet_bounds' ? 'acoustic_packet_bounds' : 'acoustic_class_invalid' };
      },
      emitPacket: (envelope) => this.options.emitPacket(envelope),
    });
    this.refresh();
  }

  get generation(): number { return this.#generation; }
  get ready(): boolean { return this.#armedEpoch !== undefined; }

  refresh(): void {
    const snapshot = this.options.session.snapshot;
    if (!snapshot.ready) { this.disarm(snapshot.epoch); return; }
    if (this.#armedEpoch === snapshot.epoch) return;
    this.disarm(this.#armedEpoch ?? snapshot.epoch);
    this.#armedEpoch = snapshot.epoch;
    this.fips.arm(snapshot.epoch, this.#generation);
    this.options.controls.ready(snapshot.epoch);
  }

  receiveFips(packet: Uint8Array, classId: FipsTrafficClass, epoch: number, generation = this.#generation): PacketResult {
    if (generation !== this.#generation) return { accepted: false, reason: 'stale' };
    return this.fips.receive(packet, classId, epoch, generation);
  }

  /** Called only after FAS1 reassembly; bytes remain opaque to this adapter. */
  deliver(packet: Uint8Array, classId: FipsTrafficClass, generation = this.#generation): PacketResult {
    if (generation !== this.#generation) return { accepted: false, reason: 'stale' };
    return this.fips.send(packet.slice(), classId);
  }

  markDegraded(): void {
    const epoch = this.options.session.snapshot.epoch;
    this.disarm(epoch);
    this.options.session.markHeartbeatMissed();
  }

  reset(epoch: number): void {
    this.disarm(this.options.session.snapshot.epoch);
    this.#generation += 1;
    this.options.session.reset(epoch);
  }

  invalidate(): void { this.disarm(this.options.session.snapshot.epoch); this.#generation += 1; }

  private disarm(epoch: number): void {
    if (this.#armedEpoch === undefined) return;
    this.fips.invalidate();
    this.options.controls.disarm(epoch);
    this.#armedEpoch = undefined;
  }
}
