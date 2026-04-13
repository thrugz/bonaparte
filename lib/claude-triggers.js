/**
 * Thin client for the Anthropic "code triggers" API (the same system that
 * backs claude.ai/code/scheduled). Reads the OAuth access token that the
 * Claude Code CLI maintains at ~/.claude/.credentials.json on the local
 * machine, so this only works when Bonaparte runs on the same box as a
 * signed-in Claude Code.
 *
 * If the token has expired, the user needs to run `claude` to refresh it.
 * We don't try to refresh it ourselves — Claude Code handles that and
 * rewrites the same file.
 */
import fs from "fs";
import path from "path";
import os from "os";

const CREDS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");
const API_BASE = "https://api.anthropic.com";
const BETA = "oauth-2025-04-20,ccr-triggers-2026-01-30";
const VERSION = "2023-06-01";

function readAccessToken() {
  let raw;
  try {
    raw = fs.readFileSync(CREDS_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read Claude Code credentials at ${CREDS_PATH}: ${err.message}. Run \`claude\` once to sign in.`
    );
  }
  const parsed = JSON.parse(raw);
  const token = parsed?.claudeAiOauth?.accessToken;
  if (!token) throw new Error("No accessToken in Claude Code credentials. Run `claude` to sign in.");
  return token;
}

async function api(method, pathStr, body) {
  const token = readAccessToken();
  const res = await fetch(API_BASE + pathStr, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": BETA,
      "anthropic-version": VERSION,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Triggers API ${method} ${pathStr}: ${res.status} ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function listTriggers() {
  const r = await api("GET", "/v1/code/triggers");
  return r?.data || [];
}
