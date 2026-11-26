# Changelog

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
