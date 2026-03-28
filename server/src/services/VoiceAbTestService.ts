/**
 * VoiceAbTestService — Split sessions between two voice profiles and track quality.
 *
 * Manages A/B tests where each session is deterministically assigned to voice A
 * or voice B based on a hash of the session ID. Quality scores are recorded after
 * sessions complete so aggregate statistics can be computed per-voice per-test.
 *
 * Persistence: Single JSON file with `tests` and `results` arrays.
 *
 * Usage:
 *   const svc = initVoiceAbTestService("/data/abtests.json");
 *   const test = svc.createTest({ tenantId: "acme", name: "Emma vs Bella", voiceA: "af_bella", voiceB: "bf_emma" });
 *   const { voice } = svc.assignVoice("acme", sessionId, "af_bella");
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { v4 as uuidv4 } from "uuid";

// ── Types ─────────────────────────────────────────────────────────────

/** Configuration for a voice A/B test experiment. */
export interface VoiceAbTestConfig {
  testId: string;
  tenantId: string;
  name: string;
  voiceA: string;
  voiceB: string;
  /** Fraction of sessions routed to voiceA. Must be in [0, 1]. Default 0.5. */
  splitRatio: number;
  active: boolean;
  createdAt: string;
}

/** Per-session A/B test assignment with optional quality score. */
export interface VoiceAbTestResult {
  testId: string;
  sessionId: string;
  /** Which arm the session was assigned to. */
  assignedVoice: "A" | "B";
  voiceName: string;
  qualityScore?: number;
}

interface StorageFormat {
  tests: VoiceAbTestConfig[];
  results: VoiceAbTestResult[];
}

// ── VoiceAbTestService ────────────────────────────────────────────────

