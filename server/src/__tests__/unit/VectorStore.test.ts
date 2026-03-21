/**
 * VectorStore Unit Tests — Branch Coverage
 *
 * Covers the uncovered branches in VectorStore.search() and VectorStore.vectorize().
 */

import { VectorStore } from "../../retrieval/VectorStore.js";

describe("VectorStore — branch coverage", () => {
  it("returns [] for an empty query string (line ~137: !query.trim())", () => {
    const store = new VectorStore<Record<string, never>>();
    store.index([{ id: "d1", text: "apple pie recipe", metadata: {} }]);
    const results = store.search("", 5);
    expect(results).toEqual([]);
  });

  it("returns [] for a whitespace-only query (line ~137: !query.trim())", () => {
    const store = new VectorStore<Record<string, never>>();
    store.index([{ id: "d1", text: "apple pie recipe", metadata: {} }]);
    const results = store.search("   ", 5);
    expect(results).toEqual([]);
  });

  it("returns [] when query tokens share no overlap with corpus (dot product = 0, line ~164)", () => {
    const store = new VectorStore<Record<string, never>>();
    store.index([{ id: "d1", text: "apple pie recipe", metadata: {} }]);
    // "banana xyz" tokenises to ["banana", "xyz"] — neither exists in the IDF map
    const results = store.search("banana xyz", 5);
    expect(results).toEqual([]);
  });

  it("returns [] when topK is negative (line ~171: Math.max(topK, 0) = 0)", () => {
    const store = new VectorStore<Record<string, never>>();
    store.index([{ id: "d1", text: "apple pie recipe", metadata: {} }]);
    const results = store.search("apple", -5);
    expect(results).toEqual([]);
  });

  it("returns [] when indexed document contains only stopwords (docNorm = 0, skipped at line ~154)", () => {
    const store = new VectorStore<Record<string, never>>();
    // All tokens are stopwords → TF-IDF weight = 0 → docNorm = 0 → doc skipped
    store.index([{ id: "d1", text: "the a an is", metadata: {} }]);
    // "the" is a stopword and will also be filtered from the query
    // Use a non-stopword query that still resolves to an empty vector after IDF lookup
    const results = store.search("the", 5);
    expect(results).toEqual([]);
  });

  it("fires the idf.has(token) continue branch when query tokens are not in the IDF map (line ~178)", () => {
    const store = new VectorStore<Record<string, never>>();
    store.index([{ id: "d1", text: "apple pie recipe", metadata: {} }]);
    // "zucchini" is not in the IDF map; vectorize() hits the `if (!this.idf.has(token)) continue` branch
    // The resulting query vector is empty → search returns []
    const results = store.search("zucchini", 5);
    expect(results).toEqual([]);
  });
});
