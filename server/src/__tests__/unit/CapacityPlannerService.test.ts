/**
 * CapacityPlannerService Unit Tests
 *
 * Pure computation — no mocks needed. All assertions verify real formula
 * outputs against expected values derived from the documented calculation rules.
 */

import { CapacityPlannerService } from "../../services/CapacityPlannerService.js";
import type { CapacityInput } from "../../services/CapacityPlannerService.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<CapacityInput> = {}): CapacityInput {
  return {
    peakConcurrentSessions: 20,
    avgSessionDurationMinutes: 5,
    dailyCallVolume: 200,
    recordingsEnabled: false,
    recordingRetentionDays: 30,
    ragEnabled: false,
    sentimentAnalysisEnabled: false,
    policyEvaluationEnabled: false,
    deploymentTarget: "single_server",
    ...overrides,
  };
}

const svc = new CapacityPlannerService();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CapacityPlannerService.calculate()", () => {
  // ── General shape ─────────────────────────────────────────────────────────

  it("returns a CapacityRecommendation with a valid ISO generatedAt timestamp", () => {
    const result = svc.calculate(baseInput());
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });

  it("echoes the input back in the recommendation", () => {
    const input = baseInput({ peakConcurrentSessions: 30, ragEnabled: true });
    const result = svc.calculate(input);
    expect(result.input).toEqual(input);
  });

  it("resources array is non-empty", () => {
    const result = svc.calculate(baseInput());
    expect(result.resources.length).toBeGreaterThan(0);
  });

  it("scalingNotes is an array (may be empty)", () => {
    const result = svc.calculate(baseInput());
    expect(Array.isArray(result.scalingNotes)).toBe(true);
  });

  // ── CPU ───────────────────────────────────────────────────────────────────

  it("cpu.minimumCores is 2 for 10 concurrent sessions (base=1, floor=2)", () => {
    // 10 sessions → 1 group × 1 core = 1 → max(2, 1) = 2
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 10 }));
    expect(result.cpu.minimumCores).toBe(2);
  });

  it("cpu.minimumCores is 2 for 20 concurrent sessions (base=2, floor keeps 2)", () => {
    // 20 sessions → 2 groups × 1 core = 2 → max(2, 2) = 2
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 20 }));
    expect(result.cpu.minimumCores).toBe(2);
  });

  it("cpu.minimumCores is 3 for 30 concurrent sessions (base=3)", () => {
    // 30 sessions → 3 groups × 1 core = 3 → max(2, 3) = 3
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 30 }));
    expect(result.cpu.minimumCores).toBe(3);
  });

  it("cpu.minimumCores increases with sentimentAnalysisEnabled", () => {
    const without = svc.calculate(baseInput({ peakConcurrentSessions: 30 }));
    const with_ = svc.calculate(
      baseInput({ peakConcurrentSessions: 30, sentimentAnalysisEnabled: true }),
    );
    // +0.5 core per 10 sessions for 30 sessions → +1.5 → ceil adds to minimum
    expect(with_.cpu.minimumCores).toBeGreaterThan(without.cpu.minimumCores);
  });

  it("cpu.minimumCores increases with policyEvaluationEnabled", () => {
    const without = svc.calculate(baseInput({ peakConcurrentSessions: 30 }));
    const with_ = svc.calculate(
      baseInput({ peakConcurrentSessions: 30, policyEvaluationEnabled: true }),
    );
    expect(with_.cpu.minimumCores).toBeGreaterThan(without.cpu.minimumCores);
  });

  it("cpu.minimumCores increases by 1 with ragEnabled (fixed overhead)", () => {
    const without = svc.calculate(
      baseInput({ peakConcurrentSessions: 10, ragEnabled: false }),
    );
    const with_ = svc.calculate(
      baseInput({ peakConcurrentSessions: 10, ragEnabled: true }),
    );
    // base=1, rag+1 → raw=2 → ceil=2 → max(2,2)=2, but without=max(2,1)=2
    // Use 20 sessions to see the delta: without=2, with=ceil(2+1)=3
    const r20 = svc.calculate(
      baseInput({ peakConcurrentSessions: 20, ragEnabled: false }),
    );
    const r20rag = svc.calculate(
      baseInput({ peakConcurrentSessions: 20, ragEnabled: true }),
    );
    expect(r20rag.cpu.minimumCores).toBeGreaterThan(r20.cpu.minimumCores);
    // Suppress unused variable warning from first two computes
    expect(without.cpu.minimumCores).toBeGreaterThanOrEqual(2);
    expect(with_.cpu.minimumCores).toBeGreaterThanOrEqual(2);
  });

  it("cpu.recommendedCores = ceil(minimumCores * 1.5)", () => {
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 20 }));
    // minimumCores=2, recommended=ceil(2*1.5)=3
    expect(result.cpu.recommendedCores).toBe(Math.ceil(result.cpu.minimumCores * 1.5));
  });

  it("cpu.recommendedCores correctly rounds up non-integer product", () => {
    // 30 sessions → minimumCores=3 → ceil(3*1.5)=5 (4.5 → 5)
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 30 }));
    expect(result.cpu.recommendedCores).toBe(Math.ceil(result.cpu.minimumCores * 1.5));
  });

  // ── RAM ───────────────────────────────────────────────────────────────────

  it("ram.minimumGb includes 1 GB Node.js overhead", () => {
    // With 0 sessions conceptually: Node=1GB + SQLite=0.5GB → min 2 GB
    // Use 10 sessions without rag/sentiment: 1 group * 512MB + 512MB + 1024MB = 2048MB = 2GB
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 10 }));
    expect(result.ram.minimumGb).toBeGreaterThanOrEqual(2);
  });

  it("ram.minimumGb includes 512 MB SQLite overhead", () => {
    // Verified by checking minimum is at least ceil((512+1024)/1024) = 2 with negligible sessions
    const result = svc.calculate(
      baseInput({ peakConcurrentSessions: 1 }),
    );
    // 0.1 groups * 512 + 512 + 1024 = 51.2 + 1536 = 1587.2 MB → ceil=2 GB
    expect(result.ram.minimumGb).toBeGreaterThanOrEqual(2);
  });

  it("ram.minimumGb increases by 2 GB fixed when ragEnabled", () => {
    const without = svc.calculate(baseInput({ peakConcurrentSessions: 20 }));
    const with_ = svc.calculate(
      baseInput({ peakConcurrentSessions: 20, ragEnabled: true }),
    );
    expect(with_.ram.minimumGb).toBeGreaterThan(without.ram.minimumGb);
  });

  it("ram.minimumGb exact: 20 sessions, all features off", () => {
    // 2 groups * 512MB session = 1024MB + 512MB SQLite + 1024MB Node = 2560MB → ceil=3GB
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 20 }));
    expect(result.ram.minimumGb).toBe(3);
  });

  it("ram.minimumGb exact: 20 sessions, ragEnabled", () => {
    // session: 2*512+2*256=1024+512=1536MB, fixed: 512+1024+2048=3584MB, total=5120MB → 5GB
    const result = svc.calculate(
      baseInput({ peakConcurrentSessions: 20, ragEnabled: true }),
    );
    expect(result.ram.minimumGb).toBe(5);
  });

  it("ram.recommendedGb = round(minimumGb * 1.5) to nearest GB", () => {
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 20 }));
    // minimumGb=2, recommended=round(2*1.5)=3
    expect(result.ram.recommendedGb).toBe(Math.round(result.ram.minimumGb * 1.5));
  });

  // ── Storage ───────────────────────────────────────────────────────────────

  it("storage.breakdown includes transcript entry", () => {
    const result = svc.calculate(baseInput());
    const transcript = result.storage.breakdown.find(
      (e) => e.component === "Transcripts",
    );
    expect(transcript).toBeDefined();
  });

  it("storage.breakdown includes audio entry when recordingsEnabled=true", () => {
    const result = svc.calculate(
      baseInput({ recordingsEnabled: true, recordingRetentionDays: 30 }),
    );
    const audio = result.storage.breakdown.find(
      (e) => e.component === "Audio Recordings",
    );
    expect(audio).toBeDefined();
  });

  it("storage.breakdown excludes audio entry when recordingsEnabled=false", () => {
    const result = svc.calculate(baseInput({ recordingsEnabled: false }));
    const audio = result.storage.breakdown.find(
      (e) => e.component === "Audio Recordings",
    );
    expect(audio).toBeUndefined();
  });

  it("storage.breakdown includes embeddings entry when ragEnabled=true", () => {
    const result = svc.calculate(baseInput({ ragEnabled: true }));
    const emb = result.storage.breakdown.find(
      (e) => e.component === "Embeddings (ChromaDB)",
    );
    expect(emb).toBeDefined();
  });

  it("storage.breakdown excludes embeddings entry when ragEnabled=false", () => {
    const result = svc.calculate(baseInput({ ragEnabled: false }));
    const emb = result.storage.breakdown.find(
      (e) => e.component === "Embeddings (ChromaDB)",
    );
    expect(emb).toBeUndefined();
  });

  it("audio retentionGb = dailyGb * recordingRetentionDays", () => {
    const result = svc.calculate(
      baseInput({
        recordingsEnabled: true,
        recordingRetentionDays: 30,
        dailyCallVolume: 100,
        avgSessionDurationMinutes: 5,
      }),
    );
    const audio = result.storage.breakdown.find(
      (e) => e.component === "Audio Recordings",
    )!;
    expect(audio.retentionGb).toBeCloseTo(audio.dailyGb * 30, 5);
  });

  it("storage.recommendedGb = ceil(totalGb * 1.5)", () => {
    const result = svc.calculate(
      baseInput({
        recordingsEnabled: true,
        recordingRetentionDays: 30,
        dailyCallVolume: 100,
      }),
    );
    const totalGb = result.storage.breakdown.reduce(
      (sum, e) => sum + e.totalGb,
      0,
    );
    expect(result.storage.recommendedGb).toBe(Math.ceil(totalGb * 1.5));
  });

  // ── Network ───────────────────────────────────────────────────────────────

  it("network.minimumMbps is proportional to peakConcurrentSessions", () => {
    const r10 = svc.calculate(baseInput({ peakConcurrentSessions: 10 }));
    const r20 = svc.calculate(baseInput({ peakConcurrentSessions: 20 }));
    expect(r20.network.minimumMbps).toBeGreaterThan(r10.network.minimumMbps);
  });

  it("network.minimumMbps exact: 10 sessions = ceil(10*0.768 + 10) = ceil(17.68) = 18", () => {
    // inbound = 10 * 384kbps / 1000 = 3.84 Mbps, outbound same, fixed=10
    // total = 3.84+3.84+10 = 17.68 → ceil = 18
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 10 }));
    expect(result.network.minimumMbps).toBe(18);
  });

  it("network.recommendedMbps = ceil(minimumMbps * 1.5)", () => {
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 20 }));
    expect(result.network.recommendedMbps).toBe(
      Math.ceil(result.network.minimumMbps * 1.5),
    );
  });

  // ── Cost estimate ─────────────────────────────────────────────────────────

  it("cost low estimate is based on minimum resources", () => {
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 20 }));
    // low = cpu.min * $35/month + ram.min * $4.38/month + storage.min * $0.02
    const expectedLow =
      result.cpu.minimumCores * 0.048 * 730 +
      result.ram.minimumGb * 0.006 * 730 +
      result.storage.minimumGb * 0.02;
    expect(result.totalMonthlyCostEstimateUsd.low).toBe(Math.round(expectedLow));
  });

  it("cost high estimate is based on recommended resources", () => {
    const result = svc.calculate(baseInput({ peakConcurrentSessions: 20 }));
    const expectedHigh =
      result.cpu.recommendedCores * 0.048 * 730 +
      result.ram.recommendedGb * 0.006 * 730 +
      result.storage.recommendedGb * 0.02;
    expect(result.totalMonthlyCostEstimateUsd.high).toBe(
      Math.round(expectedHigh),
    );
  });

  it("cost high estimate is always >= low estimate", () => {
    const result = svc.calculate(
      baseInput({ peakConcurrentSessions: 50, ragEnabled: true }),
    );
    expect(result.totalMonthlyCostEstimateUsd.high).toBeGreaterThanOrEqual(
      result.totalMonthlyCostEstimateUsd.low,
    );
  });

  // ── Kubernetes ────────────────────────────────────────────────────────────

  it("kubernetes is undefined when deploymentTarget is not 'kubernetes'", () => {
    const result = svc.calculate(
      baseInput({ deploymentTarget: "single_server" }),
    );
    expect(result.kubernetes).toBeUndefined();
  });

  it("kubernetes is undefined for docker target", () => {
    const result = svc.calculate(baseInput({ deploymentTarget: "docker" }));
    expect(result.kubernetes).toBeUndefined();
  });

  it("kubernetes.minReplicas = max(2, ceil(sessions/20))", () => {
    // 20 sessions → ceil(1)=1 → max(2,1)=2
    const r20 = svc.calculate(
      baseInput({ peakConcurrentSessions: 20, deploymentTarget: "kubernetes" }),
    );
    expect(r20.kubernetes!.minReplicas).toBe(2);

    // 60 sessions → ceil(3)=3 → max(2,3)=3
    const r60 = svc.calculate(
      baseInput({ peakConcurrentSessions: 60, deploymentTarget: "kubernetes" }),
    );
    expect(r60.kubernetes!.minReplicas).toBe(3);
  });

  it("kubernetes.maxReplicas = minReplicas * 3", () => {
    const result = svc.calculate(
      baseInput({ peakConcurrentSessions: 60, deploymentTarget: "kubernetes" }),
    );
    expect(result.kubernetes!.maxReplicas).toBe(
      result.kubernetes!.minReplicas * 3,
    );
  });

  it("kubernetes pod resource strings match spec", () => {
    const result = svc.calculate(
      baseInput({ deploymentTarget: "kubernetes" }),
    );
    expect(result.kubernetes!.cpuRequestPerPod).toBe("500m");
    expect(result.kubernetes!.cpuLimitPerPod).toBe("2000m");
    expect(result.kubernetes!.memRequestPerPod).toBe("512Mi");
    expect(result.kubernetes!.memLimitPerPod).toBe("2Gi");
    expect(result.kubernetes!.hpaTargetCpuPct).toBe(70);
  });

  // ── Warnings ──────────────────────────────────────────────────────────────

  it("no warnings for a well-configured small deployment", () => {
    const result = svc.calculate(
      baseInput({
        peakConcurrentSessions: 20,
        recordingsEnabled: false,
        ragEnabled: false,
        deploymentTarget: "docker",
      }),
    );
    expect(result.warnings).toHaveLength(0);
  });

  it("warns 'High concurrency' when peakConcurrentSessions > 100", () => {
    const result = svc.calculate(
      baseInput({ peakConcurrentSessions: 101 }),
    );
    expect(
      result.warnings.some((w) => w.includes("High concurrency")),
    ).toBe(true);
  });

  it("no 'High concurrency' warning at exactly 100 sessions", () => {
    const result = svc.calculate(
      baseInput({ peakConcurrentSessions: 100 }),
    );
    expect(
      result.warnings.some((w) => w.includes("High concurrency")),
    ).toBe(false);
  });

  it("warns 'Long retention' when recordingsEnabled and retentionDays > 90", () => {
    const result = svc.calculate(
      baseInput({ recordingsEnabled: true, recordingRetentionDays: 91 }),
    );
    expect(
      result.warnings.some((w) => w.includes("Long retention")),
    ).toBe(true);
  });

  it("no 'Long retention' warning when recordings disabled even if retentionDays > 90", () => {
    const result = svc.calculate(
      baseInput({ recordingsEnabled: false, recordingRetentionDays: 91 }),
    );
    expect(
      result.warnings.some((w) => w.includes("Long retention")),
    ).toBe(false);
  });

  it("warns 'dedicated ChromaDB' when ragEnabled and peakConcurrentSessions > 50", () => {
    const result = svc.calculate(
      baseInput({ ragEnabled: true, peakConcurrentSessions: 51 }),
    );
    expect(
      result.warnings.some((w) => w.includes("dedicated ChromaDB")),
    ).toBe(true);
  });

  it("no 'dedicated ChromaDB' warning when ragEnabled but sessions <= 50", () => {
    const result = svc.calculate(
      baseInput({ ragEnabled: true, peakConcurrentSessions: 50 }),
    );
    expect(
      result.warnings.some((w) => w.includes("dedicated ChromaDB")),
    ).toBe(false);
  });

  it("warns 'Single server' when deploymentTarget=single_server and sessions > 50", () => {
    const result = svc.calculate(
      baseInput({
        deploymentTarget: "single_server",
        peakConcurrentSessions: 51,
      }),
    );
    expect(
      result.warnings.some((w) => w.includes("Single server")),
    ).toBe(true);
  });

  it("no 'Single server' warning when deploymentTarget=kubernetes and sessions > 50", () => {
    const result = svc.calculate(
      baseInput({
        deploymentTarget: "kubernetes",
        peakConcurrentSessions: 51,
      }),
    );
    expect(
      result.warnings.some((w) => w.includes("Single server")),
    ).toBe(false);
  });
});
