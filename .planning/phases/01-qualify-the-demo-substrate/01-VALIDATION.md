---
phase: 01
slug: qualify-the-demo-substrate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-23
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + Playwright |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` — Wave 0 installs |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm run check` |
| **Estimated runtime** | ~90 seconds without hardware qualification |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit`
- **After every plan wave:** Run `npm run check`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | WEB-01, WEB-02, WEB-03 | T-01-01 | Browser exposes actual settings and never reports readiness on incompatible capture | unit + browser | `npm run test:unit && npm run test:browser` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | CODEC-02, CODEC-03 | T-01-02 | Declared binary lengths, epochs, and queue bounds are enforced before codec input | unit + integration | `npm run test:unit && npm run qualify:fixture` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | CODEC-02, CODEC-03, CODEC-04 | T-01-03 | Qualification cannot pass missing, corrupt, or duplicate corpus cases | fixture + manual | `npm run qualify:fixture` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | WEB-07 | — | Identical production browser artifact and report schema run on both laptops | build + manual | `npm run build` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 1 | DEPLOY-02 | T-01-04 | Container receives only NET_ADMIN and TUN, never privileged or host-wide bridge access | config + container | `npm run test:compose` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — pinned test, build, lint, typecheck, fixture, and Compose checks
- [ ] `vitest.config.ts` — Node and browser-logic unit tests
- [ ] `playwright.config.ts` — deterministic browser-state tests without physical audio
- [ ] `tests/fixtures/` — deterministic corpus and PCM/result fixtures
- [ ] `tests/helpers/` — fake media settings, WebSocket frames, and qualification reports

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| One action arms real Chromium mic/playback and reports mono 48 kHz with processing disabled on both exact laptops | WEB-01, WEB-02, WEB-03, WEB-07 | Browser/device policy and audio hardware cannot be faithfully virtualized | Open the production build on each laptop, click `Arm modem`, and save each passing machine report |
| Cyrinx or the audible fallback cold-acquires and delivers the unique corpus exactly once in both acoustic directions | CODEC-02, CODEC-03, CODEC-04 | Requires the exact speakers, microphones, room path, and bidirectional placement | Run `npm run qualify -- --role a` and `--role b`, transmit 20×256 B plus 5×1536 B each way, and attach merged `selection.json` |
| Docker/TUN preflight succeeds on each exact host | DEPLOY-02 | Docker Desktop and Linux Engine expose TUN differently | Run `docker compose -f compose.preflight.yml run --rm tun-preflight`, then save the report and `docker inspect` capability output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
