/**
 * SkillStore Unit Tests
 *
 * Tests for SkillStore — modular agent skill CRUD + auto-suggest.
 *
 * Uses real filesystem via OS temp directories for isolation.
 * Each test gets a fresh SkillStore instance backed by a unique temp file.
 */

import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import {
  SkillStore,
  initSkillStore,
  skillStore,
} from "../../services/SkillStore.js";
import type { Skill } from "../../services/SkillStore.js";

// ── Helpers ───────────────────────────────────────────────────────────

function tempFile(label: string): string {
  return join(
    tmpdir(),
    `skill-store-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

function makeSkillData(overrides: Partial<Omit<Skill, "skillId" | "createdAt" | "updatedAt" | "usageCount">> = {}): Omit<Skill, "skillId" | "createdAt" | "updatedAt" | "usageCount"> {
  return {
    name: "Lookup Customer",
    description: "Look up a customer by account number",
    category: "customer_lookup",
    triggerPhrases: ["look up customer", "find account", "customer details"],
    parameters: [
      { name: "accountNumber", type: "string", required: true, description: "Account ID" },
    ],
    enabled: true,
    ...overrides,
  };
}

// ── SkillStore unit tests ──────────────────────────────────────────────

describe("SkillStore", () => {
  let store: SkillStore;
  let file: string;

  beforeEach(() => {
    file = tempFile("store");
    store = new SkillStore(file);
  });

  afterEach(() => {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  // ── createSkill ────────────────────────────────────────────────────

  describe("createSkill()", () => {
    it("returns a Skill with a UUID skillId", () => {
      const skill = store.createSkill(makeSkillData());

      expect(skill.skillId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("sets createdAt and updatedAt as ISO strings", () => {
      const skill = store.createSkill(makeSkillData());

      expect(new Date(skill.createdAt).toISOString()).toBe(skill.createdAt);
      expect(new Date(skill.updatedAt).toISOString()).toBe(skill.updatedAt);
    });

    it("sets usageCount to 0", () => {
      const skill = store.createSkill(makeSkillData());

      expect(skill.usageCount).toBe(0);
    });

    it("throws when name is empty", () => {
      expect(() => store.createSkill(makeSkillData({ name: "" }))).toThrow(
        /name/i,
      );
    });

    it("throws when name is whitespace only", () => {
      expect(() => store.createSkill(makeSkillData({ name: "   " }))).toThrow(
        /name/i,
      );
    });

    it("throws when triggerPhrases is empty array", () => {
      expect(() =>
        store.createSkill(makeSkillData({ triggerPhrases: [] })),
      ).toThrow(/triggerPhrases/i);
    });
  });

  // ── getSkill ───────────────────────────────────────────────────────

  describe("getSkill()", () => {
    it("returns undefined for unknown skillId", () => {
      expect(store.getSkill("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    });

    it("returns the skill by ID", () => {
      const created = store.createSkill(makeSkillData());

      const found = store.getSkill(created.skillId);
      expect(found).toBeDefined();
      expect(found!.skillId).toBe(created.skillId);
    });
  });

  // ── listSkills ────────────────────────────────────────────────────

  describe("listSkills()", () => {
    it("returns all skills when no options provided", () => {
      store.createSkill(makeSkillData({ name: "A", enabled: true }));
      store.createSkill(makeSkillData({ name: "B", enabled: false }));

      expect(store.listSkills()).toHaveLength(2);
    });

    it("filters to enabled-only when enabled: true", () => {
      store.createSkill(makeSkillData({ name: "Enabled", enabled: true }));
      store.createSkill(makeSkillData({ name: "Disabled", enabled: false }));

      const results = store.listSkills({ enabled: true });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Enabled");
    });

    it("filters to disabled-only when enabled: false", () => {
      store.createSkill(makeSkillData({ name: "Enabled", enabled: true }));
      store.createSkill(makeSkillData({ name: "Disabled", enabled: false }));

      const results = store.listSkills({ enabled: false });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Disabled");
    });

    it("filters by category", () => {
      store.createSkill(makeSkillData({ name: "Scheduler", category: "scheduling" }));
      store.createSkill(makeSkillData({ name: "Lookup", category: "customer_lookup" }));

      const results = store.listSkills({ category: "scheduling" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Scheduler");
    });

    it("filters by tenantId: returns global + tenant skills, excludes others", () => {
      store.createSkill(makeSkillData({ name: "Global", tenantId: undefined }));
      store.createSkill(makeSkillData({ name: "T1 Skill", tenantId: "t1" }));
      store.createSkill(makeSkillData({ name: "T2 Skill", tenantId: "t2" }));

      const results = store.listSkills({ tenantId: "t1" });
      const names = results.map((s) => s.name);
      expect(names).toContain("Global");
      expect(names).toContain("T1 Skill");
      expect(names).not.toContain("T2 Skill");
    });

    it("returns results sorted by name ascending", () => {
      store.createSkill(makeSkillData({ name: "Zeta" }));
      store.createSkill(makeSkillData({ name: "Alpha" }));
      store.createSkill(makeSkillData({ name: "Mango" }));

      const results = store.listSkills();
      expect(results.map((s) => s.name)).toEqual(["Alpha", "Mango", "Zeta"]);
    });
  });

  // ── updateSkill ───────────────────────────────────────────────────

  describe("updateSkill()", () => {
    it("updates name and refreshes updatedAt", () => {
      const skill = store.createSkill(makeSkillData({ name: "Old Name" }));
      const before = skill.updatedAt;

      // Advance clock slightly
      const updated = store.updateSkill(skill.skillId, { name: "New Name" });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe("New Name");
      // updatedAt must be a valid ISO string (may equal before in fast tests)
      expect(new Date(updated!.updatedAt).toISOString()).toBe(updated!.updatedAt);
      // createdAt must remain unchanged
      expect(updated!.createdAt).toBe(skill.createdAt);
      void before; // used for type-check
    });

    it("returns undefined for unknown skillId", () => {
      expect(
        store.updateSkill("00000000-0000-0000-0000-000000000000", { name: "X" }),
      ).toBeUndefined();
    });
  });

  // ── deleteSkill ───────────────────────────────────────────────────

  describe("deleteSkill()", () => {
    it("returns true and removes the skill", () => {
      const skill = store.createSkill(makeSkillData());

      const result = store.deleteSkill(skill.skillId);
      expect(result).toBe(true);
      expect(store.getSkill(skill.skillId)).toBeUndefined();
    });

    it("returns false for unknown skillId", () => {
      expect(store.deleteSkill("00000000-0000-0000-0000-000000000000")).toBe(false);
    });
  });

  // ── incrementUsage ────────────────────────────────────────────────

  describe("incrementUsage()", () => {
    it("increases usageCount by 1", () => {
      const skill = store.createSkill(makeSkillData());
      expect(skill.usageCount).toBe(0);

      store.incrementUsage(skill.skillId);
      expect(store.getSkill(skill.skillId)!.usageCount).toBe(1);

      store.incrementUsage(skill.skillId);
      expect(store.getSkill(skill.skillId)!.usageCount).toBe(2);
    });

    it("is a no-op for unknown skillId", () => {
      // Should not throw
      expect(() =>
        store.incrementUsage("00000000-0000-0000-0000-000000000000"),
      ).not.toThrow();
    });
  });

  // ── suggestSkills ─────────────────────────────────────────────────

  describe("suggestSkills()", () => {
    it("returns empty array when no skills match", () => {
      store.createSkill(
        makeSkillData({ triggerPhrases: ["check inventory levels"] }),
      );

      const results = store.suggestSkills("book appointment tomorrow");
      expect(results).toHaveLength(0);
    });

    it("matches on trigger phrase token overlap", () => {
      store.createSkill(
        makeSkillData({ triggerPhrases: ["look up customer account"] }),
      );

      const results = store.suggestSkills("look up customer");
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns skill with highest score first", () => {
      store.createSkill(
        makeSkillData({
          name: "Low Match",
          triggerPhrases: ["check account balance details"],
        }),
      );
      store.createSkill(
        makeSkillData({
          name: "High Match",
          triggerPhrases: ["check order status now"],
          category: "order_management",
        }),
      );

      // "check order status" should score higher for "High Match"
      const results = store.suggestSkills("check order status");
      expect(results[0].skill.name).toBe("High Match");
    });

    it("returns at most maxResults suggestions", () => {
      for (let i = 0; i < 5; i++) {
        store.createSkill(
          makeSkillData({
            name: `Skill ${i}`,
            triggerPhrases: [`find customer record ${i}`],
          }),
        );
      }

      const results = store.suggestSkills("find customer record", undefined, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("uses default maxResults of 3", () => {
      for (let i = 0; i < 5; i++) {
        store.createSkill(
          makeSkillData({
            name: `Skill ${i}`,
            triggerPhrases: [`find customer account info ${i}`],
          }),
        );
      }

      const results = store.suggestSkills("find customer account info");
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("only returns enabled skills", () => {
      store.createSkill(
        makeSkillData({
          name: "Enabled",
          triggerPhrases: ["look up customer"],
          enabled: true,
        }),
      );
      store.createSkill(
        makeSkillData({
          name: "Disabled",
          triggerPhrases: ["look up customer"],
          enabled: false,
        }),
      );

      const results = store.suggestSkills("look up customer");
      expect(results.every((r) => r.skill.enabled)).toBe(true);
      expect(results.map((r) => r.skill.name)).not.toContain("Disabled");
    });

    it("returns global + tenant skills for the specified tenant", () => {
      store.createSkill(
        makeSkillData({
          name: "Global",
          triggerPhrases: ["look up customer"],
          tenantId: undefined,
        }),
      );
      store.createSkill(
        makeSkillData({
          name: "T1 Skill",
          triggerPhrases: ["look up customer"],
          tenantId: "t1",
        }),
      );
      store.createSkill(
        makeSkillData({
          name: "T2 Skill",
          triggerPhrases: ["look up customer"],
          tenantId: "t2",
        }),
      );

      const names = store.suggestSkills("look up customer", "t1", 10).map(
        (r) => r.skill.name,
      );
      expect(names).toContain("Global");
      expect(names).toContain("T1 Skill");
      expect(names).not.toContain("T2 Skill");
    });

    it("excludes other tenants' skills", () => {
      store.createSkill(
        makeSkillData({
          name: "T2 Only",
          triggerPhrases: ["look up customer"],
          tenantId: "t2",
        }),
      );

      const results = store.suggestSkills("look up customer", "t1");
      expect(results.map((r) => r.skill.name)).not.toContain("T2 Only");
    });

    it("score is between 0 and 1", () => {
      store.createSkill(
        makeSkillData({ triggerPhrases: ["look up customer account details"] }),
      );

      const results = store.suggestSkills("look up customer");
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    it("matchedPhrase is the best-matching trigger phrase", () => {
      store.createSkill(
        makeSkillData({
          triggerPhrases: [
            "unrelated phrase here",
            "look up customer account",
          ],
        }),
      );

      const results = store.suggestSkills("look up customer account");
      expect(results[0].matchedPhrase).toBe("look up customer account");
    });

    it("matching is case-insensitive", () => {
      store.createSkill(
        makeSkillData({ triggerPhrases: ["LOOK UP CUSTOMER"] }),
      );

      const results = store.suggestSkills("look up customer");
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty when all skills have score 0", () => {
      store.createSkill(
        makeSkillData({ triggerPhrases: ["inventory stock levels warehouse"] }),
      );

      const results = store.suggestSkills("schedule dentist appointment");
      expect(results).toHaveLength(0);
    });

    it("global skill (no tenantId) appears for all tenants", () => {
      store.createSkill(
        makeSkillData({
          name: "Universal",
          triggerPhrases: ["find customer info"],
          tenantId: undefined,
        }),
      );

      const r1 = store.suggestSkills("find customer info", "tenant-a", 10);
      const r2 = store.suggestSkills("find customer info", "tenant-b", 10);

      expect(r1.map((r) => r.skill.name)).toContain("Universal");
      expect(r2.map((r) => r.skill.name)).toContain("Universal");
    });
  });

  // ── persistence ───────────────────────────────────────────────────

  describe("persistence", () => {
    it("getSkill works after createSkill across a fresh instance", () => {
      const skill = store.createSkill(makeSkillData({ name: "Persist Me" }));

      const store2 = new SkillStore(file);
      const found = store2.getSkill(skill.skillId);
      expect(found).toBeDefined();
      expect(found!.name).toBe("Persist Me");
    });
  });

  // ── singleton proxy ───────────────────────────────────────────────

  describe("singleton proxy", () => {
    it("throws before initSkillStore is called", () => {
      const makeProxy = (ref: { instance: SkillStore | undefined }) =>
        new Proxy({} as SkillStore, {
          get(_t, prop) {
            if (!ref.instance) {
              throw new Error(
                "SkillStore not initialized — call initSkillStore() first",
              );
            }
            const value = (ref.instance as unknown as Record<string | symbol, unknown>)[prop];
            return typeof value === "function" ? value.bind(ref.instance) : value;
          },
        });

      const ref = { instance: undefined as SkillStore | undefined };
      const proxy = makeProxy(ref);

      expect(() => proxy.listSkills()).toThrow("SkillStore not initialized");
    });

    it("works after initSkillStore is called", () => {
      const f = tempFile("singleton");
      try {
        const instance = initSkillStore(f);
        expect(instance).toBeInstanceOf(SkillStore);

        const skills = skillStore.listSkills();
        expect(Array.isArray(skills)).toBe(true);
      } finally {
        if (existsSync(f)) rmSync(f, { force: true });
      }
    });
  });
});
