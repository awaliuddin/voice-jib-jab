/**
 * ConversationAnalyticsService — offline analytics over recorded sessions.
 *
 * Clusters transcripts into topics using keyword-seed overlap scoring,
 * extracts frequent questions, maps resolution paths, and measures handle
 * time per topic — all from existing SessionRecorder data with no external
 * ML dependency.
 */

import type { SessionRecorder, SessionRecording, RecordingEntry } from "./SessionRecorder.js";

// ── Stop words (same set as LiveKbSearchService) ──────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "i", "we", "you", "it",
  "to", "of", "in", "on", "at", "for", "with", "my", "your", "our",
  "can", "do", "does", "did", "have", "has", "had", "be", "been",
  "will", "would", "could", "should", "what", "how", "when", "where",
  "why", "who",
]);

// ── Topic seeds ───────────────────────────────────────────────────────────────

const TOPIC_SEEDS: Record<string, string[]> = {
  billing: ["bill", "charge", "payment", "invoice", "refund", "cost", "price", "fee"],
  technical: ["error", "issue", "problem", "broken", "fix", "bug", "crash", "not working"],
  account: ["account", "login", "password", "access", "profile", "username"],
  scheduling: ["appointment", "schedule", "book", "cancel", "reschedule", "date", "time"],
  shipping: ["ship", "delivery", "track", "order", "package", "arrive", "return"],
  general_inquiry: [],
};

// ── Public types ──────────────────────────────────────────────────────────────

export interface TopicCluster {
  topicId: string;
  label: string;
  keywords: string[];
  sessionCount: number;
  avgHandleTimeMs: number;
  escalationRate: number;
  resolutionRate: number;
  sentimentBreakdown: Record<string, number>;
}

export interface FrequentQuestion {
  text: string;
  normalizedText: string;
  occurrences: number;
  topicLabel?: string;
  avgHandleTimeMs: number;
  escalationRate: number;
}

export interface ResolutionPath {
  pathId: string;
  steps: string[];
  occurrences: number;
  avgHandleTimeMs: number;
  outcomeLabel: "resolved" | "escalated" | "refused" | "abandoned";
}

export interface HandleTimeByTopic {
  topicLabel: string;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  sampleCount: number;
}

export interface ConversationInsights {
  generatedAt: string;
  tenantId?: string;
  sessionCount: number;
  dateRange: { from: string; to: string };
  topicClusters: TopicCluster[];
  frequentQuestions: FrequentQuestion[];
  resolutionPaths: ResolutionPath[];
  handleTimeByTopic: HandleTimeByTopic[];
  overallStats: {
    avgHandleTimeMs: number;
    p50HandleTimeMs: number;
    p95HandleTimeMs: number;
    overallEscalationRate: number;
    overallResolutionRate: number;
    totalUserTurns: number;
  };
}

export interface AnalyticsOptions {
  tenantId?: string;
  from?: string;
  to?: string;
  maxSessions?: number;
}

// ── ConversationAnalyticsService ──────────────────────────────────────────────

export class ConversationAnalyticsService {
  constructor(private recorder: SessionRecorder) {}

  /**
   * Generate a full ConversationInsights report from existing session recordings.
   *
   * Topics are assigned by keyword-seed overlap. FAQs are grouped by normalized
   * text. Resolution paths are compact event-type sequences. All computation is
   * deterministic — no random values, no mocked outputs.
   */
  async generateInsights(opts: AnalyticsOptions = {}): Promise<ConversationInsights> {
    const { tenantId, from, to, maxSessions = 500 } = opts;

    // ── 1. Load sessions ──────────────────────────────────────────────────────

    let metas = this.recorder.listRecordings();

    // Filter by tenantId
    if (tenantId !== undefined) {
      metas = metas.filter((m) => m.tenantId === tenantId);
    }

    // Filter by date range
    if (from !== undefined) {
      const fromMs = new Date(from).getTime();
      metas = metas.filter((m) => new Date(m.startedAt).getTime() >= fromMs);
    }
    if (to !== undefined) {
      const toMs = new Date(to).getTime();
      metas = metas.filter((m) => new Date(m.startedAt).getTime() <= toMs);
    }

    // Cap at maxSessions (list is sorted desc, take the most recent N)
    const capped = metas.slice(0, maxSessions);

    // Load full recordings (timeline needed for transcript extraction)
    const recordings: SessionRecording[] = [];
    for (const meta of capped) {
      const rec = this.recorder.loadRecording(meta.sessionId);
      if (rec !== null) {
        recordings.push(rec);
      }
    }

    // ── 2. Determine date range from loaded sessions ───────────────────────────

    const dateRange = computeDateRange(recordings, from, to);

    // ── 3. Empty case ─────────────────────────────────────────────────────────

    if (recordings.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        tenantId,
        sessionCount: 0,
        dateRange,
        topicClusters: [],
        frequentQuestions: [],
        resolutionPaths: [],
        handleTimeByTopic: [],
        overallStats: {
          avgHandleTimeMs: 0,
          p50HandleTimeMs: 0,
          p95HandleTimeMs: 0,
          overallEscalationRate: 0,
          overallResolutionRate: 0,
          totalUserTurns: 0,
        },
      };
    }

