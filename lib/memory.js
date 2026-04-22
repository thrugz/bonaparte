/**
 * Bonaparte business memory.
 *
 * Schema (all fields optional on legacy nodes; migrateNode fills defaults):
 *   id               uuid            stable identity for links + dedupe
 *   type             FACT|SIGNAL|DECISION|PATTERN|CONTEXT|IDENTITY
 *   description      string          the fact itself
 *   tags             [string]        topical labels
 *   importance       0.0-1.0         decays linearly; DECISION/IDENTITY exempt
 *   score            1|2|3           legacy, kept for old code reading paths
 *   tier             working|graph   new nodes start working
 *   status           active|stale|resolved|forgotten
 *   source           seed|chat|consolidation|hubspot-sync|manual
 *   deadline         ISO date|null
 *   related_ids      [uuid]          bidirectional links
 *   superseded_by    uuid|null       merge bookkeeping; loser keeps record
 *   created_at       ISO ts
 *   updated_at       ISO ts
 *   last_accessed_at ISO ts
 *   access_count     int
 *
 * Retrieval pattern (Spacebot-borrowed): never dump memory. Channels get
 * the cached bulletin synthesis + 3-4 pre-baked deterministic filters.
 */
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync, readFileSync } from "fs";
import { resolve } from "path";
import { getMemoryNodes, setMemoryNodes, getSetting, setSetting } from "./db.js";
import { backupPath, userPath } from "./paths.js";

const NOW = () => new Date().toISOString();

// ── Schema migration ───────────────────────────────────────────────────

export function migrateNode(n) {
  const m = { ...n };
  if (!m.id) m.id = randomUUID();
  if (!m.created_at) m.created_at = NOW();
  if (!m.updated_at) m.updated_at = m.created_at;
  if (!m.last_accessed_at) m.last_accessed_at = m.created_at;
  if (typeof m.access_count !== "number") m.access_count = 0;
  if (!m.source) m.source = "seed";
  if (!m.tier) m.tier = m.source === "seed" ? "graph" : "working";
  if (!Array.isArray(m.related_ids)) m.related_ids = [];
  if (!m.status) m.status = "active";
  if (!Array.isArray(m.tags)) m.tags = [];
  if (typeof m.importance !== "number") {
    const s = typeof m.score === "number" ? m.score : 1;
    m.importance = Math.max(0, Math.min(1, 0.3 + s * 0.2));
  }
  return m;
}

export function migrateAll() {
  const nodes = getMemoryNodes();
  if (!nodes.length) return 0;
  let changed = 0;
  const next = nodes.map((n) => {
    const m = migrateNode(n);
    if (JSON.stringify(m) !== JSON.stringify(n)) changed++;
    return m;
  });
  if (changed) setMemoryNodes(next);
  return changed;
}

// ── Token + similarity helpers ─────────────────────────────────────────

const STOP = new Set("a an and the of to for in on at by from is are was be has have it this that these those with as or but not no".split(" "));

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && w.length > 1 && !STOP.has(w));
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

export function nodeTokens(n) {
  return new Set([...tokenize(n.description), ...(n.tags || []).map((t) => t.toLowerCase())]);
}

export function similarity(a, b) {
  return jaccard(nodeTokens(a), nodeTokens(b));
}

// ── Retrieval slots (no LLM, deterministic) ────────────────────────────

export function activeNodes() {
  return getMemoryNodes().filter((n) => n.status === "active" && !n.forgotten);
}

export function touchAccessed(ids) {
  if (!ids.size && !ids.length) return;
  const set = ids instanceof Set ? ids : new Set(ids);
  const nodes = getMemoryNodes();
  let touched = false;
  for (const n of nodes) {
    if (n.id && set.has(n.id)) {
      n.last_accessed_at = NOW();
      n.access_count = (n.access_count || 0) + 1;
      touched = true;
    }
  }
  if (touched) setMemoryNodes(nodes);
}

