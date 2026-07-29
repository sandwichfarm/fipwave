import { execFile } from 'node:child_process';
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_NODE = '22.23.1';
const configuredPort = Number(process.env.FIPWAVE_DEMO_PORT ?? '4310');
if (!Number.isSafeInteger(configuredPort) || configuredPort < 1024 || configuredPort > 65_535) {
  throw new Error('FIPWAVE_DEMO_PORT must be an integer from 1024 through 65535');
}
const configuredFastGuardMs = Number(process.env.FIPWAVE_GUARD_MS ?? '20');
if (!Number.isSafeInteger(configuredFastGuardMs) || configuredFastGuardMs < 20 || configuredFastGuardMs > 1_500) {
  throw new Error('FIPWAVE_GUARD_MS must be an integer from 20 through 1500');
}
const BROWSER_PORT = configuredPort;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export function parseDemoArgs(argv) {
  if (argv.length === 1 && argv[0] === '--check') return Object.freeze({ mode: 'check' });
  if (argv.length === 1 && (argv[0] === 'a' || argv[0] === 'b')) {
    return Object.freeze({ mode: 'run', role: argv[0] });
  }
  throw new Error('usage: npm run demo -- a|b (or npm run demo:check)');
}

function safeRunId(now = new Date()) {
  return now.toISOString().replaceAll(/[-:.]/g, '');
}

export function createDemoPlan(role, now = new Date()) {
  if (role !== 'a' && role !== 'b') throw new Error('demo role must be exactly a or b');
  const artifactDirectory = path.join(ROOT, '.artifacts', 'demo', `${safeRunId(now)}-${role}`);
  return Object.freeze({
    role,
    project: `fipwave_demo_${role}`,
    machineId: `fipwave-${role}`,
    browserPort: BROWSER_PORT,
    artifactDirectory,
    // The owned Playwright browser exposes navigator.webdriver; the explicit
    // hash keeps the shipped audience view selected without using a query
    // string (the static runner intentionally rejects query-bearing paths).
    origin: `http://127.0.0.1:${BROWSER_PORT}/#demo=1&playbackGain=2`,
    environment: Object.freeze({
      ROLE: role.toUpperCase(),
      MACHINE_ID: `fipwave-${role}`,
      BROWSER_PORT: String(BROWSER_PORT),
      FAST_GUARD_MS: String(configuredFastGuardMs),
      DEMO_ARTIFACT_DIR: artifactDirectory,
    }),
  });
}

export function composeInvocation(plan, args) {
  if (!plan || (plan.role !== 'a' && plan.role !== 'b')) throw new Error('demo plan is invalid');
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) throw new Error('compose arguments are invalid');
  return Object.freeze({
    command: 'docker',
    args: Object.freeze(['compose', '-p', plan.project, '-f', 'compose.fips.yml', ...args]),
    cwd: ROOT,
    environment: plan.environment,
  });
}

async function compose(plan, args) {
  const invocation = composeInvocation(plan, args);
  const buildCommit = process.env.BUILD_COMMIT ?? (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
  if (!/^[a-f0-9]{40}$/i.test(buildCommit)) throw new Error('demo requires a resolved 40-hex BUILD_COMMIT');
  return execFileAsync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: { ...process.env, ...invocation.environment, BUILD_COMMIT: buildCommit },
    maxBuffer: MAX_OUTPUT_BYTES,
  });
}

async function checkPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => reject(new Error(`loopback port ${port} is unavailable: ${error.message}`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
}

async function commandVersion(command, args) {
  const result = await execFileAsync(command, args, { cwd: ROOT, maxBuffer: MAX_OUTPUT_BYTES, timeout: 15_000 });
  return `${result.stdout}${result.stderr}`.trim().split('\n')[0] ?? '';
}

async function chromeAvailable() {
  if (process.platform === 'darwin') {
    await access('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    return 'Google Chrome';
  }
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      await execFileAsync('sh', ['-c', `command -v ${candidate}`], { timeout: 5_000 });
      return candidate;
    } catch {}
  }
  throw new Error('headed Chrome or Chromium is required');
}

