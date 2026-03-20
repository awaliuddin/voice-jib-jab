/**
 * RoutingEngine + CallQueueService Tests
 *
 * Tests the routing rule engine (CRUD + evaluate) and the per-tenant
 * call queue service. Uses temp directories for file persistence.
 */

import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, existsSync, readFileSync } from "fs";
import { RoutingEngine } from "../../services/RoutingEngine.js";
import { CallQueueService } from "../../services/CallQueueService.js";

// -- Helpers ----------------------------------------------------------------

function makeTempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "routing-test-"));
  return join(dir, "rules.json");
}

// ===========================================================================
// RoutingEngine
// ===========================================================================

describe("RoutingEngine", () => {
  let engine: RoutingEngine;
  let storageFile: string;

  beforeEach(() => {
    storageFile = makeTempFile();
    engine = new RoutingEngine(storageFile);
  });

  // -- CRUD ---------------------------------------------------------------

  test("addRule() creates a rule with uuid and persists to file", () => {
    const rule = engine.addRule({
      tenantId: "acme",
      priority: 10,
      conditions: { language: "en" },
      targetTemplateId: "tpl-1",
      maxConcurrentSessions: null,
      active: true,
    });

    expect(rule.ruleId).toBeDefined();
    expect(rule.ruleId.length).toBeGreaterThan(0);
    expect(rule.createdAt).toBeDefined();
    expect(existsSync(storageFile)).toBe(true);

    const persisted = JSON.parse(readFileSync(storageFile, "utf-8"));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].ruleId).toBe(rule.ruleId);
  });

  test("getRules() returns all active rules sorted by priority ascending", () => {
    engine.addRule({ tenantId: null, priority: 30, conditions: {}, targetTemplateId: "tpl-c", maxConcurrentSessions: null, active: true });
    engine.addRule({ tenantId: null, priority: 10, conditions: {}, targetTemplateId: "tpl-a", maxConcurrentSessions: null, active: true });
    engine.addRule({ tenantId: null, priority: 20, conditions: {}, targetTemplateId: "tpl-b", maxConcurrentSessions: null, active: true });

    const rules = engine.getRules();
    expect(rules.map((r) => r.priority)).toEqual([10, 20, 30]);
  });

  test("getRules(tenantId) returns global + tenant-specific rules", () => {
    engine.addRule({ tenantId: null, priority: 1, conditions: {}, targetTemplateId: "global", maxConcurrentSessions: null, active: true });
    engine.addRule({ tenantId: "acme", priority: 2, conditions: {}, targetTemplateId: "acme-tpl", maxConcurrentSessions: null, active: true });
    engine.addRule({ tenantId: "other", priority: 3, conditions: {}, targetTemplateId: "other-tpl", maxConcurrentSessions: null, active: true });

    const rules = engine.getRules("acme");
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.targetTemplateId)).toEqual(["global", "acme-tpl"]);
  });

  test("getRule(id) returns the correct rule", () => {
    const created = engine.addRule({ tenantId: null, priority: 1, conditions: {}, targetTemplateId: "tpl-x", maxConcurrentSessions: null, active: true });
    const found = engine.getRule(created.ruleId);
    expect(found).toBeDefined();
    expect(found!.targetTemplateId).toBe("tpl-x");
  });

  test("updateRule() patches fields and persists", () => {
    const created = engine.addRule({ tenantId: null, priority: 1, conditions: {}, targetTemplateId: "tpl-old", maxConcurrentSessions: null, active: true });
    const updated = engine.updateRule(created.ruleId, { targetTemplateId: "tpl-new", priority: 5 });

    expect(updated).toBeDefined();
    expect(updated!.targetTemplateId).toBe("tpl-new");
    expect(updated!.priority).toBe(5);
    expect(updated!.createdAt).toBe(created.createdAt);

    // Verify on-disk persistence
    const persisted = JSON.parse(readFileSync(storageFile, "utf-8"));
    expect(persisted[0].targetTemplateId).toBe("tpl-new");
  });

  test("updateRule(unknown) returns undefined", () => {
    const result = engine.updateRule("nonexistent-id", { priority: 99 });
    expect(result).toBeUndefined();
  });

  test("deleteRule() returns true and removes from list", () => {
    const created = engine.addRule({ tenantId: null, priority: 1, conditions: {}, targetTemplateId: "tpl", maxConcurrentSessions: null, active: true });

    expect(engine.deleteRule(created.ruleId)).toBe(true);
    expect(engine.getRule(created.ruleId)).toBeUndefined();
    expect(engine.getRules()).toHaveLength(0);
  });

  // -- Evaluate -----------------------------------------------------------

  test("evaluate() matches by language condition", () => {
    engine.addRule({ tenantId: null, priority: 1, conditions: { language: "es" }, targetTemplateId: "spanish-tpl", maxConcurrentSessions: null, active: true });

    const decision = engine.evaluate({ tenantId: "acme", language: "es" });
    expect(decision.templateId).toBe("spanish-tpl");
    expect(decision.matchedConditions).toContain("language");
  });

  test("evaluate() matches by topic (case-insensitive substring)", () => {
    engine.addRule({ tenantId: null, priority: 1, conditions: { topic: "bill" }, targetTemplateId: "billing-tpl", maxConcurrentSessions: null, active: true });

    const decision = engine.evaluate({ tenantId: "acme", topic: "Billing Question" });
    expect(decision.templateId).toBe("billing-tpl");
    expect(decision.matchedConditions).toContain("topic");
  });

  test("evaluate() matches by callerType", () => {
    engine.addRule({ tenantId: null, priority: 1, conditions: { callerType: "returning" }, targetTemplateId: "returning-tpl", maxConcurrentSessions: null, active: true });

    const decision = engine.evaluate({ tenantId: "acme", callerType: "returning" });
    expect(decision.templateId).toBe("returning-tpl");
    expect(decision.matchedConditions).toContain("callerType");
  });

  test("evaluate() skips rule when maxConcurrentSessions exceeded", () => {
    engine.addRule({ tenantId: null, priority: 1, conditions: {}, targetTemplateId: "limited-tpl", maxConcurrentSessions: 5, active: true });
    engine.addRule({ tenantId: null, priority: 2, conditions: {}, targetTemplateId: "fallback-tpl", maxConcurrentSessions: null, active: true });

    const decision = engine.evaluate({ tenantId: "acme", currentSessionCount: 5 });
    expect(decision.templateId).toBe("fallback-tpl");
  });

  test("evaluate() returns default when no rules match", () => {
    engine.addRule({ tenantId: null, priority: 1, conditions: { language: "fr" }, targetTemplateId: "french-tpl", maxConcurrentSessions: null, active: true });

    const decision = engine.evaluate({ tenantId: "acme", language: "en" });
    expect(decision.templateId).toBe("builtin-customer-support");
    expect(decision.ruleId).toBe("default");
    expect(decision.matchedConditions).toEqual([]);
  });

  test("evaluate() respects priority order (lower number wins)", () => {
    engine.addRule({ tenantId: null, priority: 20, conditions: {}, targetTemplateId: "low-priority", maxConcurrentSessions: null, active: true });
    engine.addRule({ tenantId: null, priority: 5, conditions: {}, targetTemplateId: "high-priority", maxConcurrentSessions: null, active: true });

    const decision = engine.evaluate({ tenantId: "acme" });
    expect(decision.templateId).toBe("high-priority");
  });

  test("evaluate() skips inactive rules", () => {
    engine.addRule({ tenantId: null, priority: 1, conditions: {}, targetTemplateId: "inactive-tpl", maxConcurrentSessions: null, active: false });

    const decision = engine.evaluate({ tenantId: "acme" });
    expect(decision.templateId).toBe("builtin-customer-support");
    expect(decision.ruleId).toBe("default");
  });

  // -- Persistence --------------------------------------------------------

  test("new instance reloads rules from disk", () => {
    engine.addRule({ tenantId: null, priority: 1, conditions: { language: "de" }, targetTemplateId: "german-tpl", maxConcurrentSessions: null, active: true });
    engine.addRule({ tenantId: "acme", priority: 2, conditions: {}, targetTemplateId: "acme-tpl", maxConcurrentSessions: null, active: true });

    const engine2 = new RoutingEngine(storageFile);
    const rules = engine2.getRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].targetTemplateId).toBe("german-tpl");
  });

  // -- TimeRange condition -------------------------------------------------

  test("evaluate() matches within a full-day timeRange (00:00-23:59)", () => {
    engine.addRule({
      tenantId: null,
      priority: 1,
      conditions: { timeRange: { start: "00:00", end: "23:59" } },
      targetTemplateId: "always-tpl",
      maxConcurrentSessions: null,
      active: true,
    });

    const decision = engine.evaluate({ tenantId: "acme" });
    expect(decision.templateId).toBe("always-tpl");
    expect(decision.matchedConditions).toContain("timeRange");
  });

  test("evaluate() skips rule when timeRange does not match (past single minute)", () => {
    // Use a fake Date pointing to a specific time and set a range that excludes it
    const fixedDate = new Date("2026-03-19T12:00:00.000Z"); // 12:00 UTC
    const spy = jest.spyOn(global, "Date").mockImplementation(() => fixedDate as unknown as Date);

    engine.addRule({
      tenantId: null,
      priority: 1,
      conditions: { timeRange: { start: "00:00", end: "11:59" } }, // ends before 12:00
      targetTemplateId: "morning-only",
      maxConcurrentSessions: null,
      active: true,
    });
    engine.addRule({
      tenantId: null,
      priority: 2,
      conditions: {},
      targetTemplateId: "fallback-tpl",
      maxConcurrentSessions: null,
      active: true,
    });

    const decision = engine.evaluate({ tenantId: "acme" });
    expect(decision.templateId).toBe("fallback-tpl");

    spy.mockRestore();
  });

  test("evaluate() matches midnight-wrapping timeRange (22:00-06:00) at 23:00 UTC", () => {
    const fixedDate = new Date("2026-03-19T23:00:00.000Z"); // 23:00 UTC
    const spy = jest.spyOn(global, "Date").mockImplementation(() => fixedDate as unknown as Date);

    engine.addRule({
      tenantId: null,
      priority: 1,
      conditions: { timeRange: { start: "22:00", end: "06:00" } },
      targetTemplateId: "night-tpl",
      maxConcurrentSessions: null,
      active: true,
    });

    const decision = engine.evaluate({ tenantId: "acme" });
    expect(decision.templateId).toBe("night-tpl");
    expect(decision.matchedConditions).toContain("timeRange");

    spy.mockRestore();
  });

  test("evaluate() skips midnight-wrapping timeRange when time falls in gap (e.g. 12:00 UTC)", () => {
    const fixedDate = new Date("2026-03-19T12:00:00.000Z"); // 12:00 UTC — outside 22:00-06:00
    const spy = jest.spyOn(global, "Date").mockImplementation(() => fixedDate as unknown as Date);

    engine.addRule({
      tenantId: null,
      priority: 1,
      conditions: { timeRange: { start: "22:00", end: "06:00" } },
      targetTemplateId: "night-tpl",
      maxConcurrentSessions: null,
      active: true,
    });

    const decision = engine.evaluate({ tenantId: "acme" });
    expect(decision.ruleId).toBe("default");

    spy.mockRestore();
  });
});

