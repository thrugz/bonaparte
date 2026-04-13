/**
 * Job scheduler.
 *
 * Scheduling itself lives in Anthropic's remote triggers (the three jobs
 * that appear on claude.ai/code/scheduled). This file is a thin adapter:
 * the UI reads/writes trigger state via the Anthropic API, and "Run now"
 * still executes the local JS implementation for fast feedback.
 *
 * There is intentionally no local cron. If Bonaparte's server is down,
 * remote triggers still fire on Anthropic's infra.
 */
import { listTriggers } from "../lib/claude-triggers.js";
import { logJobStart, logJobEnd, getLastRun } from "../lib/db.js";
import runConsolidation from "./consolidation.js";
import runMorningBrief from "./morning-brief.js";
import runPortfolioAlerts from "./portfolio-alerts.js";

// Map short UI job names to remote trigger IDs and local implementations.
const JOBS = {
  "portfolio-alerts": {
    triggerId: "trig_01MW9WZcNniRcDbcr2NwNuqg",
    description: "Weekly portfolio health alerts",
    fn: runPortfolioAlerts,
  },
  "morning-brief": {
    triggerId: "trig_01PEXD3FyCvCgXJp6dZc6yEp",
    description: "Morning brief generation",
    fn: runMorningBrief,
  },
  consolidation: {
    triggerId: "trig_013H7fTYQrriNC9WGTk7aM6H",
    description: "Nightly consolidation (decay, patterns, bulletin)",
    fn: runConsolidation,
  },
};

function jobNameByTrigger(id) {
  for (const [name, job] of Object.entries(JOBS)) {
    if (job.triggerId === id) return name;
  }
  return null;
}

export function startScheduler() {
  // No local cron. Scheduling lives in Anthropic remote triggers.
  console.log(`  [scheduler] remote-trigger mode (${Object.keys(JOBS).length} jobs mapped)`);
}

export async function getScheduledJobs() {
  let triggersById = {};
  try {
    const triggers = await listTriggers();
    for (const t of triggers) triggersById[t.id] = t;
  } catch (err) {
    // Remote read unavailable (no OAuth, expired, network, etc.).
    // Return a best-effort snapshot so the UI still renders and the
    // claude.ai link still works.
    console.warn(`  [scheduler] listTriggers failed: ${err.message}`);
  }

  const result = Object.entries(JOBS).map(([name, job]) => {
    const t = triggersById[job.triggerId];
    return {
      name,
      triggerId: job.triggerId,
      cron: t?.cron_expression || "—",
      description: job.description,
      enabled: t ? !!t.enabled : null,
      nextRunAt: t?.next_run_at || null,
      implemented: true,
      lastRun: getLastRun(name),
    };
  });
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

export async function runJobManually(name) {
  const job = JOBS[name];
  if (!job) throw new Error(`Unknown job: ${name}`);

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

