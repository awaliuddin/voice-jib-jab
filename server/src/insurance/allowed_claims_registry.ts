/**
 * AllowedClaimsRegistry - Registry of approved claims that the system is permitted to make.
 *
 * Claims are loaded from a static JSON file (or injected at construction).
 * The registry supports exact-match lookup by claim ID and fuzzy text matching
 * against approved claim text to determine whether a proposed statement is
 * within the set of sanctioned assertions.
 *
 * Design decisions:
 * - Claims are immutable once loaded (no runtime mutations).
 * - Text matching is case-insensitive substring containment for the stub.
 *   A production implementation would use embedding-based similarity.
 * - Disallowed patterns are loaded alongside claims for policy enforcement.
 * - The registry is deliberately stateless per-session so it can be shared
 *   across sessions safely.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

interface AllowedClaimsCatalogEntry {
  id?: unknown;
  claim?: unknown;
  text?: unknown;
  source?: unknown;
  category?: unknown;
  evidence_ids?: unknown;
  disclaimer_ids?: unknown;
  required_disclaimer_id?: unknown;
  required_disclaimer_ids?: unknown;
  approved_by?: unknown;
  approved_date?: unknown;
  last_verified?: unknown;
}

interface AllowedClaimsCatalog {
  allowed_claims?: unknown;
  claims?: unknown;
  disallowed_patterns?: unknown;
}

export interface ApprovedClaim {
  id: string;
  text: string;
  source?: string;
  category?: string;
  requiredDisclaimerId?: string;
  requiredDisclaimerIds?: string[];
  lastVerified?: string; // ISO 8601 date
  metadata?: Record<string, unknown>;
}

export interface DisallowedPatternMatch {
  matched: boolean;
  patterns: string[];
}

export interface ClaimMatchResult {
  matched: boolean;
  claimId: string | null;
  confidence: number; // 0.0 – 1.0
  requiredDisclaimerId: string | null;
  matchType: "exact" | "partial" | "none";
}

export interface AllowedClaimsRegistryConfig {
  claims?: ApprovedClaim[];
  disallowedPatterns?: string[];
  partialMatchThreshold?: number; // minimum confidence for partial match (0.0–1.0)
  sourcePath?: string;
  knowledgeDir?: string;
  enableFileLoad?: boolean;
}

const DEFAULT_CONFIG: AllowedClaimsRegistryConfig = {
  claims: [],
  disallowedPatterns: [],
  partialMatchThreshold: 0.6,
  enableFileLoad: true,
};

export class AllowedClaimsRegistry {
  private claims: Map<string, ApprovedClaim>;
  private claimTexts: ApprovedClaim[]; // ordered list for text search
  private disallowedPatterns: string[];
  private disallowedPatternsLower: string[];
  private config: AllowedClaimsRegistryConfig;

  constructor(config: Partial<AllowedClaimsRegistryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.claims = new Map();
    this.claimTexts = [];

    let claims = Array.isArray(this.config.claims) ? this.config.claims : [];
    let disallowedPatterns = Array.isArray(this.config.disallowedPatterns)
      ? this.config.disallowedPatterns
      : [];

    if (
      this.config.enableFileLoad &&
      (claims.length === 0 || disallowedPatterns.length === 0)
    ) {
      const loaded = loadClaimsCatalog(this.config);
      if (claims.length === 0 && loaded.claims.length > 0) {
        claims = loaded.claims;
      }
      if (loaded.disallowedPatterns.length > 0) {
        disallowedPatterns = Array.from(
          new Set([...loaded.disallowedPatterns, ...disallowedPatterns]),
        );
      }
    }

    this.disallowedPatterns = disallowedPatterns;
    this.disallowedPatternsLower = disallowedPatterns.map((pattern) =>
      pattern.toLowerCase(),
    );

    for (const claim of claims) {
      this.claims.set(claim.id, claim);
      this.claimTexts.push(claim);
    }
  }

  /**
   * Look up a claim by its canonical ID.
   */
  getById(claimId: string): ApprovedClaim | null {
    return this.claims.get(claimId) ?? null;
  }

  /**
   * Check whether text contains any disallowed patterns.
   */
  matchDisallowedPatterns(text: string): DisallowedPatternMatch {
    if (!text) {
      return { matched: false, patterns: [] };
    }

    const lowered = text.toLowerCase();
    const matches: string[] = [];

    for (let i = 0; i < this.disallowedPatternsLower.length; i++) {
      const patternLower = this.disallowedPatternsLower[i];
      if (patternLower && lowered.includes(patternLower)) {
        matches.push(this.disallowedPatterns[i]);
      }
    }

    return { matched: matches.length > 0, patterns: matches };
  }

  /**
   * Check whether proposed text matches any approved claim.
   *
   * Stub implementation: case-insensitive substring containment.
   * Production: replace with embedding cosine-similarity search.
   */
  matchText(proposedText: string): ClaimMatchResult {
    const normalised = proposedText.toLowerCase().trim();

    // Pass 1: exact match (normalised)
    for (const claim of this.claimTexts) {
      if (claim.text.toLowerCase().trim() === normalised) {
        return {
          matched: true,
          claimId: claim.id,
          confidence: 1.0,
          requiredDisclaimerId: claim.requiredDisclaimerId ?? null,
          matchType: "exact",
        };
      }
    }

    // Pass 2: partial containment (stub heuristic)
    let bestMatch: ApprovedClaim | null = null;
    let bestScore = 0;

    for (const claim of this.claimTexts) {
      const claimLower = claim.text.toLowerCase();
      // Simple word-overlap ratio as stub confidence metric
      const proposedWords = new Set(normalised.split(/\s+/));
      const claimWords = claimLower.split(/\s+/);
      const overlapCount = claimWords.filter((w) =>
        proposedWords.has(w),
      ).length;
      const score = claimWords.length > 0 ? overlapCount / claimWords.length : 0;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = claim;
      }
    }

    if (bestMatch && bestScore >= (this.config.partialMatchThreshold ?? 0.6)) {
      return {
        matched: true,
        claimId: bestMatch.id,
        confidence: bestScore,
        requiredDisclaimerId: bestMatch.requiredDisclaimerId ?? null,
        matchType: "partial",
      };
    }

    return {
      matched: false,
      claimId: null,
      confidence: bestScore,
      requiredDisclaimerId: null,
      matchType: "none",
    };
  }

  /**
   * Return all registered claims (for diagnostics / audit).
   */
  getAllClaims(): ApprovedClaim[] {
    return [...this.claimTexts];
  }

  /**
   * Return all disallowed claim patterns.
   */
  getDisallowedPatterns(): string[] {
    return [...this.disallowedPatterns];
  }

  /**
   * Number of registered claims.
   */
  get size(): number {
    return this.claims.size;
  }
}

