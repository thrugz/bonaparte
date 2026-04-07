/**
 * Claude API wrapper for Bonaparte's natural language tasks.
 * Uses Anthropic SDK. Only called for text generation, not for rule-based logic.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ANTHROPIC_API_KEY } from "../tools/config.js";

const MODEL = "claude-haiku-4-5-20251001";
const MODEL_FAST = "claude-haiku-4-5-20251001";

const SYSTEM = `You are Bonaparte, a sharp strategic AI for a BIM data platform called Vitus. Your tone is direct, warm but no-fluff. Never use em dashes, bullet-point email bodies, or corporate language. Every recommendation names who does what by when. Lead with the answer.`;

function readClaudeCodeOAuth() {
  try {
    const home = process.env.HOME || process.env.USERPROFILE;
    const creds = JSON.parse(readFileSync(resolve(home, ".claude", ".credentials.json"), "utf-8"));
    const oauth = creds.claudeAiOauth;
    if (oauth?.accessToken && (!oauth.expiresAt || oauth.expiresAt > Date.now())) {
      return oauth.accessToken;
    }
  } catch {}
  return null;
}

function getClient() {
  // 1. Explicit API key from config (skip empty strings)
  if (ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.trim()) {
    return new Anthropic({ apiKey: ANTHROPIC_API_KEY.trim() });
  }
  // 2. Claude Code OAuth token from credentials file
  const oauthToken = readClaudeCodeOAuth();
  if (oauthToken) {
    return new Anthropic({ apiKey: oauthToken });
  }
  throw new Error("No Anthropic API key or Claude Code OAuth found. Add ANTHROPIC_API_KEY in Settings.");
}

async function callWithRetry(fn, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.status === 429 || err?.message?.includes("429") || err?.message?.includes("rate_limit");
      if (isRateLimit && i < retries - 1) {
        console.log(`  Rate limited, retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (isRateLimit) {
        throw new Error("Rate limited. OAuth tokens have low limits: add an ANTHROPIC_API_KEY in Settings for reliable use.");
      }
      throw err;
    }
  }
}

export async function ask(prompt, maxTokens = 1024, { fast = false } = {}) {
  const client = getClient();
  const msg = await callWithRetry(() => client.messages.create({
    model: fast ? MODEL_FAST : MODEL,
    max_tokens: maxTokens,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  }));
  return msg.content[0].text;
}

/**
 * Multi-turn chat with data context. Used by vChat.
 * Messages format: [{ role: "user"|"assistant", content: "..." }]
 */
export async function chat(messages, dataContext, maxTokens = 2048) {
  const client = getClient();
  const systemPrompt = SYSTEM + `\n\nYou have access to the following live data from Vitus systems (HubSpot CRM, Slack, memory nodes, market demand). Use it to answer questions precisely. Reference specific numbers, names, and dates. If data is missing, say so.

${dataContext}`;

  const msg = await callWithRetry(() => client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  }));
  return msg.content[0].text;
}

/**
 * Streaming multi-turn chat. Yields text chunks via callback.
 */
export async function chatStream(messages, dataContext, onToken, maxTokens = 2048) {
  const client = getClient();
  const systemPrompt = SYSTEM + `\n\nYou have access to the following live data from Vitus systems (HubSpot CRM, Slack, memory nodes, market demand). Use it to answer questions precisely. Reference specific numbers, names, and dates. If data is missing, say so.

${dataContext}`;

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  let fullText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta?.text) {
      fullText += event.delta.text;
      onToken(event.delta.text);
    }
  }
  return fullText;
}

/**
 * Generate the Current Bulletin for the Memory Graph canvas.
 * Max 150 words. Lead with highest-priority signals.
 */
export async function generateBulletin(signals, patterns, staleNodes) {
  const prompt = `Write the Current Bulletin for today's Memory Graph. Max 150 words.

Active signals (sorted by priority):
${signals.map((s) => `- [${s.score}] ${s.description}`).join("\n")}

Active patterns:
${patterns.map((p) => `- ${p.description}`).join("\n") || "None"}

Stale items needing attention:
${staleNodes.map((s) => `- ${s.description}`).join("\n") || "None"}

Format:
- Lead with the single most important thing (bold)
- Mention decayed or stale signals
- Note any new patterns
- End with one specific recommended action naming who does what by when
- No bullet lists, write in flowing paragraphs
- Max 150 words`;

  return ask(prompt, 512);
}

/**
 * Generate the morning brief for the Weekly Brief canvas.
 */
