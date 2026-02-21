/**
 * AllowedClaimsRegistry Unit Tests
 *
 * Tests the claims registry that manages approved statements, text matching,
 * and disallowed pattern detection.
 *
 * All tests use enableFileLoad: false to prevent file system access.
 *
 * Target Coverage: 85%+
 */

import {
  AllowedClaimsRegistry,
  type ApprovedClaim,
} from "../../insurance/allowed_claims_registry.js";

// ── Helpers ────────────────────────────────────────────────────────────

function makeRegistry(
  claims: ApprovedClaim[] = [],
  disallowedPatterns: string[] = [],
  partialMatchThreshold?: number,
): AllowedClaimsRegistry {
  return new AllowedClaimsRegistry({
    claims,
    disallowedPatterns,
    partialMatchThreshold,
    enableFileLoad: false,
  });
}

const FDA_CLAIM: ApprovedClaim = {
  id: "CLAIM-001",
  text: "Our product is FDA approved",
  source: "regulatory",
  category: "compliance",
  requiredDisclaimerId: "DISC-001",
};

const TRIAL_CLAIM: ApprovedClaim = {
  id: "CLAIM-002",
  text: "Clinical trials showed 85% efficacy",
  source: "research",
  category: "clinical",
};

const SAFETY_CLAIM: ApprovedClaim = {
  id: "CLAIM-003",
  text: "No serious adverse effects were reported",
  source: "research",
};

// ── Constructor ────────────────────────────────────────────────────────