function loadClaimsCatalog(
  config: AllowedClaimsRegistryConfig,
): { claims: ApprovedClaim[]; disallowedPatterns: string[] } {
  const catalogPath = resolveClaimsPath(config);
  if (!catalogPath) {
    return { claims: [], disallowedPatterns: [] };
  }

  try {
    const raw = readFileSync(catalogPath, "utf-8");
    const parsed = JSON.parse(raw) as AllowedClaimsCatalog;
    const rawClaims = Array.isArray(parsed.allowed_claims)
      ? parsed.allowed_claims
      : Array.isArray(parsed.claims)
        ? parsed.claims
        : [];
    const disallowedPatterns = toStringArray(parsed.disallowed_patterns);

    const claims: ApprovedClaim[] = [];
    for (const entry of rawClaims) {
      const claim = normalizeClaimEntry(entry);
      if (claim) {
        claims.push(claim);
      }
    }

    return { claims, disallowedPatterns };
  } catch (error) {
    console.error("[AllowedClaimsRegistry] Failed to load claims:", error);
    return { claims: [], disallowedPatterns: [] };
  }
}

function resolveClaimsPath(
  config: AllowedClaimsRegistryConfig,
): string | null {
  const candidates: string[] = [];

  if (config.sourcePath) {
    candidates.push(config.sourcePath);
  }

  const knowledgeDir = config.knowledgeDir || process.env.KNOWLEDGE_DIR;
  if (knowledgeDir) {
    candidates.push(resolve(knowledgeDir, "allowed_claims.json"));
  }

  const cwd = process.cwd();
  candidates.push(resolve(cwd, "knowledge", "allowed_claims.json"));
  candidates.push(resolve(cwd, "..", "knowledge", "allowed_claims.json"));

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  console.warn(
    `[AllowedClaimsRegistry] allowed_claims.json not found. Looked in: ${candidates.join(
      ", ",
    )}`,
  );

  return null;
}

function normalizeClaimEntry(entry: unknown): ApprovedClaim | null {
  if (!entry || typeof entry !== "object") {
    console.warn("[AllowedClaimsRegistry] Skipping invalid claim entry", entry);
    return null;
  }

  const record = entry as AllowedClaimsCatalogEntry;
  const id =
    typeof record.id === "string" ? record.id.trim() : undefined;
  const textCandidate =
    typeof record.text === "string"
      ? record.text
      : typeof record.claim === "string"
        ? record.claim
        : undefined;

  if (!id || !textCandidate || textCandidate.trim().length === 0) {
    console.warn("[AllowedClaimsRegistry] Skipping invalid claim entry", entry);
    return null;
  }

  const disclaimerIds = toStringArray(
    record.required_disclaimer_ids ?? record.disclaimer_ids,
  );
  const requiredDisclaimerId =
    typeof record.required_disclaimer_id === "string"
      ? record.required_disclaimer_id
      : disclaimerIds[0];

  const evidenceIds = toStringArray(record.evidence_ids);
  const approvedBy =
    typeof record.approved_by === "string" ? record.approved_by : undefined;
  const source =
    typeof record.source === "string"
      ? record.source
      : buildSource(evidenceIds, approvedBy);
  const lastVerified =
    typeof record.last_verified === "string"
      ? record.last_verified
      : typeof record.approved_date === "string"
        ? record.approved_date
        : undefined;
  const category =
    typeof record.category === "string" ? record.category : undefined;

  return {
    id,
    text: textCandidate.trim(),
    source,
    category,
    requiredDisclaimerId: requiredDisclaimerId?.trim() || undefined,
    requiredDisclaimerIds: disclaimerIds,
    lastVerified,
    metadata: {
      evidence_ids: evidenceIds,
      approved_by: approvedBy,
      approved_date: record.approved_date,
    },
  };
}

function buildSource(evidenceIds: string[], approvedBy?: string): string {
  const tokens = [...evidenceIds];
  if (approvedBy && approvedBy.trim().length > 0) {
    tokens.push(approvedBy.trim());
  }
  if (tokens.length === 0) {
    return "allowed_claims.json";
  }
  return tokens.join(", ");
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
