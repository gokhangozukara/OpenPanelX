# Contributing to OpenPanelX

Contributions are welcome — bug reports, fixes, translations, plugins, and documentation improvements all help.

## Local development

Requirements: Node.js 24 or newer and Git.

```sh
git clone https://github.com/gokhangozukara/OpenPanelX.git
cd OpenPanelX
npm install
npm run dev
```

Open `http://localhost:3100`.

## Checks before opening a pull request

Run the full local check suite and verify everything passes:

```sh
npm run typecheck
npm test
npm run build
```

## Guidelines

- Keep dependencies minimal. Prefer Node.js built-ins where practical.
- Keep all built-in UI copy translated across `en`, `tr`, and `de` in `src/lib/i18n.ts`.
- Never commit `.env` files, database files, or secrets (`./data` is git-ignored).
- Keep plugin data separation intact: runtime edits must always write to `OPENPANELX_DATA`, never into `plugins/`.
