/**
 * VoiceQualityScorer — grades a session 0-100 across 5 dimensions (20 pts each).
 *
 * Dimensions:
 *   1. policyCompliance  — % of policy decisions that are allow/rewrite
 *   2. sentimentTrajectory — based on dominant sentiment
 *   3. resolutionRate    — inverse of escalation count
 *   4. responseRelevance — engagement proxy based on turn count
 *   5. latencyAdherence  — average turn latency vs 400ms budget
 */

import type { SessionRecording } from "./SessionRecorder.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Score and rationale for a single quality dimension (0-20 points). */
export interface QualityDimension {
  name: string;
  score: number;   // 0-20
  weight: number;  // always 20
  rationale: string;
}

/** Complete session quality report with 5-dimension breakdown and letter grade. */
export interface QualityScorecard {
  sessionId: string;
  totalScore: number;  // 0-100
  grade: "A" | "B" | "C" | "D" | "F";  // A>=90, B>=80, C>=70, D>=60, F<60
  dimensions: {
    policyCompliance: QualityDimension;
    sentimentTrajectory: QualityDimension;
    resolutionRate: QualityDimension;
    responseRelevance: QualityDimension;
    latencyAdherence: QualityDimension;
  };
  thresholdBreached: boolean;  // totalScore < qualityThreshold
  computedAt: string;
}

/** Configuration for quality threshold and optional webhook alerting. */
export interface QualityScorerConfig {
  qualityThreshold: number;  // default 70
  webhookUrl?: string;       // POST here when threshold breached
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHT = 20;

function scorePolicyCompliance(policyDecisions: Record<string, number>): QualityDimension {
  const allow = policyDecisions.allow ?? 0;
  const rewrite = policyDecisions.rewrite ?? 0;
  const total = Object.values(policyDecisions).reduce((sum, n) => sum + n, 0);

  const score = total === 0
    ? DIMENSION_WEIGHT
    : Math.round(((allow + rewrite) / total) * DIMENSION_WEIGHT);

  const compliantCount = allow + rewrite;
  const rationale = total === 0
    ? `${compliantCount}/${total} decisions compliant`
    : `${compliantCount}/${total} decisions compliant`;

  return { name: "policyCompliance", score, weight: DIMENSION_WEIGHT, rationale };
}

function scoreSentimentTrajectory(
  sentiment: SessionRecording["summary"]["sentiment"],
): QualityDimension {
  const dominant = sentiment?.dominantSentiment;

  let score: number;
  switch (dominant) {
    case "positive":   score = 20; break;
    case "neutral":    score = 15; break;
    case "negative":   score = 8;  break;
    case "frustrated": score = 0;  break;
    default:           score = 10; break;
  }

  const rationale = `Dominant sentiment: ${dominant ?? "unknown"}`;
  return { name: "sentimentTrajectory", score, weight: DIMENSION_WEIGHT, rationale };
}

function scoreResolutionRate(policyDecisions: Record<string, number>): QualityDimension {
  const escalateCount = policyDecisions.escalate ?? 0;

  let score: number;
  if (escalateCount === 0)      score = 20;
  else if (escalateCount === 1) score = 12;
  else if (escalateCount === 2) score = 6;
  else                          score = 0;

  const rationale = `${escalateCount} escalation(s) detected`;
  return { name: "resolutionRate", score, weight: DIMENSION_WEIGHT, rationale };
}

function scoreResponseRelevance(turnCount: number): QualityDimension {
  let score: number;
  if (turnCount >= 5)      score = 20;
  else if (turnCount >= 3) score = 15;
  else if (turnCount === 2) score = 10;
  else if (turnCount === 1) score = 5;
  else                      score = 0;

  const rationale = `${turnCount} conversation turns`;
  return { name: "responseRelevance", score, weight: DIMENSION_WEIGHT, rationale };
}

function scoreLatencyAdherence(durationMs: number | null, turnCount: number): QualityDimension {
  const effectiveTurns = turnCount === 0 ? 1 : turnCount;
  const effectiveDuration = durationMs ?? 0;
  const avgTurnMs = effectiveDuration / effectiveTurns;

  let score: number;
  if (avgTurnMs < 400)       score = 20;
  else if (avgTurnMs < 600)  score = 16;
  else if (avgTurnMs < 800)  score = 12;
  else if (avgTurnMs < 1200) score = 8;
  else                       score = 4;

  const rationale = `Avg turn latency: ${Math.round(avgTurnMs)}ms`;
  return { name: "latencyAdherence", score, weight: DIMENSION_WEIGHT, rationale };
}

function computeGrade(totalScore: number): "A" | "B" | "C" | "D" | "F" {
  if (totalScore >= 90) return "A";
  if (totalScore >= 80) return "B";
  if (totalScore >= 70) return "C";
  if (totalScore >= 60) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// VoiceQualityScorer
// ---------------------------------------------------------------------------

/** Grades sessions 0-100 across 5 quality dimensions with optional webhook alerts. */
export class VoiceQualityScorer {
  constructor(public config: QualityScorerConfig = { qualityThreshold: 70 }) {}

  /**
   * Grade a session recording across 5 quality dimensions.
   *
   * @param sessionId - The session identifier
   * @param recording - The full session recording
   * @returns A complete QualityScorecard (0-100 total, A-F grade)
   */
  score(sessionId: string, recording: SessionRecording): QualityScorecard {
    const policyDecisions = recording.summary.policyDecisions;
    const turnCount = recording.summary.turnCount;

    const policyCompliance = scorePolicyCompliance(policyDecisions);
    const sentimentTrajectory = scoreSentimentTrajectory(recording.summary.sentiment);
    const resolutionRate = scoreResolutionRate(policyDecisions);
    const responseRelevance = scoreResponseRelevance(turnCount);
    const latencyAdherence = scoreLatencyAdherence(recording.durationMs, turnCount);

    const totalScore =
      policyCompliance.score +
      sentimentTrajectory.score +
      resolutionRate.score +
      responseRelevance.score +
      latencyAdherence.score;

    const grade = computeGrade(totalScore);
    const thresholdBreached = totalScore < this.config.qualityThreshold;

    return {
      sessionId,
      totalScore,
      grade,
      dimensions: {
        policyCompliance,
        sentimentTrajectory,
        resolutionRate,
        responseRelevance,
        latencyAdherence,
      },
      thresholdBreached,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Fire-and-forget POST to webhookUrl when threshold is breached.
   * Errors are caught and swallowed — this must never throw.
   *
   * @param scorecard - The scorecard to send as webhook payload
   */
  async notifyWebhook(scorecard: QualityScorecard): Promise<void> {
    if (!this.config.webhookUrl || !scorecard.thresholdBreached) {
      return;
    }

    try {
      await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scorecard }),
      });
    } catch {
      // Fire-and-forget: swallow all errors
    }
  }
}
