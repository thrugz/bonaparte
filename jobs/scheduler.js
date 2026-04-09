/**
 * Background job scheduler using node-cron.
 * Job configs are persisted in the database. Built-in jobs have default schedules
 * but can be edited, disabled, or deleted. Custom jobs can be added.
 */
import cron from "node-cron";
import { logJobStart, logJobEnd, getLastRun, getSetting, setSetting } from "../lib/db.js";
import runConsolidation from "./consolidation.js";
import runMorningBrief from "./morning-brief.js";
import runPortfolioAlerts from "./portfolio-alerts.js";

const TIMEZONE = "Europe/Copenhagen";

// Built-in job implementations
const JOB_FNS = {
  consolidation: runConsolidation,
  "morning-brief": runMorningBrief,
  "portfolio-alerts": runPortfolioAlerts,
};

// Default configs (used on first run before anything is persisted)
const DEFAULTS = {
  consolidation: { cron: "0 23 * * 1-5", description: "Nightly consolidation (decay, patterns, bulletin)", enabled: true },
  "morning-brief": { cron: "30 7 * * 1-5", description: "Morning brief generation", enabled: true },
  "portfolio-alerts": { cron: "0 8 * * 1", description: "Weekly portfolio health alerts", enabled: true },
};

// Active cron tasks keyed by job name
const activeTasks = new Map();

function loadJobConfigs() {
  const saved = getSetting("job_configs");
  if (saved) return saved;
  // First run: persist defaults
  setSetting("job_configs", DEFAULTS);
  return DEFAULTS;
}

function saveJobConfigs(configs) {
  setSetting("job_configs", configs);
}

async function executeJob(name) {
  const fn = JOB_FNS[name];
  if (!fn) throw new Error(`Job "${name}" has no implementation`);

  const runId = logJobStart(name);
  try {
    const summary = await fn();
    logJobEnd(runId, "ok", summary);
    console.log(`  [job] ${name}: ok`);
    return { ok: true, summary };
  } catch (err) {
    logJobEnd(runId, "error", null, err.message);
    console.error(`  [job] ${name}: error — ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function scheduleJob(name, config) {
  // Stop existing task if any
  if (activeTasks.has(name)) {
    activeTasks.get(name).stop();
    activeTasks.delete(name);
  }

  if (!config.enabled) return;
  if (!JOB_FNS[name]) return;
  if (!cron.validate(config.cron)) return;

  const task = cron.schedule(config.cron, () => executeJob(name), { timezone: TIMEZONE });
  activeTasks.set(name, task);
}

export function startScheduler() {
  const configs = loadJobConfigs();
  for (const [name, config] of Object.entries(configs)) {
    if (!config.enabled) {
      console.log(`  [scheduler] ${name}: disabled`);
      continue;
    }
    if (!JOB_FNS[name]) {
      console.log(`  [scheduler] ${name}: skipped (no implementation)`);
      continue;
    }
    scheduleJob(name, config);
    console.log(`  [scheduler] ${name}: ${config.cron} (${TIMEZONE})`);
  }
}

export function getScheduledJobs() {
  const configs = loadJobConfigs();
  return Object.entries(configs).map(([name, config]) => ({
    name,
    cron: config.cron,
    description: config.description,
    enabled: config.enabled,
    implemented: !!JOB_FNS[name],
    lastRun: getLastRun(name),
  }));
}

export async function runJobManually(name) {
  const configs = loadJobConfigs();
  if (!configs[name]) throw new Error(`Unknown job: ${name}`);
  return executeJob(name);
}

export function updateJob(name, updates) {
  const configs = loadJobConfigs();
  if (!configs[name]) throw new Error(`Unknown job: ${name}`);

  if (updates.cron !== undefined) {
    if (!cron.validate(updates.cron)) throw new Error(`Invalid cron expression: ${updates.cron}`);
    configs[name].cron = updates.cron;
  }
  if (updates.description !== undefined) configs[name].description = updates.description;
  if (updates.enabled !== undefined) configs[name].enabled = !!updates.enabled;

  saveJobConfigs(configs);
  scheduleJob(name, configs[name]);
  return configs[name];
}

export function deleteJob(name) {
  const configs = loadJobConfigs();
  if (!configs[name]) throw new Error(`Unknown job: ${name}`);

  // Stop the cron task
  if (activeTasks.has(name)) {
    activeTasks.get(name).stop();
    activeTasks.delete(name);
  }

  delete configs[name];
  saveJobConfigs(configs);
}

export function createJob(name, config) {
  const configs = loadJobConfigs();
  if (configs[name]) throw new Error(`Job "${name}" already exists`);
  if (!cron.validate(config.cron)) throw new Error(`Invalid cron expression: ${config.cron}`);

  configs[name] = {
    cron: config.cron,
    description: config.description || name,
    enabled: config.enabled !== false,
  };

  saveJobConfigs(configs);
  if (configs[name].enabled && JOB_FNS[name]) {
    scheduleJob(name, configs[name]);
  }
  return configs[name];
}
