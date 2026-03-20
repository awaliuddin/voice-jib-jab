/**
 * IvrMenu Tests
 *
 * Tests the IvrMenuStore, DtmfDetector, and IVR API endpoints.
 * Follows the AgentTemplates.test.ts pattern: standalone Express app with
 * injected deps and raw HTTP request helpers.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, mkdtempSync } from "fs";
import { IvrMenuStore, type IvrMenu, type IvrNode } from "../../services/IvrMenuStore.js";
import { DtmfDetector } from "../../services/DtmfDetector.js";
import { createIvrRouter } from "../../api/ivr.js";

// ── HTTP helpers ───────────────────────────────────────────────────────

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
  const dir = mkdtempSync(join(tmpdir(), `ivr-test-${name}-`));
  return join(dir, "ivr-menus.json");
}

function buildTestApp(store: IvrMenuStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/ivr", createIvrRouter(store));
  return app;
}

/**
 * Build a minimal two-node menu fixture:
 *   root (menu) — "Press 1 for support, 2 for sales"
 *     1 → support-node (transfer)
 *     2 → sales-node (transfer)
 */
function buildFixtureMenu(store: IvrMenuStore): IvrMenu {
  const rootNode: IvrNode = {
    nodeId: "root",
    type: "menu",
    prompt: "Press 1 for support, 2 for sales",
    tenantId: null,
    options: {
      "1": { nodeId: "support-node", label: "Press 1 for Support" },
      "2": { nodeId: "sales-node", label: "Press 2 for Sales" },
    },
  };
  const supportNode: IvrNode = {
    nodeId: "support-node",
    type: "transfer",
    prompt: "Transferring to Customer Support",
    targetTemplateId: "builtin-customer-support",
    tenantId: null,
  };
  const salesNode: IvrNode = {
    nodeId: "sales-node",
    type: "transfer",
    prompt: "Transferring to Sales",
    targetTemplateId: "builtin-sales",
    tenantId: null,
  };

  return store.createMenu({
    name: "Main Menu",
    tenantId: null,
    rootNodeId: "root",
    nodes: {
      root: rootNode,
      "support-node": supportNode,
      "sales-node": salesNode,
    },
  });
}

// ── Unit Tests: IvrMenuStore ───────────────────────────────────────────

