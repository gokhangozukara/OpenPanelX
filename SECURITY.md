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
- Failed sign-in and 2FA rate limits are persisted in SQLite (`rate_limits` table) across server restarts. Sign-in throttling keys by normalized username and only reads `X-Forwarded-For` / `X-Real-IP` when `OPENPANELX_TRUST_PROXY=1`.
- Responses include `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` (HSTS) in production HTTPS mode.
- Always deploy OpenPanelX behind HTTPS in production.
