import './style.css';
import { armAudio, enqueuePcmPlayback, resetAudio, validatePcmPlaybackFrame, type AppliedAudioEvidence } from './audio.js';
import { acceptBridgePlaybackFrame } from '../../../packages/bridge/src/codecs/websocket.js';

type UiState = 'idle' | 'requesting' | 'ready' | 'failed' | 'disconnected';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Modem UI root is unavailable');
const appRoot: HTMLDivElement = app;

let epoch = 1;
let evidence: AppliedAudioEvidence | undefined;
let uiState: UiState = 'idle';
let failure = '';
let bridge: WebSocket | undefined;
type GateState = 'not-started' | 'cyrinx-running';
type CorpusRow = { direction: string; caseId: string; evidenceClass: 'Fixture' | 'Open air'; result: string; airtime: string };
let gateState: GateState = 'not-started';
let corpusRows: CorpusRow[] = [];

const labels: Record<UiState, string> = {
  idle: 'Idle', requesting: 'Requesting', ready: 'Ready', failed: 'Failed', disconnected: 'Disconnected',
};

const bodyCopy: Record<UiState, string> = {
  idle: 'Arm this laptop to request microphone access, start audio, and verify the applied capture settings.',
  requesting: 'Requesting microphone and starting audio…',
  ready: 'Audio preflight passed on this laptop.',
  failed: '',
  disconnected: 'Local bridge disconnected. Qualification is paused; no result is being inferred.',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function settingValue(value: unknown): string {
  return value === undefined ? 'Unknown' : String(value);
}

function frameForSettings(value: AppliedAudioEvidence): ArrayBuffer {
  const payload = new TextEncoder().encode(JSON.stringify(value));
  const frame = new ArrayBuffer(32 + payload.byteLength);
  const view = new DataView(frame);
  for (const [index, byte] of [0x46, 0x57, 0x41, 0x56].entries()) view.setUint8(index, byte);
  view.setUint8(4, 1);
  view.setUint8(5, 2);
  view.setUint32(8, payload.byteLength, true);
  view.setUint32(12, value.epoch, true);
  new Uint8Array(frame, 32).set(payload);
  return frame;
}

function reportToBridge(value: AppliedAudioEvidence): Promise<void> {
  return new Promise((resolve, reject) => {
    bridge?.close();
    bridge = new WebSocket(`ws://${window.location.host}/bridge`);
    bridge.binaryType = 'arraybuffer';
    bridge.addEventListener('open', () => bridge?.send(frameForSettings(value)), { once: true });
    bridge.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        try {
          acceptBridgePlaybackFrame(event.data, value.epoch, { validate: validatePcmPlaybackFrame, enqueue: enqueuePcmPlayback });
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Local bridge playback rejected.'));
        }
        return;
      }
      resolve();
    });
    bridge.addEventListener('error', () => reject(new Error('Local bridge disconnected.')), { once: true });
  });
}

function appendSetting(table: HTMLTableElement, label: string, value: unknown): void {
  const row = table.insertRow();
  const key = element('th', label);
  key.scope = 'row';
  row.append(key, element('td', settingValue(value)));
}

