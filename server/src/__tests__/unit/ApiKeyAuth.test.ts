/**
 * ApiKeyAuth Tests
 *
 * Covers ApiKeyStore service, createApiKeyMiddleware, and createAuthRouter.
 * HTTP transport uses a plain Node http helper (no supertest dependency).
 * File isolation via OS temp dirs.
 */

import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { ApiKeyStore } from "../../services/ApiKeyStore.js";
import { createApiKeyMiddleware } from "../../middleware/apiKeyAuth.js";
import { createAuthRouter } from "../../api/auth.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeTmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "vjj-apikeys-"));
  return join(dir, "keys.json");
}

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string | number> = {
      ...(headers ?? {}),
    };
    if (payload) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(payload);
    }
    import("http").then(({ default: http }) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: addr.port, path, method, headers: reqHeaders },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf-8");
            resolve({ status: res.statusCode ?? 0, body: rawBody, json: () => JSON.parse(rawBody) });
          });
        },
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function buildAuthApp(store: ApiKeyStore): { app: Express; server: Server } {
  const app = express();
  app.use(express.json());
  app.use("/auth", createAuthRouter(store));
  const server = createServer(app);
  return { app, server };
}

function startServer(server: Server): Promise<void> {
  return new Promise((r) => server.listen(0, "127.0.0.1", r));
}

