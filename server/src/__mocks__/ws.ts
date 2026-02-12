/**
 * Manual mock for 'ws' module
 * Used by Jest to replace the real WebSocket in tests
 */

import { MockWebSocket } from "../__tests__/mocks/MockWebSocket.js";

// Singleton instance for test control
let currentMockInstance: MockWebSocket | null = null;

// Mock WebSocket constructor
const WebSocketMock: any = jest.fn((url: string, _protocols?: string | string[], _options?: any) => {
  currentMockInstance = new MockWebSocket(url);
  return currentMockInstance;
});

// Add static constants (required by WebSocket spec)
WebSocketMock.CONNECTING = 0;
WebSocketMock.OPEN = 1;
WebSocketMock.CLOSING = 2;
WebSocketMock.CLOSED = 3;

// Helper to get current mock instance for test assertions
WebSocketMock.getMockInstance = () => currentMockInstance;

// Helper to reset mock state between tests
WebSocketMock.resetMock = () => {
  currentMockInstance = null;
  WebSocketMock.mockClear();
};

// Export as default (standard ws module export)
export default WebSocketMock;

// Also export as named export for flexibility
export { WebSocketMock };
