/**
 * WebSocket server for real-time voice communication
 * With Lane Arbitration support and Persistent Memory
 */

import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { dirname, resolve } from "path";
import { sessionManager } from "../orchestrator/SessionManager.js";
import { eventBus } from "../orchestrator/EventBus.js";
import { LaneArbitrator } from "../orchestrator/LaneArbitrator.js";
import { LaneA } from "../lanes/LaneA.js";
import { LaneB } from "../lanes/LaneB.js";
import { ControlEngine } from "../lanes/laneC_control.js";
import { FallbackPlanner } from "../insurance/fallback_planner.js";
import { config } from "../config/index.js";
import {
  Event,
  PolicyDecisionPayload,
  RAGResultPayload,
} from "../schemas/events.js";
import { initializeAuditTrail } from "../insurance/audit_trail.js";
import {
  getDatabase,
  getTranscriptStore,
  getSessionHistory,
  SessionContext,
} from "../storage/index.js";
import type { OpaEvaluator } from "../insurance/opa_evaluator.js";
import type { SessionRecorder } from "../services/SessionRecorder.js";
import type { VoiceTriggerService } from "../services/VoiceTriggerService.js";
import type { ConversationMemoryStore } from "../services/ConversationMemoryStore.js";
import type { VoiceProfileStore } from "../services/VoiceProfileStore.js";
import { SentimentAnalyzer } from "../services/SentimentAnalyzer.js";
import { SentimentTracker } from "../services/SentimentTracker.js";
import { ConversationSummarizer } from "../services/ConversationSummarizer.js";
import type { KnowledgeBaseStore } from "../services/KnowledgeBaseStore.js";
import type { ClaimVerificationService } from "../services/ClaimVerificationService.js";
import type { RecordingStore } from "../services/RecordingStore.js";
import { supervisorRegistry } from "../services/SupervisorRegistry.js";

interface ClientConnection {
  ws: WebSocket;
  sessionId: string;
  userId: string | null;
  fingerprint: string | null;
  laneArbitrator: LaneArbitrator;
  laneA: LaneA;
  laneB: LaneB;
  controlEngine: ControlEngine;
  fallbackPlanner: FallbackPlanner;
  sessionContext: SessionContext | null;
  lastResponseEndTime: number; // Timestamp when OpenAI response.done fired (server-side)
  lastPlaybackEndTime: number; // Timestamp when client reports audio playback finished
  responseStartTime: number | null; // Timestamp when Lane B response started
  voiceMode: "push-to-talk" | "open-mic"; // Voice interaction mode
  audioStopped: boolean; // Client signaled audio stop — reject further chunks
  lastPolicyDecision: PolicyDecisionPayload | null;
  policyDecisionHandler?: (event: Event) => void;
  ragResultHandler?: (event: Event) => void;
}

// Cooldown period after AI response audio finishes playing on the client (ms).
// Must exceed typical room reverb time (RT60) to prevent echoed AI speech
// from being treated as new user input. 1500ms covers most room acoustics.
const RESPONSE_COOLDOWN_MS = 1500;

// Minimum RMS energy threshold for audio chunks.
// Chunks below this level are likely silence or faint echo residue and are dropped.
// PCM16 range is [-32768, 32767]; RMS of ~200 ≈ -44 dBFS — well above noise floor
// but filters out reverb tails and quiet echo bleed-through.
const MIN_AUDIO_RMS = 200;

export class VoiceWebSocketServer {
  private wss: WebSocketServer;
  private connections: Map<WebSocket, ClientConnection>;
  private opaEvaluator: OpaEvaluator | undefined;
  private sessionRecorder: SessionRecorder | undefined;
  private voiceTriggerService: VoiceTriggerService | undefined;
  private memoryStore: ConversationMemoryStore | undefined;
  private voiceProfileStore: VoiceProfileStore | undefined;
  private sentimentAnalyzer: SentimentAnalyzer;
  private sentimentTracker: SentimentTracker;
  private conversationSummarizer: ConversationSummarizer;
  private kbStore: KnowledgeBaseStore | undefined;
  private verificationService?: ClaimVerificationService;
  private recordingStore?: RecordingStore;
  private draining = false;

  constructor(server: any, opaEvaluator?: OpaEvaluator, sessionRecorder?: SessionRecorder, voiceTriggerService?: VoiceTriggerService, memoryStore?: ConversationMemoryStore, voiceProfileStore?: VoiceProfileStore, kbStore?: KnowledgeBaseStore, verificationService?: ClaimVerificationService, recordingStore?: RecordingStore) {
    this.wss = new WebSocketServer({ server });
    this.connections = new Map();
    this.opaEvaluator = opaEvaluator;
    this.sessionRecorder = sessionRecorder;
    this.voiceTriggerService = voiceTriggerService;
    this.memoryStore = memoryStore;
    this.voiceProfileStore = voiceProfileStore;
    this.sentimentAnalyzer = new SentimentAnalyzer();
    this.sentimentTracker = new SentimentTracker();
    this.conversationSummarizer = new ConversationSummarizer();
    this.kbStore = kbStore;
    this.verificationService = verificationService;
    this.recordingStore = recordingStore;

    // Initialize storage if persistent memory or audit trail is enabled
    if (
      config.features.enablePersistentMemory ||
      config.features.enableAuditTrail
    ) {
      try {
        getDatabase({
          path: config.storage.databasePath,
          walMode: config.storage.enableWalMode,
        });
        console.log("[WebSocket] Storage initialized");
      } catch (error) {
        console.error("[WebSocket] Failed to initialize storage:", error);
      }
    }

    if (config.features.enableAuditTrail) {
      const auditDir = resolve(
        dirname(config.storage.databasePath),
        "audit",
      );
      initializeAuditTrail({
        enabled: true,
        databasePath: config.storage.databasePath,
        walMode: config.storage.enableWalMode,
        jsonlDir: auditDir,
        includeTranscripts: config.features.enablePersistentMemory,
        includeTranscriptDeltas: false,
        includeAudio: config.safety.storeRawAudio,
        includeSessionEvents: true,
        includeResponseMetadata: true,
      });
    }

    this.wss.on("connection", this.handleConnection.bind(this));
    console.log("[WebSocket] Server initialized");
  }

