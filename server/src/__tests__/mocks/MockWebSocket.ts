/**
 * Mock WebSocket for Testing
 * Simulates WebSocket behavior without network calls
 */

import { EventEmitter } from "events";

export interface MockWebSocketMessage {
  type: string;
  [key: string]: any;
}

export class MockWebSocket extends EventEmitter {
  public sentMessages: MockWebSocketMessage[] = [];
  public readyState: number = 1; // OPEN
  public url: string;

  // WebSocket ready states
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(url: string = "wss://mock.openai.com") {
    super();
    this.url = url;

    // Simulate connection opening on next tick
    process.nextTick(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open");
    });
  }

  /**
   * Send message (client -> server)
   */
  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    try {
      const message = JSON.parse(data);
      this.sentMessages.push(message);
    } catch (error) {
      throw new Error("Invalid JSON data");
    }
  }

  /**
   * Close connection
   */
  close(code: number = 1000, reason: string = "Normal closure"): void {
    if (this.readyState === MockWebSocket.CLOSED) {
      return;
    }

    this.readyState = MockWebSocket.CLOSING;

    // Emit close event on next tick
    process.nextTick(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close", code, Buffer.from(reason));
    });
  }

  /**
   * Simulate receiving message from server
   */
  receiveMessage(message: MockWebSocketMessage): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("Cannot receive message: WebSocket is not open");
    }

    const data = JSON.stringify(message);
    this.emit("message", Buffer.from(data));
  }

  /**
   * Simulate error
   */
  simulateError(error: Error): void {
    this.emit("error", error);
  }

  /**
   * Get last sent message
   */
  getLastMessage(): MockWebSocketMessage | null {
    return this.sentMessages.length > 0
      ? this.sentMessages[this.sentMessages.length - 1]
      : null;
  }

  /**
   * Get all messages of specific type
   */
  getMessagesByType(type: string): MockWebSocketMessage[] {
    return this.sentMessages.filter((msg) => msg.type === type);
  }

  /**
   * Clear sent message history
   */
  clearMessages(): void {
    this.sentMessages = [];
  }

  /**
   * Check if message was sent
   */
  hasSentMessage(type: string): boolean {
    return this.sentMessages.some((msg) => msg.type === type);
  }

  /**
   * Count messages of specific type
   */
  countMessagesByType(type: string): number {
    return this.sentMessages.filter((msg) => msg.type === type).length;
  }
}

/**
 * Create mock WebSocket constructor for jest.mock
 */
export function createMockWebSocketConstructor(): jest.Mock {
  const instances: MockWebSocket[] = [];

  const constructor = jest.fn((url: string, _options?: any) => {
    const instance = new MockWebSocket(url);
    instances.push(instance);
    return instance;
  });

  // Attach static properties
  (constructor as any).CONNECTING = 0;
  (constructor as any).OPEN = 1;
  (constructor as any).CLOSING = 2;
  (constructor as any).CLOSED = 3;

  // Attach helper to get instances
  (constructor as any).instances = instances;
  (constructor as any).getLastInstance = () =>
    instances[instances.length - 1] || null;
  (constructor as any).clearInstances = () => (instances.length = 0);

  return constructor;
}
