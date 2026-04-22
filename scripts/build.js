#!/usr/bin/env node
/**
 * Build a Windows .exe of Bonaparte using Bun's --compile.
 *
 * Output layout (X:\bonaparte-dist\):
 *   bonaparte.exe
 *   .env.example
 *   ui/public/...        (static HTML/CSS/JS served by express)
 *   data/survey-insights.json   (read-only seed data)
 *
 * Writable state (.env, bonaparte.json, drafts.json) lives in
 * %APPDATA%\Bonaparte\ at runtime, created on first launch.
 *
 * Requires: Bun installed (https://bun.sh). Run: node scripts/build.js
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, cpSync, copyFileSync, rmSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const OUT = process.env.BONAPARTE_DIST || "X:\\bonaparte-dist";

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: REPO, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    throw new Error(`${cmd} exited with status ${r.status}`);
  }
}

console.log(`Bonaparte build → ${OUT}`);

if (existsSync(OUT)) {
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });

const exePath = join(OUT, "bonaparte.exe");
const iconPath = join(REPO, "assets", "bonaparte.ico");
const bunArgs = [
  "build",
  "--compile",
  "--target=bun-windows-x64",
  "server.js",
  "--outfile",
  exePath,
];
if (existsSync(iconPath)) bunArgs.push(`--windows-icon=${iconPath}`);
run("bun", bunArgs);

cpSync(join(REPO, "ui"), join(OUT, "ui"), { recursive: true });
cpSync(join(REPO, "data"), join(OUT, "data"), { recursive: true });
copyFileSync(join(REPO, ".env.example"), join(OUT, ".env.example"));

// Bake the current user's .env into the dist so recipients get a
// working install on first launch. If absent, they fall back to
// filling .env.example themselves.
const appdata = process.env.APPDATA || join(os.homedir(), "AppData", "Roaming");
const userEnv = join(appdata, "Bonaparte", ".env");
if (existsSync(userEnv)) {
  copyFileSync(userEnv, join(OUT, ".env"));
  console.log(`  Bundled .env from ${userEnv} (contains live tokens — share privately)`);
} else {
  console.log(`  No .env at ${userEnv} — recipients will see an empty template.`);
}

console.log("\nDone.");
console.log(`  Run: "${exePath}"`);
console.log(`  User data: %APPDATA%\\Bonaparte\\ (created on first launch)`);
