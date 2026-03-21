import { Router } from "express";
import type { ApiKeyStore } from "../services/ApiKeyStore.js";

export function createAuthRouter(store: ApiKeyStore): Router {
  const router = Router();

  router.post("/api-keys", (req, res) => {
    const { tenantId, description } = req.body as { tenantId?: string; description?: string };
    if (!tenantId || typeof tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    const result = store.createKey(tenantId, description ?? "");
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
