/**
 * Nightly consolidation job.
 * The "dream state" protocol: read memory, decay, detect, generate, write.
 * All memory operations use the local JSON database.
 */
import { getMemoryNodes, setMemoryNodes, getSetting, setSetting } from "../lib/db.js";
import { parseMemoryStore } from "./steps/parse.js";
import { applyDecay } from "./steps/decay.js";
import { detectContradictions } from "./steps/contradictions.js";
import { detectPatterns } from "./steps/patterns.js";
import { generateBulletin } from "../lib/claude.js";

export default async function runConsolidation() {
  const log = [];
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Step 1: Read Memory Store from db
  let nodes = getMemoryNodes();
  log.push(`Read ${nodes.length} nodes from database`);

  // Step 2: Decay scoring
  const { changes: decayChanges } = applyDecay(nodes, today);
  log.push(...decayChanges);

  // Step 3: Contradiction detection
  const { found: contradictions } = detectContradictions(nodes);
  log.push(...contradictions);

  // Step 4: Pattern detection
  const { newPatterns, found: patternFinds } = detectPatterns(nodes);
  log.push(...patternFinds);

  // Step 5: Generate bulletin via Claude
  const signals = nodes
    .filter((n) => n.type === "SIGNAL" && n.status === "active")
    .sort((a, b) => b.score - a.score);
  const patterns = nodes.filter((n) => n.type === "PATTERN" && n.status === "active");
  const staleNodes = nodes.filter((n) => n.status === "stale");

  let bulletin;
  try {
    bulletin = await generateBulletin(signals, patterns, staleNodes);
    log.push("Bulletin generated via Claude");
  } catch (err) {
    bulletin = `**Bulletin generation failed** (${err.message}). Signals: ${signals.length} active, ${staleNodes.length} stale.`;
    log.push(`Bulletin generation failed: ${err.message}`);
  }

  // Step 6: Write updated nodes back to db
  setMemoryNodes(nodes);
  log.push("Memory nodes updated in database");

  // Step 7: Store bulletin and consolidation log
  const previousLog = getSetting("consolidation_log") || "";
  const newLogEntry = `${dateStr}: ${log.join(". ")}`;
  const fullLog = newLogEntry + "\n\n" + previousLog;
  setSetting("consolidation_log", fullLog.slice(0, 10000)); // cap at 10k chars
  setSetting("last_bulletin", bulletin);
  setSetting("last_bulletin_date", dateStr);
  log.push("Bulletin and log saved");

  return log.join("; ");
}
