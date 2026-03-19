/**
 * RoutingEngine -- Rule-based call routing with tenant isolation.
 *
 * Evaluates incoming session metadata against an ordered set of routing rules
 * to determine which agent template should handle the call. Rules are persisted
 * to a JSON file on disk and reloaded on init.
 *
 * Usage:
 *   const engine = initRoutingEngine("/path/to/routing-rules.json");
 *   const decision = engine.evaluate({ tenantId: "acme", language: "es" });
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "node:crypto";

// -- Types ------------------------------------------------------------------

export interface RoutingConditions {
  language?: string;
  topic?: string;
  timeRange?: { start: string; end: string };
  callerType?: "new" | "returning";
}

export interface RoutingRule {
  ruleId: string;
  tenantId: string | null;
  priority: number;
  conditions: RoutingConditions;
  targetTemplateId: string;
  maxConcurrentSessions: number | null;
  active: boolean;
  createdAt: string;
}

export interface RoutingSessionMeta {
  tenantId: string;
  language?: string;
  topic?: string;
  callerType?: "new" | "returning";
  currentSessionCount?: number;
}

export interface RoutingDecision {
  templateId: string;
  ruleId: string | "default";
  matchedConditions: string[];
}

// -- Default fallback -------------------------------------------------------

const DEFAULT_TEMPLATE_ID = "builtin-customer-support";

// -- RoutingEngine ----------------------------------------------------------

export class RoutingEngine {
  private rules: RoutingRule[] = [];
  private storageFile: string;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.loadFromDisk();
  }

  /** Return active rules, optionally filtered to global + tenant-specific. Sorted by priority ascending. */
  getRules(tenantId?: string): RoutingRule[] {
    let result = this.rules.filter((r) => r.active);

    if (tenantId !== undefined) {
      result = result.filter((r) => r.tenantId === null || r.tenantId === tenantId);
    }

    return result.sort((a, b) => a.priority - b.priority);
  }

  /** Get a single rule by id. */
  getRule(ruleId: string): RoutingRule | undefined {
    return this.rules.find((r) => r.ruleId === ruleId);
  }

  /** Create a new routing rule. Persists immediately. */
  addRule(opts: Omit<RoutingRule, "ruleId" | "createdAt">): RoutingRule {
    const rule: RoutingRule = {
      ...opts,
      ruleId: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    this.rules.push(rule);
    this.persist();
    return rule;
  }

  /** Patch fields on an existing rule. Returns undefined if not found. */
  updateRule(
    ruleId: string,
    patch: Partial<Omit<RoutingRule, "ruleId" | "createdAt">>,
  ): RoutingRule | undefined {
    const idx = this.rules.findIndex((r) => r.ruleId === ruleId);
    if (idx === -1) {
      return undefined;
    }

    const existing = this.rules[idx];
    const updated: RoutingRule = {
      ...existing,
      ...patch,
      ruleId: existing.ruleId,
      createdAt: existing.createdAt,
    };

    this.rules[idx] = updated;
    this.persist();
    return updated;
  }

  /** Delete a rule by id. Returns true if found and removed. */
  deleteRule(ruleId: string): boolean {
    const idx = this.rules.findIndex((r) => r.ruleId === ruleId);
    if (idx === -1) {
      return false;
    }

    this.rules.splice(idx, 1);
    this.persist();
    return true;
  }

  /** Evaluate session metadata against routing rules and return a decision. */
  evaluate(meta: RoutingSessionMeta): RoutingDecision {
    const candidates = this.getRules(meta.tenantId);

    for (const rule of candidates) {
      const matched = this.matchRule(rule, meta);
      if (matched !== null) {
        return {
          templateId: rule.targetTemplateId,
          ruleId: rule.ruleId,
          matchedConditions: matched,
        };
      }
    }

    return {
      templateId: DEFAULT_TEMPLATE_ID,
      ruleId: "default",
      matchedConditions: [],
    };
  }

  // -- Private helpers ------------------------------------------------------

  /** Check whether a single rule matches session meta. Returns matched condition names or null. */
  private matchRule(rule: RoutingRule, meta: RoutingSessionMeta): string[] | null {
    const matched: string[] = [];

    // Tenant match (null = global, otherwise must match exactly)
    if (rule.tenantId !== null && rule.tenantId !== meta.tenantId) {
      return null;
    }

    // Language condition
    if (rule.conditions.language !== undefined) {
      if (meta.language !== rule.conditions.language) {
        return null;
      }
      matched.push("language");
    }

    // Topic condition (case-insensitive substring)
    if (rule.conditions.topic !== undefined) {
      if (
        !meta.topic ||
        !meta.topic.toLowerCase().includes(rule.conditions.topic.toLowerCase())
      ) {
        return null;
      }
      matched.push("topic");
    }

    // Time range condition (current UTC HH:MM within range)
    if (rule.conditions.timeRange !== undefined) {
      if (!this.isWithinTimeRange(rule.conditions.timeRange)) {
        return null;
      }
      matched.push("timeRange");
    }

    // Caller type condition
    if (rule.conditions.callerType !== undefined) {
      if (meta.callerType !== rule.conditions.callerType) {
        return null;
      }
      matched.push("callerType");
    }

    // Concurrency cap
    if (
      rule.maxConcurrentSessions !== null &&
      meta.currentSessionCount !== undefined &&
      meta.currentSessionCount >= rule.maxConcurrentSessions
    ) {
      return null;
    }

    return matched;
  }

  /** Check if current UTC time falls within a start-end HH:MM range. */
  private isWithinTimeRange(range: { start: string; end: string }): boolean {
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const startMinutes = this.parseHHMM(range.start);
    const endMinutes = this.parseHHMM(range.end);

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    // Wraps midnight: e.g. 22:00 -> 06:00
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }

  /** Parse "HH:MM" into total minutes. */
  private parseHHMM(value: string): number {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }

  /** Load rules from disk. */
  private loadFromDisk(): void {
    if (!existsSync(this.storageFile)) {
      return;
    }

    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      this.rules = JSON.parse(raw) as RoutingRule[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  /** Persist all rules to disk as JSON. */
  private persist(): void {
    const dir = dirname(this.storageFile);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.storageFile, JSON.stringify(this.rules, null, 2), "utf-8");
  }
}

// -- Module-level factory ---------------------------------------------------

export function initRoutingEngine(storageFile: string): RoutingEngine {
  return new RoutingEngine(storageFile);
}
