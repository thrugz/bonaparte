import { TAVILY_API_KEY } from "./config.js";

const TAVILY_URL = "https://api.tavily.com";

async function tavilySearch(query, options = {}) {
  const response = await fetch(`${TAVILY_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: options.depth || "basic",
      include_answer: true,
      max_results: options.maxResults || 5,
      ...(options.domains && { include_domains: options.domains }),
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

/**
 * Web search via Tavily.
 * @param {string} query - Search query
 * @returns {Promise<Object>} Search results with answer and sources
 */
export async function search(query) {
  const result = await tavilySearch(query);
  return {
    answer: result.answer,
    sources: result.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 300),
    })),
  };
}

/**
 * Extract content from a URL.
 * @param {string} url - URL to fetch
 * @returns {Promise<Object>} Extracted content
 */
export async function fetchUrl(url) {
  const response = await fetch(`${TAVILY_URL}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      urls: [url],
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily extract ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.results?.[0] || { error: "No content extracted" };
}

/**
 * Deep research on a company/account.
 * @param {string} company - Company name
 * @returns {Promise<Object>} Company research results
 */
export async function researchAccount(company) {
  const queries = [
    `${company} AEC construction BIM projects`,
    `${company} recent news contracts awards`,
    `${company} digital transformation construction technology`,
  ];

  const results = await Promise.all(
    queries.map((q) => tavilySearch(q, { depth: "advanced", maxResults: 3 })),
  );

  return {
    company,
    sections: queries.map((q, i) => ({
      query: q,
      answer: results[i].answer,
      sources: results[i].results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 300),
      })),
    })),
  };
}

/**
 * AEC market intelligence on a topic.
 * @param {string} topic - Market topic to research
 * @returns {Promise<Object>}
 */
export async function researchMarket(topic) {
  const result = await tavilySearch(`AEC construction ${topic}`, {
    depth: "advanced",
    maxResults: 8,
  });

  return {
    topic,
    answer: result.answer,
    sources: result.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 300),
    })),
  };
}