function stopServer(server: Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

// ── ApiKeyStore ───────────────────────────────────────────────────────────

describe("ApiKeyStore", () => {
  let store: ApiKeyStore;
  let filePath: string;

  beforeEach(() => {
    filePath = makeTmpFile();
    store = new ApiKeyStore(filePath);
  });

  describe("createKey()", () => {
    it("returns rawKey matching vjj_ prefix + 64 hex chars", () => {
      const result = store.createKey("tenant1", "my key");
      expect(result.rawKey).toMatch(/^vjj_[0-9a-f]{64}$/);
    });

    it("returns unique keys on multiple calls", () => {
      const a = store.createKey("tenant1", "key A");
      const b = store.createKey("tenant1", "key B");
      expect(a.rawKey).not.toBe(b.rawKey);
      expect(a.keyId).not.toBe(b.keyId);
    });

    it("returns correct tenantId and description", () => {
      const result = store.createKey("acme", "test key");
      expect(result.tenantId).toBe("acme");
      expect(result.description).toBe("test key");
    });

    it("stores hashed key in file, not raw", () => {
      const result = store.createKey("tenant1", "desc");
      const data = JSON.parse(readFileSync(filePath, "utf8")) as { keys: Array<{ keyHash: string }> };
      expect(data.keys[0].keyHash).not.toBe(result.rawKey);
      expect(data.keys[0].keyHash).toHaveLength(64);
    });

    it("does not include keyHash in CreateApiKeyResult", () => {
      const result = store.createKey("t1", "d");
      expect(result).not.toHaveProperty("keyHash");
    });
  });

  describe("verifyKey()", () => {
    it("returns record for valid key", () => {
      const created = store.createKey("tenant1", "desc");
      const record = store.verifyKey(created.rawKey);
      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe("tenant1");
    });

    it("returns null for invalid key", () => {
      store.createKey("tenant1", "desc");
      expect(store.verifyKey("vjj_badkey")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(store.verifyKey("")).toBeNull();
    });

    it("returns null after key is revoked", () => {
      const created = store.createKey("tenant1", "desc");
      store.revokeKey(created.keyId);
      expect(store.verifyKey(created.rawKey)).toBeNull();
    });
  });

  describe("listKeys()", () => {
    it("returns keys for matching tenantId", () => {
      store.createKey("tenant1", "key 1");
      store.createKey("tenant1", "key 2");
      store.createKey("tenant2", "other");
      const keys = store.listKeys("tenant1");
      expect(keys).toHaveLength(2);
    });

    it("returns empty array for unknown tenant", () => {
      expect(store.listKeys("nobody")).toEqual([]);
    });

    it("does not include keyHash in returned records", () => {
      store.createKey("tenant1", "k");
      const keys = store.listKeys("tenant1");
      expect(keys[0]).not.toHaveProperty("keyHash");
    });

    it("filters to matching tenantId only", () => {
      store.createKey("a", "k");
      store.createKey("b", "k");
      const keys = store.listKeys("a");
      expect(keys.every((k) => k.tenantId === "a")).toBe(true);
    });
  });

  describe("revokeKey()", () => {
    it("returns true and removes the key", () => {
      const created = store.createKey("tenant1", "d");
      const result = store.revokeKey(created.keyId);
      expect(result).toBe(true);
      expect(store.listKeys("tenant1")).toHaveLength(0);
    });

    it("returns false for unknown keyId", () => {
      expect(store.revokeKey("nonexistent")).toBe(false);
    });

    it("only removes the specified key", () => {
      const a = store.createKey("t1", "a");
      store.createKey("t1", "b");
      store.revokeKey(a.keyId);
      expect(store.listKeys("t1")).toHaveLength(1);
    });
  });

  describe("touchKey()", () => {
    it("updates lastUsedAt", () => {
      const created = store.createKey("tenant1", "d");
      expect(store.listKeys("tenant1")[0].lastUsedAt).toBeUndefined();
      store.touchKey(created.keyId);
      expect(store.listKeys("tenant1")[0].lastUsedAt).toBeDefined();
    });

    it("is a no-op for unknown keyId", () => {
      expect(() => store.touchKey("unknown")).not.toThrow();
    });
  });

  describe("persistence", () => {
    it("loads keys from file on construction", () => {
      const created = store.createKey("tenant1", "persistent");
      const store2 = new ApiKeyStore(filePath);
      const record = store2.verifyKey(created.rawKey);
      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe("tenant1");
    });

    it("handles missing file gracefully", () => {
      const store2 = new ApiKeyStore("/tmp/nonexistent-vjj-apikeys.json");
      expect(store2.listKeys("t1")).toEqual([]);
    });

    it("handles corrupt file gracefully", () => {
      writeFileSync(filePath, "not json");
      const store2 = new ApiKeyStore(filePath);
      expect(store2.listKeys("t1")).toEqual([]);
    });
  });
});

// ── createApiKeyMiddleware() ──────────────────────────────────────────────

describe("createApiKeyMiddleware()", () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    store = new ApiKeyStore(makeTmpFile());
  });

  it("passes through when enabled=false, no header provided", () => {
    const mw = createApiKeyMiddleware(store, false);
    const req = { headers: {} } as unknown as Parameters<typeof mw>[0];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Parameters<typeof mw>[1];
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when enabled=true and X-API-Key is missing", () => {
    const mw = createApiKeyMiddleware(store, true);
    const req = { headers: {} } as unknown as Parameters<typeof mw>[0];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Parameters<typeof mw>[1];
    const next = jest.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when enabled=true and key is invalid", () => {
    const mw = createApiKeyMiddleware(store, true);
    const req = { headers: { "x-api-key": "vjj_badkey" } } as unknown as Parameters<typeof mw>[0];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Parameters<typeof mw>[1];
    const next = jest.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and attaches apiKeyTenantId for valid key", () => {
    const created = store.createKey("acme", "test");
    const mw = createApiKeyMiddleware(store, true);
    const req = { headers: { "x-api-key": created.rawKey } } as unknown as Parameters<typeof mw>[0];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Parameters<typeof mw>[1];
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as unknown as Record<string, unknown>).apiKeyTenantId).toBe("acme");
  });

  it("calls touchKey() when key is valid", () => {
    const created = store.createKey("acme", "test");
    const touchSpy = jest.spyOn(store, "touchKey");
    const mw = createApiKeyMiddleware(store, true);
    const req = { headers: { "x-api-key": created.rawKey } } as unknown as Parameters<typeof mw>[0];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Parameters<typeof mw>[1];
    const next = jest.fn();
    mw(req, res, next);
    expect(touchSpy).toHaveBeenCalledWith(created.keyId);
  });
});

// ── createAuthRouter() ────────────────────────────────────────────────────

