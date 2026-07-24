import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULTS = Object.freeze({
  outputVolume: 65,
  inputVolume: 90,
  playbackGainPercent: 100,
  messagesPerDirection: 5,
  portA: 4174,
  portB: 4175,
  startupTimeoutMs: 60_000,
  directionTimeoutMs: 12 * 60_000,
});
const FIRST_CASE = Object.freeze({
  'A → B': 'a-to-b-256-01',
  'B → A': 'b-to-a-256-01',
});

function usage() {
  return [
    'usage: node scripts/self-loop-smoke.mjs [options]',
    '',
    'Options:',
    '  --output-volume 0..100        macOS output level during the run (default: 65)',
    '  --input-volume 0..100         macOS input level during the run (default: 90)',
    '  --playback-gain-percent N     browser playback multiplier (default: 100; try 200 for diagnostics)',
    '  --messages-per-direction N    corpus messages sent each way (default: 5)',
    '  --port-a 1024..65535          role A runner port (default: 4174)',
    '  --port-b 1024..65535          role B runner port (default: 4175)',
    '  --startup-timeout-ms N        runner/browser startup timeout (default: 60000)',
    '  --direction-timeout-ms N      timeout for each full corpus (default: 720000)',
    '  --help                        show this help',
  ].join('\n');
}

function integerOption(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

export function parseArgs(values) {
  const options = { ...DEFAULTS };
  const definitions = new Map([
    ['--output-volume', ['outputVolume', 0, 100]],
    ['--input-volume', ['inputVolume', 0, 100]],
    ['--playback-gain-percent', ['playbackGainPercent', 1, 400]],
    ['--messages-per-direction', ['messagesPerDirection', 1, 25]],
    ['--port-a', ['portA', 1024, 65_535]],
    ['--port-b', ['portB', 1024, 65_535]],
    ['--startup-timeout-ms', ['startupTimeoutMs', 1_000, 60 * 60_000]],
    ['--direction-timeout-ms', ['directionTimeoutMs', 1_000, 60 * 60_000]],
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === '--help') return { help: true, ...options };
    const definition = definitions.get(key);
    const value = values[index + 1];
    if (!definition || value === undefined || value.startsWith('--')) throw new Error(usage());
    const [property, minimum, maximum] = definition;
    options[property] = integerOption(value, key, minimum, maximum);
    index += 1;
  }
  if (options.portA === options.portB) throw new Error('--port-a and --port-b must differ');
  return { help: false, ...options };
}

export function isBytePerfectResult(result, direction, epoch) {
  return result?.direction === direction
    && result.epoch === epoch
    && result.observed === true
    && result.complete === true
    && result.corrupt === false
    && result.missing === 0
    && result.duplicates === 0
    && result.deliveryCount === 1
    && result.bytePerfect === true
    && typeof result.expectedSha256 === 'string'
    && result.receivedSha256 === result.expectedSha256;
}

export function runnerIdentitySelector(machineId, role) {
  if (!/^[a-z][a-z0-9-]*$/.test(machineId)) throw new Error('runner machine ID is invalid');
  if (role !== 'A' && role !== 'B') throw new Error('runner role is invalid');
  return `[data-testid="runner-identity"][data-machine-id="${machineId}"][data-role="${role}"][data-evidence-class="Loopback"]`;
}

export function audioSettingsAcceptedSelector(epoch) {
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error('audio settings epoch is invalid');
  return `[data-testid="bridge-delivery"][data-audio-settings-accepted-epoch="${epoch}"]`;
}

function timestampId() {
  return `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${process.pid}`;
}

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    timer = setTimeout(() => finish(resolve), milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function createRecorder(runDirectory) {
  const stream = createWriteStream(path.join(runDirectory, 'events.ndjson'), { flags: 'a' });
  let closed = false;
  return {
    event(kind, details = {}, announce = false) {
      if (closed) return;
      const record = { at: new Date().toISOString(), kind, ...details };
      stream.write(`${JSON.stringify(record)}\n`);
      if (announce) {
        const suffix = details.message ? ` ${details.message}` : '';
        process.stdout.write(`[${record.at}] ${kind}${suffix}\n`);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve) => stream.end(resolve));
    },
  };
}

async function macosVolumeSettings() {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', 'get volume settings']);
  const match = stdout.match(/output volume:(\d+), input volume:(\d+), alert volume:(\d+), output muted:(true|false)/);
  if (!match) throw new Error(`could not parse macOS volume settings: ${stdout.trim()}`);
  return {
    outputVolume: Number(match[1]),
    inputVolume: Number(match[2]),
    alertVolume: Number(match[3]),
    outputMuted: match[4] === 'true',
  };
}

async function setMacosVolume(settings) {
  const muteClause = settings.outputMuted ? 'with output muted' : 'without output muted';
  await execFileAsync('/usr/bin/osascript', [
    '-e',
    `set volume output volume ${settings.outputVolume} input volume ${settings.inputVolume} ${muteClause}`,
  ]);
}

function parseAudioDevices(profile) {
  const lines = profile.split(/\r?\n/);
  const devices = [];
  let current;
  for (const line of lines) {
    const header = line.match(/^ {8}([^ ].*):$/);
    if (header) {
      current = { name: header[1], properties: {} };
      devices.push(current);
      continue;
    }
    if (!current) continue;
    const property = line.match(/^ {10}([^:]+): (.*)$/);
    if (property) current.properties[property[1]] = property[2];
  }
  return devices;
}

async function verifyBuiltInDefaults() {
  if (process.platform !== 'darwin') throw new Error('the autonomous hardware check currently requires macOS');
  const { stdout } = await execFileAsync('/usr/sbin/system_profiler', ['SPAudioDataType'], { maxBuffer: 2 * 1024 * 1024 });
  const devices = parseAudioDevices(stdout);
  const input = devices.find((device) => device.properties['Default Input Device'] === 'Yes');
  const output = devices.find((device) => device.properties['Default Output Device'] === 'Yes');
  if (!input || !output) throw new Error('could not resolve the default macOS input and output devices');
  for (const [kind, device] of [['input', input], ['output', output]]) {
    if (device.properties.Transport !== 'Built-in' || /loopback|virtual|fake/i.test(device.name)) {
      throw new Error(`default ${kind} is not built-in hardware: ${device.name} (${device.properties.Transport ?? 'unknown transport'})`);
    }
  }
  return {
    input: { name: input.name, transport: input.properties.Transport, sampleRate: Number(input.properties['Current SampleRate']) },
    output: { name: output.name, transport: output.properties.Transport, sampleRate: Number(output.properties['Current SampleRate']) },
  };
}

async function chromeRootProcesses() {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,command='], { maxBuffer: 4 * 1024 * 1024 });
  const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match || !match[2].startsWith(executable)) return [];
    return [{ pid: Number(match[1]), command: match[2] }];
  });
}