export function buildRetrievalSlots({ userMessage = "" } = {}) {
  const all = activeNodes();

  const identities = all.filter((n) => n.type === "IDENTITY");
  const decisions = all.filter((n) => n.type === "DECISION").slice(-10);
  const signals3 = all
    .filter((n) => n.type === "SIGNAL" && (n.score === 3 || (n.importance || 0) >= 0.7))
    .sort((a, b) => (b.importance || 0) - (a.importance || 0));
  const highImportance = [...all]
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .slice(0, 12);
  const recent = [...all]
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 10);
  const patterns = all.filter((n) => n.type === "PATTERN");

  // Account-specific: if the user message mentions a tag from any node, pull
  // the top 5 nodes carrying that tag.
  let accountMatches = [];
  if (userMessage) {
    const msgTokens = new Set(tokenize(userMessage));
    const tagHits = new Set();
    for (const n of all) for (const t of n.tags || []) if (msgTokens.has(t.toLowerCase())) tagHits.add(t);
    if (tagHits.size) {
      accountMatches = all
        .filter((n) => (n.tags || []).some((t) => tagHits.has(t)))
        .sort((a, b) => (b.importance || 0) - (a.importance || 0))
        .slice(0, 6);
    }
  }

  const touched = new Set();
  for (const col of [identities, decisions, signals3, highImportance, recent, patterns, accountMatches]) {
    for (const n of col) if (n.id) touched.add(n.id);
  }
  if (touched.size) touchAccessed(touched);

  return { identities, decisions, signals3, highImportance, recent, patterns, accountMatches };
}

export function formatSlotsForPrompt(slots) {
  const line = (n) => `- [${n.type}${n.importance ? ` ${n.importance.toFixed(2)}` : ""}] ${n.description}`;
  const parts = [];
  if (slots.identities.length) parts.push("Identities:\n" + slots.identities.map(line).join("\n"));
  if (slots.accountMatches.length) parts.push("Account-relevant:\n" + slots.accountMatches.map(line).join("\n"));
  if (slots.signals3.length) parts.push("Urgent signals:\n" + slots.signals3.map(line).join("\n"));
  if (slots.decisions.length) parts.push("Recent decisions:\n" + slots.decisions.map(line).join("\n"));
  if (slots.patterns.length) parts.push("Patterns:\n" + slots.patterns.map(line).join("\n"));
  if (slots.highImportance.length) parts.push("Other high-importance:\n" + slots.highImportance.map(line).join("\n"));
  return parts.join("\n\n");
}

export function getBulletin() {
  return getSetting("bulletin_cache") || "";
}

// ── Writes ─────────────────────────────────────────────────────────────

export function appendNode(partial) {
  const nodes = getMemoryNodes();
  const m = migrateNode({
    ...partial,
    id: partial.id || randomUUID(),
    created_at: NOW(),
    updated_at: NOW(),
    last_accessed_at: NOW(),
    source: partial.source || "chat",
    tier: partial.tier || "working",
    status: partial.status || "active",
    importance: partial.importance ?? 0.3,
  });
  // Cheap auto-linking: any existing node with Jaccard ≥ 0.4 gets a bidir edge.
  const tks = nodeTokens(m);
  for (const n of nodes) {
    if (!n.id || n.status !== "active" || n.forgotten) continue;
    const s = jaccard(tks, nodeTokens(n));
    if (s >= 0.4) {
      m.related_ids = Array.from(new Set([...(m.related_ids || []), n.id]));
      n.related_ids = Array.from(new Set([...(n.related_ids || []), m.id]));
      n.updated_at = NOW();
    }
  }
  nodes.push(m);
  setMemoryNodes(nodes);
  return m;
}

// ── Backups ────────────────────────────────────────────────────────────

export function backupDatabase() {
  try {
    const dir = backupPath();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
    const target = backupPath(`bonaparte-${stamp}.json`);
    const src = userPath("bonaparte.json");
    if (!existsSync(src)) return null;
    writeFileSync(target, readFileSync(src, "utf8"));

    // Rotate: keep the last 5 by mtime.
    const existing = readdirSync(dir)
      .filter((f) => f.startsWith("bonaparte-") && f.endsWith(".json"))
      .map((f) => ({ f, t: statSync(resolve(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const stale of existing.slice(5)) unlinkSync(resolve(dir, stale.f));
    return target;
  } catch (err) {
    console.warn("[memory] backup failed:", err.message);
    return null;
  }
}

// ── Health ─────────────────────────────────────────────────────────────

export function getHealth() {
  const nodes = getMemoryNodes();
  const active = nodes.filter((n) => n.status === "active" && !n.forgotten);
  const byType = {};
  for (const n of active) byType[n.type] = (byType[n.type] || 0) + 1;
  const byTier = { working: 0, graph: 0 };
  for (const n of active) byTier[n.tier || "graph"]++;
  return {
    total: nodes.length,
    active: active.length,
    forgotten: nodes.filter((n) => n.forgotten).length,
    byType,
    byTier,
    bulletin: getBulletin(),
    lastHeartbeatAt: getSetting("heartbeat_last_at"),
    lastHeartbeatSummary: getSetting("heartbeat_last_summary"),
    journal: (getSetting("heartbeat_journal") || []).slice(0, 5),
  };
}
