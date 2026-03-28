/**
 * FlowStore — JSON-persisted store for conversation flows.
 *
 * A conversation flow is a directed graph of nodes. Each node delivers a
 * prompt and optionally transitions to a next node based on caller input.
 *
 * Usage:
 *   const store = initFlowStore("/path/to/flows.json");
 *   const flow = store.createFlow({ name: "Support Flow", ... });
 *   const found = store.getFlow(flow.flowId);
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────

/** Discriminator for conversation flow node behavior. */
export type FlowNodeType =
  | "greeting"
  | "intent_detection"
  | "routing"
  | "response"
  | "follow_up"
  | "end";

/** Conditional edge between flow nodes, matched against caller input. */
export interface FlowTransition {
  /** Keyword/pattern to match in caller input (substring, case-insensitive). */
  condition: string;
  nextNodeId: string;
}

/** A single node in a conversation flow with prompt text and transitions. */
export interface FlowNode {
  nodeId: string;
  type: FlowNodeType;
  /** Text to deliver at this node. */
  prompt: string;
  transitions: FlowTransition[];
  // If transitions is empty and type !== "end", it auto-advances (no input needed).
}

/** A complete conversation flow definition with its directed graph of nodes. */
export interface ConversationFlow {
  flowId: string;
  name: string;
  description: string;
  tenantId: string | null;
  entryNodeId: string;
  nodes: FlowNode[];
  createdAt: string;
  updatedAt: string;
}

// ── FlowStore ──────────────────────────────────────────────────────────

/** JSON-persisted CRUD store for conversation flow definitions. */
export class FlowStore {
  private flows: Map<string, ConversationFlow> = new Map();
  private storageFile: string;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.loadFromDisk();
  }

  // ── Private persistence helpers ────────────────────────────────────

  private loadFromDisk(): void {
    if (!existsSync(this.storageFile)) {
      return;
    }

    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      const flows = JSON.parse(raw) as ConversationFlow[];
      for (const flow of flows) {
        this.flows.set(flow.flowId, flow);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  private saveToDisk(): void {
    const dir = dirname(this.storageFile);
    mkdirSync(dir, { recursive: true });

    const flows = Array.from(this.flows.values());
    writeFileSync(this.storageFile, JSON.stringify(flows, null, 2), "utf-8");
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Create a new conversation flow. Persists immediately. */
  createFlow(
    data: Omit<ConversationFlow, "flowId" | "createdAt" | "updatedAt">,
  ): ConversationFlow {
    const now = new Date().toISOString();
    const flow: ConversationFlow = {
      ...data,
      flowId: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    this.flows.set(flow.flowId, flow);
    this.saveToDisk();
    return flow;
  }

  /** Get a single flow by id. Returns undefined if not found. */
  getFlow(flowId: string): ConversationFlow | undefined {
    return this.flows.get(flowId);
  }

  /**
   * List flows with optional tenant filter.
   *
   * When tenantId is provided, returns flows belonging to that tenant OR
   * global flows (tenantId === null). When omitted, returns all flows.
   */
  listFlows(tenantId?: string): ConversationFlow[] {
    const all = Array.from(this.flows.values());

    if (tenantId !== undefined) {
      return all.filter(
        (f) => f.tenantId === tenantId || f.tenantId === null,
      );
    }

    return all;
  }

  /** Patch an existing flow. Returns undefined if not found. */
  updateFlow(
    flowId: string,
    updates: Partial<Omit<ConversationFlow, "flowId" | "createdAt">>,
  ): ConversationFlow | undefined {
    const existing = this.flows.get(flowId);
    if (!existing) {
      return undefined;
    }

    const updated: ConversationFlow = {
      ...existing,
      ...updates,
      flowId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.flows.set(flowId, updated);
    this.saveToDisk();
    return updated;
  }

  /** Delete a flow. Returns false if not found. */
  deleteFlow(flowId: string): boolean {
    if (!this.flows.has(flowId)) {
      return false;
    }

    this.flows.delete(flowId);
    this.saveToDisk();
    return true;
  }
}

// ── Module-level singleton ─────────────────────────────────────────────

let _store: FlowStore | undefined;

/** Module-level singleton. Access after calling initFlowStore(). */
export const flowStore: FlowStore = new Proxy(
  {} as FlowStore,
  {
    get(_target, prop) {
      if (!_store) {
        throw new Error(
          "FlowStore not initialized. Call initFlowStore() first.",
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
export function initFlowStore(storageFile: string): FlowStore {
  _store = new FlowStore(storageFile);
  return _store;
}
