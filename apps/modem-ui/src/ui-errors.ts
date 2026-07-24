export type UiReasonFallback =
  | 'browser audio unavailable'
  | 'local bridge message was rejected'
  | 'local bridge reset was unavailable'
  | 'local modem operation was unavailable'
  | 'Quiet modem operation was unavailable';

const FIXED_REASONS = new Set<string>([
  'audio reset is required before changing epoch',
  'audio reset is required before re-arm',
  'audio preflight failed',
  'microphone is unavailable',
  'PCM playback failed',
  'PCM playback was cancelled by reset',
  'Local bridge disconnected',
  'Local bridge closed before delivery was accepted',
  'Local bridge connection timed out',
  'Local bridge connection was replaced',
  'Local bridge did not accept audio settings',
  'Local bridge did not return RESET',
  'Local bridge is not open for qualification-result delivery',
  'Local bridge result delivery failed',
  'Local bridge RESET delivery failed',
  'Local bridge settings delivery failed',
  'Local bridge sent an invalid qualification-result acknowledgement',
  'Local bridge sent an stale Cyrinx session snapshot',
  'Local bridge sent an unsolicited RESET',
  'Local bridge sent an unsupported message',
  'Local bridge sent an unrecognized acknowledgement',
  'Qualification-result delivery is already pending',
  'Quiet applied microphone settings are incompatible',
  'Quiet applied settings are unavailable',
  'Quiet AudioContext state is unavailable',
  'Quiet is not armed',
  'Quiet runtime realm is unavailable',
  'Quiet transmission cancelled by reset',
  'Rejected stale or impossible Quiet receiver evidence',
  'browser audio unavailable',
  'local bridge message was rejected',
  'local bridge reset was unavailable',
  'local modem operation was unavailable',
  'Quiet modem operation was unavailable',
]);

const SAFE_AUDIO_TEMPLATES = [
  /^permission is (?:granted|denied|unknown)$/,
  /^audio context state is (?:running|suspended|closed|interrupted|unknown), not running$/,
  /^(?:context|codec capture) sample rate is (?:unknown|[0-9]{1,6}), not 48000$/,
  /^input-device sample rate is (?:unknown|[0-9]{1,6}), not 44100 or 48000$/,
  /^codec capture channel count is (?:unknown|[0-9]{1,4}), not 1$/,
  /^input-device channel count is (?:unknown|[0-9]{1,4}), not 1 or 2$/,
  /^(?:echo cancellation|noise suppression|automatic gain control) is (?:true|false|unknown)$/,
  /^AudioWorklet status is (?:ready|unavailable|unknown)$/,
  /^local bridge status is (?:connected|disconnected|unknown)$/,
  /^stale audio completion for epoch [0-9]{1,10}$/,
];

/**
 * Maps exceptions to a closed set of bounded operator messages. Raw browser,
 * bridge, codec, frame, URL, stack, and packet text never crosses into the DOM.
 */
export function safeUiReason(reason: unknown, fallback: UiReasonFallback): string {
  const raw = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  if (raw.length === 0 || raw.length > 240 || raw.trim() !== raw || /[\r\n]/.test(raw)) return fallback;
  if (FIXED_REASONS.has(raw) || SAFE_AUDIO_TEMPLATES.some((template) => template.test(raw))) return raw;
  return fallback;
}

export function safeConfigReason(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  if (raw === 'runner qualification configuration is invalid') return raw;
  return 'runner qualification configuration is unavailable';
}
