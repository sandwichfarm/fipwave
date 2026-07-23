# Pitfalls Research

**Domain:** Browser-mediated acoustic networking as a FIPS transport
**Researched:** 2026-07-23
**Confidence:** HIGH for browser, Docker, and FIPS behavior; MEDIUM for acoustic thresholds, which must be calibrated on the demo hardware and in the room

## Critical Pitfalls

### Pitfall 1: Speech enhancement destroys the modem waveform

**What goes wrong:**
The receiver detects a preamble in a quiet bench test but loses symbols, clips the first part of a burst, or sees gain pumping during the real exchange. Browser or OS processing classifies steady tones and multi-tone signals as echo/background noise. Echo cancellation is especially dangerous because the desired remote signal resembles locally generated speaker output; noise suppression can erase narrow-band carriers; AGC moves decision thresholds inside a frame. macOS Voice Isolation adds another system-level filter.

**Why it happens:**
`getUserMedia({audio: true})` is optimized for speech. The Media Capture specification notes that implementations tend to default `echoCancellation` to `true`, and explicitly provides `echoCancellation`, `noiseSuppression`, and `autoGainControl` controls because processing can introduce unwanted artifacts.

**How to avoid:**
- Request exact constraints: `echoCancellation: {exact:false}`, `noiseSuppression: {exact:false}`, and `autoGainControl: {exact:false}`. If exact constraints fail, stop with a diagnostic rather than silently accepting speech mode.
- Immediately inspect and display `track.getSettings()`; the requested constraints are not proof of the applied settings.
- On macOS, select Standard or Wide Spectrum if Mic Modes are offered; never Voice Isolation.
- Use fixed speaker and microphone levels established during calibration. Include a preamble long enough for the physical input path to settle, but exclude it from payload timing.
- Record a short raw receive trace and expose peak/RMS, clipping count, correlation peak, and per-frame CRC status.

**Warning signs:**
The received tone envelope fades after 100–500 ms; later symbols are weaker than the preamble; received amplitude changes while transmitted amplitude is constant; decoding improves with headphones or when the local speaker is muted; `getSettings()` reports any processing enabled.

**Phase to address:**
Phase 1 — Browser audio bring-up and one-way acoustic framing. This is a hard gate before FIPS integration.

---

### Pitfall 2: “Full duplex” becomes self-jamming

**What goes wrong:**
Each laptop's speaker overwhelms its own nearby microphone while the peer is transmitting. Both nodes respond or retransmit together, causing repeated collisions. A codec that works one-way becomes unstable when handshake, heartbeats, and ping replies share the channel.

**Why it happens:**
Laptop acoustic isolation is poor and disabling echo cancellation is necessary to preserve modem tones. True simultaneous duplex therefore requires an echo canceller tailored to the modem waveform, which is far beyond a one-day proof of concept.

**How to avoid:**
- Implement bidirectional service over a **half-duplex acoustic medium**, not simultaneous sound: only one node emits at a time.
- Give peers deterministic roles. The initiator sends first; the responder transmits only after a decoded frame plus a fixed turnaround guard. Add randomized/capped retry backoff after missing ACKs.
- Suppress or ignore receive samples during local playback and for a measured post-playback ring-down interval; do not feed local leakage into the decoder.
- Queue complete FIPS packets and serialize link fragments. Prioritize ACK/control/heartbeat frames above ping data.
- Instrument TX/RX state, collision count, queue depth, retry count, and time since last valid peer frame.

**Warning signs:**
CRC failures occur only when both sides are enabled; the local microphone shows a much larger signal during local TX than remote TX; both nodes repeatedly enter TX within the same guard window; queue depth grows while valid-frame rate falls.

**Phase to address:**
Phase 2 — Bidirectional acoustic link protocol, before connecting live FIPS timers.

---

### Pitfall 3: Airtime exceeds FIPS's liveness budget

