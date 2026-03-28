import type { CallerIntent } from "../services/IntentClassifier.js";

/** Canonical list of recognized caller intent categories. */
export const VALID_INTENTS: CallerIntent[] = [
  "billing",
  "support",
  "sales",
  "complaint",
  "general",
];
