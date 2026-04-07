/**
 * Deterministic pattern detection.
 * If 2+ active SIGNALs share a theme not covered by an existing PATTERN, create one.
 */

/**
 * Detect new patterns from active signals.
 * @param {Array} nodes - parsed memory nodes
 * @returns {{ updated: Array, newPatterns: Array, found: string[] }}
 */
export function detectPatterns(nodes) {
  const found = [];
  const newPatterns = [];

  const signals = nodes.filter((n) => n.type === "SIGNAL" && n.status === "active");
  const existingPatterns = nodes.filter((n) => n.type === "PATTERN" && n.status === "active");
  const existingPatternTags = new Set(existingPatterns.flatMap((p) => p.tags));

  // Group signals by tag
  const tagGroups = {};
  for (const signal of signals) {
    for (const tag of signal.tags) {
      // Skip generic tags
      if (["action-required", "watch", "active"].includes(tag)) continue;
      if (!tagGroups[tag]) tagGroups[tag] = [];
      tagGroups[tag].push(signal);
    }
  }

  // Find tags with 2+ signals not already covered by a pattern
  for (const [tag, tagSignals] of Object.entries(tagGroups)) {
    if (tagSignals.length < 2) continue;
    if (existingPatternTags.has(tag)) continue;

    // Extract account names from signal tags for the pattern description
    const accounts = new Set();
    for (const s of tagSignals) {
      for (const t of s.tags) {
        // Account tags are typically capitalized names
        if (t[0] === t[0].toUpperCase() && t.length > 2 && !["FLC", "DEME", "SBF"].includes(t)) {
          accounts.add(t);
        }
        // Also include known short codes
        if (["FLC", "DEME", "SBF", "COWI", "CN3"].includes(t)) {
          accounts.add(t);
        }
      }
    }

    const pattern = {
      type: "PATTERN",
      score: 2,
      description: `Shared signal across ${accounts.size > 0 ? [...accounts].join(", ") : "multiple accounts"}: "${tag}" theme detected in ${tagSignals.length} active signals.`,
      tags: [tag, "auto-detected"],
      deadline: null,
      status: "active",
    };

    newPatterns.push(pattern);
    found.push(`New pattern: ${tag} (${tagSignals.length} signals)`);
  }

  // Append new patterns to nodes
  nodes.push(...newPatterns);
  return { updated: nodes, newPatterns, found };
}