**What goes wrong:**
Handshake occasionally completes, but the peer flaps or is declared dead under load. A long ping or retransmitted packet blocks heartbeat delivery. The current FIPS defaults are a 10-second heartbeat interval, a 30-second link-dead timeout, and a 30-second handshake timeout. Treating those as generous application timeouts ignores queueing, half-duplex turnaround, and retries.

**Why it happens:**
A 114-byte handshake is already about 3.0 seconds at 300 raw bit/s before preamble, coding, guards, and retransmission. A 1280-byte packet is about 34 seconds raw at that rate. A single monolithic acoustic frame can therefore consume the entire dead-peer window.

**How to avoid:**
- Measure airtime from first preamble sample to validated payload delivery; calculate worst case including one retransmission in each direction.
- Use small link-layer fragments (start around 32–64 payload bytes) with packet ID, fragment index/count, length, CRC, duplicate suppression, bounded reassembly, and ACK/retry below FIPS. Deliver to FIPS only after the complete original transport packet is reassembled.
- Schedule link-control traffic ahead of data. Keep maximum uninterrupted TX burst short enough that the other peer gets a response opportunity.
- For the demo profile, temporarily relax FIPS heartbeat/dead/handshake timers only after measuring the link. Preserve at least a 3× margin between worst observed valid-frame gap and `link_dead_timeout_secs`.
- Never claim a smaller FIPS transport MTU unless the full IPv6/FIPS path accepts it. IPv6 links are expected to support a 1280-byte MTU; the safe demo approach is an advertised FIPS packet MTU compatible with its stack and fragmentation beneath the transport boundary.

**Warning signs:**
Peer state drops at roughly 30-second intervals; heartbeats are queued behind data; handshake retransmissions overlap acoustic frames; `drop_mtu_exceeded_packets` rises; small pings work but default or larger pings do not.

**Phase to address:**
Phase 3 — FIPS transport integration and timing-budget validation.

---

### Pitfall 4: Packet boundaries, corruption, and retries leak across the transport boundary

**What goes wrong:**
FIPS receives partial, concatenated, duplicated, or stale packets. One lost acoustic fragment poisons the next packet, or a retransmitted packet is delivered twice. Encryption makes corrupted payloads appear as opaque handshake/session failure rather than an obvious link CRC error.

**Why it happens:**
Developers conflate four boundaries: WebSocket messages, FIPS transport packets, acoustic fragments, and audio sample blocks. TCP/WebSocket reliability covers only browser-to-container, not the acoustic hop. A checksum on the whole packet alone forces expensive whole-packet retransmission.

**How to avoid:**
- Preserve one complete FIPS transport packet per binary WebSocket message. Reject text messages and oversized messages.
- Define an explicit acoustic header with version, direction/session nonce, packet ID, fragment index/count, payload length, and CRC. Bound every declared length before allocation.
- Use per-fragment CRC and whole-packet validation, duplicate suppression, finite retry count, and reassembly expiry. Reset decoder state after a failed frame; resynchronize only on a fresh preamble/sync word.
- Keep packet IDs scoped to a freshly randomized link-session nonce so browser refreshes cannot revive stale fragments.
- Log a single trace ID through FIPS packet → WebSocket message → fragments → reassembled packet.

**Warning signs:**
Decoded fragment CRCs pass but FIPS authentication fails; received packet lengths differ from sent lengths; browser refresh makes the peer recover; one noise burst breaks every subsequent frame; duplicate packet counters rise.

**Phase to address:**
Phase 2 for framing/reliability; Phase 3 for the exact FIPS packet contract.

---

### Pitfall 5: Browser audio is armed in the UI but not actually running

**What goes wrong:**
The page says “connected” while `AudioContext` is suspended, microphone permission is absent, the wrong input device is selected, or capture ended after a device change. A page opened as `http://<laptop-LAN-IP>` may not have `navigator.mediaDevices` because microphone capture requires a secure context. Reloading before a stage demo can re-trigger both autoplay and permission behavior.

