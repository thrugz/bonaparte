/**
 * Background job scheduler using node-cron.
 * Three jobs: consolidation, morning brief, portfolio alerts.
 */
import cron from "node-cron";
import { logJobStart, logJobEnd, getLastRun } from "../lib/db.js";
import runConsolidation from "./consolidation.js";
import runMorningBrief from "./morning-brief.js";
import runPortfolioAlerts from "./portfolio-alerts.js";

const TIMEZONE = "Europe/Copenhagen";

const jobs = {
  consolidation: {
    cron: "0 23 * * 1-5",
    description: "Nightly consolidation (decay, patterns, bulletin)",
    fn: runConsolidation,
  },
  "morning-brief": {
    cron: "30 7 * * 1-5",
    description: "Morning brief generation",
    fn: runMorningBrief,
  },
  "portfolio-alerts": {
    cron: "0 8 * * 1",
    description: "Weekly portfolio health alerts",
    fn: runPortfolioAlerts,
  },
};

async function executeJob(name) {
  const job = jobs[name];
  if (!job?.fn) throw new Error(`Job "${name}" not implemented yet`);

  const runId = logJobStart(name);
  try {
    const summary = await job.fn();
    logJobEnd(runId, "ok", summary);
    console.log(`  [job] ${name}: ok`);
    return { ok: true, summary };
  } catch (err) {
    logJobEnd(runId, "error", null, err.message);
    console.error(`  [job] ${name}: error — ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export function registerJob(name, fn) {
  if (jobs[name]) jobs[name].fn = fn;
}

export function startScheduler() {
  for (const [name, job] of Object.entries(jobs)) {
    if (!job.fn) {
      console.log(`  [scheduler] ${name}: skipped (not implemented)`);
      continue;
    }
    cron.schedule(job.cron, () => executeJob(name), { timezone: TIMEZONE });
    console.log(`  [scheduler] ${name}: ${job.cron} (${TIMEZONE})`);
  }
}

export function getScheduledJobs() {
  return Object.entries(jobs).map(([name, job]) => ({
    name,
    cron: job.cron,
    description: job.description,
    implemented: !!job.fn,
    lastRun: getLastRun(name),
  }));
}

export async function runJobManually(name) {
  if (!jobs[name]) throw new Error(`Unknown job: ${name}`);
  return executeJob(name);
}