/** Manages voice A/B test experiments with deterministic session assignment. */
export class VoiceAbTestService {
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
        return { tests: [], results: [] };
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
   * @param opts - Test configuration (testId and createdAt are generated automatically)
   * @returns The created test configuration
   */
  createTest(
    opts: Omit<VoiceAbTestConfig, "testId" | "createdAt" | "active" | "splitRatio"> & {
      active?: boolean;
      splitRatio?: number;
    },
  ): VoiceAbTestConfig {
    const test: VoiceAbTestConfig = {
      testId: uuidv4(),
      tenantId: opts.tenantId,
      name: opts.name,
      voiceA: opts.voiceA,
      voiceB: opts.voiceB,
      splitRatio: opts.splitRatio ?? 0.5,
      active: opts.active ?? true,
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
   * @returns The test config or undefined if not found
   */
  getTest(testId: string): VoiceAbTestConfig | undefined {
    return this.data.tests.find((t) => t.testId === testId);
  }

  /**
   * List all tests, optionally filtered by tenantId.
   *
   * @param tenantId - Optional tenant filter
   * @returns Array of matching test configurations
   */
  listTests(tenantId?: string): VoiceAbTestConfig[] {
    if (tenantId === undefined) {
      return [...this.data.tests];
    }
    return this.data.tests.filter((t) => t.tenantId === tenantId);
  }

  /**
   * Deactivate an A/B test.
   *
   * @param testId - The test UUID to deactivate
   * @returns The updated test config, or undefined if not found
   */
  deactivateTest(testId: string): VoiceAbTestConfig | undefined {
    const test = this.data.tests.find((t) => t.testId === testId);
    if (!test) {
      return undefined;
    }
    test.active = false;
    this.save();
    return test;
  }

  // ── Session assignment ────────────────────────────────────────────

  /**
   * Assign a voice to a session based on active A/B tests for the tenant.
   *
   * Uses a deterministic hash of the session ID so the same session always
   * receives the same voice assignment. The hash is the sum of all character
   * codes in the session ID, modulo 100. If the result is less than
   * splitRatio * 100, the session is assigned to voiceA; otherwise voiceB.
   *
   * If no active test exists for the tenant, returns the defaultVoice.
   *
   * @param tenantId - Tenant to find an active test for
   * @param sessionId - Session identifier (used for deterministic hashing)
   * @param defaultVoice - Voice to use when no active test is found
   * @returns Assignment details including the voice name, testId, and arm label
   */
  assignVoice(
    tenantId: string,
    sessionId: string,
    defaultVoice: string,
  ): { voice: string; testId: string | null; assignment: "A" | "B" | "default" } {
    const activeTest = this.data.tests.find((t) => t.tenantId === tenantId && t.active);

    if (!activeTest) {
      return { voice: defaultVoice, testId: null, assignment: "default" };
    }

    const hash = sessionId
      .split("")
      .reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const bucket = hash % 100;

    if (bucket < activeTest.splitRatio * 100) {
      // Record assignment for voice A
      this.upsertResult(activeTest.testId, sessionId, "A", activeTest.voiceA);
      return { voice: activeTest.voiceA, testId: activeTest.testId, assignment: "A" };
    }

    // Record assignment for voice B
    this.upsertResult(activeTest.testId, sessionId, "B", activeTest.voiceB);
    return { voice: activeTest.voiceB, testId: activeTest.testId, assignment: "B" };
  }

  /**
   * Record the quality score for a session's voice assignment.
   *
   * @param testId - The test the session participated in
   * @param sessionId - The session whose quality is being recorded
   * @param qualityScore - Quality score to record (e.g. from VoiceQualityScorer)
   */
  recordQuality(testId: string, sessionId: string, qualityScore: number): void {
    const result = this.data.results.find(
      (r) => r.testId === testId && r.sessionId === sessionId,
    );
    if (result) {
      result.qualityScore = qualityScore;
      this.save();
    }
  }

  /**
   * Get aggregate statistics for an A/B test.
   *
   * Returns average quality scores and session counts per voice arm.
   * avgQuality is null when no quality scores have been recorded for that arm.
   *
   * @param testId - The test to aggregate stats for
   * @returns Stats object or undefined if the test does not exist
   */
  getTestStats(testId: string): {
    testId: string;
    voiceA: { name: string; sessions: number; avgQuality: number | null };
    voiceB: { name: string; sessions: number; avgQuality: number | null };
  } | undefined {
    const test = this.getTest(testId);
    if (!test) {
      return undefined;
    }

    const resultsForTest = this.data.results.filter((r) => r.testId === testId);

    const aResults = resultsForTest.filter((r) => r.assignedVoice === "A");
    const bResults = resultsForTest.filter((r) => r.assignedVoice === "B");

    return {
      testId,
      voiceA: {
        name: test.voiceA,
        sessions: aResults.length,
        avgQuality: computeAvgQuality(aResults),
      },
      voiceB: {
        name: test.voiceB,
        sessions: bResults.length,
        avgQuality: computeAvgQuality(bResults),
      },
    };
  }

  // ── Private helpers ───────────────────────────────────────────────

  /**
   * Insert a new result for a session if one does not already exist.
   * Assignment is immutable once set — the same session always maps to the same arm.
   */
  private upsertResult(
    testId: string,
    sessionId: string,
    assignedVoice: "A" | "B",
    voiceName: string,
  ): void {
    const existing = this.data.results.find(
      (r) => r.testId === testId && r.sessionId === sessionId,
    );
    if (!existing) {
      this.data.results.push({ testId, sessionId, assignedVoice, voiceName });
      this.save();
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function computeAvgQuality(results: VoiceAbTestResult[]): number | null {
  const scored = results.filter((r) => r.qualityScore !== undefined);
  if (scored.length === 0) {
    return null;
  }
  const total = scored.reduce((sum, r) => sum + (r.qualityScore as number), 0);
  return total / scored.length;
}

// ── Singleton factory ─────────────────────────────────────────────────

let _instance: VoiceAbTestService | undefined;

/**
 * Initialize the module-level VoiceAbTestService singleton.
 *
 * @param storageFile - Absolute path to the JSON persistence file
 * @returns The initialized service instance
 */
export function initVoiceAbTestService(storageFile: string): VoiceAbTestService {
  _instance = new VoiceAbTestService(storageFile);
  return _instance;
}

/**
 * Module-level singleton proxy.
 *
 * Delegates all method calls to the instance created by initVoiceAbTestService().
 * Throws if the service has not been initialized.
 */
export const voiceAbTestService: VoiceAbTestService = new Proxy(
  {} as VoiceAbTestService,
  {
    get(_target, prop) {
      if (!_instance) {
        throw new Error(
          "VoiceAbTestService not initialized — call initVoiceAbTestService() first",
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
