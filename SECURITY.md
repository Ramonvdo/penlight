# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub:
[Security → Report a vulnerability](https://github.com/Ramonvdo/penlight/security/advisories/new).
You should normally get a first response within a few days.

Please don't open public issues for security problems.

## Security posture

- **Local-only.** Penlight makes no network calls at runtime: there is no HTTP
  client in the dependency tree, no telemetry, no analytics, and the WebView
  Content-Security-Policy restricts connections to Tauri's internal IPC.
  Two caveats:
  - The **installer** may download the WebView2 Runtime bootstrapper from
    Microsoft on systems that don't have it.
  - There is **no auto-updater** yet — updates are manual via
    [GitHub Releases](https://github.com/Ramonvdo/penlight/releases).
- **Your data stays on your machine.** Settings and whiteboard files live under
  your user's app-data directory and are never transmitted.
- **Input validation at trust boundaries.** Settings payloads and board files
  read from disk are validated/sanitized before they reach native code or the
  renderer.
- **Unsigned installers (for now).** Releases are not yet Authenticode-signed,
  so SmartScreen may warn on first launch. Each release ships a
  `SHA256SUMS.txt` you can verify downloads against; code signing and build
  provenance attestation are planned.
- Penlight installs a low-level mouse hook (`WH_MOUSE_LL`) while cursor
  features are active — this is how the halo/spotlight follow the cursor. It
  observes cursor position and button state only; there is no keylogging.
