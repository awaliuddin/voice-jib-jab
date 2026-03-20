import type { CallerIntent } from "../services/IntentClassifier.js";

export const VALID_INTENTS: CallerIntent[] = [
  "billing",
  "support",
  "sales",
  "complaint",
  "general",
];
