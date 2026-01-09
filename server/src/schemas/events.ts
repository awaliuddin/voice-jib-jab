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

export interface PolicyDecisionPayload {
  decision: PolicyDecision;
  reason_codes: string[];
  safe_rewrite?: string;
  required_disclaimer_id?: string;
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
  | "response_done";

export interface LaneOwnerChangePayload {
  from: Lane;
  to: Lane;
  cause: LaneTransitionCause;
}

export interface LaneEvent extends BaseEvent {
  type: "lane.owner_changed";
  source: "orchestrator";
  payload: LaneOwnerChangePayload;
}

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
}

export interface RAGEvent extends BaseEvent {
  type: "rag.query" | "rag.result";
  source: "laneB" | "retriever";
  payload: RAGQueryPayload | RAGResultPayload;
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

// Union type for all events
export type Event =
  | TranscriptEvent
  | PolicyEvent
  | LaneEvent
  | AudioEvent
  | ToolEvent
  | RAGEvent
  | SessionEvent
  | UserTranscriptEvent
  | UserBargeInEvent;
