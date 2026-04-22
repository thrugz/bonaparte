/**
 * Path resolution for dev vs compiled (bun build --compile) runs.
 *
 * assetPath(...segments)  → read-only files shipped with the app (ui, assets).
 *   - dev: resolves relative to repo root
 *   - compiled: resolves relative to the exe's directory
 *
 * userPath(...segments)   → writable per-user state (.env, JSON DBs).
 *   - Windows: %APPDATA%\Bonaparte
 *   - macOS:   ~/Library/Application Support/Bonaparte
 *   - Linux:   $XDG_CONFIG_HOME/bonaparte  (or ~/.config/bonaparte)
 *
 * Env override: BONAPARTE_USER_DIR forces a specific user-data directory.
 */
import { dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dev if the repo's package.json sits next to lib/. Compiled builds embed
// sources under a virtual bunfs path, so this check is false there.
const DEV = existsSync(resolve(__dirname, "..", "package.json"));

export const APP_ROOT = DEV
  ? resolve(__dirname, "..")
  : dirname(process.execPath);

export const IS_COMPILED = !DEV;

function resolveUserDir() {
  if (process.env.BONAPARTE_USER_DIR) return process.env.BONAPARTE_USER_DIR;
  const platform = process.platform;
  if (platform === "win32") {
    const base = process.env.APPDATA || join(os.homedir(), "AppData", "Roaming");
    return join(base, "Bonaparte");
  }
  if (platform === "darwin") {
    return join(os.homedir(), "Library", "Application Support", "Bonaparte");
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(os.homedir(), ".config");
  return join(xdg, "bonaparte");
}

export const USER_DIR = resolveUserDir();

export function assetPath(...segments) {
  return join(APP_ROOT, ...segments);
}

export function userPath(...segments) {
  return join(USER_DIR, ...segments);
}

export function backupPath(...segments) {
  return join(USER_DIR, "backups", ...segments);
}

/**
 * Ensure the user-data directory exists. Seeds an empty .env from
 * .env.example on first run so the Settings page can read/write tokens.
 */
export function ensureUserDir() {
  if (!existsSync(USER_DIR)) mkdirSync(USER_DIR, { recursive: true });

  const envPath = userPath(".env");
  if (!existsSync(envPath)) {
    // Prefer a bundled .env shipped with the exe (pre-filled tokens),
    // fall back to the empty .env.example template.
    const bundled = assetPath(".env");
    const example = assetPath(".env.example");
    if (existsSync(bundled)) {
      copyFileSync(bundled, envPath);
    } else if (existsSync(example)) {
      copyFileSync(example, envPath);
    } else {
      writeFileSync(envPath, "");
    }
  }
}
