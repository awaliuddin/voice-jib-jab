import { resolve } from "path";
import { RAGPipeline } from "../retrieval/RAGPipeline.js";
import { RetrievalService, FactsPack } from "../retrieval/RetrievalService.js";

const knowledgeDir = resolve(process.cwd(), "..", "knowledge");
const factsPath = resolve(knowledgeDir, "nxtg_facts.jsonl");
const disclaimersPath = resolve(knowledgeDir, "disclaimers.json");

const FACTS_PACK_MARKER = "FACTS_PACK=";

function extractFactsPack(instructions: string): FactsPack {
  const markerIndex = instructions.indexOf(FACTS_PACK_MARKER);
  if (markerIndex === -1) {
    throw new Error("FACTS_PACK marker not found in instructions");
  }
  const json = instructions.slice(markerIndex + FACTS_PACK_MARKER.length).trim();
  return JSON.parse(json) as FactsPack;
}

describe("T-016: Knowledge Pack Retrieval Policy", () => {
  it("AC1: Lane B instructions use only retrieved facts", () => {
    const factsPack: FactsPack = {
      topic: "NextGen AI Basics",
      facts: [
        {
          id: "NXTG-999",
          text: "NextGen AI is a test-only entry.",
          source: "test",
          timestamp: "2026-02-01",
        },
      ],
      disclaimers: ["DISC-001"],
    };

    const retrievalStub = {
      retrieveFactsPack: jest.fn().mockReturnValue(factsPack),
      getDefaults: () => ({ topK: 3, maxTokens: 600, maxBytes: 4000 }),
    } as unknown as RetrievalService;

    const pipeline = new RAGPipeline("session-test", retrievalStub);
    const context = pipeline.buildResponseContext("What is NextGen AI?");

    expect(retrievalStub.retrieveFactsPack).toHaveBeenCalledWith(
      "What is NextGen AI?",
      expect.any(Object)
    );
    expect(context.instructions).toContain("use ONLY the facts in FACTS_PACK");
    expect(context.instructions).toContain(
      "ask a brief clarifying question instead of guessing"
    );

    const parsedPack = extractFactsPack(context.instructions as string);
    expect(parsedPack).toEqual(factsPack);
  });

  it("AC2: Clarifying questions are prompted when facts are missing", () => {
    const emptyPack: FactsPack = {
      topic: "Unknown",
      facts: [],
      disclaimers: [],
    };

    const retrievalStub = {
      retrieveFactsPack: jest.fn().mockReturnValue(emptyPack),
      getDefaults: () => ({ topK: 3, maxTokens: 600, maxBytes: 4000 }),
    } as unknown as RetrievalService;

    const pipeline = new RAGPipeline("session-empty", retrievalStub);
    const context = pipeline.buildResponseContext("What is the roadmap?");

    expect(context.instructions).toContain(
      "ask a brief clarifying question instead of guessing"
    );
    const parsedPack = extractFactsPack(context.instructions as string);
    expect(parsedPack.facts.length).toBe(0);
  });

  it("AC3: Facts pack schema and limits are enforced", () => {
    const service = new RetrievalService({
      factsPath,
      disclaimersPath,
      topK: 5,
      maxTokens: 600,
      maxBytes: 4000,
    });

    const pack = service.retrieveFactsPack("NextGen AI performance", {
      topK: 5,
      maxTokens: 60,
      maxBytes: 300,
    });

    const json = JSON.stringify(pack);
    const bytes = Buffer.byteLength(json, "utf8");
    const tokens = Math.ceil(json.length / 4);

    expect(bytes).toBeLessThanOrEqual(300);
    expect(tokens).toBeLessThanOrEqual(60);
    expect(typeof pack.topic).toBe("string");
    expect(Array.isArray(pack.facts)).toBe(true);
    expect(Array.isArray(pack.disclaimers)).toBe(true);

    for (const fact of pack.facts) {
      expect(typeof fact.id).toBe("string");
      expect(typeof fact.text).toBe("string");
      expect(typeof fact.source).toBe("string");
      expect(typeof fact.timestamp).toBe("string");
    }
  });
});
