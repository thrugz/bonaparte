#!/usr/bin/env node
/**
 * Bonaparte — standalone web app.
 * Express server with auth, API routes, background scheduler.
 *
 * Usage: npm start
 */
import express from "express";
import session from "express-session";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync } from "fs";

import { requireAuth, loginHandler, logoutHandler, meHandler } from "./middleware/auth.js";
import { getRecentRuns, getLastRun, getMemoryNodes, setMemoryNodes } from "./lib/db.js";
import { SLACK_BOT_TOKEN, HUBSPOT_TOKEN } from "./tools/config.js";
import { startScheduler, getScheduledJobs, runJobManually } from "./jobs/scheduler.js";
import { startSlackBot } from "./lib/slack-bot.js";
import { getSetting, setSetting } from "./lib/db.js";
import { search } from "./tools/research.js";
import { evaluateFeatures, evaluateCompetitor, chat, chatStream } from "./lib/claude.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ── One-time memory seed (migrate from Slack canvas to db) ──
if (getMemoryNodes().length === 0) {
  const seed = [
    { type:"SIGNAL", score:2, description:"COWI: four new users added Mar 11, no deal opened. Deadline 2026-03-28 passed unactioned. Decayed from SIGNAL-3 on 7 Apr. Owner: Josephine.", tags:["COWI","expansion","action-required"], deadline:"2026-03-28", status:"active" },
    { type:"SIGNAL", score:2, description:"Ramboll has two live platform users (alsk@ and csdp@ at ramboll.dk). Identity unknown. No deal recorded. Must identify before outreach.", tags:["Ramboll","platform-access","action-required"], deadline:null, status:"active" },
    { type:"SIGNAL", score:2, description:"FLC: 295 contacts, 55% Tier 1, avg score 5.9. Real employer unknown for most. Enrichment via LinkedHelper real_company needed, target Q2 2026.", tags:["FLC","enrichment","Femern"], deadline:null, status:"active" },
    { type:"SIGNAL", score:2, description:"Pipeline hygiene: 14 of 23 open deals (61%) are past close date. Oldest overdue: PCL (66 days), NNE (59 days), Yrgo (46 days), AFRY Enterprise (39 days). Affects Bram, Josephine, and Casper. Needs bulk review.", tags:["pipeline","hygiene","action-required"], deadline:"2026-04-14", status:"active" },
    { type:"SIGNAL", score:2, description:"FLC contacts batch activity: 307 contacts modified since Mar 25, mostly FLC/flc-jv.com updated today Apr 7. Verify whether this is platform activity or a sync/enrichment run.", tags:["FLC","activity","watch"], deadline:null, status:"active" },
    { type:"SIGNAL", score:1, description:"DEME: 6 contacts, avg score 4.8, 50% Tier 1. Lowest engagement. May reflect use case gap or onboarding issue.", tags:["DEME","engagement","watch"], deadline:null, status:"active" },
    { type:"FACT", score:2, description:"COWI has 154 HubSpot contacts, avg score 6.9, 70% Tier 1. Largest contact base. No open deal recorded. Account owned by Josephine.", tags:["COWI","engagement","pipeline-gap"], deadline:null, status:"active" },
    { type:"FACT", score:1, description:"COWI sent unprompted positive note about Vitus dev team responsiveness on Femern project.", tags:["COWI","relationship","Femern"], deadline:null, status:"active" },
    { type:"CONTEXT", score:2, description:"COWI strategic angle: project-based adoption on Femern. Expansion play is project to enterprise. memg@cowi.com is likely champion, survey respondent, scores non-BIM communication 4/10.", tags:["COWI","strategy","champion"], deadline:null, status:"active" },
    { type:"CONTEXT", score:2, description:"Ramboll strategic angle: multi-CDE environments, large infrastructure, ISO 19650 compliance. Consultancy in both appointing and appointed party roles. Multi-stakeholder sale.", tags:["Ramboll","strategy","ICP"], deadline:null, status:"active" },
    { type:"FACT", score:2, description:"Fehmarnbelt tunnel: 18km immersed tunnel, construction since 2020. Completion slipped to approx 2031. FLC consortium: VINCI, Aarsleff, Max Bogl, BAM, Wayss and Freytag, CFE, Soletanche-Bachy, DEME. COWI is consultant.", tags:["Femern","FLC","timeline","COWI"], deadline:null, status:"active" },
    { type:"FACT", score:1, description:"Ramboll last HubSpot note Mar 9. Trigger unknown.", tags:["Ramboll","HubSpot"], deadline:null, status:"active" },
    { type:"FACT", score:2, description:"Adoption baseline 23 March 2026: 515 contacts, avg score 6.1, 58% Tier 1 (298), 29% Tier 2 (151), 10% Tier 3 (51), 2% inactive (12).", tags:["platform","adoption","baseline"], deadline:null, status:"active" },
    { type:"FACT", score:1, description:"Top scoring accounts: Max Bogl 8.0 (2 users), Femern AS 7.3 (3), SBF 7.2 (4), CN3 7.0 (35), COWI 6.9 (99).", tags:["platform","adoption","top-accounts"], deadline:null, status:"active" },
    { type:"FACT", score:2, description:"Open pipeline: 23 deals, 14 overdue. Bram: 3 overdue (Voult, EK EDU, EK Erhvervsakademi). Casper: 3 overdue (AFRY, HSD, Gjorgensen). Josephine: 8 overdue. Total pipeline includes deals closing Apr-Jul.", tags:["pipeline","deals","snapshot-7Apr"], deadline:null, status:"active" },
    { type:"PATTERN", score:2, description:"Pipeline gap: multiple key accounts (COWI, Ramboll, CN3) show strong platform engagement but no recorded deals in HubSpot.", tags:["pipeline","engagement-gap"], deadline:null, status:"active" },
    { type:"PATTERN", score:2, description:"Deal staleness: 61% of open deals are past close date. Not account-specific, this is a process/hygiene issue across owners.", tags:["pipeline","hygiene"], deadline:null, status:"active" },
    { type:"DECISION", score:0, description:"COWI account ownership assigned to Josephine, 7 April 2026. Bram's decision.", tags:["COWI","ownership","Josephine"], deadline:null, status:"active" },
    { type:"DECISION", score:0, description:"Bonaparte memory system redesigned 25 March 2026. Typed, tagged, scored nodes with relationship edges.", tags:["Bonaparte","system"], deadline:null, status:"active" },
    { type:"DECISION", score:0, description:"Bonaparte Slack canvases created 25 March 2026.", tags:["Bonaparte","system"], deadline:null, status:"active" },
    { type:"DECISION", score:0, description:"Bonaparte architecture moved to MCP connectors plus remote triggers 26 March 2026. Local scripts removed. Background jobs on Anthropic infra.", tags:["Bonaparte","system","architecture"], deadline:null, status:"active" },
    { type:"DECISION", score:0, description:"Memory store split from display canvas 26 March 2026. Pipe-delimited data store for reliable parsing, Memory Graph canvas for display only.", tags:["Bonaparte","system","memory"], deadline:null, status:"active" },
  ];
  setMemoryNodes(seed);
  console.log("Seeded database with 22 memory nodes from Slack canvas migration");
}

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.APP_PASSWORD || "bonaparte-default-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// ── Auth routes ──

