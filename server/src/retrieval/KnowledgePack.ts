/**
 * KnowledgePack loader for NextGen AI facts + disclaimers.
 */

import { readFileSync } from "fs";

export interface KnowledgeFact {
  id: string;
  text: string;
  source: string;
  timestamp: string;
  category?: string;
}

export interface DisclaimerEntry {
  id: string;
  text: string;
  category?: string;
  required_for?: string[];
}

export class KnowledgePack {
  facts: KnowledgeFact[] = [];
  disclaimers: DisclaimerEntry[] = [];

  constructor(
    private factsPath: string,
    private disclaimersPath?: string,
  ) {}

  load(): void {
    this.facts = this.loadFacts(this.factsPath);
    if (this.disclaimersPath) {
      this.disclaimers = this.loadDisclaimers(this.disclaimersPath);
    }
  }

  private loadFacts(path: string): KnowledgeFact[] {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split(/\r?\n/);
    const facts: KnowledgeFact[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as KnowledgeFact;
        if (parsed.id && parsed.text) {
          facts.push(parsed);
        }
      } catch (error) {
        console.warn("[KnowledgePack] Skipping invalid fact line:", error);
      }
    }

    return facts;
  }

  private loadDisclaimers(path: string): DisclaimerEntry[] {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { disclaimers?: DisclaimerEntry[] };
    return parsed.disclaimers || [];
  }
}
