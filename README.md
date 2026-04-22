# Bonaparte

Strategic AI tooling for Vitus. Express web app + Slack bot + scheduled background jobs, talking to HubSpot, Slack, and Anthropic via MCP connectors.

## Run in dev

```bash
npm install
npm start
```

Opens on `http://localhost:3000`. Tokens live in `%APPDATA%\Bonaparte\.env` on Windows (auto-seeded from `.env.example` on first launch) — edit via the Settings page or directly.

## Build the installer

```bash
npm run build
```

Requires:
- [Bun](https://bun.sh) — `powershell -c "irm bun.sh/install.ps1 | iex"`
- [Inno Setup 6](https://jrsoftware.org/isinfo.php) — `winget install JRSoftware.InnoSetup`

Produces:
- `X:\bonaparte-dist\Bonaparte.exe` + hidden `app/` payload (for local testing)
- `X:\bonaparte-release\BonaparteSetup.exe` — single-file installer to share

Installer behaviour:
- Per-user install to `%LOCALAPPDATA%\Programs\Bonaparte\` (no admin prompt)
- Start menu shortcut with bee icon; optional desktop + "run on sign-in"
- Registers in Apps & Features; uninstall stops the server, removes files, keeps `%APPDATA%\Bonaparte\` state

## Release a new version

```bash
npm run release 2.1.0 "Added X, fixed Y"
```

Bumps version in `lib/version.js`, `package.json`, and `installer.iss`, rebuilds, and copies `BonaparteSetup.exe` + `latest.json` into the shared OneDrive folder:

```
%USERPROFILE%\CN3 A S\Bimgenetic - Global - Documents\General\08 Implementation\8.8 Bonaparte\
```

Every CN3 A/S user with that library synced sees an "Update available" banner on their next launch; clicking "Install now" runs the synced installer.

## First run on a new machine

1. Install [Claude Code](https://claude.com/claude-code) and sign in (`claude`). Bonaparte reads the OAuth token from `~/.claude/.credentials.json`.
2. Add the Slack and HubSpot MCP connectors in claude.ai (one-time per user account).
3. Run `BonaparteSetup.exe` from the OneDrive folder. Launch from Start menu.

## Paths

- **App root** (read-only, ships inside the installer): `ui/`, `data/`, `.env.example`.
- **User data** (writable, persists across upgrades): `%APPDATA%\Bonaparte\` — `.env`, `bonaparte.json` (job log + memory + settings), `drafts.json`.
- **Claude auth**: `~/.claude/.credentials.json`.
- **Update channel**: `%USERPROFILE%\CN3 A S\...\8.8 Bonaparte\{latest.json, BonaparteSetup.exe}`.

Override the user-data location with `BONAPARTE_USER_DIR=<path>`.

## Layout

```
server.js              Express app, API routes, scheduler wiring
lib/
  paths.js             assetPath() / userPath() — dev vs compiled
  version.js           VERSION + OneDrive manifest location
  db.js                JSON DB (job runs, memory nodes, settings)
  claude.js            Anthropic SDK wrapper (API key or Claude Code OAuth)
  claude-triggers.js   Anthropic triggers API client
  slack.js             Slack client (canvases, bot DMs)
  slack-bot.js         Socket Mode bot
tools/
  config.js            env loader + CANVAS/OWNER ID constants
  vitus.js             Vitus platform API (read-only)
  research.js          Tavily web search
jobs/                  Scheduler + job implementations
ui/public/             Static HTML/CSS/JS (incl. update-check.js banner)
assets/bonaparte.ico   Windows exe icon (Vitus bee)
data/                  Read-only seed data (survey insights)
scripts/
  build.js             Bun compile + csc launcher + Inno installer
  release.js           Bump version, rebuild, publish to OneDrive
  installer.iss        Inno Setup script
  launcher.cs          C# stub that spawns launcher.ps1 hidden
  launcher.ps1         Tray launcher — starts server, opens Edge --app
```

See `CLAUDE.md` for the full agent system prompt, canvas IDs, and operating-mode rules.