app.get("/login", (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/login.html"));
});
app.post("/login", loginHandler);
app.get("/logout", logoutHandler);
app.get("/api/me", meHandler);

// ── Static files (after login check for main pages) ──

app.get("/", requireAuth, (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/index.html"));
});
app.get("/settings", requireAuth, (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/settings.html"));
});
app.get("/timeline", requireAuth, (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/timeline.html"));
});
app.get("/competitors", requireAuth, (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/competitors.html"));
});
app.get("/features", requireAuth, (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/features.html"));
});
app.get("/vchat", requireAuth, (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/vchat.html"));
});
app.get("/content", requireAuth, (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/content.html"));
});
app.get("/timeline", requireAuth, (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/timeline.html"));
});
app.get("/account", requireAuth, (req, res) => {
  res.sendFile(resolve(__dirname, "ui/public/account.html"));
});
app.use(express.static(resolve(__dirname, "ui/public")));

// ── HubSpot helpers ──

const CONTACT_PROPS = [
  "firstname", "lastname", "email", "company", "jobtitle",
  "hubspot_owner_id", "purgatory_status", "vitus_engagement_score",
  "vitus_tier", "lastmodifieddate", "last_login", "real_company",
  "model_load",
  "used_dashboards", "used_properties",
  "used_saved_views", "used_display_filter",
  "used_sketch", "used_colorize",
  "hs_analytics_num_page_views", "hs_analytics_num_visits",
  "hs_analytics_source", "hs_analytics_last_visit_timestamp",
];

const HS_PORTAL = "146127203";
const HS_BASE = `https://app-eu1.hubspot.com/contacts/${HS_PORTAL}`;

function formatContact(c) {
  const p = c.properties;
  const achievements = {
    dashboards: !!p.used_dashboards,
    properties: !!p.used_properties,
    savedViews: !!p.used_saved_views,
    displayFilter: !!p.used_display_filter,
    sketch: !!p.used_sketch,
    colorize: !!p.used_colorize,
  };
  let score = 0;
  if (achievements.dashboards) score += 2;
  if (achievements.properties) score += 2;
  if (achievements.savedViews) score += 2;
  if (achievements.displayFilter) score += 1;
  if (achievements.sketch) score += 1;
  if (achievements.colorize) score += 1;
  if (p.last_login) {
    const daysSinceLogin = (Date.now() - new Date(p.last_login).getTime()) / 86400000;
    if (daysSinceLogin <= 30) score += 1;
  }
  score = Math.min(score, 9);
  return {
    id: c.id,
    url: `${HS_BASE}/record/0-1/${c.id}`,
    name: [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email,
    email: p.email,
    company: p.company || p.real_company || "",
    jobTitle: p.jobtitle || "",
    owner: p.hubspot_owner_id,
    purgatory: p.purgatory_status || null,
    score,
    tier: score >= 7 ? 1 : score >= 3 ? 2 : score >= 1 ? 3 : 0,
    lastLogin: p.last_login,
    lastModified: p.lastmodifieddate,
    modelLoad: !!p.model_load,
    achievements,
    pageViews: parseInt(p.hs_analytics_num_page_views || "0"),
    visits: parseInt(p.hs_analytics_num_visits || "0"),
    source: p.hs_analytics_source || "",
    lastVisit: p.hs_analytics_last_visit_timestamp,
  };
}

async function hsSearch(objectType, filterGroups = [], properties = [], limit = 100) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filterGroups,
      properties,
      limit,
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}`);
  return res.json();
}

async function fetchAllContacts() {
  const results = [];
  const props = CONTACT_PROPS.join(",");
  let after;
  for (let i = 0; i < 50; i++) {
    const url = `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=${props}` + (after ? `&after=${after}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) break;
    const data = await res.json();
    results.push(...(data.results || []).map(formatContact));
    if (!data.paging?.next?.after) break;
    after = data.paging.next.after;
  }
  return results;
}

// ── API routes (all require auth) ──