describe("IvrMenuStore", () => {
  let store: IvrMenuStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("store");
    store = new IvrMenuStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createMenu() assigns menuId and timestamps", () => {
    const menu = buildFixtureMenu(store);

    expect(menu.menuId).toBeDefined();
    expect(menu.menuId.length).toBeGreaterThan(0);
    expect(menu.createdAt).toBeDefined();
    expect(menu.updatedAt).toBeDefined();
    expect(menu.name).toBe("Main Menu");
  });

  it("getMenu() retrieves a created menu", () => {
    const created = buildFixtureMenu(store);
    const fetched = store.getMenu(created.menuId);

    expect(fetched).toBeDefined();
    expect(fetched!.menuId).toBe(created.menuId);
    expect(fetched!.name).toBe("Main Menu");
  });

  it("getMenu() returns undefined for unknown menuId", () => {
    const result = store.getMenu("nonexistent-menu-id");
    expect(result).toBeUndefined();
  });

  it("listMenus() returns all created menus", () => {
    buildFixtureMenu(store);
    store.createMenu({
      name: "Second Menu",
      tenantId: null,
      rootNodeId: "root2",
      nodes: { root2: { nodeId: "root2", type: "message", prompt: "Hello", tenantId: null } },
    });

    const all = store.listMenus();
    expect(all).toHaveLength(2);
  });

  it("listMenus() filters by tenantId", () => {
    store.createMenu({
      name: "Tenant A Menu",
      tenantId: "tenant-a",
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "menu", prompt: "Hi from A", tenantId: "tenant-a" } },
    });
    store.createMenu({
      name: "Tenant B Menu",
      tenantId: "tenant-b",
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "menu", prompt: "Hi from B", tenantId: "tenant-b" } },
    });

    const aMenus = store.listMenus({ tenantId: "tenant-a" });
    expect(aMenus).toHaveLength(1);
    expect(aMenus[0].name).toBe("Tenant A Menu");

    const bMenus = store.listMenus({ tenantId: "tenant-b" });
    expect(bMenus).toHaveLength(1);
    expect(bMenus[0].name).toBe("Tenant B Menu");
  });

  it("updateMenu() patches name field", () => {
    const created = buildFixtureMenu(store);
    const updated = store.updateMenu(created.menuId, { name: "Updated Menu" });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Menu");
    expect(updated!.rootNodeId).toBe("root");
  });

  it("updateMenu() returns undefined for unknown menuId", () => {
    const result = store.updateMenu("nonexistent-id", { name: "Ghost" });
    expect(result).toBeUndefined();
  });

  it("updateMenu() bumps updatedAt timestamp", () => {
    const created = buildFixtureMenu(store);
    const before = created.updatedAt;

    // Ensure at least 1ms passes
    const updated = store.updateMenu(created.menuId, { name: "Time Check" });
    expect(updated).toBeDefined();
    expect(updated!.createdAt).toBe(created.createdAt);
    // updatedAt should be >= createdAt (could be equal if same ms)
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it("deleteMenu() removes menu and returns true", () => {
    const created = buildFixtureMenu(store);
    const result = store.deleteMenu(created.menuId);

    expect(result).toBe(true);
    expect(store.getMenu(created.menuId)).toBeUndefined();
  });

  it("deleteMenu() returns false for unknown menuId", () => {
    const result = store.deleteMenu("nonexistent-id");
    expect(result).toBe(false);
  });

  it("processInput() navigates to correct next node", () => {
    const menu = buildFixtureMenu(store);
    const result = store.processInput(menu.menuId, "root", "1");

    expect(result).not.toBeNull();
    expect(result!.nextNode.nodeId).toBe("support-node");
    expect(result!.nextNode.type).toBe("transfer");
    expect(result!.prompt).toBe("Transferring to Customer Support");
  });

  it("processInput() navigates digit 2 correctly", () => {
    const menu = buildFixtureMenu(store);
    const result = store.processInput(menu.menuId, "root", "2");

    expect(result).not.toBeNull();
    expect(result!.nextNode.nodeId).toBe("sales-node");
    expect(result!.prompt).toBe("Transferring to Sales");
  });

  it("processInput() returns null for unknown digit", () => {
    const menu = buildFixtureMenu(store);
    const result = store.processInput(menu.menuId, "root", "9");
    expect(result).toBeNull();
  });

  it("processInput() returns null for unknown menuId", () => {
    const result = store.processInput("nonexistent-menu", "root", "1");
    expect(result).toBeNull();
  });

  it("processInput() returns null for unknown nodeId", () => {
    const menu = buildFixtureMenu(store);
    const result = store.processInput(menu.menuId, "nonexistent-node", "1");
    expect(result).toBeNull();
  });

  it("Persistence: new store instance reloads menus from disk", () => {
    const created = buildFixtureMenu(store);

    const store2 = new IvrMenuStore(storageFile);
    const reloaded = store2.getMenu(created.menuId);

    expect(reloaded).toBeDefined();
    expect(reloaded!.name).toBe("Main Menu");
    expect(reloaded!.rootNodeId).toBe("root");
    expect(Object.keys(reloaded!.nodes)).toHaveLength(3);
  });
});

// ── Unit Tests: DtmfDetector ──────────────────────────────────────────

