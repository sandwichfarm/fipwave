# API Coverage Declaration

No external API integration: Phase 1 uses browser platform APIs and a local codec-neutral WebSocket protocol, not an external service API.

The in-scope interfaces are `MediaDevices.getUserMedia`, `AudioContext`,
`AudioWorklet`, local binary WebSocket messages, filesystem JSON reports, and
Docker/TUN commands. None requires an external service account, credential,
webhook, hosted API, or third-party service contract.
