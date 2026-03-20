/**
 * SkillStore — modular agent skill definitions with auto-suggest.
 *
 * Skills are capabilities an agent can invoke during a live session
 * (customer lookup, order status, scheduling, etc.).  Each skill carries a set
 * of trigger phrases; given a caller utterance, suggestSkills() uses token-
 * overlap scoring (same algorithm as LiveKbSearchService) to surface the most
 * relevant skills.
 *
 * Persistence: single JSON file at the path given to initSkillStore().
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { v4 as uuidv4 } from "uuid";

// ── Types ──────────────────────────────────────────────────────────────

export type SkillCategory =
  | "customer_lookup"
  | "order_management"
  | "scheduling"
  | "knowledge_retrieval"
  | "escalation"
  | "custom";

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  required: boolean;
  description: string;
}

export interface Skill {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  /** Phrases that suggest this skill should be invoked. */
  triggerPhrases: string[];
  parameters: SkillParameter[];
  /** External endpoint to call when the skill is invoked. */
  webhookUrl?: string;
  enabled: boolean;
  /** null / undefined = global skill available to all tenants. */
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export interface SkillSuggestion {
  skill: Skill;
  /** 0–1 relevance score. */
  score: number;
  /** The trigger phrase that produced the highest overlap score. */
  matchedPhrase: string;
}

// ── Stop words (matches LiveKbSearchService) ───────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "i", "we", "you", "it",
  "to", "of", "in", "on", "at", "for", "with", "my", "your", "our",
  "can", "do", "does", "did", "have", "has", "had", "be", "been",
  "will", "would", "could", "should", "what", "how", "when", "where",
  "why", "who",
]);

// ── Persistence format ─────────────────────────────────────────────────

interface StorageFormat {
  skills: Skill[];
}

// ── SkillStore ─────────────────────────────────────────────────────────

