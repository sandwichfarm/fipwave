---
phase: 01
slug: qualify-the-demo-substrate
status: gap-planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-23
updated: 2026-07-23
---

# Phase 01 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node test + Vitest + Playwright |
| **Config** | `vitest.config.ts`, `playwright.config.ts` — created by 01-02 |
| **Quick command** | `npm run test:unit` |
| **Full command** | `npm run check` |
| **Hardware rule** | Only 01-10-01 is manual-only; it runs after the authoritative runner, Quiet fallback, and bounded Cyrinx path |

## Sampling Rate

- After every deterministic task: run that task's listed automated command.
- After Waves 2–4: run `npm run check` plus the wave-specific fixture/Compose command.
- Before 01-10-01: `npm run check`, `npm run fetch:codecs:check`,
  `npm run test:production-runner`, `npm run test:browser:production`,
  `npm run cyrinx:test`, and `npm run test:compose` are green.
- No watch-mode command is permitted.

## Exact Per-Task Verification Map

| Task ID | Plan | Wave | Requirements | Test Type | Automated Command / Manual Rule | Status |
|---------|------|------|--------------|-----------|---------------------------------|--------|
| 01-01-01 | 01-01 | 1 | all phase IDs (supply-chain prerequisite) | node integration | `node scripts/audit-dependencies.mjs --check .planning/phases/01-qualify-the-demo-substrate/dependency-audit.json && node --test tests/dependency-audit.test.mjs` | complete |
| 01-02-01 | 01-02 | 2 | CODEC-02, CODEC-03, WEB-01, WEB-03 | tracer integration | `node scripts/audit-dependencies.mjs --check-lock package-lock.json && npm run test:skeleton` | complete |
| 01-02-02 | 01-02 | 2 | CODEC-02, CODEC-03, WEB-01, WEB-03 | build/config | `npm run verify:dependencies && npm run lint && npm run typecheck && npm run test:skeleton && npm run build` | complete |
| 01-03-01 | 01-03 | 3 | WEB-01, WEB-02, WEB-03 | unit/type | `npm run test:unit -- apps/modem-ui/src/audio.test.ts && npm run typecheck` | complete |
| 01-03-02 | 01-03 | 3 | WEB-01, WEB-03, WEB-07 | browser/build | `npm run test:browser -- apps/modem-ui/e2e/audio-preflight.spec.ts && npm run build` | complete |
| 01-04-01 | 01-04 | 3 | CODEC-02, CODEC-03 | tracer integration | `npm run test:unit -- tests/qualification-evidence-tracer.test.ts` | complete |
| 01-04-02 | 01-04 | 3 | CODEC-02, CODEC-03 | unit | `npm run test:unit -- packages/bridge/test/protocol.test.ts packages/bridge/test/report.test.ts` | complete |
| 01-04-03 | 01-04 | 3 | CODEC-02, CODEC-03 | generation/unit | `npm run generate:corpus && npm run generate:corpus -- --check && npm run test:unit -- tests/corpus.test.ts` | complete |
| 01-05-01 | 01-05 | 4 | CODEC-02, CODEC-03 | fixture/unit | `npm run qualify:fixture && npm run test:unit -- apps/modem-ui/src/qualification.test.ts` | complete |
| 01-05-02 | 01-05 | 4 | CODEC-02, CODEC-03, CODEC-04 | gate/unit | `npm run test:unit -- apps/modem-ui/src/qualification.test.ts && npm run qualify:fixture` | complete |
| 01-05-03 | 01-05 | 4 | CODEC-02, CODEC-03, CODEC-04, WEB-07 | browser/build | `npm run test:browser -- apps/modem-ui/e2e/qualification.spec.ts && npm run build && npm run qualify:fixture` | complete |
| 01-06-01 | 01-06 | 4 | DEPLOY-02 | config/unit | `npm run test:compose && npm run test:unit -- tests/tun-preflight.test.ts` | complete |
| 01-06-02 | 01-06 | 4 | DEPLOY-02 | fake lifecycle/unit | `npm run test:unit -- tests/tun-preflight.test.ts && npm run test:compose` | complete |
| 01-07-01 | 01-07 | 5 | WEB-01, WEB-03 | tracer integration | `npm run build && npm run test:unit -- tests/production-runner.test.ts` | pending |
| 01-07-02 | 01-07 | 5 | CODEC-03, CODEC-04 | asset provenance | `npm run fetch:codecs && npm run fetch:codecs:check && node --test tests/codec-assets.test.mjs` | pending |
| 01-07-03 | 01-07 | 5 | CODEC-03, CODEC-04, WEB-07 | cached asset/browser integration | `npm run build && npm run test:browser:production -- apps/modem-ui/e2e/codec-assets.spec.ts && npm run check` | pending |
| 01-08-01 | 01-08 | 6 | CODEC-03, CODEC-04, WEB-01, WEB-02, WEB-03, WEB-07 | Quiet tracer browser | `npm run build && npm run test:browser:production -- apps/modem-ui/e2e/quiet-runtime.spec.ts` | pending |
| 01-08-02 | 01-08 | 6 | CODEC-03, CODEC-04 | Quiet scheduler/report | `npm run test:unit -- apps/modem-ui/src/quiet-client.test.ts packages/bridge/test/report.test.ts && npm run typecheck` | pending |
| 01-08-03 | 01-08 | 6 | CODEC-03, CODEC-04 | named CLI/integration | `node --test tests/qualify-cli.test.mjs && npm run qualify:verify -- --help && npm run test:browser:production -- apps/modem-ui/e2e/quiet-runtime.spec.ts && npm run check` | pending |
| 01-09-01 | 01-09 | 7 | CODEC-02, CODEC-03 | native digital | `npm run cyrinx:build && npm run cyrinx:test && node --test tests/cyrinx-batch.test.mjs` | pending |
| 01-09-02 | 01-09 | 7 | CODEC-02, CODEC-03 | bridge/native/audio integration | `npm run test:unit -- tests/cyrinx-runtime.test.ts apps/modem-ui/src/audio.test.ts && npm run typecheck` | pending |
| 01-09-03 | 01-09 | 7 | CODEC-02, CODEC-03, CODEC-04 | early-abandon integration | `npm run test:unit -- apps/modem-ui/src/qualification-session.test.ts tests/cyrinx-runtime.test.ts apps/modem-ui/src/audio.test.ts && npm run test:browser:production -- apps/modem-ui/e2e/quiet-runtime.spec.ts && npm run check` | pending |
| 01-10-01 | 01-10 | 8 | all eight phase IDs | **manual-only physical checkpoint** | Complete the eight exact-laptop/open-air/exact-host steps in 01-10; the named verifier runs inside that witnessed procedure | pending |

