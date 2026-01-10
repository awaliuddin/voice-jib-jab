/**
 * WebSocket server for real-time voice communication
 * With Lane Arbitration support
 */

import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { sessionManager } from "../orchestrator/SessionManager.js";
import { eventBus } from "../orchestrator/EventBus.js";
import { LaneArbitrator } from "../orchestrator/LaneArbitrator.js";
import { LaneA } from "../lanes/LaneA.js";
import { LaneB } from "../lanes/LaneB.js";
import { config } from "../config/index.js";
import { Event } from "../schemas/events.js";

interface ClientConnection {
  ws: WebSocket;
  sessionId: string;
  laneArbitrator: LaneArbitrator;
  laneA: LaneA;
  laneB: LaneB;
}

export class VoiceWebSocketServer {
  private wss: WebSocketServer;
  private connections: Map<WebSocket, ClientConnection>;

  constructor(server: any) {
    this.wss = new WebSocketServer({ server });
    this.connections = new Map();

    this.wss.on("connection", this.handleConnection.bind(this));
    console.log("[WebSocket] Server initialized");
  }

  private async handleConnection(ws: WebSocket): Promise<void> {
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
    });

    // Create Lane A (reflex engine)
    const laneA = new LaneA(session.id, {
      enabled: true,
    });

    // Create Lane Arbitrator
    const laneArbitrator = new LaneArbitrator(session.id, {
      laneAEnabled: true,
      minDelayBeforeReflexMs: 150,
      maxReflexDurationMs: 2000,
      preemptThresholdMs: 300,
      transitionGapMs: 10,
    });

    // Store connection
    const connection: ClientConnection = {
      ws,
      sessionId: session.id,
      laneArbitrator,
      laneA,
      laneB,
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
    const { ws, sessionId, laneArbitrator, laneA, laneB } = connection;

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

    // Response complete
    laneArbitrator.on("response_complete", () => {
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
        // Only forward if Lane B owns audio
        if (
          laneArbitrator.getCurrentOwner() !== "B" &&
          laneArbitrator.getState() !== "B_RESPONDING"
        ) {
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
      },
    );

    // Handle transcripts from Lane B
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
      this.sendToClient(ws, {
        type: "response.start",
        timestamp: Date.now(),
      });
    });

    laneB.on("response_end", () => {
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
          // Connect Lane B (which connects to OpenAI)
          await laneB.connect();
          // Start the arbitrator
          laneArbitrator.startSession();
          sessionManager.updateSessionState(sessionId, "listening");
          // Notify client that provider is ready
          this.sendToClient(ws, {
            type: "provider.ready",
            timestamp: Date.now(),
          });
          break;

        case "audio.chunk":
          // Only forward audio if Lane B is connected
          if (!laneB.isConnected()) {
            console.log(
              "[WebSocket] Dropping audio chunk: Lane B not connected",
            );
            return;
          }

          // Forward audio to Lane B
          await laneB.sendAudio({
            data: Buffer.from(message.data, "base64"),
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

        case "audio.commit":
          // User released Talk button - commit audio buffer to trigger response
          console.log("[WebSocket] Committing audio buffer via Lane B");
          await laneB.commitAudio();
          break;

        case "user.barge_in":
          // Handle barge-in through arbitrator
          laneArbitrator.onUserBargeIn();

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
          laneArbitrator.endSession();
          await laneB.disconnect();
          sessionManager.endSession(sessionId, "user_ended");
          ws.close();
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
    const { ws, sessionId, laneArbitrator, laneB } = connection;

    console.log(`[WebSocket] Client disconnected: ${sessionId}`);

    laneArbitrator.endSession();
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

  getConnectionCount(): number {
    return this.connections.size;
  }
}
