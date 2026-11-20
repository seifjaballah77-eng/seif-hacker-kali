# SEIF HACKER KALI

Consent-first cross-device pairing starter for Android, iPhone, Windows and Linux.

## Current implementation
- Arabic PWA interface with simulation and pairing sections.
- Temporary 5-minute pairing code and shareable link/QR.
- Host approval required before a pair is marked active.
- Explicit per-feature permission requests.
- WebRTC signaling relay through a small Node.js WebSocket server.
- Optional browser screen capture using the browser's native consent prompt.
- Visible end-session control on the paired screen.

## Important limits — this is not full OS remote control yet
This first repository build is a **pairing and browser-session foundation**, not a finished remote administration suite.
- A web page cannot silently control Windows, Linux, Android or iOS.
- Windows/Linux OS-level input requires a separately installed, signed desktop agent with a visible consent prompt and a kill switch.
- Android device-wide input requires a separately installed Android app and explicit user-enabled Accessibility / screen-capture permissions.
- iOS does not expose general remote touch/input control to ordinary websites or third-party apps. Screen broadcast support depends on iOS APIs and app packaging; general device control is not available.
- Screen capture support varies by browser and OS. HTTPS is required.
- STUN is configured for initial WebRTC connectivity. Some networks require a TURN relay for reliable connections outside the local network.

## Run locally
Requires Node.js 18+.

```bash
npm install
npm start
```
Open http://localhost:3000 on both devices on a trusted network. For internet access, deploy this Node service to a host that supports persistent WebSockets and HTTPS/WSS. GitHub Pages alone cannot host the signaling server.

## Deploy
Deploy the Node app to a Node-compatible host (for example Render or another WebSocket-capable service). Set its start command to `npm start`. Do not put private API keys in frontend files or GitHub.

## Security notes
Pairing codes are random and expire after five minutes if unused. The server keeps room state in memory; restart clears all sessions. Use HTTPS/WSS in production, add rate limiting and persistent abuse controls before public launch. Never expose this service as an unauthenticated remote-control endpoint.

## Roadmap
1. Production-grade authenticated signaling, TURN credentials and abuse controls.
2. Native Windows and Linux companion agents with per-session consent, visible activity indicator and emergency stop.
3. Android companion app with explicit system permission onboarding.
4. iOS-compatible screen broadcast workflow where supported; no general iOS remote input.
5. Encrypted file-transfer workflow with per-transfer approval and size limits.
