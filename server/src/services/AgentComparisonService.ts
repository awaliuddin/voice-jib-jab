/**
 * AgentComparisonService — compares two agent configurations side-by-side.
 *
 * Given two sets of session IDs (one per config), loads recordings from
 * SessionRecorder, grades each session via VoiceQualityScorer, and produces a
 * structured ComparisonReport with per-metric winners and an overall
 * recommendation.
 *
 * Reports are stored in memory only — no persistence.
 */

import { v4 as uuidv4 } from "uuid";
import type { SessionRecorder } from "./SessionRecorder.js";
import type { VoiceQualityScorer } from "./VoiceQualityScorer.js";

// ── Public types ──────────────────────────────────────────────────────────

/** Identifies one side of an A/B comparison with its associated sessions. */
export interface ComparisonConfig {
  /** Identifier for the config (e.g. "gpt-4o-mini", "persona-A") */
  configId: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** Session IDs that used this config */
  sessionIds: string[];
}

/** Aggregated quality, latency, and sentiment metrics for one agent configuration. */
export interface ConfigMetrics {
  configId: string;
  label: string;
  sessionCount: number;
  /** Average VoiceQualityScorer totalScore across all sessions (0–100) */
  avgQualityScore: number;
  /** 50th-percentile session durationMs used as latency proxy */
  p50LatencyMs: number;
  /** 95th-percentile session durationMs */
  p95LatencyMs: number;
  /** % of sessions that had at least one escalate policy decision */
  escalationRatePct: number;
  /** Most frequently observed dominant sentiment across sessions */
  topSentiment: string;
  /** Count of each dominant sentiment observed */
  sentimentBreakdown: Record<string, number>;
  /** Average turn count across sessions */
  avgTurnCount: number;
}

/** Side-by-side comparison report with per-metric winners and overall recommendation. */
export interface ComparisonReport {
  reportId: string;
  generatedAt: string;
  configA: ConfigMetrics;
  configB: ConfigMetrics;
  /** "A" | "B" | "tie" | "insufficient_data" */
  recommendation: string;
  /** Human-readable explanation of the recommendation */
  reasoning: string;
  metricWinners: {
    quality: "A" | "B" | "tie";
    latency: "A" | "B" | "tie";
    escalation: "A" | "B" | "tie";
    sentiment: "A" | "B" | "tie";
  };
}

// ── Sentiment ordering for comparison ────────────────────────────────────

/**
 * Higher rank = better sentiment.
 * positive > neutral > frustrated > negative
 */
const SENTIMENT_RANK: Record<string, number> = {
  positive: 4,
  neutral: 3,
  frustrated: 2,
  negative: 1,
};

function sentimentRank(sentiment: string): number {
  return SENTIMENT_RANK[sentiment] ?? 0;
}

// ── Percentile helper ─────────────────────────────────────────────────────

/**
 * Compute the p-th percentile (0–100) of a sorted array of numbers.
 * Returns 0 for an empty array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ── Metrics computation ───────────────────────────────────────────────────

/**
 * Build ConfigMetrics by loading recordings for each sessionId and scoring them.
 *
 * Sessions whose recordings cannot be loaded are silently skipped so that a
 * single missing file does not abort the entire comparison.
 */
function computeMetrics(
  config: ComparisonConfig,
  recorder: SessionRecorder,
  scorer: VoiceQualityScorer,
): ConfigMetrics {
  const qualityScores: number[] = [];
  const durations: number[] = [];
  const turnCounts: number[] = [];
  const sentimentCounts: Record<string, number> = {};
  let escalatedSessions = 0;
  let loadedSessions = 0;

  for (const sessionId of config.sessionIds) {
    const recording = recorder.loadRecording(sessionId);
    if (!recording) {
      // Skip sessions whose recordings are unavailable
      continue;
    }

    loadedSessions++;

    // Quality score
    const scorecard = scorer.score(sessionId, recording);
    qualityScores.push(scorecard.totalScore);

    // Duration (latency proxy)
    if (recording.durationMs !== null) {
      durations.push(recording.durationMs);
    }

    // Turn count
    turnCounts.push(recording.summary.turnCount);

    // Escalation: any policy.decision with decision="escalate"
    const escalateCount = recording.summary.policyDecisions.escalate ?? 0;
    if (escalateCount > 0) {
      escalatedSessions++;
    }

    // Sentiment
    const dominant = recording.summary.sentiment?.dominantSentiment;
    if (dominant) {
      sentimentCounts[dominant] = (sentimentCounts[dominant] ?? 0) + 1;
    }
  }

  // Sort durations for percentile calculation
  const sortedDurations = [...durations].sort((a, b) => a - b);

  const avgQualityScore =
    qualityScores.length > 0
      ? qualityScores.reduce((s, v) => s + v, 0) / qualityScores.length
      : 0;

  const p50LatencyMs = percentile(sortedDurations, 50);
  const p95LatencyMs = percentile(sortedDurations, 95);

  const escalationRatePct =
    loadedSessions > 0 ? (escalatedSessions / loadedSessions) * 100 : 0;

  const avgTurnCount =
    turnCounts.length > 0
      ? turnCounts.reduce((s, v) => s + v, 0) / turnCounts.length
      : 0;

  // Top sentiment: most frequently observed dominant sentiment
  let topSentiment = "unknown";
  let topCount = 0;
  for (const [sentiment, count] of Object.entries(sentimentCounts)) {
    if (count > topCount) {
      topCount = count;
      topSentiment = sentiment;
    }
  }

  return {
    configId: config.configId,
    label: config.label,
    sessionCount: loadedSessions,
    avgQualityScore,
    p50LatencyMs,
    p95LatencyMs,
    escalationRatePct,
    topSentiment,
    sentimentBreakdown: { ...sentimentCounts },
    avgTurnCount,
  };
}