export async function generateMorningBrief(bulletin, hubspotSignals) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const prompt = `Write today's morning brief. Date: ${today}

Current bulletin from Memory Graph:
${bulletin}

Live HubSpot signals:
${hubspotSignals}

Format:
# ${new Date().toLocaleDateString("en-US", { weekday: "long" })} Brief, ${today}

**Top priority:** [most important signal]

[Signal 1 with action and owner]

[Signal 2 with action and owner]

[Signal 3 with action and owner]

Rules:
- Max 3 actionable signals
- Each action names who does what (Bram = product/CS, Josephine = sales/outreach, Casper = CFO)
- No em dashes, no bullet-point walls
- Warm but direct`;

  return ask(prompt, 800);
}

/**
 * Compose a portfolio health alert DM for a specific owner.
 */
export async function composeAlertDM(ownerName, alerts) {
  const prompt = `Write a Slack DM for ${ownerName} with their portfolio health alerts.

RED alerts (urgent):
${alerts.red?.map((a) => `- ${a}`).join("\n") || "None"}

YELLOW alerts (watch):
${alerts.yellow?.map((a) => `- ${a}`).join("\n") || "None"}

BLUE alerts (opportunity):
${alerts.blue?.map((a) => `- ${a}`).join("\n") || "None"}

Rules:
- Lead with the most urgent item
- For RED: be specific (name the deal, the date, how many days overdue)
- For YELLOW: brief ("X has gone quiet, no activity in Y days")
- For BLUE: frame as opportunity ("CN3 has 53 contacts but no deal, worth creating one?")
- Warm but direct, no bullet-point walls, no em dashes
- Max 400 words
- Sign off as /Bonaparte`;

  return ask(prompt, 600);
}

/**
 * Evaluate a competitor against Vitus across key dimensions.
 * Returns a scorecard with dimension scores and a verdict.
 */
export async function evaluateCompetitor(name, angle, intelContext) {
  const dimensions = [
    "BIM Data Depth — ability to extract, query, and visualize BIM properties at object level",
    "3D Viewer — web-based model viewing, navigation, and interaction quality",
    "Dashboard & Analytics — custom dashboards, charts, reporting from project data",
    "Collaboration — shared views, annotations, issue tracking, notifications",
    "ACC/CDE Integration — depth of integration with Autodesk Construction Cloud or other CDEs",
    "ISO 19650 Compliance — support for information management standards and document control",
    "API & Extensibility — REST API, integrations, custom workflows, developer ecosystem",
    "Market Position — brand recognition, customer base, pricing accessibility in AEC",
  ];

  const prompt = `You are a competitive intelligence analyst for Vitus, a BIM data intelligence platform built on Autodesk Construction Cloud.

Vitus capabilities (baseline, score these as 7/10 for reference):
- Deep BIM property extraction and querying at object level from ACC-synced models
- Web-based 3D/2D viewer with section planes, measurements, split-screen
- Interactive dashboards with calculated columns, slicer widgets, PDF/XLSX export
- Saved views with tasks, comments, sketching, real-time notifications
- Native ACC integration: auto-sync, webhooks, multi-format (RVT/IFC/DWG)
- Document log generation for ISO 19650 compliance
- REST API for custom data on BIM objects
- Growing Nordic/French/Swiss AEC customer base, startup pricing

Now evaluate **${name}** against Vitus.
Strategic angle: ${angle}

Recent intelligence:
${intelContext.slice(0, 3000)}

For each dimension below, score ${name} from 1-10 (where Vitus baseline is 7) and write ONE sentence explaining why:
${dimensions.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Then write a "verdict" (2-3 sentences): where ${name} beats Vitus, where Vitus wins, and one specific action Vitus should take.

Respond with ONLY a valid JSON object (no markdown fences):
{
  "dimensions": [
    { "name": "short name", "score": N, "vitusScore": 7, "reason": "..." }
  ],
  "verdict": "..."
}`;

  const text = await ask(prompt, 1500);
  try {
    return JSON.parse(text.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, ""));
  } catch {
    return null;
  }
}

/**
 * Evaluate discovered features against Vitus product capabilities.
 * Returns features array with evaluation field added.
 * Now includes market demand scoring from Onsight survey data.
 */
