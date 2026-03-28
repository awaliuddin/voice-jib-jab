import type { Request, Response, NextFunction } from "express";
import type { ApiKeyStore } from "../services/ApiKeyStore.js";
import type { AuditEventLogger } from "../services/AuditEventLogger.js";

/** Create Express middleware that validates the X-API-Key header against the key store. */
export function createApiKeyMiddleware(
  store: ApiKeyStore,
  enabled: boolean,
  auditLogger?: AuditEventLogger,
): (req: Request, res: Response, next: NextFunction) => void {
  return function requireApiKey(req: Request, res: Response, next: NextFunction): void {
    if (!enabled) {
      next();
      return;
    }
    const rawKey = req.headers["x-api-key"];
    const ipAddress = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    const method = req.method;
    if (!rawKey || typeof rawKey !== "string") {
      auditLogger?.log({ type: "api_key_rejected", detail: { reason: "missing_header", path: req.path, ipAddress, method } });
      res.status(401).json({ error: "Missing X-API-Key header" });
      return;
    }
    const record = store.verifyKey(rawKey);
    if (!record) {
      // Distinguish expired vs invalid: hash the key to find a matching (but expired) record
      const expiredRecord = store.findExpiredRecord(rawKey);
      const reason = expiredRecord ? "expired" : "invalid_key";
      const keyId = expiredRecord?.keyId;
      auditLogger?.log({ type: "api_key_rejected", detail: { reason, path: req.path, ipAddress, method, ...(keyId ? { keyId } : {}) } });
      res.status(401).json({ error: reason === "expired" ? "API key expired" : "Invalid API key" });
      return;
    }
    store.touchKey(record.keyId);
    auditLogger?.log({ type: "api_key_used", tenantId: record.tenantId, detail: { keyId: record.keyId, path: req.path, ipAddress, method } });
    (req as Request & { apiKeyTenantId: string }).apiKeyTenantId = record.tenantId;
    next();
  };
}
