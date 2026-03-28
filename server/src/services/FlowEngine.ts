/**
 * FlowEngine — in-memory conversation flow execution engine.
 *
 * Tracks per-session state as callers navigate through a ConversationFlow.
 * Condition matching uses case-insensitive substring search against caller
 * input. Sessions are held in memory only; they are lost on process restart.
 *
 * Usage:
 *   const engine = new FlowEngine(store);
 *   const { result } = engine.startSession(flowId);
 *   const step = engine.advance(result.sessionToken, "I need billing help");
 */

import { randomUUID } from "node:crypto";
import type { FlowStore, FlowNode } from "./FlowStore.js";

// ── Types ──────────────────────────────────────────────────────────────

/** Mutable state of an active conversation flow session. */
export interface FlowSessionState {
  sessionToken: string;
  flowId: string;
  tenantId: string | null;
  currentNodeId: string;
  /** Ordered list of nodeIds visited (entry node first). */
  history: string[];
  startedAt: string;
  ended: boolean;
}

/** Result of a flow step including current node, prompt, and transition info. */
export interface FlowStepResult {
  sessionToken: string;
  currentNode: FlowNode;
  prompt: string;
  /** true when currentNode.type === "end". */
  ended: boolean;
  /** Which transition condition fired. null if no condition matched or entry node. */
  matchedCondition: string | null;
}

// ── FlowEngine ─────────────────────────────────────────────────────────

/** In-memory conversation flow execution engine with session state tracking. */
export class FlowEngine {
  private sessions: Map<string, FlowSessionState> = new Map();

  constructor(private store: FlowStore) {}

  /**
   * Start a new flow session.
   *
   * Returns the initial session state plus the FlowStepResult for the entry
   * node. Throws if the flow is not found or the entry node is missing.
   */
  startSession(
    flowId: string,
    tenantId?: string,
  ): FlowSessionState & { result: FlowStepResult } {
    const flow = this.store.getFlow(flowId);
    if (!flow) {
      throw new Error(`Flow not found: ${flowId}`);
    }

    const entryNode = flow.nodes.find((n) => n.nodeId === flow.entryNodeId);
    if (!entryNode) {
      throw new Error(
        `Entry node "${flow.entryNodeId}" not found in flow "${flowId}"`,
      );
    }

    const sessionToken = randomUUID();
    const now = new Date().toISOString();

    const state: FlowSessionState = {
      sessionToken,
      flowId,
      tenantId: tenantId ?? null,
      currentNodeId: entryNode.nodeId,
      history: [entryNode.nodeId],
      startedAt: now,
      ended: entryNode.type === "end",
    };

    this.sessions.set(sessionToken, state);

    const result: FlowStepResult = {
      sessionToken,
      currentNode: entryNode,
      prompt: entryNode.prompt,
      ended: state.ended,
      matchedCondition: null,
    };

    return { ...state, result };
  }

  /**
   * Advance the flow session based on caller input.
   *
   * Transitions are checked in order — the first whose condition is a
   * case-insensitive substring of userInput wins. If no condition matches
   * and the current node is not type "end", the session stays on the current
   * node and matchedCondition is null. If the destination node is type "end",
   * the session is marked ended.
   *
   * Throws if sessionToken is unknown.
   */
  advance(sessionToken: string, userInput: string): FlowStepResult {
    const state = this.sessions.get(sessionToken);
    if (!state) {
      throw new Error(`Session not found: ${sessionToken}`);
    }

    const flow = this.store.getFlow(state.flowId);
    if (!flow) {
      throw new Error(`Flow not found: ${state.flowId}`);
    }

    const currentNode = flow.nodes.find((n) => n.nodeId === state.currentNodeId);
    if (!currentNode) {
      throw new Error(`Current node "${state.currentNodeId}" not found`);
    }

    // If already ended, return the current state.
    if (state.ended) {
      return {
        sessionToken,
        currentNode,
        prompt: currentNode.prompt,
        ended: true,
        matchedCondition: null,
      };
    }

    const lowerInput = userInput.toLowerCase();

    // Find the first matching transition.
    const matched = currentNode.transitions.find((t) =>
      lowerInput.includes(t.condition.toLowerCase()),
    );

    if (!matched) {
      // No match — stay on current node.
      return {
        sessionToken,
        currentNode,
        prompt: currentNode.prompt,
        ended: false,
        matchedCondition: null,
      };
    }

    // Advance to next node.
    const nextNode = flow.nodes.find((n) => n.nodeId === matched.nextNodeId);
    if (!nextNode) {
      throw new Error(
        `Transition target node "${matched.nextNodeId}" not found in flow "${state.flowId}"`,
      );
    }

    const ended = nextNode.type === "end";

    state.currentNodeId = nextNode.nodeId;
    state.history.push(nextNode.nodeId);
    state.ended = ended;

    return {
      sessionToken,
      currentNode: nextNode,
      prompt: nextNode.prompt,
      ended,
      matchedCondition: matched.condition,
    };
  }

  /** Get current session state. Returns undefined for unknown token. */
  getSession(sessionToken: string): FlowSessionState | undefined {
    return this.sessions.get(sessionToken);
  }

  /** End a session early. No-op for unknown token. */
  endSession(sessionToken: string): void {
    const state = this.sessions.get(sessionToken);
    if (state) {
      state.ended = true;
    }
  }

  /** List all active (not ended) sessions. */
  listActiveSessions(): FlowSessionState[] {
    return Array.from(this.sessions.values()).filter((s) => !s.ended);
  }
}
