---
phase: 01
slug: qualify-the-demo-substrate
status: approved
nyquist_compliant: true
wave_0_complete: false
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
| **Hardware rule** | Only 01-07-01 is manual-only; it runs after all deterministic implementation |

## Sampling Rate

- After every deterministic task: run that task's listed automated command.
- After Waves 2–4: run `npm run check` plus the wave-specific fixture/Compose command.
- Before 01-07-01: `npm run check`, `npm run generate:corpus -- --check`,
  `npm run qualify:fixture`, and `npm run test:compose` are green.
- No watch-mode command is permitted.

## Exact Per-Task Verification Map

| Task ID | Plan | Wave | Requirements | Test Type | Automated Command / Manual Rule | Status |
|---------|------|------|--------------|-----------|---------------------------------|--------|
| 01-01-01 | 01-01 | 1 | all phase IDs (supply-chain prerequisite) | node integration | `node scripts/audit-dependencies.mjs --check .planning/phases/01-qualify-the-demo-substrate/dependency-audit.json && node --test tests/dependency-audit.test.mjs` | pending |
| 01-02-01 | 01-02 | 2 | CODEC-02, CODEC-03, WEB-01, WEB-03 | tracer integration | `node scripts/audit-dependencies.mjs --check-lock package-lock.json && npm run test:skeleton` | pending |
| 01-02-02 | 01-02 | 2 | CODEC-02, CODEC-03, WEB-01, WEB-03 | build/config | `npm run verify:dependencies && npm run lint && npm run typecheck && npm run test:skeleton && npm run build` | pending |
| 01-03-01 | 01-03 | 3 | WEB-01, WEB-02, WEB-03 | unit/type | `npm run test:unit -- apps/modem-ui/src/audio.test.ts && npm run typecheck` | pending |
| 01-03-02 | 01-03 | 3 | WEB-01, WEB-03, WEB-07 | browser/build | `npm run test:browser -- apps/modem-ui/e2e/audio-preflight.spec.ts && npm run build` | pending |
| 01-04-01 | 01-04 | 3 | CODEC-02, CODEC-03 | tracer integration | `npm run test:unit -- tests/qualification-evidence-tracer.test.ts` | pending |
| 01-04-02 | 01-04 | 3 | CODEC-02, CODEC-03 | unit | `npm run test:unit -- packages/bridge/test/protocol.test.ts packages/bridge/test/report.test.ts` | pending |
| 01-04-03 | 01-04 | 3 | CODEC-02, CODEC-03 | generation/unit | `npm run generate:corpus && npm run generate:corpus -- --check && npm run test:unit -- tests/corpus.test.ts` | pending |
| 01-05-01 | 01-05 | 4 | CODEC-02, CODEC-03 | fixture/unit | `npm run qualify:fixture && npm run test:unit -- apps/modem-ui/src/qualification.test.ts` | pending |
| 01-05-02 | 01-05 | 4 | CODEC-02, CODEC-03, CODEC-04 | gate/unit | `npm run test:unit -- apps/modem-ui/src/qualification.test.ts && npm run qualify:fixture` | pending |
| 01-05-03 | 01-05 | 4 | CODEC-02, CODEC-03, CODEC-04, WEB-07 | browser/build | `npm run test:browser -- apps/modem-ui/e2e/qualification.spec.ts && npm run build && npm run qualify:fixture` | pending |
| 01-06-01 | 01-06 | 4 | DEPLOY-02 | config/unit | `npm run test:compose && npm run test:unit -- tests/tun-preflight.test.ts` | pending |
| 01-06-02 | 01-06 | 4 | DEPLOY-02 | fake lifecycle/unit | `npm run test:unit -- tests/tun-preflight.test.ts && npm run test:compose` | pending |
| 01-07-01 | 01-07 | 5 | all eight phase IDs | **manual-only physical checkpoint** | Complete the seven exact-laptop/open-air/exact-host steps in 01-07; the implemented verifier is run within that physical procedure | pending |

## Wave 0 Requirements

- [ ] `.node-version` and dependency audit created by 01-01.
- [ ] `package.json`, exact lockfile, TypeScript, Vite, Vitest, Playwright, and
      ESLint configuration created by 01-02.
- [ ] Full deterministic command surface created and executed by 01-02.

`wave_0_complete` remains `false` until execution installs the audited lockfile,
creates configuration, and runs the Wave 0 commands.

## Manual-Only Verification

| Task | Behavior | Why Manual |
|------|----------|------------|
| 01-07-01 | One-action real microphone/audio settings on both exact laptops; cold open-air corpus in both directions; intentionally audible profile; real Docker/TUN run on both exact hosts | Requires the actual Chromium policies, microphones, speakers, acoustic room path, Docker engines, and TUN devices |

All deterministic tasks have concrete automated commands. The sole physical
task is explicitly manual-only and follows Plans 01-01 through 01-06.

## Validation Sign-Off

- [x] Exact final plan/task IDs and waves are mapped.
- [x] Every deterministic task has an automated command.
- [x] Only the final physical checkpoint is manual-only.
- [x] No watch-mode flags.
- [x] `nyquist_compliant: true`.
- [x] `wave_0_complete: false` until execution.

**Approval:** plan-complete; execution pending