**Why it happens:**
Chrome's Web Audio autoplay policy can create an `AudioContext` in `suspended` state until user activation. `getUserMedia()` is restricted to secure contexts; `localhost` is normally trustworthy, arbitrary HTTP LAN origins are not. Permission state and device IDs vary by browser profile and machine.

**How to avoid:**
- Serve the control page from `http://localhost:<published-port>` on each laptop or use HTTPS; do not serve it from an insecure LAN address.
- Put context creation/resume and microphone acquisition behind one explicit **Arm audio** click. Await `audioContext.resume()` and require `state === "running"`.
- Display context state, capture `readyState`, applied track settings, sample rate, selected device label, live input meter, output test result, and bridge state. Listen for `statechange`, `mute`, `unmute`, and `ended`.
- Use `AudioWorklet`, not main-thread timers, for sample-accurate modulation/demodulation. Derive coefficients and symbol lengths from actual `audioContext.sampleRate`; the Web Audio default follows the output device and is not guaranteed to be 48 kHz.
- Keep both browser tabs foreground and prevent laptop sleep, screen lock, Bluetooth device switching, and notification sounds during the demo.

**Warning signs:**
`AudioContext.state` is `suspended`; meter is flat despite permission; `navigator.mediaDevices` is undefined; sample rate differs between laptops; worklet messages stop when the tab is backgrounded; output test is visible but inaudible.

**Phase to address:**
Phase 1 — Browser audio bring-up; revalidated in Phase 5 rehearsal.

---

### Pitfall 6: Docker Desktop is mistaken for native host networking

**What goes wrong:**
The WebSocket bridge works, but host-level IPv6 ping cannot reach the FIPS TUN address, or TUN creation fails. On macOS, Linux containers run inside Docker Desktop's VM: there is no host-visible `docker0`, the host cannot directly route to Linux container addresses, and Docker Desktop host networking is layer-4 TCP/UDP rather than direct access to host interfaces.

**Why it happens:**
`--network=host` means native namespace sharing on Linux, but on Docker Desktop it is an opt-in layer-4 facility with explicit limitations. Root inside a container is not root on macOS. Creating/configuring a TUN interface requires Linux network capability and device availability inside the Docker VM/container.

**How to avoid:**
- Decide the proof boundary explicitly: run the real kernel `ping -6` **inside the FIPS container/network namespace** unless a separately tested host-route solution is implemented. Do not promise macOS host `ping` to a container TUN address.
- Grant only what is needed (`cap_add: [NET_ADMIN]` and the TUN device if required), then assert at startup that `/dev/net/tun` exists, the TUN is UP, has the expected IPv6 address/MTU, and routes point to it.
- Publish the browser bridge on a fixed loopback port (`127.0.0.1:PORT:PORT`) and browse via localhost. Do not depend on container IP addresses.
- Keep the macOS and native-Linux Compose paths explicit. On Linux, verify host routing and firewall separately; do not infer it from macOS behavior.
- Test with the receiver's Wi-Fi/network service disabled only **after** images are built and dependencies cached.

**Warning signs:**
`ip tuntap` or route setup returns `Operation not permitted`; `/dev/net/tun` is absent; `ping` succeeds in-container but not from macOS; bridge works at localhost but not at a container IP; disabling Wi-Fi breaks image startup rather than the acoustic link.

**Phase to address:**
Phase 3 — Container/TUN plumbing, before two-laptop acoustic integration.

---

### Pitfall 7: Room acoustics turn a bench success into a stage failure

**What goes wrong:**
Multipath smears symbols, HVAC or speech masks carriers, automatic level changes clip the preamble, and moving/opening laptop lids changes the channel. Near-ultrasonic frequencies that worked on one machine are attenuated by another machine's speakers/microphones.

