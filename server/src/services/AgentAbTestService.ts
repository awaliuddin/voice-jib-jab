/**
 * AgentAbTestService — General-purpose A/B testing for agent configurations.
 *
 * Splits voice sessions between two agent configurations (variants A and B),
 * tracks quality metrics per variant, and declares a winner when enough data
 * is collected.
 *
 * Differs from VoiceAbTestService (voice-only) by supporting any configuration
 * dimension: voice, persona, system prompt, Lane A toggle, etc.
 *
 * Persistence: single JSON file at the path given to initAgentAbTestService().
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { v4 as uuidv4 } from "uuid";

// ── Types ─────────────────────────────────────────────────────────────

/** Configuration for one test variant (all fields except name are optional overrides) */
export interface AgentVariantConfig {
  name: string;                     // e.g. "Control" or "Experimental"
  voiceId?: string;                 // Voice profile ID override
  personaId?: string;               // Agent persona ID override
  systemPromptOverride?: string;    // System prompt override
  enableLaneA?: boolean;            // Reflex lane toggle override
  tags?: Record<string, string>;    // Arbitrary metadata
}

export interface AgentAbTest {
  testId: string;
  name: string;
  tenantId: string | null;          // null = cross-tenant
  hypothesis?: string;              // What we expect to find
  variantA: AgentVariantConfig;
  variantB: AgentVariantConfig;
  splitRatio: number;               // 0–1, fraction routed to A (default 0.5)
  minSamplesPerVariant: number;     // Minimum scored sessions before winner can be declared (default 10)
  status: "active" | "paused" | "concluded";
  winner?: "A" | "B" | "none";     // Set on conclude
  winnerReason?: string;
  createdAt: string;
  concludedAt?: string;
}

export interface AgentAbTestSession {
  testId: string;
  sessionId: string;
  variant: "A" | "B";
  variantName: string;
  assignedAt: string;               // ISO 8601
  // Post-session metrics (all optional, set via recordMetrics):
  qualityScore?: number;            // 0–100
  durationMs?: number;
  turnCount?: number;
  escalated?: boolean;
  ttfbMs?: number;
  recordedAt?: string;              // ISO 8601 when metrics were last updated
}

export interface VariantStats {
  variant: "A" | "B";
  name: string;
  totalSessions: number;            // All assigned sessions
  scoredSessions: number;           // Sessions with at least qualityScore
  avgQuality: number | null;        // null if scoredSessions === 0
  avgDuration: number | null;       // null if no durationMs data
  avgTurnCount: number | null;
  escalationRate: number | null;    // 0–1
}

export interface AgentAbTestReport {
  test: AgentAbTest;
  variantA: VariantStats;
  variantB: VariantStats;
  /** Suggestion computed from current data — not persisted. */
  winnerSuggestion: "A" | "B" | "none" | "insufficient_data";
  winnerSuggestionReason: string;
  totalSessions: number;
}

interface StorageFormat {
  tests: AgentAbTest[];
  sessions: AgentAbTestSession[];
}

// ── AgentAbTestService ────────────────────────────────────────────────