function waitForRunner(child, role, timeoutMs, recorder) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`role ${role} runner did not become ready within ${timeoutMs} ms`))), timeoutMs);
    child.once('error', (error) => finish(() => reject(error)));
    child.once('exit', (code, signal) => finish(() => reject(new Error(`role ${role} runner exited before readiness (code ${code}, signal ${signal})`))));
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.includes('FIPS over Sound runner listening on')) {
        recorder.event('runner-ready', { role, message: stdout.trim() }, true);
        finish(resolve);
      }
    });
  });
}

function startRunner(spec, options, recorder) {
  const runnerPath = path.join(ROOT, 'dist', 'server', 'packages', 'bridge', 'src', 'runner.js');
  const relativeReport = path.relative(ROOT, spec.reportPath);
  const args = [
    runnerPath,
    '--machine-id', spec.machineId,
    '--role', spec.role,
    '--port', String(spec.port),
    '--report', relativeReport,
    '--tun-evidence', 'none',
    '--evidence-mode', 'Loopback',
  ];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      CYRINX_ASSET_DIR: path.join(spec.runDirectory, `intentionally-missing-cyrinx-assets-${spec.role.toLowerCase()}`),
      CYRINX_BUILD_DIR: path.join(spec.runDirectory, `cyrinx-build-${spec.role.toLowerCase()}`),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = createWriteStream(path.join(spec.runDirectory, `runner-${spec.role.toLowerCase()}.log`));
  child.stdout.on('data', (chunk) => output.write(chunk));
  child.stderr.on('data', (chunk) => {
    output.write(chunk);
    recorder.event('runner-stderr', { role: spec.role, message: String(chunk).trim() });
  });
  recorder.event('runner-started', {
    role: spec.role,
    pid: child.pid,
    machineId: spec.machineId,
    port: spec.port,
    report: relativeReport,
    evidenceClass: 'Loopback',
    command: [process.execPath, ...args],
  }, true);
  return {
    child,
    output,
    ready: waitForRunner(child, spec.role, options.startupTimeoutMs, recorder),
  };
}

