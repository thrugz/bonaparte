/**
 * Bonaparte Slack bot — Socket Mode.
 * Listens for DMs and @mentions, responds as Bonaparte via Claude.
 */
import pkg from "@slack/bolt";
const { App } = pkg;
import { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, HUBSPOT_TOKEN } from "../tools/config.js";
import { chat } from "./claude.js";
import { getMemoryNodes, getSetting } from "./db.js";
import { readFileSync, existsSync } from "fs";
import { assetPath } from "./paths.js";

const BOT_USER_ID = "U0AP4JR1H8R";

// Per-user conversation history (in-memory, resets on restart)
const conversations = new Map();
const MAX_HISTORY = 20;

function getHistory(userId) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  return conversations.get(userId);
}

function addToHistory(userId, role, content) {
  const hist = getHistory(userId);
  hist.push({ role, content });
  if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
}

const CONTACT_PROPS = [
  "firstname", "lastname", "email", "company", "real_company", "jobtitle",
  "hubspot_owner_id", "purgatory_status", "lastmodifieddate", "last_login",
  "used_dashboards", "used_properties", "used_saved_views",
  "used_display_filter", "used_sketch", "used_colorize", "model_load",
];

const EMAIL_PROPS = [
  "hs_email_subject", "hs_email_direction", "hs_email_status",
  "hs_email_from_email", "hs_email_to_email", "hs_timestamp",
  "hs_email_text",
];

async function hsFetch(objectType, body) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

/**
 * Build full data context for Claude, matching web vChat depth.
 */
