# Spike Conventions

## Physical audio

- “Self-loop” means speaker → air → microphone. It never means the installed
  virtual `Loopback Audio` device or a browser fake-media source.
- A diagnostic self-loop always uses `Loopback` evidence class. It can prove a
  local acoustic codec path, but it cannot qualify the two-host Open-air demo.
- Each role gets a fresh port, machine ID, and canonical report path. Diagnostic
  runs must not touch `laptop-a.json` or `laptop-b.json`.

## Automation

- Browser microphone permission, modem arming, codec fallback, transmission,
  evidence collection, and cleanup must all be automated.
- A sender-side “sent” state is not success. Success requires the peer report
  to show an observed, complete, byte-perfect result with matching digest and
  no missing, duplicate, or corrupt fragments.
- A → B and B → A are transmitted sequentially from matching epochs.
