/**
 * Weekly portfolio health alerts.
 * Runs for each owner, sends DMs via Bonaparte bot, escalates Casper's RED to Bram.
 */
import { sendBotDM } from "../lib/slack.js";
import { HUBSPOT_TOKEN, OWNER_IDS, SLACK_USER_IDS } from "../tools/config.js";
import { getSetting, setSetting } from "../lib/db.js";
import { composeAlertDM } from "../lib/claude.js";

const OWNERS = [
  { name: "Bram Lyng Andersen", hubspotId: OWNER_IDS.bram, slackId: SLACK_USER_IDS.bram },
  { name: "Casper Gullach", hubspotId: OWNER_IDS.casper, slackId: SLACK_USER_IDS.casper },
];

export default async function runPortfolioAlerts() {
  const log = [];
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const allResults = [];

  for (const owner of OWNERS) {
    const alerts = await checkOwnerAlerts(owner.hubspotId, today);
    const total = (alerts.red?.length || 0) + (alerts.yellow?.length || 0) + (alerts.blue?.length || 0);

    if (total === 0) {
      log.push(`${owner.name}: no alerts`);
      allResults.push({ owner: owner.name, red: 0, yellow: 0, blue: 0 });
      continue;
    }

    // Compose and send DM
    try {
      const dmText = await composeAlertDM(owner.name, alerts);
      await sendBotDM(owner.slackId, dmText);
      log.push(`${owner.name}: sent DM (${alerts.red?.length || 0}R, ${alerts.yellow?.length || 0}Y, ${alerts.blue?.length || 0}B)`);
    } catch (err) {
      log.push(`${owner.name}: DM failed (${err.message})`);
    }

    allResults.push({
      owner: owner.name,
      red: alerts.red?.length || 0,
      yellow: alerts.yellow?.length || 0,
      blue: alerts.blue?.length || 0,
      alerts,
    });
  }

  // Escalation: if Casper has RED alerts, notify Bram
  const casperResult = allResults.find((r) => r.owner === "Casper Gullach");
  if (casperResult?.red > 0) {
    try {
      const redList = casperResult.alerts.red.join("; ");
      await sendBotDM(
        SLACK_USER_IDS.bram,
        `Flagging for visibility: Casper has ${casperResult.red} RED alert${casperResult.red > 1 ? "s" : ""} this week. ${redList.slice(0, 200)} /Bonaparte`
      );
      log.push("Escalated Casper RED alerts to Bram");
    } catch (err) {
      log.push(`Escalation failed: ${err.message}`);
    }
  }

  // Store account signals in db
  try {
    updateAccountSignals(dateStr, allResults);
    log.push("Account signals stored in database");
  } catch (err) {
    log.push(`Signal storage failed: ${err.message}`);
  }

  return log.join("; ");
}

async function checkOwnerAlerts(ownerId, today) {
  const alerts = { red: [], yellow: [], blue: [] };
  const now = today.getTime();

  // Fetch deals
  const deals = await hsSearch("deals",
    [{ filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId }] }],
    ["dealname", "dealstage", "amount", "closedate", "hs_lastmodifieddate", "notes_last_updated"]
  );

  for (const deal of deals) {
    const p = deal.properties;
    if (p.dealstage === "closedwon" || p.dealstage === "closedlost") continue;

    const closeDate = p.closedate ? new Date(p.closedate) : null;
    const lastActivity = new Date(p.notes_last_updated || p.hs_lastmodifieddate);
    const daysSinceActivity = Math.floor((now - lastActivity.getTime()) / 86400000);

    // RED: overdue
    if (closeDate && closeDate < today) {
      const daysOverdue = Math.floor((now - closeDate.getTime()) / 86400000);
      alerts.red.push(`Overdue: ${p.dealname} (${daysOverdue}d past close${p.amount ? ", EUR " + p.amount : ""})`);
    }
    // RED: closing within 7 days
    else if (closeDate) {
      const daysUntil = Math.floor((closeDate.getTime() - now) / 86400000);
      if (daysUntil <= 7 && daysUntil >= 0) {
        alerts.red.push(`Closing soon: ${p.dealname} in ${daysUntil}d${p.amount ? " (EUR " + p.amount + ")" : ""}`);
      }
    }

    // YELLOW: stale deal (>30 days no activity)
    if (daysSinceActivity > 30) {
      alerts.yellow.push(`Stale deal: ${p.dealname} (${daysSinceActivity}d no activity${p.amount ? ", EUR " + p.amount : ""})`);
    }
  }

  // Fetch companies
  const companies = await hsSearch("companies",
    [{ filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId }] }],
    ["name", "domain", "num_associated_contacts", "num_associated_deals", "notes_last_updated", "lifecyclestage", "hs_lastmodifieddate"]
  );

  for (const co of companies) {
    const p = co.properties;
    const contacts = parseInt(p.num_associated_contacts || "0");
    const numDeals = parseInt(p.num_associated_deals || "0");
    const lastActivity = new Date(p.notes_last_updated || p.hs_lastmodifieddate);
    const daysSinceActivity = Math.floor((now - lastActivity.getTime()) / 86400000);

    // YELLOW: cooling account (5+ contacts, 30+ days quiet)
    if (contacts >= 5 && daysSinceActivity > 30) {
      alerts.yellow.push(`Cooling: ${p.name} (${contacts} contacts, ${daysSinceActivity}d quiet)`);
    }

    // YELLOW: orphaned opportunity
    if (p.lifecyclestage === "opportunity" && contacts === 0) {
      alerts.yellow.push(`Orphaned opportunity: ${p.name} (0 contacts)`);
    }

    // BLUE: big account, no deal
    if (contacts >= 10 && numDeals === 0) {
      alerts.blue.push(`${p.name} has ${contacts} contacts but no deal`);
    }
  }

  return alerts;
}

async function hsSearch(objectType, filterGroups, properties) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filterGroups, properties, limit: 200 }),
  });
  if (!res.ok) throw new Error(`HubSpot ${objectType} search: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

function updateAccountSignals(dateStr, results) {
  const summary = results.map((r) => ({
    owner: r.owner,
    red: r.red,
    yellow: r.yellow,
    blue: r.blue,
  }));

  const existing = getSetting("account_signals") || [];
  const entry = { date: dateStr, results: summary };
  // Keep last 20 entries
  const updated = [entry, ...existing].slice(0, 20);
  setSetting("account_signals", updated);
}
