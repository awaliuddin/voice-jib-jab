/**
 * IVR API Router
 *
 * GET    /ivr/menus                       — list menus (?tenantId=)
 * POST   /ivr/menus                       — create menu
 * GET    /ivr/menus/:menuId               — get menu
 * PUT    /ivr/menus/:menuId               — update menu
 * DELETE /ivr/menus/:menuId               — delete menu (204)
 * POST   /ivr/menus/:menuId/process       — process DTMF/voice input
 *                                           body: { nodeId, input }
 *                                           returns: { nextNode, prompt, digit? }
 */

import { Router } from "express";
import type { IvrMenuStore, IvrNode, IvrNodeRef } from "../services/IvrMenuStore.js";
import { DtmfDetector } from "../services/DtmfDetector.js";

// ── Validation helpers ─────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIvrNodeRef(ref: unknown): ref is IvrNodeRef {
  return isRecord(ref)
    && typeof (ref as Record<string, unknown>).nodeId === "string"
    && typeof (ref as Record<string, unknown>).label === "string";
}

function isValidIvrNode(node: unknown): node is IvrNode {
  if (!isRecord(node)) return false;
  const n = node as Record<string, unknown>;

  if (typeof n.nodeId !== "string") return false;
  if (!["menu", "transfer", "message"].includes(n.type as string)) return false;
  if (typeof n.prompt !== "string") return false;

  if (n.options !== undefined) {
    if (!isRecord(n.options)) return false;
    for (const ref of Object.values(n.options)) {
      if (!isValidIvrNodeRef(ref)) return false;
    }
  }

  if (n.targetTemplateId !== undefined && typeof n.targetTemplateId !== "string") {
    return false;
  }

  return true;
}

function isValidNodesMap(nodes: unknown): nodes is Record<string, IvrNode> {
  if (!isRecord(nodes)) return false;
  for (const node of Object.values(nodes)) {
    if (!isValidIvrNode(node)) return false;
  }
  return true;
}

// ── Router factory ─────────────────────────────────────────────────────

/** Router for /ivr — IVR menu CRUD and DTMF/voice input processing. */
export function createIvrRouter(store: IvrMenuStore): Router {
  const router = Router();
  const detector = new DtmfDetector();

  /** GET /menus — list IVR menus with optional tenantId filter. */
  router.get("/menus", (req, res) => {
    const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    const menus = store.listMenus(tenantId !== undefined ? { tenantId } : undefined);
    res.json({ menus, count: menus.length });
  });

  /** POST /menus — create a new IVR menu. */
  router.post("/menus", (req, res) => {
    const body = req.body ?? {};

    if (!body.name || typeof body.name !== "string") {
      res.status(400).json({ error: "name is required and must be a string" });
      return;
    }

    if (!body.rootNodeId || typeof body.rootNodeId !== "string") {
      res.status(400).json({ error: "rootNodeId is required and must be a string" });
      return;
    }

    if (body.nodes === undefined || !isValidNodesMap(body.nodes)) {
      res.status(400).json({ error: "nodes is required and must be a valid node map" });
      return;
    }

    const menu = store.createMenu({
      name: body.name,
      tenantId: typeof body.tenantId === "string" ? body.tenantId : null,
      rootNodeId: body.rootNodeId,
      nodes: body.nodes,
    });

    res.status(201).json(menu);
  });

  /** GET /menus/:menuId — get a single IVR menu. */
  router.get("/menus/:menuId", (req, res) => {
    const menu = store.getMenu(req.params.menuId);
    if (!menu) {
      res.status(404).json({ error: "Menu not found" });
      return;
    }
    res.json(menu);
  });

  /** PUT /menus/:menuId — update an IVR menu. */
  router.put("/menus/:menuId", (req, res) => {
    const existing = store.getMenu(req.params.menuId);
    if (!existing) {
      res.status(404).json({ error: "Menu not found" });
      return;
    }

    const body = req.body ?? {};
    const patch: { name?: string; rootNodeId?: string; nodes?: Record<string, IvrNode> } = {};

    if (body.name !== undefined && typeof body.name === "string") {
      patch.name = body.name;
    }

    if (body.rootNodeId !== undefined && typeof body.rootNodeId === "string") {
      patch.rootNodeId = body.rootNodeId;
    }

    if (body.nodes !== undefined) {
      if (!isValidNodesMap(body.nodes)) {
        res.status(400).json({ error: "nodes must be a valid node map" });
        return;
      }
      patch.nodes = body.nodes;
    }

    const updated = store.updateMenu(req.params.menuId, patch);
    if (!updated) {
      res.status(404).json({ error: "Menu not found" });
      return;
    }

    res.json(updated);
  });

  /** DELETE /menus/:menuId — delete an IVR menu (204). */
  router.delete("/menus/:menuId", (req, res) => {
    const deleted = store.deleteMenu(req.params.menuId);
    if (!deleted) {
      res.status(404).json({ error: "Menu not found" });
      return;
    }
    res.status(204).send();
  });

  /**
   * POST /menus/:menuId/process — process voice/DTMF input.
   *
   * Body: { nodeId: string, input: string }
   * Returns: { nextNode, prompt, digit? }
   * Returns 422 if no digit is detected in the input.
   */
  router.post("/menus/:menuId/process", (req, res) => {
    const body = req.body ?? {};

    if (!body.nodeId || typeof body.nodeId !== "string") {
      res.status(400).json({ error: "nodeId is required and must be a string" });
      return;
    }

    if (body.input === undefined || typeof body.input !== "string") {
      res.status(400).json({ error: "input is required and must be a string" });
      return;
    }

    const detection = detector.detect(body.input);
    if (!detection.detected || detection.digit === undefined) {
      res.status(422).json({ error: "No DTMF digit detected in input", input: body.input });
      return;
    }

    const result = store.processInput(req.params.menuId, body.nodeId, detection.digit);
    if (!result) {
      res.status(404).json({ error: "Menu, node, or digit option not found" });
      return;
    }

    res.json({
      nextNode: result.nextNode,
      prompt: result.prompt,
      digit: detection.digit,
    });
  });

  return router;
}
