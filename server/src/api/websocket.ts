/**
 * WebSocket server for real-time voice communication
 */

import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { sessionManager } from '../orchestrator/SessionManager.js';
import { eventBus } from '../orchestrator/EventBus.js';
import { OpenAIRealtimeAdapter } from '../providers/OpenAIRealtimeAdapter.js';
import { config } from '../config/index.js';
import { Event } from '../schemas/events.js';

interface ClientConnection {
  ws: WebSocket;
  sessionId: string;
  providerAdapter: OpenAIRealtimeAdapter;
}

export class VoiceWebSocketServer {
  private wss: WebSocketServer;
  private connections: Map<WebSocket, ClientConnection>;

  constructor(server: any) {
    this.wss = new WebSocketServer({ server });
    this.connections = new Map();

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('[WebSocket] Server initialized');
  }

  private async handleConnection(ws: WebSocket): Promise<void> {
    console.log('[WebSocket] New client connected');

    // Create session
    const session = sessionManager.createSession({
      connectedAt: new Date().toISOString(),
    });

    // Create provider adapter
    const providerAdapter = new OpenAIRealtimeAdapter({
      apiKey: config.openai.apiKey,
      model: config.openai.model,
    });

    // Store connection
    const connection: ClientConnection = {
      ws,
      sessionId: session.id,
      providerAdapter,
    };
    this.connections.set(ws, connection);

    // Setup provider event handlers
    this.setupProviderHandlers(connection);

    // Setup WebSocket handlers
    ws.on('message', (data) => this.handleMessage(connection, data));
    ws.on('close', () => this.handleClose(connection));
    ws.on('error', (error) => this.handleError(connection, error));

    // Send session ready
    this.sendToClient(ws, {
      type: 'session.ready',
      sessionId: session.id,
      timestamp: Date.now(),
    });
  }

  private setupProviderHandlers(connection: ClientConnection): void {
    const { ws, sessionId, providerAdapter } = connection;

    // Forward audio from provider to client
    providerAdapter.on('audio', (chunk) => {
      const event: Event = {
        event_id: uuidv4(),
        session_id: sessionId,
        t_ms: Date.now(),
        source: 'provider',
        type: 'audio.chunk',
        payload: chunk,
      };

      eventBus.emit(event);

      this.sendToClient(ws, {
        type: 'audio.chunk',
        data: chunk.data.toString('base64'),
        format: chunk.format,
        sampleRate: chunk.sampleRate,
        timestamp: Date.now(),
      });
    });

    // Handle response start/end
    providerAdapter.on('response_start', () => {
      sessionManager.updateSessionState(sessionId, 'responding');

      this.sendToClient(ws, {
        type: 'response.start',
        timestamp: Date.now(),
      });
    });

    providerAdapter.on('response_end', () => {
      sessionManager.updateSessionState(sessionId, 'listening');

      this.sendToClient(ws, {
        type: 'response.end',
        timestamp: Date.now(),
      });

      const event: Event = {
        event_id: uuidv4(),
        session_id: sessionId,
        t_ms: Date.now(),
        source: 'provider',
        type: 'audio.end',
        payload: {},
      };
      eventBus.emit(event);
    });

    // Handle errors
    providerAdapter.on('error', (error) => {
      console.error(`[Provider] Error in session ${sessionId}:`, error);

      this.sendToClient(ws, {
        type: 'error',
        error: error.message,
        timestamp: Date.now(),
      });
    });
  }

  private async handleMessage(
    connection: ClientConnection,
    data: Buffer | ArrayBuffer | Buffer[]
  ): Promise<void> {
    const { ws, sessionId, providerAdapter } = connection;

    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'session.start':
          await providerAdapter.connect(sessionId);
          sessionManager.updateSessionState(sessionId, 'listening');
          break;

        case 'audio.chunk':
          // Forward audio to provider
          await providerAdapter.sendAudio({
            data: Buffer.from(message.data, 'base64'),
            format: message.format || 'pcm',
            sampleRate: message.sampleRate || 24000,
          });

          // Emit event
          const audioEvent: Event = {
            event_id: uuidv4(),
            session_id: sessionId,
            t_ms: Date.now(),
            source: 'client',
            type: 'audio.chunk',
            payload: { size: message.data.length },
          };
          eventBus.emit(audioEvent);

          sessionManager.touchSession(sessionId);
          break;

        case 'user.barge_in':
          // Cancel current response
          await providerAdapter.cancel();

          const bargeInEvent: Event = {
            event_id: uuidv4(),
            session_id: sessionId,
            t_ms: Date.now(),
            source: 'client',
            type: 'user.barge_in',
            payload: {},
          };
          eventBus.emit(bargeInEvent);

          sessionManager.updateSessionState(sessionId, 'listening');
          break;

        case 'session.end':
          await providerAdapter.disconnect();
          sessionManager.endSession(sessionId, 'user_ended');
          ws.close();
          break;

        default:
          console.warn(`[WebSocket] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[WebSocket] Error handling message:`, error);
      this.sendToClient(ws, {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      });
    }
  }

  private handleClose(connection: ClientConnection): void {
    const { ws, sessionId, providerAdapter } = connection;

    console.log(`[WebSocket] Client disconnected: ${sessionId}`);

    providerAdapter.disconnect().catch(console.error);
    sessionManager.endSession(sessionId, 'connection_closed');
    this.connections.delete(ws);
  }

  private handleError(connection: ClientConnection, error: Error): void {
    console.error(`[WebSocket] Error in session ${connection.sessionId}:`, error);

    const event: Event = {
      event_id: uuidv4(),
      session_id: connection.sessionId,
      t_ms: Date.now(),
      source: 'orchestrator',
      type: 'session.error',
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