describe("AllowedClaimsRegistry", () => {
  describe("constructor", () => {
    it("should create an empty registry with no config", () => {
      const registry = makeRegistry();

      expect(registry.size).toBe(0);
      expect(registry.getAllClaims()).toEqual([]);
      expect(registry.getDisallowedPatterns()).toEqual([]);
    });

    it("should create a registry with injected claims", () => {
      const registry = makeRegistry([FDA_CLAIM, TRIAL_CLAIM]);

      expect(registry.size).toBe(2);
    });

    it("should create a registry with disallowed patterns", () => {
      const registry = makeRegistry([], ["guaranteed cure", "100% safe"]);

      expect(registry.getDisallowedPatterns()).toEqual([
        "guaranteed cure",
        "100% safe",
      ]);
    });

    it("should create a registry with both claims and disallowed patterns", () => {
      const registry = makeRegistry(
        [FDA_CLAIM],
        ["guaranteed cure"],
      );

      expect(registry.size).toBe(1);
      expect(registry.getDisallowedPatterns()).toHaveLength(1);
    });
  });

  // ── getById ────────────────────────────────────────────────────────

  describe("getById", () => {
    it("should return a claim by its ID", () => {
      const registry = makeRegistry([FDA_CLAIM, TRIAL_CLAIM]);
      const result = registry.getById("CLAIM-001");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("CLAIM-001");
      expect(result!.text).toBe("Our product is FDA approved");
    });

    it("should return null for a non-existent claim ID", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const result = registry.getById("CLAIM-999");

      expect(result).toBeNull();
    });

    it("should return null when registry is empty", () => {
      const registry = makeRegistry();
      const result = registry.getById("CLAIM-001");

      expect(result).toBeNull();
    });

    it("should preserve all claim fields", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const result = registry.getById("CLAIM-001");

      expect(result).toEqual(FDA_CLAIM);
    });
  });

  // ── matchText ──────────────────────────────────────────────────────

  describe("matchText", () => {
    describe("exact match", () => {
      it("should return exact match with confidence 1.0 for identical text", () => {
        const registry = makeRegistry([FDA_CLAIM]);
        const result = registry.matchText("Our product is FDA approved");

        expect(result.matched).toBe(true);
        expect(result.matchType).toBe("exact");
        expect(result.confidence).toBe(1.0);
        expect(result.claimId).toBe("CLAIM-001");
      });

      it("should match case-insensitively for exact match", () => {
        const registry = makeRegistry([FDA_CLAIM]);
        const result = registry.matchText("our product is fda approved");

        expect(result.matched).toBe(true);
        expect(result.matchType).toBe("exact");
        expect(result.confidence).toBe(1.0);
      });

      it("should trim whitespace for exact match", () => {
        const registry = makeRegistry([FDA_CLAIM]);
        const result = registry.matchText("  Our product is FDA approved  ");

        expect(result.matched).toBe(true);
        expect(result.matchType).toBe("exact");
      });

      it("should return requiredDisclaimerId on exact match when present", () => {
        const registry = makeRegistry([FDA_CLAIM]);
        const result = registry.matchText("Our product is FDA approved");

        expect(result.requiredDisclaimerId).toBe("DISC-001");
      });

      it("should return null requiredDisclaimerId when claim has none", () => {
        const registry = makeRegistry([TRIAL_CLAIM]);
        const result = registry.matchText(
          "Clinical trials showed 85% efficacy",
        );

        expect(result.requiredDisclaimerId).toBeNull();
      });
    });

    describe("partial match", () => {
      it("should return partial match when word overlap exceeds threshold", () => {
        const registry = makeRegistry([FDA_CLAIM]);
        // "Our product is FDA approved" has 5 words; a text sharing some but
        // not all words will produce a partial match. The overlap algorithm
        // counts claim words found in the proposed text set.
        // Use a text that shares 3 of 5 claim words: "Our", "product", "is"
        const result = registry.matchText(
          "Our product is excellent and revolutionary",
        );

        expect(result.matched).toBe(true);
        expect(result.matchType).toBe("partial");
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
        expect(result.confidence).toBeLessThan(1.0);
        expect(result.claimId).toBe("CLAIM-001");
      });

      it("should not match when word overlap is below threshold", () => {
        const registry = makeRegistry([FDA_CLAIM], [], 0.6);
        // Very different text with minimal overlap
        const result = registry.matchText("completely different statement here");

        expect(result.matched).toBe(false);
        expect(result.matchType).toBe("none");
      });
    });

    describe("no match", () => {
      it("should return no match for unrelated text", () => {
        const registry = makeRegistry([FDA_CLAIM]);
        const result = registry.matchText("The sky is blue today");

        expect(result.matched).toBe(false);
        expect(result.matchType).toBe("none");
        expect(result.claimId).toBeNull();
        expect(result.requiredDisclaimerId).toBeNull();
      });

      it("should return no match when registry is empty", () => {
        const registry = makeRegistry();
        const result = registry.matchText("Our product is FDA approved");

        expect(result.matched).toBe(false);
        expect(result.matchType).toBe("none");
        expect(result.confidence).toBe(0);
      });

      it("should select the best partial match from multiple claims", () => {
        const registry = makeRegistry([FDA_CLAIM, TRIAL_CLAIM, SAFETY_CLAIM]);
        // Text that overlaps more with TRIAL_CLAIM
        const result = registry.matchText(
          "Clinical trials showed impressive efficacy results",
        );

        if (result.matched) {
          expect(result.claimId).toBe("CLAIM-002");
        }
      });
    });
  });

  // ── matchDisallowedPatterns ────────────────────────────────────────

  describe("matchDisallowedPatterns", () => {
    it("should detect matching disallowed pattern", () => {
      const registry = makeRegistry([], ["guaranteed cure", "100% safe"]);
      const result = registry.matchDisallowedPatterns(
        "This is a guaranteed cure for all diseases",
      );

      expect(result.matched).toBe(true);
      expect(result.patterns).toContain("guaranteed cure");
    });

    it("should detect multiple matching patterns", () => {
      const registry = makeRegistry([], ["guaranteed cure", "100% safe"]);
      const result = registry.matchDisallowedPatterns(
        "This is a guaranteed cure and it is 100% safe",
      );

      expect(result.matched).toBe(true);
      expect(result.patterns).toHaveLength(2);
      expect(result.patterns).toContain("guaranteed cure");
      expect(result.patterns).toContain("100% safe");
    });

    it("should not match when text does not contain disallowed patterns", () => {
      const registry = makeRegistry([], ["guaranteed cure"]);
      const result = registry.matchDisallowedPatterns(
        "Our product has been clinically tested",
      );

      expect(result.matched).toBe(false);
      expect(result.patterns).toEqual([]);
    });

    it("should match disallowed patterns case-insensitively", () => {
      const registry = makeRegistry([], ["guaranteed cure"]);
      const result = registry.matchDisallowedPatterns(
        "This is a GUARANTEED CURE",
      );

      expect(result.matched).toBe(true);
      expect(result.patterns).toContain("guaranteed cure");
    });

    it("should return no match for empty text", () => {
      const registry = makeRegistry([], ["guaranteed cure"]);
      const result = registry.matchDisallowedPatterns("");

      expect(result.matched).toBe(false);
      expect(result.patterns).toEqual([]);
    });

    it("should return no match when no disallowed patterns are configured", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const result = registry.matchDisallowedPatterns("guaranteed cure");

      expect(result.matched).toBe(false);
      expect(result.patterns).toEqual([]);
    });
  });

  // ── getAllClaims ───────────────────────────────────────────────────

  describe("getAllClaims", () => {
    it("should return all registered claims", () => {
      const registry = makeRegistry([FDA_CLAIM, TRIAL_CLAIM]);
      const claims = registry.getAllClaims();

      expect(claims).toHaveLength(2);
      expect(claims[0].id).toBe("CLAIM-001");
      expect(claims[1].id).toBe("CLAIM-002");
    });

    it("should return empty array when no claims registered", () => {
      const registry = makeRegistry();
      expect(registry.getAllClaims()).toEqual([]);
    });

    it("should return a copy, not the internal array", () => {
      const registry = makeRegistry([FDA_CLAIM]);
      const claims1 = registry.getAllClaims();
      const claims2 = registry.getAllClaims();

      expect(claims1).not.toBe(claims2);
      expect(claims1).toEqual(claims2);
    });
  });

  // ── getDisallowedPatterns ─────────────────────────────────────────

  describe("getDisallowedPatterns", () => {
    it("should return all disallowed patterns", () => {
      const registry = makeRegistry([], ["pattern1", "pattern2"]);
      const patterns = registry.getDisallowedPatterns();

      expect(patterns).toEqual(["pattern1", "pattern2"]);
    });

    it("should return empty array when no patterns configured", () => {
      const registry = makeRegistry();
      expect(registry.getDisallowedPatterns()).toEqual([]);
    });

    it("should return a copy, not the internal array", () => {
      const registry = makeRegistry([], ["pattern1"]);
      const patterns1 = registry.getDisallowedPatterns();
      const patterns2 = registry.getDisallowedPatterns();

      expect(patterns1).not.toBe(patterns2);
      expect(patterns1).toEqual(patterns2);
    });
  });

  // ── size property ─────────────────────────────────────────────────

  describe("size", () => {
    it("should return 0 for empty registry", () => {
      const registry = makeRegistry();
      expect(registry.size).toBe(0);
    });

    it("should return the number of registered claims", () => {
      const registry = makeRegistry([FDA_CLAIM, TRIAL_CLAIM, SAFETY_CLAIM]);
      expect(registry.size).toBe(3);
    });

    it("should not count disallowed patterns as claims", () => {
      const registry = makeRegistry([], ["pattern1", "pattern2"]);
      expect(registry.size).toBe(0);
    });
  });
});