describe("createAuthRouter()", () => {
  let store: ApiKeyStore;
  let server: Server;

  beforeEach(async () => {
    store = new ApiKeyStore(makeTmpFile());
    ({ server } = buildAuthApp(store));
    await startServer(server);
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe("POST /auth/api-keys", () => {
    it("returns 400 when tenantId is missing", async () => {
      const res = await httpRequest(server, "POST", "/auth/api-keys", { description: "test" });
      expect(res.status).toBe(400);
    });

    it("returns 201 with rawKey on success", async () => {
      const res = await httpRequest(server, "POST", "/auth/api-keys", { tenantId: "acme", description: "my key" });
      expect(res.status).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(String(body.rawKey)).toMatch(/^vjj_/);
      expect(body.keyId).toBeDefined();
      expect(body.tenantId).toBe("acme");
    });

    it("uses empty description when not provided", async () => {
      const res = await httpRequest(server, "POST", "/auth/api-keys", { tenantId: "t1" });
      expect(res.status).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body.description).toBe("");
    });

    it("does not expose keyHash in response", async () => {
      const res = await httpRequest(server, "POST", "/auth/api-keys", { tenantId: "t1", description: "d" });
      const body = res.json() as Record<string, unknown>;
      expect(body).not.toHaveProperty("keyHash");
    });
  });

  describe("GET /auth/api-keys", () => {
    it("returns 400 without tenantId query param", async () => {
      const res = await httpRequest(server, "GET", "/auth/api-keys");
      expect(res.status).toBe(400);
    });

    it("returns keys array for tenantId", async () => {
      store.createKey("acme", "k1");
      store.createKey("acme", "k2");
      const res = await httpRequest(server, "GET", "/auth/api-keys?tenantId=acme");
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });

    it("does not include keyHash in response", async () => {
      store.createKey("acme", "k1");
      const res = await httpRequest(server, "GET", "/auth/api-keys?tenantId=acme");
      const body = res.json() as Array<Record<string, unknown>>;
      expect(body[0]).not.toHaveProperty("keyHash");
    });

    it("returns empty array for tenant with no keys", async () => {
      const res = await httpRequest(server, "GET", "/auth/api-keys?tenantId=nobody");
      expect(res.status).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("DELETE /auth/api-keys/:keyId", () => {
    it("returns 204 on successful revocation", async () => {
      const created = store.createKey("acme", "k");
      const res = await httpRequest(server, "DELETE", `/auth/api-keys/${created.keyId}`);
      expect(res.status).toBe(204);
    });

    it("returns 404 for unknown keyId", async () => {
      const res = await httpRequest(server, "DELETE", "/auth/api-keys/nonexistent");
      expect(res.status).toBe(404);
    });

    it("key is no longer valid after revocation", async () => {
      const created = store.createKey("acme", "k");
      await httpRequest(server, "DELETE", `/auth/api-keys/${created.keyId}`);
      expect(store.verifyKey(created.rawKey)).toBeNull();
    });
  });

  describe("Integration", () => {
    it("multiple keys per tenant work independently", () => {
      const a = store.createKey("t1", "a");
      const b = store.createKey("t1", "b");
      expect(store.verifyKey(a.rawKey)).not.toBeNull();
      expect(store.verifyKey(b.rawKey)).not.toBeNull();
    });

    it("revoking one key does not affect other keys for same tenant", () => {
      const a = store.createKey("t1", "a");
      const b = store.createKey("t1", "b");
      store.revokeKey(a.keyId);
      expect(store.verifyKey(a.rawKey)).toBeNull();
      expect(store.verifyKey(b.rawKey)).not.toBeNull();
    });

    it("rawKey only returned on creation, not in listKeys", () => {
      store.createKey("t1", "k");
      const keys = store.listKeys("t1");
      expect(keys[0]).not.toHaveProperty("rawKey");
    });
  });
});

// ── N-31: TTL / Expiry tests ──────────────────────────────────────────────

describe("ApiKeyStore — TTL / Expiry (N-31)", () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    store = new ApiKeyStore(makeTmpFile());
  });

  describe("createKey() with ttlDays", () => {
    it("sets expiresAt when ttlDays provided", () => {
      const result = store.createKey("t1", "d", 30);
      expect(result.expiresAt).toBeDefined();
      const expiry = new Date(result.expiresAt!).getTime();
      expect(expiry).toBeGreaterThan(Date.now());
    });

    it("expiresAt is ~ttlDays from now", () => {
      const result = store.createKey("t1", "d", 1);
      const expiry = new Date(result.expiresAt!).getTime();
      const expectedMin = Date.now() + 23 * 3600 * 1000;
      const expectedMax = Date.now() + 25 * 3600 * 1000;
      expect(expiry).toBeGreaterThan(expectedMin);
      expect(expiry).toBeLessThan(expectedMax);
    });

    it("expiresAt is absent when ttlDays not provided", () => {
      const result = store.createKey("t1", "d");
      expect(result.expiresAt).toBeUndefined();
    });

    it("expiresAt is absent when ttlDays is undefined", () => {
      const result = store.createKey("t1", "d", undefined);
      expect(result.expiresAt).toBeUndefined();
    });
  });

  describe("verifyKey() expiry enforcement", () => {
    it("returns record for non-expired key", () => {
      const created = store.createKey("t1", "d", 30);
      expect(store.verifyKey(created.rawKey)).not.toBeNull();
    });

    it("returns null for expired key", () => {
      // Create a key that expires 1ms in the past by manipulating the record directly
      const created = store.createKey("t1", "d", 30);
      const record = store["keys"].find((k: { keyId: string }) => k.keyId === created.keyId)!;
      record.expiresAt = new Date(Date.now() - 1000).toISOString();
      expect(store.verifyKey(created.rawKey)).toBeNull();
    });

    it("returns record for key with no expiry set", () => {
      const created = store.createKey("t1", "no-ttl");
      expect(store.verifyKey(created.rawKey)).not.toBeNull();
    });
  });

  describe("isExpired()", () => {
    it("returns false for non-expired key", () => {
      const created = store.createKey("t1", "d", 30);
      expect(store.isExpired(created.keyId)).toBe(false);
    });

    it("returns true for expired key", () => {
      const created = store.createKey("t1", "d", 30);
      const record = store["keys"].find((k: { keyId: string }) => k.keyId === created.keyId)!;
      record.expiresAt = new Date(Date.now() - 1000).toISOString();
      expect(store.isExpired(created.keyId)).toBe(true);
    });

    it("returns false for key with no expiry", () => {
      const created = store.createKey("t1", "no-ttl");
      expect(store.isExpired(created.keyId)).toBe(false);
    });

    it("returns false for unknown keyId", () => {
      expect(store.isExpired("nonexistent")).toBe(false);
    });
  });

  describe("findRecord()", () => {
    it("returns record without keyHash for known keyId", () => {
      const created = store.createKey("t1", "d");
      const rec = store.findRecord(created.keyId);
      expect(rec).not.toBeNull();
      expect(rec!.keyId).toBe(created.keyId);
      expect(rec).not.toHaveProperty("keyHash");
    });

    it("returns null for unknown keyId", () => {
      expect(store.findRecord("unknown")).toBeNull();
    });
  });

  describe("findExpiredRecord()", () => {
    it("returns record for an expired key's raw value", () => {
      const created = store.createKey("t1", "d", 30);
      const record = store["keys"].find((k: { keyId: string }) => k.keyId === created.keyId)!;
      record.expiresAt = new Date(Date.now() - 1000).toISOString();
      const found = store.findExpiredRecord(created.rawKey);
      expect(found).not.toBeNull();
      expect(found!.keyId).toBe(created.keyId);
    });

    it("returns null for a valid (non-expired) key", () => {
      const created = store.createKey("t1", "d", 30);
      expect(store.findExpiredRecord(created.rawKey)).toBeNull();
    });

    it("returns null for unknown raw key", () => {
      expect(store.findExpiredRecord("vjj_unknown")).toBeNull();
    });

    it("returns null for key with no expiry", () => {
      const created = store.createKey("t1", "no-ttl");
      expect(store.findExpiredRecord(created.rawKey)).toBeNull();
    });
  });
});

// ── N-36: Audit Event Enrichment ─────────────────────────────────────────

describe("createApiKeyMiddleware() — audit enrichment (N-36)", () => {
  let store: ApiKeyStore;

  function makeReq(
    headers: Record<string, string>,
    overrides: Partial<{ ip: string; socketRemoteAddress: string; method: string; path: string }> = {},
  ) {
    return {
      headers,
      ip: overrides.ip ?? "10.0.0.1",
      socket: { remoteAddress: overrides.socketRemoteAddress ?? "10.0.0.2" },
      method: overrides.method ?? "GET",
      path: overrides.path ?? "/admin",
    } as unknown as Parameters<ReturnType<typeof createApiKeyMiddleware>>[0];
  }

  function makeRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Parameters<ReturnType<typeof createApiKeyMiddleware>>[1];
  }

  beforeEach(() => {
    store = new ApiKeyStore(makeTmpFile());
  });

  it("logs ipAddress from req.ip on missing_header rejection", () => {
    const auditLogger = { log: jest.fn() };
    const mw = createApiKeyMiddleware(store, true, auditLogger as never);
    mw(makeReq({}, { ip: "192.168.1.1" }), makeRes(), jest.fn());
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ ipAddress: "192.168.1.1" }) }),
    );
  });

  it("logs method on missing_header rejection", () => {
    const auditLogger = { log: jest.fn() };
    const mw = createApiKeyMiddleware(store, true, auditLogger as never);
    mw(makeReq({}, { method: "POST" }), makeRes(), jest.fn());
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ method: "POST" }) }),
    );
  });

  it("falls back to socket.remoteAddress when req.ip is undefined", () => {
    const auditLogger = { log: jest.fn() };
    const mw = createApiKeyMiddleware(store, true, auditLogger as never);
    const req = {
      headers: {},
      ip: undefined,
      socket: { remoteAddress: "172.16.0.1" },
      method: "GET",
      path: "/admin",
    } as unknown as Parameters<ReturnType<typeof createApiKeyMiddleware>>[0];
    mw(req, makeRes(), jest.fn());
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ ipAddress: "172.16.0.1" }) }),
    );
  });

  it("falls back to 'unknown' when both req.ip and socket.remoteAddress are undefined", () => {
    const auditLogger = { log: jest.fn() };
    const mw = createApiKeyMiddleware(store, true, auditLogger as never);
    const req = {
      headers: {},
      ip: undefined,
      socket: { remoteAddress: undefined },
      method: "DELETE",
      path: "/admin",
    } as unknown as Parameters<ReturnType<typeof createApiKeyMiddleware>>[0];
    mw(req, makeRes(), jest.fn());
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ ipAddress: "unknown" }) }),
    );
  });

  it("logs ipAddress and method on invalid_key rejection", () => {
    const auditLogger = { log: jest.fn() };
    const mw = createApiKeyMiddleware(store, true, auditLogger as never);
    mw(makeReq({ "x-api-key": "vjj_invalid" }, { ip: "1.2.3.4", method: "PUT" }), makeRes(), jest.fn());
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ reason: "invalid_key", ipAddress: "1.2.3.4", method: "PUT" }),
      }),
    );
  });

  it("logs keyId on expired key rejection", () => {
    const created = store.createKey("t1", "d", 30);
    const record = store["keys"].find((k: { keyId: string }) => k.keyId === created.keyId)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();
    const auditLogger = { log: jest.fn() };
    const mw = createApiKeyMiddleware(store, true, auditLogger as never);
    mw(makeReq({ "x-api-key": created.rawKey }), makeRes(), jest.fn());
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ reason: "expired", keyId: created.keyId }),
      }),
    );
  });

  it("does NOT include keyId on invalid_key rejection", () => {
    const auditLogger = { log: jest.fn() };
    const mw = createApiKeyMiddleware(store, true, auditLogger as never);
    mw(makeReq({ "x-api-key": "vjj_invalid" }), makeRes(), jest.fn());
    const loggedDetail = (auditLogger.log as jest.Mock).mock.calls[0][0].detail as Record<string, unknown>;
    expect(loggedDetail).not.toHaveProperty("keyId");
  });

  it("logs ipAddress, method, and keyId on api_key_used event", () => {
    const created = store.createKey("acme", "test");
    const auditLogger = { log: jest.fn() };
    const mw = createApiKeyMiddleware(store, true, auditLogger as never);
    mw(makeReq({ "x-api-key": created.rawKey }, { ip: "10.1.2.3", method: "DELETE" }), makeRes(), jest.fn());
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "api_key_used",
        detail: expect.objectContaining({ keyId: created.keyId, ipAddress: "10.1.2.3", method: "DELETE" }),
      }),
    );
  });

  it("does not log audit events when auditLogger is not provided", () => {
    // Should not throw even without auditLogger
    const mw = createApiKeyMiddleware(store, true);
    expect(() => mw(makeReq({}), makeRes(), jest.fn())).not.toThrow();
  });

  it("logs path in all audit events", () => {
    const auditLogger = { log: jest.fn() };
    const mw = createApiKeyMiddleware(store, true, auditLogger as never);
    mw(makeReq({}, { path: "/tenants" }), makeRes(), jest.fn());
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ path: "/tenants" }) }),
    );
  });
});