export function parseMacAudioHardware(profile) {
  const devices = [];
  let current;
  for (const line of profile.split(/\r?\n/)) {
    const header = line.match(/^ {8}([^ ].*):$/);
    if (header) {
      current = { name: header[1], properties: {} };
      devices.push(current);
      continue;
    }
    const property = current && line.match(/^ {10}([^:]+): (.*)$/);
    if (property) current.properties[property[1]] = property[2];
  }
  const input = devices.find((device) => device.properties['Default Input Device'] === 'Yes');
  const output = devices.find((device) => device.properties['Default Output Device'] === 'Yes');
  if (!input) throw new Error('no default microphone is available; select an input device in System Settings → Sound');
  if (!output) throw new Error('no default speaker is available; select an output device in System Settings → Sound');
  const rate = (device, kind) => {
    const value = Number(device.properties['Current SampleRate']);
    if (value !== 44_100 && value !== 48_000) throw new Error(`${kind} ${device.name} uses unsupported ${String(device.properties['Current SampleRate'] ?? 'unknown')} Hz audio; select a 44.1 or 48 kHz device`);
    return value;
  };
  return Object.freeze({
    input: Object.freeze({ name: input.name, sampleRate: rate(input, 'microphone') }),
    output: Object.freeze({ name: output.name, sampleRate: rate(output, 'speaker') }),
  });
}

async function audioHardware() {
  if (process.platform === 'darwin') {
    const { stdout } = await execFileAsync('/usr/sbin/system_profiler', ['SPAudioDataType'], { maxBuffer: 2 * 1024 * 1024, timeout: 15_000 });
    return parseMacAudioHardware(stdout);
  }
  if (process.platform === 'linux') {
    const [source, sink] = await Promise.all([
      commandVersion('pactl', ['get-default-source']),
      commandVersion('pactl', ['get-default-sink']),
    ]).catch(() => {
      throw new Error('PipeWire/PulseAudio defaults are unavailable; install pactl and select a default microphone and speaker');
    });
    if (!source || !sink) throw new Error('default Linux microphone or speaker is unavailable; select both before starting the demo');
    return Object.freeze({
      input: Object.freeze({ name: source, sampleRate: 'verified by browser at arm time' }),
      output: Object.freeze({ name: sink, sampleRate: 'verified by browser at arm time' }),
    });
  }
  throw new Error(`audio preflight is not implemented for ${process.platform}; use macOS or Linux`);
}

export async function runPreflight({ requireFreePort = true } = {}) {
  if (process.versions.node !== REQUIRED_NODE) {
    throw new Error(`Node ${REQUIRED_NODE} is required; active version is ${process.versions.node}`);
  }
  await Promise.all([
    access(path.join(ROOT, 'node_modules')),
    access(path.join(ROOT, 'package-lock.json')),
    access(path.join(ROOT, 'codec-assets.lock.json')),
  ]);
  const [docker, composeVersion, chrome, audio] = await Promise.all([
    commandVersion('docker', ['version', '--format', '{{.Server.Version}}']),
    commandVersion('docker', ['compose', 'version', '--short']),
    chromeAvailable(),
    audioHardware(),
    commandVersion('docker', ['info', '--format', '{{.OSType}}']),
  ]);
  if (requireFreePort) await checkPortAvailable(BROWSER_PORT);
  return Object.freeze({
    schemaVersion: 1,
    ok: true,
    node: process.versions.node,
    docker,
    compose: composeVersion,
    chrome,
    audio,
    browserPort: BROWSER_PORT,
    platform: `${os.platform()}-${os.arch()}`,
  });
}