async function stopRunner(runner, recorder, role) {
  if (!runner) return;
  if (runner.child.exitCode === null && runner.child.signalCode === null) {
    recorder.event('runner-stop-requested', { role, pid: runner.child.pid });
    runner.child.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise((resolve) => runner.child.once('exit', () => resolve(true))),
      delay(3_000).then(() => false),
    ]);
    if (!exited && runner.child.exitCode === null && runner.child.signalCode === null) {
      recorder.event('runner-kill-requested', { role, pid: runner.child.pid });
      runner.child.kill('SIGKILL');
      await Promise.race([
        new Promise((resolve) => runner.child.once('exit', resolve)),
        delay(3_000),
      ]);
    }
  }
  const remainedAlive = runner.child.exitCode === null && runner.child.signalCode === null;
  await new Promise((resolve) => runner.output.end(resolve));
  if (remainedAlive) throw new Error(`role ${role} runner PID ${runner.child.pid} remained alive after SIGKILL`);
}

async function readJsonIfPresent(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function reportProgress(report, direction, epoch) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const observed = results.filter((result) => result.direction === direction && result.observed === true);
  const good = observed.filter((result) => isBytePerfectResult(result, direction, epoch));
  return {
    observed: observed.length,
    good: good.length,
    firstCaseGood: good.some((result) => result.caseId === FIRST_CASE[direction]),
    goodCaseIds: good.map((result) => result.caseId),
  };
}

function validateReportEnvelope(report, spec, epoch, expectedMicrophone) {
  if (!report) throw new Error(`role ${spec.role} canonical report was not written`);
  if (report.evidenceClass !== 'Loopback' || report.runner?.evidenceClass !== 'Loopback') {
    throw new Error(`role ${spec.role} report escaped diagnostic Loopback evidence`);
  }
  if (report.runner?.machineId !== spec.machineId || report.runner?.role !== spec.role) {
    throw new Error(`role ${spec.role} report identity is incorrect`);
  }
  if (report.epoch !== epoch) throw new Error(`role ${spec.role} report epoch ${report.epoch} does not match browser epoch ${epoch}`);
  if (report.qualification?.physicalGate !== 'not_physical') throw new Error(`role ${spec.role} report incorrectly claims a physical gate`);
  if (report.qualification?.fallback?.state !== 'activated' || report.qualification?.fallback?.reasonCode !== 'cyrinx_build_failed') {
    throw new Error(`role ${spec.role} did not enter the runner-authorized Quiet fallback`);
  }
  const audio = report.audio ?? {};
  if (!audio.microphoneLabel || /loopback|virtual|fake/i.test(audio.microphoneLabel) || !audio.microphoneLabel.includes(expectedMicrophone)) {
    throw new Error(`role ${spec.role} used an unexpected microphone: ${audio.microphoneLabel ?? 'missing'}`);
  }
  if (audio.contextState !== 'running'
    || audio.contextSampleRate !== 48_000
    || audio.captureSampleRate !== 48_000
    || ![44_100, 48_000].includes(audio.inputDeviceSampleRate)
    || ![1, 2].includes(audio.inputDeviceChannels)
    || audio.channels !== 1
    || audio.echoCancellation !== false
    || audio.noiseSuppression !== false
    || audio.autoGainControl !== false) {
    throw new Error(`role ${spec.role} report contains incompatible audio settings`);
  }
}

async function tableValues(page) {
  const entries = await page.locator('tr').evaluateAll((rows) => rows.flatMap((row) => {
    const key = row.querySelector('th[scope="row"]')?.textContent?.trim();
    const value = row.querySelector('td')?.textContent?.trim();
    return key && value ? [[key, value]] : [];
  }));
  return Object.fromEntries(entries);
}

