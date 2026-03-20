/**
 * AgentTemplates Tests
 *
 * Tests the AgentTemplateStore and Templates API endpoints.
 * Follows the KnowledgeBase.test.ts pattern: standalone Express app with
 * injected deps and raw HTTP request helpers.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, mkdtempSync } from "fs";
import { AgentTemplateStore } from "../../services/AgentTemplateStore.js";
import { createTemplatesRouter } from "../../api/templates.js";

// ── HTTP helpers (same pattern as KnowledgeBase.test.ts) ──────────────

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

function tempFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `tpl-test-${name}-`));
  return join(dir, "templates.json");
}

function buildTestApp(store: AgentTemplateStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/templates", createTemplatesRouter(store));
  return app;
}

// ── Unit Tests: AgentTemplateStore ────────────────────────────────────

describe("AgentTemplateStore", () => {
  let store: AgentTemplateStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("store");
    store = new AgentTemplateStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("getTemplate('builtin-customer-support') returns built-in", () => {
    const tpl = store.getTemplate("builtin-customer-support");
    expect(tpl).toBeDefined();
    expect(tpl!.templateId).toBe("builtin-customer-support");
    expect(tpl!.builtIn).toBe(true);
    expect(tpl!.persona).toBe("customer_support");
    expect(tpl!.name).toBe("Customer Support");
  });

  it("getTemplate('builtin-sales') returns built-in", () => {
    const tpl = store.getTemplate("builtin-sales");
    expect(tpl).toBeDefined();
    expect(tpl!.templateId).toBe("builtin-sales");
    expect(tpl!.builtIn).toBe(true);
    expect(tpl!.persona).toBe("sales");
  });

  it("getTemplate('builtin-tech-support') returns built-in", () => {
    const tpl = store.getTemplate("builtin-tech-support");
    expect(tpl).toBeDefined();
    expect(tpl!.templateId).toBe("builtin-tech-support");
    expect(tpl!.builtIn).toBe(true);
    expect(tpl!.persona).toBe("tech_support");
  });

  it("getTemplate('builtin-receptionist') returns built-in", () => {
    const tpl = store.getTemplate("builtin-receptionist");
    expect(tpl).toBeDefined();
    expect(tpl!.templateId).toBe("builtin-receptionist");
    expect(tpl!.builtIn).toBe(true);
    expect(tpl!.persona).toBe("receptionist");
  });

  it("getTemplate with unknown id returns undefined", () => {
    const tpl = store.getTemplate("nonexistent-id");
    expect(tpl).toBeUndefined();
  });

  it("listTemplates() includes all 7 built-ins", () => {
    const all = store.listTemplates();
    const builtIns = all.filter((t) => t.builtIn);
    expect(builtIns).toHaveLength(7);

    const ids = builtIns.map((t) => t.templateId).sort();
    expect(ids).toEqual([
      "builtin-customer-support",
      "builtin-receptionist",
      "builtin-sales",
      "builtin-support-de",
      "builtin-support-es",
      "builtin-support-fr",
      "builtin-tech-support",
    ]);
  });

  it("listTemplates({ persona: 'sales' }) filters correctly", () => {
    const filtered = store.listTemplates({ persona: "sales" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].persona).toBe("sales");
    expect(filtered[0].templateId).toBe("builtin-sales");
  });

  it("createTemplate() creates with uuid, builtIn=false", () => {
    const created = store.createTemplate({
      name: "Custom Agent",
      persona: "custom",
      greeting: "Hello!",
      claims: ["general"],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: "tenant-1",
    });

    expect(created.templateId).toBeDefined();
    expect(created.templateId.length).toBeGreaterThan(0);
    expect(created.builtIn).toBe(false);
    expect(created.name).toBe("Custom Agent");
    expect(created.createdAt).toBeDefined();
    expect(created.tenantId).toBe("tenant-1");
  });

  it("createTemplate() persisted to disk — new instance reloads it", () => {
    const created = store.createTemplate({
      name: "Persisted Agent",
      persona: "custom",
      greeting: "Hi from disk!",
      claims: ["persist-test"],
      disallowedPatterns: [],
      moderationSensitivity: "medium",
      ttsVoice: "alloy",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: "tenant-persist",
    });

    // Create a fresh store pointing at the same file
    const store2 = new AgentTemplateStore(storageFile);
    const reloaded = store2.getTemplate(created.templateId);
    expect(reloaded).toBeDefined();
    expect(reloaded!.name).toBe("Persisted Agent");
    expect(reloaded!.greeting).toBe("Hi from disk!");
    expect(reloaded!.claims).toEqual(["persist-test"]);
  });

  it("updateTemplate(custom) patches fields", () => {
    const created = store.createTemplate({
      name: "Update Me",
      persona: "custom",
      greeting: "Old greeting",
      claims: ["old"],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
    });

    const updated = store.updateTemplate(created.templateId, {
      name: "Updated Name",
      greeting: "New greeting",
      moderationSensitivity: "high",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Name");
    expect(updated!.greeting).toBe("New greeting");
    expect(updated!.moderationSensitivity).toBe("high");
    // Unchanged fields preserved
    expect(updated!.persona).toBe("custom");
    expect(updated!.ttsVoice).toBe("nova");
  });

  it("updateTemplate(builtInId) returns undefined", () => {
    const result = store.updateTemplate("builtin-customer-support", { name: "Hacked" });
    expect(result).toBeUndefined();

    // Verify built-in is unchanged
    const tpl = store.getTemplate("builtin-customer-support");
    expect(tpl!.name).toBe("Customer Support");
  });

  it("deleteTemplate(custom) returns true, removed from list", () => {
    const created = store.createTemplate({
      name: "Delete Me",
      persona: "custom",
      greeting: "Bye!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
    });

    const result = store.deleteTemplate(created.templateId);
    expect(result).toBe(true);

    const found = store.getTemplate(created.templateId);
    expect(found).toBeUndefined();
  });

  it("deleteTemplate(builtInId) returns false", () => {
    const result = store.deleteTemplate("builtin-customer-support");
    expect(result).toBe(false);

    // Built-in still available
    const tpl = store.getTemplate("builtin-customer-support");
    expect(tpl).toBeDefined();
  });

  it("deleteTemplate(unknownId) returns false", () => {
    const result = store.deleteTemplate("nonexistent-id");
    expect(result).toBe(false);
  });

  it("getSessionConfig(templateId) returns correct fields", () => {
    const cfg = store.getSessionConfig("builtin-customer-support");
    expect(cfg).toBeDefined();
    expect(cfg!.greeting).toBe("Thank you for calling, how can I help you today?");
    expect(cfg!.ttsVoice).toBe("nova");
    expect(cfg!.moderationSensitivity).toBe("medium");
    expect(cfg!.claims).toEqual(["account issues", "billing", "refunds", "order status", "product information"]);
    expect(cfg!.disallowedPatterns).toEqual(["competitor pricing", "legal advice", "medical advice"]);
    expect(cfg!.escalationRules.escalateOnFrustration).toBe(true);
    expect(cfg!.escalationRules.escalateOnKeywords).toEqual(["manager", "supervisor", "escalate"]);
    expect(cfg!.escalationRules.maxTurnsBeforeEscalate).toBe(20);
  });

  it("getSessionConfig(unknownId) returns undefined", () => {
    const cfg = store.getSessionConfig("nonexistent-id");
    expect(cfg).toBeUndefined();
  });

  it("listTemplates({ tenantId: 'x' }) returns builtins + matching tenant templates", () => {
    store.createTemplate({
      name: "Tenant X Agent",
      persona: "custom",
      greeting: "Hi from X!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: "x",
    });

    store.createTemplate({
      name: "Tenant Y Agent",
      persona: "custom",
      greeting: "Hi from Y!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: "y",
    });

    const results = store.listTemplates({ tenantId: "x" });
    const builtIns = results.filter((t) => t.builtIn);
    const customs = results.filter((t) => !t.builtIn);

    expect(builtIns).toHaveLength(7);
    expect(customs).toHaveLength(1);
    expect(customs[0].name).toBe("Tenant X Agent");
    expect(customs[0].tenantId).toBe("x");
  });

  // ── Marketplace tests ─────────────────────────────────────────────

  it("createTemplate() sets published=false by default", () => {
    const created = store.createTemplate({
      name: "Unpublished Agent",
      persona: "custom",
      greeting: "Hello!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
    });
    expect(created.published).toBe(false);
  });

  it("createTemplate() respects explicit published=true", () => {
    const created = store.createTemplate({
      name: "Published Agent",
      persona: "custom",
      greeting: "Hello!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
      published: true,
    });
    expect(created.published).toBe(true);
  });

  it("built-in templates are published=true", () => {
    const builtIns = store.listTemplates().filter((t) => t.builtIn);
    expect(builtIns.length).toBeGreaterThan(0);
    expect(builtIns.every((t) => t.published)).toBe(true);
  });

  it("publishTemplate() sets published=true on custom template", () => {
    const created = store.createTemplate({
      name: "Publish Me",
      persona: "custom",
      greeting: "Hello!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
    });
    expect(created.published).toBe(false);

    const published = store.publishTemplate(created.templateId);
    expect(published).toBeDefined();
    expect(published!.published).toBe(true);
    expect(store.getTemplate(created.templateId)!.published).toBe(true);
  });

  it("publishTemplate() returns undefined for built-in", () => {
    const result = store.publishTemplate("builtin-customer-support");
    expect(result).toBeUndefined();
  });

  it("publishTemplate() returns undefined for unknown id", () => {
    const result = store.publishTemplate("nonexistent-id");
    expect(result).toBeUndefined();
  });

  it("unpublishTemplate() sets published=false on custom template", () => {
    const created = store.createTemplate({
      name: "Unpublish Me",
      persona: "custom",
      greeting: "Hello!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
      published: true,
    });
    expect(created.published).toBe(true);

    const unpublished = store.unpublishTemplate(created.templateId);
    expect(unpublished).toBeDefined();
    expect(unpublished!.published).toBe(false);
  });

  it("unpublishTemplate() returns undefined for built-in", () => {
    const result = store.unpublishTemplate("builtin-customer-support");
    expect(result).toBeUndefined();
  });

  it("listMarketplace() returns all published templates (builtins + custom)", () => {
    const customPublished = store.createTemplate({
      name: "Marketplace Agent",
      persona: "custom",
      greeting: "Buy me!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
      published: true,
    });

    const marketplace = store.listMarketplace();
    // 4 built-ins + the custom published one
    expect(marketplace.length).toBeGreaterThanOrEqual(5);
    expect(marketplace.every((t) => t.published)).toBe(true);
    expect(marketplace.some((t) => t.templateId === customPublished.templateId)).toBe(true);
  });

  it("listMarketplace() excludes unpublished custom templates", () => {
    const unpublished = store.createTemplate({
      name: "Hidden Agent",
      persona: "custom",
      greeting: "You cannot see me!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
      published: false,
    });

    const marketplace = store.listMarketplace();
    expect(marketplace.some((t) => t.templateId === unpublished.templateId)).toBe(false);
  });

  it("listMarketplace({ persona }) filters by persona", () => {
    const salesOnly = store.listMarketplace({ persona: "sales" });
    expect(salesOnly.every((t) => t.persona === "sales")).toBe(true);
    expect(salesOnly.every((t) => t.published)).toBe(true);
  });

  it("installTemplate() creates tenant copy with published=false", () => {
    const installed = store.installTemplate("builtin-customer-support", "tenant-install");
    expect(installed).toBeDefined();
    expect(installed!.builtIn).toBe(false);
    expect(installed!.published).toBe(false);
    expect(installed!.tenantId).toBe("tenant-install");
    expect(installed!.name).toBe("Customer Support");
    expect(installed!.persona).toBe("customer_support");
  });

  it("installTemplate() returns undefined for unpublished template", () => {
    const unpublished = store.createTemplate({
      name: "Private Agent",
      persona: "custom",
      greeting: "Private!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
      published: false,
    });

    const result = store.installTemplate(unpublished.templateId, "tenant-try");
    expect(result).toBeUndefined();
  });

  it("installTemplate() returns undefined for unknown id", () => {
    const result = store.installTemplate("nonexistent-id", "tenant-try");
    expect(result).toBeUndefined();
  });

  it("custom template absent after delete (verified via listTemplates)", () => {
    const created = store.createTemplate({
      name: "Temporary Agent",
      persona: "custom",
      greeting: "Temp!",
      claims: [],
      disallowedPatterns: [],
      moderationSensitivity: "low",
      ttsVoice: "nova",
      escalationRules: { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: null,
    });

    const beforeDelete = store.listTemplates();
    expect(beforeDelete.some((t) => t.templateId === created.templateId)).toBe(true);

    store.deleteTemplate(created.templateId);

    const afterDelete = store.listTemplates();
    expect(afterDelete.some((t) => t.templateId === created.templateId)).toBe(false);
  });
});

// ── Integration Tests: Templates API ──────────────────────────────────

describe("Templates API Endpoints", () => {
  let app: Express;
  let server: Server;
  let store: AgentTemplateStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("api");
    store = new AgentTemplateStore(storageFile);
    app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
      done();
    });
  });

  it("GET /templates returns all templates (builtins included)", async () => {
    const res = await httpRequest(server, "GET", "/templates");
    expect(res.status).toBe(200);

    const data = res.json() as { templates: Array<{ builtIn: boolean }>; count: number };
    expect(data.count).toBeGreaterThanOrEqual(7);
    const builtIns = data.templates.filter((t) => t.builtIn);
    expect(builtIns).toHaveLength(7);
  });

  it("GET /templates/builtin returns only builtins", async () => {
    const res = await httpRequest(server, "GET", "/templates/builtin");
    expect(res.status).toBe(200);

    const data = res.json() as { templates: Array<{ builtIn: boolean; templateId: string }>; count: number };
    expect(data.count).toBe(7);
    expect(data.templates.every((t) => t.builtIn)).toBe(true);
  });

  it("GET /templates/:id returns a template", async () => {
    const res = await httpRequest(server, "GET", "/templates/builtin-sales");
    expect(res.status).toBe(200);

    const data = res.json() as { templateId: string; name: string };
    expect(data.templateId).toBe("builtin-sales");
    expect(data.name).toBe("Sales");
  });

  it("POST /templates creates template and returns 201", async () => {
    const res = await httpRequest(server, "POST", "/templates", {
      name: "API Test Agent",
      persona: "custom",
      greeting: "Hello from API!",
      claims: ["api-test"],
      ttsVoice: "nova",
      tenantId: "api-tenant",
    });

    expect(res.status).toBe(201);

    const data = res.json() as { templateId: string; name: string; builtIn: boolean; tenantId: string };
    expect(data.templateId).toBeDefined();
    expect(data.name).toBe("API Test Agent");
    expect(data.builtIn).toBe(false);
    expect(data.tenantId).toBe("api-tenant");
  });

  it("PUT /templates/:id updates custom template", async () => {
    // Create a custom template first
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Updatable Agent",
      persona: "custom",
      greeting: "Before update",
    });
    const created = createRes.json() as { templateId: string };

    const res = await httpRequest(server, "PUT", `/templates/${created.templateId}`, {
      name: "Updated Agent",
      greeting: "After update",
    });

    expect(res.status).toBe(200);
    const data = res.json() as { name: string; greeting: string };
    expect(data.name).toBe("Updated Agent");
    expect(data.greeting).toBe("After update");
  });

  it("PUT /templates/builtin-customer-support returns 403", async () => {
    const res = await httpRequest(server, "PUT", "/templates/builtin-customer-support", {
      name: "Hacked",
    });

    expect(res.status).toBe(403);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Cannot modify built-in template");
  });

  it("DELETE /templates/builtin-customer-support returns 403", async () => {
    const res = await httpRequest(server, "DELETE", "/templates/builtin-customer-support");

    expect(res.status).toBe(403);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Cannot delete built-in template");
  });

  // ── Marketplace API tests ──────────────────────────────────────────

  it("GET /templates/marketplace returns only published templates", async () => {
    const res = await httpRequest(server, "GET", "/templates/marketplace");
    expect(res.status).toBe(200);

    const data = res.json() as { templates: Array<{ published: boolean }>; count: number };
    expect(data.count).toBeGreaterThanOrEqual(4); // 4 built-ins are published
    expect(data.templates.every((t) => t.published)).toBe(true);
  });

  it("GET /templates/marketplace?persona=sales filters by persona", async () => {
    const res = await httpRequest(server, "GET", "/templates/marketplace?persona=sales");
    expect(res.status).toBe(200);

    const data = res.json() as { templates: Array<{ persona: string; published: boolean }>; count: number };
    expect(data.templates.every((t) => t.persona === "sales")).toBe(true);
    expect(data.templates.every((t) => t.published)).toBe(true);
  });

  it("POST /templates/:id/publish publishes a custom template", async () => {
    // Create custom template first
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Publish via API",
      persona: "custom",
      greeting: "Hello marketplace!",
    });
    const created = createRes.json() as { templateId: string; published: boolean };
    expect(created.published).toBe(false);

    const res = await httpRequest(server, "POST", `/templates/${created.templateId}/publish`);
    expect(res.status).toBe(200);

    const data = res.json() as { published: boolean };
    expect(data.published).toBe(true);
  });

  it("POST /templates/builtin-customer-support/publish returns 403", async () => {
    const res = await httpRequest(server, "POST", "/templates/builtin-customer-support/publish");
    expect(res.status).toBe(403);
  });

  it("POST /templates/:id/unpublish unpublishes a custom template", async () => {
    // Create and publish
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Unpublish via API",
      persona: "custom",
      greeting: "Bye marketplace!",
    });
    const created = createRes.json() as { templateId: string };
    await httpRequest(server, "POST", `/templates/${created.templateId}/publish`);

    const res = await httpRequest(server, "POST", `/templates/${created.templateId}/unpublish`);
    expect(res.status).toBe(200);

    const data = res.json() as { published: boolean };
    expect(data.published).toBe(false);
  });

  it("POST /templates/marketplace/:id/install installs a template for a tenant", async () => {
    const res = await httpRequest(server, "POST", "/templates/marketplace/builtin-sales/install", {
      tenantId: "tenant-api-test",
    });
    expect(res.status).toBe(201);

    const data = res.json() as { templateId: string; builtIn: boolean; tenantId: string; published: boolean; name: string };
    expect(data.templateId).toBeDefined();
    expect(data.builtIn).toBe(false);
    expect(data.tenantId).toBe("tenant-api-test");
    expect(data.published).toBe(false);
    expect(data.name).toBe("Sales");
  });

  it("POST /templates/marketplace/:id/install returns 400 without tenantId", async () => {
    const res = await httpRequest(server, "POST", "/templates/marketplace/builtin-sales/install", {});
    expect(res.status).toBe(400);
  });

  it("POST /templates/marketplace/:id/install returns 404 for unpublished template", async () => {
    // Create an unpublished template
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Private",
      persona: "custom",
      greeting: "Private!",
    });
    const created = createRes.json() as { templateId: string };

    const res = await httpRequest(server, "POST", `/templates/marketplace/${created.templateId}/install`, {
      tenantId: "tenant-api-test",
    });
    expect(res.status).toBe(404);
  });
});

// ── Coverage gap: GET /:id validation and 404 ─────────────────────────

describe("Templates API — GET /:id coverage gaps", () => {
  let server: Server;
  let store: AgentTemplateStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("get-id-gaps");
    store = new AgentTemplateStore(storageFile);
    const app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      done();
    });
  });

  it("GET /templates/:id with invalid id format returns 400", async () => {
    const res = await httpRequest(server, "GET", "/templates/bad.id");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Invalid templateId format");
  });

  it("GET /templates/:id for unknown id returns 404", async () => {
    const res = await httpRequest(server, "GET", "/templates/nonexistent-id-xyz");
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Template not found");
  });
});

// ── Coverage gap: POST /templates validation branches ─────────────────

describe("Templates API — POST validation coverage gaps", () => {
  let server: Server;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("post-gaps");
    const store = new AgentTemplateStore(storageFile);
    const app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      done();
    });
  });

  it("POST /templates without name returns 400", async () => {
    const res = await httpRequest(server, "POST", "/templates", {
      persona: "custom",
      greeting: "Hello!",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("name is required");
  });

  it("POST /templates with invalid persona returns 400", async () => {
    const res = await httpRequest(server, "POST", "/templates", {
      name: "Bad Persona Agent",
      persona: "invalid_persona",
      greeting: "Hello!",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("persona is required");
  });

  it("POST /templates without greeting returns 400", async () => {
    const res = await httpRequest(server, "POST", "/templates", {
      name: "No Greeting Agent",
      persona: "custom",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("greeting is required");
  });
});

// ── Coverage gap: PUT /:id validation and patch branches ──────────────

describe("Templates API — PUT coverage gaps", () => {
  let server: Server;
  let store: AgentTemplateStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("put-gaps");
    store = new AgentTemplateStore(storageFile);
    const app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      done();
    });
  });

  it("PUT /templates/:id with invalid id format returns 400", async () => {
    const res = await httpRequest(server, "PUT", "/templates/bad.id", { name: "x" });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Invalid templateId format");
  });

  it("PUT /templates/:id for unknown id returns 404", async () => {
    const res = await httpRequest(server, "PUT", "/templates/nonexistent-id-xyz", { name: "x" });
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Template not found");
  });

  it("PUT /templates/:id patches moderationSensitivity field", async () => {
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Sensitivity Agent",
      persona: "custom",
      greeting: "Hello!",
    });
    const created = createRes.json() as { templateId: string };

    const res = await httpRequest(server, "PUT", `/templates/${created.templateId}`, {
      moderationSensitivity: "high",
    });
    expect(res.status).toBe(200);
    const data = res.json() as { moderationSensitivity: string };
    expect(data.moderationSensitivity).toBe("high");
  });

  it("PUT /templates/:id patches escalationRules field", async () => {
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Escalation Agent",
      persona: "custom",
      greeting: "Hello!",
    });
    const created = createRes.json() as { templateId: string };

    const res = await httpRequest(server, "PUT", `/templates/${created.templateId}`, {
      escalationRules: {
        escalateOnFrustration: true,
        escalateOnKeywords: ["help", "manager"],
        maxTurnsBeforeEscalate: 5,
      },
    });
    expect(res.status).toBe(200);
    const data = res.json() as { escalationRules: { escalateOnFrustration: boolean; escalateOnKeywords: string[]; maxTurnsBeforeEscalate: number } };
    expect(data.escalationRules.escalateOnFrustration).toBe(true);
    expect(data.escalationRules.escalateOnKeywords).toEqual(["help", "manager"]);
    expect(data.escalationRules.maxTurnsBeforeEscalate).toBe(5);
  });

  it("PUT /templates/:id patches tenantId field", async () => {
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Tenant Patch Agent",
      persona: "custom",
      greeting: "Hello!",
    });
    const created = createRes.json() as { templateId: string };

    const res = await httpRequest(server, "PUT", `/templates/${created.templateId}`, {
      tenantId: "new-tenant-99",
    });
    expect(res.status).toBe(200);
    const data = res.json() as { tenantId: string };
    expect(data.tenantId).toBe("new-tenant-99");
  });
});

// ── Coverage gap: DELETE /:id validation and success ──────────────────

describe("Templates API — DELETE coverage gaps", () => {
  let server: Server;
  let store: AgentTemplateStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("delete-gaps");
    store = new AgentTemplateStore(storageFile);
    const app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      done();
    });
  });

  it("DELETE /templates/:id with invalid id format returns 400", async () => {
    const res = await httpRequest(server, "DELETE", "/templates/bad.id");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Invalid templateId format");
  });

  it("DELETE /templates/:id for unknown id returns 404", async () => {
    const res = await httpRequest(server, "DELETE", "/templates/nonexistent-id-xyz");
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Template not found");
  });

  it("DELETE /templates/:id for custom template returns 204", async () => {
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Delete Me Via API",
      persona: "custom",
      greeting: "Goodbye!",
    });
    const created = createRes.json() as { templateId: string };

    const res = await httpRequest(server, "DELETE", `/templates/${created.templateId}`);
    expect(res.status).toBe(204);

    // Verify gone
    const getRes = await httpRequest(server, "GET", `/templates/${created.templateId}`);
    expect(getRes.status).toBe(404);
  });
});

// ── Coverage gap: publish/unpublish validation branches ───────────────

describe("Templates API — publish/unpublish coverage gaps", () => {
  let server: Server;
  let store: AgentTemplateStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("pubunpub-gaps");
    store = new AgentTemplateStore(storageFile);
    const app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      done();
    });
  });

  it("POST /templates/:id/publish with invalid id format returns 400", async () => {
    const res = await httpRequest(server, "POST", "/templates/bad.id/publish");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Invalid templateId format");
  });

  it("POST /templates/:id/publish for unknown id returns 404", async () => {
    const res = await httpRequest(server, "POST", "/templates/nonexistent-id-xyz/publish");
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Template not found");
  });

  it("POST /templates/:id/unpublish with invalid id format returns 400", async () => {
    const res = await httpRequest(server, "POST", "/templates/bad.id/unpublish");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Invalid templateId format");
  });

  it("POST /templates/:id/unpublish for unknown id returns 404", async () => {
    const res = await httpRequest(server, "POST", "/templates/nonexistent-id-xyz/unpublish");
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Template not found");
  });

  it("POST /templates/:id/unpublish for built-in returns 403", async () => {
    const res = await httpRequest(server, "POST", "/templates/builtin-customer-support/unpublish");
    expect(res.status).toBe(403);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Cannot unpublish built-in templates");
  });

  it("POST /templates/:id/unpublish on a custom published template returns unpublished template", async () => {
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Unpublish Target",
      persona: "custom",
      greeting: "Hello marketplace!",
    });
    const created = createRes.json() as { templateId: string };

    // Publish first
    await httpRequest(server, "POST", `/templates/${created.templateId}/publish`);

    // Now unpublish
    const res = await httpRequest(server, "POST", `/templates/${created.templateId}/unpublish`);
    expect(res.status).toBe(200);
    const data = res.json() as { published: boolean; templateId: string };
    expect(data.published).toBe(false);
    expect(data.templateId).toBe(created.templateId);
  });
});

// ── Coverage gap: /marketplace/:id/install validation ─────────────────

describe("Templates API — marketplace install coverage gaps", () => {
  let server: Server;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("install-gaps");
    const store = new AgentTemplateStore(storageFile);
    const app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      done();
    });
  });

  it("POST /templates/marketplace/:id/install with invalid id format returns 400", async () => {
    const res = await httpRequest(server, "POST", "/templates/marketplace/bad.id/install", {
      tenantId: "t1",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Invalid templateId format");
  });
});

// ── Coverage gap: GET /:id/config handler ─────────────────────────────

describe("Templates API — GET /:id/config coverage gaps", () => {
  let server: Server;
  let store: AgentTemplateStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("config-gaps");
    store = new AgentTemplateStore(storageFile);
    const app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      done();
    });
  });

  it("GET /templates/:id/config with invalid id format returns 400", async () => {
    const res = await httpRequest(server, "GET", "/templates/bad.id/config");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Invalid templateId format");
  });

  it("GET /templates/:id/config for unknown id returns 404", async () => {
    const res = await httpRequest(server, "GET", "/templates/nonexistent-id-xyz/config");
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Template not found");
  });

  it("GET /templates/:id/config returns session config for valid template", async () => {
    const res = await httpRequest(server, "GET", "/templates/builtin-customer-support/config");
    expect(res.status).toBe(200);

    const data = res.json() as {
      greeting: string;
      ttsVoice: string;
      moderationSensitivity: string;
      claims: string[];
      disallowedPatterns: string[];
      escalationRules: { escalateOnFrustration: boolean };
    };
    expect(data.greeting).toBeDefined();
    expect(data.ttsVoice).toBeDefined();
    expect(data.moderationSensitivity).toBeDefined();
    expect(Array.isArray(data.claims)).toBe(true);
    expect(Array.isArray(data.disallowedPatterns)).toBe(true);
    expect(typeof data.escalationRules.escalateOnFrustration).toBe("boolean");
  });

  it("GET /templates/:id/config for custom template returns config", async () => {
    const createRes = await httpRequest(server, "POST", "/templates", {
      name: "Config Test Agent",
      persona: "custom",
      greeting: "Config greeting",
      claims: ["config-test"],
      ttsVoice: "alloy",
      moderationSensitivity: "low",
    });
    const created = createRes.json() as { templateId: string };

    const res = await httpRequest(server, "GET", `/templates/${created.templateId}/config`);
    expect(res.status).toBe(200);

    const data = res.json() as { greeting: string; ttsVoice: string; claims: string[] };
    expect(data.greeting).toBe("Config greeting");
    expect(data.ttsVoice).toBe("alloy");
    expect(data.claims).toEqual(["config-test"]);
  });
});
