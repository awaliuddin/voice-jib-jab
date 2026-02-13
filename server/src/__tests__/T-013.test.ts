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

const FACTS_PACK_MARKER = "FACTS_PACK=";

function extractFactsPack(instructions: string) {
  const markerIndex = instructions.indexOf(FACTS_PACK_MARKER);
  if (markerIndex === -1) {
    throw new Error("FACTS_PACK marker not found in instructions");
  }
  const json = instructions.slice(markerIndex + FACTS_PACK_MARKER.length).trim();
  return JSON.parse(json);
}

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
      await new Promise((resolve) => process.nextTick(resolve));
      jest.restoreAllMocks();
    });

    it("AC3: should retrieve facts and inject them into the prompt", async () => {
      const userQuery =
        "What are the performance targets for the voice assistant?";
      
      await laneB.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });
      
      arbitrator.onUserSpeechEnded();

      await laneB.commitAudio();

      mockWs.receiveMessage({
        type: "conversation.item.input_audio_transcription.delta",
        delta: userQuery,
      });

      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });
      
      const createMessage = mockWs.getMessagesByType("response.create")[0];
      expect(createMessage).toBeDefined();

      const instructions = createMessage.response?.instructions;
      expect(typeof instructions).toBe("string");
      if (!instructions) {
        throw new Error("Response instructions missing");
      }

      expect(retrievalService.retrieveFactsPack).toHaveBeenCalledWith(
        userQuery,
        expect.any(Object)
      );

      expect(instructions).toContain("use ONLY the facts in FACTS_PACK");
      expect(instructions).toContain(
        "ask a brief clarifying question instead of guessing"
      );

      const factsPack = extractFactsPack(instructions);
      const hasPerformanceFact = factsPack.facts.some(
        (fact: { id: string; text: string }) =>
          fact.id === "NXTG-004" ||
          fact.text.includes("sub-400ms time-to-first-byte")
      );
      expect(hasPerformanceFact).toBe(true);
      expect(factsPack.disclaimers).toContain("DISC-002");
    });

    it("should still provide instructions when retrieval returns an empty pack", async () => {
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

        mockWs.receiveMessage({
            type: "conversation.item.input_audio_transcription.delta",
            delta: userQuery,
        });

        mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

        const createMessage = mockWs.getMessagesByType("response.create")[0];
        const instructions = createMessage.response?.instructions;
        expect(typeof instructions).toBe("string");
        if (!instructions) {
          throw new Error("Response instructions missing");
        }

        const factsPack = extractFactsPack(instructions);
        expect(factsPack.facts.length).toBe(0);
        expect(factsPack.disclaimers.length).toBe(0);
        expect(instructions).toContain(
          "ask a brief clarifying question instead of guessing"
        );
      });
  });
});