**Why it happens:**
Laptop transducers, room response, speaker/microphone orientation, distance, and background noise vary more than the digital implementation. Narrow “magic” thresholds learned from one desk overfit that setup.

**How to avoid:**
- Make audible mode the only release gate. Treat near-ultrasonic mode as a post-success experiment.
- Add a 10–15 second calibration that sweeps candidate carriers, measures noise floor/SNR and clipping, then chooses from a small known-good audible profile. Freeze the chosen profile for the run.
- Use preamble correlation, guard intervals, CRC, and conservative symbol duration. Prefer robust low-order modulation over nominal throughput.
- Mark laptop positions and lid angles; use 0.5–1.5 m line-of-sight as the initial operating envelope; fix system volume and input level; silence notifications.
- Rehearse in the actual room or a noisier approximation. Record calibration metrics so “room noise” is measurable rather than anecdotal.

**Warning signs:**
Correlation peak is less than 2× the next false peak; calibration SNR is below 12 dB; clipping exceeds 0.1% of samples; CRC success changes sharply with a 20 cm movement; only the near-ultrasonic profile works.

**Phase to address:**
Phase 1 establishes the envelope; Phase 5 validates it in stage conditions.

---

### Pitfall 8: A single lucky ping is confused with a rehearsable demo

**What goes wrong:**
The end-to-end path works once after manual interventions, but fails after a cold start, browser refresh, permission reset, Wi-Fi isolation, or peer reconnect. Operators cannot tell whether the fault is audio, bridge, FIPS peering, routing, or TUN.

**Why it happens:**
The visible success criterion is one ping, so setup state and recovery paths remain implicit. Multiple terminals and two machines magnify sequencing mistakes.

**How to avoid:**
- Provide one role-specific launch command per laptop and one browser **Arm audio** action. Prebuild images and pin browser/profile, ports, FIPS identities, audible profile, and machine roles.
- Create a preflight that reports red/green for Docker, bridge, TUN, route, browser context, mic settings, acoustic calibration, FIPS peer state, and receiver isolation.
- Show counters at every boundary. Operators need to distinguish “no sound decoded,” “packet not bridged,” “peer not established,” and “route missing” within seconds.
- Supply a 60-second recovery drill: stop TX, reload both pages, arm responder then initiator, wait for peer green, retry ping. Avoid live code/config edits.
- Run cold-start rehearsals with the exact two laptops, power state, room positioning, and receiver isolation.

**Warning signs:**
Success depends on command history; setup requires copying dynamic addresses; either operator cannot recover without developer tools; stale peer state remains after refresh; only one of several consecutive pings returns.

**Phase to address:**
Phase 5 — Demo hardening and rehearsal. It must not be deferred to “presentation polish.”

## Go/No-Go Thresholds

These are recommended engineering gates for this one-day demo, not universal modem standards.