function validatePageAudio(role, values, expectedMicrophone) {
  const microphone = values['Microphone label'];
  if (!microphone || !microphone.includes(expectedMicrophone) || /loopback|virtual|fake/i.test(microphone)) {
    throw new Error(`role ${role} browser selected an unexpected microphone: ${microphone ?? 'missing'}`);
  }
  const expected = {
    Permission: 'granted',
    'Audio-context state': 'running',
    'Web Audio context sample rate': '48000',
    'Codec capture PCM sample rate': '48000',
    'Codec capture PCM channels': '1',
    'Echo cancellation': 'false',
    'Noise suppression': 'false',
    'Automatic gain control': 'false',
  };
  for (const [label, value] of Object.entries(expected)) {
    if (values[label] !== value) throw new Error(`role ${role} browser ${label} is ${values[label] ?? 'missing'}, expected ${value}`);
  }
  if (!['44100', '48000'].includes(values['Input-device sample rate'])) throw new Error(`role ${role} browser input sample rate is incompatible`);
  if (!['1', '2'].includes(values['Input-device channels'])) throw new Error(`role ${role} browser input channel count is incompatible`);
}

function attachPageDiagnostics(page, role, recorder) {
  page.on('console', (message) => recorder.event('browser-console', {
    role,
    level: message.type(),
    message: message.text(),
  }));
  page.on('pageerror', (error) => recorder.event('browser-page-error', {
    role,
    message: errorText(error),
  }, true));
  page.on('requestfailed', (request) => recorder.event('browser-request-failed', {
    role,
    url: request.url(),
    message: request.failure()?.errorText ?? 'unknown',
  }));
}

async function waitForQuiet(page, spec, options) {
  const direction = spec.role === 'A' ? 'A → B' : 'B → A';
  const pattern = new RegExp(`^Quiet armed and listening · audible-7k-channel-0 · send ${direction} when the operator is ready · epoch (\\d+)$`);
  const locator = page.getByText(pattern);
  await locator.waitFor({ state: 'visible', timeout: options.startupTimeoutMs });
  const text = await locator.textContent();
  const epoch = Number(text?.match(/epoch (\d+)/)?.[1]);
  if (!Number.isSafeInteger(epoch)) throw new Error(`role ${spec.role} Quiet epoch could not be read`);
  await page.getByText(`Bridge delivery: Quiet audio settings accepted for epoch ${epoch}`, { exact: true }).waitFor({
    state: 'visible',
    timeout: options.startupTimeoutMs,
  });
  await page.getByRole('button', { name: `Send Quiet ${direction} corpus`, exact: true }).waitFor({
    state: 'visible',
    timeout: options.startupTimeoutMs,
  });
  return epoch;
}

async function pageStatus(page) {
  if (page.isClosed()) return 'closed';
  return (await page.locator('.status').textContent())?.trim() ?? 'unknown';
}

async function operatorText(page) {
  if (page.isClosed()) return '';
  return page.locator('.operator-card').innerText();
}

