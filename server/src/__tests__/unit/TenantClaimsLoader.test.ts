/**
 * TenantClaimsLoader Unit Tests
 *
 * Verifies that the per-tenant AllowedClaimsRegistry factory:
 * - Returns isolated (distinct) instances per tenantId
 * - Caches and reuses the same instance across calls
 * - Allows explicit injection and teardown for testing
 */

import { TenantClaimsLoader } from "../../services/TenantClaimsLoader.js";
import { AllowedClaimsRegistry } from "../../insurance/allowed_claims_registry.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeRegistry(claims: { id: string; text: string }[]) {
  return new AllowedClaimsRegistry({
    claims,
    disallowedPatterns: [],
    enableFileLoad: false,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("TenantClaimsLoader", () => {
  let loader: TenantClaimsLoader;

  beforeEach(() => {
    loader = new TenantClaimsLoader();
  });

  // ── getRegistryForTenant ─────────────────────────────────────────────

  describe("getRegistryForTenant()", () => {
    it("creates a new AllowedClaimsRegistry for an unknown tenantId", () => {
      const registry = loader.getRegistryForTenant("org_acme");
      expect(registry).toBeInstanceOf(AllowedClaimsRegistry);
    });

    it("returns the same instance on subsequent calls for the same tenantId", () => {
      const r1 = loader.getRegistryForTenant("org_acme");
      const r2 = loader.getRegistryForTenant("org_acme");
      expect(r1).toBe(r2);
    });

    it("returns different instances for different tenantIds", () => {
      const r1 = loader.getRegistryForTenant("org_acme");
      const r2 = loader.getRegistryForTenant("org_globocorp");
      expect(r1).not.toBe(r2);
    });

    it("passes supplied config to newly created registry", () => {
      const claims = [{ id: "C-001", text: "Our product is FDA approved" }];
      const registry = loader.getRegistryForTenant("org_acme", { claims, enableFileLoad: false });
      // matchText should find the approved claim
      const result = registry.matchText("Our product is FDA approved");
      expect(result.matched).toBe(true);
    });

    it("ignores config on subsequent calls (returns cached instance)", () => {
      const r1 = loader.getRegistryForTenant("org_acme", {
        claims: [{ id: "C-001", text: "Claim A" }],
        enableFileLoad: false,
      });
      const r2 = loader.getRegistryForTenant("org_acme", {
        claims: [{ id: "C-002", text: "Claim B" }],
        enableFileLoad: false,
      });
      expect(r1).toBe(r2);
      // Still has Claim A (initial config was used)
      expect(r1.matchText("Claim A").matched).toBe(true);
    });

    it("creates registry with enableFileLoad:false by default (no file I/O)", () => {
      // If enableFileLoad defaulted to true this would try to read disk and might fail
      expect(() => loader.getRegistryForTenant("org_test")).not.toThrow();
    });

    it("tenant registries are isolated — claims from one tenant not in another", () => {
      // Use semantically distinct claims with zero word overlap to avoid
      // triggering the partial-match heuristic (threshold 0.6).
      loader.getRegistryForTenant("tenant_a", {
        claims: [{ id: "A-001", text: "FDA certified medical device" }],
        enableFileLoad: false,
      });
      loader.getRegistryForTenant("tenant_b", {
        claims: [{ id: "B-001", text: "30-day money back guarantee" }],
        enableFileLoad: false,
      });

      const regA = loader.getRegistryForTenant("tenant_a");
      const regB = loader.getRegistryForTenant("tenant_b");

      expect(regA.matchText("FDA certified medical device").matched).toBe(true);
      expect(regA.matchText("30-day money back guarantee").matched).toBe(false);

      expect(regB.matchText("30-day money back guarantee").matched).toBe(true);
      expect(regB.matchText("FDA certified medical device").matched).toBe(false);
    });
  });

  // ── setRegistryForTenant ─────────────────────────────────────────────

  describe("setRegistryForTenant()", () => {
    it("stores a pre-constructed registry and returns it via getRegistryForTenant", () => {
      const registry = makeRegistry([{ id: "X-001", text: "Pre-built claim" }]);
      loader.setRegistryForTenant("org_custom", registry);
      expect(loader.getRegistryForTenant("org_custom")).toBe(registry);
    });

    it("overwrites a previously cached registry", () => {
      const r1 = loader.getRegistryForTenant("org_acme");
      const r2 = makeRegistry([]);
      loader.setRegistryForTenant("org_acme", r2);
      expect(loader.getRegistryForTenant("org_acme")).toBe(r2);
      expect(loader.getRegistryForTenant("org_acme")).not.toBe(r1);
    });
  });

  // ── hasRegistry ──────────────────────────────────────────────────────

  describe("hasRegistry()", () => {
    it("returns false before any registry is created for a tenantId", () => {
      expect(loader.hasRegistry("unknown_tenant")).toBe(false);
    });

    it("returns true after registry is created via getRegistryForTenant", () => {
      loader.getRegistryForTenant("org_acme");
      expect(loader.hasRegistry("org_acme")).toBe(true);
    });

    it("returns true after registry is injected via setRegistryForTenant", () => {
      loader.setRegistryForTenant("org_x", makeRegistry([]));
      expect(loader.hasRegistry("org_x")).toBe(true);
    });

    it("returns false for a different tenantId even after one is registered", () => {
      loader.getRegistryForTenant("org_a");
      expect(loader.hasRegistry("org_b")).toBe(false);
    });
  });

  // ── size ─────────────────────────────────────────────────────────────

  describe("size", () => {
    it("is 0 on a fresh loader", () => {
      expect(loader.size).toBe(0);
    });

    it("increments when new tenants are registered", () => {
      loader.getRegistryForTenant("t1");
      expect(loader.size).toBe(1);
      loader.getRegistryForTenant("t2");
      expect(loader.size).toBe(2);
    });

    it("does not increment when the same tenant is accessed twice", () => {
      loader.getRegistryForTenant("t1");
      loader.getRegistryForTenant("t1");
      expect(loader.size).toBe(1);
    });
  });

  // ── clear ────────────────────────────────────────────────────────────

  describe("clear()", () => {
    it("clear() with no argument removes all registries", () => {
      loader.getRegistryForTenant("t1");
      loader.getRegistryForTenant("t2");
      loader.clear();
      expect(loader.size).toBe(0);
    });

    it("clear(tenantId) removes only that tenant", () => {
      loader.getRegistryForTenant("t1");
      loader.getRegistryForTenant("t2");
      loader.clear("t1");
      expect(loader.hasRegistry("t1")).toBe(false);
      expect(loader.hasRegistry("t2")).toBe(true);
      expect(loader.size).toBe(1);
    });

    it("clear(tenantId) for non-existent tenant is a no-op", () => {
      loader.getRegistryForTenant("t1");
      expect(() => loader.clear("does_not_exist")).not.toThrow();
      expect(loader.size).toBe(1);
    });

    it("after clear(), getRegistryForTenant creates a fresh instance", () => {
      const r1 = loader.getRegistryForTenant("org_acme");
      loader.clear();
      const r2 = loader.getRegistryForTenant("org_acme");
      expect(r2).not.toBe(r1);
    });
  });
});
