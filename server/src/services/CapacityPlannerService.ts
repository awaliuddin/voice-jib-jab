/**
 * CapacityPlannerService
 *
 * Pure computation service for voice agent capacity planning.
 * Given call volume and session characteristics, produces a sizing
 * recommendation for hardware/cloud resources.
 *
 * Zero external I/O — fully synchronous.
 */

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/** Input parameters describing workload characteristics for capacity planning. */
export interface CapacityInput {
  /** Max simultaneous active calls */
  peakConcurrentSessions: number;
  /** Average call length in minutes */
  avgSessionDurationMinutes: number;
  /** Total calls per day */
  dailyCallVolume: number;

  /** Whether audio recordings are stored */
  recordingsEnabled: boolean;
  /** Days to retain recordings (0 = disabled) */
  recordingRetentionDays: number;

  /** ChromaDB embedding computation enabled */
  ragEnabled: boolean;
  sentimentAnalysisEnabled: boolean;
  policyEvaluationEnabled: boolean;

  /** Deployment topology */
  deploymentTarget: "single_server" | "docker" | "kubernetes";
}

/** Single resource line item with minimum and recommended sizing. */
export interface ResourceEstimate {
  component: string;
  reason: string;
  /** e.g. "2 vCPU", "4 GB RAM", "50 GB SSD" */
  minimum: string;
  recommended: string;
  /** true if this is a hard requirement */
  critical: boolean;
}

/** Breakdown of storage consumption per component. */
export interface StorageEstimate {
  component: string;
  perSessionMb: number;
  dailyGb: number;
  /** dailyGb * retentionDays */
  retentionGb: number;
  totalGb: number;
}

/** Full capacity recommendation with CPU, RAM, storage, network, and cost estimates. */
export interface CapacityRecommendation {
  input: CapacityInput;
  generatedAt: string;

  cpu: { minimumCores: number; recommendedCores: number; reasoning: string };
  ram: { minimumGb: number; recommendedGb: number; reasoning: string };
  storage: { minimumGb: number; recommendedGb: number; breakdown: StorageEstimate[] };
  network: { minimumMbps: number; recommendedMbps: number; reasoning: string };

  resources: ResourceEstimate[];

  /** Rough cloud estimate in USD */
  totalMonthlyCostEstimateUsd: { low: number; high: number };
  scalingNotes: string[];
  warnings: string[];