export class SkillStore {
  private storageFile: string;
  private data: StorageFormat;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.data = this.load();
  }

  // ── Persistence ─────────────────────────────────────────────────────

  private load(): StorageFormat {
    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      return JSON.parse(raw) as StorageFormat;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { skills: [] };
      }
      throw err;
    }
  }

  private save(): void {
    mkdirSync(dirname(this.storageFile), { recursive: true });
    writeFileSync(this.storageFile, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // ── CRUD ────────────────────────────────────────────────────────────

  /**
   * Create a new skill.
   *
   * Validates that name is non-empty and triggerPhrases is a non-empty array.
   * Assigns a UUID skillId, ISO timestamps, and usageCount=0.
   *
   * @throws {Error} when name is empty
   * @throws {Error} when triggerPhrases is empty
   */
  createSkill(
    data: Omit<Skill, "skillId" | "createdAt" | "updatedAt" | "usageCount">,
  ): Skill {
    if (!data.name || data.name.trim() === "") {
      throw new Error("name is required and must be non-empty");
    }
    if (!Array.isArray(data.triggerPhrases) || data.triggerPhrases.length === 0) {
      throw new Error("triggerPhrases must be a non-empty array");
    }

    const now = new Date().toISOString();
    const skill: Skill = {
      ...data,
      skillId: uuidv4(),
      createdAt: now,
      updatedAt: now,
      usageCount: 0,
    };

    this.data.skills.push(skill);
    this.save();
    return skill;
  }

  /**
   * Find a skill by its ID.
   *
   * @param skillId - The skill UUID
   * @returns The skill or undefined if not found
   */
  getSkill(skillId: string): Skill | undefined {
    return this.data.skills.find((s) => s.skillId === skillId);
  }

  /**
   * List skills with optional filtering.
   *
   * tenantId filter includes global skills (tenantId null/undefined) plus
   * skills belonging to that specific tenant.  Without a tenantId filter all
   * skills are returned.
   *
   * Results are sorted by name ascending.
   *
   * @param opts - Optional filters: tenantId, category, enabled
   * @returns Filtered and sorted skill array
   */
  listSkills(opts?: {
    tenantId?: string;
    category?: SkillCategory;
    enabled?: boolean;
  }): Skill[] {
    let skills = [...this.data.skills];

    if (opts?.tenantId !== undefined) {
      skills = skills.filter(
        (s) => s.tenantId == null || s.tenantId === opts.tenantId,
      );
    }

    if (opts?.category !== undefined) {
      skills = skills.filter((s) => s.category === opts.category);
    }

    if (opts?.enabled !== undefined) {
      skills = skills.filter((s) => s.enabled === opts.enabled);
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Partially update a skill by ID.
   *
   * Updates updatedAt automatically.  skillId and createdAt are immutable.
   * usageCount can only be changed via incrementUsage().
   *
   * @param skillId - The skill to update
   * @param updates - Fields to update
   * @returns The updated skill, or undefined if not found
   */
  updateSkill(
    skillId: string,
    updates: Partial<Omit<Skill, "skillId" | "createdAt" | "usageCount">>,
  ): Skill | undefined {
    const skill = this.data.skills.find((s) => s.skillId === skillId);
    if (!skill) {
      return undefined;
    }

    Object.assign(skill, updates, { updatedAt: new Date().toISOString() });
    this.save();
    return skill;
  }

  /**
   * Delete a skill by ID.
   *
   * @param skillId - The skill to remove
   * @returns true if deleted, false if not found
   */
  deleteSkill(skillId: string): boolean {
    const index = this.data.skills.findIndex((s) => s.skillId === skillId);
    if (index === -1) {
      return false;
    }
    this.data.skills.splice(index, 1);
    this.save();
    return true;
  }

  /**
   * Increment the usageCount for a skill by 1.
   *
   * No-op if the skill does not exist.
   *
   * @param skillId - The skill to increment
   */
  incrementUsage(skillId: string): void {
    const skill = this.data.skills.find((s) => s.skillId === skillId);
    if (!skill) {
      return;
    }
    skill.usageCount += 1;
    this.save();
  }

  // ── Auto-suggest ────────────────────────────────────────────────────

  /**
   * Suggest skills relevant to the given caller utterance.
   *
   * Scoring (per skill):
   *   - Tokenize the utterance into non-stop-word terms (lowercase).
   *   - For each trigger phrase, compute token-overlap ratio:
   *       overlap = matching tokens / total utterance tokens
   *   - The skill score is the maximum overlap across all trigger phrases.
   *   - Skills with score = 0 are excluded.
   *
   * The returned suggestions are sorted by score descending and capped at
   * maxResults (default 3).
   *
   * @param utterance   - Caller transcript text
   * @param tenantId    - Tenant context (includes global skills)
   * @param maxResults  - Maximum suggestions to return (default 3)
   * @returns Sorted, capped suggestion array
   */
  suggestSkills(
    utterance: string,
    tenantId?: string,
    maxResults = 3,
  ): SkillSuggestion[] {
    const utteranceTokens = this.tokenize(utterance);
    if (utteranceTokens.length === 0) {
      return [];
    }

    const candidates = this.listSkills({
      enabled: true,
      tenantId,
    });

    const suggestions: SkillSuggestion[] = [];

    for (const skill of candidates) {
      let bestScore = 0;
      let bestPhrase = "";

      for (const phrase of skill.triggerPhrases) {
        const phraseTokens = this.tokenize(phrase);
        if (phraseTokens.length === 0) continue;

        // Count how many utterance tokens appear in the phrase tokens
        const matchCount = utteranceTokens.filter((t) =>
          phraseTokens.includes(t),
        ).length;

        const overlap = matchCount / utteranceTokens.length;
        if (overlap > bestScore) {
          bestScore = overlap;
          bestPhrase = phrase;
        }
      }

      if (bestScore > 0) {
        suggestions.push({ skill, score: bestScore, matchedPhrase: bestPhrase });
      }
    }

    suggestions.sort((a, b) => b.score - a.score);
    return suggestions.slice(0, maxResults);
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Tokenize text: lowercase, strip punctuation, remove stop words.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  }
}

// ── Singleton factory ──────────────────────────────────────────────────

let _instance: SkillStore | undefined;

/**
 * Initialize the module-level SkillStore singleton.
 *
 * @param storageFile - Absolute path to the JSON persistence file
 * @returns The initialized SkillStore instance
 */
export function initSkillStore(storageFile: string): SkillStore {
  _instance = new SkillStore(storageFile);
  return _instance;
}

/**
 * Module-level singleton proxy.
 *
 * Delegates all method calls to the instance created by initSkillStore().
 * Throws if the store has not been initialized.
 */
export const skillStore: SkillStore = new Proxy({} as SkillStore, {
  get(_target, prop) {
    if (!_instance) {
      throw new Error(
        "SkillStore not initialized — call initSkillStore() first",
      );
    }
    const value = (_instance as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(_instance);
    }
    return value;
  },
});