describe("createApiKeyMiddleware() — expiry (N-31)", () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    store = new ApiKeyStore(makeTmpFile());
  });

  it("returns 401 with 'API key expired' message for expired key", () => {
    const created = store.createKey("acme", "d", 30);
    const record = store["keys"].find((k: { keyId: string }) => k.keyId === created.keyId)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();
    const mw = createApiKeyMiddleware(store, true);
    const req = { headers: { "x-api-key": created.rawKey }, path: "/admin" } as unknown as Parameters<typeof mw>[0];
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Parameters<typeof mw>[1];
    const next = jest.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    const jsonArg = (res.json as jest.Mock).mock.calls[0][0] as { error: string };
    expect(jsonArg.error).toContain("expired");
    expect(next).not.toHaveBeenCalled();
  });
});

describe("createAuthRouter() — TTL + rotate (N-31)", () => {
  let store: ApiKeyStore;
  let server: Server;

  beforeEach(async () => {
    store = new ApiKeyStore(makeTmpFile());
    ({ server } = buildAuthApp(store));
    await startServer(server);
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe("POST /auth/api-keys with ttlDays", () => {
    it("returns expiresAt when ttlDays provided", async () => {
      const res = await httpRequest(server, "POST", "/auth/api-keys", { tenantId: "t1", ttlDays: 30 });
      expect(res.status).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body.expiresAt).toBeDefined();
    });

    it("returns 400 when ttlDays is 0", async () => {
      const res = await httpRequest(server, "POST", "/auth/api-keys", { tenantId: "t1", ttlDays: 0 });
      expect(res.status).toBe(400);
    });

    it("returns 400 when ttlDays is negative", async () => {
      const res = await httpRequest(server, "POST", "/auth/api-keys", { tenantId: "t1", ttlDays: -5 });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /auth/api-keys/:keyId/rotate", () => {
    it("returns 201 with a new rawKey", async () => {
      const original = store.createKey("acme", "my key");
      const res = await httpRequest(server, "POST", `/auth/api-keys/${original.keyId}/rotate`, {});
      expect(res.status).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(String(body.rawKey)).toMatch(/^vjj_/);
      expect(body.rawKey).not.toBe(original.rawKey);
    });

    it("revokes the original key", async () => {
      const original = store.createKey("acme", "my key");
      await httpRequest(server, "POST", `/auth/api-keys/${original.keyId}/rotate`, {});
      expect(store.verifyKey(original.rawKey)).toBeNull();
    });

    it("new key preserves tenantId and description", async () => {
      const original = store.createKey("acme", "my key");
      const res = await httpRequest(server, "POST", `/auth/api-keys/${original.keyId}/rotate`, {});
      const body = res.json() as Record<string, unknown>;
      expect(body.tenantId).toBe("acme");
      expect(body.description).toBe("my key");
    });

    it("returns 404 for unknown keyId", async () => {
      const res = await httpRequest(server, "POST", "/auth/api-keys/nonexistent/rotate", {});
      expect(res.status).toBe(404);
    });

    it("accepts ttlDays for the replacement key", async () => {
      const original = store.createKey("acme", "my key");
      const res = await httpRequest(server, "POST", `/auth/api-keys/${original.keyId}/rotate`, { ttlDays: 90 });
      expect(res.status).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body.expiresAt).toBeDefined();
    });
  });
});
