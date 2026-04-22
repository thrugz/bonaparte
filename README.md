# Bonaparte

Strategic AI tooling for Vitus. Express web app + Slack bot + scheduled background jobs, talking to HubSpot, Slack, and Anthropic via MCP connectors.

## Run in dev

```bash
npm install
npm start
```

Opens on `http://localhost:3000`. Tokens live in `%APPDATA%\Bonaparte\.env` on Windows (auto-seeded from `.env.example` on first launch) — edit via the Settings page or directly.

## Ship as a Windows .exe

```bash
npm run build
```

Requires [Bun](https://bun.sh) (`powershell -c "irm bun.sh/install.ps1 | iex"`).

Output lands in `X:\bonaparte-dist\`:

```
bonaparte.exe
.env.example
ui/           (served by express)
data/         (read-only seed data)
```

Zip the folder, drop it in OneDrive/Slack, send the link. Recipient unzips anywhere, double-clicks `bonaparte.exe`, opens `http://localhost:3000`.

### First-run setup on a new machine

1. Install [Claude Code](https://claude.com/claude-code) and sign in once (`claude`). Bonaparte reads the OAuth token from `~/.claude/.credentials.json`.
2. Add the Slack and HubSpot MCP connectors in claude.ai (Claude-account-level, one-time).
3. Launch `bonaparte.exe`, open `http://localhost:3000`, paste tokens on the Settings page.

### Paths

- **App root** (read-only, ships with the exe): `ui/`, `data/`, `.env.example`.
- **User data** (writable, persists across reinstalls): `%APPDATA%\Bonaparte\` — holds `.env`, `bonaparte.json` (job log + memory), `drafts.json`.
- **Claude auth**: `~/.claude/.credentials.json` (managed by Claude Code).

Override the user-data location with `BONAPARTE_USER_DIR=<path>`.

### Reinstalling

Delete `X:\bonaparte-dist\`, rebuild, reship. Nothing persistent lives in the dist folder — tokens and state stay in `%APPDATA%\Bonaparte\`.

## Layout

```
server.js              Express app, API routes, scheduler wiring
lib/
  paths.js             assetPath() / userPath() — dev vs compiled
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
middleware/auth.js     Session auth for the web UI
ui/public/             Static HTML/CSS/JS
assets/bonaparte.ico   Windows exe icon
data/                  Read-only seed data (survey insights)
scripts/build.js       Bun compile → X:\bonaparte-dist\
```

See `CLAUDE.md` for the full agent system prompt, canvas IDs, and operating-mode rules.
