/**
 * Canonical event schema for Voice Jib-Jab orchestrator
 */

export type EventSource =
  | "client"
  | "orchestrator"
  | "laneA"
  | "laneB"
  | "laneC"
  | "provider"
  | "retriever";

export interface BaseEvent {
  event_id: string;
  session_id: string;
  t_ms: number;
  source: EventSource;
  type: string;
  payload: unknown;
}

// Transcript Events
export interface TranscriptDeltaPayload {
  text: string;
  confidence: number;
  is_final: boolean;
  span_ms: { start: number; end: number };
}

export interface TranscriptEvent extends BaseEvent {
  type: "transcript.delta" | "transcript.final";
  payload: TranscriptDeltaPayload;
}

// Policy Events
export type PolicyDecision =
  | "allow"
  | "rewrite"
  | "refuse"
  | "escalate"
  | "cancel_output";

export type FallbackMode =
  | "auto"
  | "ask_clarifying_question"
  | "refuse_politely"
  | "switch_to_text_summary"
  | "escalate_to_human"
  | "offer_email_or_link";

export interface PolicyDecisionPayload {
  decision: PolicyDecision;
  reason_codes: string[];
  safe_rewrite?: string;
  required_disclaimer_id?: string;
  fallback_mode?: FallbackMode;
  severity: number;
}

export interface PolicyEvent extends BaseEvent {
  type: "policy.decision";
  source: "laneC";
  payload: PolicyDecisionPayload;
}

// Lane Arbitration Events
export type Lane = "none" | "A" | "B" | "fallback";
export type LaneTransitionCause =
  | "b_first_audio_ready"
  | "policy_cancel"
  | "user_barge_in"
  | "response_done"
  | "user_speech_ended";

export interface LaneOwnerChangePayload {
  from: Lane;
  to: Lane;
  cause: LaneTransitionCause;
}

export interface LaneBReadyPayload {
  latency_ms: number;
}

export interface LaneAReflexPayload {
  utterance: string;
}

export interface LaneOwnerChangedEvent extends BaseEvent {
  type: "lane.owner_changed";
  source: "orchestrator";
  payload: LaneOwnerChangePayload;
}

export interface LaneBReadyEvent extends BaseEvent {
  type: "lane.b_ready";
  source: "laneB";
  payload: LaneBReadyPayload;
}

export interface LaneAReflexEvent extends BaseEvent {
  type: "lane.a_reflex";
  source: "laneA";
  payload: LaneAReflexPayload;
}

// Legacy alias
export type LaneEvent = LaneOwnerChangedEvent;

// Audio Events
export interface AudioChunkPayload {
  chunk?: Buffer;
  data?: Buffer;
  format?: "pcm" | "opus";
  sample_rate?: number;
  sampleRate?: number;
  lane?: Lane;
  size?: number;
}

export interface AudioEvent extends BaseEvent {
  type: "audio.chunk" | "audio.start" | "audio.end";
  payload: AudioChunkPayload | { lane?: Lane };
}

// Response Metadata Events
export interface ResponseMetadataPayload {
  phase: "start" | "end";
  ttfb_ms?: number;
  total_ms?: number;
  voice_mode?: "push-to-talk" | "open-mic";
}

export interface ResponseMetadataEvent extends BaseEvent {
  type: "response.metadata";
  source: "laneB";
  payload: ResponseMetadataPayload;
}

// Tool Events
export interface ToolCallPayload {
  tool_name: string;
  args: Record<string, unknown>;
  call_id: string;
}

export interface ToolResultPayload {
  call_id: string;
  result: unknown;
  error?: string;
}

export interface ToolEvent extends BaseEvent {
  type: "tool.call" | "tool.result";
  payload: ToolCallPayload | ToolResultPayload;
}

// RAG Events
export interface RAGQueryPayload {
  query: string;
  top_k: number;
}

export interface RAGResultPayload {
  topic: string;
  facts: Array<{
    id: string;
    text: string;
    source: string;
    timestamp: string;
  }>;
  disclaimers: string[];
  citations?: Array<{
    id: string;
    source: string;
    timestamp: string;
    text?: string;
  }>;
}

export interface RAGEvent extends BaseEvent {
  type: "rag.query" | "rag.result";
  source: "laneB" | "retriever";
  payload: RAGQueryPayload | RAGResultPayload;
}

// Fallback Events (Orchestrator)
export interface FallbackEventPayload {
  mode: FallbackMode;
  decision?: PolicyDecision;
  reason_codes?: string[];
  utterance?: string;
  output?: "audio" | "text";
  status?: "started" | "completed";
  reason?: "done" | "stopped";
}

export interface FallbackEvent extends BaseEvent {
  type: "fallback.started" | "fallback.completed";
  source: "orchestrator";
  payload: FallbackEventPayload;
}

// Session Events
export interface SessionEvent extends BaseEvent {
  type: "session.start" | "session.end" | "session.error";
  source: "orchestrator";
  payload: Record<string, unknown>;
}

// User Events (barge-in, transcripts from speech recognition)
export interface UserTranscriptPayload {
  text: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

export interface UserTranscriptEvent extends BaseEvent {
  type: "transcript" | "user_transcript";
  payload: UserTranscriptPayload;
}

export interface UserBargeInEvent extends BaseEvent {
  type: "user.barge_in";
  source: "client";
  payload: Record<string, unknown>;
}

// Control / Audit Events (Lane C)
export interface ControlAuditPayload {
  evaluationId: string;
  role: "user" | "assistant";
  textSnippet: string;
  decision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  checksRun: string[];
  durationMs: number;
}

export interface ControlAuditEvent extends BaseEvent {
  type: "control.audit";
  source: "laneC";
  payload: ControlAuditPayload;
}

// Control / Override Events (Lane C)
export interface ControlOverridePayload {
  evaluationId: string;
  originalDecision: PolicyDecision;
  effectiveDecision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  cancelThreshold: number;
}

export interface ControlOverrideEvent extends BaseEvent {
  type: "control.override";
  source: "laneC";
  payload: ControlOverridePayload;
}

// Control / Metrics Events (Lane C)
export interface ControlMetricsPayload {
  evaluationCount: number;
  allowCount: number;
  rewriteCount: number;
  refuseCount: number;
  escalateCount: number;
  cancelCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

export interface ArbitratorAuditEvent extends BaseEvent {
  type: "arbitration.state.transition" | "arbitration.owner.transition";
  source: "orchestrator";
  payload: {
    from: string;
    to: string;
    trigger: string;
  };
}

export interface ControlMetricsEvent extends BaseEvent {
  type: "control.metrics";
  source: "laneC";
  payload: ControlMetricsPayload;
}

// Union type for all events
export type Event =
  | TranscriptEvent
  | PolicyEvent
  | LaneOwnerChangedEvent
  | LaneBReadyEvent
  | LaneAReflexEvent
  | AudioEvent
  | ResponseMetadataEvent
  | ToolEvent
  | RAGEvent
  | SessionEvent
  | UserTranscriptEvent
  | UserBargeInEvent
  | ControlAuditEvent
  | ControlOverrideEvent
  | ControlMetricsEvent
  | FallbackEvent
  | ArbitratorAuditEvent;
