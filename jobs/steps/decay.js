/**
 * Deterministic decay scoring for memory nodes.
 *
 * Rules (from CLAUDE.md):
 * - SIGNAL with action-required + >14 days old + no resolution: drop score by 1 (min 1)
 * - SIGNAL >30 days old + no resolution: set score=1, add [STALE], status=stale
 * - SIGNAL referenced in DECISION as resolved: mark [RESOLVED], status=resolved
 */

/**
 * Apply decay rules to a set of memory nodes.
 * @param {Array} nodes - parsed memory nodes
 * @param {Date} today - current date (injectable for testing)
 * @returns {{ updated: Array, changes: string[] }}
 */
export function applyDecay(nodes, today = new Date()) {
  const changes = [];

  // Collect resolution signals from DECISION nodes
  const resolvedDescriptions = nodes
    .filter((n) => n.type === "DECISION" && n.status === "active")
    .map((n) => n.description.toLowerCase());

  for (const node of nodes) {
    if (node.type !== "SIGNAL" || node.status !== "active") continue;

    // Check if resolved by a DECISION
    const descLower = node.description.toLowerCase();
    const isResolved = resolvedDescriptions.some(
      (d) => d.includes("resolved") && d.includes(node.tags[0]?.toLowerCase() || "___none___")
    );
    if (isResolved) {
      node.status = "resolved";
      if (!node.description.includes("[RESOLVED]")) {
        node.description += " [RESOLVED]";
      }
      changes.push(`Resolved: ${node.description.slice(0, 60)}...`);
      continue;
    }

    // Calculate age from deadline or description date hints
    const age = getNodeAgeDays(node, today);
    if (age === null) continue;

    const hasActionRequired = node.tags.includes("action-required");

    // >30 days: force to score 1, mark stale
    if (age > 30) {
      if (node.score > 1) {
        changes.push(`Stale (${age}d): ${node.description.slice(0, 60)}... score ${node.score}→1`);
        node.score = 1;
      }
      node.status = "stale";
      if (!node.description.includes("[STALE]")) {
        node.description += " [STALE]";
      }
      continue;
    }

    // >14 days + action-required: drop score by 1
    if (age > 14 && hasActionRequired && node.score > 1) {
      changes.push(`Decayed (${age}d): ${node.description.slice(0, 60)}... score ${node.score}→${node.score - 1}`);
      node.score -= 1;
    }
  }

  return { updated: nodes, changes };
}

/**
 * Estimate node age in days.
 * Uses deadline if present, otherwise tries to extract a date from the description.
 */
function getNodeAgeDays(node, today) {
  // Try deadline first
  if (node.deadline) {
    const d = new Date(node.deadline);
    if (!isNaN(d)) {
      return Math.floor((today - d) / 86400000);
    }
  }

  // Try to find a date pattern in description (e.g., "Mar 11", "2026-03-11")
  const isoMatch = node.description.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!isNaN(d)) return Math.floor((today - d) / 86400000);
  }

  const monthMatch = node.description.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/i);
  if (monthMatch) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const m = months[monthMatch[1].toLowerCase()];
    const day = parseInt(monthMatch[2]);
    const d = new Date(today.getFullYear(), m, day);
    // If date is in the future, it was last year
    if (d > today) d.setFullYear(d.getFullYear() - 1);
    return Math.floor((today - d) / 86400000);
  }

  return null;
}
