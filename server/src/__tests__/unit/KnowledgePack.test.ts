/**
 * KnowledgePack Unit Tests
 *
 * Tests the knowledge pack loader that parses JSONL facts and JSON disclaimers.
 * Covers: constructor, load(), loadFacts (empty lines, invalid JSON, valid facts),
 * loadDisclaimers (with and without disclaimers field).
 */

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
}));

import { readFileSync } from "fs";
import { KnowledgePack } from "../../retrieval/KnowledgePack.js";

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

beforeEach(() => {
  mockReadFileSync.mockReset();
});

describe("KnowledgePack", () => {
  describe("constructor", () => {
    it("should create instance with factsPath and optional disclaimersPath", () => {
      const pack = new KnowledgePack("/path/to/facts.jsonl", "/path/to/disclaimers.json");
      expect(pack.facts).toEqual([]);
      expect(pack.disclaimers).toEqual([]);
    });

    it("should create instance without disclaimersPath", () => {
      const pack = new KnowledgePack("/path/to/facts.jsonl");
      expect(pack.facts).toEqual([]);
      expect(pack.disclaimers).toEqual([]);
    });
  });

  describe("load()", () => {
    it("should load facts from JSONL file", () => {
      const factsContent = [
        '{"id":"NXTG-001","text":"Fact one","source":"test","timestamp":"2024-01-01"}',
        '{"id":"NXTG-002","text":"Fact two","source":"test","timestamp":"2024-01-02"}',
      ].join("\n");

      mockReadFileSync.mockReturnValue(factsContent);

      const pack = new KnowledgePack("/path/to/facts.jsonl");
      pack.load();

      expect(pack.facts).toHaveLength(2);
      expect(pack.facts[0].id).toBe("NXTG-001");
      expect(pack.facts[1].id).toBe("NXTG-002");
    });

    it("should skip empty lines in facts file", () => {
      const factsContent = [
        '{"id":"NXTG-001","text":"Fact one","source":"test","timestamp":"2024-01-01"}',
        "",
        "   ",
        '{"id":"NXTG-002","text":"Fact two","source":"test","timestamp":"2024-01-02"}',
      ].join("\n");

      mockReadFileSync.mockReturnValue(factsContent);

      const pack = new KnowledgePack("/path/to/facts.jsonl");
      pack.load();

      expect(pack.facts).toHaveLength(2);
    });

    it("should skip invalid JSON lines and warn", () => {
      const factsContent = [
        '{"id":"NXTG-001","text":"Valid fact","source":"test","timestamp":"2024-01-01"}',
        "NOT VALID JSON",
        '{"id":"NXTG-002","text":"Another fact","source":"test","timestamp":"2024-01-02"}',
      ].join("\n");

      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      mockReadFileSync.mockReturnValue(factsContent);

      const pack = new KnowledgePack("/path/to/facts.jsonl");
      pack.load();

      expect(pack.facts).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalledWith(
        "[KnowledgePack] Skipping invalid fact line:",
        expect.any(SyntaxError),
      );
      warnSpy.mockRestore();
    });

    it("should skip facts missing id or text", () => {
      const factsContent = [
        '{"id":"NXTG-001","text":"Valid","source":"test","timestamp":"2024-01-01"}',
        '{"text":"No id","source":"test","timestamp":"2024-01-01"}',
        '{"id":"NXTG-003","source":"test","timestamp":"2024-01-01"}',
      ].join("\n");

      mockReadFileSync.mockReturnValue(factsContent);

      const pack = new KnowledgePack("/path/to/facts.jsonl");
      pack.load();

      expect(pack.facts).toHaveLength(1);
      expect(pack.facts[0].id).toBe("NXTG-001");
    });

    it("should load disclaimers when disclaimersPath is provided", () => {
      const factsContent = '{"id":"F1","text":"Fact","source":"s","timestamp":"t"}';
      const disclaimersContent = JSON.stringify({
        disclaimers: [
          { id: "D1", text: "Disclaimer one" },
          { id: "D2", text: "Disclaimer two" },
        ],
      });

      mockReadFileSync
        .mockReturnValueOnce(factsContent)
        .mockReturnValueOnce(disclaimersContent);

      const pack = new KnowledgePack("/facts.jsonl", "/disclaimers.json");
      pack.load();

      expect(pack.disclaimers).toHaveLength(2);
      expect(pack.disclaimers[0].id).toBe("D1");
    });

    it("should not load disclaimers when disclaimersPath is omitted", () => {
      const factsContent = '{"id":"F1","text":"Fact","source":"s","timestamp":"t"}';
      mockReadFileSync.mockReturnValue(factsContent);

      const pack = new KnowledgePack("/facts.jsonl");
      pack.load();

      expect(pack.disclaimers).toEqual([]);
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it("should return empty array when disclaimers field is undefined", () => {
      const factsContent = '{"id":"F1","text":"Fact","source":"s","timestamp":"t"}';
      const disclaimersContent = JSON.stringify({ other_field: "no disclaimers key" });

      mockReadFileSync
        .mockReturnValueOnce(factsContent)
        .mockReturnValueOnce(disclaimersContent);

      const pack = new KnowledgePack("/facts.jsonl", "/disclaimers.json");
      pack.load();

      // Covers the `parsed.disclaimers || []` false branch (line 62)
      expect(pack.disclaimers).toEqual([]);
    });
  });
});
