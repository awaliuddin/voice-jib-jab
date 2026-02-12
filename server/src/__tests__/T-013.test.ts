import { resolve } from "path";
import { RetrievalService } from "../retrieval/RetrievalService.js";
import { LaneB } from "../lanes/LaneB.js";
import { MockWebSocket } from "./mocks/MockWebSocket.js";
import { ProviderConfig } from "../providers/ProviderAdapter.js";
import { retrievalService } from "../retrieval/index.js";
import { LaneArbitrator } from "../orchestrator/LaneArbitrator.js";
import { createAudioForDuration } from "./helpers/audio.js";

// Mock WebSocket
jest.mock("ws");

const knowledgeDir = resolve(process.cwd(), "..", "knowledge");
const factsPath = resolve(knowledgeDir, "nxtg_facts.jsonl");
const disclaimersPath = resolve(knowledgeDir, "disclaimers.json");

describe("T-013: Knowledge Pack Retrieval and Injection", () => {
  describe("RetrievalService: Unit Tests", () => {
    let service: RetrievalService;

    beforeEach(() => {
      service = new RetrievalService({
        factsPath,
        disclaimersPath,
        topK: 3,
        maxTokens: 600,
        maxBytes: 4000,
      });
    });

    it("AC1: should return the correct facts pack for a sample query", () => {
      const pack = service.retrieveFactsPack("voice interaction performance");

      expect(pack.topic).toContain("voice interaction performance");
      expect(pack.facts.length).toBeGreaterThan(0);

      const hasPerformanceFact = pack.facts.some((fact: { text: string }) =>
        fact.text.includes("time-to-first-byte")
      );
      expect(hasPerformanceFact).toBe(true);
      expect(pack.disclaimers).toContain("DISC-002");
    });

    it("AC2: should enforce token/byte caps on the results", () => {
      const pack = service.retrieveFactsPack("NextGen AI", {
        topK: 5,
        maxTokens: 50,
        maxBytes: 300,
      });

      const json = JSON.stringify(pack);
      const bytes = Buffer.byteLength(json, "utf8");
      const tokens = Math.ceil(json.length / 4);

      expect(bytes).toBeLessThanOrEqual(300);
      expect(tokens).toBeLessThanOrEqual(50);
      expect(pack.facts.length).toBeLessThan(5);
    });

    it("AC4: should handle a malformed query (empty string)", () => {
      const pack = service.retrieveFactsPack("");

      expect(pack.topic).toBe("NextGen AI");
      expect(pack.facts.length).toBe(0);
      expect(pack.disclaimers.length).toBe(1);
    });

    it("AC4: should handle missing facts file by returning an empty pack", () => {
      const errorService = new RetrievalService({
        factsPath: "/path/to/non-existent-facts.jsonl",
        disclaimersPath,
      });

      expect(errorService.isReady()).toBe(false);

      const pack = errorService.retrieveFactsPack("any query");
      expect(pack.facts.length).toBe(0);
      expect(pack.disclaimers.length).toBe(0);
    });
  });

  describe("RAGPipeline and LaneB: Integration Tests", () => {
    let laneB: LaneB;
    let mockWs: MockWebSocket;
    let arbitrator: LaneArbitrator;
    const sessionId = "rag-integration-test";
    const config: ProviderConfig = {
      apiKey: "test-api-key",
      model: "gpt-4o-realtime-preview-2024-12-17",
    };

    beforeEach(async () => {
      const WebSocketMock = jest.requireMock("ws").default;
      WebSocketMock.resetMock();

      jest.spyOn(retrievalService, "retrieveFactsPack");

      laneB = new LaneB(sessionId, {
        providerConfig: config,
        rag: { enabled: true },
      });

      arbitrator = new LaneArbitrator(sessionId, {});

      const connectPromise = laneB.connect();
      mockWs = WebSocketMock.getMockInstance();
      await new Promise((resolve) => process.nextTick(resolve));
      mockWs.receiveMessage({ type: "session.created" });
      await connectPromise;
      mockWs.clearMessages();
      arbitrator.startSession();
    });

    afterEach(async () => {
      arbitrator.endSession();
      if (laneB.isConnected()) {
        await laneB.disconnect();
      }
      jest.restoreAllMocks();
    });

    it("AC3: should retrieve facts and inject them into the prompt", async () => {
      const userQuery =
        "What are the performance targets for the voice assistant?";
      
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });
      
      arbitrator.onUserSpeechEnded();

      await laneB.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      mockWs.receiveMessage({
        type: "response.audio_transcript.delta",
        delta: userQuery,
      });
      
      const createMessage = mockWs.getMessagesByType("response.create")[0];
      expect(createMessage).toBeDefined();

      const instructions = createMessage.payload.instructions;

      expect(retrievalService.retrieveFactsPack).toHaveBeenCalledWith(
        userQuery,
        expect.any(Object)
      );

      expect(instructions).toContain("--- NXTG Facts ---");
      expect(instructions).toContain("Source: performance-targets");
      expect(instructions).toContain(
        "The platform targets sub-400ms time-to-first-byte"
      );
      expect(instructions).toContain("ID: NXTG-004");
      expect(instructions).toContain("--- End NXTG Facts ---");

      expect(instructions).toContain("--- Disclaimers ---");
      expect(instructions).toContain(
        "Performance data is based on internal testing"
      );
      expect(instructions).toContain("ID: DISC-002");
    });

    it("should not inject facts if retrieval returns an empty pack", async () => {
        (retrievalService.retrieveFactsPack as jest.Mock).mockReturnValue({
          topic: "Empty",
          facts: [],
          disclaimers: [],
        });
  
        const userQuery = "Tell me about something not in the knowledge base.";

        await laneB.sendAudio(createAudioForDuration(200));
        mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

        arbitrator.onUserSpeechEnded();
  
        await laneB.commitAudio();
        mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

        mockWs.receiveMessage({
            type: "response.audio_transcript.delta",
            delta: userQuery,
        });

        const createMessage = mockWs.getMessagesByType("response.create")[0];
        const instructions = createMessage.payload.instructions;
  
        expect(instructions).not.toContain("--- NXTG Facts ---");
        expect(instructions).not.toContain("--- Disclaimers ---");
      });
  });
});