  /** Populated only when deploymentTarget === "kubernetes" */
  kubernetes?: {
    minReplicas: number;
    maxReplicas: number;
    /** e.g. "500m" */
    cpuRequestPerPod: string;
    cpuLimitPerPod: string;
    /** e.g. "512Mi" */
    memRequestPerPod: string;
    memLimitPerPod: string;
    hpaTargetCpuPct: number;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Pure computation service that produces infrastructure sizing recommendations. */
export class CapacityPlannerService {
  /**
   * Calculate a capacity recommendation for the given input.
   *
   * All formulas are deterministic — the same input always produces
   * the same recommendation (aside from generatedAt).
   */
  calculate(input: CapacityInput): CapacityRecommendation {
    const cpu = this.calculateCpu(input);
    const ram = this.calculateRam(input);
    const storage = this.calculateStorage(input);
    const network = this.calculateNetwork(input);
    const resources = this.buildResourceEstimates(input, cpu, ram, storage, network);
    const cost = this.estimateMonthlyCost(cpu, ram, storage);
    const warnings = this.buildWarnings(input);
    const scalingNotes = this.buildScalingNotes(input, cpu);
    const kubernetes =
      input.deploymentTarget === "kubernetes"
        ? this.buildKubernetesSpec(input)
        : undefined;

    return {
      input,
      generatedAt: new Date().toISOString(),
      cpu,
      ram,
      storage,
      network,
      resources,
      totalMonthlyCostEstimateUsd: cost,
      scalingNotes,
      warnings,
      ...(kubernetes !== undefined ? { kubernetes } : {}),
    };
  }

  // ── CPU ──────────────────────────────────────────────────────────────────

  private calculateCpu(input: CapacityInput): CapacityRecommendation["cpu"] {
    const sessions = input.peakConcurrentSessions;
    const sessionGroups = sessions / 10;

    let cores = sessionGroups * 1; // 1 core per 10 sessions
    if (input.sentimentAnalysisEnabled) cores += sessionGroups * 0.5;
    if (input.policyEvaluationEnabled) cores += sessionGroups * 0.5;
    if (input.ragEnabled) cores += 1;

    const minimumCores = Math.max(2, Math.ceil(cores));
    const recommendedCores = Math.ceil(minimumCores * 1.5);

    const parts: string[] = [
      `${sessionGroups.toFixed(1)} groups × 1 core/group = ${(sessionGroups).toFixed(1)} base cores`,
    ];
    if (input.sentimentAnalysisEnabled) parts.push(`+${(sessionGroups * 0.5).toFixed(1)} for sentiment analysis`);
    if (input.policyEvaluationEnabled) parts.push(`+${(sessionGroups * 0.5).toFixed(1)} for policy evaluation`);
    if (input.ragEnabled) parts.push("+1 for RAG embedding");

    return {
      minimumCores,
      recommendedCores,
      reasoning: parts.join("; ") + `; min floor=2, recommended=minimum×1.5`,
    };
  }

  // ── RAM ──────────────────────────────────────────────────────────────────

  private calculateRam(input: CapacityInput): CapacityRecommendation["ram"] {
    const sessions = input.peakConcurrentSessions;
    const sessionGroups = sessions / 10;

    // Per-session overhead (all in MB)
    let sessionMb = sessionGroups * 512; // 512 MB per 10 sessions
    if (input.ragEnabled) sessionMb += sessionGroups * 256;
    if (input.sentimentAnalysisEnabled) sessionMb += sessionGroups * 128;

    // Fixed overhead (MB)
    const chromaDb = input.ragEnabled ? 2048 : 0; // 2 GB
    const sqlite = 512;
    const nodejs = 1024; // 1 GB

    const totalMb = sessionMb + chromaDb + sqlite + nodejs;
    const minimumGb = Math.ceil(totalMb / 1024);
    const recommendedGb = Math.round(minimumGb * 1.5);

    const parts: string[] = [
      `${(sessionMb).toFixed(0)} MB session buffers`,
      "512 MB SQLite",
      "1 GB Node.js overhead",
    ];
    if (input.ragEnabled) parts.push("2 GB ChromaDB");

    return {
      minimumGb,
      recommendedGb,
      reasoning: parts.join(" + ") + `; recommended=minimum×1.5 rounded to nearest GB`,
    };
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  private calculateStorage(
    input: CapacityInput,
  ): CapacityRecommendation["storage"] {
    const breakdown: StorageEstimate[] = [];

    // Transcript: ~50 KB per session
    const transcriptPerSessionMb = 50 / 1024; // 0.0488 MB
    const transcriptDailyGb = (transcriptPerSessionMb * input.dailyCallVolume) / 1024;
    const transcriptRetentionGb = transcriptDailyGb * 365; // 1-year retention
    breakdown.push({
      component: "Transcripts",
      perSessionMb: transcriptPerSessionMb,
      dailyGb: transcriptDailyGb,
      retentionGb: transcriptRetentionGb,
      totalGb: transcriptRetentionGb,
    });

    // Audio recordings: PCM16 @ 24 kHz mono
    if (input.recordingsEnabled) {
      // bytes = duration_seconds * sample_rate * bytes_per_sample
      // = avgSessionDurationMinutes * 60 * 24000 * 2
      const audioPerSessionBytes =
        input.avgSessionDurationMinutes * 60 * 24000 * 2;
      const audioPerSessionMb = audioPerSessionBytes / 1024 / 1024;
      const audioDailyGb = (audioPerSessionMb * input.dailyCallVolume) / 1024;
      const audioRetentionGb = audioDailyGb * input.recordingRetentionDays;
      breakdown.push({
        component: "Audio Recordings",
        perSessionMb: audioPerSessionMb,
        dailyGb: audioDailyGb,
        retentionGb: audioRetentionGb,
        totalGb: audioRetentionGb,
      });
    }

    // Embeddings: ~5 KB per session
    if (input.ragEnabled) {
      const embPerSessionMb = 5 / 1024; // ~0.0049 MB
      const embDailyGb = (embPerSessionMb * input.dailyCallVolume) / 1024;
      const embRetentionGb = embDailyGb * 365;
      breakdown.push({
        component: "Embeddings (ChromaDB)",
        perSessionMb: embPerSessionMb,
        dailyGb: embDailyGb,
        retentionGb: embRetentionGb,
        totalGb: embRetentionGb,
      });
    }

    const totalGb = breakdown.reduce((sum, e) => sum + e.totalGb, 0);
    const minimumGb = Math.ceil(totalGb);
    const recommendedGb = Math.ceil(totalGb * 1.5);

    return { minimumGb, recommendedGb, breakdown };
  }

  // ── Network ───────────────────────────────────────────────────────────────

  private calculateNetwork(
    input: CapacityInput,
  ): CapacityRecommendation["network"] {
    // Audio: 24000 Hz × 16-bit = 384 kbps per session
    const kbpsPerSession = (24000 * 2 * 8) / 1000; // = 384 kbps
    const inboundMbps = (input.peakConcurrentSessions * kbpsPerSession) / 1000;
    const outboundMbps = inboundMbps; // symmetric
    const fixedMbps = 10; // API/control plane overhead

    const minimumMbps = inboundMbps + outboundMbps + fixedMbps;
    const recommendedMbps = minimumMbps * 1.5;

    return {
      minimumMbps: Math.ceil(minimumMbps),
      recommendedMbps: Math.ceil(recommendedMbps),
      reasoning:
        `${inboundMbps.toFixed(1)} Mbps inbound + ${outboundMbps.toFixed(1)} Mbps outbound (PCM16 @ 24kHz) + ${fixedMbps} Mbps API overhead; recommended=total×1.5`,
    };
  }

  // ── Resource estimates ────────────────────────────────────────────────────

  private buildResourceEstimates(
    input: CapacityInput,
    cpu: CapacityRecommendation["cpu"],
    ram: CapacityRecommendation["ram"],
    storage: CapacityRecommendation["storage"],
    network: CapacityRecommendation["network"],
  ): ResourceEstimate[] {
    const estimates: ResourceEstimate[] = [
      {
        component: "CPU",
        reason: "Voice stream processing and transcription",
        minimum: `${cpu.minimumCores} vCPU`,
        recommended: `${cpu.recommendedCores} vCPU`,
        critical: true,
      },
      {
        component: "RAM",
        reason: "Session state, audio buffers, and model caches",
        minimum: `${ram.minimumGb} GB RAM`,
        recommended: `${ram.recommendedGb} GB RAM`,
        critical: true,
      },
      {
        component: "Storage",
        reason: "Transcripts, recordings, and embeddings with retention",
        minimum: `${storage.minimumGb} GB SSD`,
        recommended: `${storage.recommendedGb} GB SSD`,
        critical: false,
      },
      {
        component: "Network",
        reason: "Real-time bidirectional audio (PCM16 @ 24kHz)",
        minimum: `${network.minimumMbps} Mbps`,
        recommended: `${network.recommendedMbps} Mbps`,
        critical: true,
      },
    ];

    if (input.ragEnabled) {
      estimates.push({
        component: "ChromaDB",
        reason: "Vector store for RAG-enabled sessions",
        minimum: "2 GB RAM dedicated + 10 GB SSD",
        recommended: "4 GB RAM dedicated + 50 GB SSD",
        critical: false,
      });
    }

    if (input.deploymentTarget === "kubernetes") {
      estimates.push({
        component: "Kubernetes Node Pool",
        reason: "HPA-managed pod scaling",
        minimum: `${Math.max(2, Math.ceil(input.peakConcurrentSessions / 20))} nodes`,
        recommended: `${Math.max(2, Math.ceil(input.peakConcurrentSessions / 20)) * 2} nodes`,
        critical: false,
      });
    }

    return estimates;
  }

  // ── Cost estimate ─────────────────────────────────────────────────────────

  private estimateMonthlyCost(
    cpu: CapacityRecommendation["cpu"],
    ram: CapacityRecommendation["ram"],
    storage: CapacityRecommendation["storage"],
  ): { low: number; high: number } {
    const hoursPerMonth = 730;
    const cpuCostPerVcpuHour = 0.048;
    const ramCostPerGbHour = 0.006;
    const storageCostPerGbMonth = 0.02;

    const lowCpu = cpu.minimumCores * cpuCostPerVcpuHour * hoursPerMonth;
    const lowRam = ram.minimumGb * ramCostPerGbHour * hoursPerMonth;
    const lowStorage = storage.minimumGb * storageCostPerGbMonth;

    const highCpu = cpu.recommendedCores * cpuCostPerVcpuHour * hoursPerMonth;
    const highRam = ram.recommendedGb * ramCostPerGbHour * hoursPerMonth;
    const highStorage = storage.recommendedGb * storageCostPerGbMonth;

    return {
      low: Math.round(lowCpu + lowRam + lowStorage),
      high: Math.round(highCpu + highRam + highStorage),
    };
  }

  // ── Kubernetes spec ───────────────────────────────────────────────────────

  private buildKubernetesSpec(
    input: CapacityInput,
  ): NonNullable<CapacityRecommendation["kubernetes"]> {
    const minReplicas = Math.max(
      2,
      Math.ceil(input.peakConcurrentSessions / 20),
    );
    const maxReplicas = minReplicas * 3;

    return {
      minReplicas,
      maxReplicas,
      cpuRequestPerPod: "500m",
      cpuLimitPerPod: "2000m",
      memRequestPerPod: "512Mi",
      memLimitPerPod: "2Gi",
      hpaTargetCpuPct: 70,
    };
  }

  // ── Warnings ──────────────────────────────────────────────────────────────

  private buildWarnings(input: CapacityInput): string[] {
    const warnings: string[] = [];

    if (input.peakConcurrentSessions > 100) {
      warnings.push("High concurrency — consider horizontal scaling");
    }

    if (input.recordingsEnabled && input.recordingRetentionDays > 90) {
      warnings.push("Long retention period will require significant storage");
    }

    if (input.ragEnabled && input.peakConcurrentSessions > 50) {
      warnings.push(
        "RAG embedding at high concurrency requires dedicated ChromaDB cluster",
      );
    }

    if (
      input.deploymentTarget === "single_server" &&
      input.peakConcurrentSessions > 50
    ) {
      warnings.push(
        "Single server not recommended above 50 concurrent sessions",
      );
    }

    return warnings;
  }

  // ── Scaling notes ─────────────────────────────────────────────────────────

  private buildScalingNotes(
    input: CapacityInput,
    cpu: CapacityRecommendation["cpu"],
  ): string[] {
    const notes: string[] = [];

    if (input.deploymentTarget === "kubernetes") {
      notes.push(
        "Kubernetes HPA will scale pods based on CPU utilisation (target 70%).",
      );
      notes.push(
        "Set resource requests/limits accurately to allow effective scheduling.",
      );
    }

    if (input.deploymentTarget === "docker") {
      notes.push(
        "Docker Compose deployments should pin CPU shares and memory limits per container.",
      );
    }

    if (cpu.recommendedCores >= 8) {
      notes.push(
        "Consider NUMA-aware deployment for systems with ≥8 cores to minimise latency.",
      );
    }

    if (input.ragEnabled) {
      notes.push(
        "ChromaDB persistence directory should be on a fast NVMe volume.",
      );
    }

    if (input.dailyCallVolume > 10000) {
      notes.push(
        "At >10 k calls/day, SQLite may become a bottleneck — evaluate PostgreSQL.",
      );
    }

    return notes;
  }
}
