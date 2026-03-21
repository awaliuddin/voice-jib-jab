import type { Request, Response, NextFunction } from "express";
import type { ApiKeyStore } from "../services/ApiKeyStore.js";

export function createApiKeyMiddleware(
  store: ApiKeyStore,
  enabled: boolean,
): (req: Request, res: Response, next: NextFunction) => void {
  return function requireApiKey(req: Request, res: Response, next: NextFunction): void {
    if (!enabled) {
      next();
      return;
    }
    const rawKey = req.headers["x-api-key"];
    if (!rawKey || typeof rawKey !== "string") {
      res.status(401).json({ error: "Missing X-API-Key header" });
      return;
    }
    const record = store.verifyKey(rawKey);
    if (!record) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }
    store.touchKey(record.keyId);
    (req as Request & { apiKeyTenantId: string }).apiKeyTenantId = record.tenantId;
    next();
  };
}
