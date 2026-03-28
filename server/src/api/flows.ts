/**
 * Flows API Router
 *
 * Static paths are registered BEFORE parameterised /:flowId to prevent
 * route shadowing. Order matters:
 *
 * GET    /flows/sessions/:token              — get session state
 * POST   /flows/sessions/:token/advance      — advance session with user input
 * GET    /flows                              — list flows (?tenantId=)
 * POST   /flows                              — create flow
 * GET    /flows/:flowId                      — get single flow
 * PUT    /flows/:flowId                      — update flow (partial patch)
 * DELETE /flows/:flowId                      — delete flow (204)
 * POST   /flows/:flowId/start               — start a session for a flow
 */

import { Router } from "express";
import type { FlowStore } from "../services/FlowStore.js";
import { FlowEngine } from "../services/FlowEngine.js";
import type { FlowNodeType, FlowNode, FlowTransition } from "../services/FlowStore.js";

// ── Validation helpers ─────────────────────────────────────────────────

const VALID_NODE_TYPES: FlowNodeType[] = [
  "greeting",
  "intent_detection",
  "routing",
  "response",
  "follow_up",
  "end",
];

function isValidNodeType(value: unknown): value is FlowNodeType {
  return typeof value === "string" && (VALID_NODE_TYPES as string[]).includes(value);
}

function isValidTransition(value: unknown): value is FlowTransition {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return typeof t.condition === "string" && typeof t.nextNodeId === "string";
}

function isValidNode(value: unknown): value is FlowNode {
  if (typeof value !== "object" || value === null) return false;
  const n = value as Record<string, unknown>;
  if (typeof n.nodeId !== "string" || n.nodeId.trim() === "") return false;
  if (!isValidNodeType(n.type)) return false;
  if (typeof n.prompt !== "string" || n.prompt.trim() === "") return false;
  if (!Array.isArray(n.transitions)) return false;
  return n.transitions.every(isValidTransition);
}

// ── Router factory ─────────────────────────────────────────────────────