    // ── 4. Classify sessions by topic ─────────────────────────────────────────

    const sessionTopicMap = new Map<string, string>();
    for (const rec of recordings) {
      const userText = extractUserText(rec.timeline);
      const tokens = tokenize(userText);
      const topic = assignTopic(tokens);
      sessionTopicMap.set(rec.sessionId, topic);
    }

    // ── 5. Build topic clusters ───────────────────────────────────────────────

    const topicClusters = buildTopicClusters(recordings, sessionTopicMap);

    // ── 6. FAQ extraction ─────────────────────────────────────────────────────

    const frequentQuestions = extractFAQs(recordings, sessionTopicMap, recordings.length);

    // ── 7. Resolution paths ───────────────────────────────────────────────────

    const resolutionPaths = buildResolutionPaths(recordings);

    // ── 8. Handle time by topic ───────────────────────────────────────────────

    const handleTimeByTopic = buildHandleTimeByTopic(recordings, sessionTopicMap);

    // ── 9. Overall stats ──────────────────────────────────────────────────────

    const overallStats = computeOverallStats(recordings);

    return {
      generatedAt: new Date().toISOString(),
      tenantId,
      sessionCount: recordings.length,
      dateRange,
      topicClusters,
      frequentQuestions,
      resolutionPaths,
      handleTimeByTopic,
      overallStats,
    };
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Tokenize text: lowercase, strip punctuation, remove stop words.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/**
 * Extract all user final-transcript text from a session timeline.
 */
function extractUserText(timeline: RecordingEntry[]): string {
  return timeline
    .filter((e) => e.type === "user_transcript" && (e.payload as Record<string, unknown>)?.isFinal === true)
    .map((e) => String((e.payload as Record<string, unknown>)?.text ?? ""))
    .join(" ");
}

/**
 * Assign a session to a topic based on keyword-seed overlap.
 * A token matches a seed if the token equals the seed or starts with the seed
 * (e.g. "billing" matches seed "bill", "payment" matches seed "payment").
 * Returns the topic label with the most token matches, or "general_inquiry".
 */
function assignTopic(tokens: Set<string> | string[]): string {
  const tokenArr = tokens instanceof Set ? Array.from(tokens) : tokens;

  let bestTopic = "general_inquiry";
  let bestCount = 0;

  for (const [topic, seeds] of Object.entries(TOPIC_SEEDS)) {
    if (seeds.length === 0) continue;
    let count = 0;
    for (const seed of seeds) {
      const matched = tokenArr.some((t) => t === seed || t.startsWith(seed));
      if (matched) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestTopic = topic;
    }
  }

  return bestTopic;
}

/**
 * Build topic clusters with per-cluster statistics.
 */
function buildTopicClusters(
  recordings: SessionRecording[],
  sessionTopicMap: Map<string, string>,
): TopicCluster[] {
  // Group sessions by topic
  const groups = new Map<string, SessionRecording[]>();

  // Ensure all known topics have an entry, even if empty
  for (const topic of Object.keys(TOPIC_SEEDS)) {
    groups.set(topic, []);
  }

  for (const rec of recordings) {
    const topic = sessionTopicMap.get(rec.sessionId) ?? "general_inquiry";
    const list = groups.get(topic);
    if (list !== undefined) {
      list.push(rec);
    }
  }

  const clusters: TopicCluster[] = [];

  for (const [topicId, recs] of groups.entries()) {
    if (recs.length === 0 && topicId !== "general_inquiry") {
      // Only emit clusters that have sessions, except general_inquiry (always emitted if has sessions)
      // Actually emit all non-empty clusters
      continue;
    }
    if (recs.length === 0) {
      continue;
    }

    const sessionCount = recs.length;

    // avgHandleTimeMs — sessions with durationMs only
    const durationsMs = recs.filter((r) => r.durationMs !== null).map((r) => r.durationMs as number);
    const avgHandleTimeMs = durationsMs.length > 0 ? mean(durationsMs) : 0;

    // escalationRate: sessions where policyDecisions.escalate > 0
    const escalatedCount = recs.filter((r) => (r.summary.policyDecisions.escalate ?? 0) > 0).length;
    const escalationRate = sessionCount > 0 ? escalatedCount / sessionCount : 0;

    // resolutionRate: sessions without escalation (no escalation = resolved)
    const resolutionRate = 1 - escalationRate;

    // sentimentBreakdown
    const sentimentBreakdown: Record<string, number> = {};
    for (const rec of recs) {
      const dominant = rec.summary.sentiment?.dominantSentiment;
      if (dominant) {
        sentimentBreakdown[dominant] = (sentimentBreakdown[dominant] ?? 0) + 1;
      }
    }

    clusters.push({
      topicId,
      label: topicId,
      keywords: TOPIC_SEEDS[topicId] ?? [],
      sessionCount,
      avgHandleTimeMs,
      escalationRate,
      resolutionRate,
      sentimentBreakdown,
    });
  }

  // Sort by sessionCount desc for stable output
  clusters.sort((a, b) => b.sessionCount - a.sessionCount);

  return clusters;
}

/**
 * Extract frequently asked questions from user utterances.
 * Groups by normalized text; threshold is occurrences >= 2 unless totalSessions < 10.
 */
function extractFAQs(
  recordings: SessionRecording[],
  sessionTopicMap: Map<string, string>,
  totalSessions: number,
): FrequentQuestion[] {
  const threshold = totalSessions < 10 ? 1 : 2;

  // Map from normalizedText -> { original, sessionIds, durationsMs, escalateCount }
  const groups = new Map<string, {
    text: string;
    sessionIds: string[];
    durationsMs: number[];
    escalateCount: number;
  }>();

  for (const rec of recordings) {
    const userTurns = rec.timeline.filter(
      (e) =>
        e.type === "user_transcript" &&
        (e.payload as Record<string, unknown>)?.isFinal === true,
    );

    for (const entry of userTurns) {
      const raw = String((entry.payload as Record<string, unknown>)?.text ?? "").trim();
      if (!raw) continue;

      const normalized = normalizeText(raw);
      if (!normalized) continue;

      const existing = groups.get(normalized);
      if (existing) {
        existing.sessionIds.push(rec.sessionId);
        if (rec.durationMs !== null) existing.durationsMs.push(rec.durationMs);
        if ((rec.summary.policyDecisions.escalate ?? 0) > 0) existing.escalateCount++;
      } else {
        groups.set(normalized, {
          text: raw,
          sessionIds: [rec.sessionId],
          durationsMs: rec.durationMs !== null ? [rec.durationMs] : [],
          escalateCount: (rec.summary.policyDecisions.escalate ?? 0) > 0 ? 1 : 0,
        });
      }
    }
  }

  const faqs: FrequentQuestion[] = [];

  for (const [normalizedText, data] of groups.entries()) {
    if (data.sessionIds.length < threshold) continue;

    const occurrences = data.sessionIds.length;
    const avgHandleTimeMs = data.durationsMs.length > 0 ? mean(data.durationsMs) : 0;
    const escalationRate = occurrences > 0 ? data.escalateCount / occurrences : 0;

    // Determine topic from the most recent session occurrence
    const lastSessionId = data.sessionIds[data.sessionIds.length - 1];
    const topicLabel = sessionTopicMap.get(lastSessionId);

    faqs.push({
      text: data.text,
      normalizedText,
      occurrences,
      topicLabel,
      avgHandleTimeMs,
      escalationRate,
    });
  }

  // Sort by occurrences desc
  faqs.sort((a, b) => b.occurrences - a.occurrences);

  return faqs.slice(0, 20);
}

/**
 * Build compact resolution path sequences, group by identical path string.
 */
function buildResolutionPaths(recordings: SessionRecording[]): ResolutionPath[] {
  const pathGroups = new Map<string, {
    steps: string[];
    sessionIds: string[];
    durationsMs: number[];
  }>();

  for (const rec of recordings) {
    const steps = buildPathSteps(rec.timeline);
    const pathKey = steps.join("|");

    const existing = pathGroups.get(pathKey);
    if (existing) {
      existing.sessionIds.push(rec.sessionId);
      if (rec.durationMs !== null) existing.durationsMs.push(rec.durationMs);
    } else {
      pathGroups.set(pathKey, {
        steps,
        sessionIds: [rec.sessionId],
        durationsMs: rec.durationMs !== null ? [rec.durationMs] : [],
      });
    }
  }

  // Sort by occurrence count desc, take top 10
  const sorted = Array.from(pathGroups.entries()).sort(
    ([, a], [, b]) => b.sessionIds.length - a.sessionIds.length,
  );

  const paths: ResolutionPath[] = sorted.slice(0, 10).map(([pathKey, data]) => {
    const occurrences = data.sessionIds.length;
    const avgHandleTimeMs = data.durationsMs.length > 0 ? mean(data.durationsMs) : 0;
    const outcomeLabel = classifyOutcome(data.steps);

    return {
      pathId: pathKey,
      steps: data.steps,
      occurrences,
      avgHandleTimeMs,
      outcomeLabel,
    };
  });

  return paths;
}

/**
 * Build a compact step sequence from a session timeline (max 10 steps).
 */
function buildPathSteps(timeline: RecordingEntry[]): string[] {
  const steps: string[] = [];

  for (const entry of timeline) {
    if (steps.length >= 10) break;

    let step: string | null = null;

    if (entry.type === "user_transcript") {
      const p = entry.payload as Record<string, unknown> | undefined;
      if (p?.isFinal) step = "user";
    } else if (entry.type === "transcript" || entry.type === "transcript.final") {
      const p = entry.payload as Record<string, unknown> | undefined;
      if (p?.isFinal) step = "agent";
    } else if (entry.type === "policy.decision") {
      const p = entry.payload as Record<string, unknown> | undefined;
      const decision = String(p?.decision ?? "unknown");
      step = `policy:${decision}`;
    } else if (entry.type === "session.end") {
      step = "end";
    }

    if (step !== null) {
      steps.push(step);
    }
  }

  return steps;
}

/**
 * Classify a path's outcome label from its steps.
 */
function classifyOutcome(steps: string[]): ResolutionPath["outcomeLabel"] {
  for (const step of steps) {
    if (step.includes("escalate")) return "escalated";
  }
  for (const step of steps) {
    if (step.includes("refuse")) return "refused";
  }
  return "resolved";
}

/**
 * Build handle-time stats per topic.
 */
function buildHandleTimeByTopic(
  recordings: SessionRecording[],
  sessionTopicMap: Map<string, string>,
): HandleTimeByTopic[] {
  const topicDurations = new Map<string, number[]>();

  for (const rec of recordings) {
    if (rec.durationMs === null) continue;
    const topic = sessionTopicMap.get(rec.sessionId) ?? "general_inquiry";
    const list = topicDurations.get(topic);
    if (list !== undefined) {
      list.push(rec.durationMs);
    } else {
      topicDurations.set(topic, [rec.durationMs]);
    }
  }

  const result: HandleTimeByTopic[] = [];

  for (const [topicLabel, durations] of topicDurations.entries()) {
    if (durations.length === 0) continue;
    result.push({
      topicLabel,
      avgMs: mean(durations),
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      sampleCount: durations.length,
    });
  }

  result.sort((a, b) => b.sampleCount - a.sampleCount);

  return result;
}

/**
 * Compute overall stats across all sessions.
 */
function computeOverallStats(recordings: SessionRecording[]): ConversationInsights["overallStats"] {
  const durations = recordings
    .filter((r) => r.durationMs !== null)
    .map((r) => r.durationMs as number);

  const avgHandleTimeMs = durations.length > 0 ? mean(durations) : 0;
  const p50HandleTimeMs = durations.length > 0 ? percentile(durations, 50) : 0;
  const p95HandleTimeMs = durations.length > 0 ? percentile(durations, 95) : 0;

  const escalatedCount = recordings.filter(
    (r) => (r.summary.policyDecisions.escalate ?? 0) > 0,
  ).length;
  const overallEscalationRate = recordings.length > 0 ? escalatedCount / recordings.length : 0;
  const overallResolutionRate = 1 - overallEscalationRate;

  const totalUserTurns = recordings.reduce((sum, r) => {
    const userFinalCount = r.timeline.filter(
      (e) =>
        e.type === "user_transcript" &&
        (e.payload as Record<string, unknown>)?.isFinal === true,
    ).length;
    return sum + userFinalCount;
  }, 0);

  return {
    avgHandleTimeMs,
    p50HandleTimeMs,
    p95HandleTimeMs,
    overallEscalationRate,
    overallResolutionRate,
    totalUserTurns,
  };
}

/**
 * Compute the date range from loaded recordings (falling back to filter values).
 */
function computeDateRange(
  recordings: SessionRecording[],
  from: string | undefined,
  to: string | undefined,
): { from: string; to: string } {
  if (recordings.length === 0) {
    return {
      from: from ?? new Date().toISOString(),
      to: to ?? new Date().toISOString(),
    };
  }

  const dates = recordings.map((r) => new Date(r.startedAt).getTime());
  const minDate = new Date(Math.min(...dates)).toISOString();
  const maxDate = new Date(Math.max(...dates)).toISOString();

  return { from: minDate, to: maxDate };
}

/**
 * Normalize text for FAQ grouping: lowercase + stop-word removal.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .join(" ");
}

/**
 * Arithmetic mean of an array of numbers.
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Index-based percentile (p50 = floor(n * 0.5), p95 = floor(n * 0.95)).
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * (p / 100));
  return sorted[Math.min(idx, sorted.length - 1)];
}
