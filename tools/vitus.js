import { VITUS_API_KEY } from "./config.js";

const BASE_URL = "https://api.vitus.io/v1";

async function vitusFetch(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${VITUS_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Vitus API ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

/**
 * Get engagement score and feature flags for a single user.
 * @param {string} userId - Vitus user ID
 * @returns {Promise<Object>}
 */
export async function getUserEngagement(userId) {
  return vitusFetch(`/users/${userId}/engagement`);
}

/**
 * Get all users at a domain with their engagement scores.
 * @param {string} domain - Email domain (e.g. cowi.com)
 * @returns {Promise<Array>}
 */
export async function getAccountEngagement(domain) {
  return vitusFetch("/users/engagement", { domain });
}

/**
 * Get users who logged in within the last N days.
 * @param {number} days - Lookback window
 * @returns {Promise<Array>}
 */
export async function getRecentLogins(days) {
  return vitusFetch("/users/recent-logins", { days });
}

/**
 * Get users who changed engagement tier in the last N days.
 * @param {number} days - Lookback window
 * @returns {Promise<Array>}
 */
export async function getTierMovements(days) {
  return vitusFetch("/users/tier-movements", { days });
}

/**
 * Get highest scoring users.
 * @param {number} [limit=20] - Number of results
 * @returns {Promise<Array>}
 */
export async function getTopUsers(limit = 20) {
  return vitusFetch("/users/top", { limit });
}

/**
 * Get users with no login in the last N days.
 * @param {number} days - Inactivity threshold
 * @returns {Promise<Array>}
 */
export async function getInactiveUsers(days) {
  return vitusFetch("/users/inactive", { days });
}

/**
 * Get feature adoption rates across all accounts.
 * @returns {Promise<Object>}
 */
export async function getFeatureAdoption() {
  return vitusFetch("/analytics/feature-adoption");
}
