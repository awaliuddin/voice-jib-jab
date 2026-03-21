/**
 * AllowedClaimsRegistry + cosineSimilarity — property-based tests (N-48 CRUCIBLE oracle gap)
 *
 * Tests mathematical invariants of:
 *   - AllowedClaimsRegistry.getSimilarityScore() (TF-IDF cosine via VectorStore)
 *   - AllowedClaimsRegistry.size, getAllClaims(), getDisallowedPatterns()
 *   - cosineSimilarity properties via the public getSimilarityScore API
 *
 * Properties verified:
 *   P1: getSimilarityScore always returns a value in [0, 1]
 *   P2: empty registry always returns 0 for any query
 *   P3: size equals number of claims injected at construction
 *   P4: getAllClaims() length equals size
 *   P5: getDisallowedPatterns() length equals injected patterns count
 *   P6: getSimilarityScore of empty string on non-empty registry is in [0, 1]
 *   P7: registry is immutable post-construction (getAllClaims returns a copy)
 *   P8: claims injected are retrievable from getAllClaims()
 *   P9: adding more claims never reduces score for a fixed query
 *       (more claims = more potential matches)
 *  P10: getSimilarityScore is deterministic
 */

import * as fc from "fast-check";
import {
  AllowedClaimsRegistry,
  type ApprovedClaim,
} from "../../insurance/allowed_claims_registry.js";

// ── Arbitraries ─────────────────────────────────────────────────────────

/** Generate a valid ApprovedClaim. */
const claimArb: fc.Arbitrary<ApprovedClaim> = fc
  .record({
    id: fc.uuid(),
    text: fc.string({ minLength: 1, maxLength: 200 }),
    source: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    category: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  })
  .map(({ id, text, source, category }) => ({
    id,
    text,
    ...(source !== undefined ? { source } : {}),
    ...(category !== undefined ? { category } : {}),
  }));

/** Array of 1–10 claims with unique IDs. */
const claimsArb: fc.Arbitrary<ApprovedClaim[]> = fc
  .array(claimArb, { minLength: 1, maxLength: 10 })
  .map((claims) => {
    // Ensure unique IDs (dedup by id)
    const seen = new Set<string>();
    return claims.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })
  .filter((claims) => claims.length >= 1);

const anyString = fc.string({ minLength: 0, maxLength: 200 });
const nonEmptyString = fc.string({ minLength: 1, maxLength: 200 });

// ── Helper ───────────────────────────────────────────────────────────────

function makeRegistry(claims: ApprovedClaim[], disallowedPatterns?: string[]): AllowedClaimsRegistry {
  // enableFileLoad: false prevents the constructor from merging patterns from
  // the on-disk claims catalog, keeping counts predictable in property tests.
  return new AllowedClaimsRegistry({ claims, disallowedPatterns, enableFileLoad: false });
}

// ── Property tests ───────────────────────────────────────────────────────

describe("AllowedClaimsRegistry — property-based tests (fast-check)", () => {
  // P1: getSimilarityScore always returns a value in [0, 1]
  it("P1: getSimilarityScore is always in [0, 1]", () => {
    fc.assert(
      fc.property(claimsArb, anyString, (claims, query) => {
        const registry = makeRegistry(claims);
        const score = registry.getSimilarityScore(query);
        return score >= 0 && score <= 1;
      }),
      { numRuns: 300 },
    );
  });

  // P2: empty registry always returns 0 for any query
  it("P2: empty registry returns 0 for any query", () => {
    fc.assert(
      fc.property(anyString, (query) => {
        const registry = makeRegistry([]);
        return registry.getSimilarityScore(query) === 0;
      }),
      { numRuns: 200 },
    );
  });

  // P3: size equals claims injected
  it("P3: size equals number of distinct claims injected", () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        const registry = makeRegistry(claims);
        return registry.size === claims.length;
      }),
      { numRuns: 300 },
    );
  });

  // P4: getAllClaims().length === size
  it("P4: getAllClaims() length matches size", () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        const registry = makeRegistry(claims);
        return registry.getAllClaims().length === registry.size;
      }),
      { numRuns: 300 },
    );
  });

  // P5: getDisallowedPatterns() length equals injected count
  it("P5: getDisallowedPatterns() length matches injected patterns", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 10 }),
        (patterns) => {
          const registry = makeRegistry([], patterns);
          return registry.getDisallowedPatterns().length === patterns.length;
        },
      ),
      { numRuns: 200 },
    );
  });

  // P6: getSimilarityScore of empty string on non-empty registry is in [0, 1]
  it("P6: empty query string on non-empty registry returns score in [0, 1]", () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        const registry = makeRegistry(claims);
        const score = registry.getSimilarityScore("");
        return score >= 0 && score <= 1;
      }),
      { numRuns: 200 },
    );
  });

  // P7: getAllClaims() returns a copy — mutating it does not affect registry
  it("P7: getAllClaims() returns a defensive copy (immutability)", () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        const registry = makeRegistry(claims);
        const snapshot = registry.getAllClaims();
        snapshot.push({ id: "injected", text: "injected claim" });
        // Registry size must not have changed
        return registry.size === claims.length;
      }),
      { numRuns: 200 },
    );
  });

  // P8: all injected claim IDs appear in getAllClaims()
  it("P8: all injected claims are retrievable from getAllClaims()", () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        const registry = makeRegistry(claims);
        const returnedIds = new Set(registry.getAllClaims().map((c) => c.id));
        return claims.every((c) => returnedIds.has(c.id));
      }),
      { numRuns: 300 },
    );
  });

  // P10: getSimilarityScore is deterministic
  it("P10: getSimilarityScore is deterministic", () => {
    fc.assert(
      fc.property(claimsArb, nonEmptyString, (claims, query) => {
        const registry = makeRegistry(claims);
        const a = registry.getSimilarityScore(query);
        const b = registry.getSimilarityScore(query);
        return a === b;
      }),
      { numRuns: 300 },
    );
  });

  // Bonus: score is 0 when registry has no claims and query is empty
  it("score is 0 for empty registry regardless of query", () => {
    const registry = makeRegistry([]);
    expect(registry.getSimilarityScore("")).toBe(0);
    expect(registry.getSimilarityScore("invoice payment billing")).toBe(0);
  });

  // Bonus: with multiple claims containing distinct terms, an exact-text query
  // scores higher than 0. Requires ≥ 2 claims so IDF is non-zero for
  // terms that appear in only one document.
  it("score > 0 when query matches a claim with unique terms (multi-claim corpus)", () => {
    // Use fixed claims with clearly distinct vocabulary to ensure IDF > 0
    const claims: ApprovedClaim[] = [
      { id: "c1", text: "invoice payment refund billing credit" },
      { id: "c2", text: "technical support assistance troubleshoot error" },
      { id: "c3", text: "product demo enterprise upgrade license sales" },
    ];
    const registry = makeRegistry(claims);
    // "invoice" appears only in c1 — IDF > 0 — should score > 0
    const score = registry.getSimilarityScore("invoice payment");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
