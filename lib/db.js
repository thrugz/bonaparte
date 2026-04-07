/**
 * Simple JSON file store for job logs and settings.
 * No native dependencies. Auto-creates on first use.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "..", "config", "bonaparte.json");

function load() {
  if (!existsSync(DB_PATH)) return { runs: [], settings: {}, memory: [] };
  try {
    const data = JSON.parse(readFileSync(DB_PATH, "utf-8"));
    if (!data.memory) data.memory = [];
    return data;
  } catch {
    return { runs: [], settings: {}, memory: [] };
  }
}

function save(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Job logging

export function logJobStart(name) {
  const data = load();
  const id = Date.now();
  data.runs.push({
    id,
    job_name: name,
    started_at: new Date().toISOString(),
    finished_at: null,
    status: "running",
    summary: null,
    error: null,
  });
  // Keep last 200 runs
  if (data.runs.length > 200) data.runs = data.runs.slice(-200);
  save(data);
  return id;
}

export function logJobEnd(id, status, summary = null, error = null) {
  const data = load();
  const run = data.runs.find((r) => r.id === id);
  if (run) {
    run.finished_at = new Date().toISOString();
    run.status = status;
    run.summary = summary;
    run.error = error;
  }
  save(data);
}

export function getRecentRuns(limit = 20) {
  const data = load();
  return data.runs.slice(-limit).reverse();
}

export function getLastRun(jobName) {
  const data = load();
  for (let i = data.runs.length - 1; i >= 0; i--) {
    if (data.runs[i].job_name === jobName) return data.runs[i];
  }
  return null;
}

// Settings

export function getSetting(key) {
  const data = load();
  return data.settings[key] ?? null;
}

export function setSetting(key, value) {
  const data = load();
  data.settings[key] = value;
  save(data);
}

// Memory nodes

export function getMemoryNodes() {
  const data = load();
  return data.memory;
}

export function setMemoryNodes(nodes) {
  const data = load();
  data.memory = nodes;
  save(data);
}