| Gate | GO | NO-GO / fallback |
|------|----|------------------|
| Browser audio integrity | `AudioContext` running; track live; echo cancellation, noise suppression, and AGC all reported false; no clipping during calibration | Any processing remains enabled or applied settings are unknown; stop and use a supported Chromium/profile/device |
| One-way acoustic frame | At least 99/100 valid transmissions of the largest mandatory control frame at fixed stage geometry; measured SNR ≥12 dB; clipping <0.1% | Reduce bitrate/increase symbol duration; move laptops closer; remain audible |
| Bidirectional link | 50 alternating frames each way with ≥95% first-attempt success and 100% success within bounded retries; no simultaneous-TX livelock | Enforce stricter turn-taking and larger guard; do not attempt true full duplex |
| Airtime/timers | Worst observed gap between valid peer frames, including one retry, is <⅓ configured link-dead timeout; heartbeat never waits behind a full data backlog | Increase timeout and/or reduce fragment airtime; prioritize control; shrink ping payload |
| FIPS peering | Cold peer establishment succeeds 5/5 times and remains established for 5 minutes while heartbeats traverse sound | Do not proceed to routing; inspect boundary counters and handshake airtime |
| IPv6 proof | 10 consecutive real `ping -6` request/reply exchanges from the declared OS namespace with receiver network isolation enabled; zero non-acoustic alternate FIPS transports | Demonstrate from the container namespace explicitly; remove hidden routes/transports; never substitute an application echo |
| Rehearsal | Three complete cold-start runs in a row, each ≤5 minutes setup and ≥9/10 ping replies, plus one successful 60-second recovery drill | Freeze features, abandon near-ultrasonic/visual polish, simplify launch and acoustic profile |

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Half-duplex turn-taking | Avoids modem echo cancellation and collision complexity | Lower throughput; explicit MAC state required | Recommended for this proof of concept |
| Relaxed FIPS heartbeat/dead timers | Tolerates slow acoustic airtime | Masks stalls and makes failure detection slower | Demo profile only, with measured 3× timing margin |
| Stop-and-wait fragment ACKs | Very simple reliability logic | Low utilization and head-of-line blocking | Acceptable at one peer and ping-scale traffic |
| Hard-coded audible carrier profile | Saves adaptive-modem work | Fragile across rooms/hardware | Only after calibration validates both exact laptops; retain a fallback profile |
| Reporting 1280-byte transport MTU while fragmenting below FIPS | Preserves IPv6/FIPS expectations | Link layer must safely bound reassembly and retries | Acceptable and preferable for the demo |
| Using `--privileged` | Makes TUN experiments start quickly | Hides missing capability/device assumptions and broadens access | Temporary diagnosis only; final Compose should use `NET_ADMIN` plus required device |
| Main-thread audio processing | Faster initial JavaScript prototype | Glitches under layout, logging, and tab scheduling | Synthetic/offline tests only; live path should use AudioWorklet |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Browser → container WebSocket | Connecting to a container IP or exposing an unbounded/public bridge | Publish a fixed loopback port, use binary messages, enforce maximum packet size and one FIPS packet per message |
| AudioWorklet → UI/bridge | Moving every sample block through the main thread | Decode/encode in the worklet; send only frames and coarse telemetry across its message port |
| FIPS → acoustic transport | Returning send success when data is merely queued forever | Bound the queue, expose backpressure/failure, prioritize control traffic, and measure queue wait |
| Acoustic fragments → FIPS | Passing fragments upward or silently truncating oversize packets | Reassemble and validate the exact original packet before delivery; reject with a visible counter |
| Docker → TUN | Assuming container root is sufficient | Verify `/dev/net/tun`, add `NET_ADMIN`, create/raise/configure interface, then assert route and MTU |
| macOS host → container | Assuming Docker bridge/container IPv6 is host-routable | Run ping inside the container namespace or build and separately validate an explicit host routing mechanism |
| Receiver isolation | Turning off Wi-Fi before images/config are available, or leaving an alternate FIPS transport active | Pre-cache everything, then disable external network and assert sound is the receiver's only active FIPS transport |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| One acoustic frame per FIPS packet | Long lockout, whole-packet retries, heartbeat starvation | Fragment into short independently checked bursts | At 300 bit/s, 114 raw bytes already take ~3 s; 1280 raw bytes take ~34 s before overhead |
| Unbounded WebSocket/audio/FIPS queues | Ping replies arrive after peer timeout; memory and latency climb | Small bounded queues, control priority, drop/reject counters, `bufferedAmount`/depth telemetry | As soon as arrival rate exceeds acoustic service rate for more than a few packets |
| Excessive logging on the audio/UI thread | Pops, worklet underruns, false CRC failures | Aggregate telemetry and rate-limit rendering/logging | During burst decode or when DevTools is open |
| Very short symbols | Great quiet-room throughput, high stage error rate | Choose rate from measured SNR/multipath and require 100-frame gate | With speech/HVAC, movement, or modest reflections |
| Overlong guards/preambles | Reliability looks high but FIPS liveness fails | Include all overhead in airtime budget and tune against measured correlation | When bidirectional retry plus queue wait approaches one-third of dead timeout |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Publishing the local bridge on `0.0.0.0` with no origin check | Other LAN pages/hosts can inject or observe transport packets | Bind to loopback, validate `Origin`, limit message size/rate, and accept one local controller |
| Trusting acoustic length/count fields | Malformed/noisy frames cause oversized allocation or stuck reassembly | Authenticate at FIPS and independently bound fragment count, payload length, concurrent assemblies, and expiry |
| Treating CRC as authenticity | Nearby audio can inject/replay link fragments | CRC is only error detection; retain FIPS encryption/authentication and use a fresh acoustic session nonce |
| Leaving diagnostic alternate transports enabled | “Acoustic” ping may silently route over Wi-Fi/UDP | Disable receiver alternatives and show active transport/path counters during proof |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| “Connected” means only WebSocket connected | Operator starts ping before audio or FIPS is ready | Separate indicators for bridge, audio running, mic processing, acoustic frames, FIPS peer, and route |
| Hidden permission/autoplay failures | Silent stage failure with no recovery cue | One Arm button, explicit error text, live meters, and a retry action |
| Raw log wall | Cannot isolate a fault under time pressure | Red/amber/green preflight plus counters and last-error reason at each boundary |
| Adaptive settings changing mid-demo | A previously calibrated link suddenly degrades | Calibrate, display, then freeze profile and levels for the run |
| Audible link with no TX indication | Audience/operator mistakes modem noise for feedback | Clear local TX/RX indicator and role label without adding visualization scope before reliability |

