/**
 * Admin API Tests
 *
 * Tests the TenantRegistry, SystemConfigStore, and /admin/* HTTP endpoints.
 * Follows the MetricsEndpoint.test.ts pattern: builds a standalone Express app
 * with injected dependencies to avoid importing index.ts (startup side effects).
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { TenantRegistry } from "../../services/TenantRegistry.js";
import { SystemConfigStore } from "../../services/SystemConfigStore.js";
import { createAdminRouter } from "../../api/admin.js";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, unlinkSync, existsSync } from "fs";

// ── HTTP helpers ──────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload).toString() } : {}),
      },
    };

    import("http").then(({ default: http }) => {
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: rawBody,
            json: () => JSON.parse(rawBody),
          });
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ── Test setup helpers ────────────────────────────────────────────────

function buildTestApp(
  registry: TenantRegistry,
  configStore: SystemConfigStore,
): Express {
  const app = express();
  app.use(express.json());
  app.use("/admin", createAdminRouter(registry, configStore));
  return app;
}

function tempPath(name: string): string {
  return join(tmpdir(), `admin-api-test-${name}-${Date.now()}.json`);
}

// ── Unit Tests: TenantRegistry ────────────────────────────────────────

describe("TenantRegistry", () => {
  let registry: TenantRegistry;
  let filePath: string;

  beforeEach(() => {
    filePath = tempPath("tenant-registry");
    registry = new TenantRegistry(filePath);
  });

  afterEach(() => {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  });

  it("createTenant returns a TenantConfig with createdAt", () => {
    const tenant = registry.createTenant({
      tenantId: "org_test",
      name: "Test Org",
      policyLevel: "standard",
      claimsThreshold: 0.5,
      claims: [],
      disallowedPatterns: [],
    });

    expect(tenant.tenantId).toBe("org_test");
    expect(tenant.name).toBe("Test Org");
    expect(tenant.policyLevel).toBe("standard");
    expect(typeof tenant.createdAt).toBe("string");
    expect(new Date(tenant.createdAt).toISOString()).toBe(tenant.createdAt);
  });

  it("createTenant throws on duplicate tenantId", () => {
    registry.createTenant({
      tenantId: "org_dup",
      name: "First",
      policyLevel: "strict",
      claimsThreshold: 0.2,
      claims: [],
      disallowedPatterns: [],
    });

    expect(() =>
      registry.createTenant({
        tenantId: "org_dup",
        name: "Second",
        policyLevel: "strict",
        claimsThreshold: 0.2,
        claims: [],
        disallowedPatterns: [],
      }),
    ).toThrow(/already exists/);
  });

  it("createTenant defaults claimsThreshold from policyLevel", () => {
    const strict = registry.createTenant({
      tenantId: "t_strict",
      name: "Strict",
      policyLevel: "strict",
      claimsThreshold: undefined as unknown as number,
      claims: [],
      disallowedPatterns: [],
    });
    expect(strict.claimsThreshold).toBe(0.2);

    const permissive = registry.createTenant({
      tenantId: "t_perm",
      name: "Permissive",
      policyLevel: "permissive",
      claimsThreshold: undefined as unknown as number,
      claims: [],
      disallowedPatterns: [],
    });
    expect(permissive.claimsThreshold).toBe(0.85);
  });

  it("getTenant returns null for missing tenant", () => {
    expect(registry.getTenant("nonexistent")).toBeNull();
  });

  it("listTenants includes created tenant", () => {
    registry.createTenant({
      tenantId: "org_list",
      name: "Listed",
      policyLevel: "standard",
      claimsThreshold: 0.5,
      claims: [],
      disallowedPatterns: [],
    });

    const list = registry.listTenants();
    expect(list).toHaveLength(1);
    expect(list[0].tenantId).toBe("org_list");
  });

  it("updateTenant applies partial update", () => {
    registry.createTenant({
      tenantId: "org_upd",
      name: "Before",
      policyLevel: "standard",
      claimsThreshold: 0.5,
      claims: [],
      disallowedPatterns: [],
    });

    const updated = registry.updateTenant("org_upd", { name: "After" });
    expect(updated.name).toBe("After");
    expect(updated.policyLevel).toBe("standard");
  });

  it("updateTenant throws for missing tenant", () => {
    expect(() =>
      registry.updateTenant("missing", { name: "Nope" }),
    ).toThrow(/not found/);
  });

  it("deleteTenant returns false for missing tenant", () => {
    expect(registry.deleteTenant("missing")).toBe(false);
  });

  it("deleteTenant returns true and removes tenant", () => {
    registry.createTenant({
      tenantId: "org_del",
      name: "Delete Me",
      policyLevel: "permissive",
      claimsThreshold: 0.85,
      claims: [],
      disallowedPatterns: [],
    });

    expect(registry.deleteTenant("org_del")).toBe(true);
    expect(registry.getTenant("org_del")).toBeNull();
    expect(registry.size).toBe(0);
  });

  it("load restores tenants from disk", () => {
    registry.createTenant({
      tenantId: "org_persist",
      name: "Persistent",
      policyLevel: "standard",
      claimsThreshold: 0.5,
      claims: [],
      disallowedPatterns: [],
    });

    const registry2 = new TenantRegistry(filePath);
    registry2.load();
    expect(registry2.getTenant("org_persist")).not.toBeNull();
    expect(registry2.getTenant("org_persist")!.name).toBe("Persistent");
  });

  it("load is a no-op when file does not exist", () => {
    const r = new TenantRegistry("/tmp/nonexistent-file-xxxx.json");
    expect(() => r.load()).not.toThrow();
    expect(r.size).toBe(0);
  });
});

// ── Unit Tests: SystemConfigStore ─────────────────────────────────────

describe("SystemConfigStore", () => {
  let store: SystemConfigStore;

  beforeEach(() => {
    store = new SystemConfigStore();
  });

  it("get returns defaults", () => {
    const cfg = store.get();
    expect(cfg.moderationSensitivity).toBe("medium");
    expect(cfg.sipTrunk).toBeNull();
    expect(cfg.ttsEngine).toBe("openai");
    expect(cfg.maxConcurrentSessions).toBe(100);
    expect(cfg.maintenanceMode).toBe(false);
  });

  it("update applies a partial patch", () => {
    const result = store.update({ maintenanceMode: true });
    expect(result.maintenanceMode).toBe(true);
    expect(result.ttsEngine).toBe("openai"); // unchanged
  });

  it("reset restores defaults", () => {
    store.update({ maintenanceMode: true, ttsEngine: "stub" });
    store.reset();
    const cfg = store.get();
    expect(cfg.maintenanceMode).toBe(false);
    expect(cfg.ttsEngine).toBe("openai");
  });

  it("get returns a snapshot (not a reference)", () => {
    const a = store.get();
    a.maintenanceMode = true;
    const b = store.get();
    expect(b.maintenanceMode).toBe(false);
  });
});

// ── Integration Tests: Admin API endpoints ────────────────────────────

describe("Admin API Endpoints", () => {
  let app: Express;
  let server: Server;
  let registry: TenantRegistry;
  let configStore: SystemConfigStore;
  let filePath: string;

  beforeAll((done) => {
    filePath = tempPath("admin-api");
    registry = new TenantRegistry(filePath);
    configStore = new SystemConfigStore();
    app = buildTestApp(registry, configStore);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
      done();
    });
  });

  beforeEach(() => {
    // Clear tenants between tests by reloading from empty state
    // We write an empty array to the persist file
    writeFileSync(filePath, "[]", "utf-8");
    registry.load();
    configStore.reset();
  });

  // ── POST /admin/tenants ─────────────────────────────────────────

  describe("POST /admin/tenants", () => {
    it("returns 201 with created tenant", async () => {
      const res = await httpRequest(server, "POST", "/admin/tenants", {
        tenantId: "org_acme",
        name: "Acme Corp",
        policyLevel: "standard",
      });

      expect(res.status).toBe(201);
      const data = res.json() as Record<string, unknown>;
      expect(data.tenantId).toBe("org_acme");
      expect(data.name).toBe("Acme Corp");
      expect(data.policyLevel).toBe("standard");
      expect(data.claimsThreshold).toBe(0.5);
      expect(typeof data.createdAt).toBe("string");
    });

    it("returns 409 on duplicate tenantId", async () => {
      await httpRequest(server, "POST", "/admin/tenants", {
        tenantId: "org_dup",
        name: "First",
        policyLevel: "strict",
      });

      const res = await httpRequest(server, "POST", "/admin/tenants", {
        tenantId: "org_dup",
        name: "Second",
        policyLevel: "strict",
      });

      expect(res.status).toBe(409);
      const data = res.json() as { error: string };
      expect(data.error).toContain("already exists");
    });

    it("returns 400 when tenantId is missing", async () => {
      const res = await httpRequest(server, "POST", "/admin/tenants", {
        name: "No ID",
        policyLevel: "standard",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tenantId");
    });

    it("returns 400 when name is missing", async () => {
      const res = await httpRequest(server, "POST", "/admin/tenants", {
        tenantId: "org_noname",
        policyLevel: "standard",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("name");
    });

    it("returns 400 when policyLevel is invalid", async () => {
      const res = await httpRequest(server, "POST", "/admin/tenants", {
        tenantId: "org_badpol",
        name: "Bad Policy",
        policyLevel: "yolo",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("policyLevel");
    });
  });

  // ── GET /admin/tenants ──────────────────────────────────────────

  describe("GET /admin/tenants", () => {
    it("returns 200 with empty array initially", async () => {
      const res = await httpRequest(server, "GET", "/admin/tenants");
      expect(res.status).toBe(200);
      const data = res.json() as { tenants: unknown[]; count: number };
      expect(data.tenants).toEqual([]);
      expect(data.count).toBe(0);
    });

    it("returns 200 with tenants after creation", async () => {
      await httpRequest(server, "POST", "/admin/tenants", {
        tenantId: "org_list1",
        name: "Lister",
        policyLevel: "permissive",
      });

      const res = await httpRequest(server, "GET", "/admin/tenants");
      expect(res.status).toBe(200);
      const data = res.json() as { tenants: Array<{ tenantId: string }>; count: number };
      expect(data.count).toBe(1);
      expect(data.tenants[0].tenantId).toBe("org_list1");
    });
  });

  // ── GET /admin/tenants/:id ──────────────────────────────────────

  describe("GET /admin/tenants/:id", () => {
    it("returns 200 for a known tenant", async () => {
      await httpRequest(server, "POST", "/admin/tenants", {
        tenantId: "org_get",
        name: "Getter",
        policyLevel: "strict",
      });

      const res = await httpRequest(server, "GET", "/admin/tenants/org_get");
      expect(res.status).toBe(200);
      const data = res.json() as { tenantId: string; name: string };
      expect(data.tenantId).toBe("org_get");
      expect(data.name).toBe("Getter");
    });

    it("returns 404 for unknown tenant", async () => {
      const res = await httpRequest(server, "GET", "/admin/tenants/org_missing");
      expect(res.status).toBe(404);
    });
  });

  // ── PUT /admin/tenants/:id ──────────────────────────────────────

  describe("PUT /admin/tenants/:id", () => {
    it("returns 200 with updated config", async () => {
      await httpRequest(server, "POST", "/admin/tenants", {
        tenantId: "org_put",
        name: "Original",
        policyLevel: "standard",
      });

      const res = await httpRequest(server, "PUT", "/admin/tenants/org_put", {
        name: "Updated",
        policyLevel: "strict",
      });

      expect(res.status).toBe(200);
      const data = res.json() as { name: string; policyLevel: string; tenantId: string };
      expect(data.name).toBe("Updated");
      expect(data.policyLevel).toBe("strict");
      expect(data.tenantId).toBe("org_put");
    });

    it("returns 404 for unknown tenant", async () => {
      const res = await httpRequest(server, "PUT", "/admin/tenants/org_nope", {
        name: "Nope",
      });
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /admin/tenants/:id ───────────────────────────────────

  describe("DELETE /admin/tenants/:id", () => {
    it("returns 204 on success", async () => {
      await httpRequest(server, "POST", "/admin/tenants", {
        tenantId: "org_delete",
        name: "Delete Me",
        policyLevel: "permissive",
      });

      const res = await httpRequest(server, "DELETE", "/admin/tenants/org_delete");
      expect(res.status).toBe(204);
    });

    it("returns 404 for unknown tenant", async () => {
      const res = await httpRequest(server, "DELETE", "/admin/tenants/org_gone");
      expect(res.status).toBe(404);
    });
  });

  // ── GET /admin/config ───────────────────────────────────────────

  describe("GET /admin/config", () => {
    it("returns 200 with config object containing defaults", async () => {
      const res = await httpRequest(server, "GET", "/admin/config");
      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.moderationSensitivity).toBe("medium");
      expect(data.sipTrunk).toBeNull();
      expect(data.ttsEngine).toBe("openai");
      expect(data.maxConcurrentSessions).toBe(100);
      expect(data.maintenanceMode).toBe(false);
    });
  });

  // ── PUT /admin/config ───────────────────────────────────────────

  describe("PUT /admin/config", () => {
    it("returns 200 with updated config", async () => {
      const res = await httpRequest(server, "PUT", "/admin/config", {
        maintenanceMode: true,
        ttsEngine: "stub",
      });

      expect(res.status).toBe(200);
      const data = res.json() as Record<string, unknown>;
      expect(data.maintenanceMode).toBe(true);
      expect(data.ttsEngine).toBe("stub");
      expect(data.moderationSensitivity).toBe("medium"); // unchanged
    });

    it("returns 400 for invalid moderationSensitivity", async () => {
      const res = await httpRequest(server, "PUT", "/admin/config", {
        moderationSensitivity: "extreme",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("moderationSensitivity");
    });

    it("returns 400 for invalid ttsEngine", async () => {
      const res = await httpRequest(server, "PUT", "/admin/config", {
        ttsEngine: "azure",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("ttsEngine");
    });
  });
});