async function buildContext() {
  const parts = [];

  // Memory nodes (instant, from db)
  const nodes = getMemoryNodes();
  const signals = nodes.filter(n => n.type === "SIGNAL" && n.status === "active");
  const facts = nodes.filter(n => n.type === "FACT" && n.status === "active");
  const patterns = nodes.filter(n => n.type === "PATTERN" && n.status === "active");
  parts.push(`MEMORY NODES:\nSignals (${signals.length}): ${signals.map(s => `[${s.score}] ${s.description}`).join("; ")}\nFacts (${facts.length}): ${facts.map(f => f.description).join("; ")}\nPatterns (${patterns.length}): ${patterns.map(p => p.description).join("; ")}`);

  // Market demand (instant, from file)
  const insightsPath = assetPath("data", "survey-insights.json");
  if (existsSync(insightsPath)) {
    try {
      const survey = JSON.parse(readFileSync(insightsPath, "utf-8"));
      const summary = survey.market_demands
        .sort((a, b) => b.demand_score - a.demand_score)
        .slice(0, 10)
        .map(d => `${d.demand_score}/10 ${d.name} (${d.vitus_status})`)
        .join("\n");
      parts.push(`MARKET DEMAND (top 10):\n${summary}`);
    } catch {}
  }

  // Cached bulletin (instant, from db)
  const bulletin = getSetting("last_bulletin");
  if (bulletin) parts.push(`CURRENT BULLETIN:\n${bulletin}`);

  // Parallel HubSpot fetches: deals, contacts, emails
  const [deals, contacts, emails] = await Promise.allSettled([
    hsFetch("deals", {
      filterGroups: [{ filters: [
        { propertyName: "dealstage", operator: "NEQ", value: "closedwon" },
        { propertyName: "dealstage", operator: "NEQ", value: "closedlost" },
      ]}],
      properties: ["dealname", "dealstage", "amount", "closedate", "hubspot_owner_id", "notes_last_updated"],
      limit: 50,
    }),
    hsFetch("contacts", {
      filterGroups: [],
      properties: CONTACT_PROPS,
      limit: 100,
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
    }),
    hsFetch("emails", {
      filterGroups: [],
      properties: EMAIL_PROPS,
      limit: 30,
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
    }),
  ]);

  // Deals
  if (deals.status === "fulfilled" && deals.value.length) {
    const lines = deals.value.map(d => {
      const p = d.properties;
      return `${p.dealname}: stage=${p.dealstage}, amount=${p.amount || "?"}, close=${p.closedate?.split("T")[0] || "?"}`;
    }).join("\n");
    parts.push(`OPEN DEALS (${deals.value.length}):\n${lines}`);
  }

  // Contacts grouped by company
  if (contacts.status === "fulfilled" && contacts.value.length) {
    const byCompany = {};
    for (const c of contacts.value) {
      const p = c.properties;
      const co = p.company || p.real_company || "Unknown";
      if (!byCompany[co]) byCompany[co] = [];
      let score = 0;
      if (p.used_dashboards) score += 2;
      if (p.used_properties) score += 2;
      if (p.used_saved_views) score += 2;
      if (p.used_display_filter) score += 1;
      if (p.used_sketch) score += 1;
      if (p.used_colorize) score += 1;
      if (p.last_login) {
        const days = (Date.now() - new Date(p.last_login).getTime()) / 86400000;
        if (days <= 30) score += 1;
      }
      byCompany[co].push({ name: [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email, score: Math.min(score, 9) });
    }
    const summary = Object.entries(byCompany)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 20)
      .map(([name, cs]) => {
        const avg = (cs.reduce((s, c) => s + c.score, 0) / cs.length).toFixed(1);
        const t1 = Math.round(cs.filter(c => c.score >= 7).length / cs.length * 100);
        return `${name}: ${cs.length} contacts, avg ${avg}/9, ${t1}% T1`;
      }).join("\n");
    parts.push(`HUBSPOT ACCOUNTS (top 20 by recent activity):\n${summary}`);
  }

  // Emails
  if (emails.status === "fulfilled" && emails.value.length) {
    const emailLines = emails.value.slice(0, 20).map(e => {
      const p = e.properties;
      const dir = p.hs_email_direction === "INCOMING_EMAIL" ? "IN" : "OUT";
      const subj = p.hs_email_subject || "(no subject)";
      const body = p.hs_email_text ? p.hs_email_text.replace(/\s+/g, " ").slice(0, 200) : "";
      const date = p.hs_timestamp ? new Date(p.hs_timestamp).toISOString().split("T")[0] : "?";
      return `[${dir}] "${subj}" ${p.hs_email_from_email || "?"} -> ${p.hs_email_to_email || "?"} (${date})\n${body}`;
    }).join("\n\n");

    // Unanswered outbound
    const threads = {};
    for (const e of emails.value) {
      const p = e.properties;
      const key = (p.hs_email_subject || "").replace(/^Re:\s*/i, "").trim().toLowerCase();
      if (!threads[key]) threads[key] = { in: 0, out: 0, lastOut: null, subj: p.hs_email_subject, to: p.hs_email_to_email };
      if (p.hs_email_direction === "INCOMING_EMAIL") threads[key].in++;
      else { threads[key].out++; threads[key].lastOut = p.hs_timestamp; }
    }
    const noReply = Object.values(threads)
      .filter(t => t.out > 0 && t.in === 0 && t.lastOut)
      .map(t => ({ subj: t.subj, to: t.to, days: Math.round((Date.now() - new Date(t.lastOut).getTime()) / 86400000) }))
      .filter(t => t.days >= 3)
      .sort((a, b) => b.days - a.days);

    let emailCtx = `RECENT EMAILS (${emails.value.length}):\n${emailLines}`;
    if (noReply.length) {
      emailCtx += `\n\nUNANSWERED OUTBOUND:\n` + noReply.map(t => `- "${t.subj}" to ${t.to}, ${t.days} days ago`).join("\n");
    }
    parts.push(emailCtx);
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Start the Socket Mode bot. Call once at server startup.
 */
export async function startSlackBot() {
  if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
    console.log("  Slack bot: skipped (missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN)");
    return null;
  }

  const app = new App({
    token: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    socketMode: true,
  });

  app.error(async (error) => {
    console.error("  Slack bot error:", error.message || error);
  });

  // Handle DMs
  app.message(async ({ message, say }) => {
    // Ignore bot messages, message_changed, etc.
    if (message.subtype || message.bot_id) return;
    // Only respond in DMs (im) — not channels
    if (message.channel_type !== "im") return;

    await handleMessage(message.user, message.text, say);
  });

  // Handle @mentions in channels
  app.event("app_mention", async ({ event, say }) => {
    const text = event.text.replace(new RegExp(`<@${BOT_USER_ID}>`, "g"), "").trim();
    await handleMessage(event.user, text, say, event.ts);
  });

  async function handleMessage(userId, text, say, threadTs) {
    if (!text || !text.trim()) return;

    // Show typing indicator
    const thinkingMsg = await say({
      text: ":brain: Thinking...",
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });

    try {
      addToHistory(userId, "user", text);
      const context = await buildContext();
      const messages = getHistory(userId);
      const reply = await chat(messages, context, 1500);
      addToHistory(userId, "assistant", reply);

      // Replace thinking message with actual response
      await app.client.chat.update({
        token: SLACK_BOT_TOKEN,
        channel: thinkingMsg.channel,
        ts: thinkingMsg.ts,
        text: reply,
      });
    } catch (err) {
      console.error("Slack bot error:", err.message);
      await app.client.chat.update({
        token: SLACK_BOT_TOKEN,
        channel: thinkingMsg.channel,
        ts: thinkingMsg.ts,
        text: `Something went wrong: ${err.message}`,
      });
    }
  }

  await app.start();
  console.log("  Slack bot: connected (Socket Mode)");
  return app;
}
