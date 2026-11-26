# Changelog

## v0.4.3

### Security
- Serialized concurrent sign-in attempts per account in SQLite (`rate_limits.next_at` via `BEGIN IMMEDIATE`), immediately rejecting parallel burst overflow without invoking `scrypt`.
- Added a default hard ceiling of 20 failed attempts per 15 minutes per account when `OPENPANELX_TRUST_PROXY` is unset, while issuing a non-session HMAC-signed `opx_known` cookie to previously authenticated browsers so admins are not locked out on their own device.
- Tightened production `style-src` CSP to `'self' 'nonce-...'` (removing `'unsafe-inline'` in production for both scripts and styles), verified in Playwright E2E including Settings 2FA QR rendering.

## v0.4.2

### Security & Testing
- Separated sign-in throttling into IP-scoped lockouts (when `OPENPANELX_TRUST_PROXY=1`) plus bounded per-account progressive backoff, preventing remote attackers from locking out admin accounts.
- Switched to per-request nonce-based `Content-Security-Policy` via `src/proxy.ts` (`'strict-dynamic'`, removing `'unsafe-inline'` from `script-src`) with nonce propagation to the pre-paint theme script.
- Added automated Playwright browser E2E tests (`npm run test:e2e`) covering setup, dark theme persistence under nonce CSP, search, inline row editing, CSV export with formula escaping, deletion, and user role updates.

## v0.4.1

### Security & Reliability
- Separated session and 2FA pending tokens with an explicit `typ` field and domain-separated HMAC signing.
- Hardened sign-in rate limiting against spoofed `x-forwarded-for` headers (per-username lockouts always enforced; proxy IP headers read only when `OPENPANELX_TRUST_PROXY=1`).
- Made editable plugin table writes atomic (temp file + rename) and serialized via SQLite `BEGIN IMMEDIATE` transactions.
- Added `Content-Security-Policy` and production `Strict-Transport-Security` (HSTS) headers.
- Extracted testable API handlers (`src/lib/api-handlers.ts`) and added API authorization, CSRF, validation, and 404/409 tests plus an end-to-end HTTP smoke check (`npm run smoke`).

## v0.4.0

### Added
- Inline row editing (`Edit`, `Save`, `Cancel`) on editable plugin tables.
- Live search filter and safe UTF-8 CSV export (with formula-injection escaping) on plugin tables.
- Inline user role updates (`viewer`, `editor`, `admin`) on the Users page.
- Authenticated JSON API routes:
  - `GET /api/health`
  - `GET /api/plugins`
  - `GET /api/plugins/[id]`
  - `GET / POST / PATCH / DELETE /api/plugins/[id]/tables/[index]`
- Persistent SQLite rate limiting (`rate_limits` table) that survives server restarts.
- Session invalidation via `session_version` on password change, role update, and 2FA reset.
- Security response headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- Standalone Next.js output, `Dockerfile`, `.dockerignore`, and `docker-compose.yml`.
- Automated test suite (`npm test` via `node:test`) and GitHub Actions CI workflow.
- `CONTRIBUTING.md`, `SECURITY.md`, and dashboard screenshots.

## v0.3.0

- Initial public release with first-run setup, roles (`admin`, `editor`, `viewer`), TOTP 2FA with recovery codes, folder-based plugins, EN/TR/DE translations, and light/dark themes.
