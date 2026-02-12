/**
 * Retrieval Service for NextGen AI knowledge pack.
 * Loads JSONL facts, indexes them, and returns compact facts packs.
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { KnowledgePack, KnowledgeFact, DisclaimerEntry } from "./KnowledgePack.js";
import { VectorStore, VectorDocument } from "./VectorStore.js";

export interface FactsPack {
  topic: string;
  facts: Array<{
    id: string;
    text: string;
    source: string;
    timestamp: string;
  }>;
  disclaimers: string[];
}

export interface RetrievalServiceOptions {
  knowledgeDir?: string;
  factsPath?: string;
  disclaimersPath?: string;
  topK?: number;
  maxTokens?: number;
  maxBytes?: number;
}

const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_TOKENS = 600;
const DEFAULT_MAX_BYTES = 4000;
const MAX_TOPIC_CHARS = 120;

export class RetrievalService {
  private readonly vectorStore = new VectorStore<KnowledgeFact>();
  private knowledgePack: KnowledgePack | null = null;
  private disclaimerMap: Map<string, DisclaimerEntry> = new Map();
  private requirementMap: Map<string, string[]> = new Map();
  private ready = false;
  private topK: number;
  private maxTokens: number;
  private maxBytes: number;
  private knowledgeDir?: string;
  private factsPath?: string;
  private disclaimersPath?: string;

  constructor(options: RetrievalServiceOptions = {}) {
    this.topK = options.topK ?? DEFAULT_TOP_K;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.knowledgeDir = options.knowledgeDir;
    this.factsPath = options.factsPath;
    this.disclaimersPath = options.disclaimersPath;

    this.load();
  }

  isReady(): boolean {
    return this.ready;
  }

  getDefaults(): { topK: number; maxTokens: number; maxBytes: number } {
    return { topK: this.topK, maxTokens: this.maxTokens, maxBytes: this.maxBytes };
  }

  retrieveFactsPack(
    query: string,
    overrides: RetrievalServiceOptions = {},
  ): FactsPack {
    if (!this.ready || !this.knowledgePack) {
      return {
        topic: "NextGen AI",
        facts: [],
        disclaimers: [],
      };
    }

    const cleanedQuery = query.trim();
    const topic = (cleanedQuery || "NextGen AI").slice(0, MAX_TOPIC_CHARS);
    const topK = overrides.topK ?? this.topK;
    const maxTokens = overrides.maxTokens ?? this.maxTokens;
    const maxBytes = overrides.maxBytes ?? this.maxBytes;

    const results = cleanedQuery
      ? this.vectorStore.search(cleanedQuery, topK)
      : [];
    const rawFacts = results.map((result) => result.doc.metadata);
    const packFacts = rawFacts.map((fact) => this.toPackFact(fact));

    const disclaimers = this.selectDisclaimerIds(rawFacts, cleanedQuery);

    const pack: FactsPack = {
      topic,
      facts: [],
      disclaimers: [...disclaimers],
    };

    // Ensure base pack fits. If not, drop disclaimers.
    if (!this.fitsCaps(pack, maxTokens, maxBytes)) {
      pack.disclaimers = [];
    }

    // Add facts until cap would be exceeded.
    for (const fact of packFacts) {
      const candidate: FactsPack = {
        topic: pack.topic,
        facts: [...pack.facts, fact],
        disclaimers: pack.disclaimers,
      };
      if (this.fitsCaps(candidate, maxTokens, maxBytes)) {
        pack.facts.push(fact);
      } else {
        break;
      }
    }

    // Final safety trim if still over limits.
    this.trimToCaps(pack, maxTokens, maxBytes);
    return pack;
  }

  lookupDisclaimer(disclaimerId: string): string | null {
    return this.disclaimerMap.get(disclaimerId)?.text || null;
  }

  private load(): void {
    try {
      const factsPath =
        this.factsPath ||
        this.resolveKnowledgeFile("nxtg_facts.jsonl", false);
      if (!factsPath) {
        throw new Error("[Retrieval] Facts file path resolved to empty");
      }

      const disclaimersPath =
        this.disclaimersPath ||
        this.resolveKnowledgeFile("disclaimers.json", true);

      this.knowledgePack = new KnowledgePack(factsPath, disclaimersPath);
      this.knowledgePack.load();

      const docs: VectorDocument<KnowledgeFact>[] = this.knowledgePack.facts.map(
        (fact) => ({
          id: fact.id,
          text: fact.text,
          metadata: fact,
        }),
      );
      this.vectorStore.index(docs);

      this.disclaimerMap = new Map(
        this.knowledgePack.disclaimers.map((entry) => [entry.id, entry]),
      );
      this.requirementMap = this.buildRequirementMap(
        this.knowledgePack.disclaimers,
      );

      this.ready = true;
      console.log(
        `[Retrieval] Loaded ${this.knowledgePack.facts.length} facts`,
      );
    } catch (error) {
      this.ready = false;
      console.error("[Retrieval] Failed to load knowledge pack:", error);
    }
  }

  private resolveKnowledgeFile(
    fileName: string,
    optional: boolean,
  ): string | undefined {
    const knowledgeDir =
      this.knowledgeDir || process.env.KNOWLEDGE_DIR || undefined;

    const candidates: string[] = [];
    if (knowledgeDir) {
      candidates.push(resolve(knowledgeDir, fileName));
    }
    const cwd = process.cwd();
    candidates.push(resolve(cwd, "knowledge", fileName));
    candidates.push(resolve(cwd, "..", "knowledge", fileName));

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    if (optional) {
      console.warn(
        `[Retrieval] Optional knowledge file not found: ${fileName}`,
      );
      return undefined;
    }

    throw new Error(
      `[Retrieval] Knowledge file not found: ${fileName}. Tried: ${candidates.join(
        ", ",
      )}`,
    );
  }

  private buildRequirementMap(
    disclaimers: DisclaimerEntry[],
  ): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const disclaimer of disclaimers) {
      const requirements = disclaimer.required_for || [];
      for (const requirement of requirements) {
        const list = map.get(requirement) || [];
        list.push(disclaimer.id);
        map.set(requirement, list);
      }
    }
    return map;
  }

  private selectDisclaimerIds(
    facts: KnowledgeFact[],
    query: string,
  ): string[] {
    const required = new Set<string>();

    // Always include general session disclaimers if present.
    required.add("all_sessions");

    const queryLower = query.toLowerCase();
    if (queryLower.includes("performance") || queryLower.includes("latency")) {
      required.add("performance_claims");
    }

    for (const fact of facts) {
      const category = fact.category;
      if (!category) continue;
      if (category === "performance") {
        required.add("performance_claims");
      }
      if (category === "medical") required.add("medical");
      if (category === "legal") required.add("legal");
      if (category === "financial") required.add("financial");
    }

    const ids = new Set<string>();
    for (const requirement of required) {
      const matches = this.requirementMap.get(requirement) || [];
      for (const id of matches) {
        ids.add(id);
      }
    }

    return Array.from(ids);
  }

  private fitsCaps(
    pack: FactsPack,
    maxTokens: number,
    maxBytes: number,
  ): boolean {
    const json = JSON.stringify(pack);
    const bytes = Buffer.byteLength(json, "utf8");
    const tokens = Math.ceil(json.length / 4);
    return bytes <= maxBytes && tokens <= maxTokens;
  }

  private trimToCaps(
    pack: FactsPack,
    maxTokens: number,
    maxBytes: number,
  ): void {
    if (this.fitsCaps(pack, maxTokens, maxBytes)) return;

    // Drop facts until within limits.
    while (pack.facts.length > 0 && !this.fitsCaps(pack, maxTokens, maxBytes)) {
      pack.facts.pop();
    }

    // Drop disclaimers if still too large.
    while (
      pack.disclaimers.length > 0 &&
      !this.fitsCaps(pack, maxTokens, maxBytes)
    ) {
      pack.disclaimers.pop();
    }

    // As a last resort, trim topic length.
    if (!this.fitsCaps(pack, maxTokens, maxBytes) && pack.topic.length > 0) {
      pack.topic = pack.topic.slice(0, Math.max(0, MAX_TOPIC_CHARS / 2));
    }
  }

  private toPackFact(fact: KnowledgeFact): FactsPack["facts"][number] {
    return {
      id: fact.id,
      text: fact.text,
      source: fact.source,
      timestamp: fact.timestamp,
    };
  }
}
