/**
 * Memory Store parser and serializer.
 * Pipe-delimited format: TYPE|SCORE|description|tags|deadline|status
 */

const VALID_TYPES = ["FACT", "SIGNAL", "DECISION", "PATTERN", "CONTEXT"];

/**
 * Parse Memory Store canvas text (HTML or plain) into structured nodes.
 */
export function parseMemoryStore(text) {
  // Strip HTML if present
  const clean = text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const lines = clean.split(/\s*(?=(?:FACT|SIGNAL|DECISION|PATTERN|CONTEXT)\|)/);
  const nodes = [];

  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length >= 6 && VALID_TYPES.includes(parts[0])) {
      nodes.push({
        type: parts[0],
        score: parseInt(parts[1]) || 0,
        description: parts[2]?.trim() || "",
        tags: parts[3]?.split(",").map((t) => t.trim()).filter(Boolean) || [],
        deadline: parts[4]?.trim() || null,
        status: parts[5]?.trim() || "active",
      });
    }
  }
  // Deduplicate: canvas duplication bug can cause repeated blocks.
  // Keep the last occurrence of each unique node (most recently written).
  const seen = new Set();
  const deduped = [];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const key = `${nodes[i].type}|${nodes[i].description}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.unshift(nodes[i]);
    }
  }
  return deduped;
}

/**
 * Serialize nodes back to pipe-delimited format for canvas write.
 */
export function serializeMemoryStore(nodes) {
  const header = "# Bonaparte / Memory Store\n\nTYPE|SCORE|description|tags|deadline|status";
  const lines = nodes.map((n) =>
    `${n.type}|${n.score}|${n.description}|${n.tags.join(",")}|${n.deadline || ""}|${n.status}`
  );
  return header + "\n" + lines.join("\n");
}