async function sendDirection(input) {
  const {
    direction,
    senderPage,
    receiverPage,
    receiverReportPath,
    epoch,
    options,
    recorder,
    signal,
  } = input;
  const senderRole = direction === 'A → B' ? 'A' : 'B';
  const receiverRole = senderRole === 'A' ? 'B' : 'A';
  recorder.event('direction-started', { direction, senderRole, receiverRole, epoch }, true);
  await senderPage.getByRole('button', { name: `Send Quiet ${direction} corpus`, exact: true }).click();
  const completeText = `Quiet ${direction} corpus sent · receiver remains armed · epoch ${epoch}`;
  const deadline = Date.now() + options.directionTimeoutMs;
  let lastProgress = '';
  let lastAnnouncement = 0;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason;
    const [senderState, receiverState, senderOperator, report] = await Promise.all([
      pageStatus(senderPage),
      pageStatus(receiverPage),
      operatorText(senderPage),
      readJsonIfPresent(receiverReportPath),
    ]);
    if (/failed|disconnected|closed/i.test(senderState)) throw new Error(`${direction} sender entered ${senderState}`);
    if (/failed|disconnected|closed/i.test(receiverState)) throw new Error(`${direction} receiver entered ${receiverState}`);
    const progress = reportProgress(report, direction, epoch);
    const serialized = JSON.stringify(progress);
    if (serialized !== lastProgress || Date.now() - lastAnnouncement >= 15_000) {
      recorder.event('direction-progress', {
        direction,
        senderState,
        receiverState,
        ...progress,
        message: `${direction}: ${progress.good} byte-perfect peer cases observed`,
      }, true);
      lastProgress = serialized;
      lastAnnouncement = Date.now();
    }
    if (senderOperator.includes(completeText)) {
      if (!progress.firstCaseGood) {
        throw new Error(`${direction} playback completed without byte-perfect receiver evidence for ${FIRST_CASE[direction]}`);
      }
      recorder.event('direction-complete', {
        direction,
        epoch,
        ...progress,
        message: `${direction} sent and independently decoded (${progress.good} byte-perfect cases)`,
      }, true);
      return progress;
    }
    await delay(1_000, signal);
  }
  throw new Error(`${direction} did not complete within ${options.directionTimeoutMs} ms`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const runId = timestampId();
  const runDirectory = path.join(ROOT, '.artifacts', 'diagnostics', 'self-loop', runId);
  await mkdir(runDirectory, { recursive: true });
  const recorder = createRecorder(runDirectory);
  const abortController = new AbortController();
  const onInterrupt = () => abortController.abort(new Error('self-loop run interrupted'));
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);

  const specs = {
    A: {
      role: 'A',
      machineId: 'self-loop-a',
      port: options.portA,
      reportPath: path.join(runDirectory, 'role-a.json'),
      runDirectory,
    },
    B: {
      role: 'B',
      machineId: 'self-loop-b',
      port: options.portB,
      reportPath: path.join(runDirectory, 'role-b.json'),
      runDirectory,
    },
  };
  const summary = {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    success: false,
    evidenceClass: 'Loopback',
    physicalPath: 'built-in speaker → air → built-in microphone',
    virtualAudioUsed: false,
    fakeMediaUsed: false,
    options,
    artifacts: {
      directory: path.relative(ROOT, runDirectory),
      roleAReport: path.relative(ROOT, specs.A.reportPath),
      roleBReport: path.relative(ROOT, specs.B.reportPath),
    },
  };
  let originalVolume;
  let browser;
  let pages;
  let runners;
  let capturedError;

  recorder.event('run-started', {
    runId,
    node: process.version,
    options,
    message: `artifacts: ${path.relative(ROOT, runDirectory)}`,
  }, true);

  try {
    if (process.version !== 'v22.23.1') throw new Error(`Node v22.23.1 is required, received ${process.version}`);
    summary.hardware = await verifyBuiltInDefaults();
    recorder.event('hardware-verified', { ...summary.hardware, message: `${summary.hardware.output.name} → ${summary.hardware.input.name}` }, true);

    originalVolume = await macosVolumeSettings();
    summary.originalVolume = originalVolume;
    const testVolume = { outputVolume: options.outputVolume, inputVolume: options.inputVolume, outputMuted: false };
    await setMacosVolume(testVolume);
    summary.testVolume = await macosVolumeSettings();
    recorder.event('volume-applied', { original: originalVolume, test: summary.testVolume, message: `output ${summary.testVolume.outputVolume}, input ${summary.testVolume.inputVolume}` }, true);

    runners = {
      A: startRunner(specs.A, options, recorder),
      B: startRunner(specs.B, options, recorder),
    };
    await Promise.all([runners.A.ready, runners.B.ready]);

    const chromeBefore = await chromeRootProcesses();
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      ignoreDefaultArgs: ['--mute-audio'],
    });
    summary.browser = {
      channel: 'chrome',
      version: browser.version(),
      headless: false,
      ignoredDefaultArgs: ['--mute-audio'],
    };
    const chromeAfter = await chromeRootProcesses();
    const oldPids = new Set(chromeBefore.map((processInfo) => processInfo.pid));
    const launchedChrome = chromeAfter.filter((processInfo) => !oldPids.has(processInfo.pid));
    if (launchedChrome.length !== 1) throw new Error(`could not uniquely identify the headed Chrome process (found ${launchedChrome.length})`);
    const chromeCommand = launchedChrome[0].command;
    if (/--headless|--mute-audio|--use-fake-device-for-media-stream|--use-file-for-fake-audio-capture/.test(chromeCommand)) {
      throw new Error(`Chrome launched with a forbidden audio bypass flag: ${chromeCommand}`);
    }
    summary.browser.pid = launchedChrome[0].pid;
    summary.browser.command = chromeCommand;
    recorder.event('browser-launched', { ...summary.browser, message: `${summary.browser.version}, PID ${summary.browser.pid}` }, true);

    const origins = {
      A: `http://127.0.0.1:${specs.A.port}/#playbackGain=${options.playbackGainPercent / 100}&corpusLimit=${options.messagesPerDirection}`,
      B: `http://127.0.0.1:${specs.B.port}/#playbackGain=${options.playbackGainPercent / 100}&corpusLimit=${options.messagesPerDirection}`,
    };
    const contexts = {
      A: await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      B: await browser.newContext({ viewport: { width: 1280, height: 900 } }),
    };
    await Promise.all([
      contexts.A.grantPermissions(['microphone'], { origin: origins.A }),
      contexts.B.grantPermissions(['microphone'], { origin: origins.B }),
    ]);
    pages = {
      A: await contexts.A.newPage(),
      B: await contexts.B.newPage(),
    };
    attachPageDiagnostics(pages.A, 'A', recorder);
    attachPageDiagnostics(pages.B, 'B', recorder);

    await Promise.all([
      pages.A.goto(origins.A, { waitUntil: 'domcontentloaded', timeout: options.startupTimeoutMs }),
      pages.B.goto(origins.B, { waitUntil: 'domcontentloaded', timeout: options.startupTimeoutMs }),
    ]);
    await Promise.all([
      pages.A.locator(runnerIdentitySelector(specs.A.machineId, specs.A.role)).waitFor({ timeout: options.startupTimeoutMs }),
      pages.B.locator(runnerIdentitySelector(specs.B.machineId, specs.B.role)).waitFor({ timeout: options.startupTimeoutMs }),
    ]);
    recorder.event('pages-loaded', { origins, message: 'both production roles loaded' }, true);

    await Promise.all([
      pages.A.getByRole('button', { name: 'Arm modem', exact: true }).click(),
      pages.B.getByRole('button', { name: 'Arm modem', exact: true }).click(),
    ]);
    await Promise.all([
      pages.A.getByText('Audio preflight passed on this laptop.', { exact: true }).waitFor({ timeout: options.startupTimeoutMs }),
      pages.B.getByText('Audio preflight passed on this laptop.', { exact: true }).waitFor({ timeout: options.startupTimeoutMs }),
      pages.A.locator(audioSettingsAcceptedSelector(1)).waitFor({ timeout: options.startupTimeoutMs }),
      pages.B.locator(audioSettingsAcceptedSelector(1)).waitFor({ timeout: options.startupTimeoutMs }),
    ]);
    recorder.event('audio-preflight-complete', { message: 'both roles armed at epoch 1' }, true);

    await Promise.all([
      pages.A.getByRole('button', { name: 'Start Cyrinx qualification', exact: true }).click(),
      pages.B.getByRole('button', { name: 'Start Cyrinx qualification', exact: true }).click(),
    ]);
    const [epochA, epochB] = await Promise.all([
      waitForQuiet(pages.A, specs.A, options),
      waitForQuiet(pages.B, specs.B, options),
    ]);
    if (epochA !== epochB) throw new Error(`Quiet epoch mismatch: role A is ${epochA}, role B is ${epochB}`);
    const epoch = epochA;
    summary.epoch = epoch;

    const [audioA, audioB] = await Promise.all([tableValues(pages.A), tableValues(pages.B)]);
    validatePageAudio('A', audioA, summary.hardware.input.name);
    validatePageAudio('B', audioB, summary.hardware.input.name);
    summary.browserAudio = { A: audioA, B: audioB };
    recorder.event('quiet-armed', { epoch, browserAudio: summary.browserAudio, message: `both roles listening at epoch ${epoch}` }, true);

    const [initialA, initialB] = await Promise.all([
      readJsonIfPresent(specs.A.reportPath),
      readJsonIfPresent(specs.B.reportPath),
    ]);
    validateReportEnvelope(initialA, specs.A, epoch, summary.hardware.input.name);
    validateReportEnvelope(initialB, specs.B, epoch, summary.hardware.input.name);

    summary.directions = {};
    summary.directions['A → B'] = await sendDirection({
      direction: 'A → B',
      senderPage: pages.A,
      receiverPage: pages.B,
      receiverReportPath: specs.B.reportPath,
      epoch,
      options,
      recorder,
      signal: abortController.signal,
    });
    summary.directions['B → A'] = await sendDirection({
      direction: 'B → A',
      senderPage: pages.B,
      receiverPage: pages.A,
      receiverReportPath: specs.A.reportPath,
      epoch,
      options,
      recorder,
      signal: abortController.signal,
    });

    const [finalA, finalB] = await Promise.all([
      readJsonIfPresent(specs.A.reportPath),
      readJsonIfPresent(specs.B.reportPath),
    ]);
    validateReportEnvelope(finalA, specs.A, epoch, summary.hardware.input.name);
    validateReportEnvelope(finalB, specs.B, epoch, summary.hardware.input.name);
    const finalAProgress = reportProgress(finalA, 'B → A', epoch);
    const finalBProgress = reportProgress(finalB, 'A → B', epoch);
    if (!finalAProgress.firstCaseGood || !finalBProgress.firstCaseGood) {
      throw new Error('final canonical reports do not prove byte-perfect messages in both directions');
    }
    summary.finalReports = { A: finalAProgress, B: finalBProgress };
    summary.success = true;
    recorder.event('run-succeeded', {
      epoch,
      roleAReceived: finalAProgress.good,
      roleBReceived: finalBProgress.good,
      message: `bidirectional acoustic messages decoded at epoch ${epoch}`,
    }, true);
  } catch (error) {
    capturedError = error;
    summary.error = errorText(error);
    recorder.event('run-failed', { message: summary.error }, true);
  } finally {
    if (pages) {
      await Promise.allSettled([
        pages.A.screenshot({ path: path.join(runDirectory, 'role-a-final.png'), fullPage: true }),
        pages.B.screenshot({ path: path.join(runDirectory, 'role-b-final.png'), fullPage: true }),
      ]);
    }
    if (browser) {
      try {
        await browser.close();
        summary.browserClosed = true;
      } catch (error) {
        summary.browserCloseError = errorText(error);
      }
    }
    if (runners) {
      const stopped = await Promise.allSettled([
        stopRunner(runners.A, recorder, 'A'),
        stopRunner(runners.B, recorder, 'B'),
      ]);
      const failures = stopped.flatMap((result) => result.status === 'rejected' ? [errorText(result.reason)] : []);
      summary.runnersStopped = failures.length === 0;
      if (failures.length > 0) summary.runnerStopErrors = failures;
    }
    if (originalVolume) {
      try {
        await setMacosVolume(originalVolume);
        summary.restoredVolume = await macosVolumeSettings();
        summary.volumeRestored = summary.restoredVolume.outputVolume === originalVolume.outputVolume
          && summary.restoredVolume.inputVolume === originalVolume.inputVolume
          && summary.restoredVolume.outputMuted === originalVolume.outputMuted;
      } catch (error) {
        summary.volumeRestored = false;
        summary.volumeRestoreError = errorText(error);
      }
    }
    if (summary.success && (!summary.browserClosed || !summary.runnersStopped || !summary.volumeRestored)) {
      capturedError = new Error('self-loop data passed, but owned resources or audio levels were not fully restored');
      summary.success = false;
      summary.error = errorText(capturedError);
      recorder.event('cleanup-failed', { message: summary.error }, true);
    }
    summary.finishedAt = new Date().toISOString();
    await writeFile(path.join(runDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    recorder.event('cleanup-complete', {
      browserClosed: summary.browserClosed,
      runnersStopped: summary.runnersStopped,
      volumeRestored: summary.volumeRestored,
      message: `summary: ${path.relative(ROOT, path.join(runDirectory, 'summary.json'))}`,
    }, true);
    await recorder.close();
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
  }
  if (capturedError) throw capturedError;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 1;
  });
}