function boundedError(error) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replaceAll(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function createRecorder(plan) {
  const eventsPath = path.join(plan.artifactDirectory, 'events.ndjson');
  let chain = Promise.resolve();
  return Object.freeze({
    event(kind, details = {}) {
      const record = { at: new Date().toISOString(), kind, ...details };
      chain = chain.then(() => appendFile(eventsPath, `${JSON.stringify(record)}\n`, 'utf8'));
      return chain;
    },
    flush() { return chain; },
  });
}

async function waitForReady(plan, recorder) {
  const deadline = Date.now() + 90_000;
  let lastReason = 'not started';
  while (Date.now() < deadline) {
    try {
      const [page, statusResponse] = await Promise.all([
        fetch(`http://127.0.0.1:${plan.browserPort}/`),
        fetch(`http://127.0.0.1:${plan.browserPort}/bridge-status`),
      ]);
      if (page.ok && statusResponse.ok) {
        const status = await statusResponse.json();
        if (status?.configuration === 'ready' && status?.soundTransport === 'started') {
          await recorder.event('stack-ready', {
            configuration: status.configuration,
            soundTransport: status.soundTransport,
            localBridge: status.localBridge,
          });
          return status;
        }
        lastReason = `configuration=${String(status?.configuration)}, soundTransport=${String(status?.soundTransport)}`;
      } else {
        lastReason = `HTTP ${page.status}/${statusResponse.status}`;
      }
    } catch (error) {
      lastReason = boundedError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`demo stack did not become ready: ${lastReason}`);
}

async function launchOwnedBrowser(plan, recorder) {
  const { chromium } = await import('@playwright/test');
  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      ignoreDefaultArgs: ['--mute-audio'],
      args: ['--disable-infobars', '--no-first-run', '--disable-sync'],
    });
  } catch {
    browser = await chromium.launch({
      headless: false,
      ignoreDefaultArgs: ['--mute-audio'],
      args: ['--disable-infobars', '--no-first-run', '--disable-sync'],
    });
  }
  // Use the real headed window dimensions. A fixed Playwright viewport stays
  // 1280 px wide after the operator tiles two windows, which makes the
  // dashboard appear clipped instead of responding to the presentation area.
  const context = await browser.newContext({ viewport: null });
  await context.grantPermissions(['microphone'], { origin: `http://127.0.0.1:${plan.browserPort}` });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') void recorder.event('browser-console', { level: 'error', message: message.text().slice(0, 500) });
  });
  await page.goto(plan.origin, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await recorder.event('browser-opened', { headed: true, fakeMedia: false, muted: false, origin: plan.origin });

  const start = page.getByRole('button', { name: /^Start \/ Connect$/i });
  try {
    await start.waitFor({ state: 'visible', timeout: 60_000 });
    const initialEpoch = await page.evaluate(async () => {
      const response = await fetch('/bridge-status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`bridge status returned HTTP ${response.status}`);
      const status = await response.json();
      if (!Number.isInteger(status.epoch)) throw new Error('bridge status did not contain an integer epoch');
      return status.epoch;
    });
    await start.click();
    await page.waitForFunction(async (previousEpoch) => {
      const response = await fetch('/bridge-status', { cache: 'no-store' });
      if (!response.ok) return false;
      const status = await response.json();
      return status.browserAudio === 'armed'
        && status.localBridge === 'ready'
        && Number.isInteger(status.epoch)
        && status.epoch > previousEpoch;
    }, initialEpoch, { timeout: 60_000 });
    await recorder.event('demo-started', { automaticTrustedClick: true, transport: 'cyrinx' });
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw new Error(`demo Start control was unavailable: ${boundedError(error)}`);
  }
  return browser;
}

export function waitForStop(browser, signals = process) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      resolve(reason);
    };
    const onSigint = () => finish('SIGINT');
    const onSigterm = () => finish('SIGTERM');
    const onSighup = () => finish('SIGHUP');
    // Keep these handlers installed through the `finally` cleanup. `npm run`
    // may relay another termination signal after the terminal's first SIGINT;
    // reverting to the default handler here would strand the owned Compose
    // project before `down --volumes` and the canonical summary can finish.
    signals.on('SIGINT', onSigint);
    signals.on('SIGTERM', onSigterm);
    signals.on('SIGHUP', onSighup);
    browser.once('disconnected', () => finish('browser-closed'));
  });
}

