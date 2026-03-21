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
