#!/usr/bin/env node
/**
 * Release helper.
 *
 *   npm run release <X.Y.Z> ["notes"]
 *
 * Bumps version, runs electron-builder, and copies BonaparteSetup.exe +
 * latest.json into the CN3 A/S OneDrive folder so every synced user
 * sees the update.
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const ONEDRIVE_DIR =
  process.env.BONAPARTE_ONEDRIVE ||
  join(os.homedir(), "CN3 A S", "Bimgenetic - Global - Documents", "General", "08 Implementation", "8.8 Bonaparte");

const newVersion = process.argv[2];
const notes = process.argv[3] || "";

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("Usage: npm run release <major.minor.patch> [\"notes\"]");
  process.exit(1);
}

function patch(file, pattern, replacement) {
  const p = join(REPO, file);
  const s = readFileSync(p, "utf8");
  const next = s.replace(pattern, replacement);
  if (s === next) throw new Error(`Pattern not matched in ${file}`);
  writeFileSync(p, next);
  console.log(`  bumped ${file}`);
}

console.log(`Bonaparte release → ${newVersion}`);

patch("lib/version.js", /export const VERSION = "[^"]+";/, `export const VERSION = "${newVersion}";`);
patch("package.json",   /"version": "[^"]+"/,              `"version": "${newVersion}"`);

const r = spawnSync("npm", ["run", "build"], { cwd: REPO, stdio: "inherit", shell: true });
if (r.status !== 0) process.exit(r.status || 1);

const installerSrc = join("X:/bonaparte-release", "BonaparteSetup.exe");
if (!existsSync(installerSrc)) {
  console.error(`Installer missing at ${installerSrc}.`);
  process.exit(1);
}
if (!existsSync(ONEDRIVE_DIR)) {
  console.error(`OneDrive folder not found at ${ONEDRIVE_DIR}.`);
  process.exit(1);
}

copyFileSync(installerSrc, join(ONEDRIVE_DIR, "BonaparteSetup.exe"));
writeFileSync(
  join(ONEDRIVE_DIR, "latest.json"),
  JSON.stringify({ version: newVersion, notes }, null, 2) + "\n"
);

console.log(`\nPublished to ${ONEDRIVE_DIR}`);
console.log("  BonaparteSetup.exe");
console.log("  latest.json");
console.log(`\nNext: git commit -am "Release ${newVersion}" && git push`);
