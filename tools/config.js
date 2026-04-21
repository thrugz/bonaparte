import { config } from "dotenv";
import { userPath, ensureUserDir } from "../lib/paths.js";

ensureUserDir();
config({ path: userPath(".env") });

// Dashboard needs direct API access
export const SLACK_USER_TOKEN = process.env.SLACK_USER_TOKEN;
export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
export const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
export const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

// Custom API clients
export const VITUS_API_KEY = process.env.VITUS_API_KEY;
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export const CANVAS_IDS = {
  memoryStore: "F0APEKEGC2D",
  memoryGraph: "F0ANJTEENLT",
  accountSignals: "F0AN98D2QLF",
  weeklyBrief: "F0ANU9LBVC4",
  draftBank: "F0APK097DS4",
  decisionsContext: "F0ANJACRN91",
  strategyCowi: "F0AP44NCA8G",
  strategyRamboll: "F0AN7Q8KQJJ",
  adoptionReport: "F0ANBBH0GKE",
};

export const OWNER_IDS = {
  bram: "31176904",
  josephine: "30235134",
  casper: "29290715",
  bertrand: "79783610",
  stine: "49882854",
};

export const SLACK_USER_IDS = {
  bram: "U0A0A097T1U",
  casper: "U06LQV2HF4M",
};
