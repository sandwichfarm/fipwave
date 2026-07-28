import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeInvocation, createDemoPlan } from './demo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DELAY_MS = 8_000;
const NODE_VERSION = '22.23.1';

export function parseStaggeredArgs(argv) {
  let delayMs = Number(process.env.FIPWAVE_DEMO_STAGGER_MS ?? DEFAULT_DELAY_MS);
  let first = process.env.FIPWAVE_DEMO_FIRST_ROLE ?? 'b';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--delay-ms') {
      delayMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--first') {
      first = argv[index + 1];
      index += 1;
    } else {
      throw new Error('usage: npm run demo:staggered -- [--first a|b] [--delay-ms 8000]');
    }
  }

  if (first !== 'a' && first !== 'b') throw new Error('first role must be exactly a or b');
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 120_000) {
    throw new Error('delay-ms must be an integer from 0 through 120000');
  }

  const second = first === 'a' ? 'b' : 'a';
  return Object.freeze({ first, second, delayMs });
}

export function createLaunchPlan({ first, second, delayMs }) {
  return Object.freeze([
    Object.freeze({ role: first, port: first === 'a' ? 4310 : 4311, delayBeforeMs: 0 }),
    Object.freeze({ role: second, port: second === 'a' ? 4310 : 4311, delayBeforeMs: delayMs }),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runInvocation(invocation, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.environment },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${label} stopped by ${signal}`));
      else if (code !== 0) reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}`));
      else resolve();
    });
  });
}

export function createBridgeBuildPlan(role) {
  return composeInvocation(createDemoPlan(role), ['build', 'bridge']);
}

async function buildBridgeImages() {
  // Compose names images by project, so both role-specific tags must point at
  // the current source before either child executes `up` without `--build`.
  for (const role of ['a', 'b']) {
    process.stdout.write(`Building current bridge image for role ${role.toUpperCase()}...\n`);
    await runInvocation(createBridgeBuildPlan(role), `role ${role.toUpperCase()} bridge build`);
  }
}

function spawnRole({ role, port }) {
  const child = spawn('npx', ['-y', `node@${NODE_VERSION}`, 'scripts/demo.mjs', role], {
    cwd: ROOT,
    env: { ...process.env, FIPWAVE_DEMO_PORT: String(port) },
    stdio: 'inherit',
  });
  return child;
}

async function main() {
  const parsed = parseStaggeredArgs(process.argv.slice(2));
  const plan = createLaunchPlan(parsed);
  const children = [];
  let stopping = false;

  await buildBridgeImages();

  const stopChildren = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (!child.killed) child.kill('SIGTERM');
    }
  };

  process.once('SIGINT', stopChildren);
  process.once('SIGTERM', stopChildren);
  process.once('SIGHUP', stopChildren);

  for (const entry of plan) {
    if (entry.delayBeforeMs > 0) {
      process.stdout.write(`Waiting ${entry.delayBeforeMs} ms before launching role ${entry.role.toUpperCase()}...\n`);
      await sleep(entry.delayBeforeMs);
    }
    process.stdout.write(`Launching role ${entry.role.toUpperCase()} on port ${entry.port}...\n`);
    const child = spawnRole(entry);
    children.push(child);
  }

  const exitCode = await new Promise((resolve) => {
    let remaining = children.length;
    let worst = 0;
    for (const child of children) {
      child.once('exit', (code, signal) => {
        if (signal && !stopping) worst = 1;
        if (typeof code === 'number' && code !== 0) worst = code;
        remaining -= 1;
        if (remaining === 0) resolve(worst);
      });
    }
  });
  process.exitCode = exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
