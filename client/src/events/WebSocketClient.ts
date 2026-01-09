/**
 * WebSocket Client for real-time server communication
 */

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export type MessageHandler = (message: WebSocketMessage) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>>;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private isIntentionallyClosed: boolean = false;

  constructor(url: string) {
    this.url = url;
    this.handlers = new Map();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[WebSocket] Connecting to ${this.url}...`);
        this.ws = new WebSocket(this.url);
        this.isIntentionallyClosed = false;

        let hasConnected = false;
        let hasErrored = false;

        this.ws.onopen = () => {
          console.log("[WebSocket] Connected");
          hasConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error("[WebSocket] Failed to parse message:", error);
          }
        };

        this.ws.onerror = () => {
          // WebSocket onerror provides minimal info - just log it
          // The real handling happens in onclose
          if (!hasConnected && !hasErrored) {
            console.warn("[WebSocket] Connection error occurred");
            hasErrored = true;
          }
        };

        this.ws.onclose = (event) => {
          console.log(
            `[WebSocket] Closed (code: ${event.code}, reason: ${event.reason || "none"})`,
          );

          // If we never connected successfully, reject the promise
          if (!hasConnected) {
            reject(
              new Error(`WebSocket connection failed (code: ${event.code})`),
            );
            return;
          }

          // If already connected before and this wasn't intentional, try to reconnect
          if (!this.isIntentionallyClosed) {
            this.attemptReconnect();
          }
        };

        // Add connection timeout
        setTimeout(() => {
          if (!hasConnected && !hasErrored) {
            console.error("[WebSocket] Connection timeout");
            this.ws?.close();
            reject(new Error("WebSocket connection timeout"));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[WebSocket] Max reconnect attempts reached");
      this.emit({ type: "connection.failed" });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error("[WebSocket] Reconnect failed:", error);
      });
    }, delay);
  }

  send(message: WebSocketMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[WebSocket] Cannot send, not connected");
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("[WebSocket] Send failed:", error);
    }
  }

  on(messageType: string, handler: MessageHandler): void {
    if (!this.handlers.has(messageType)) {
      this.handlers.set(messageType, new Set());
    }
    this.handlers.get(messageType)!.add(handler);
  }

  off(messageType: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(messageType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    // Call type-specific handlers
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => handler(message));
    }

    // Call wildcard handlers
    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => handler(message));
    }
  }

  private emit(message: WebSocketMessage): void {
    this.handleMessage(message);
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    console.log("[WebSocket] Disconnected intentionally");
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
