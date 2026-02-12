/**
 * Lightweight in-memory vector store (TF-IDF + cosine similarity).
 * Designed for small knowledge packs without external dependencies.
 */

export interface VectorDocument<TMeta> {
  id: string;
  text: string;
  metadata: TMeta;
}

export interface VectorSearchResult<TMeta> {
  doc: VectorDocument<TMeta>;
  score: number;
}

type SparseVector = Map<string, number>;

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "with",
  "without",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "this",
  "that",
  "these",
  "those",
  "as",
  "into",
  "about",
  "over",
  "under",
  "after",
  "before",
  "between",
  "across",
  "while",
  "during",
  "so",
  "than",
  "too",
  "very",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export class VectorStore<TMeta> {
  private documents: VectorDocument<TMeta>[] = [];
  private docVectors: Map<string, SparseVector> = new Map();
  private docNorms: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();

  index(documents: VectorDocument<TMeta>[]): void {
    this.documents = documents;
    this.docVectors.clear();
    this.docNorms.clear();
    this.idf.clear();

    const docTermCounts: Map<string, Map<string, number>> = new Map();
    const docFrequency: Map<string, number> = new Map();

    for (const doc of documents) {
      const tokens = tokenize(doc.text);
      const termCounts = new Map<string, number>();
      for (const token of tokens) {
        termCounts.set(token, (termCounts.get(token) || 0) + 1);
      }
      docTermCounts.set(doc.id, termCounts);

      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
      }
    }

    const docCount = Math.max(documents.length, 1);
    for (const [token, df] of docFrequency.entries()) {
      const idf = Math.log((1 + docCount) / (1 + df)) + 1;
      this.idf.set(token, idf);
    }

    for (const doc of documents) {
      const termCounts = docTermCounts.get(doc.id) || new Map();
      const totalTerms = Array.from(termCounts.values()).reduce(
        (sum, count) => sum + count,
        0,
      );
      const vector: SparseVector = new Map();
      let norm = 0;

      for (const [token, count] of termCounts.entries()) {
        const tf = totalTerms > 0 ? count / totalTerms : 0;
        const idf = this.idf.get(token) || 0;
        const weight = tf * idf;
        if (weight > 0) {
          vector.set(token, weight);
          norm += weight * weight;
        }
      }

      this.docVectors.set(doc.id, vector);
      this.docNorms.set(doc.id, Math.sqrt(norm));
    }
  }

  search(query: string, topK: number): VectorSearchResult<TMeta>[] {
    if (!query.trim()) return [];

    const queryVector = this.vectorize(query);
    if (queryVector.size === 0) return [];

    let queryNorm = 0;
    for (const weight of queryVector.values()) {
      queryNorm += weight * weight;
    }
    queryNorm = Math.sqrt(queryNorm);
    if (queryNorm === 0) return [];

    const results: VectorSearchResult<TMeta>[] = [];

    for (const doc of this.documents) {
      const docVector = this.docVectors.get(doc.id);
      const docNorm = this.docNorms.get(doc.id) || 0;
      if (!docVector || docNorm === 0) continue;

      let dot = 0;
      for (const [token, qWeight] of queryVector.entries()) {
        const dWeight = docVector.get(token);
        if (dWeight) {
          dot += qWeight * dWeight;
        }
      }

      if (dot <= 0) continue;
      const score = dot / (docNorm * queryNorm);
      results.push({ doc, score });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(topK, 0));
  }

  private vectorize(text: string): SparseVector {
    const tokens = tokenize(text);
    const termCounts = new Map<string, number>();
    for (const token of tokens) {
      if (!this.idf.has(token)) continue;
      termCounts.set(token, (termCounts.get(token) || 0) + 1);
    }

    const totalTerms = Array.from(termCounts.values()).reduce(
      (sum, count) => sum + count,
      0,
    );

    const vector: SparseVector = new Map();
    for (const [token, count] of termCounts.entries()) {
      const tf = totalTerms > 0 ? count / totalTerms : 0;
      const idf = this.idf.get(token) || 0;
      const weight = tf * idf;
      if (weight > 0) {
        vector.set(token, weight);
      }
    }

    return vector;
  }
}
