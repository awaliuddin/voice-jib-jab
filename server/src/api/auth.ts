import { Router } from "express";
import type { ApiKeyStore } from "../services/ApiKeyStore.js";

/** Router for /auth — API key CRUD (create, list, rotate, revoke). */
export function createAuthRouter(store: ApiKeyStore): Router {
  const router = Router();

  router.post("/api-keys", (req, res) => {
    const { tenantId, description, ttlDays } = req.body as {
      tenantId?: string;
      description?: string;
      ttlDays?: number;
    };
    if (!tenantId || typeof tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    if (ttlDays !== undefined && (typeof ttlDays !== "number" || ttlDays <= 0)) {
      res.status(400).json({ error: "ttlDays must be a positive number" });
      return;
    }
    const result = store.createKey(tenantId, description ?? "", ttlDays);
    res.status(201).json(result);
  });

  // POST /auth/api-keys/:keyId/rotate — revoke existing key, issue a replacement with the
  // same tenantId/description and (optionally) a new TTL.
  router.post("/api-keys/:keyId/rotate", (req, res) => {
    const record = store.findRecord(req.params.keyId);
    if (!record) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    const { ttlDays } = req.body as { ttlDays?: number };
    if (ttlDays !== undefined && (typeof ttlDays !== "number" || ttlDays <= 0)) {
      res.status(400).json({ error: "ttlDays must be a positive number" });
      return;
    }
    store.revokeKey(req.params.keyId);
    const result = store.createKey(record.tenantId, record.description, ttlDays);
    res.status(201).json(result);
  });

  router.get("/api-keys", (req, res) => {
    const { tenantId } = req.query;
    if (!tenantId || typeof tenantId !== "string") {
      res.status(400).json({ error: "tenantId query param is required" });
      return;
    }
    res.json(store.listKeys(tenantId));
  });

  router.delete("/api-keys/:keyId", (req, res) => {
    const revoked = store.revokeKey(req.params.keyId);
    if (!revoked) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    res.status(204).send();
  });

  return router;
}