/** Router for /flows — conversation flow CRUD, session state management, and step advancement. */
export function createFlowsRouter(store: FlowStore, engine: FlowEngine): Router {
  const router = Router();

  // ── Sessions — registered BEFORE /:flowId ──────────────────────────

  /**
   * GET /sessions/:token — get session state.
   * Returns 404 if the token is unknown.
   */
  router.get("/sessions/:token", (req, res) => {
    const { token } = req.params;
    const session = engine.getSession(token);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  });

  /**
   * POST /sessions/:token/advance — advance session with user input.
   * Body: { userInput: string }
   * Returns FlowStepResult or 404 if unknown session.
   */
  router.post("/sessions/:token/advance", (req, res) => {
    const { token } = req.params;
    const body = req.body ?? {};

    if (typeof body.userInput !== "string") {
      res.status(400).json({ error: "userInput is required and must be a string" });
      return;
    }

    const session = engine.getSession(token);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    try {
      const result = engine.advance(token, body.userInput);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Flow collection ────────────────────────────────────────────────

  /**
   * GET / — list flows.
   * Query: tenantId (optional)
   */
  router.get("/", (req, res) => {
    const tenantId = typeof req.query.tenantId === "string"
      ? req.query.tenantId
      : undefined;

    const flows = store.listFlows(tenantId);
    res.json({ flows, count: flows.length });
  });

  /** POST / — create a new conversation flow. */
  router.post("/", (req, res) => {
    const body = req.body ?? {};

    // Validate name
    if (!body.name || typeof body.name !== "string") {
      res.status(400).json({ error: "name is required and must be a string" });
      return;
    }
    if (body.name.length > 100) {
      res.status(400).json({ error: "name must be 100 characters or fewer" });
      return;
    }

    // Validate nodes
    if (!Array.isArray(body.nodes) || body.nodes.length === 0) {
      res.status(400).json({ error: "nodes is required and must be a non-empty array" });
      return;
    }

    // Validate each node
    for (const node of body.nodes) {
      if (!isValidNode(node)) {
        res.status(400).json({
          error: `Invalid node: each node requires nodeId (string), type (${VALID_NODE_TYPES.join("|")}), prompt (string), and transitions (array)`,
        });
        return;
      }
    }

    // Validate unique nodeIds within the flow
    const nodeIds = (body.nodes as FlowNode[]).map((n) => n.nodeId);
    const uniqueNodeIds = new Set(nodeIds);
    if (uniqueNodeIds.size !== nodeIds.length) {
      res.status(400).json({ error: "nodeId values must be unique within the flow" });
      return;
    }

    // Validate entryNodeId
    if (!body.entryNodeId || typeof body.entryNodeId !== "string") {
      res.status(400).json({ error: "entryNodeId is required and must be a string" });
      return;
    }
    if (!uniqueNodeIds.has(body.entryNodeId)) {
      res.status(400).json({ error: "entryNodeId must reference an existing node in nodes" });
      return;
    }

    const flow = store.createFlow({
      name: body.name,
      description: typeof body.description === "string" ? body.description : "",
      tenantId: typeof body.tenantId === "string" ? body.tenantId : null,
      entryNodeId: body.entryNodeId,
      nodes: body.nodes as FlowNode[],
    });

    res.status(201).json(flow);
  });

  // ── Flow resource — parameterised routes ───────────────────────────

  /** GET /:flowId — get a single flow. */
  router.get("/:flowId", (req, res) => {
    const { flowId } = req.params;

    const flow = store.getFlow(flowId);
    if (!flow) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }

    res.json(flow);
  });

  /** PUT /:flowId — partially update a flow. */
  router.put("/:flowId", (req, res) => {
    const { flowId } = req.params;

    const existing = store.getFlow(flowId);
    if (!existing) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }

    const body = req.body ?? {};
    const patch: Parameters<typeof store.updateFlow>[1] = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        res.status(400).json({ error: "name must be a string" });
        return;
      }
      if (body.name.length > 100) {
        res.status(400).json({ error: "name must be 100 characters or fewer" });
        return;
      }
      patch.name = body.name;
    }

    if (body.description !== undefined) {
      if (typeof body.description !== "string") {
        res.status(400).json({ error: "description must be a string" });
        return;
      }
      patch.description = body.description;
    }

    if (body.tenantId !== undefined) {
      patch.tenantId = typeof body.tenantId === "string" ? body.tenantId : null;
    }

    if (body.nodes !== undefined) {
      if (!Array.isArray(body.nodes) || body.nodes.length === 0) {
        res.status(400).json({ error: "nodes must be a non-empty array" });
        return;
      }
      for (const node of body.nodes) {
        if (!isValidNode(node)) {
          res.status(400).json({ error: "Invalid node in nodes array" });
          return;
        }
      }
      patch.nodes = body.nodes as FlowNode[];
    }

    if (body.entryNodeId !== undefined) {
      if (typeof body.entryNodeId !== "string") {
        res.status(400).json({ error: "entryNodeId must be a string" });
        return;
      }
      // Validate that the entryNodeId references a real node (using updated nodes if provided).
      const nodesToCheck = patch.nodes ?? existing.nodes;
      const nodeIds = new Set(nodesToCheck.map((n) => n.nodeId));
      if (!nodeIds.has(body.entryNodeId)) {
        res.status(400).json({ error: "entryNodeId must reference an existing node" });
        return;
      }
      patch.entryNodeId = body.entryNodeId;
    }

    const updated = store.updateFlow(flowId, patch);
    if (!updated) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }

    res.json(updated);
  });

  /** DELETE /:flowId — delete a flow (204). */
  router.delete("/:flowId", (req, res) => {
    const { flowId } = req.params;

    const deleted = store.deleteFlow(flowId);
    if (!deleted) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }

    res.status(204).send();
  });

  /**
   * POST /:flowId/start — start a new flow session.
   * Body: { tenantId? }
   * Returns FlowStepResult + sessionToken.
   */
  router.post("/:flowId/start", (req, res) => {
    const { flowId } = req.params;
    const body = req.body ?? {};

    const tenantId = typeof body.tenantId === "string" ? body.tenantId : undefined;

    try {
      const { result } = engine.startSession(flowId, tenantId);
      res.status(201).json(result);
    } catch (err: unknown) {
      const message = (err as Error).message;
      if (message.startsWith("Flow not found")) {
        res.status(404).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  return router;
}