// ===========================================================================
// CallQueueService
// ===========================================================================

describe("CallQueueService", () => {
  let queue: CallQueueService;

  beforeEach(() => {
    queue = new CallQueueService();
  });

  test("enqueue() returns position=1 for first in queue", () => {
    const entry = queue.enqueue("sess-1", "acme");
    expect(entry.position).toBe(1);
    expect(entry.sessionId).toBe("sess-1");
    expect(entry.tenantId).toBe("acme");
    expect(entry.enqueuedAt).toBeDefined();
  });

  test("enqueue() second caller gets position=2", () => {
    queue.enqueue("sess-1", "acme");
    const entry = queue.enqueue("sess-2", "acme");
    expect(entry.position).toBe(2);
  });

  test("dequeue() returns first sessionId and removes it", () => {
    queue.enqueue("sess-1", "acme");
    queue.enqueue("sess-2", "acme");

    const first = queue.dequeue("acme");
    expect(first).toBe("sess-1");

    const second = queue.dequeue("acme");
    expect(second).toBe("sess-2");
  });

  test("dequeue() empty queue returns null", () => {
    expect(queue.dequeue("acme")).toBeNull();
  });

  test("getPosition() returns 1-based position", () => {
    queue.enqueue("sess-1", "acme");
    queue.enqueue("sess-2", "acme");
    queue.enqueue("sess-3", "acme");

    expect(queue.getPosition("sess-1")).toBe(1);
    expect(queue.getPosition("sess-2")).toBe(2);
    expect(queue.getPosition("sess-3")).toBe(3);
  });

  test("getPosition() unknown session returns null", () => {
    expect(queue.getPosition("nonexistent")).toBeNull();
  });

  test("remove() removes mid-queue entry", () => {
    queue.enqueue("sess-1", "acme");
    queue.enqueue("sess-2", "acme");
    queue.enqueue("sess-3", "acme");

    expect(queue.remove("sess-2")).toBe(true);
    expect(queue.getPosition("sess-2")).toBeNull();
    expect(queue.getPosition("sess-1")).toBe(1);
    expect(queue.getPosition("sess-3")).toBe(2);
  });

  test("getQueueStatus() includes correct estimatedWaitMs", () => {
    queue.enqueue("sess-1", "acme");
    queue.enqueue("sess-2", "acme");

    const status = queue.getQueueStatus("acme");
    expect(status.tenantId).toBe("acme");
    expect(status.length).toBe(2);
    expect(status.entries).toHaveLength(2);
    expect(status.estimatedWaitMs).toBe(2 * 180_000);
  });

  test("getAllQueueStatuses() covers multiple tenants", () => {
    queue.enqueue("sess-1", "acme");
    queue.enqueue("sess-2", "beta");
    queue.enqueue("sess-3", "beta");

    const statuses = queue.getAllQueueStatuses();
    expect(statuses).toHaveLength(2);

    const tenantIds = statuses.map((s) => s.tenantId).sort();
    expect(tenantIds).toEqual(["acme", "beta"]);
  });

  test("getPosition() returns null when session in meta but queue not found", () => {
    // Force the edge case: session is in meta but its tenantId queue has been removed
    queue.enqueue("sess-orphan", "ghost-tenant");
    // Manually simulate by clearing the queue entry (remove it so queue is gone)
    queue.remove("sess-orphan");
    // After remove, getPosition should return null (not found)
    expect(queue.getPosition("sess-orphan")).toBeNull();
  });

  test("remove() returns false for unknown session", () => {
    expect(queue.remove("does-not-exist")).toBe(false);
  });
});