export class AgentAbTestService {
  private storageFile: string;
  private data: StorageFormat;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.data = this.load();
  }

  // ── Persistence ───────────────────────────────────────────────────

  private load(): StorageFormat {
    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      return JSON.parse(raw) as StorageFormat;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { tests: [], sessions: [] };
      }
      throw err;
    }
  }

  private save(): void {
    mkdirSync(dirname(this.storageFile), { recursive: true });
    writeFileSync(this.storageFile, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // ── Test management ───────────────────────────────────────────────

  /**
   * Create a new A/B test.
   *
   * testId, createdAt, and status are generated automatically.
   *
   * @param opts - Test configuration options
   * @returns The created test
   */
  createTest(
    opts: Omit<AgentAbTest, "testId" | "createdAt" | "status" | "winner" | "winnerReason" | "concludedAt" | "splitRatio" | "minSamplesPerVariant"> & {
      splitRatio?: number;
      minSamplesPerVariant?: number;
    },
  ): AgentAbTest {
    const test: AgentAbTest = {
      testId: uuidv4(),
      name: opts.name,
      tenantId: opts.tenantId,
      hypothesis: opts.hypothesis,
      variantA: opts.variantA,
      variantB: opts.variantB,
      splitRatio: opts.splitRatio ?? 0.5,
      minSamplesPerVariant: opts.minSamplesPerVariant ?? 10,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    this.data.tests.push(test);
    this.save();
    return test;
  }

  /**
   * Get a test by its ID.
   *
   * @param testId - The test UUID
   * @returns The test or undefined if not found
   */
  getTest(testId: string): AgentAbTest | undefined {
    return this.data.tests.find((t) => t.testId === testId);
  }

  /**
   * List tests, optionally filtered by tenantId. Sorted createdAt desc.
   *
   * @param tenantId - Optional tenant filter
   * @returns Array of matching tests
   */
  listTests(tenantId?: string): AgentAbTest[] {
    const tests =
      tenantId === undefined
        ? [...this.data.tests]
        : this.data.tests.filter((t) => t.tenantId === tenantId);

    return tests.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  // ── Session assignment ────────────────────────────────────────────

  /**
   * Assign a session to a variant within a specific test.
   *
   * Uses a deterministic hash of sessionId so the same session always receives
   * the same variant. Returns null if the test is not found or not active.
   * Idempotent — calling again with the same sessionId returns the same result
   * without creating a duplicate record.
   *
   * @param testId - The test to assign within
   * @param sessionId - Session identifier
   * @returns Variant assignment and config, or null
   */
  assignSession(
    testId: string,
    sessionId: string,
  ): { variant: "A" | "B"; config: AgentVariantConfig } | null {
    const test = this.data.tests.find((t) => t.testId === testId);
    if (!test || test.status !== "active") {
      return null;
    }

    const variant = this.hashVariant(sessionId, test.splitRatio);
    const config = variant === "A" ? test.variantA : test.variantB;
    const variantName = config.name;

    const existing = this.data.sessions.find(
      (s) => s.testId === testId && s.sessionId === sessionId,
    );
    if (!existing) {
      const session: AgentAbTestSession = {
        testId,
        sessionId,
        variant,
        variantName,
        assignedAt: new Date().toISOString(),
      };
      this.data.sessions.push(session);
      this.save();
    }

    return { variant, config };
  }

  /**
   * Find an active test for the tenant and assign the session to it.
   *
   * Returns null if no active test exists for the tenant.
   *
   * @param tenantId - Tenant to find an active test for
   * @param sessionId - Session identifier
   * @returns Test ID, variant, and config, or null
   */
  assignSessionByTenant(
    tenantId: string,
    sessionId: string,
  ): { testId: string; variant: "A" | "B"; config: AgentVariantConfig } | null {
    const activeTest = this.data.tests.find(
      (t) => t.tenantId === tenantId && t.status === "active",
    );
    if (!activeTest) {
      return null;
    }

    const result = this.assignSession(activeTest.testId, sessionId);
    if (!result) {
      return null;
    }

    return { testId: activeTest.testId, ...result };
  }

  /**
   * Get a session's assignment record (including metrics if recorded).
   *
   * @param testId - The test the session participated in
   * @param sessionId - The session to look up
   * @returns Session assignment or undefined if not found
   */
  getSessionAssignment(testId: string, sessionId: string): AgentAbTestSession | undefined {
    return this.data.sessions.find(
      (s) => s.testId === testId && s.sessionId === sessionId,
    );
  }

  /**
   * Record post-session metrics. Merges into the existing assignment record.
   *
   * No-op (returns false) if the session has no assignment for this test.
   *
   * @param testId - The test the session participated in
   * @param sessionId - The session whose metrics are being recorded
   * @param metrics - Metric values to merge
   * @returns true if updated, false if session not found
   */
  recordMetrics(
    testId: string,
    sessionId: string,
    metrics: {
      qualityScore?: number;
      durationMs?: number;
      turnCount?: number;
      escalated?: boolean;
      ttfbMs?: number;
    },
  ): boolean {
    const session = this.data.sessions.find(
      (s) => s.testId === testId && s.sessionId === sessionId,
    );
    if (!session) {
      return false;
    }

    if (metrics.qualityScore !== undefined) session.qualityScore = metrics.qualityScore;
    if (metrics.durationMs !== undefined) session.durationMs = metrics.durationMs;
    if (metrics.turnCount !== undefined) session.turnCount = metrics.turnCount;
    if (metrics.escalated !== undefined) session.escalated = metrics.escalated;
    if (metrics.ttfbMs !== undefined) session.ttfbMs = metrics.ttfbMs;
    session.recordedAt = new Date().toISOString();

    this.save();
    return true;
  }

  /**
   * Compute live stats and a winner suggestion from current data.
   *
   * Never throws — returns undefined only if the test does not exist.
   *
   * @param testId - The test to report on
   * @returns Report with variant stats and winner suggestion, or undefined
   */
  getReport(testId: string): AgentAbTestReport | undefined {
    const test = this.data.tests.find((t) => t.testId === testId);
    if (!test) {
      return undefined;
    }

    const sessions = this.data.sessions.filter((s) => s.testId === testId);
    const aSessions = sessions.filter((s) => s.variant === "A");
    const bSessions = sessions.filter((s) => s.variant === "B");

    const variantA = computeVariantStats("A", test.variantA.name, aSessions);
    const variantB = computeVariantStats("B", test.variantB.name, bSessions);

    const { winner: winnerSuggestion, reason: winnerSuggestionReason } =
      computeWinnerSuggestion(variantA, variantB, test.minSamplesPerVariant);

    return {
      test,
      variantA,
      variantB,
      winnerSuggestion,
      winnerSuggestionReason,
      totalSessions: sessions.length,
    };
  }

  /**
   * Conclude the test: run winner logic, persist winner/winnerReason/concludedAt.
   *
   * If the winner argument is provided it is used directly (manual override).
   * Otherwise the winner is computed from current data.
   *
   * @param testId - The test to conclude
   * @param winner - Optional manual winner override
   * @returns The updated test, or undefined if not found
   */
  concludeTest(testId: string, winner?: "A" | "B" | "none"): AgentAbTest | undefined {
    const test = this.data.tests.find((t) => t.testId === testId);
    if (!test) {
      return undefined;
    }

    let resolvedWinner: "A" | "B" | "none";
    let resolvedReason: string;

    if (winner !== undefined) {
      resolvedWinner = winner;
      resolvedReason = "Manual override";
    } else {
      const report = this.getReport(testId);
      const suggestion = report?.winnerSuggestion ?? "none";
      resolvedWinner =
        suggestion === "insufficient_data" ? "none" : suggestion;
      resolvedReason = report?.winnerSuggestionReason ?? "No data";
    }

    test.status = "concluded";
    test.winner = resolvedWinner;
    test.winnerReason = resolvedReason;
    test.concludedAt = new Date().toISOString();

    this.save();
    return test;
  }

  /**
   * Pause an active test (stops new assignments).
   *
   * @param testId - The test to pause
   * @returns The updated test, or undefined if not found
   */
  pauseTest(testId: string): AgentAbTest | undefined {
    const test = this.data.tests.find((t) => t.testId === testId);
    if (!test) {
      return undefined;
    }
    test.status = "paused";
    this.save();
    return test;
  }

  /**
   * Resume a paused test.
   *
   * @param testId - The test to resume
   * @returns The updated test, or undefined if not found
   */
  resumeTest(testId: string): AgentAbTest | undefined {
    const test = this.data.tests.find((t) => t.testId === testId);
    if (!test) {
      return undefined;
    }
    test.status = "active";
    this.save();
    return test;
  }

  /**
   * Delete a test and all its session records.
   *
   * @param testId - The test to delete
   * @returns true if deleted, false if not found
   */
  deleteTest(testId: string): boolean {
    const index = this.data.tests.findIndex((t) => t.testId === testId);
    if (index === -1) {
      return false;
    }
    this.data.tests.splice(index, 1);
    this.data.sessions = this.data.sessions.filter((s) => s.testId !== testId);
    this.save();
    return true;
  }

  // ── Private helpers ───────────────────────────────────────────────

  /**
   * Deterministically assign a variant based on session ID hash.
   *
   * Hash is the sum of all character codes, modulo 1000.
   * Bucket < threshold (splitRatio * 1000) → variant A; otherwise B.
   */
  private hashVariant(sessionId: string, splitRatio: number): "A" | "B" {
    const hash = sessionId.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    const bucket = hash % 1000; // 0–999
    const threshold = Math.round(splitRatio * 1000);
    return bucket < threshold ? "A" : "B";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function computeVariantStats(
  variant: "A" | "B",
  name: string,
  sessions: AgentAbTestSession[],
): VariantStats {
  const scored = sessions.filter((s) => s.qualityScore !== undefined);
  const withDuration = sessions.filter((s) => s.durationMs !== undefined);
  const withTurnCount = sessions.filter((s) => s.turnCount !== undefined);
  const withEscalation = sessions.filter((s) => s.escalated !== undefined);

  return {
    variant,
    name,
    totalSessions: sessions.length,
    scoredSessions: scored.length,
    avgQuality: avg(scored.map((s) => s.qualityScore as number)),
    avgDuration: avg(withDuration.map((s) => s.durationMs as number)),
    avgTurnCount: avg(withTurnCount.map((s) => s.turnCount as number)),
    escalationRate:
      withEscalation.length === 0
        ? null
        : withEscalation.filter((s) => s.escalated).length / withEscalation.length,
  };
}

function computeWinnerSuggestion(
  variantA: VariantStats,
  variantB: VariantStats,
  minSamples: number,
): { winner: "A" | "B" | "none" | "insufficient_data"; reason: string } {
  if (variantA.scoredSessions < minSamples || variantB.scoredSessions < minSamples) {
    return {
      winner: "insufficient_data",
      reason: `Need ${minSamples} scored sessions per variant (A: ${variantA.scoredSessions}, B: ${variantB.scoredSessions})`,
    };
  }

  const qA = variantA.avgQuality as number;
  const qB = variantB.avgQuality as number;
  const delta = Math.abs(qA - qB);

  if (delta < 2) {
    return {
      winner: "none",
      reason: `Quality scores within 2 pts (A: ${qA.toFixed(1)}, B: ${qB.toFixed(1)}) — no clear winner`,
    };
  }

  const winner: "A" | "B" = qA > qB ? "A" : "B";
  const loser: "A" | "B" = winner === "A" ? "B" : "A";
  const winnerScore = winner === "A" ? qA : qB;
  const loserScore = winner === "A" ? qB : qA;

  return {
    winner,
    reason: `Variant ${winner} scored ${winnerScore.toFixed(1)} vs ${loser} ${loserScore.toFixed(1)} (delta: ${delta.toFixed(1)})`,
  };
}

// ── Singleton factory ─────────────────────────────────────────────────

let _instance: AgentAbTestService | undefined;

/**
 * Initialize the module-level AgentAbTestService singleton.
 *
 * @param storageFile - Absolute path to the JSON persistence file
 * @returns The initialized service instance
 */
export function initAgentAbTestService(storageFile: string): AgentAbTestService {
  _instance = new AgentAbTestService(storageFile);
  return _instance;
}

/**
 * Module-level singleton proxy.
 *
 * Delegates all method calls to the instance created by initAgentAbTestService().
 * Throws if the service has not been initialized.
 */
export const agentAbTestService: AgentAbTestService = new Proxy(
  {} as AgentAbTestService,
  {
    get(_target, prop) {
      if (!_instance) {
        throw new Error(
          "AgentAbTestService not initialized — call initAgentAbTestService() first",
        );
      }
      const value = (_instance as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(_instance);
      }
      return value;
    },
  },
);