function render(): void {
  appRoot.replaceChildren();
  const header = element('header');
  header.append(element('h1', 'Modem qualification'));
  const meta = element('p', `Machine: this browser · Chromium: ${navigator.userAgent} · Local epoch: ${epoch}`);
  meta.className = 'measurements';
  header.append(meta);
  const badge = element('p', `● ${labels[uiState]}`);
  badge.className = `status status-${uiState}`;
  header.append(badge);
  appRoot.append(header);

  const grid = element('div');
  grid.className = 'console-grid';
  const operator = element('section');
  operator.className = 'card operator-card';
  operator.append(element('h2', 'Operator control'));
  if (uiState === 'idle') operator.append(element('h3', 'Modem is not armed'));
  const announcement = element('p', uiState === 'failed'
    ? `Audio preflight failed: ${failure}. Check the device or browser permission, then Reset / re-arm.`
    : bodyCopy[uiState]);
  announcement.id = 'audio-status';
  announcement.setAttribute('aria-live', uiState === 'failed' ? 'assertive' : 'polite');
  operator.append(announcement);
  if (uiState === 'idle') operator.append(control('Arm modem', arm));
  if (uiState === 'requesting') operator.append(control('Arm modem', arm, true));
  if (uiState === 'ready') {
    operator.append(control('Start Cyrinx qualification', startQualification));
    operator.append(control('Reset / re-arm', reset, false, 'secondary'));
  }
  if (uiState === 'failed' || uiState === 'disconnected') operator.append(control('Reset / re-arm', reset, false, 'secondary'));
  operator.append(element('p', 'This starts a new local epoch and ignores stale results.'));
  grid.append(operator);

  const evidenceCard = element('section');
  evidenceCard.className = 'card';
  evidenceCard.append(element('h2', 'Applied audio evidence'));
  evidenceCard.append(element('p', 'Required: mono · 48 kHz-compatible · echo cancellation off · noise suppression off · auto gain control off.'));
  const table = element('table');
  table.append(element('caption', 'Actual browser and bridge observations'));
  appendSetting(table, 'Microphone label', evidence?.microphoneLabel);
  appendSetting(table, 'Permission', evidence?.permission);
  appendSetting(table, 'Audio-context state', evidence?.contextState);
  appendSetting(table, 'Context sample rate', evidence?.contextSampleRate);
  appendSetting(table, 'Track sample rate', evidence?.trackSampleRate);
  appendSetting(table, 'Channel count', evidence?.channelCount);
  appendSetting(table, 'Echo cancellation', evidence?.echoCancellation);
  appendSetting(table, 'Noise suppression', evidence?.noiseSuppression);
  appendSetting(table, 'Automatic gain control', evidence?.autoGainControl);
  appendSetting(table, 'AudioWorklet status', evidence?.workletState);
  appendSetting(table, 'Bridge endpoint', evidence ? 'localhost only' : undefined);
  evidenceCard.append(table);
  grid.append(evidenceCard);
  appRoot.append(grid);

  const gate = element('section'); gate.className = 'card qualification-gate';
  gate.append(element('h2', 'Cyrinx qualification gate'));
  const checklist = element('ol');
  ['Cyrinx build and golden vectors', '256 B and 1536 B fixture round trips', 'Browser PCM bridge loopback', 'Cold acquisition: A → B', 'Cold acquisition: B → A', 'Gate decision'].forEach((step) => checklist.append(element('li', step)));
  gate.append(checklist);
  if (gateState === 'not-started') gate.append(element('p', 'Cyrinx qualification has not started. Fixture results do not qualify the physical sound path.'));
  else {
    gate.append(element('p', 'Cyrinx qualification is in progress.'));
    const countdown = element('p', 'Cyrinx gate closes in 1:30:00'); countdown.className = 'countdown'; countdown.setAttribute('aria-live', 'assertive'); gate.append(countdown);
    gate.append(element('p', 'This deadline is immutable. Any hard failure or expiry immediately routes to the audible Quiet fallback.'));
  }
  appRoot.append(gate);

  const corpus = element('section'); corpus.className = 'card corpus-card'; corpus.append(element('h2', 'Corpus evidence'));
  corpus.append(element('p', 'Unique 256 B and 1536 B cases are keyed by epoch, literal direction, and case ID.'));
  const filter = element('input') as HTMLInputElement; filter.type = 'search'; filter.placeholder = 'Filter corpus cases'; filter.setAttribute('aria-label', 'Filter corpus cases'); corpus.append(filter);
  corpus.append(control('Sort newest first', () => { corpusRows = [...corpusRows].reverse(); render(); }, false, 'secondary'));
  if (!corpusRows.length) corpus.append(element('p', 'No corpus results have been recorded for this epoch.'));
  else {
    const table = element('table'); table.setAttribute('aria-label', 'Qualification corpus evidence');
    const caption = element('caption', 'Qualification corpus evidence'); table.append(caption);
    const head = element('thead'); const headRow = element('tr'); ['Direction', 'Case', 'Evidence', 'Result', 'Airtime'].forEach((label) => { const cell = element('th', label); cell.scope = 'col'; headRow.append(cell); }); head.append(headRow); table.append(head);
    const body = element('tbody');
    corpusRows.filter((row) => row.caseId.toLowerCase().includes(filter.value.toLowerCase())).forEach((row) => { const tr = element('tr'); [row.direction, row.caseId, row.evidenceClass, row.result, row.airtime].forEach((value) => tr.append(element('td', value))); body.append(tr); });
    table.append(body); corpus.append(table, element('p', 'Fixture evidence is diagnostic only and cannot select a codec.'));
  }
  appRoot.append(corpus);

  const docker = element('section'); docker.className = 'card'; docker.append(element('h2', 'Docker and TUN projection'));
  const dockerList = element('dl');
  [['Bridge binding', '127.0.0.1 only'], ['Device', '/dev/net/tun pending host preflight'], ['Capabilities', 'NET_ADMIN only; no privileged mode; no SYS_ADMIN'], ['Evidence', 'Missing — run deterministic Compose preflight on each laptop']].forEach(([label, value]) => { dockerList.append(element('dt', label), element('dd', value)); });
  docker.append(dockerList); appRoot.append(docker);

  const decision = element('section'); decision.className = 'card'; decision.append(element('h2', 'Decision and report'));
  decision.append(element('p', corpusRows.some((row) => row.evidenceClass === 'Fixture') ? 'Human needed — non-physical fixture evidence is recorded.' : 'Missing — two named exact-laptop Open air reports are required.'));
  decision.append(element('p', 'Canonical paths: .artifacts/qualification/{machine-id}.json and .artifacts/qualification/selection.json'));
  decision.append(element('p', 'A selected profile must be audible, fixed, advertise at least 1357 bytes, and have exact-pair Open air evidence.'));
  appRoot.append(decision);
}

function control(label: string, action: () => void | Promise<void>, disabled = false, className = ''): HTMLButtonElement {
  const button = element('button', label);
  button.type = 'button'; button.disabled = disabled; button.className = className;
  button.addEventListener('click', () => { void action(); });
  return button;
}

async function arm(): Promise<void> {
  if (uiState === 'requesting') return;
  uiState = 'requesting'; failure = ''; render();
  try {
    evidence = await armAudio(epoch);
    await reportToBridge(evidence);
    uiState = 'ready';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown audio error';
    uiState = message.includes('bridge') ? 'disconnected' : 'failed';
    failure = message;
  }
  render();
}

function startQualification(): void {
  if (uiState !== 'ready' || gateState === 'cyrinx-running') return;
  gateState = 'cyrinx-running';
  corpusRows = [{ direction: 'A → B', caseId: `fixture-epoch-${epoch}`, evidenceClass: 'Fixture', result: 'Byte-perfect loopback (non-physical)', airtime: '0 ms' }];
  render();
}

async function reset(): Promise<void> {
  bridge?.close(); bridge = undefined;
  epoch = await resetAudio();
  evidence = undefined; uiState = 'requesting'; failure = ''; gateState = 'not-started'; corpusRows = []; render();
  await arm();
}

render();
