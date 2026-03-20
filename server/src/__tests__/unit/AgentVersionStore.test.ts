/**
 * AgentVersionStore Unit Tests
 *
 * Tests for AgentVersionStore — agent configuration version management.
 *
 * Uses real filesystem via OS temp directories for isolation.
 * Each test gets a fresh store instance backed by a unique temp file.
 */

import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import {
  AgentVersionStore,
  initAgentVersionStore,
  agentVersionStore,
} from "../../services/AgentVersionStore.js";
import type { AgentConfig } from "../../services/AgentVersionStore.js";

// ── Helpers ───────────────────────────────────────────────────────────

function tempFile(label: string): string {
  return join(
    tmpdir(),
    `agent-version-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

const baseConfig: AgentConfig = {
  systemPrompt: "You are a helpful assistant.",
  voiceId: "af_bella",
  temperature: 0.7,
};

const configV2: AgentConfig = {
  systemPrompt: "You are an expert assistant.",
  voiceId: "af_bella",
  temperature: 0.8,
};

// ── AgentVersionStore unit tests ──────────────────────────────────────

describe("AgentVersionStore", () => {
  let store: AgentVersionStore;
  let file: string;

  beforeEach(() => {
    file = tempFile("store");
    store = new AgentVersionStore(file);
  });

  afterEach(() => {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  // ── createVersion ──────────────────────────────────────────────────

  describe("createVersion()", () => {
    it("returns AgentVersion with a UUID versionId", () => {
      const v = store.createVersion("agent-1", "v1.0.0", baseConfig);

      expect(v.versionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("assigns versionNumber=1 for the first version of an agent", () => {
      const v = store.createVersion("agent-1", "v1.0.0", baseConfig);
      expect(v.versionNumber).toBe(1);
    });

    it("increments versionNumber per agentId", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);

      expect(v1.versionNumber).toBe(1);
      expect(v2.versionNumber).toBe(2);
    });

    it("different agentIds get independent versionNumbers starting at 1", () => {
      const a1v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const a2v1 = store.createVersion("agent-2", "v1.0.0", baseConfig);

      expect(a1v1.versionNumber).toBe(1);
      expect(a2v1.versionNumber).toBe(1);
    });

    it("stores the provided label, config, agentId", () => {
      const v = store.createVersion("agent-x", "hotfix-march", baseConfig, {
        createdBy: "alice",
        changelog: "Fixed prompt loop",
      });

      expect(v.agentId).toBe("agent-x");
      expect(v.label).toBe("hotfix-march");
      expect(v.config).toEqual(baseConfig);
      expect(v.createdBy).toBe("alice");
      expect(v.changelog).toBe("Fixed prompt loop");
    });

    it("isStable defaults to false", () => {
      const v = store.createVersion("agent-1", "v1.0.0", baseConfig);
      expect(v.isStable).toBe(false);
    });

    it("validates label non-empty — throws on empty string", () => {
      expect(() => store.createVersion("agent-1", "", baseConfig)).toThrow();
    });

    it("validates label non-empty — throws on whitespace-only string", () => {
      expect(() => store.createVersion("agent-1", "   ", baseConfig)).toThrow();
    });
  });

  // ── getVersion ────────────────────────────────────────────────────

  describe("getVersion()", () => {
    it("returns the version by versionId", () => {
      const created = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const found = store.getVersion(created.versionId);

      expect(found).toBeDefined();
      expect(found!.versionId).toBe(created.versionId);
    });

    it("returns undefined for unknown versionId", () => {
      expect(store.getVersion("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    });
  });

  // ── listVersions ──────────────────────────────────────────────────

  describe("listVersions()", () => {
    it("returns versions sorted by versionNumber descending", () => {
      store.createVersion("agent-1", "v1.0.0", baseConfig);
      store.createVersion("agent-1", "v1.1.0", configV2);
      store.createVersion("agent-1", "v1.2.0", baseConfig);

      const list = store.listVersions("agent-1");

      expect(list[0].versionNumber).toBe(3);
      expect(list[1].versionNumber).toBe(2);
      expect(list[2].versionNumber).toBe(1);
    });

    it("returns empty array when no versions exist for agentId", () => {
      expect(store.listVersions("nonexistent-agent")).toEqual([]);
    });

    it("only returns versions for the requested agentId", () => {
      store.createVersion("agent-1", "v1.0.0", baseConfig);
      store.createVersion("agent-2", "v1.0.0", baseConfig);

      const list = store.listVersions("agent-1");
      expect(list).toHaveLength(1);
      expect(list[0].agentId).toBe("agent-1");
    });
  });

  // ── markStable ────────────────────────────────────────────────────

  describe("markStable()", () => {
    it("sets isStable=true on the version", () => {
      const v = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const updated = store.markStable(v.versionId);

      expect(updated!.isStable).toBe(true);
    });

    it("returns undefined for unknown versionId", () => {
      expect(store.markStable("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    });
  });

  // ── deleteVersion ─────────────────────────────────────────────────

  describe("deleteVersion()", () => {
    it("returns true and removes the version", () => {
      const v = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const deleted = store.deleteVersion(v.versionId);

      expect(deleted).toBe(true);
      expect(store.getVersion(v.versionId)).toBeUndefined();
    });

    it("returns false when version is actively deployed", () => {
      const v = store.createVersion("agent-1", "v1.0.0", baseConfig);
      store.deploy("tenant-1", "agent-1", v.versionId);

      expect(store.deleteVersion(v.versionId)).toBe(false);
    });

    it("returns false when version is set as canary", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      store.setCanary("tenant-1", "agent-1", v2.versionId, 10);

      expect(store.deleteVersion(v2.versionId)).toBe(false);
    });

    it("returns false for unknown versionId", () => {
      expect(store.deleteVersion("00000000-0000-0000-0000-000000000000")).toBe(false);
    });
  });

  // ── deploy ────────────────────────────────────────────────────────

  describe("deploy()", () => {
    it("creates a TenantDeployment with correct fields", () => {
      const v = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const dep = store.deploy("tenant-1", "agent-1", v.versionId, { deployedBy: "ops" });

      expect(dep.tenantId).toBe("tenant-1");
      expect(dep.agentId).toBe("agent-1");
      expect(dep.activeVersionId).toBe(v.versionId);
      expect(dep.canaryPercent).toBe(0);
      expect(dep.canaryVersionId).toBeUndefined();
      expect(dep.deployedBy).toBe("ops");
      expect(dep.deploymentId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it("upserts — second deploy replaces the first for same (tenantId, agentId)", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      const dep1 = store.deploy("tenant-1", "agent-1", v1.versionId);
      const dep2 = store.deploy("tenant-1", "agent-1", v2.versionId);

      // Same deploymentId — it's an upsert
      expect(dep2.deploymentId).toBe(dep1.deploymentId);
      expect(dep2.activeVersionId).toBe(v2.versionId);
      // Only one deployment record
      expect(store.listDeployments("tenant-1")).toHaveLength(1);
    });

    it("clears any existing canary on new deploy", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      store.setCanary("tenant-1", "agent-1", v2.versionId, 20);

      const v3Config: AgentConfig = { ...baseConfig, temperature: 1.0 };
      const v3 = store.createVersion("agent-1", "v1.2.0", v3Config);
      const dep = store.deploy("tenant-1", "agent-1", v3.versionId);

      expect(dep.canaryVersionId).toBeUndefined();
      expect(dep.canaryPercent).toBe(0);
    });

    it("throws if versionId doesn't exist", () => {
      expect(() =>
        store.deploy("tenant-1", "agent-1", "00000000-0000-0000-0000-000000000000"),
      ).toThrow();
    });
  });

  // ── getDeployment ─────────────────────────────────────────────────

  describe("getDeployment()", () => {
    it("returns undefined when no deployment exists", () => {
      expect(store.getDeployment("tenant-x", "agent-x")).toBeUndefined();
    });

    it("returns the deployment for an existing (tenantId, agentId)", () => {
      const v = store.createVersion("agent-1", "v1.0.0", baseConfig);
      store.deploy("tenant-1", "agent-1", v.versionId);

      const dep = store.getDeployment("tenant-1", "agent-1");
      expect(dep).toBeDefined();
      expect(dep!.activeVersionId).toBe(v.versionId);
    });
  });

  // ── listDeployments ───────────────────────────────────────────────

  describe("listDeployments()", () => {
    it("returns all deployments when no tenantId filter", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-2", "v1.0.0", baseConfig);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      store.deploy("tenant-2", "agent-2", v2.versionId);

      expect(store.listDeployments()).toHaveLength(2);
    });

    it("filters by tenantId when provided", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-2", "v1.0.0", baseConfig);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      store.deploy("tenant-2", "agent-2", v2.versionId);

      const t1Deps = store.listDeployments("tenant-1");
      expect(t1Deps).toHaveLength(1);
      expect(t1Deps[0].tenantId).toBe("tenant-1");
    });
  });

  // ── setCanary ─────────────────────────────────────────────────────

  describe("setCanary()", () => {
    it("sets canaryVersionId and canaryPercent on the deployment", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);

      const dep = store.setCanary("tenant-1", "agent-1", v2.versionId, 10);

      expect(dep.canaryVersionId).toBe(v2.versionId);
      expect(dep.canaryPercent).toBe(10);
    });

    it("validates canaryPercent — throws when < 1", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);

      expect(() => store.setCanary("tenant-1", "agent-1", v2.versionId, 0)).toThrow();
    });

    it("validates canaryPercent — throws when > 100", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);

      expect(() => store.setCanary("tenant-1", "agent-1", v2.versionId, 101)).toThrow();
    });

    it("throws if canaryVersionId is the same as activeVersionId", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      store.deploy("tenant-1", "agent-1", v1.versionId);

      expect(() => store.setCanary("tenant-1", "agent-1", v1.versionId, 10)).toThrow();
    });

    it("throws if canaryVersionId does not exist", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      store.deploy("tenant-1", "agent-1", v1.versionId);

      expect(() =>
        store.setCanary("tenant-1", "agent-1", "00000000-0000-0000-0000-000000000000", 10),
      ).toThrow();
    });
  });

  // ── clearCanary ───────────────────────────────────────────────────

  describe("clearCanary()", () => {
    it("removes canary (sets canaryPercent=0, canaryVersionId=undefined)", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      store.setCanary("tenant-1", "agent-1", v2.versionId, 20);

      const dep = store.clearCanary("tenant-1", "agent-1");

      expect(dep!.canaryVersionId).toBeUndefined();
      expect(dep!.canaryPercent).toBe(0);
    });

    it("returns undefined if no deployment exists", () => {
      expect(store.clearCanary("ghost-tenant", "ghost-agent")).toBeUndefined();
    });
  });

  // ── rollback ──────────────────────────────────────────────────────

  describe("rollback()", () => {
    it("sets activeVersionId to the previous version by versionNumber", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v2.versionId);

      const dep = store.rollback("tenant-1", "agent-1");

      expect(dep.activeVersionId).toBe(v1.versionId);
    });

    it("throws if no previous version exists (only one version)", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      store.deploy("tenant-1", "agent-1", v1.versionId);

      expect(() => store.rollback("tenant-1", "agent-1")).toThrow();
    });

    it("clears canary on rollback", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      const v3Config: AgentConfig = { ...baseConfig, temperature: 1.0 };
      const v3 = store.createVersion("agent-1", "v1.2.0", v3Config);
      store.deploy("tenant-1", "agent-1", v3.versionId);
      store.setCanary("tenant-1", "agent-1", v2.versionId, 15);

      const dep = store.rollback("tenant-1", "agent-1");

      expect(dep.canaryVersionId).toBeUndefined();
      expect(dep.canaryPercent).toBe(0);
      // Rolled back from v3 (versionNumber=3) to v2 (versionNumber=2)
      expect(dep.activeVersionId).toBe(v2.versionId);

      // Suppress unused variable warning
      void v1;
    });
  });

  // ── resolveVersion ────────────────────────────────────────────────

  describe("resolveVersion()", () => {
    it("returns undefined when no deployment exists", () => {
      expect(store.resolveVersion("ghost-tenant", "ghost-agent", "sess-1")).toBeUndefined();
    });

    it("returns active version when no canary is set", () => {
      const v = store.createVersion("agent-1", "v1.0.0", baseConfig);
      store.deploy("tenant-1", "agent-1", v.versionId);

      const result = store.resolveVersion("tenant-1", "agent-1", "session-abc");

      expect(result).toBeDefined();
      expect(result!.versionId).toBe(v.versionId);
      expect(result!.isCanary).toBe(false);
      expect(result!.config).toEqual(baseConfig);
    });

    it("routes to canary when canaryPercent=100 (always canary)", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      store.setCanary("tenant-1", "agent-1", v2.versionId, 100);

      const result = store.resolveVersion("tenant-1", "agent-1", "any-session");

      expect(result!.versionId).toBe(v2.versionId);
      expect(result!.isCanary).toBe(true);
    });

    it("routes to active when canaryPercent=0 (no canary)", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      // Set and then clear canary
      store.setCanary("tenant-1", "agent-1", v2.versionId, 50);
      store.clearCanary("tenant-1", "agent-1");

      const result = store.resolveVersion("tenant-1", "agent-1", "any-session");

      expect(result!.versionId).toBe(v1.versionId);
      expect(result!.isCanary).toBe(false);
    });

    it("isCanary=true for canary routing, false for active routing", () => {
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      store.setCanary("tenant-1", "agent-1", v2.versionId, 100);

      const canaryResult = store.resolveVersion("tenant-1", "agent-1", "sess-a");
      expect(canaryResult!.isCanary).toBe(true);

      // Clear canary — now active
      store.clearCanary("tenant-1", "agent-1");
      const activeResult = store.resolveVersion("tenant-1", "agent-1", "sess-a");
      expect(activeResult!.isCanary).toBe(false);
    });

    it("canaryPercent=10: deterministic routing for a given sessionId", () => {
      // hash = sum(charCodes) % 100
      // "session-test" = s(115)+e(101)+s(115)+s(115)+i(105)+o(111)+n(110)+-+(45)+t(116)+e(101)+s(115)+t(116) = 1265
      // 1265 % 100 = 65 → 65 >= 10 → active
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      store.setCanary("tenant-1", "agent-1", v2.versionId, 10);

      const sessionId = "session-test"; // hash 65, >= 10 → active
      const result1 = store.resolveVersion("tenant-1", "agent-1", sessionId);
      const result2 = store.resolveVersion("tenant-1", "agent-1", sessionId);

      expect(result1!.versionId).toBe(result2!.versionId);
      expect(result1!.isCanary).toBe(result2!.isCanary);
      // 65 >= 10 so routes to active
      expect(result1!.versionId).toBe(v1.versionId);
      expect(result1!.isCanary).toBe(false);
    });

    it("routes to canary when hash < canaryPercent", () => {
      // Find a sessionId where sum(charCodes) % 100 < 50
      // "!" = charCode 33 → hash = 33 < 50 → canary
      const v1 = store.createVersion("agent-1", "v1.0.0", baseConfig);
      const v2 = store.createVersion("agent-1", "v1.1.0", configV2);
      store.deploy("tenant-1", "agent-1", v1.versionId);
      store.setCanary("tenant-1", "agent-1", v2.versionId, 50);

      const result = store.resolveVersion("tenant-1", "agent-1", "!");
      // hash("!") = 33 % 100 = 33, 33 < 50 → canary
      expect(result!.versionId).toBe(v2.versionId);
      expect(result!.isCanary).toBe(true);
    });
  });

  // ── persistence ───────────────────────────────────────────────────

  describe("persistence", () => {
    it("getVersion works after createVersion (persists to disk)", () => {
      const v = store.createVersion("agent-p", "v1.0.0", baseConfig);

      const store2 = new AgentVersionStore(file);
      const found = store2.getVersion(v.versionId);

      expect(found).toBeDefined();
      expect(found!.label).toBe("v1.0.0");
    });

    it("deployments persist across store instances", () => {
      const v = store.createVersion("agent-p", "v1.0.0", baseConfig);
      store.deploy("tenant-p", "agent-p", v.versionId);

      const store2 = new AgentVersionStore(file);
      const dep = store2.getDeployment("tenant-p", "agent-p");

      expect(dep).toBeDefined();
      expect(dep!.activeVersionId).toBe(v.versionId);
    });
  });

  // ── singleton proxy ───────────────────────────────────────────────

  describe("singleton proxy", () => {
    it("throws before init", () => {
      const makeProxy = (ref: { instance: AgentVersionStore | undefined }) =>
        new Proxy({} as AgentVersionStore, {
          get(_t, prop) {
            if (!ref.instance) {
              throw new Error(
                "AgentVersionStore not initialized — call initAgentVersionStore() first",
              );
            }
            const value = (ref.instance as unknown as Record<string | symbol, unknown>)[prop];
            return typeof value === "function" ? value.bind(ref.instance) : value;
          },
        });

      const ref = { instance: undefined as AgentVersionStore | undefined };
      const proxy = makeProxy(ref);

      expect(() => proxy.listVersions("x")).toThrow(
        "AgentVersionStore not initialized",
      );
    });

    it("works after init", () => {
      const f = tempFile("singleton");
      try {
        const instance = initAgentVersionStore(f);
        expect(instance).toBeInstanceOf(AgentVersionStore);

        const versions = agentVersionStore.listVersions("any-agent");
        expect(Array.isArray(versions)).toBe(true);
      } finally {
        if (existsSync(f)) rmSync(f, { force: true });
      }
    });
  });
});
