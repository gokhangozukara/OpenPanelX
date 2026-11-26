# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in OpenPanelX, please report it privately instead of opening a public issue:

- **Email:** [gokhangozukara@gmail.com](mailto:gokhangozukara@gmail.com)

Please include steps to reproduce, the affected version, and any relevant details. You will receive an acknowledgement as soon as possible.

## Security model notes

- Passwords are hashed with Node.js `scrypt` and unique per-user salts.
- Session and pending-2FA cookies carry distinct `typ` claims (`session` vs. `pending`), domain-separated HMAC-SHA256 signatures, `HttpOnly`, `SameSite=Lax`, and `Secure` in production by default.
- Changing a password, changing a user's role, or resetting 2FA increments `session_version` so older sessions are invalidated immediately.
- TOTP secrets are encrypted at rest with AES-256-GCM; recovery codes are stored only as SHA-256 hashes.
- Sign-in throttling is persisted in SQLite (`rate_limits` table) across server restarts:
  - Concurrent sign-in attempts for the same account are serialized via SQLite time-slot reservation (`next_at` inside `BEGIN IMMEDIATE`), rejecting parallel floods immediately without calling `scrypt`.
  - When `OPENPANELX_TRUST_PROXY=1` is set behind a trusted reverse proxy, offending client IPs are hard-blocked (5 failures per IP+account, 20 per IP in 15 minutes) without locking out legitimate admins on other IPs.
  - When running directly without a proxy, unknown browsers hit a hard ceiling of 20 failures per 15 minutes per account, while previously signed-in browsers carry a non-session HMAC-signed `opx_known` cookie so admins are not locked out of their own device. Note that in direct (non-proxy) mode, 20 failed attempts can temporarily block sign-in from a brand-new unrecognized browser for 15 minutes; enable `OPENPANELX_TRUST_PROXY=1` behind your reverse proxy to isolate lockouts strictly per IP.
  - The `rate_limits` table is bounded to 5,000 active rows (evicting lowest-count entries first) so random-username spraying cannot grow the database unboundedly.
- Responses include a per-request nonce-based `Content-Security-Policy` (`script-src 'self' 'nonce-...' 'strict-dynamic'`, `style-src 'self' 'nonce-...'` in production, `script-src-attr 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` (HSTS) in production HTTPS mode.
- Always deploy OpenPanelX behind HTTPS in production.