  /**
   * Returns true if the WebSocket server is open and accepting connections.
   * Used by the health monitor to verify the voice WebSocket subsystem is live.
   */
  isHealthy(): boolean {
    // ws.WebSocketServer exposes no explicit readyState, but after .close() is
    // called the server removes its HTTP upgrade listener. We detect closure by
    // checking whether the underlying net.Server reference is still set.
    return (this.wss as unknown as { _server?: object })._server != null;
  }

  /**
   * Gracefully drain WebSocket connections.
   *
   * Sets the draining flag (rejects new connections), sends a
   * "server.shutdown" notice to all open clients, then waits up to
   * timeoutMs for all active sessions to disconnect voluntarily.
   *
   * Returns true if all connections closed within the timeout, false otherwise.
   * After this method returns, call close() to force-terminate any remainders.
   */
  async drain(timeoutMs = 5_000): Promise<boolean> {
    this.draining = true;

    // Notify all open clients so they can save state and disconnect
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(
            JSON.stringify({
              type: "server.shutdown",
              reason: "maintenance",
              timestamp: Date.now(),
            }),
          );
        } catch {
          // Client may have already closed — safe to ignore
        }
      }
    }

    if (this.connections.size === 0) return true;

    return new Promise<boolean>((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const interval = setInterval(() => {
        if (this.connections.size === 0) {
          clearInterval(interval);
          resolve(true);
        } else if (Date.now() >= deadline) {
          clearInterval(interval);
          resolve(false);
        }
      }, 100);
    });
  }

  /** Close all voice WebSocket connections and shut down the server. */
  close(callback?: (err?: Error) => void): void {
    for (const client of this.wss.clients) {
      client.close(1001, "Server shutting down");
    }
    this.wss.close(callback);
  }

  private async handleConnection(ws: WebSocket): Promise<void> {
    if (this.draining) {
      ws.close(1001, "Server shutting down");
      return;
    }
    console.log("[WebSocket] New client connected");

    // Create session
    const session = sessionManager.createSession({
      connectedAt: new Date().toISOString(),
    });

    // Create Lane B (wraps OpenAI adapter)
    const laneB = new LaneB(session.id, {
      providerConfig: {
        apiKey: config.openai.apiKey,
        model: config.openai.model,
      },
      rag: {
        enabled: config.features.enableRAG,
        topK: config.rag.topK,
      },
      safety: {
        enablePIIRedaction: config.safety.enablePIIRedaction,
        piiRedactionMode: "redact",
      },
    });

    // Create Lane A (reflex engine) — only when enabled in config
    const laneAEnabled = config.features.enableLaneA;
    const laneA = new LaneA(session.id, {
      enabled: laneAEnabled,
    });

    // Create Lane Arbitrator
    const laneArbitrator = new LaneArbitrator(session.id, {
      laneAEnabled,
      minDelayBeforeReflexMs: 150,
      maxReflexDurationMs: 2000,
      preemptThresholdMs: 300,
      transitionGapMs: 10,
    });

    // Create Lane C (ControlEngine)
    const controlEngine = new ControlEngine(session.id, {
      enabled: config.features.enablePolicyGate,
      enablePIIRedaction: config.safety.enablePIIRedaction,
      piiRedactionMode: "redact",
      opaEvaluator: this.opaEvaluator,
    });

    // Create FallbackPlanner
    const fallbackPlanner = new FallbackPlanner(session.id, {
      enabled: config.features.enablePolicyGate,
      mode: config.fallback.mode,
    });

    // Store connection
    const connection: ClientConnection = {
      ws,
      sessionId: session.id,
      userId: null,
      fingerprint: null,
      laneArbitrator,
      laneA,
      laneB,
      controlEngine,
      fallbackPlanner,
      sessionContext: null,
      lastResponseEndTime: 0,
      lastPlaybackEndTime: 0,
      responseStartTime: null,
      voiceMode: "push-to-talk", // Default to push-to-talk mode
      audioStopped: false,
      lastPolicyDecision: null,
    };
    this.connections.set(ws, connection);

    // Setup lane event handlers
    this.setupLaneHandlers(connection);

    // Setup WebSocket handlers
    ws.on("message", (data) => this.handleMessage(connection, data));
    ws.on("close", () => this.handleClose(connection));
    ws.on("error", (error) => this.handleError(connection, error));

    // Send session ready
    this.sendToClient(ws, {
      type: "session.ready",
      sessionId: session.id,
      timestamp: Date.now(),
    });
  }

  private setupLaneHandlers(connection: ClientConnection): void {
    const { ws, sessionId, laneArbitrator, laneA, laneB, fallbackPlanner } =
      connection;

    // ============== Lane Arbitrator Events ==============

    // Handle state changes
    laneArbitrator.on(
      "state_change",
      (transition: { from: string; to: string; cause: string }) => {
        console.log(
          `[WebSocket] Lane state: ${transition.from} -> ${transition.to}`,
        );

        // Notify client of lane state change
        this.sendToClient(ws, {
          type: "lane.state_changed",
          from: transition.from,
          to: transition.to,
          cause: transition.cause,
          timestamp: Date.now(),
        });
      },
    );

    // Handle ownership changes
    laneArbitrator.on(
      "owner_change",
      (change: { from: string; to: string; cause: string }) => {
        this.sendToClient(ws, {
          type: "lane.owner_changed",
          from: change.from,
          to: change.to,
          cause: change.cause,
          timestamp: Date.now(),
        });
      },
    );

    // Play Lane A reflex
    laneArbitrator.on("play_reflex", () => {
      laneA.playReflex();
    });

    // Stop Lane A reflex
    laneArbitrator.on("stop_reflex", () => {
      laneA.stop();
    });

    // Play Lane B (audio already flowing from adapter)
    laneArbitrator.on("play_lane_b", () => {
      // Lane B audio is already flowing - this is just a signal
      console.log("[WebSocket] Lane B audio playback started");
    });

    // Stop Lane B
    laneArbitrator.on("stop_lane_b", () => {
      laneB.cancel();
    });

    // Play fallback audio
    laneArbitrator.on("play_fallback", () => {
      if (!fallbackPlanner.isEnabled()) {
        laneArbitrator.onFallbackComplete();
        return;
      }

      sessionManager.updateSessionState(sessionId, "responding");
      this.sendToClient(ws, {
        type: "response.start",
        timestamp: Date.now(),
      });

      const decisionPayload = connection.lastPolicyDecision ?? undefined;
      fallbackPlanner.trigger(decisionPayload).catch((error) => {
        console.error("[WebSocket] Failed to play fallback:", error);
        fallbackPlanner.stop();
        laneArbitrator.onFallbackComplete();
      });
    });

    // Stop fallback audio
    laneArbitrator.on("stop_fallback", () => {
      fallbackPlanner.stop();
    });

    // Response complete
    laneArbitrator.on("response_complete", () => {
      // Track when response ended for cooldown period
      connection.lastResponseEndTime = Date.now();

      // Re-enable audio acceptance for next utterance
      connection.audioStopped = false;

      sessionManager.updateSessionState(sessionId, "listening");
      this.sendToClient(ws, {
        type: "response.end",
        timestamp: Date.now(),
      });
    });

    // ============== Lane A Events ==============

    // Forward Lane A audio to client
    laneA.on(
      "audio",
      (chunk: { data: Buffer; format: string; sampleRate: number }) => {
        const event: Event = {
          event_id: uuidv4(),
          session_id: sessionId,
          t_ms: Date.now(),
          source: "laneA",
          type: "audio.chunk",
          payload: { ...chunk, lane: "A" },
        };
        eventBus.emit(event);

        this.sendToClient(ws, {
          type: "audio.chunk",
          data: chunk.data.toString("base64"),
          format: chunk.format,
          sampleRate: chunk.sampleRate,
          lane: "A",
          timestamp: Date.now(),
        });
        this.recordingStore?.appendChunk(sessionId, chunk.data);
      },
    );

    laneA.on("stopped", () => {
      console.log("[WebSocket] Lane A stopped");
    });

    // ============== Lane B Events ==============

    // Handle first audio ready - preempt Lane A
    laneB.on("first_audio_ready", (data: { latencyMs: number }) => {
      console.log(`[WebSocket] Lane B first audio ready (${data.latencyMs}ms)`);
      laneArbitrator.onLaneBReady();
    });

    // Forward Lane B audio to client (only when Lane B owns audio)
    laneB.on(
      "audio",
      (chunk: { data: Buffer; format: string; sampleRate: number }) => {
        // Gate: reject audio after client signaled stop/cancel (Bug #3 fix).
        // In-flight chunks from OpenAI may arrive after cancellation —
        // drop them so the client doesn't receive stale audio.
        if (connection.audioStopped) {
          return;
        }

        // Only forward when Lane B strictly owns audio output
        // During B_RESPONDING, Lane A may still be playing - don't forward yet
        if (laneArbitrator.getCurrentOwner() !== "B") {
          return;
        }

        const event: Event = {
          event_id: uuidv4(),
          session_id: sessionId,
          t_ms: Date.now(),
          source: "laneB",
          type: "audio.chunk",
          payload: { ...chunk, lane: "B" },
        };
        eventBus.emit(event);

        this.sendToClient(ws, {
          type: "audio.chunk",
          data: chunk.data.toString("base64"),
          format: chunk.format,
          sampleRate: chunk.sampleRate,
          lane: "B",
          timestamp: Date.now(),
        });
        this.recordingStore?.appendChunk(sessionId, chunk.data);
      },
    );

    // Handle transcripts from Lane B (assistant responses)
    laneB.on(
      "transcript",
      (segment: {
        text: string;
        confidence: number;
        isFinal: boolean;
        timestamp: number;
      }) => {
        this.sendToClient(ws, {
          type: "transcript",
          text: segment.text,
          confidence: segment.confidence,
          isFinal: segment.isFinal,
          timestamp: segment.timestamp,
        });

        // Forward to supervisor observers
        if (segment.isFinal) {
          supervisorRegistry.broadcast(sessionId, { type: "session.transcript", sessionId, text: segment.text, role: "assistant", timestamp: segment.timestamp });
        }

        // Persist assistant transcript to database
        if (config.features.enablePersistentMemory && segment.isFinal) {
          try {
            const transcriptStore = getTranscriptStore();
            transcriptStore.save({
              sessionId,
              userId: connection.userId || undefined,
              role: "assistant",
              content: segment.text,
              confidence: segment.confidence,
              timestampMs: segment.timestamp,
              isFinal: segment.isFinal,
            });
          } catch (error) {
            console.error("[WebSocket] Failed to persist transcript:", error);
          }
        }

        const event: Event = {
          event_id: uuidv4(),
          session_id: sessionId,
          t_ms: Date.now(),
          source: "laneB",
          type: "transcript",
          payload: segment,
        };
        eventBus.emit(event);
      },
    );

    // Handle user transcripts
    laneB.on(
      "user_transcript",
      (segment: {
        text: string;
        confidence: number;
        isFinal: boolean;
        timestamp: number;
      }) => {
        this.sendToClient(ws, {
          type: "user_transcript",
          text: segment.text,
          confidence: segment.confidence,
          isFinal: segment.isFinal,
          timestamp: segment.timestamp,
        });

        // Persist user transcript to database
        if (config.features.enablePersistentMemory && segment.isFinal) {
          try {
            const transcriptStore = getTranscriptStore();
            transcriptStore.save({
              sessionId,
              userId: connection.userId || undefined,
              role: "user",
              content: segment.text,
              confidence: segment.confidence,
              timestampMs: segment.timestamp,
              isFinal: segment.isFinal,
            });
          } catch (error) {
            console.error(
              "[WebSocket] Failed to persist user transcript:",
              error,
            );
          }
        }

        // Sentiment analysis on final user transcripts
        if (segment.isFinal && segment.text) {
          const sentimentResult = this.sentimentAnalyzer.analyze(segment.text);
          this.sentimentTracker.addReading(sessionId, sentimentResult);
          console.log(`[WebSocket][Sentiment] ${sessionId}: ${sentimentResult.sentiment} (score=${sentimentResult.score})`);
          if (this.sentimentTracker.shouldEscalate(sessionId)) {
            console.warn(`[WebSocket][Sentiment] Escalation triggered for session ${sessionId} — sustained frustrated trajectory`);
          }
          // Forward user transcript + sentiment to supervisors
          supervisorRegistry.broadcast(sessionId, { type: "session.user_transcript", sessionId, text: segment.text, role: "user", timestamp: segment.timestamp, sentiment: sentimentResult.sentiment, sentimentScore: sentimentResult.score });

          // Claim verification — fire-and-forget
          if (this.verificationService) {
            void this.runClaimVerification(sessionId, segment.text, laneB);
          }
        }

        const event: Event = {
          event_id: uuidv4(),
          session_id: sessionId,
          t_ms: Date.now(),
          source: "client",
          type: "user_transcript",
          payload: segment,
        };
        eventBus.emit(event);
      },
    );

    // Handle speech detection
    laneB.on("speech_started", () => {
      this.sendToClient(ws, {
        type: "speech.started",
        timestamp: Date.now(),
      });
    });

    laneB.on("speech_stopped", () => {
      this.sendToClient(ws, {
        type: "speech.stopped",
        timestamp: Date.now(),
      });
      // Signal arbitrator that user speech ended
      laneArbitrator.onUserSpeechEnded();
    });

    // Handle response lifecycle
    laneB.on("response_start", () => {
      sessionManager.updateSessionState(sessionId, "responding");
      const startedAt = Date.now();
      connection.responseStartTime = startedAt;

      const responseStartEvent: Event = {
        event_id: uuidv4(),
        session_id: sessionId,
        t_ms: startedAt,
        source: "laneB",
        type: "response.metadata",
        payload: {
          phase: "start",
          voice_mode: connection.voiceMode,
        },
      };
      eventBus.emit(responseStartEvent);

      this.sendToClient(ws, {
        type: "response.start",
        timestamp: Date.now(),
      });
    });

    laneB.on("response_end", () => {
      const endedAt = Date.now();
      const totalMs =
        connection.responseStartTime !== null
          ? endedAt - connection.responseStartTime
          : undefined;
      const ttfbMs = laneB.getTTFB() ?? undefined;

      const responseEndEvent: Event = {
        event_id: uuidv4(),
        session_id: sessionId,
        t_ms: endedAt,
        source: "laneB",
        type: "response.metadata",
        payload: {
          phase: "end",
          total_ms: totalMs,
          ttfb_ms: ttfbMs,
          voice_mode: connection.voiceMode,
        },
      };
      eventBus.emit(responseEndEvent);
      connection.responseStartTime = null;

      // Signal arbitrator that Lane B is done
      laneArbitrator.onLaneBDone();
    });

    // Handle errors
    laneB.on("error", (error: Error) => {
      console.error(`[LaneB] Error in session ${sessionId}:`, error);
      this.sendToClient(ws, {
        type: "error",
        error: error.message,
        timestamp: Date.now(),
      });
    });

    // ============== FallbackPlanner Events ==============

    fallbackPlanner.on(
      "audio",
      (chunk: { data: Buffer; format: string; sampleRate: number }) => {
        if (connection.audioStopped) {
          return;
        }
        if (laneArbitrator.getCurrentOwner() !== "fallback") {
          return;
        }

        const event: Event = {
          event_id: uuidv4(),
          session_id: sessionId,
          t_ms: Date.now(),
          source: "orchestrator",
          type: "audio.chunk",
          payload: { ...chunk, lane: "fallback" },
        };
        eventBus.emit(event);

        this.sendToClient(ws, {
          type: "audio.chunk",
          data: chunk.data.toString("base64"),
          format: chunk.format,
          sampleRate: chunk.sampleRate,
          lane: "fallback",
          timestamp: Date.now(),
        });
        this.recordingStore?.appendChunk(sessionId, chunk.data);
      },
    );

    fallbackPlanner.on(
      "done",
      (payload: { reason: "done" | "stopped"; utterance?: string | null }) => {
        if (payload.reason === "done") {
          laneArbitrator.onFallbackComplete();
        }
      },
    );

    // ============== Policy / RAG Events ==============

    const policyDecisionHandler = (event: Event) => {
      if (event.type !== "policy.decision" || event.session_id !== sessionId) {
        return;
      }

      const payload = event.payload as PolicyDecisionPayload;
      connection.lastPolicyDecision = payload;

      // Forward policy decisions to supervisors
      supervisorRegistry.broadcast(sessionId, { type: "session.policy_decision", sessionId, decision: payload?.decision, t_ms: event.t_ms });

      const disclaimerId = payload?.required_disclaimer_id;
      if (typeof disclaimerId === "string" && disclaimerId.length > 0) {
        const existing = laneB.getRequiredDisclaimers();
        laneB.setRequiredDisclaimers([...existing, disclaimerId]);
      }

      if (
        payload?.decision === "cancel_output" ||
        payload?.decision === "refuse" ||
        payload?.decision === "escalate"
      ) {
        laneArbitrator.onPolicyCancel();
      }
    };

    const ragResultHandler = (event: Event) => {
      if (event.type !== "rag.result" || event.session_id !== sessionId) {
        return;
      }

      const payload = event.payload as RAGResultPayload;
      const disclaimers = Array.isArray(payload?.disclaimers)
        ? payload.disclaimers
        : [];

      if (disclaimers.length > 0) {
        const existing = laneB.getRequiredDisclaimers();
        laneB.setRequiredDisclaimers([...existing, ...disclaimers]);
      }
    };

    eventBus.on("policy.decision", policyDecisionHandler);
    eventBus.on("rag.result", ragResultHandler);

    connection.policyDecisionHandler = policyDecisionHandler;
    connection.ragResultHandler = ragResultHandler;
  }

  private async handleMessage(
    connection: ClientConnection,
    data: Buffer | ArrayBuffer | Buffer[],
  ): Promise<void> {
    const { ws, sessionId, laneArbitrator, laneB } = connection;

    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "session.start":
          // Start recording this session
          this.sessionRecorder?.startRecording(sessionId, message.tenantId);
          this.recordingStore?.startCapture(sessionId, message.tenantId ?? null);

          // New session — ensure audio gate is open
          connection.audioStopped = false;

          // Handle user identification and session context
          if (config.features.enablePersistentMemory) {
            try {
              const sessionHistory = getSessionHistory();

              // Get or create user from fingerprint
              const fingerprint = message.fingerprint || `anon-${sessionId}`;
              connection.fingerprint = fingerprint;

              const user = sessionHistory.getOrCreateUser(fingerprint, {
                userAgent: message.userAgent,
                createdFromSession: sessionId,
              });
              connection.userId = user.id;

              // Record this session in the database
              sessionHistory.recordSession(sessionId, user.id, {
                connectedAt: new Date().toISOString(),
              });

              // Retrieve conversation context for returning users
              const context = sessionHistory.getSessionContext(
                user.id,
                sessionId,
              );
              connection.sessionContext = context;

              if (context.isReturningUser) {
                console.log(
                  `[WebSocket] Returning user: ${user.id} (${context.previousSessionCount} previous sessions)`,
                );
              } else {
                console.log(`[WebSocket] New user: ${user.id}`);
              }

              // Inject context into Lane B if we have history
              if (context.conversationSummary) {
                laneB.setConversationContext(context.conversationSummary);
                console.log(
                  "[WebSocket] Injected conversation context into session",
                );
              }
            } catch (error) {
              console.error(
                "[WebSocket] Failed to setup session context:",
                error,
              );
            }
          }

          // Inject tenant memory context if available
          if (this.memoryStore && message.tenantId) {
            const memCtx = this.memoryStore.getContextString(message.tenantId);
            if (memCtx) {
              (connection as any).tenantMemoryContext = memCtx;
              console.log(`[WebSocket] Injected tenant memory context (${message.tenantId})`);
            }
          }

          // Inject knowledge base context (auto-suggest) if available
          if (this.kbStore && message.tenantId) {
            const kbEntries = this.kbStore.listEntries(message.tenantId as string);
            if (kbEntries.length > 0) {
              const kbCtx = "Knowledge base FAQs:\n" + kbEntries.slice(0, 10).map(e => `Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
              (connection as any).kbContext = kbCtx;
              console.log(`[WebSocket] Injected KB context: ${kbEntries.length} entries (${message.tenantId})`);
            }
          }

          // Set voice mode if provided
          if (
            message.voiceMode === "push-to-talk" ||
            message.voiceMode === "open-mic"
          ) {
            connection.voiceMode = message.voiceMode;
            laneB.setVoiceMode(message.voiceMode);
            console.log(`[WebSocket] Voice mode set to: ${message.voiceMode}`);
          }

          // Store voiceId for this session if provided
          if (message.voiceId) {
            (connection as any).voiceId = message.voiceId as string;
            const profile = this.voiceProfileStore?.getProfile(message.voiceId as string);
            console.log(`[WebSocket] Voice profile set: ${message.voiceId}${profile ? ` (${profile.name})` : ""}`);
          }

          // Only connect Lane B if not already connected
          // This prevents creating duplicate OpenAI sessions
          if (!laneB.isConnected()) {
            console.log("[WebSocket] Connecting to OpenAI...");
            await laneB.connect();
            // Start the arbitrator
            laneArbitrator.startSession();
            sessionManager.updateSessionState(sessionId, "listening");
          } else {
            console.log(
              "[WebSocket] OpenAI already connected, reusing session",
            );
          }

          // Notify client that provider is ready with context info
          this.sendToClient(ws, {
            type: "provider.ready",
            isReturningUser:
              connection.sessionContext?.isReturningUser || false,
            previousSessionCount:
              connection.sessionContext?.previousSessionCount || 0,
            voiceMode: connection.voiceMode,
            timestamp: Date.now(),
          });
          break;

        case "audio.chunk":
          // Reject audio after client signaled stop
          if (connection.audioStopped) {
            return;
          }

          // Only forward audio if Lane B is connected
          if (!laneB.isConnected()) {
            console.log(
              "[WebSocket] Dropping audio chunk: Lane B not connected",
            );
            return;
          }

          // CRITICAL: Audio gating to prevent feedback loop
          // Only accept audio when in LISTENING state
          // This prevents echoed AI audio from being sent back to OpenAI
          const currentState = laneArbitrator.getState();
          if (currentState !== "LISTENING") {
            // Silently drop audio - AI is speaking or processing
            // This breaks the feedback loop where AI talks over itself
            return;
          }

          // CRITICAL: Cooldown period after AI audio finishes playing.
          // Use the later of server-side response end and client playback end
          // so the cooldown doesn't start until audio has actually stopped
          // coming out of the speakers.
          const cooldownAnchor = Math.max(
            connection.lastResponseEndTime,
            connection.lastPlaybackEndTime,
          );
          if (cooldownAnchor > 0) {
            const timeSinceCooldownAnchor = Date.now() - cooldownAnchor;
            if (timeSinceCooldownAnchor < RESPONSE_COOLDOWN_MS) {
              // Still in cooldown period, drop audio
              return;
            }
          }

          // CRITICAL: RMS energy gate — drop audio chunks that are too quiet.
          // Echoed AI audio and room reverb are typically much quieter than
          // direct speech into a microphone. This catches echo residue that
          // slips past the cooldown window.
          const audioBytes = Buffer.from(message.data, "base64");
          let sumSquares = 0;
          const sampleCount = Math.floor(audioBytes.length / 2);
          for (let i = 0; i < sampleCount; i++) {
            const sample = audioBytes.readInt16LE(i * 2);
            sumSquares += sample * sample;
          }
          const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
          if (rms < MIN_AUDIO_RMS) {
            // Audio is below energy threshold — likely silence or echo
            return;
          }

          // Forward audio to Lane B
          await laneB.sendAudio({
            data: audioBytes,
            format: message.format || "pcm",
            sampleRate: message.sampleRate || 24000,
          });

          // Emit event
          const audioEvent: Event = {
            event_id: uuidv4(),
            session_id: sessionId,
            t_ms: Date.now(),
            source: "client",
            type: "audio.chunk",
            payload: { size: message.data.length },
          };
          eventBus.emit(audioEvent);

          sessionManager.touchSession(sessionId);
          break;

        case "audio.stop":
          // Client stopped capturing — gate any in-flight chunks and
          // immediately clear the OpenAI input buffer to prevent stale audio
          console.log("[WebSocket] Client audio stop received");
          connection.audioStopped = true;
          laneB.clearInputBuffer();

          // If a response is in progress, cancel it so the server stops streaming
          if (laneB.getIsResponding()) {
            await laneB.cancel();
          }
          {
            const stopState = laneArbitrator.getState();
            if (stopState === "B_RESPONDING" || stopState === "B_PLAYING") {
              laneArbitrator.resetResponseInProgress();
            }
          }

          this.sendToClient(ws, { type: "audio.stop.ack", timestamp: Date.now() });
          this.sendToClient(ws, { type: "response.end", timestamp: Date.now() });
          break;

        case "audio.cancel":
          // Client cancelled — discard buffer and stop any active response
          console.log("[WebSocket] Client audio cancel received");
          connection.audioStopped = true;
          laneB.clearInputBuffer();

          if (laneB.getIsResponding()) {
            await laneB.cancel();
          }

          // Reset arbitrator if a response cycle was started
          {
            const cancelState = laneArbitrator.getState();
            if (cancelState === "B_RESPONDING" || cancelState === "B_PLAYING") {
              laneArbitrator.resetResponseInProgress();
            }
          }

          // Send ack first, then response.end to confirm streaming has stopped.
          // This completes the delivery acknowledgment protocol (Bug #3 fix):
          // client sends audio.cancel → server cancels + acks → client is certain
          // no more audio chunks will arrive.
          this.sendToClient(ws, { type: "audio.cancel.ack", timestamp: Date.now() });
          this.sendToClient(ws, { type: "response.end", timestamp: Date.now() });
          break;

        case "playback.ended":
          // Client finished playing all AI audio through speakers.
          // This is the real moment echoes stop, so we anchor the cooldown here.
          connection.lastPlaybackEndTime = Date.now();
          console.log("[WebSocket] Client playback ended — cooldown anchor updated");
          break;

        case "audio.commit":
          // User released Talk button - commit audio buffer to trigger response
          console.log(
            `[WebSocket] Audio commit requested ` +
              `(state: ${laneArbitrator.getState()})`,
          );

          // Gate further audio chunks — the client has stopped capturing
          // and any chunks arriving after this are in-flight leftovers
          connection.audioStopped = true;

          // Trigger state transition FIRST (before commit attempt)
          // This ensures arbitrator knows a response cycle is starting
          if (laneArbitrator.getState() === "LISTENING") {
            laneArbitrator.onUserSpeechEnded();
          }

          // Attempt commit (may fail with guards)
          const commitSucceeded = await laneB.commitAudio();

          // If commit was skipped (buffer too small), we need to notify
          if (commitSucceeded === false) {
            console.log(
              `[WebSocket] Commit skipped (buffer too small), ` +
                `resetting arbitrator state`,
            );

            // Reset arbitrator since response won't happen
            laneArbitrator.resetResponseInProgress();

            // Re-enable audio for next attempt
            connection.audioStopped = false;

            // Notify client
            ws.send(
              JSON.stringify({
                type: "commit.skipped",
                reason: "buffer_too_small",
                timestamp: Date.now(),
              }),
            );
          }
          break;

        case "user.barge_in":
          // Re-enable audio acceptance — barge-in means user wants to talk again
          connection.audioStopped = false;

          // Handle barge-in through arbitrator
          laneArbitrator.onUserBargeIn();

          this.sendToClient(ws, { type: "user.barge_in.ack", timestamp: Date.now() });

          const bargeInEvent: Event = {
            event_id: uuidv4(),
            session_id: sessionId,
            t_ms: Date.now(),
            source: "client",
            type: "user.barge_in",
            payload: {},
          };
          eventBus.emit(bargeInEvent);

          sessionManager.updateSessionState(sessionId, "listening");
          break;

        case "session.end":
          // Save conversation summary before ending
          if (config.features.enablePersistentMemory && connection.userId) {
            try {
              const sessionHistory = getSessionHistory();
              const transcriptStore = getTranscriptStore();

              const summary = sessionHistory.generateSessionSummary(sessionId);
              const turnCount = transcriptStore.getSessionTurnCount(sessionId);

              if (summary && turnCount > 0) {
                sessionHistory.saveConversationSummary(
                  connection.userId,
                  sessionId,
                  summary,
                  turnCount,
                );
              }

              sessionHistory.endSession(sessionId, "user_ended");
              transcriptStore.cleanupNonFinal(sessionId);
            } catch (error) {
              console.error(
                "[WebSocket] Failed to save session summary:",
                error,
              );
            }
          }

          laneArbitrator.endSession();
          await laneB.disconnect();
          sessionManager.endSession(sessionId, "user_ended");
          ws.close();
          break;

        case "session.set_mode":
          // Change voice mode dynamically
          if (
            message.voiceMode === "push-to-talk" ||
            message.voiceMode === "open-mic"
          ) {
            connection.voiceMode = message.voiceMode;
            laneB.setVoiceMode(message.voiceMode);

            console.log(
              `[WebSocket] Voice mode changed to: ${message.voiceMode}`,
            );

            // Notify client of mode change
            this.sendToClient(ws, {
              type: "session.mode_changed",
              voiceMode: message.voiceMode,
              timestamp: Date.now(),
            });
          } else {
            console.warn(
              `[WebSocket] Invalid voice mode: ${message.voiceMode}`,
            );
          }
          break;

        default:
          console.warn(`[WebSocket] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[WebSocket] Error handling message:`, error);
      this.sendToClient(ws, {
        type: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: Date.now(),
      });
    }
  }

  private handleClose(connection: ClientConnection): void {
    const {
      ws,
      sessionId,
      userId,
      laneArbitrator,
      laneB,
      controlEngine,
      fallbackPlanner,
    } = connection;

    console.log(`[WebSocket] Client disconnected: ${sessionId}`);

    if (connection.policyDecisionHandler) {
      eventBus.off("policy.decision", connection.policyDecisionHandler);
      connection.policyDecisionHandler = undefined;
    }

    if (connection.ragResultHandler) {
      eventBus.off("rag.result", connection.ragResultHandler);
      connection.ragResultHandler = undefined;
    }

    // Save conversation summary before closing
    if (config.features.enablePersistentMemory && userId) {
      try {
        const sessionHistory = getSessionHistory();
        const transcriptStore = getTranscriptStore();

        // Generate and save conversation summary
        const summary = sessionHistory.generateSessionSummary(sessionId);
        const turnCount = transcriptStore.getSessionTurnCount(sessionId);

        if (summary && turnCount > 0) {
          sessionHistory.saveConversationSummary(
            userId,
            sessionId,
            summary,
            turnCount,
          );
          console.log(
            `[WebSocket] Saved conversation summary (${turnCount} turns)`,
          );
        }

        // Mark session as ended in database
        sessionHistory.endSession(sessionId, "connection_closed");

        // Cleanup non-final transcripts
        transcriptStore.cleanupNonFinal(sessionId);
      } catch (error) {
        console.error("[WebSocket] Failed to save session summary:", error);
      }
    }

    // Record sentiment summary before flushing session to disk
    const sentimentSummary = this.sentimentTracker.getSummary(sessionId);
    if (sentimentSummary.readingCount > 0) {
      this.sessionRecorder?.recordSentiment(sessionId, sentimentSummary);
    }
    this.sentimentTracker.clearSession(sessionId);

    // Auto-ticket if sustained frustration was detected during the session
    if (sentimentSummary.escalationTriggered) {
      const quickSummary = this.conversationSummarizer.summarize(sessionId, [], {
        sentimentReadings: sentimentSummary.trajectory.map(r => ({ sentiment: r.sentiment, score: r.score })),
      });
      console.warn(`[WebSocket][Summary] Session ${sessionId} ended with escalation flag — escalated=${quickSummary.escalated}, auto-ticketing`);
      try {
        const ticketDesc = `Auto-escalation: frustrated caller detected.\nDominant sentiment: ${sentimentSummary.dominantSentiment}\nAverage score: ${sentimentSummary.averageScore.toFixed(2)}\nSession: ${sessionId}`;
        void (controlEngine as any).createEscalationTicket?.({
          sessionId,
          reason: "sentiment_escalation",
          description: ticketDesc,
        });
      } catch (err) {
        console.error("[WebSocket] Failed to create escalation ticket:", err);
      }
    }

    // Stop session recording and flush to disk
    this.sessionRecorder?.stopRecording(sessionId).catch((error) => {
      console.error("[WebSocket] Failed to stop session recording:", error);
    });

    // Finalise audio recording (writes WAV file)
    this.recordingStore?.stopCapture(sessionId).catch((error) => {
      console.error("[WebSocket] Failed to stop audio capture:", error);
    });

    // Fire webhook callback if this session was trigger-initiated
    if (this.voiceTriggerService?.getTriggerBySession(sessionId)) {
      this.voiceTriggerService.completeTrigger(sessionId, {
        status: "completed",
        durationMs: null,
        transcript: [],
        policyDecisions: [],
      });
    }

    laneArbitrator.endSession();
    fallbackPlanner.stop();
    controlEngine.destroy();
    laneB.disconnect().catch(console.error);
    sessionManager.endSession(sessionId, "connection_closed");
    this.connections.delete(ws);
  }

  private handleError(connection: ClientConnection, error: Error): void {
    console.error(
      `[WebSocket] Error in session ${connection.sessionId}:`,
      error,
    );

    const event: Event = {
      event_id: uuidv4(),
      session_id: connection.sessionId,
      t_ms: Date.now(),
      source: "orchestrator",
      type: "session.error",
      payload: { error: error.message },
    };
    eventBus.emit(event);
  }

  private sendToClient(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private async runClaimVerification(
    sessionId: string,
    text: string,
    laneB: LaneB,
  ): Promise<void> {
    try {
      const result = await this.verificationService!.scan(text);
      if (result) {
        console.log(`[WebSocket][ClaimVerification] ${sessionId}: ${result.factClaims} claims, ${result.verified} verified, risk=${result.overallRisk}`);
        laneB.setConversationContext(`[Claim verification]: ${result.spoken}`);
      }
    } catch (err) {
      console.warn(`[WebSocket][ClaimVerification] ${sessionId}: scan failed —`, err);
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Inject a supervisor whisper message into a live session's LaneB as a system hint.
   * Returns true if the session was found and the hint was injected.
   */
  injectWhisper(sessionId: string, message: string): boolean {
    for (const connection of this.connections.values()) {
      if (connection.sessionId === sessionId) {
        try {
          connection.laneB.setConversationContext(`[Supervisor whisper]: ${message}`);
          console.log(`[WebSocket][Supervisor] Whisper injected into session ${sessionId}`);
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }
}
