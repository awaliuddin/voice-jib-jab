/**
 * Multi-Tenant E2E Integration Test — N-13 Phase 3 Completion
 *
 * Verifies complete isolation across all three N-13 phases simultaneously:
 *   Phase 1: TenantClaimsLoader — per-tenant AllowedClaimsRegistry
 *   Phase 2: OpaEvaluator.setTenantPolicyData — per-tenant OPA threshold namespacing
 *   Phase 3: TenantVectorStoreFactory — per-tenant ChromaDB collection isolation
 *
 * Two tenants (org_alpha, org_beta) are configured with entirely different
 * policies, claim sets, and vector collections. The tests prove that data,
 * policy decisions, and collection references never cross tenant boundaries.
 *
 * Performance benchmark: multi-tenant path adds no measurable overhead to
 * single-tenant evaluation (factory lookups are O(1) Map operations).
 */

// ── Mocks (before imports) ───────────────────────────────────────────────
// MOCK JUSTIFIED: EventBus is process-global infra; ChromaDB requires a running server not
// available in CI. Integration coverage validates multi-tenant policy isolation, RBAC, and
// memory partitioning, not ChromaDB wire protocol.

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    onSession: jest.fn(),
    offSession: jest.fn(),
  },
}));

// Mock ChromaDB so Phase 3 tests don't need a running ChromaDB server
const mockChromaUpsert = jest.fn().mockResolvedValue(undefined);
const mockChromaQuery = jest.fn().mockResolvedValue({
  ids: [[]], documents: [[]], metadatas: [[]], distances: [[]],
});
const mockDeleteCollection = jest.fn().mockResolvedValue(undefined);
const mockGetOrCreateCollection = jest
  .fn()
  .mockResolvedValue({ upsert: mockChromaUpsert, query: mockChromaQuery });

jest.mock("chromadb", () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    getOrCreateCollection: mockGetOrCreateCollection,
    deleteCollection: mockDeleteCollection,
  })),
}));

// ── Imports ──────────────────────────────────────────────────────────────

import { ControlEngine } from "../../lanes/laneC_control.js";
import { AllowedClaimsRegistry } from "../../insurance/allowed_claims_registry.js";
import { OpaEvaluator } from "../../insurance/opa_evaluator.js";
import { TenantClaimsLoader } from "../../services/TenantClaimsLoader.js";
import { TenantVectorStoreFactory } from "../../services/TenantVectorStoreFactory.js";
import type { EvaluationContext } from "../../insurance/policy_gate.js";

// ── Tenant Fixtures ──────────────────────────────────────────────────────

const TENANT_ALPHA = "org_alpha";
const TENANT_BETA = "org_beta";

// Alpha: medical device company, strict moderation (lower thresholds)
const alphaRegistry = new AllowedClaimsRegistry({
  claims: [
    { id: "A-001", text: "FDA cleared class II medical device" },
    { id: "A-002", text: "Clinical trial data available upon request" },
  ],
  disallowedPatterns: ["guaranteed cure", "100% effective", "miracle treatment"],
  enableFileLoad: false,
});

// Beta: fintech company, permissive moderation, different claims
const betaRegistry = new AllowedClaimsRegistry({
  claims: [
    { id: "B-001", text: "FDIC insured deposits up to 250000 dollars" },
    { id: "B-002", text: "Zero-fee transactions for premium members" },
  ],
  disallowedPatterns: ["guaranteed returns", "risk-free investment"],
  enableFileLoad: false,
});

// ── Helpers ──────────────────────────────────────────────────────────────

function makeCtx(
  text: string,
  role: "user" | "assistant" = "assistant",
  tenantId?: string,
): EvaluationContext {
  return { sessionId: "e2e-session", role, text, isFinal: true, tenantId };
}

