/**
 * Lightweight Slack client for dashboard + background scripts.
 * Interactive mode uses the MCP connector instead.
 *
 * Reads canvas content via files.info + download URL (HTML -> markdown).
 * Writes canvas content via canvases.edit (full replace).
 */
import { SLACK_BOT_TOKEN } from "../tools/config.js";

const BASE = "https://slack.com/api";
const TEAM_ID = "TNYLBBYD6";

async function slackApi(method, body = {}) {
  const res = await fetch(`${BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack ${method}: ${data.error}`);
  }
  return data;
}

/**
 * Read full canvas content as markdown-like text.
 * Uses files.info to get the download URL, then fetches HTML and converts.
 * @param {string} canvasId
 * @returns {Promise<string>}
 */
export async function readCanvas(canvasId) {
  // Get file metadata including download URL
  const res = await fetch(`${BASE}/files.info?file=${canvasId}`, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack files.info: ${data.error}`);

  // Download HTML content
  const dlUrl = data.file.url_private_download;
  if (!dlUrl) throw new Error("No download URL for canvas");

  const dlRes = await fetch(dlUrl, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    redirect: "follow",
  });
  if (!dlRes.ok) throw new Error(`Canvas download failed: ${dlRes.status}`);

  const html = await dlRes.text();
  return htmlToMarkdown(html);
}

/**
 * Full-replace canvas content. No section_id, ever.
 * @param {string} canvasId
 * @param {string} markdown
 * @returns {Promise<void>}
 */
export async function writeCanvas(canvasId, markdown) {
  await slackApi("canvases.edit", {
    canvas_id: canvasId,
    changes: [
      {
        operation: "replace",
        document_content: { type: "markdown", markdown },
      },
    ],
  });
}

/**
 * Post a message to a channel (used sparingly, only with permission).
 * @param {string} channel - Channel ID
 * @param {string} text
 * @returns {Promise<Object>}
 */
export async function postMessage(channel, text) {
  return slackApi("chat.postMessage", { channel, text });
}

/**
 * Send a DM as the Bonaparte bot (not as Bram).
 * Uses SLACK_BOT_TOKEN for outbound alerts and notifications.
 * @param {string} userId - Slack user ID to DM
 * @param {string} text - Message text (markdown)
 * @returns {Promise<Object>}
 */
export async function sendBotDM(userId, text) {
  const res = await fetch(`${BASE}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: userId, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack bot DM: ${data.error}`);
  return data;
}

/**
 * Convert Slack canvas HTML to readable markdown.
 * Not a full HTML parser — handles the specific tags Slack canvases emit.
 */
function htmlToMarkdown(html) {
  return html
    // Headers
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
    // Bold, italic, code
    .replace(/<b>(.*?)<\/b>/gi, "**$1**")
    .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<i>(.*?)<\/i>/gi, "*$1*")
    .replace(/<em>(.*?)<\/em>/gi, "*$1*")
    .replace(/<code>(.*?)<\/code>/gi, "`$1`")
    // Links
    .replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    // List items
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?[uo]l[^>]*>/gi, "\n")
    // Paragraphs and line breaks
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