app.get("/api/memory", requireAuth, (req, res) => {
  try {
    const nodes = getMemoryNodes();
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory", requireAuth, (req, res) => {
  try {
    const nodes = req.body;
    if (!Array.isArray(nodes)) return res.status(400).json({ error: "Expected array of nodes" });
    setMemoryNodes(nodes);
    res.json({ ok: true, count: nodes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/bulletin", requireAuth, (req, res) => {
  try {
    // Prefer Claude-generated bulletin from last consolidation
    const stored = getSetting("last_bulletin");
    if (stored) {
      const date = getSetting("last_bulletin_date") || "";
      return res.json({ content: stored, date });
    }
    // Fallback: build from raw nodes
    const nodes = getMemoryNodes();
    const signals = nodes.filter((n) => n.type === "SIGNAL" && n.status === "active").sort((a, b) => b.score - a.score);
    const patterns = nodes.filter((n) => n.type === "PATTERN" && n.status === "active");
    const stale = nodes.filter((n) => n.status === "stale");
    const lines = [];
    if (signals.length) {
      lines.push("Active signals: " + signals.slice(0, 5).map((s) => `[${s.score}] ${s.description}`).join("; "));
    }
    if (patterns.length) {
      lines.push("Patterns: " + patterns.map((p) => p.description).join("; "));
    }
    if (stale.length) {
      lines.push(`${stale.length} stale node(s) need attention.`);
    }
    if (!lines.length) lines.push("No active signals or patterns.");
    res.json({ content: lines.join("\n\n") });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/contacts", requireAuth, async (req, res) => {
  try {
    const props = CONTACT_PROPS.join(",");
    const r = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=${props}`, {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    });
    if (!r.ok) throw new Error(`HubSpot ${r.status}`);
    const data = await r.json();
    res.json(data.results.map(formatContact));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/contacts/all", requireAuth, async (req, res) => {
  try { res.json(await fetchAllContacts()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Deals route moved to bottom (supports ?company= filter)

app.get("/api/pilots", requireAuth, async (req, res) => {
  try {
    const data = await hsSearch("deals", [
      { filters: [{ propertyName: "dealstage", operator: "EQ", value: "decisionmakerboughtin" }] },
    ], [
      "dealname", "dealstage", "amount", "closedate", "createdate",
      "hubspot_owner_id", "pipeline", "lastmodifieddate",
      "hs_deal_stage_probability", "description", "notes_last_updated",
    ], 100);
    const deals = data.results.map((d) => ({
      id: d.id,
      url: `${HS_BASE}/record/0-3/${d.id}`,
      ...d.properties,
    }));
    res.json(deals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/purgatory", requireAuth, async (req, res) => {
  try {
    const all = await fetchAllContacts();
    res.json(all.filter((c) => c.purgatory));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/champions", requireAuth, async (req, res) => {
  try {
    const all = await fetchAllContacts();
    res.json(all.filter((c) => c.tier === 1).sort((a, b) => b.score - a.score));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Job routes ──

app.get("/api/jobs", requireAuth, async (req, res) => {
  try {
    const runs = getRecentRuns(50);
    const scheduled = await getScheduledJobs();
    res.json({ runs, scheduled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/jobs/:name/run", requireAuth, async (req, res) => {
  try {
    const result = await runJobManually(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// ── Settings routes ──

const TOKEN_KEYS = ["SLACK_BOT_TOKEN", "SLACK_USER_TOKEN", "HUBSPOT_TOKEN", "VITUS_API_KEY", "TAVILY_API_KEY", "ANTHROPIC_API_KEY", "APP_PASSWORD"];

app.get("/api/settings/tokens", requireAuth, (req, res) => {
  const tokens = {};
  for (const key of TOKEN_KEYS) {
    const val = process.env[key] || "";
    tokens[key] = val ? val.slice(0, 4) + "..." + val.slice(-4) : "(not set)";
  }
  res.json(tokens);
});

app.post("/api/settings/tokens", requireAuth, (req, res) => {
  try {
    const updates = req.body; // { KEY: "value", ... }
    const envPath = resolve(__dirname, "config", ".env");
    let content = readFileSync(envPath, "utf-8");

    for (const [key, value] of Object.entries(updates)) {
      if (!TOKEN_KEYS.includes(key)) continue;
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }
      process.env[key] = value;
    }
    writeFileSync(envPath, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/settings/test-token", requireAuth, async (req, res) => {
  const { key } = req.body;
  const value = process.env[key];
  if (!value) return res.json({ ok: false, error: "Not configured" });

  try {
    if (key === "SLACK_BOT_TOKEN" || key === "SLACK_USER_TOKEN") {
      const r = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { Authorization: `Bearer ${value}` },
      });
      const data = await r.json();
      res.json({ ok: data.ok, detail: data.ok ? data.user : data.error });
    } else if (key === "HUBSPOT_TOKEN") {
      const r = await fetch("https://api.hubapi.com/account-info/v3/details", {
        headers: { Authorization: `Bearer ${value}` },
      });
      res.json({ ok: r.ok, detail: r.ok ? "Connected" : `HTTP ${r.status}` });
    } else if (key === "ANTHROPIC_API_KEY") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": value,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      res.json({ ok: r.ok, detail: r.ok ? "Connected" : `HTTP ${r.status}` });
    } else {
      res.json({ ok: true, detail: "No test available" });
    }
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Competitor routes ──

const DEFAULT_COMPETITORS = [
  { name: "Speckle", domain: "speckle.systems", angle: "Open-source data platform for AEC. Threat: developer-first, free tier, growing BIM interop story." },
  { name: "Power BI", domain: "powerbi.microsoft.com", angle: "Microsoft's BI tool. Threat: enterprises already have licenses, generic dashboards can approximate Vitus views." },
  { name: "Dalux", domain: "dalux.com", angle: "Field-to-office BIM platform. Threat: strong in Nordic AEC, quality assurance and field workflows overlap with Vitus use cases." },
];

function getCompetitors() {
  const stored = getSetting("competitors");
  if (stored) {
    try { return JSON.parse(stored); } catch {}
  }
  setSetting("competitors", JSON.stringify(DEFAULT_COMPETITORS));
  return DEFAULT_COMPETITORS;
}

app.get("/api/competitors", requireAuth, (req, res) => {
  res.json(getCompetitors());
});

app.post("/api/competitors", requireAuth, (req, res) => {
  const competitors = req.body;
  if (!Array.isArray(competitors)) return res.status(400).json({ error: "Expected array" });
  setSetting("competitors", JSON.stringify(competitors));
  res.json({ ok: true });
});

// Get saved competitor intel (must be before :name route)
app.get("/api/competitors/saved/intel", requireAuth, (req, res) => {
  const saved = JSON.parse(getSetting("competitor_intel") || "{}");
  res.json(saved);
});

app.get("/api/competitors/:name/intel", requireAuth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const competitors = getCompetitors();
  const comp = competitors.find((c) => c.name === name);
  if (!comp) return res.status(404).json({ error: "Competitor not found" });

  try {
    const [news, product, market] = await Promise.all([
      search(`"${comp.name}" AEC BIM construction news 2026`),
      search(`"${comp.name}" product updates features release 2026`),
      search(`"${comp.name}" vs competitors BIM data platform comparison`),
    ]);
    // Build intel context for Claude evaluation
    const intelContext = [
      news.answer, product.answer, market.answer,
      ...(news.sources || []).map((s) => s.snippet),
      ...(product.sources || []).map((s) => s.snippet),
      ...(market.sources || []).map((s) => s.snippet),
    ].filter(Boolean).join("\n");

    let scorecard = null;
    let scorecardError = null;
    try {
      scorecard = await evaluateCompetitor(comp.name, comp.angle, intelContext);
    } catch (err) {
      scorecardError = err.message;
    }

    const result = {
      name: comp.name,
      domain: comp.domain,
      angle: comp.angle,
      sections: [
        { title: "Recent News", ...news },
        { title: "Product Updates", ...product },
        { title: "Competitive Positioning", ...market },
      ],
      scorecard,
      scorecardError,
      fetchedAt: new Date().toISOString(),
    };

    // Auto-save intel result
    const saved = JSON.parse(getSetting("competitor_intel") || "{}");
    saved[comp.name] = result;
    setSetting("competitor_intel", JSON.stringify(saved));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Competitor vs Market Demand matrix
app.get("/api/competitors/demand-matrix", requireAuth, async (req, res) => {
  const insightsPath = resolve(__dirname, "data", "survey-insights.json");
  if (!existsSync(insightsPath)) return res.status(404).json({ error: "No survey data" });

  const survey = JSON.parse(readFileSync(insightsPath, "utf-8"));
  const demands = survey.market_demands.sort((a, b) => b.demand_score - a.demand_score);
  const savedIntel = JSON.parse(getSetting("competitor_intel") || "{}");
  const compNames = Object.keys(savedIntel);

  if (!compNames.length) return res.json({ demands: demands.map(d => ({ id: d.id, name: d.name, demand_score: d.demand_score, vitus_status: d.vitus_status, vitus_gap: d.gap, competitors: {} })), competitors: [] });

  // Build compact context for each competitor from saved intel
  const compContext = compNames.map(name => {
    const c = savedIntel[name];
    const dims = (c.scorecard?.dimensions || []).map(d => `${d.name}:${d.score}/10`).join(", ");
    const verdict = c.scorecard?.verdict || "";
    const news = (c.sections || []).map(s => s.answer || "").filter(Boolean).join(" ").slice(0, 300);
    return `${name}: ${dims}. ${verdict} ${news}`;
  }).join("\n\n");

  const demandList = demands.map(d => `${d.id}: ${d.name} (${d.demand_score}/10)`).join("\n");

  try {
    const { ask } = await import("./lib/claude.js");
    const prompt = `Rate how well each competitor addresses these market demands. Score 0-3: 0=no coverage, 1=minimal, 2=partial, 3=strong.

COMPETITORS:
${compContext}

MARKET DEMANDS:
${demandList}

Return ONLY a JSON object where keys are demand IDs and values are objects mapping competitor names to scores:
{"data-integration":{"Speckle":3,"Dalux":1},...}`;

    const reply = await ask(prompt, 2000, { fast: true });
    const scores = JSON.parse(reply.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, ""));

    const result = demands.map(d => ({
      id: d.id,
      name: d.name,
      demand_score: d.demand_score,
      vitus_status: d.vitus_status,
      vitus_gap: d.gap,
      competitors: scores[d.id] || {},
    }));

    res.json({ demands: result, competitors: compNames });
  } catch (err) {
    // Fallback: return demands without competitor scores
    res.json({
      demands: demands.map(d => ({ id: d.id, name: d.name, demand_score: d.demand_score, vitus_status: d.vitus_status, vitus_gap: d.gap, competitors: {} })),
      competitors: compNames,
      error: err.message,
    });
  }
});

// ── Feature Hunt routes ──

const DEFAULT_FEATURE_SOURCES = [
  { name: "Autodesk", domain: "autodesk.com construction cloud" },
  { name: "Trimble", domain: "trimble.com connect viewpoint" },
  { name: "Procore", domain: "procore.com" },
  { name: "Nemetschek", domain: "nemetschek.com bluebeam allplan" },
  { name: "Bentley Systems", domain: "bentley.com iTwin" },
  { name: "Speckle", domain: "speckle.systems" },
  { name: "Dalux", domain: "dalux.com" },
  { name: "Oracle Aconex", domain: "oracle.com aconex construction" },
  { name: "Newforma", domain: "newforma.com konekt" },
  { name: "BIM Track", domain: "bimtrack.co" },
];

function getFeatureSources() {
  const stored = getSetting("feature_sources");
  if (stored) {
    try { return JSON.parse(stored); } catch {}
  }
  setSetting("feature_sources", JSON.stringify(DEFAULT_FEATURE_SOURCES));
  return DEFAULT_FEATURE_SOURCES;
}

app.get("/api/features/sources", requireAuth, (req, res) => {
  res.json(getFeatureSources());
});

app.post("/api/features/sources", requireAuth, (req, res) => {
  const sources = req.body;
  if (!Array.isArray(sources)) return res.status(400).json({ error: "Expected array" });
  setSetting("feature_sources", JSON.stringify(sources));
  res.json({ ok: true });
});

app.get("/api/features/hunt", requireAuth, async (req, res) => {
  const sources = getFeatureSources();

  try {
    // Search each source for new features/product updates
    const searches = sources.map((s) =>
      search(`"${s.name}" ${s.domain} new feature product update 2026`)
        .then((result) => ({ source: s.name, ...result }))
        .catch(() => ({ source: s.name, answer: null, sources: [] }))
    );
    const results = await Promise.all(searches);

    // Flatten into feature list
    const features = [];
    for (const r of results) {
      if (!r.sources?.length && !r.answer) continue;
      // Use each source result as a feature entry
      for (const src of (r.sources || []).slice(0, 3)) {
        features.push({
          title: src.title || "Untitled",
          description: src.snippet || "",
          url: src.url || "",
          source: r.source,
        });
      }
    }

    // Evaluate features against Vitus product using Claude
    let evaluated = features;
    let evaluationError = null;
    try {
      evaluated = await evaluateFeatures(features);
    } catch (err) {
      evaluationError = err.message;
    }

    const result = {
      features: evaluated,
      evaluationError,
      fetchedAt: new Date().toISOString(),
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Content Ideas routes ──

app.get("/api/content/ideas", requireAuth, (req, res) => {
  const saved = getSetting("content_ideas");
  if (!saved) return res.json(null);
  try { res.json(JSON.parse(saved)); } catch { res.json(null); }
});

app.post("/api/content/ideas", requireAuth, (req, res) => {
  const data = req.body;
  if (!data) return res.status(400).json({ error: "No data" });
  setSetting("content_ideas", JSON.stringify(data));
  res.json({ ok: true });
});

app.post("/api/content/generate", requireAuth, async (req, res) => {
  const { category } = req.body || {};

  try {
    // Gather all context
    const contextParts = [];

    // Memory nodes
    const nodes = getMemoryNodes();
    const signals = nodes.filter(n => n.type === "SIGNAL" && n.status === "active");
    const facts = nodes.filter(n => n.type === "FACT" && n.status === "active");
    const patterns = nodes.filter(n => n.type === "PATTERN" && n.status === "active");
    if (signals.length) contextParts.push("ACTIVE SIGNALS:\n" + signals.map(s => `[${s.score}] ${s.description}`).join("\n"));
    if (patterns.length) contextParts.push("PATTERNS:\n" + patterns.map(p => p.description).join("\n"));
    if (facts.length) contextParts.push("KEY FACTS:\n" + facts.map(f => f.description).join("\n"));

    // Market demand from survey (top 8 only to save tokens)
    const insightsPath = resolve(__dirname, "data", "survey-insights.json");
    if (existsSync(insightsPath)) {
      try {
        const survey = JSON.parse(readFileSync(insightsPath, "utf-8"));
        contextParts.push("MARKET DEMAND (survey, " + survey.meta.respondents + " AEC pros):\n" +
          survey.market_demands.sort((a, b) => b.demand_score - a.demand_score).slice(0, 8)
            .map(d => `${d.demand_score}/10 ${d.name}`).join("\n"));
      } catch {}
    }

    // Saved competitor intel (verdicts only)
    try {
      const intel = JSON.parse(getSetting("competitor_intel") || "{}");
      const compNames = Object.keys(intel);
      if (compNames.length) {
        contextParts.push("COMPETITORS: " + compNames.map(name => {
          const v = intel[name]?.scorecard?.verdict || "";
          return v ? `${name}: ${v.slice(0, 100)}` : name;
        }).join(". "));
      }
    } catch {}

    const categoryFilter = category ? `\nFocus specifically on: ${category}` : "";

    const { ask } = await import("./lib/claude.js");
    const context = contextParts.join("\n");
    const prompt = `Generate 8 marketing content ideas for Vitus (BIM data platform on ACC). Audience: BIM managers, VDC leads at large AEC firms in Nordics/France/Switzerland. Voice: warm, direct, no buzzwords, ISO 19650 angles.
${categoryFilter}

DATA:
${context}

Per idea return JSON: title (max 10 words), format (linkedin_post|blog|case_study|video_short|carousel|email_sequence|webinar|whitepaper), angle (1 sentence), data_hook (1 sentence), target (role+pain), value (1-10), difficulty (1-10), category (thought_leadership|product|social_proof|education|market_insight|competitive).

Respond with ONLY a valid JSON array.`;

    const reply = await ask(prompt, 3000, { fast: true });

    let ideas;
    try {
      ideas = JSON.parse(reply.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, ""));
    } catch {
      return res.status(500).json({ error: "Failed to parse AI response" });
    }

    res.json({ ideas, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save feature hunt results
app.post("/api/features/save", requireAuth, (req, res) => {
  const data = req.body;
  if (!data || !data.features) return res.status(400).json({ error: "No features to save" });
  setSetting("saved_features", JSON.stringify(data));
  res.json({ ok: true });
});

// Get saved feature hunt results
app.get("/api/features/saved", requireAuth, (req, res) => {
  const saved = getSetting("saved_features");
  if (!saved) return res.json(null);
  try {
    res.json(JSON.parse(saved));
  } catch {
    res.json(null);
  }
});

// ── vChat routes ──

app.post("/api/chat", requireAuth, async (req, res) => {
  const { messages, context_type, context_data } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  try {
    // Build data context from available sources
    const contextParts = [];

    // Always include memory nodes (sync, instant)
    const nodes = getMemoryNodes();
    const activeSignals = nodes.filter(n => n.type === "SIGNAL" && n.status === "active");
    const facts = nodes.filter(n => n.type === "FACT" && n.status === "active");
    const patterns = nodes.filter(n => n.type === "PATTERN" && n.status === "active");
    contextParts.push(`MEMORY NODES:
Signals (${activeSignals.length}): ${activeSignals.map(s => `[${s.score}] ${s.description}`).join("; ")}
Facts (${facts.length}): ${facts.map(f => f.description).join("; ")}
Patterns (${patterns.length}): ${patterns.map(p => p.description).join("; ")}`);

    // Load market demand (sync file read, instant)
    const insightsPath = resolve(__dirname, "data", "survey-insights.json");
    if (existsSync(insightsPath)) {
      try {
        const survey = JSON.parse(readFileSync(insightsPath, "utf-8"));
        const demandSummary = survey.market_demands
          .sort((a, b) => b.demand_score - a.demand_score)
          .map(d => `${d.demand_score}/10 ${d.name} (${d.vitus_status}): ${d.gap}`)
          .join("\n");
        contextParts.push(`MARKET DEMAND (Onsight survey, ${survey.meta.respondents} respondents):\n${demandSummary}`);
      } catch {}
    }

    // Fetch bulletin, contacts, deals, email stats, recent emails, events in parallel
    const [bulResult, contactsResult, dealsResult, emailsResult, recentEmailsResult, eventsResult] = await Promise.allSettled([
      fetch(`http://localhost:${PORT}/api/bulletin`, {
        headers: { cookie: req.headers.cookie },
        signal: AbortSignal.timeout(5000),
      }).then(r => r.ok ? r.json() : null),
      fetch(`http://localhost:${PORT}/api/contacts/all`, {
        headers: { cookie: req.headers.cookie },
        signal: AbortSignal.timeout(15000),
      }).then(r => r.ok ? r.json() : null),
      fetch(`http://localhost:${PORT}/api/deals`, {
        headers: { cookie: req.headers.cookie },
        signal: AbortSignal.timeout(10000),
      }).then(r => r.ok ? r.json() : null),
      fetch(`http://localhost:${PORT}/api/emails/stats`, {
        headers: { cookie: req.headers.cookie },
        signal: AbortSignal.timeout(10000),
      }).then(r => r.ok ? r.json() : null),
      fetchRecentEmails(30),
      buildEventConversion().catch(() => null),
    ]);

    if (bulResult.status === "fulfilled" && bulResult.value?.content) {
      const bul = bulResult.value;
      contextParts.push(`CURRENT BULLETIN${bul.date ? ` (${bul.date})` : ""}:\n${bul.content}`);
    }

    if (contactsResult.status === "fulfilled" && contactsResult.value) {
      const contacts = contactsResult.value;
      const byCompany = {};
      contacts.forEach(c => {
        const co = c.company || "Unknown";
        (byCompany[co] = byCompany[co] || []).push(c);
      });
      const summary = Object.entries(byCompany)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 20)
        .map(([name, cs]) => {
          const avg = (cs.reduce((s, c) => s + c.score, 0) / cs.length).toFixed(1);
          const t1 = Math.round(cs.filter(c => c.tier === 1).length / cs.length * 100);
          return `${name}: ${cs.length} contacts, avg ${avg}/9, ${t1}% T1`;
        }).join("\n");
      contextParts.push(`HUBSPOT ACCOUNTS (top 20 by size):\n${summary}\nTotal contacts: ${contacts.length}`);
    }

    if (dealsResult.status === "fulfilled" && dealsResult.value) {
      const deals = dealsResult.value;
      const dealSummary = deals.map(d =>
        `${d.dealname}: stage=${d.dealstage}, amount=${d.amount || "?"}, close=${d.closedate || "?"}, owner=${d.hubspot_owner_id}`
      ).join("\n");
      contextParts.push(`HUBSPOT DEALS (${deals.length}):\n${dealSummary}`);
    }

    if (emailsResult.status === "fulfilled" && emailsResult.value) {
      const stats = emailsResult.value;
      let emailCtx = `EMAIL ACTIVITY: ${stats.total} recent emails (${stats.inbound} inbound, ${stats.outbound} outbound, ${stats.threads} threads)`;
      if (stats.noReply.length > 0) {
        emailCtx += `\nUNANSWERED OUTBOUND (sent, no reply):`;
        stats.noReply.slice(0, 10).forEach(nr => {
          emailCtx += `\n- "${nr.subject}" to ${nr.to}, ${nr.daysSince} days ago`;
        });
      }
      contextParts.push(emailCtx);
    }

    if (recentEmailsResult.status === "fulfilled" && recentEmailsResult.value) {
      const emails = recentEmailsResult.value;
      const digest = emails.slice(0, 20).map(e => {
        const dir = e.direction === "in" ? "IN" : "OUT";
        const body = e.body ? e.body.replace(/\s+/g, " ").slice(0, 200) : "";
        return `[${dir}] "${e.subject}" ${e.from} -> ${e.to} (${e.timestamp})\n${body}`;
      }).join("\n\n");
      contextParts.push(`RECENT EMAIL CONTENT (20 most recent):\n${digest}`);
    }

    if (eventsResult.status === "fulfilled" && eventsResult.value) {
      contextParts.push(formatEventContext(eventsResult.value));
    }

    // If panel-specific context is provided, prepend it
    if (context_type && context_data) {
      contextParts.unshift(`PANEL CONTEXT (${context_type}):\n${context_data}`);
    }

    const dataContext = contextParts.join("\n\n---\n\n");
    const reply = await chat(messages, dataContext);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Market Demand routes (Onsight survey insights) ──

app.get("/api/market-demand", requireAuth, (req, res) => {
  const insightsPath = resolve(__dirname, "data", "survey-insights.json");
  if (!existsSync(insightsPath)) {
    return res.status(404).json({ error: "Survey insights data not found" });
  }
  try {
    const data = JSON.parse(readFileSync(insightsPath, "utf-8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Email intelligence ──

// ── Email intelligence (CRM v3 emails search, requires sales-email-read scope) ──

const EMAIL_PROPS = [
  "hs_email_subject", "hs_email_direction", "hs_email_status",
  "hs_email_from_email", "hs_email_to_email", "hs_timestamp",
  "hubspot_owner_id", "hs_email_text",
];

async function fetchRecentEmails(limit = 100) {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/emails/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      filterGroups: [],
      properties: EMAIL_PROPS,
      limit,
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HubSpot emails ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(e => ({
    id: e.id,
    subject: e.properties.hs_email_subject || "",
    direction: e.properties.hs_email_direction === "INCOMING_EMAIL" ? "in" : "out",
    from: e.properties.hs_email_from_email || "",
    to: e.properties.hs_email_to_email || "",
    timestamp: e.properties.hs_timestamp,
    owner: e.properties.hubspot_owner_id,
    status: e.properties.hs_email_status || "",
    body: (e.properties.hs_email_text || "").slice(0, 300),
  }));
}

function buildEmailStats(emails) {
  const threads = {};
  for (const e of emails) {
    const key = e.subject.replace(/^Re:\s*/i, "").trim().toLowerCase();
    if (!threads[key]) threads[key] = { subject: e.subject.replace(/^Re:\s*/i, ""), emails: [] };
    threads[key].emails.push(e);
  }

  // Find unanswered outbound (sent, no incoming reply on same thread within 3+ days)
  const noReply = [];
  const now = Date.now();
  for (const [, t] of Object.entries(threads)) {
    const outbound = t.emails.filter(e => e.direction === "out").sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const inbound = t.emails.filter(e => e.direction === "in");
    if (outbound.length > 0 && inbound.length === 0) {
      const lastSent = new Date(outbound[0].timestamp);
      const daysAgo = Math.round((now - lastSent) / 86400000);
      if (daysAgo >= 3) {
        noReply.push({ subject: t.subject, to: outbound[0].to, daysSince: daysAgo, sentAt: outbound[0].timestamp });
      }
    }
  }

  return {
    total: emails.length,
    inbound: emails.filter(e => e.direction === "in").length,
    outbound: emails.filter(e => e.direction === "out").length,
    threads: Object.keys(threads).length,
    noReply: noReply.sort((a, b) => b.daysSince - a.daysSince),
  };
}

function formatEventContext(events) {
  if (!events || !events.length) return "";
  let ctx = "MARKETING EVENT CONVERSION:";
  for (const e of events) {
    const gapParts = [];
    if (e.gaps.noCompany) gapParts.push(`${e.gaps.noCompany} missing company`);
    if (e.gaps.noLifecycle) gapParts.push(`${e.gaps.noLifecycle} missing lifecycle`);
    if (e.gaps.noEmail) gapParts.push(`${e.gaps.noEmail} missing email`);
    ctx += `\n${e.name}: invited=${e.invited}, attended=${e.attended}, converted=${e.converted} (${e.conversionRate}%), pipeline=${e.inPipeline}, data quality=${e.dataQuality}%`;
    if (gapParts.length) ctx += ` [GAPS: ${gapParts.join(", ")}]`;
    if (e.companies.length) {
      ctx += `\n  Companies: ${e.companies.slice(0, 8).map(c => `${c.name}(${c.count}${c.converted ? ",conv:" + c.converted : ""})`).join(", ")}`;
    }
    // Flag unconverted attendees at known companies
    const unconverted = e.attendees.filter(a => !a.converted && !a.pipeline && a.company);
    if (unconverted.length) {
      ctx += `\n  Still leads: ${unconverted.slice(0, 5).map(a => `${a.name}@${a.company}`).join(", ")}${unconverted.length > 5 ? ` +${unconverted.length - 5} more` : ""}`;
    }
  }
  const totalAtt = events.reduce((s, e) => s + e.attended, 0);
  const totalConv = events.reduce((s, e) => s + e.converted, 0);
  ctx += `\nOVERALL: ${totalConv}/${totalAtt} converted (${totalAtt ? Math.round(totalConv / totalAtt * 100) : 0}%). Avg data quality: ${Math.round(events.reduce((s, e) => s + e.dataQuality, 0) / events.length)}%`;
  return ctx;
}

app.get("/api/emails", requireAuth, async (req, res) => {
  try {
    const emails = await fetchRecentEmails(100);
    const contact = req.query.contact;
    const filtered = contact
      ? emails.filter(e => e.from.includes(contact) || e.to.includes(contact))
      : emails;
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/emails/stats", requireAuth, async (req, res) => {
  try {
    const emails = await fetchRecentEmails(200);
    const stats = buildEmailStats(emails);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Streaming chat ──

app.post("/api/chat/stream", requireAuth, async (req, res) => {
  const { messages, context_type, context_data } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    // Build context (same as /api/chat but inline to avoid self-fetch)
    const contextParts = [];

    const nodes = getMemoryNodes();
    const activeSignals = nodes.filter(n => n.type === "SIGNAL" && n.status === "active");
    const facts = nodes.filter(n => n.type === "FACT" && n.status === "active");
    const patterns = nodes.filter(n => n.type === "PATTERN" && n.status === "active");
    contextParts.push(`MEMORY NODES:\nSignals (${activeSignals.length}): ${activeSignals.map(s => `[${s.score}] ${s.description}`).join("; ")}\nFacts (${facts.length}): ${facts.map(f => f.description).join("; ")}\nPatterns (${patterns.length}): ${patterns.map(p => p.description).join("; ")}`);

    const insightsPath = resolve(__dirname, "data", "survey-insights.json");
    if (existsSync(insightsPath)) {
      try {
        const survey = JSON.parse(readFileSync(insightsPath, "utf-8"));
        const demandSummary = survey.market_demands
          .sort((a, b) => b.demand_score - a.demand_score)
          .map(d => `${d.demand_score}/10 ${d.name} (${d.vitus_status}): ${d.gap}`)
          .join("\n");
        contextParts.push(`MARKET DEMAND (Onsight survey, ${survey.meta.respondents} respondents):\n${demandSummary}`);
      } catch {}
    }

    // Parallel HubSpot fetches (contacts, deals, emails, events)
    const cookie = req.headers.cookie;
    const [contactsResult, dealsResult, emailsResult, recentEmailsResult, eventsResult] = await Promise.allSettled([
      fetch(`http://localhost:${PORT}/api/contacts/all`, { headers: { cookie }, signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.json() : null),
      fetch(`http://localhost:${PORT}/api/deals`, { headers: { cookie }, signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`http://localhost:${PORT}/api/emails/stats`, { headers: { cookie }, signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetchRecentEmails(30),
      buildEventConversion().catch(() => null),
    ]);

    if (contactsResult.status === "fulfilled" && contactsResult.value) {
      const contacts = contactsResult.value;
      const byCompany = {};
      contacts.forEach(c => { const co = c.company || "Unknown"; (byCompany[co] = byCompany[co] || []).push(c); });
      const summary = Object.entries(byCompany).sort((a, b) => b[1].length - a[1].length).slice(0, 20)
        .map(([name, cs]) => {
          const avg = (cs.reduce((s, c) => s + c.score, 0) / cs.length).toFixed(1);
          const t1 = Math.round(cs.filter(c => c.tier === 1).length / cs.length * 100);
          return `${name}: ${cs.length} contacts, avg ${avg}/9, ${t1}% T1`;
        }).join("\n");
      contextParts.push(`HUBSPOT ACCOUNTS (top 20):\n${summary}\nTotal: ${contacts.length}`);
    }

    if (dealsResult.status === "fulfilled" && dealsResult.value) {
      const deals = dealsResult.value;
      contextParts.push(`HUBSPOT DEALS (${deals.length}):\n${deals.map(d => `${d.dealname}: stage=${d.dealstage}, amount=${d.amount || "?"}, close=${d.closedate || "?"}`).join("\n")}`);
    }

    if (emailsResult.status === "fulfilled" && emailsResult.value) {
      const stats = emailsResult.value;
      let emailCtx = `EMAIL ACTIVITY: ${stats.total} recent emails (${stats.inbound} inbound, ${stats.outbound} outbound, ${stats.threads} threads)`;
      if (stats.noReply.length > 0) {
        emailCtx += `\nUNANSWERED OUTBOUND (sent, no reply):`;
        stats.noReply.slice(0, 10).forEach(nr => {
          emailCtx += `\n- "${nr.subject}" to ${nr.to}, ${nr.daysSince} days ago`;
        });
      }
      contextParts.push(emailCtx);
    }

    if (recentEmailsResult.status === "fulfilled" && recentEmailsResult.value) {
      const emails = recentEmailsResult.value;
      const digest = emails.slice(0, 20).map(e => {
        const dir = e.direction === "in" ? "IN" : "OUT";
        const body = e.body ? e.body.replace(/\s+/g, " ").slice(0, 200) : "";
        return `[${dir}] "${e.subject}" ${e.from} -> ${e.to} (${e.timestamp})\n${body}`;
      }).join("\n\n");
      contextParts.push(`RECENT EMAIL CONTENT (20 most recent):\n${digest}`);
    }

    if (eventsResult.status === "fulfilled" && eventsResult.value) {
      contextParts.push(formatEventContext(eventsResult.value));
    }

    if (context_type && context_data) {
      contextParts.unshift(`PANEL CONTEXT (${context_type}):\n${context_data}`);
    }

    const dataContext = contextParts.join("\n\n---\n\n");
    const fullReply = await chatStream(messages, dataContext, (token) => {
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ done: true, reply: fullReply })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── Contacts by company ──

app.get("/api/contacts", requireAuth, async (req, res) => {
  const company = req.query.company;
  if (!company) return res.status(400).json({ error: "company param required" });
  try {
    const all = await fetchAllContacts();
    const filtered = all.filter(c => c.company && c.company.toLowerCase() === company.toLowerCase());
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deals by company ──

app.get("/api/deals", requireAuth, async (req, res) => {
  const company = req.query.company;
  try {
    const filters = company
      ? [{ filters: [{ propertyName: "hs_company_name", operator: "EQ", value: company }] }]
      : [];
    const data = await hsSearch("deals", filters, [
      "dealname", "dealstage", "amount", "closedate",
      "hubspot_owner_id", "pipeline", "lastmodifieddate", "hs_company_name",
    ], 100);
    res.json(data.results.map((d) => ({ id: d.id, url: `${HS_BASE}/record/0-3/${d.id}`, ...d.properties })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Timeline ──

app.get("/api/timeline", requireAuth, async (req, res) => {
  const range = req.query.range || "week";
  const typeFilter = req.query.type || "all";

  const now = new Date();
  const rangeMs = { today: 86400000, week: 604800000, month: 2592000000 }[range] || 604800000;
  const since = new Date(now - rangeMs);

  try {
    const events = [];

    // Memory signals as events
    const nodes = getMemoryNodes();
    nodes.filter(n => n.status === "active" && (typeFilter === "all" || typeFilter === "signals")).forEach(n => {
      events.push({
        type: "signal",
        title: n.type + (n.score ? ` [${n.score}]` : ""),
        description: n.description,
        account: (n.tags || [])[0] || null,
        timestamp: n.deadline || now.toISOString(),
        severity: n.score >= 3 ? "red" : n.score >= 2 ? "yellow" : "blue",
      });
    });

    // Recent deals
    if (typeFilter === "all" || typeFilter === "deals") {
      try {
        const data = await hsSearch("deals", [], [
          "dealname", "dealstage", "amount", "closedate", "lastmodifieddate", "hs_company_name",
        ], 50);
        data.results.forEach(d => {
          const mod = new Date(d.properties.lastmodifieddate);
          if (mod >= since) {
            events.push({
              type: "deal",
              title: d.properties.dealname,
              description: `Stage: ${d.properties.dealstage}, Amount: ${d.properties.amount || "?"}`,
              account: d.properties.hs_company_name || null,
              timestamp: d.properties.lastmodifieddate,
              severity: null,
            });
          }
        });
      } catch {}
    }

    // Recent contacts
    if (typeFilter === "all" || typeFilter === "contacts") {
      try {
        const data = await hsSearch("contacts", [], [
          "firstname", "lastname", "company", "lastmodifieddate", "createdate",
        ], 50);
        data.results.forEach(c => {
          const created = new Date(c.properties.createdate);
          if (created >= since) {
            events.push({
              type: "contact",
              title: `${c.properties.firstname || ""} ${c.properties.lastname || ""}`.trim() || "Unknown",
              description: `New contact at ${c.properties.company || "Unknown"}`,
              account: c.properties.company || null,
              timestamp: c.properties.createdate,
              severity: null,
            });
          }
        });
      } catch {}
    }

    // Recent emails
    if (typeFilter === "all" || typeFilter === "email") {
      try {
        const emails = await fetchRecentEmails(100);
        emails.forEach(e => {
          const ts = new Date(e.timestamp);
          if (ts >= since) {
            const addr = e.direction === "in" ? e.from : e.to;
            const domain = addr.split("@")[1] || "";
            events.push({
              type: "email",
              title: e.subject || "(no subject)",
              description: `${e.direction === "in" ? "From" : "To"}: ${addr}`,
              account: domain.split(".")[0] || null,
              timestamp: e.timestamp,
              severity: null,
            });
          }
        });
      } catch {}
    }

    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Marketing events + conversion ──

const EVENT_LIST_MAP = {
  "ONsight Launch Dinner 2026":  { invited: 135, attended: 142 },
  "BIM World CPH 2025":         { invited: 17,  attended: 20 },
  "FLC Vitus Training (Feb)":   { attended: 126 },
  "FLC Vitus Training (Mar)":   { attended: 132 },
  "Onsight Interview Outreach": { invited: 143 },
};

async function fetchMarketingEvents() {
  const res = await fetch("https://api.hubapi.com/marketing/v3/marketing-events/", {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HubSpot marketing events ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

async function fetchListMembers(listId) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/lists/${listId}/memberships`, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map(r => r.recordId);
}

async function batchReadContacts(ids, props) {
  const results = {};
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: batch.map(id => ({ id })), properties: props }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const r of data.results || []) results[r.id] = r.properties;
  }
  return results;
}

const CONVERTED_STAGES = new Set(["customer", "opportunity", "evangelist"]);
const PIPELINE_STAGES = new Set(["salesqualifiedlead", "marketingqualifiedlead"]);

async function buildEventConversion() {
  // Fetch events metadata
  const rawEvents = await fetchMarketingEvents();

  // Fetch all list memberships in parallel
  const allListIds = new Set();
  for (const lists of Object.values(EVENT_LIST_MAP)) {
    for (const lid of Object.values(lists)) allListIds.add(lid);
  }
  const membershipResults = await Promise.allSettled(
    [...allListIds].map(lid => fetchListMembers(lid).then(ids => [lid, ids]))
  );
  const memberships = {};
  for (const r of membershipResults) {
    if (r.status === "fulfilled") {
      const [lid, ids] = r.value;
      memberships[lid] = ids;
    }
  }

  // Gather all unique contact IDs
  const allContactIds = new Set();
  for (const lists of Object.values(EVENT_LIST_MAP)) {
    for (const lid of Object.values(lists)) {
      for (const id of memberships[lid] || []) allContactIds.add(id);
    }
  }

  // Batch read contacts
  const contacts = await batchReadContacts([...allContactIds], [
    "firstname", "lastname", "company", "email", "lifecyclestage", "purgatory",
  ]);

  // Build per-event analysis
  const events = [];
  for (const [eventName, lists] of Object.entries(EVENT_LIST_MAP)) {
    const meta = rawEvents.find(e => e.eventName && eventName.toLowerCase().includes(e.eventName.toLowerCase().slice(0, 15))) || {};
    const invitedIds = memberships[lists.invited] || [];
    const attendedIds = memberships[lists.attended] || memberships[lists.invited] || [];

    const attendees = [];
    const gaps = { noCompany: 0, noLifecycle: 0, noEmail: 0 };
    const lifecycleCounts = {};
    const companies = {};
    let converted = 0, inPipeline = 0;

    for (const cid of attendedIds) {
      const c = contacts[cid] || {};
      const name = `${c.firstname || ""} ${c.lastname || ""}`.trim() || "?";
      const company = c.company || "";
      const lc = c.lifecyclestage || "";
      const email = c.email || "";

      if (!company) gaps.noCompany++;
      if (!lc) gaps.noLifecycle++;
      if (!email) gaps.noEmail++;

      lifecycleCounts[lc || "unknown"] = (lifecycleCounts[lc || "unknown"] || 0) + 1;

      if (!companies[company || "Unknown"]) companies[company || "Unknown"] = { count: 0, converted: 0 };
      companies[company || "Unknown"].count++;

      const isConverted = CONVERTED_STAGES.has(lc);
      const isPipeline = PIPELINE_STAGES.has(lc);
      if (isConverted) { converted++; companies[company || "Unknown"].converted++; }
      if (isPipeline) inPipeline++;

      attendees.push({ id: cid, name, company, email, lifecycle: lc || "unknown", converted: isConverted, pipeline: isPipeline });
    }

    const total = attendedIds.length;
    const dataQuality = total > 0 ? Math.round((1 - (gaps.noCompany + gaps.noLifecycle) / (total * 2)) * 100) : 0;

    events.push({
      name: eventName,
      type: meta.eventType || null,
      date: meta.startDateTime || null,
      invited: invitedIds.length,
      attended: total,
      registrants: meta.registrants || null,
      cancellations: meta.cancellations || null,
      noShows: meta.noShows || null,
      converted,
      conversionRate: total > 0 ? Math.round(converted / total * 100) : 0,
      inPipeline,
      pipelineRate: total > 0 ? Math.round(inPipeline / total * 100) : 0,
      lifecycleCounts,
      companies: Object.entries(companies).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.count - a.count),
      gaps,
      dataQuality,
      attendees,
    });
  }

  return events;
}

app.get("/api/events", requireAuth, async (req, res) => {
  try {
    const events = await buildEventConversion();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Content drafts ──

app.post("/api/content/drafts", requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });
  const draftsPath = resolve(__dirname, "data", "drafts.json");
  let drafts = [];
  if (existsSync(draftsPath)) {
    try { drafts = JSON.parse(readFileSync(draftsPath, "utf-8")); } catch {}
  }
  drafts.unshift({ text, savedAt: new Date().toISOString() });
  writeFileSync(draftsPath, JSON.stringify(drafts, null, 2));
  res.json({ ok: true, count: drafts.length });
});

// ── Start ──

app.listen(PORT, () => {
  console.log(`\n  Bonaparte`);
  console.log(`  http://localhost:${PORT}\n`);
  startScheduler();
  startSlackBot().catch(err => console.error("  Slack bot failed:", err.message));
});