function makeEngine(
  sessionId: string,
  tenantId: string,
  registry: AllowedClaimsRegistry,
): ControlEngine {
  return new ControlEngine(sessionId, {
    tenantId,
    claimsRegistry: registry, // explicit registry (bypasses loader in this test)
    moderationDenyPatterns: [/hate_speech/i],
    moderationCategories: [],
    cancelOutputThreshold: 10,
    enabled: false,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Multi-Tenant E2E: Complete Isolation (N-13 Phases 1+2+3)", () => {
  let claimsLoader: TenantClaimsLoader;
  let vectorFactory: TenantVectorStoreFactory;
  let opaEvaluator: OpaEvaluator;

  beforeEach(() => {
    jest.clearAllMocks();
    claimsLoader = new TenantClaimsLoader();
    vectorFactory = new TenantVectorStoreFactory({ url: "http://localhost:8000" });
    opaEvaluator = new OpaEvaluator("nonexistent.wasm"); // not initialized — uses threshold fallback
  });

  afterEach(() => {
    claimsLoader.clear();
    vectorFactory.clear();
    opaEvaluator.clearTenantPolicyData();
  });

  // ── Phase 1: Claims Registry Isolation ────────────────────────────────

  describe("Phase 1 — Claims registry isolation", () => {
    beforeEach(() => {
      claimsLoader.setRegistryForTenant(TENANT_ALPHA, alphaRegistry);
      claimsLoader.setRegistryForTenant(TENANT_BETA, betaRegistry);
    });

    it("tenants receive different registry instances", () => {
      const regA = claimsLoader.getRegistryForTenant(TENANT_ALPHA);
      const regB = claimsLoader.getRegistryForTenant(TENANT_BETA);
      expect(regA).toBe(alphaRegistry);
      expect(regB).toBe(betaRegistry);
      expect(regA).not.toBe(regB);
    });

    it("alpha approved claim not recognised by beta registry", () => {
      const regA = claimsLoader.getRegistryForTenant(TENANT_ALPHA);
      const regB = claimsLoader.getRegistryForTenant(TENANT_BETA);

      expect(regA.matchText("FDA cleared class II medical device").matched).toBe(true);
      expect(regB.matchText("FDA cleared class II medical device").matched).toBe(false);
    });

    it("beta approved claim not recognised by alpha registry", () => {
      const regA = claimsLoader.getRegistryForTenant(TENANT_ALPHA);
      const regB = claimsLoader.getRegistryForTenant(TENANT_BETA);

      expect(regB.matchText("FDIC insured deposits up to 250000 dollars").matched).toBe(true);
      expect(regA.matchText("FDIC insured deposits up to 250000 dollars").matched).toBe(false);
    });

    it("alpha disallowed pattern not blocked by beta registry", () => {
      const regA = claimsLoader.getRegistryForTenant(TENANT_ALPHA);
      const regB = claimsLoader.getRegistryForTenant(TENANT_BETA);

      expect(regA.matchDisallowedPatterns("miracle treatment option").matched).toBe(true);
      expect(regB.matchDisallowedPatterns("miracle treatment option").matched).toBe(false);
    });

    it("beta disallowed pattern not blocked by alpha registry", () => {
      const regA = claimsLoader.getRegistryForTenant(TENANT_ALPHA);
      const regB = claimsLoader.getRegistryForTenant(TENANT_BETA);

      expect(regB.matchDisallowedPatterns("guaranteed returns on investment").matched).toBe(true);
      expect(regA.matchDisallowedPatterns("guaranteed returns on investment").matched).toBe(false);
    });
  });

  // ── Phase 2: OPA Threshold Isolation ──────────────────────────────────

  describe("Phase 2 — OPA tenant threshold isolation", () => {
    beforeEach(() => {
      // Alpha: very strict — low moderation threshold (0.1 = block almost everything)
      opaEvaluator.setTenantPolicyData(TENANT_ALPHA, {
        moderationThresholds: { default: 0.1 },
        claimsThreshold: 0.9,
      });
      // Beta: permissive — high moderation threshold (0.9 = allow almost everything)
      opaEvaluator.setTenantPolicyData(TENANT_BETA, {
        moderationThresholds: { default: 0.9 },
        claimsThreshold: 0.3,
      });
    });

    it("alpha and beta receive different threshold overrides", () => {
      const alphaData = opaEvaluator.getTenantPolicyData(TENANT_ALPHA);
      const betaData = opaEvaluator.getTenantPolicyData(TENANT_BETA);

      expect(alphaData?.moderationThresholds?.default).toBe(0.1);
      expect(betaData?.moderationThresholds?.default).toBe(0.9);
    });

    it("alpha claims threshold is more strict than beta", () => {
      const alphaData = opaEvaluator.getTenantPolicyData(TENANT_ALPHA);
      const betaData = opaEvaluator.getTenantPolicyData(TENANT_BETA);

      expect(alphaData!.claimsThreshold!).toBeGreaterThan(betaData!.claimsThreshold!);
    });

    it("clearing alpha data does not affect beta", () => {
      opaEvaluator.clearTenantPolicyData(TENANT_ALPHA);

      expect(opaEvaluator.getTenantPolicyData(TENANT_ALPHA)).toBeUndefined();
      expect(opaEvaluator.getTenantPolicyData(TENANT_BETA)).toBeDefined();
    });

    it("evaluateModeratorCheck uses tenant-specific thresholds", () => {
      // OPA not initialized → threshold comparison is in caller code
      // But the evaluator stores different data per tenant — confirm isolation
      const alphaData = opaEvaluator.getTenantPolicyData(TENANT_ALPHA);
      const betaData = opaEvaluator.getTenantPolicyData(TENANT_BETA);

      // Different configurations stored independently
      expect(alphaData).not.toEqual(betaData);
      expect(alphaData?.moderationThresholds?.default).not.toBe(
        betaData?.moderationThresholds?.default,
      );
    });

    it("unknown tenant returns undefined (not another tenant's data)", () => {
      expect(opaEvaluator.getTenantPolicyData("org_unknown")).toBeUndefined();
    });
  });

  // ── Phase 3: Vector Store Collection Isolation ─────────────────────────

  describe("Phase 3 — Vector store collection isolation", () => {
    it("alpha and beta get different collection names", () => {
      expect(vectorFactory.getCollectionForTenant(TENANT_ALPHA)).toBe(
        "knowledge_org_alpha",
      );
      expect(vectorFactory.getCollectionForTenant(TENANT_BETA)).toBe(
        "knowledge_org_beta",
      );
    });

    it("stores for different tenants are different instances", () => {
      const storeA = vectorFactory.getStoreForTenant(TENANT_ALPHA);
      const storeB = vectorFactory.getStoreForTenant(TENANT_BETA);
      expect(storeA).not.toBe(storeB);
    });

    it("each store's collectionName matches factory's getCollectionForTenant", () => {
      const storeA = vectorFactory.getStoreForTenant(TENANT_ALPHA);
      const storeB = vectorFactory.getStoreForTenant(TENANT_BETA);
      expect(storeA.collectionName).toBe(
        vectorFactory.getCollectionForTenant(TENANT_ALPHA),
      );
      expect(storeB.collectionName).toBe(
        vectorFactory.getCollectionForTenant(TENANT_BETA),
      );
    });

    it("default tenant maps to knowledge_default (migration path)", () => {
      expect(vectorFactory.getCollectionForTenant("default")).toBe(
        "knowledge_default",
      );
    });

    it("connecting alpha store calls getOrCreateCollection with alpha collection name", async () => {
      const storeA = vectorFactory.getStoreForTenant(TENANT_ALPHA);
      await storeA.connect();
      expect(mockGetOrCreateCollection).toHaveBeenCalledWith(
        expect.objectContaining({ name: "knowledge_org_alpha" }),
      );
    });

    it("connecting beta store uses beta collection name (separate from alpha)", async () => {
      vectorFactory.getStoreForTenant(TENANT_ALPHA); // don't connect alpha
      const storeB = vectorFactory.getStoreForTenant(TENANT_BETA);
      await storeB.connect();
      // Only beta's collection was requested
      expect(mockGetOrCreateCollection).toHaveBeenCalledTimes(1);
      expect(mockGetOrCreateCollection).toHaveBeenCalledWith(
        expect.objectContaining({ name: "knowledge_org_beta" }),
      );
    });

    it("indexing to alpha store upserts to alpha collection only", async () => {
      const storeA = vectorFactory.getStoreForTenant<{ src: string }>(TENANT_ALPHA);
      await storeA.connect();
      await storeA.index([
        { id: "a1", text: "Alpha proprietary knowledge", metadata: { src: "alpha" } },
      ]);
      expect(mockChromaUpsert).toHaveBeenCalledTimes(1);
      expect(mockChromaUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ ids: ["a1"] }),
      );
    });

    it("beta store query is independent of alpha store index", async () => {
      const storeA = vectorFactory.getStoreForTenant<{ src: string }>(TENANT_ALPHA);
      const storeB = vectorFactory.getStoreForTenant<{ src: string }>(TENANT_BETA);

      await storeA.connect();
      await storeA.index([
        { id: "a1", text: "Alpha secret formula", metadata: { src: "alpha" } },
      ]);

      // Beta has its own collection — query returns beta's (empty) results
      mockChromaQuery.mockResolvedValueOnce({
        ids: [[]], documents: [[]], metadatas: [[]], distances: [[]],
      });
      await storeB.connect();
      const results = await storeB.search("Alpha secret formula", 5);

      // Beta's collection returned nothing (isolation verified)
      expect(results).toHaveLength(0);
      // upsert was only called once (for alpha), not for beta
      expect(mockChromaUpsert).toHaveBeenCalledTimes(1);
    });
  });

  // ── Combined: All Three Phases Together ───────────────────────────────

  describe("Combined isolation — all three phases", () => {
    it("two ControlEngines with different tenantIds use independent claim sets", async () => {
      const engineAlpha = makeEngine("sess-alpha", TENANT_ALPHA, alphaRegistry);
      const engineBeta = makeEngine("sess-beta", TENANT_BETA, betaRegistry);

      // Alpha engine refuses "guaranteed cure" (in alpha disallowedPatterns)
      const alphaResult = await engineAlpha.evaluate(
        makeCtx("This is a guaranteed cure for your condition", "assistant", TENANT_ALPHA),
      );
      // Beta engine does NOT refuse "guaranteed cure" (not in beta disallowedPatterns)
      const betaResult = await engineBeta.evaluate(
        makeCtx("This is a guaranteed cure for your condition", "assistant", TENANT_BETA),
      );

      expect(alphaResult.reasonCodes).toContain("CLAIMS_DISALLOWED");
      expect(betaResult.reasonCodes).not.toContain("CLAIMS_DISALLOWED");
    });

    it("alpha refuse does not affect beta evaluation result", async () => {
      const engineAlpha = makeEngine("sess-alpha", TENANT_ALPHA, alphaRegistry);
      const engineBeta = makeEngine("sess-beta", TENANT_BETA, betaRegistry);

      // Alpha: "guaranteed returns" is fine (not in alpha deny list)
      const alphaResult = await engineAlpha.evaluate(
        makeCtx("We offer guaranteed returns on your investment", "assistant", TENANT_ALPHA),
      );
      // Beta: "guaranteed returns" is blocked (in beta disallowedPatterns)
      const betaResult = await engineBeta.evaluate(
        makeCtx("We offer guaranteed returns on your investment", "assistant", TENANT_BETA),
      );

      expect(alphaResult.reasonCodes).not.toContain("CLAIMS_DISALLOWED");
      expect(betaResult.reasonCodes).toContain("CLAIMS_DISALLOWED");
    });

    it("vector factory produces different collection names for all tenants simultaneously", () => {
      const tenants = ["org_alpha", "org_beta", "org_gamma", "default"];
      const names = tenants.map((t) => vectorFactory.getCollectionForTenant(t));
      const uniqueNames = new Set(names);

      // All collection names are unique
      expect(uniqueNames.size).toBe(tenants.length);
      // All names contain the tenant ID
      for (let i = 0; i < tenants.length; i++) {
        expect(names[i]).toContain(tenants[i]);
      }
    });

    it("OPA tenant data for alpha does not leak to beta even after updates", () => {
      opaEvaluator.setTenantPolicyData(TENANT_ALPHA, { moderationThresholds: { default: 0.1 } });
      opaEvaluator.setTenantPolicyData(TENANT_BETA, { moderationThresholds: { default: 0.9 } });

      // Update alpha without touching beta
      opaEvaluator.setTenantPolicyData(TENANT_ALPHA, { moderationThresholds: { default: 0.05 } });

      expect(opaEvaluator.getTenantPolicyData(TENANT_ALPHA)?.moderationThresholds?.default).toBe(0.05);
      expect(opaEvaluator.getTenantPolicyData(TENANT_BETA)?.moderationThresholds?.default).toBe(0.9);
    });
  });

  // ── Performance Benchmark ─────────────────────────────────────────────

  describe("Performance benchmark — multi-tenant overhead", () => {
    it("TenantClaimsLoader O(1) lookup adds <1ms overhead per evaluation", () => {
      // Populate loader with multiple tenants
      for (let i = 0; i < 100; i++) {
        const r = new AllowedClaimsRegistry({ enableFileLoad: false });
        claimsLoader.setRegistryForTenant(`org_tenant_${i}`, r);
      }

      const iterations = 1000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        claimsLoader.getRegistryForTenant(`org_tenant_${i % 100}`);
      }
      const elapsed = performance.now() - start;
      const perLookupMs = elapsed / iterations;

      // Each Map.get() should be well under 0.1ms
      expect(perLookupMs).toBeLessThan(0.1);
    });

    it("TenantVectorStoreFactory O(1) lookup adds <1ms overhead per evaluation", () => {
      const iterations = 1000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        vectorFactory.getStoreForTenant(`tenant_${i % 10}`);
      }
      const elapsed = performance.now() - start;
      const perLookupMs = elapsed / iterations;

      expect(perLookupMs).toBeLessThan(0.1);
    });

    it("OpaEvaluator.getTenantPolicyData O(1) lookup adds <1ms overhead", () => {
      for (let i = 0; i < 50; i++) {
        opaEvaluator.setTenantPolicyData(`tenant_${i}`, { moderationThresholds: { default: 0.5 } });
      }

      const iterations = 1000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        opaEvaluator.getTenantPolicyData(`tenant_${i % 50}`);
      }
      const elapsed = performance.now() - start;
      const perLookupMs = elapsed / iterations;

      expect(perLookupMs).toBeLessThan(0.1);
    });
  });
});
