/**
 * AgentTemplateStore — Agent template management with built-in defaults.
 *
 * Provides built-in (hardcoded) and custom (persisted) agent templates.
 * Built-in templates are always available in memory and never written to disk.
 * Custom templates are stored in a single JSON file and loaded on init.
 *
 * Usage:
 *   const store = initAgentTemplateStore("/path/to/templates.json");
 *   const tpl = store.getTemplate("builtin-customer-support");
 *   const custom = store.createTemplate({ name: "My Agent", ... });
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────

export type PersonaType = "customer_support" | "sales" | "tech_support" | "receptionist" | "custom";

export interface EscalationRules {
  escalateOnFrustration: boolean;
  escalateOnKeywords: string[];
  maxTurnsBeforeEscalate: number | null;
}

export interface AgentTemplate {
  templateId: string;
  name: string;
  persona: PersonaType;
  builtIn: boolean;
  greeting: string;
  claims: string[];
  disallowedPatterns: string[];
  moderationSensitivity: "low" | "medium" | "high";
  ttsVoice: string;
  escalationRules: EscalationRules;
  createdAt: string;
  tenantId: string | null;
}

// ── Built-in Templates ────────────────────────────────────────────────

export const BUILTIN_TEMPLATES: AgentTemplate[] = [
  {
    templateId: "builtin-customer-support",
    name: "Customer Support",
    persona: "customer_support",
    builtIn: true,
    greeting: "Thank you for calling, how can I help you today?",
    claims: ["account issues", "billing", "refunds", "order status", "product information"],
    disallowedPatterns: ["competitor pricing", "legal advice", "medical advice"],
    moderationSensitivity: "medium",
    ttsVoice: "nova",
    escalationRules: {
      escalateOnFrustration: true,
      escalateOnKeywords: ["manager", "supervisor", "escalate"],
      maxTurnsBeforeEscalate: 20,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    tenantId: null,
  },
  {
    templateId: "builtin-sales",
    name: "Sales",
    persona: "sales",
    builtIn: true,
    greeting: "Hi there! I'd love to help you find the perfect solution for your needs.",
    claims: ["product features", "pricing", "trials", "demos", "integrations", "case studies"],
    disallowedPatterns: ["competitor bashing", "false claims", "pressure tactics"],
    moderationSensitivity: "low",
    ttsVoice: "alloy",
    escalationRules: {
      escalateOnFrustration: false,
      escalateOnKeywords: ["contract", "legal", "compliance"],
      maxTurnsBeforeEscalate: null,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    tenantId: null,
  },
  {
    templateId: "builtin-tech-support",
    name: "Tech Support",
    persona: "tech_support",
    builtIn: true,
    greeting: "Tech support here. What issue are you experiencing today?",
    claims: ["troubleshooting", "configuration", "installation", "error codes", "network issues", "security"],
    disallowedPatterns: ["data deletion", "root access", "password sharing"],
    moderationSensitivity: "high",
    ttsVoice: "onyx",
    escalationRules: {
      escalateOnFrustration: true,
      escalateOnKeywords: ["outage", "data loss", "breach", "urgent"],
      maxTurnsBeforeEscalate: 15,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    tenantId: null,
  },
  {
    templateId: "builtin-receptionist",
    name: "Receptionist",
    persona: "receptionist",
    builtIn: true,
    greeting: "Good day! How may I direct your call?",
    claims: ["office hours", "contact information", "appointments", "directions", "general inquiries"],
    disallowedPatterns: ["personnel details", "internal systems", "confidential information"],
    moderationSensitivity: "medium",
    ttsVoice: "shimmer",
    escalationRules: {
      escalateOnFrustration: true,
      escalateOnKeywords: ["emergency", "urgent", "complaint"],
      maxTurnsBeforeEscalate: 10,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    tenantId: null,
  },
];

// ── AgentTemplateStore ────────────────────────────────────────────────

export class AgentTemplateStore {
  private templates: Map<string, AgentTemplate> = new Map();
  private storageFile: string;

  constructor(storageFile: string) {
    this.storageFile = storageFile;

    // Load built-ins into memory
    for (const tpl of BUILTIN_TEMPLATES) {
      this.templates.set(tpl.templateId, tpl);
    }

    // Load custom templates from disk if the file exists
    this.loadFromDisk();
  }

  // ── Private persistence helpers ───────────────────────────────────

  /** Load custom templates from the JSON file into memory. */
  private loadFromDisk(): void {
    if (!existsSync(this.storageFile)) {
      return;
    }

    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      const customs = JSON.parse(raw) as AgentTemplate[];
      for (const tpl of customs) {
        this.templates.set(tpl.templateId, tpl);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  /** Persist only custom templates to disk (built-ins are never written). */
  private saveToDisk(): void {
    const dir = dirname(this.storageFile);
    mkdirSync(dir, { recursive: true });

    const customs: AgentTemplate[] = [];
    for (const tpl of this.templates.values()) {
      if (!tpl.builtIn) {
        customs.push(tpl);
      }
    }

    writeFileSync(this.storageFile, JSON.stringify(customs, null, 2), "utf-8");
  }

  // ── Public API ────────────────────────────────────────────────────

  /** Get a single template by id. */
  getTemplate(templateId: string): AgentTemplate | undefined {
    return this.templates.get(templateId);
  }

  /** List templates with optional tenantId and persona filters. */
  listTemplates(opts?: { tenantId?: string; persona?: PersonaType }): AgentTemplate[] {
    let results = Array.from(this.templates.values());

    if (opts?.tenantId) {
      results = results.filter(
        (tpl) => tpl.builtIn || tpl.tenantId === opts.tenantId,
      );
    }

    if (opts?.persona) {
      results = results.filter((tpl) => tpl.persona === opts.persona);
    }

    return results;
  }

  /** Create a new custom template. Persists immediately. */
  createTemplate(
    opts: Omit<AgentTemplate, "templateId" | "createdAt" | "builtIn">,
  ): AgentTemplate {
    const template: AgentTemplate = {
      ...opts,
      templateId: randomUUID(),
      builtIn: false,
      createdAt: new Date().toISOString(),
    };

    this.templates.set(template.templateId, template);
    this.saveToDisk();
    return template;
  }

  /** Update a custom template. Returns undefined if built-in or not found. */
  updateTemplate(
    templateId: string,
    patch: Partial<Omit<AgentTemplate, "templateId" | "builtIn" | "createdAt">>,
  ): AgentTemplate | undefined {
    const existing = this.templates.get(templateId);
    if (!existing) {
      return undefined;
    }

    if (existing.builtIn) {
      return undefined;
    }

    const updated: AgentTemplate = { ...existing, ...patch, templateId, builtIn: false, createdAt: existing.createdAt };
    this.templates.set(templateId, updated);
    this.saveToDisk();
    return updated;
  }

  /** Delete a custom template. Returns false if built-in or not found. */
  deleteTemplate(templateId: string): boolean {
    const existing = this.templates.get(templateId);
    if (!existing) {
      return false;
    }

    if (existing.builtIn) {
      return false;
    }

    this.templates.delete(templateId);
    this.saveToDisk();
    return true;
  }

  /** Get session configuration derived from a template. */
  getSessionConfig(templateId: string): {
    greeting: string;
    ttsVoice: string;
    moderationSensitivity: "low" | "medium" | "high";
    claims: string[];
    disallowedPatterns: string[];
    escalationRules: EscalationRules;
  } | undefined {
    const tpl = this.templates.get(templateId);
    if (!tpl) {
      return undefined;
    }

    return {
      greeting: tpl.greeting,
      ttsVoice: tpl.ttsVoice,
      moderationSensitivity: tpl.moderationSensitivity,
      claims: [...tpl.claims],
      disallowedPatterns: [...tpl.disallowedPatterns],
      escalationRules: { ...tpl.escalationRules, escalateOnKeywords: [...tpl.escalationRules.escalateOnKeywords] },
    };
  }
}

// ── Module-level singleton ────────────────────────────────────────────

let _store: AgentTemplateStore | null = null;

/** Module-level singleton. Access after calling initAgentTemplateStore(). */
export const agentTemplateStore: AgentTemplateStore = new Proxy(
  {} as AgentTemplateStore,
  {
    get(_target, prop) {
      if (!_store) {
        throw new Error(
          "AgentTemplateStore not initialized. Call initAgentTemplateStore() first.",
        );
      }
      const value = (_store as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(_store);
      }
      return value;
    },
  },
);

/** Initialize the module-level singleton with a storage file path. */
export function initAgentTemplateStore(storageFile: string): AgentTemplateStore {
  _store = new AgentTemplateStore(storageFile);
  return _store;
}
