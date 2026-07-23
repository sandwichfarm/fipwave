# Spike Manifest

## Idea

Prove the browser modem can cross the real acoustic path on one laptop before
debugging the two-laptop setup: built-in speaker → air → built-in microphone,
with two independent production runner/browser roles.

## Requirements

- Run without operator clicks after launch.
- Use the real default speaker and microphone; do not use fake media, a virtual
  audio device, or a digital loopback.
- Keep the diagnostic evidence non-qualifying (`Loopback`) and isolated from
  the canonical laptop A/B Open-air reports.
- Transmit sequentially in both directions and require receiver-side,
  byte-perfect decode evidence.
- Preserve timestamped browser, runner, configuration, and report evidence for
  failure analysis.

## Spikes

| ID | Name | Type | Validation | Verdict |
|----|------|------|------------|---------|
| 001 | Same-laptop acoustic self-loop | Standard | Given two fresh production roles using the built-in speaker and microphone, when the harness sends A → B and then B → A, each peer independently decodes at least one byte-perfect message. | ⚠ PARTIAL — core path passed; repeatability and one consistently absent corpus case remain open |