export async function evaluateFeatures(features) {
  if (!features.length) return features;

  const vitusCapabilities = `Vitus is a BIM data intelligence platform on top of Autodesk Construction Cloud. Current capabilities:
- ACC Integration: auto-sync project files, multi-format support (RVT/IFC/DWG/OBJ/PDF), model versioning
- 3D/2D Viewer: web-based hardware-accelerated viewer (SVF2), split-screen, section planes, measurement tool, model coordinate control
- BIM Data: properties browser, display filter (AND/OR logic), quantity takeoff, custom data (progress tracking on BIM objects)
- Visualization: colorize objects by any property, interactive dashboards (bar/donut/line/table/card/slicer), calculated columns, PDF/XLSX export
- Collaboration: saved views with tasks/comments/priority, sketching with per-user layers, in-app notifications, object linking
- Project Admin: role-based access, team management, file browser with favorites
- Workspace: personal landing page, content browser, copy dashboards across projects
- API & Compliance: REST API for custom data, document log generation for ISO 19650`;

  const marketDemand = `Market demand signals from Onsight Projection Report 2026 Survey (25 AEC professionals, Jan-Mar 2026):

TOP PRIORITIES (what the market is calling for, scored by demand):
9/10 — Cross-system data integration: 56% say #1 priority. Users on ACC + Dalux + Trimble + Projectwise want one layer across all.
9/10 — Non-BIM user communication: Average 3.5/10 effectiveness. Universal pain. "BIM tools are designed for those who already know BIM."
9/10 — Design-to-construction bridge: 72% flag friction between design and construction teams. #1 friction source.
8/10 — Data standards & EIR governance: 28% top priority. Want automated EIR/AIR validation against ISO 19650.
8/10 — Model-based cost controls (5D): 48% expect standard by 2027. Quantity takeoff + budget linking.
8/10 — Federated CDE: 44% expect standard by 2027. Most use ACC + Dalux or ACC + another CDE.
8/10 — AI model checking: "Automatic check of all models", "verify EIR in real time", "compliance with standards."
8/10 — Data quality scoring: Avg confidence 7/10. Want "data quality gap to EIR" dashboards.
8/10 — Real-time field-office sync: 52% expect standard by 2027.
7/10 — Automated progress tracking (reality capture): 40% expect standard by 2027.
7/10 — Cross-project analytics: 32% want pattern recognition across projects.
7/10 — 4D scheduling: "Schedule variance" and "planned vs reality" top dashboard requests.
7/10 — AI quantity takeoff: "Material quantity across all disciplines."
6/10 — Carbon/LCA dashboards: 24% expect standard by 2027.
6/10 — Digital twins with telemetry: 24% expect standard by 2027.

When evaluating features, score market_demand 1-10 based on how strongly the survey data supports demand for this capability.`;

  const featureList = features.slice(0, 20).map((f, i) =>
    `${i + 1}. [${f.source}] ${f.title}: ${f.description}`
  ).join("\n");

  const prompt = `You are a competitive intelligence analyst for Vitus, a BIM data platform.

${vitusCapabilities}

${marketDemand}

Evaluate each feature below. For each, respond with a JSON array entry containing:
- "index": the feature number (0-based)
- "type": "threat" (competitor does something Vitus can't), "opportunity" (Vitus could adopt this), or "neutral" (Vitus already does this or it's irrelevant)
- "analysis": one sentence explaining the evaluation against Vitus capabilities
- "market_demand": score 1-10 based on how strongly the survey data supports demand for this type of capability (use the market demand signals above)
- "demand_match": which market demand signal(s) this feature maps to (use the short names, e.g. "data-integration", "non-bim-communication", "5d-cost-controls")

Features to evaluate:
${featureList}

Respond with ONLY a valid JSON array, no markdown fences, no explanation.`;

  const text = await ask(prompt, 2000);

  try {
    const evaluations = JSON.parse(text.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, ""));
    for (const ev of evaluations) {
      if (ev.index >= 0 && ev.index < features.length) {
        features[ev.index].evaluation = {
          type: ev.type,
          analysis: ev.analysis,
          market_demand: ev.market_demand || null,
          demand_match: ev.demand_match || null,
        };
      }
    }
  } catch {
    // If parsing fails, return features without evaluations
  }

  return features;
}

/**
 * Format the full Memory Graph canvas from structured data.
 */
export async function formatMemoryGraph(bulletin, nodes, patterns, consolidationLog) {
  const signals = nodes.filter((n) => n.type === "SIGNAL" && n.status === "active");
  const facts = nodes.filter((n) => n.type === "FACT" && n.status === "active");

  const prompt = `Format the Memory Graph display canvas. Return only the markdown, no explanation.

Bulletin (already written):
${bulletin}

Active signals for table:
${signals.map((s) => `[${s.score}] ${s.tags[0] || "General"}: ${s.description}`).join("\n")}

Active patterns:
${patterns.map((p) => `[${p.score}] ${p.description} (tags: ${p.tags.join(", ")})`).join("\n") || "None"}

Key facts:
${facts.slice(0, 8).map((f) => `- ${f.description}`).join("\n")}

Consolidation log entries:
${consolidationLog}

Structure (follow exactly):
# Bonaparte / Memory Graph

This is the display canvas. Raw data lives in Memory Store (F0APEKEGC2D).

## Current Bulletin — [today's date]
[bulletin text]

## Active Signals
[table: Priority | Account | Signal | Owner | Deadline]

## Patterns
[formatted pattern descriptions with scores]

## Key Facts
[bullet list of important stable facts]

## Consolidation Log
[log entries, newest first]`;

  return ask(prompt, 2000);
}