describe("DtmfDetector", () => {
  let detector: DtmfDetector;

  beforeEach(() => {
    detector = new DtmfDetector();
  });

  it('detects exact digit "1" with confidence 1.0', () => {
    const result = detector.detect("1");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("1");
    expect(result.confidence).toBe(1.0);
  });

  it('detects exact digit "0" with confidence 1.0', () => {
    const result = detector.detect("0");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("0");
    expect(result.confidence).toBe(1.0);
  });

  it('detects spoken word "one" → "1"', () => {
    const result = detector.detect("one");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("1");
    expect(result.confidence).toBe(1.0);
  });

  it('detects spoken word "zero" → "0"', () => {
    const result = detector.detect("zero");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("0");
    expect(result.confidence).toBe(1.0);
  });

  it('detects "star" → "*"', () => {
    const result = detector.detect("star");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("*");
  });

  it('detects "hash" → "#"', () => {
    const result = detector.detect("hash");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("#");
  });

  it('detects "pound" → "#"', () => {
    const result = detector.detect("pound");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("#");
  });

  it('detects "asterisk" → "*"', () => {
    const result = detector.detect("asterisk");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("*");
  });

  it('detects phrase "press 2" → "2"', () => {
    const result = detector.detect("press 2");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("2");
    expect(result.confidence).toBe(1.0);
  });

  it('detects phrase "press one" → "1"', () => {
    const result = detector.detect("press one");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("1");
  });

  it('detects phrase "option three" → "3"', () => {
    const result = detector.detect("option three");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("3");
  });

  it('detects phrase "number four" → "4"', () => {
    const result = detector.detect("number four");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("4");
  });

  it('detects phrase "choose 5" → "5"', () => {
    const result = detector.detect("choose 5");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("5");
  });

  it('detects phrase "select six" → "6"', () => {
    const result = detector.detect("select six");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("6");
  });

  it("empty string → not detected, confidence 0", () => {
    const result = detector.detect("");
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('"hello" → not detected', () => {
    const result = detector.detect("hello");
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("unrecognized phrase returns not detected", () => {
    const result = detector.detect("I would like some assistance please");
    expect(result.detected).toBe(false);
  });
});

// ── Integration Tests: IVR API ────────────────────────────────────────

describe("IVR API Endpoints", () => {
  let app: Express;
  let server: Server;
  let store: IvrMenuStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("api");
    store = new IvrMenuStore(storageFile);
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

  it("GET /ivr/menus returns 200 with empty list", async () => {
    const res = await httpRequest(server, "GET", "/ivr/menus");
    expect(res.status).toBe(200);

    const data = res.json() as { menus: unknown[]; count: number };
    expect(Array.isArray(data.menus)).toBe(true);
    expect(typeof data.count).toBe("number");
  });

  it("POST /ivr/menus creates menu and returns 201", async () => {
    const res = await httpRequest(server, "POST", "/ivr/menus", {
      name: "API Test Menu",
      tenantId: "api-tenant",
      rootNodeId: "root",
      nodes: {
        root: {
          nodeId: "root",
          type: "menu",
          prompt: "Press 1 for support",
          tenantId: "api-tenant",
          options: {
            "1": { nodeId: "support", label: "Press 1 for Support" },
          },
        },
        support: {
          nodeId: "support",
          type: "transfer",
          prompt: "Connecting to support",
          targetTemplateId: "builtin-customer-support",
          tenantId: "api-tenant",
        },
      },
    });

    expect(res.status).toBe(201);

    const data = res.json() as { menuId: string; name: string; tenantId: string };
    expect(data.menuId).toBeDefined();
    expect(data.name).toBe("API Test Menu");
    expect(data.tenantId).toBe("api-tenant");
  });

  it("GET /ivr/menus/:menuId returns the created menu", async () => {
    const created = store.createMenu({
      name: "Get Menu Test",
      tenantId: null,
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "message", prompt: "Hello", tenantId: null } },
    });

    const res = await httpRequest(server, "GET", `/ivr/menus/${created.menuId}`);
    expect(res.status).toBe(200);

    const data = res.json() as { menuId: string; name: string };
    expect(data.menuId).toBe(created.menuId);
    expect(data.name).toBe("Get Menu Test");
  });

  it("GET /ivr/menus/:menuId returns 404 for unknown menu", async () => {
    const res = await httpRequest(server, "GET", "/ivr/menus/nonexistent-menu-id");
    expect(res.status).toBe(404);
  });

  it("POST /ivr/menus/:menuId/process with spoken input returns nextNode", async () => {
    const menu = store.createMenu({
      name: "Process Test Menu",
      tenantId: null,
      rootNodeId: "root",
      nodes: {
        root: {
          nodeId: "root",
          type: "menu",
          prompt: "Press one for support",
          tenantId: null,
          options: { "1": { nodeId: "dest", label: "Support" } },
        },
        dest: {
          nodeId: "dest",
          type: "transfer",
          prompt: "Going to support",
          targetTemplateId: "builtin-customer-support",
          tenantId: null,
        },
      },
    });

    const res = await httpRequest(server, "POST", `/ivr/menus/${menu.menuId}/process`, {
      nodeId: "root",
      input: "press one",
    });

    expect(res.status).toBe(200);

    const data = res.json() as { nextNode: { nodeId: string }; prompt: string; digit: string };
    expect(data.nextNode.nodeId).toBe("dest");
    expect(data.prompt).toBe("Going to support");
    expect(data.digit).toBe("1");
  });

  it("POST /ivr/menus/:menuId/process with unrecognized input returns 422", async () => {
    const menu = store.createMenu({
      name: "422 Test Menu",
      tenantId: null,
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "menu", prompt: "Hello", tenantId: null } },
    });

    const res = await httpRequest(server, "POST", `/ivr/menus/${menu.menuId}/process`, {
      nodeId: "root",
      input: "I am not sure what to press",
    });

    expect(res.status).toBe(422);
    const data = res.json() as { error: string };
    expect(data.error).toContain("No DTMF digit detected");
  });

  it("DELETE /ivr/menus/:menuId returns 204", async () => {
    const menu = store.createMenu({
      name: "Delete Me",
      tenantId: null,
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "message", prompt: "Bye", tenantId: null } },
    });

    const res = await httpRequest(server, "DELETE", `/ivr/menus/${menu.menuId}`);
    expect(res.status).toBe(204);

    const fetchRes = await httpRequest(server, "GET", `/ivr/menus/${menu.menuId}`);
    expect(fetchRes.status).toBe(404);
  });

  it("DELETE /ivr/menus/:menuId returns 404 for unknown menu", async () => {
    const res = await httpRequest(server, "DELETE", "/ivr/menus/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("GET /ivr/menus?tenantId= filters menus by tenantId", async () => {
    store.createMenu({
      name: "Filter Tenant X",
      tenantId: "filter-x",
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "message", prompt: "X", tenantId: "filter-x" } },
    });
    store.createMenu({
      name: "Filter Tenant Y",
      tenantId: "filter-y",
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "message", prompt: "Y", tenantId: "filter-y" } },
    });

    const res = await httpRequest(server, "GET", "/ivr/menus?tenantId=filter-x");
    expect(res.status).toBe(200);

    const data = res.json() as { menus: Array<{ tenantId: string }>; count: number };
    expect(data.menus.every((m) => m.tenantId === "filter-x")).toBe(true);
  });
});