## "Looks Done But Isn't" Checklist

- [ ] **Audio capture:** Constraints were requested — verify applied `getSettings()`, live meter, context state, actual sample rate, and macOS Mic Mode.
- [ ] **Acoustic codec:** A payload decoded once — verify 100-frame error rate, CRC rejection, resynchronization after noise, clipping, and both directions on both laptops.
- [ ] **Duplex:** Both nodes can transmit — verify deterministic half-duplex ownership, turnaround guard, collision recovery, and bounded retries.
- [ ] **FIPS adapter:** Peer appears connected — verify handshake and heartbeat packets actually traverse acoustic counters and survive for five minutes.
- [ ] **MTU:** Small ping works — verify default chosen ping size, oversize rejection/fragmentation, reassembly expiry, and zero FIPS MTU-drop counters.
- [ ] **Docker/TUN:** Interface exists — verify UP state, IPv6 address, MTU, route, `NET_ADMIN`, and the exact namespace from which `ping -6` runs.
- [ ] **Isolation:** Wi-Fi icon is off — verify no alternate FIPS transport or hidden route and show acoustic TX/RX counters increasing for every request/reply.
- [ ] **Browser bridge:** UI is connected — verify binary packet boundaries, loopback binding, bounded queue, reconnect behavior, and browser refresh recovery.
- [ ] **Demo:** One ping returned — verify ten consecutive pings, three cold starts, stage geometry/noise, and the 60-second recovery drill.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Speech processing remains enabled | LOW | Stop, reacquire with exact false constraints, set macOS Standard/Wide Spectrum, verify settings before resuming |
| High acoustic error rate | LOW | Silence notifications, restore marked geometry/levels, recalibrate, lower bitrate, increase symbol/guard duration, use audible fallback |
| TX collision/livelock | MEDIUM | Stop both transmitters, clear link queues, re-arm responder then initiator, enlarge guard/backoff |
| FIPS peer flaps | MEDIUM | Stop ping load, inspect acoustic queue and heartbeat timing, increase demo timer margin, reconnect peer |
| Stuck fragment reassembly | LOW | Expire all assemblies, rotate acoustic session nonce, restart from preamble; never restart FIPS first unless packet boundary counters implicate it |
| TUN/routing failure | MEDIUM | Run container preflight, recreate with required capability/device, restore known Compose profile, verify route before audio |
| Browser permission/autoplay failure | LOW | Reload localhost page, click Arm audio, grant mic, confirm running/live state and meters |
| Full demo fails after cold start | HIGH | Use the rehearsed reset sequence only; abandon ultrasonic/polish, restore pinned audible profile and exact machine roles |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Speech DSP destroys waveform | Phase 1: browser audio + one-way codec | Applied settings all false and 99/100 largest mandatory control frames decode |
| Browser not actually armed | Phase 1 | Cold/reload test reports running context, live track, correct sample rate, input and output meters |
| Room/hardware fragility | Phase 1, re-gated Phase 5 | Calibration thresholds pass at marked stage geometry and noisier-than-expected conditions |
| Self-jamming/collisions | Phase 2: half-duplex link | 50 alternating frames each way; ≥95% first attempt; no livelock |
| Boundary/corruption/retry errors | Phase 2 | Noise, duplicate, loss, reorder, refresh, and stale-session tests never deliver malformed/duplicate FIPS packets |
| FIPS airtime/liveness mismatch | Phase 3: FIPS adapter | Five-minute peering; worst valid-frame gap <⅓ dead timeout; heartbeat priority observed |
| Docker Desktop/TUN misconception | Phase 3 | Startup preflight and 10 local namespace IPv6 pings before acoustic substitution |
| Hidden alternate path | Phase 4: isolated two-laptop E2E | Receiver external network disabled, only sound transport active, counters correlate with each ping direction |
| Lucky demo/non-rehearsability | Phase 5: hardening | Three cold-start demos plus one 60-second recovery drill |