## Wave 0 Requirements

- [x] `.node-version` and dependency audit created by 01-01.
- [x] `package.json`, exact lockfile, TypeScript, Vite, Vitest, Playwright, and
      ESLint configuration created by 01-02.
- [x] Full deterministic command surface created and executed by 01-02.

`wave_0_complete` is `true`: execution installed the audited lockfile, created
the configuration, and ran the Wave 0 commands under the pinned Node runtime.

## Manual-Only Verification

| Task | Behavior | Why Manual |
|------|----------|------------|
| 01-10-01 | One-action real microphone/audio settings on both exact laptops; cold open-air corpus in both directions; intentionally audible profile; real Docker/TUN run on both exact hosts | Requires the actual Chromium policies, microphones, speakers, acoustic room path, Docker engines, and TUN devices; the trust result cannot auto-approve |

All deterministic tasks have concrete automated commands. The sole physical
task is explicitly manual-only and follows Plans 01-01 through 01-06.

## Validation Sign-Off

- [x] Exact final plan/task IDs and waves are mapped.
- [x] Every deterministic task has an automated command.
- [x] Only final Plan 01-10 is manual-only and uses `gate="blocking-human"`.
- [x] No watch-mode flags.
- [x] `nyquist_compliant: true`.
- [x] `wave_0_complete: true` after successful Wave 0 execution.

**Approval:** plan-complete; Wave 0 execution verified
