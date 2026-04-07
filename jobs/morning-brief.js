/**
 * Morning brief job.
 * Reads memory from db, pulls HubSpot signals, generates brief, stores in db.
 */
import { getMemoryNodes, getSetting, setSetting } from "../lib/db.js";
import { HUBSPOT_TOKEN } from "../tools/config.js";
import { generateMorningBrief } from "../lib/claude.js";

export default async function runMorningBrief() {
  const log = [];

  // Step 1: Build bulletin from db nodes
  const nodes = getMemoryNodes();
  const signals = nodes
    .filter((n) => n.type === "SIGNAL" && n.status === "active")
    .sort((a, b) => b.score - a.score);
  const patterns = nodes.filter((n) => n.type === "PATTERN" && n.status === "active");
  const stale = nodes.filter((n) => n.status === "stale");

  // Use stored bulletin if available, otherwise build from nodes
  let bulletin = getSetting("last_bulletin");
  if (!bulletin) {
    const parts = [];
    if (signals.length) parts.push("Active signals: " + signals.slice(0, 5).map((s) => `[${s.score}] ${s.description}`).join("; "));
    if (patterns.length) parts.push("Patterns: " + patterns.map((p) => p.description).join("; "));
    if (stale.length) parts.push(`${stale.length} stale node(s) need attention.`);
    bulletin = parts.join("\n") || "No active signals or patterns.";
  }
  log.push("Read bulletin from database");

  // Step 2: Pull live HubSpot signals
  const hubspotSignals = await getHubSpotSignals();
  log.push(`Pulled ${hubspotSignals.split("\n").filter(Boolean).length} HubSpot signals`);

  // Step 3: Generate brief via Claude
  const brief = await generateMorningBrief(bulletin, hubspotSignals);
  log.push("Brief generated via Claude");

  // Step 4: Store brief in db
  const existing = getSetting("morning_briefs") || "";
  const updated = brief + "\n\n---\n\n" + existing;
  setSetting("morning_briefs", updated.slice(0, 50000)); // cap at 50k chars
  setSetting("last_brief_date", new Date().toISOString());
  log.push("Brief saved to database");

  return log.join("; ");
}

async function getHubSpotSignals() {
  const signals = [];

  try {
    // Stale deals (no modification in 14+ days)
    const dealRes = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [
            { propertyName: "dealstage", operator: "NEQ", value: "closedwon" },
            { propertyName: "dealstage", operator: "NEQ", value: "closedlost" },
          ],
        }],
        properties: ["dealname", "dealstage", "amount", "closedate", "lastmodifieddate", "hubspot_owner_id"],
        limit: 100,
      }),
    });

    if (dealRes.ok) {
      const dealData = await dealRes.json();
      const now = Date.now();
      for (const deal of dealData.results || []) {
        const p = deal.properties;
        const lastMod = new Date(p.lastmodifieddate).getTime();
        const daysSince = Math.floor((now - lastMod) / 86400000);

        if (p.closedate && new Date(p.closedate) < new Date()) {
          const daysOverdue = Math.floor((now - new Date(p.closedate).getTime()) / 86400000);
          signals.push(`RED: Deal "${p.dealname}" is ${daysOverdue} days overdue (close date ${p.closedate.split("T")[0]})`);
        } else if (daysSince > 14) {
          signals.push(`YELLOW: Deal "${p.dealname}" has had no activity in ${daysSince} days`);
        }
      }
    }
  } catch (err) {
    signals.push(`Error pulling deals: ${err.message}`);
  }

  return signals.join("\n") || "No new HubSpot signals today.";
}
