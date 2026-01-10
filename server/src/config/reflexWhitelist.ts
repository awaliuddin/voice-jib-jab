/**
 * Lane A Reflex Whitelist
 *
 * Approved utterances for Lane A to use as acknowledgements.
 * These phrases are non-committal and don't make factual claims.
 */

export const REFLEX_WHITELIST: string[] = [
  // Short acknowledgements
  "Got it",
  "One moment",
  "Sure thing",
  "Working on it",
  "Let me check",
  "I hear you",

  // Medium acknowledgements
  "Let me think about that",
  "Give me just a moment",
  "Let me look into that",
  "One second, please",

  // Confirmation phrases
  "Understood",
  "On it",
  "Okay",
  "Alright",
];

/**
 * Get a random reflex utterance
 */
export function getRandomReflex(): string {
  const index = Math.floor(Math.random() * REFLEX_WHITELIST.length);
  return REFLEX_WHITELIST[index];
}

/**
 * Check if an utterance is in the whitelist
 */
export function isApprovedReflex(utterance: string): boolean {
  return REFLEX_WHITELIST.some(
    (approved) => approved.toLowerCase() === utterance.toLowerCase(),
  );
}

/**
 * Get weighted random reflex (prefer shorter phrases)
 * Shorter phrases are preferred for faster delivery
 */
export function getWeightedReflex(): string {
  // Sort by length and weight shorter phrases more heavily
  const sorted = [...REFLEX_WHITELIST].sort((a, b) => a.length - b.length);
  const weights = sorted.map((_, i) => Math.pow(0.7, i)); // Exponential decay
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let random = Math.random() * totalWeight;
  for (let i = 0; i < sorted.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return sorted[i];
    }
  }

  return sorted[0];
}
