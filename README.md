# OpenPanelX

A small, clean admin panel. Sign-in, roles and plugins work out of the box.

- **Sign-in and roles built in.** First visit creates the first admin. Roles: admin, editor, viewer.
- **Two-step sign-in (2FA).** Optional per person, in Settings. Works with any authenticator app (Google Authenticator, Authy, 1Password…). Scan a QR code, confirm a code, and you get 8 one-time recovery codes. Used codes cannot be replayed, and wrong guesses are rate-limited. An admin can reset 2FA for someone who lost their phone (Users page).
- **Plugins are folders.** Drop a folder with a `plugin.json` into `plugins/`. It appears in the menu. No code, no rebuild.
- **English, Turkish, German.** Light and dark theme.
- **One dependency-light stack.** Next.js, Tailwind, and Node's built-in SQLite. No database server.

## Run it

Needs Node.js 24 or newer.

```sh
npm install
npm run build
node .next/standalone/server.js   # or: npm run dev
```

Open http://localhost:3100 (dev) and create your admin account.
For plain-http local testing of a production build, set `OPENPANELX_INSECURE=1`.
Behind HTTPS, leave it unset so session cookies are marked `Secure`.

Your data lives in `./data` (SQLite file and a generated signing secret). Back that folder up. Never commit it.

## Write a plugin

Create `plugins/my-plugin/plugin.json`:

```json
{
  "name": { "en": "My plugin", "tr": "Eklentim", "de": "Mein Plugin" },
  "icon": "list",
  "minRole": "viewer",
  "sections": [
    { "type": "stats", "items": [{ "label": "Open tasks", "value": 7 }] },
    {
      "type": "table",
      "title": "Tasks",
      "columns": [{ "key": "title", "label": "Title" }],
      "file": "data.json"
    },
    { "type": "text", "title": "About", "body": "Anything you like." }
  ]
}
```

- Folder names: lowercase letters, numbers and dashes.
- `name`, `title`, `label`, `body` can be plain text or `{ "en": "", "tr": "", "de": "" }`.
- `minRole`: `viewer`, `editor` or `admin`. People below it do not see the plugin.
- Section types: `stats`, `table`, `text`. A table reads rows from `rows` or from a JSON file inside the plugin folder.
- A table cell can also be text per language, e.g. `{ "en": "Done", "tr": "Bitti", "de": "Erledigt" }`. Text you type into an editable table is shown as typed, in every language.
- Add `"editable": true` to a table and editors and admins can add and delete rows. Edits are stored in `data/plugins/`, never inside the plugin folder, so updating a plugin never erases what people entered. Limits: 1000 rows, 500 characters per cell.
- Live server numbers for stats: `"source": "@system.uptime"`, `@system.memory`, `@system.cpus`, `@system.load`, `@system.host`.
- Icons: `dashboard`, `users`, `settings`, `puzzle`, `notebook`, `activity`, `server`, `list`.

A broken plugin is skipped; it can never take the panel down.

## Status

Early (v0.3). Tables can be edited (add and delete); stats and text are read-only. Editing existing rows, an API and more section types are next.

Security notes: passwords are hashed with scrypt; sessions are signed, expire after 7 days and are re-checked against the database on every request; authenticator secrets are stored encrypted. Failed-attempt limits are kept in memory, so they reset when the server restarts. Put the panel behind HTTPS.

## License

MIT. Created by Gokhan Gozukara.
