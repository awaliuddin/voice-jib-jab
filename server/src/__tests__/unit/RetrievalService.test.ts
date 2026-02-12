import { resolve } from "path";
import { RetrievalService } from "../../retrieval/RetrievalService.js";

const knowledgeDir = resolve(process.cwd(), "..", "knowledge");

const factsPath = resolve(knowledgeDir, "nxtg_facts.jsonl");
const disclaimersPath = resolve(knowledgeDir, "disclaimers.json");

describe("RetrievalService", () => {
  it("loads and indexes the knowledge pack", () => {
    const service = new RetrievalService({
      factsPath,
      disclaimersPath,
      topK: 3,
      maxTokens: 600,
      maxBytes: 4000,
    });

    expect(service.isReady()).toBe(true);
  });

  it("returns facts pack with topic, facts, and disclaimers", () => {
    const service = new RetrievalService({
      factsPath,
      disclaimersPath,
      topK: 3,
      maxTokens: 600,
      maxBytes: 4000,
    });

    const pack = service.retrieveFactsPack("performance targets", { topK: 3 });
    expect(pack.topic.toLowerCase()).toContain("performance");
    expect(pack.facts.length).toBeGreaterThan(0);
    expect(pack.facts[0]).toHaveProperty("id");
    expect(pack.facts[0]).toHaveProperty("text");
    expect(pack.disclaimers).toContain("DISC-002");
  });

  it("enforces token and byte caps", () => {
    const service = new RetrievalService({
      factsPath,
      disclaimersPath,
      topK: 5,
      maxTokens: 600,
      maxBytes: 4000,
    });

    const pack = service.retrieveFactsPack("NextGen AI", {
      topK: 5,
      maxTokens: 50,
      maxBytes: 200,
    });
    const json = JSON.stringify(pack);
    const bytes = Buffer.byteLength(json, "utf8");
    const tokens = Math.ceil(json.length / 4);

    expect(bytes).toBeLessThanOrEqual(200);
    expect(tokens).toBeLessThanOrEqual(50);
  });
});
