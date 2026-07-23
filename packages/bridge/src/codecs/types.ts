import type { EvidenceClass, LiteralDirection } from '../report.js';

export type CodecId = 'cyrinx' | 'quiet' | 'ggwave' | 'fixture';

export interface CodecProfile {
  codec: CodecId;
  name: string;
  audible: boolean;
  advertisedMtu: number;
  sampleRate: 48_000;
  channels: 1;
}

export interface QualificationCase {
  id: string;
  direction: LiteralDirection;
  size: 256 | 1536;
  digest: string;
  payload: Uint8Array;
}

export interface QualificationContext {
  epoch: number;
  evidenceClass: EvidenceClass;
  nowMs: number;
  deadLinkTimeoutMs?: number;
}

export interface QueueEvidence {
  captureHighWaterBytes: number;
  captureHighWaterMs: number;
  playbackHighWaterBytes: number;
  playbackHighWaterMs: number;
  discontinuities: number;
}

/** A single bounded result. It is intentionally free of codec-specific details. */
export interface AdapterResult {
  adapter: CodecId;
  profile: CodecProfile;
  evidenceClass: EvidenceClass;
  epoch: number;
  direction: LiteralDirection;
  caseId: string;
  digest: string;
  bytePerfect: boolean;
  deliveryCount: number;
  acquisitionMs: number;
  airtimeMs: number;
  coldAcquired: boolean;
  complete: boolean;
  audioPassed: boolean;
  queues: QueueEvidence;
  reasonCode?: string;
}

export interface CodecAdapter {
  readonly profile: CodecProfile;
  qualify(qualificationCase: QualificationCase, context: QualificationContext): Promise<AdapterResult>;
  reset?(nextEpoch: number): void;
}