// ── Winner comparison helpers ─────────────────────────────────────────────

function compareQuality(a: ConfigMetrics, b: ConfigMetrics): "A" | "B" | "tie" {
  if (a.avgQualityScore > b.avgQualityScore) return "A";
  if (b.avgQualityScore > a.avgQualityScore) return "B";
  return "tie";
}

function compareLatency(a: ConfigMetrics, b: ConfigMetrics): "A" | "B" | "tie" {
  // Lower is better
  if (a.p50LatencyMs < b.p50LatencyMs) return "A";
  if (b.p50LatencyMs < a.p50LatencyMs) return "B";
  return "tie";
}

function compareEscalation(a: ConfigMetrics, b: ConfigMetrics): "A" | "B" | "tie" {
  // Lower is better
  if (a.escalationRatePct < b.escalationRatePct) return "A";
  if (b.escalationRatePct < a.escalationRatePct) return "B";
  return "tie";
}

function compareSentiment(a: ConfigMetrics, b: ConfigMetrics): "A" | "B" | "tie" {
  const rankA = sentimentRank(a.topSentiment);
  const rankB = sentimentRank(b.topSentiment);
  if (rankA > rankB) return "A";
  if (rankB > rankA) return "B";
  return "tie";
}

// ── AgentComparisonService ────────────────────────────────────────────────

export class AgentComparisonService {
  private reports: ComparisonReport[] = [];

  constructor(
    private recorder: SessionRecorder,
    private qualityScorer: VoiceQualityScorer,
  ) {}

  /**
   * Compare two agent configurations and produce a ComparisonReport.
   *
   * If either config has fewer than 2 loaded sessions the recommendation is
   * "insufficient_data". Otherwise the 4 metric winners are tallied and the
   * config winning ≥ 3 metrics wins; otherwise the result is "tie".
   *
   * The report is stored in memory and returned.
   *
   * @param configA - First configuration with session IDs
   * @param configB - Second configuration with session IDs
   * @returns Full ComparisonReport
   */
  async compareConfigs(
    configA: ComparisonConfig,
    configB: ComparisonConfig,
  ): Promise<ComparisonReport> {
    const metricsA = computeMetrics(configA, this.recorder, this.qualityScorer);
    const metricsB = computeMetrics(configB, this.recorder, this.qualityScorer);

    const qualityWinner = compareQuality(metricsA, metricsB);
    const latencyWinner = compareLatency(metricsA, metricsB);
    const escalationWinner = compareEscalation(metricsA, metricsB);
    const sentimentWinner = compareSentiment(metricsA, metricsB);

    const metricWinners = {
      quality: qualityWinner,
      latency: latencyWinner,
      escalation: escalationWinner,
      sentiment: sentimentWinner,
    };

    let recommendation: string;
    let reasoning: string;

    if (metricsA.sessionCount < 2 || metricsB.sessionCount < 2) {
      recommendation = "insufficient_data";
      reasoning = `Insufficient data — need at least 2 sessions per config (${configA.label}: ${metricsA.sessionCount}, ${configB.label}: ${metricsB.sessionCount}).`;
    } else {
      const winners = Object.values(metricWinners);
      const aWins = winners.filter((w) => w === "A").length;
      const bWins = winners.filter((w) => w === "B").length;

      if (aWins >= 3) {
        recommendation = "A";
        reasoning = `${configA.label} wins ${aWins}/4 metrics (quality: ${qualityWinner}, latency: ${latencyWinner}, escalation: ${escalationWinner}, sentiment: ${sentimentWinner}).`;
      } else if (bWins >= 3) {
        recommendation = "B";
        reasoning = `${configB.label} wins ${bWins}/4 metrics (quality: ${qualityWinner}, latency: ${latencyWinner}, escalation: ${escalationWinner}, sentiment: ${sentimentWinner}).`;
      } else {
        recommendation = "tie";
        reasoning = `No clear winner — ${configA.label} wins ${aWins} metric(s), ${configB.label} wins ${bWins} metric(s) out of 4.`;
      }
    }

    const report: ComparisonReport = {
      reportId: uuidv4(),
      generatedAt: new Date().toISOString(),
      configA: metricsA,
      configB: metricsB,
      recommendation,
      reasoning,
      metricWinners,
    };

    this.reports.push(report);
    return report;
  }

  /**
   * Return the most recently generated report matching both config IDs.
   *
   * Returns undefined if no matching report exists.
   *
   * @param configAId - configId of the first config
   * @param configBId - configId of the second config
   * @returns Most recent matching ComparisonReport or undefined
   */
  async getRecentReport(configAId: string, configBId: string): Promise<ComparisonReport | undefined> {
    // Walk backwards (most recent last) to find the latest match
    for (let i = this.reports.length - 1; i >= 0; i--) {
      const r = this.reports[i];
      if (r.configA.configId === configAId && r.configB.configId === configBId) {
        return r;
      }
    }
    return undefined;
  }

  /**
   * List all generated comparison reports in generation order (oldest first).
   *
   * @returns Array of all ComparisonReports
   */
  listReports(): ComparisonReport[] {
    return [...this.reports];
  }
}
