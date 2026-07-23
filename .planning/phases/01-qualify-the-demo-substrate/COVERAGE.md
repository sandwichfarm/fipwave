# API Coverage Declaration

No external API integration: Phase 1 uses browser platform APIs and a local codec-neutral WebSocket protocol, not an external service API.

The in-scope interfaces are `MediaDevices.getUserMedia`, `AudioContext`,
`AudioWorklet`, local binary WebSocket messages, filesystem JSON reports,
Docker/TUN commands, hash-locked GitHub raw/codeload downloads, and the official
quiet/libfec release download. None requires an external service account,
credential, webhook, hosted API, or runtime third-party service contract.

Executable codec downloads are supply-chain inputs rather than APIs. Plan
01-07 pins every URL, commit/release, SHA-256, maximum size, and license text;
the production runner consumes only the verified local cache.

The runner also owns `/qualification-config`; machine identity, literal role,
report target, TUN evidence mode/reference, and physical evidence class are
local trust configuration rather than browser- or external-API input.
