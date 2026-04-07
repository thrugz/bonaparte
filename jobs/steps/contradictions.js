/**
 * Deterministic contradiction detection.
 * Compares FACT and CONTEXT nodes with overlapping tags.
 */

/**
 * Detect contradictions between FACT/CONTEXT nodes.
 * @param {Array} nodes - parsed memory nodes
 * @returns {{ updated: Array, found: string[] }}
 */
export function detectContradictions(nodes) {
  const found = [];
  const factContext = nodes.filter(
    (n) => (n.type === "FACT" || n.type === "CONTEXT") && n.status === "active"
  );

  for (let i = 0; i < factContext.length; i++) {
    for (let j = i + 1; j < factContext.length; j++) {
      const a = factContext[i];
      const b = factContext[j];

      // Check for overlapping tags (need at least 2 shared tags to be a candidate)
      const shared = a.tags.filter((t) => b.tags.includes(t));
      if (shared.length < 2) continue;

      // Check if they contain conflicting numeric claims about the same subject
      const conflict = findNumericConflict(a.description, b.description, shared);
      if (conflict) {
        // Tag the newer one (later in list) as contradicting
        if (!b.description.includes("[CONTRADICTS:")) {
          b.description += ` [CONTRADICTS: ${a.description.slice(0, 50)}]`;
          found.push(`${b.type}: "${b.description.slice(0, 60)}..." contradicts "${a.description.slice(0, 60)}..."`);
        }
      }
    }
  }

  return { updated: nodes, found };
}

/**
 * Simple heuristic: extract numbers from both descriptions.
 * If the same metric (contacts, score, %) appears with different values, flag it.
 */
function findNumericConflict(descA, descB, sharedTags) {
  const patterns = [
    /(\d+)\s*contacts/i,
    /avg\s*(?:score\s*)?(\d+\.?\d*)/i,
    /(\d+)%\s*Tier/i,
    /score\s*(\d+\.?\d*)/i,
  ];

  for (const pat of patterns) {
    const matchA = descA.match(pat);
    const matchB = descB.match(pat);
    if (matchA && matchB && matchA[1] !== matchB[1]) {
      return true;
    }
  }
  return false;
}
