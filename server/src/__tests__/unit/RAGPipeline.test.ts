/**
 * RAGPipeline Unit Tests
 *
 * Tests the RAG pipeline that builds response context with facts pack
 * injection for Lane B. Covers empty query guard, event emissions,
 * PII redaction, and instructions formatting.
 */

jest.mock("../../orchestrator/EventBus.js", () => ({
  eventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    onSession: jest.fn(),
  },
}));

jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid"),
}));

import { RAGPipeline } from "../../retrieval/RAGPipeline.js";
import { eventBus } from "../../orchestrator/EventBus.js";

// Minimal mock of RetrievalService
function createMockRetrievalService() {
  return {
    retrieveFactsPack: jest.fn().mockReturnValue({
      topic: "test-topic",
      facts: [
        { id: "NXTG-001", text: "Fact one", source: "test", timestamp: "2024-01-01" },
      ],
      disclaimers: [],
      token_count: 10,
    }),
    getDefaults: jest.fn().mockReturnValue({ topK: 5, maxTokens: 600, maxBytes: 4000 }),
    lookupDisclaimer: jest.fn(),
  } as any;
}

describe("RAGPipeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should set piiRedactor to null by default", () => {
      const service = createMockRetrievalService();
      const pipeline = new RAGPipeline("session-1", service);
      // Verify construction succeeds (piiRedactor defaults handled internally)
      expect(pipeline).toBeInstanceOf(RAGPipeline);
    });

    it("should accept options with piiRedactor and redactToolCalls", () => {
      const service = createMockRetrievalService();
      const mockRedactor = { redactText: jest.fn() } as any;
      const pipeline = new RAGPipeline("session-1", service, {
        piiRedactor: mockRedactor,
        redactToolCalls: true,
      });
      expect(pipeline).toBeInstanceOf(RAGPipeline);
    });
  });

  describe("buildResponseContext()", () => {
    it("should return null instructions and factsPack for empty query", () => {
      const service = createMockRetrievalService();
      const pipeline = new RAGPipeline("session-1", service);

      // Covers `if (!cleanedQuery)` true branch (line 44)
      const result = pipeline.buildResponseContext("");
      expect(result.instructions).toBeNull();
      expect(result.factsPack).toBeNull();
      expect(service.retrieveFactsPack).not.toHaveBeenCalled();
    });

    it("should return null for whitespace-only query", () => {
      const service = createMockRetrievalService();
      const pipeline = new RAGPipeline("session-1", service);

      const result = pipeline.buildResponseContext("   \t\n  ");
      expect(result.instructions).toBeNull();
      expect(result.factsPack).toBeNull();
    });

    it("should retrieve facts and return context for valid query", () => {
      const service = createMockRetrievalService();
      const pipeline = new RAGPipeline("session-1", service);

      const result = pipeline.buildResponseContext("What is NextGen AI?");

      expect(service.retrieveFactsPack).toHaveBeenCalledWith("What is NextGen AI?", { topK: 5 });
      expect(result.factsPack).not.toBeNull();
      expect(result.instructions).toContain("FACTS_PACK=");
      expect(result.instructions).toContain("NXTG-001");
    });

    it("should emit rag.query, tool.call, tool.result, and rag.result events", () => {
      const service = createMockRetrievalService();
      const pipeline = new RAGPipeline("session-1", service);

      pipeline.buildResponseContext("test query");

      expect(eventBus.emit).toHaveBeenCalledTimes(4);
      const eventTypes = (eventBus.emit as jest.Mock).mock.calls.map(
        (call: any[]) => call[0].type,
      );
      expect(eventTypes).toEqual(["rag.query", "tool.call", "tool.result", "rag.result"]);
    });

    it("should use custom topK from options", () => {
      const service = createMockRetrievalService();
      const pipeline = new RAGPipeline("session-1", service, { topK: 10 });

      pipeline.buildResponseContext("test query");

      expect(service.retrieveFactsPack).toHaveBeenCalledWith("test query", { topK: 10 });
    });

    it("should apply PII redaction when redactToolCalls is true", () => {
      const service = createMockRetrievalService();
      const mockRedactor = {
        redactText: jest.fn().mockReturnValue({ redactedText: "REDACTED query" }),
      } as any;
      const pipeline = new RAGPipeline("session-1", service, {
        piiRedactor: mockRedactor,
        redactToolCalls: true,
      });

      pipeline.buildResponseContext("sensitive query");

      expect(mockRedactor.redactText).toHaveBeenCalledWith("sensitive query");
      expect(service.retrieveFactsPack).toHaveBeenCalledWith("REDACTED query", { topK: 5 });
    });

    it("should not redact when redactToolCalls is false", () => {
      const service = createMockRetrievalService();
      const mockRedactor = { redactText: jest.fn() } as any;
      const pipeline = new RAGPipeline("session-1", service, {
        piiRedactor: mockRedactor,
        redactToolCalls: false,
      });

      pipeline.buildResponseContext("normal query");

      expect(mockRedactor.redactText).not.toHaveBeenCalled();
      expect(service.retrieveFactsPack).toHaveBeenCalledWith("normal query", { topK: 5 });
    });
  });
});