// ── Persistence: cross-instance test ──────────────────────────────────

describe("IvrMenuStore — Persistence", () => {
  it("new store instance reloads menus from disk", () => {
    const storageFile = tempFile("persist");
    const store1 = new IvrMenuStore(storageFile);

    const created = store1.createMenu({
      name: "Persisted Menu",
      tenantId: null,
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "message", prompt: "Hello from disk", tenantId: null } },
    });

    const store2 = new IvrMenuStore(storageFile);
    const reloaded = store2.getMenu(created.menuId);

    expect(reloaded).toBeDefined();
    expect(reloaded!.name).toBe("Persisted Menu");
    expect(reloaded!.nodes["root"].prompt).toBe("Hello from disk");

    const dir = join(storageFile, "..");
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Coverage gaps: IvrMenuStore ────────────────────────────────────────

describe("IvrMenuStore — coverage gaps", () => {
  it("loadFromDisk() throws when file read fails with non-ENOENT error", () => {
    // Arrange: write a valid file first, then mock readFileSync to throw EACCES
    const storageFile = tempFile("eacces");
    // Pre-create the file so existsSync returns true
    const { writeFileSync: wfs } = require("fs");
    wfs(storageFile, "[]", "utf-8");

    const fs = require("fs");
    const original = fs.readFileSync;
    const eaccesErr = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    fs.readFileSync = () => { throw eaccesErr; };

    try {
      expect(() => new IvrMenuStore(storageFile)).toThrow("Permission denied");
    } finally {
      fs.readFileSync = original;
      const { dirname: pdir } = require("path");
      const dir = pdir(storageFile);
      const { rmSync: rms, existsSync: exs } = require("fs");
      if (exs(dir)) rms(dir, { recursive: true, force: true });
    }
  });

  it("saveToDisk() persists data that survives a reload", () => {
    const storageFile = tempFile("savedisk");
    const store1 = new IvrMenuStore(storageFile);
    const created = store1.createMenu({
      name: "Disk Save Test",
      tenantId: null,
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "message", prompt: "Saved", tenantId: null } },
    });

    // A second instance must read what saveToDisk wrote
    const store2 = new IvrMenuStore(storageFile);
    expect(store2.getMenu(created.menuId)).toBeDefined();
    expect(store2.getMenu(created.menuId)!.name).toBe("Disk Save Test");

    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("processInput() returns null when node has no options", () => {
    const storageFile = tempFile("proc-noopts");
    const store = new IvrMenuStore(storageFile);
    const menu = store.createMenu({
      name: "No Options Menu",
      tenantId: null,
      rootNodeId: "root",
      nodes: {
        root: { nodeId: "root", type: "message", prompt: "No options here", tenantId: null },
      },
    });

    // "root" node has no options field at all
    const result = store.processInput(menu.menuId, "root", "1");
    expect(result).toBeNull();

    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("processInput() returns null when digit not in node.options", () => {
    const storageFile = tempFile("proc-nodigit");
    const store = new IvrMenuStore(storageFile);
    const menu = store.createMenu({
      name: "Missing Digit Menu",
      tenantId: null,
      rootNodeId: "root",
      nodes: {
        root: {
          nodeId: "root",
          type: "menu",
          prompt: "Press 1 only",
          tenantId: null,
          options: { "1": { nodeId: "leaf", label: "Only option" } },
        },
        leaf: { nodeId: "leaf", type: "message", prompt: "Leaf", tenantId: null },
      },
    });

    // Digit "9" is not in options
    const result = store.processInput(menu.menuId, "root", "9");
    expect(result).toBeNull();

    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("processInput() returns null when referenced nextNode not found in nodes map", () => {
    const storageFile = tempFile("proc-nonode");
    const store = new IvrMenuStore(storageFile);
    // Manually construct a menu where the option's nodeId points to a non-existent node
    const menu = store.createMenu({
      name: "Dangling Ref Menu",
      tenantId: null,
      rootNodeId: "root",
      nodes: {
        root: {
          nodeId: "root",
          type: "menu",
          prompt: "Press 1",
          tenantId: null,
          options: { "1": { nodeId: "ghost-node", label: "Ghost" } },
        },
        // "ghost-node" is intentionally absent from the nodes map
      },
    });

    const result = store.processInput(menu.menuId, "root", "1");
    expect(result).toBeNull();

    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });
});

// ── Coverage gaps: IvrMenuStore singleton ─────────────────────────────

describe("IvrMenuStore — singleton", () => {
  it("ivrMenuStore proxy throws when accessed before initIvrMenuStore()", async () => {
    // Import a fresh module instance that has never had initIvrMenuStore called.
    // Jest module registry is shared, so we use jest.resetModules to get a clean slate.
    jest.resetModules();
    const { ivrMenuStore } = await import("../../services/IvrMenuStore.js");
    expect(() => (ivrMenuStore as unknown as { listMenus: () => unknown }).listMenus()).toThrow(
      "IvrMenuStore not initialized",
    );
  });

  it("initIvrMenuStore() initializes and returns a working store", async () => {
    jest.resetModules();
    const storageFile = tempFile("singleton");
    const { initIvrMenuStore } = await import("../../services/IvrMenuStore.js");
    const store = initIvrMenuStore(storageFile);

    expect(store).toBeDefined();
    expect(typeof store.createMenu).toBe("function");
    expect(store.listMenus()).toHaveLength(0);

    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });
});

// ── Coverage gaps: IVR API endpoints ──────────────────────────────────

describe("IVR API — coverage gaps", () => {
  let app: ReturnType<typeof buildTestApp>;
  let server: Server;
  let store: IvrMenuStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("api-gaps");
    store = new IvrMenuStore(storageFile);
    app = buildTestApp(store);
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

  // POST /menus — validation gaps

  it("POST /ivr/menus returns 400 when rootNodeId is missing", async () => {
    const res = await httpRequest(server, "POST", "/ivr/menus", {
      name: "No Root",
      nodes: { root: { nodeId: "root", type: "message", prompt: "Hi", tenantId: null } },
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/rootNodeId/);
  });

  it("POST /ivr/menus returns 400 when nodes is missing", async () => {
    const res = await httpRequest(server, "POST", "/ivr/menus", {
      name: "No Nodes",
      rootNodeId: "root",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/nodes/);
  });

  it("POST /ivr/menus returns 400 when nodes is not a valid node map (array instead of object)", async () => {
    const res = await httpRequest(server, "POST", "/ivr/menus", {
      name: "Bad Nodes",
      rootNodeId: "root",
      nodes: ["not", "an", "object"],
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/nodes/);
  });

  it("POST /ivr/menus returns 400 when a node in nodes has an invalid type", async () => {
    const res = await httpRequest(server, "POST", "/ivr/menus", {
      name: "Bad Node Type",
      rootNodeId: "root",
      nodes: {
        root: { nodeId: "root", type: "invalid-type", prompt: "Hi", tenantId: null },
      },
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/nodes/);
  });

  // PUT /menus/:menuId — gaps

  it("PUT /ivr/menus/:menuId returns 404 when menu not found", async () => {
    const res = await httpRequest(server, "PUT", "/ivr/menus/does-not-exist", {
      name: "Ghost Update",
    });
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/not found/i);
  });

  it("PUT /ivr/menus/:menuId returns 400 when nodes is provided but invalid", async () => {
    const menu = store.createMenu({
      name: "Update Nodes Test",
      tenantId: null,
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "message", prompt: "Hello", tenantId: null } },
    });

    const res = await httpRequest(server, "PUT", `/ivr/menus/${menu.menuId}`, {
      nodes: { root: { nodeId: "root", type: "bad-type", prompt: "Hi", tenantId: null } },
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/nodes/);
  });

  it("PUT /ivr/menus/:menuId returns 200 and updated menu on valid patch", async () => {
    const menu = store.createMenu({
      name: "Patch Target",
      tenantId: null,
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "message", prompt: "Before", tenantId: null } },
    });

    const res = await httpRequest(server, "PUT", `/ivr/menus/${menu.menuId}`, {
      name: "Patched Name",
    });
    expect(res.status).toBe(200);
    const data = res.json() as { name: string };
    expect(data.name).toBe("Patched Name");
  });

  // DELETE /menus/:menuId — gap (404)

  it("DELETE /ivr/menus/:menuId returns 404 when menu not found", async () => {
    const res = await httpRequest(server, "DELETE", "/ivr/menus/no-such-menu");
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/not found/i);
  });

  // POST /menus/:menuId/process — validation gaps

  it("POST /ivr/menus/:menuId/process returns 400 when nodeId is missing", async () => {
    const menu = store.createMenu({
      name: "Process Validation Menu",
      tenantId: null,
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "menu", prompt: "Hi", tenantId: null } },
    });

    const res = await httpRequest(server, "POST", `/ivr/menus/${menu.menuId}/process`, {
      input: "press 1",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/nodeId/);
  });

  it("POST /ivr/menus/:menuId/process returns 400 when input is missing", async () => {
    const menu = store.createMenu({
      name: "Process Input Validation Menu",
      tenantId: null,
      rootNodeId: "root",
      nodes: { root: { nodeId: "root", type: "menu", prompt: "Hi", tenantId: null } },
    });

    const res = await httpRequest(server, "POST", `/ivr/menus/${menu.menuId}/process`, {
      nodeId: "root",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/input/);
  });

  it("POST /ivr/menus/:menuId/process returns 404 when processInput returns null (digit not in options)", async () => {
    const menu = store.createMenu({
      name: "No Matching Option",
      tenantId: null,
      rootNodeId: "root",
      nodes: {
        root: {
          nodeId: "root",
          type: "menu",
          prompt: "Press 1 only",
          tenantId: null,
          options: { "1": { nodeId: "leaf", label: "Leaf" } },
        },
        leaf: { nodeId: "leaf", type: "message", prompt: "Leaf", tenantId: null },
      },
    });

    // Digit "2" is a valid DTMF but maps to no option in this menu
    const res = await httpRequest(server, "POST", `/ivr/menus/${menu.menuId}/process`, {
      nodeId: "root",
      input: "2",
    });
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/not found/i);
  });
});

// ── DtmfDetector — step 4 (token scan fallback) ───────────────────────────

describe("DtmfDetector — token scan fallback (step 4)", () => {
  let detector: DtmfDetector;

  beforeEach(() => {
    detector = new DtmfDetector();
  });

  it("detects bare digit embedded in multi-word sentence (no phrase prefix)", () => {
    const result = detector.detect("the code is 3 please");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("3");
    expect(result.confidence).toBe(1.0);
  });

  it("detects bare word-digit embedded in sentence (no phrase prefix)", () => {
    const result = detector.detect("I think one would work");
    expect(result.detected).toBe(true);
    expect(result.digit).toBe("1");
    expect(result.confidence).toBe(1.0);
  });

  it("returns confidence 0.7 when multiple digits appear in sentence", () => {
    const result = detector.detect("either 3 or 5 works");
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe(0.7);
    expect(result.digit).toBe("3"); // first found
  });
});
