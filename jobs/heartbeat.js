/**
 * 30-minute heartbeat. Keeps memory tight:
 *   1. Backup snapshot
 *   2. Tier demote (working → graph after 3d idle)
 *   3. Importance decay (linear 0.05/day, IDENTITY/DECISION exempt)
 *   4. Prune (forgotten=true when importance<0.1 and age>30d)
 *   5. Merge near-duplicates (Jaccard ≥ 0.85, survivor = highest importance)
 *   6. Synthesize bulletin (one LLM call from pre-baked slots)
 *   7. Journal the tick
 *
 * Scope is adaptive: if ≤150 active nodes, steps 2-5 scan the full set.
 * Above that, they scan only nodes changed since last tick plus 1-hop
 * `related_ids` neighborhood. Step 6 always runs.
 */
import { getMemoryNodes, setMemoryNodes, getSetting, setSetting } from "../lib/db.js";
import {
  backupDatabase,
  buildRetrievalSlots,
  similarity,
  migrateAll,
} from "../lib/memory.js";
import { synthesizeBulletin } from "../lib/claude.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_TTL_MS = 3 * DAY_MS;
const PRUNE_AGE_MS = 30 * DAY_MS;
const DECAY_PER_DAY = 0.05;
const MERGE_THRESHOLD = 0.85;
const EXEMPT_TYPES = new Set(["IDENTITY", "DECISION"]);

function daysBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;
}

function pickScope(nodes, lastTickAt) {
  const active = nodes.filter((n) => n.status === "active" && !n.forgotten);
  if (active.length <= 150) return { set: active, mode: "full" };

  const cutoff = lastTickAt ? new Date(lastTickAt).toISOString() : "0";
  const changedIds = new Set();
  const byId = new Map();
  for (const n of nodes) if (n.id) byId.set(n.id, n);
  for (const n of active) {
    if ((n.updated_at || n.created_at || "") > cutoff) changedIds.add(n.id);
  }
  // 1-hop neighborhood
  const frontier = new Set(changedIds);
  for (const id of changedIds) {
    const n = byId.get(id);
    for (const r of n?.related_ids || []) frontier.add(r);
  }
  const set = active.filter((n) => frontier.has(n.id));
  return { set, mode: "incremental" };
}

export default async function runHeartbeat() {
  const startedAt = new Date().toISOString();
  const entry = { at: startedAt, ops: {}, notes: [] };

  migrateAll();
  backupDatabase();

  let nodes = getMemoryNodes();
  const lastTickAt = getSetting("heartbeat_last_at");
  const { set: scope, mode } = pickScope(nodes, lastTickAt);
  entry.ops.scope = { mode, size: scope.length, total: nodes.length };

  const now = Date.now();

  // 2. Tier demote
  let demoted = 0;
  for (const n of scope) {
    const last = new Date(n.last_accessed_at || n.created_at || startedAt).getTime();
    if (n.tier === "working" && now - last > TIER_TTL_MS) {
      n.tier = "graph";
      n.updated_at = startedAt;
      demoted++;
    }
  }
  entry.ops.demoted = demoted;

  // 3. Decay
  let decayed = 0;
  for (const n of scope) {
    if (EXEMPT_TYPES.has(n.type)) continue;
    const days = daysBetween(n.updated_at || n.created_at || startedAt, startedAt);
    if (days < 0.02) continue; // skip freshly-touched
    const before = n.importance || 0;
    const next = Math.max(0, before - DECAY_PER_DAY * days);
    if (Math.abs(next - before) > 0.001) {
      n.importance = parseFloat(next.toFixed(3));
      decayed++;
    }
  }
  entry.ops.decayed = decayed;

  // 4. Prune
  let pruned = 0;
  for (const n of scope) {
    if (EXEMPT_TYPES.has(n.type)) continue;
    const ageMs = now - new Date(n.created_at || startedAt).getTime();
    if ((n.importance || 0) < 0.1 && ageMs > PRUNE_AGE_MS) {
      n.forgotten = true;
      n.status = "resolved";
      n.updated_at = startedAt;
      pruned++;
    }
  }
  entry.ops.pruned = pruned;

  // 5. Merge (within scope, pairwise)
  let merged = 0;
  const activeScope = scope.filter((n) => n.status === "active" && !n.forgotten);
  for (let i = 0; i < activeScope.length; i++) {
    const a = activeScope[i];
    if (a.forgotten) continue;
    for (let j = i + 1; j < activeScope.length; j++) {
      const b = activeScope[j];
      if (b.forgotten || a.type !== b.type) continue;
      if (similarity(a, b) < MERGE_THRESHOLD) continue;
      const keep = (a.importance || 0) >= (b.importance || 0) ? a : b;
      const drop = keep === a ? b : a;
      keep.importance = Math.min(1, (keep.importance || 0) + 0.05);
      keep.tags = Array.from(new Set([...(keep.tags || []), ...(drop.tags || [])]));
      keep.related_ids = Array.from(new Set([...(keep.related_ids || []), ...(drop.related_ids || [])].filter((id) => id !== keep.id && id !== drop.id)));
      keep.updated_at = startedAt;
      drop.forgotten = true;
      drop.status = "resolved";
      drop.superseded_by = keep.id;
      drop.updated_at = startedAt;
      // Rewire inbound edges from other nodes
      for (const other of nodes) {
        if (!other.related_ids?.length) continue;
        if (other.related_ids.includes(drop.id)) {
          other.related_ids = Array.from(
            new Set(other.related_ids.map((id) => (id === drop.id ? keep.id : id)).filter((id) => id !== other.id))
          );
          other.updated_at = startedAt;
        }
      }
      merged++;
    }
  }
  entry.ops.merged = merged;

  setMemoryNodes(nodes);

  // 6. Bulletin synthesis — always on full slots, regardless of scope mode.
  try {
    const slots = buildRetrievalSlots();
    const bulletin = await synthesizeBulletin(slots);
    if (bulletin && bulletin.length > 20) {
      setSetting("bulletin_cache", bulletin);
      entry.ops.bulletinChars = bulletin.length;
    } else {
      entry.notes.push("bulletin-empty");
    }
  } catch (err) {
    entry.notes.push("bulletin-failed: " + err.message.slice(0, 80));
  }

  // 7. Journal
  const journal = getSetting("heartbeat_journal") || [];
  journal.unshift(entry);
  setSetting("heartbeat_journal", journal.slice(0, 50));
  setSetting("heartbeat_last_at", startedAt);
  const summary = `scope=${mode}(${scope.length}/${nodes.length}) demoted=${demoted} decayed=${decayed} pruned=${pruned} merged=${merged}`;
  setSetting("heartbeat_last_summary", summary);
  return summary;
}
