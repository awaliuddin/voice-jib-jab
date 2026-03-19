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

  it("listTemplates() includes all 4 built-ins", () => {
    const all = store.listTemplates();
    const builtIns = all.filter((t) => t.builtIn);
    expect(builtIns).toHaveLength(4);

    const ids = builtIns.map((t) => t.templateId).sort();
    expect(ids).toEqual([
      "builtin-customer-support",
      "builtin-receptionist",
      "builtin-sales",
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

    expect(builtIns).toHaveLength(4);
    expect(customs).toHaveLength(1);
    expect(customs[0].name).toBe("Tenant X Agent");
    expect(customs[0].tenantId).toBe("x");
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
    expect(data.count).toBeGreaterThanOrEqual(4);
    const builtIns = data.templates.filter((t) => t.builtIn);
    expect(builtIns).toHaveLength(4);
  });

  it("GET /templates/builtin returns only builtins", async () => {
    const res = await httpRequest(server, "GET", "/templates/builtin");
    expect(res.status).toBe(200);

    const data = res.json() as { templates: Array<{ builtIn: boolean; templateId: string }>; count: number };
    expect(data.count).toBe(4);
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
});