## Sources

- [W3C Media Capture and Streams — constraints, applied settings, and audio processing controls](https://www.w3.org/TR/mediacapture-streams/) — HIGH confidence, current Recommendation (2025).
- [W3C Web Audio API 1.1 — sample rate, latency, AudioWorklet, render quanta, and underruns](https://www.w3.org/TR/webaudio-1.1/) — HIGH confidence.
- [Chrome for Developers — Web Audio autoplay policy and `AudioContext.resume()`](https://developer.chrome.com/blog/web-audio-autoplay) — HIGH confidence for Chromium behavior.
- [MDN `getUserMedia()` — secure-context and permission requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) — MEDIUM-HIGH confidence; summary of web-platform behavior.
- [Apple Support — Mic Modes: Voice Isolation, Wide Spectrum, and Standard](https://support.apple.com/guide/mac-help/use-mic-modes-on-your-mac-mchle82b42f0/mac) — HIGH confidence for macOS behavior.
- [Docker Docs — Docker Desktop networking and host/container routing limitations](https://docs.docker.com/desktop/features/networking/networking-how-tos/) — HIGH confidence, current docs.
- [Docker Docs — host networking support and layer-4 limitations on Docker Desktop](https://docs.docker.com/engine/network/drivers/host/) — HIGH confidence, current docs.
- [Docker Docs — container capabilities and `NET_ADMIN`](https://docs.docker.com/engine/containers/run/) — HIGH confidence.
- [Docker Docs — port publishing and loopback binding](https://docs.docker.com/engine/network/port-publishing/) — HIGH confidence.
- [FIPS source at researched revision — heartbeat 10 s, dead timeout 30 s, handshake timeout 30 s, idle session 90 s](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/config/node.rs) — HIGH confidence for revision `fc8ebd5`.
- [FIPS source at researched revision — UDP default MTU 1280](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/config/transport.rs) — HIGH confidence for revision `fc8ebd5`.
- [RFC 8200 — IPv6 minimum link MTU and source fragmentation](https://www.rfc-editor.org/rfc/rfc8200.html#section-5) — HIGH confidence.

---
*Pitfalls research for: FIPS over Sound*
*Researched: 2026-07-23*