async function captureComposeLogs(plan) {
  try {
    const result = await compose(plan, ['logs', '--no-color', '--timestamps']);
    await writeFile(path.join(plan.artifactDirectory, 'compose.log'), `${result.stdout}${result.stderr}`.slice(-MAX_OUTPUT_BYTES), 'utf8');
  } catch (error) {
    await writeFile(path.join(plan.artifactDirectory, 'compose-log-error.txt'), boundedError(error), 'utf8');
  }
}

export async function runDemo(role) {
  const plan = createDemoPlan(role);
  await mkdir(plan.artifactDirectory, { recursive: true });
  const recorder = createRecorder(plan);
  let browser;
  let stackStarted = false;
  let success = false;
  let stopReason = 'startup-error';
  let failure;

  await recorder.event('run-started', {
    role: plan.role,
    machineId: plan.machineId,
    project: plan.project,
    evidenceClass: 'Loopback',
    note: 'Physical inter-laptop acceptance must be recorded separately as Open air.',
  });
  try {
    const preflight = await runPreflight({ requireFreePort: false });
    // An interrupted prior run may still own this role's exact Compose
    // project and loopback port. Reap only that known project before treating
    // the port as an unrelated conflict.
    await compose(plan, ['down', '--volumes', '--remove-orphans']).catch(() => undefined);
    await checkPortAvailable(plan.browserPort);
    await recorder.event('preflight-passed', preflight);
    await compose(plan, ['up', '--detach', '--remove-orphans']);
    stackStarted = true;
    await recorder.event('compose-started', { project: plan.project });
    await waitForReady(plan, recorder);
    browser = await launchOwnedBrowser(plan, recorder);
    stopReason = await waitForStop(browser);
    success = true;
  } catch (error) {
    failure = boundedError(error);
    await recorder.event('run-failed', { message: failure });
  } finally {
    if (browser?.isConnected()) await browser.close().catch(() => undefined);
    if (stackStarted) await captureComposeLogs(plan);
    let cleanupError;
    try {
      await compose(plan, ['down', '--volumes', '--remove-orphans']);
    } catch (error) {
      cleanupError = boundedError(error);
      await recorder.event('cleanup-failed', { message: cleanupError });
    }
    await recorder.event('cleanup-complete', {
      browserClosed: !browser?.isConnected(),
      composeStopped: !cleanupError,
      audioSettingsModified: false,
      stopReason,
    });
    await recorder.flush();
    const summary = {
      schemaVersion: 1,
      success: success && !cleanupError,
      role: plan.role,
      machineId: plan.machineId,
      project: plan.project,
      browserPort: plan.browserPort,
      evidenceClass: 'Loopback',
      physicalOpenAirClaimed: false,
      artifactDirectory: plan.artifactDirectory,
      browserClosed: !browser?.isConnected(),
      composeStopped: !cleanupError,
      audioSettingsModified: false,
      stopReason,
      ...(failure ? { failure } : {}),
      ...(cleanupError ? { cleanupError } : {}),
      finishedAt: new Date().toISOString(),
    };
    await writeFile(path.join(plan.artifactDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.success) throw new Error(failure ?? cleanupError ?? 'demo failed');
  }
}

async function main() {
  const parsed = parseDemoArgs(process.argv.slice(2));
  if (parsed.mode === 'check') {
    process.stdout.write(`${JSON.stringify(await runPreflight(), null, 2)}\n`);
    return;
  }
  await runDemo(parsed.role);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    process.stderr.write(`${boundedError(error)}\n`);
    process.exitCode = 1;
  });
}
