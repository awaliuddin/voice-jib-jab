/**
 * Playbook Tests
 *
 * Tests the PlaybookStore and Playbooks API endpoints.
 * Store unit tests use jest.mock("fs") for isolation.
 * API integration tests use a real temp-file store with raw HTTP requests.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, mkdtempSync } from "fs";

// ── PlaybookStore unit tests (mocked fs) ──────────────────────────────

describe("PlaybookStore (mocked fs)", () => {
  const STORAGE_PATH = "/fake/playbooks.json";

  let mockReadFileSync: jest.Mock;
  let mockWriteFileSync: jest.Mock;
  let mockExistsSync: jest.Mock;
  let mockMkdirSync: jest.Mock;
  let PlaybookStore: typeof import("../../services/PlaybookStore.js").PlaybookStore;

  beforeEach(async () => {
    jest.resetModules();

    mockReadFileSync = jest.fn();
    mockWriteFileSync = jest.fn();
    mockExistsSync = jest.fn().mockReturnValue(false);
    mockMkdirSync = jest.fn();

    jest.doMock("fs", () => ({
      readFileSync: mockReadFileSync,
      writeFileSync: mockWriteFileSync,
      existsSync: mockExistsSync,
      mkdirSync: mockMkdirSync,
    }));

    const mod = await import("../../services/PlaybookStore.js");
    PlaybookStore = mod.PlaybookStore;
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  // ── constructor ──────────────────────────────────────────────────

  it("constructor: skips loadFromDisk when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    new PlaybookStore(STORAGE_PATH);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("constructor: loads entries from disk when file exists", () => {
    const saved = [
      {
        entryId: "abc-123",
        name: "Welcome",
        scenario: "greeting",
        script: "Hello!",
        keywords: ["hello", "hi"],
        tenantId: null,
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(saved));

    const store = new PlaybookStore(STORAGE_PATH);
    const entry = store.getEntry("abc-123");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("Welcome");
  });

  // ── createEntry ──────────────────────────────────────────────────

  it("createEntry: generates UUID entryId", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    const entry = store.createEntry({
      name: "FAQ Entry",
      scenario: "faq",
      script: "Here is the answer.",
      keywords: ["faq"],
      tenantId: null,
      enabled: true,
    });

    expect(entry.entryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("createEntry: sets createdAt as ISO timestamp", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);
    const before = new Date().toISOString();

    const entry = store.createEntry({
      name: "Closing",
      scenario: "closing",
      script: "Goodbye.",
      keywords: [],
      tenantId: null,
      enabled: true,
    });

    const after = new Date().toISOString();
    expect(entry.createdAt >= before).toBe(true);
    expect(entry.createdAt <= after).toBe(true);
  });

  it("createEntry: persists to disk via writeFileSync", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({
      name: "Test",
      scenario: "custom",
      script: "Script.",
      keywords: [],
      tenantId: null,
      enabled: true,
    });

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      STORAGE_PATH,
      expect.any(String),
      "utf-8",
    );
  });

  it("createEntry: defaults enabled=true when not provided", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    const entry = store.createEntry({
      name: "Default Enabled",
      scenario: "greeting",
      script: "Hello!",
      keywords: [],
      tenantId: null,
    });

    expect(entry.enabled).toBe(true);
  });

  // ── getEntry ─────────────────────────────────────────────────────

  it("getEntry: returns entry by id", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    const created = store.createEntry({
      name: "Lookup",
      scenario: "faq",
      script: "Answer.",
      keywords: [],
      tenantId: null,
      enabled: true,
    });

    const found = store.getEntry(created.entryId);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Lookup");
  });

  it("getEntry: returns undefined for unknown id", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);
    expect(store.getEntry("does-not-exist")).toBeUndefined();
  });

  // ── listEntries ───────────────────────────────────────────────────

  it("listEntries: returns all entries with no filters", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "A", scenario: "greeting", script: "Hi", keywords: [], tenantId: null, enabled: true });
    store.createEntry({ name: "B", scenario: "closing", script: "Bye", keywords: [], tenantId: null, enabled: true });

    expect(store.listEntries()).toHaveLength(2);
  });

  it("listEntries: filters by tenantId and includes global (null) entries", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "Global", scenario: "greeting", script: "Hi", keywords: [], tenantId: null, enabled: true });
    store.createEntry({ name: "Tenant A", scenario: "greeting", script: "Hi A", keywords: [], tenantId: "tenant-a", enabled: true });
    store.createEntry({ name: "Tenant B", scenario: "greeting", script: "Hi B", keywords: [], tenantId: "tenant-b", enabled: true });

    const results = store.listEntries({ tenantId: "tenant-a" });
    expect(results).toHaveLength(2);
    expect(results.map((e) => e.name).sort()).toEqual(["Global", "Tenant A"]);
  });

  it("listEntries: filters by scenario", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "Greet", scenario: "greeting", script: "Hi", keywords: [], tenantId: null, enabled: true });
    store.createEntry({ name: "Close", scenario: "closing", script: "Bye", keywords: [], tenantId: null, enabled: true });

    const results = store.listEntries({ scenario: "greeting" });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Greet");
  });

  it("listEntries: filters by enabled=true", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "Active", scenario: "faq", script: "Yes", keywords: [], tenantId: null, enabled: true });
    store.createEntry({ name: "Inactive", scenario: "faq", script: "No", keywords: [], tenantId: null, enabled: false });

    const results = store.listEntries({ enabled: true });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Active");
  });

  it("listEntries: filters by enabled=false", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "Active", scenario: "faq", script: "Yes", keywords: [], tenantId: null, enabled: true });
    store.createEntry({ name: "Inactive", scenario: "faq", script: "No", keywords: [], tenantId: null, enabled: false });

    const results = store.listEntries({ enabled: false });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Inactive");
  });

  // ── updateEntry ───────────────────────────────────────────────────

  it("updateEntry: returns updated entry with patched fields", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    const created = store.createEntry({
      name: "Original",
      scenario: "custom",
      script: "Old script",
      keywords: [],
      tenantId: null,
      enabled: true,
    });

    const updated = store.updateEntry(created.entryId, { name: "Updated", script: "New script" });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated");
    expect(updated!.script).toBe("New script");
    expect(updated!.scenario).toBe("custom");
  });

  it("updateEntry: preserves createdAt", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    const created = store.createEntry({
      name: "Entry",
      scenario: "faq",
      script: "Script",
      keywords: [],
      tenantId: null,
      enabled: true,
    });

    const updated = store.updateEntry(created.entryId, { name: "Renamed" });
    expect(updated!.createdAt).toBe(created.createdAt);
  });

  it("updateEntry: persists to disk", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);
    const created = store.createEntry({ name: "E", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });
    mockWriteFileSync.mockClear();

    store.updateEntry(created.entryId, { name: "E2" });

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it("updateEntry: returns undefined for unknown id", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);
    expect(store.updateEntry("ghost-id", { name: "Ghost" })).toBeUndefined();
  });

  // ── deleteEntry ───────────────────────────────────────────────────

  it("deleteEntry: removes entry and returns true", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    const created = store.createEntry({ name: "Delete Me", scenario: "custom", script: ".", keywords: [], tenantId: null, enabled: true });
    const result = store.deleteEntry(created.entryId);

    expect(result).toBe(true);
    expect(store.getEntry(created.entryId)).toBeUndefined();
  });

  it("deleteEntry: persists to disk after removal", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);
    const created = store.createEntry({ name: "D", scenario: "custom", script: ".", keywords: [], tenantId: null, enabled: true });
    mockWriteFileSync.mockClear();

    store.deleteEntry(created.entryId);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it("deleteEntry: returns false for unknown id", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);
    expect(store.deleteEntry("nonexistent")).toBe(false);
  });

  // ── suggestEntries ────────────────────────────────────────────────

  it("suggestEntries: returns entries matching any keyword (case-insensitive)", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "Billing", scenario: "faq", script: "Billing info.", keywords: ["billing", "invoice"], tenantId: null, enabled: true });
    store.createEntry({ name: "Shipping", scenario: "faq", script: "Shipping info.", keywords: ["shipping", "delivery"], tenantId: null, enabled: true });

    const results = store.suggestEntries("I have a question about my BILLING statement");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Billing");
  });

  it("suggestEntries: only returns enabled entries", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "Active", scenario: "faq", script: "S", keywords: ["help"], tenantId: null, enabled: true });
    store.createEntry({ name: "Inactive", scenario: "faq", script: "S", keywords: ["help"], tenantId: null, enabled: false });

    const results = store.suggestEntries("I need help");
    expect(results.map((e) => e.name)).not.toContain("Inactive");
    expect(results.map((e) => e.name)).toContain("Active");
  });

  it("suggestEntries: respects tenantId and includes global null entries", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "Global", scenario: "faq", script: "S", keywords: ["refund"], tenantId: null, enabled: true });
    store.createEntry({ name: "Tenant A Only", scenario: "faq", script: "S", keywords: ["refund"], tenantId: "tenant-a", enabled: true });
    store.createEntry({ name: "Tenant B Only", scenario: "faq", script: "S", keywords: ["refund"], tenantId: "tenant-b", enabled: true });

    const results = store.suggestEntries("I want a refund", { tenantId: "tenant-a" });
    const names = results.map((e) => e.name);
    expect(names).toContain("Global");
    expect(names).toContain("Tenant A Only");
    expect(names).not.toContain("Tenant B Only");
  });

  it("suggestEntries: sorts by match count and returns top 3", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    // 3 keyword matches
    store.createEntry({ name: "High", scenario: "faq", script: "S", keywords: ["refund", "billing", "invoice"], tenantId: null, enabled: true });
    // 2 keyword matches
    store.createEntry({ name: "Mid", scenario: "faq", script: "S", keywords: ["refund", "billing", "other"], tenantId: null, enabled: true });
    // 1 keyword match
    store.createEntry({ name: "Low1", scenario: "faq", script: "S", keywords: ["refund", "xyz", "abc"], tenantId: null, enabled: true });
    // 1 keyword match
    store.createEntry({ name: "Low2", scenario: "faq", script: "S", keywords: ["refund", "zzz", "yyy"], tenantId: null, enabled: true });

    const results = store.suggestEntries("I need a refund for my billing invoice");
    expect(results).toHaveLength(3);
    expect(results[0].name).toBe("High");
    expect(results[1].name).toBe("Mid");
  });

  it("suggestEntries: returns empty array when no matches", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "Billing", scenario: "faq", script: "S", keywords: ["billing"], tenantId: null, enabled: true });

    const results = store.suggestEntries("the weather is nice today");
    expect(results).toHaveLength(0);
  });

  // ── loadFromDisk non-ENOENT error ──────────────────────────────────

  it("constructor: re-throws non-ENOENT errors from readFileSync", () => {
    mockExistsSync.mockReturnValue(true);
    const accessError = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    mockReadFileSync.mockImplementation(() => { throw accessError; });

    expect(() => new PlaybookStore(STORAGE_PATH)).toThrow("Permission denied");
  });

  // ── suggestEntries: tenantId filter with no keyword matches ───────

  it("suggestEntries: returns [] when tenantId scoped entries have no keyword matches", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    // Entry belongs to tenant-b only — should be excluded for tenant-a
    store.createEntry({ name: "Tenant B Entry", scenario: "faq", script: "S", keywords: ["refund"], tenantId: "tenant-b", enabled: true });

    const results = store.suggestEntries("I want a refund", { tenantId: "tenant-a" });
    expect(results).toHaveLength(0);
  });

  it("suggestEntries: returns [] when keyword-matched candidates are all disabled and tenantId is scoped", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new PlaybookStore(STORAGE_PATH);

    store.createEntry({ name: "Disabled Tenant A", scenario: "faq", script: "S", keywords: ["cancel"], tenantId: "tenant-a", enabled: false });

    const results = store.suggestEntries("I need to cancel", { tenantId: "tenant-a" });
    expect(results).toHaveLength(0);
  });

  // ── playbookStore proxy + initPlaybookStore ────────────────────────

  it("playbookStore proxy: throws 'not initialized' when accessed before initPlaybookStore()", async () => {
    // Use a fresh module so _store is null
    jest.resetModules();
    jest.doMock("fs", () => ({
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
      mkdirSync: jest.fn(),
    }));

    const { playbookStore } = await import("../../services/PlaybookStore.js");

    expect(() => (playbookStore as unknown as { listEntries: () => unknown }).listEntries()).toThrow(
      "PlaybookStore not initialized",
    );
  });

  it("initPlaybookStore: initializes singleton and allows method calls through proxy", async () => {
    jest.resetModules();
    jest.doMock("fs", () => ({
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
      mkdirSync: jest.fn(),
    }));

    const { initPlaybookStore, playbookStore } = await import("../../services/PlaybookStore.js");

    initPlaybookStore("/fake/init-test.json");

    // Proxy should now delegate to the real store instance
    const entries = (playbookStore as unknown as { listEntries: () => unknown[] }).listEntries();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(0);
  });
});

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

function tempFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `playbook-test-${name}-`));
  return join(dir, "playbooks.json");
}

// ── API router tests ───────────────────────────────────────────────────

describe("Playbooks API Endpoints", () => {
  let app: Express;
  let server: Server;
  // Store and router imported without mocked fs for integration tests
  let store: import("../../services/PlaybookStore.js").PlaybookStore;
  let storageFile: string;

  beforeAll(async () => {
    storageFile = tempFile("api");
    const { PlaybookStore } = await import("../../services/PlaybookStore.js");
    const { createPlaybooksRouter } = await import("../../api/playbooks.js");

    store = new PlaybookStore(storageFile);
    app = express();
    app.use(express.json());
    app.use("/playbooks", createPlaybooksRouter(store));

    await new Promise<void>((resolve) => {
      server = createServer(app);
      server.listen(0, resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        const dir = join(storageFile, "..");
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
        }
        resolve();
      });
    });
  });

  // ── GET /playbooks ─────────────────────────────────────────────────

  it("GET /playbooks: returns all entries", async () => {
    const res = await httpRequest(server, "GET", "/playbooks");
    expect(res.status).toBe(200);
    const data = res.json() as { entries: unknown[]; count: number };
    expect(Array.isArray(data.entries)).toBe(true);
    expect(typeof data.count).toBe("number");
  });

  it("GET /playbooks: filters by scenario query param", async () => {
    store.createEntry({ name: "Greet Test", scenario: "greeting", script: "Hello", keywords: [], tenantId: null, enabled: true });
    store.createEntry({ name: "Close Test", scenario: "closing", script: "Bye", keywords: [], tenantId: null, enabled: true });

    const res = await httpRequest(server, "GET", "/playbooks?scenario=greeting");
    expect(res.status).toBe(200);
    const data = res.json() as { entries: Array<{ scenario: string }>; count: number };
    expect(data.entries.every((e) => e.scenario === "greeting")).toBe(true);
  });

  // ── GET /playbooks/suggest ─────────────────────────────────────────

  it("GET /playbooks/suggest: returns suggestions for text", async () => {
    store.createEntry({ name: "Refund FAQ", scenario: "faq", script: "Refund policy.", keywords: ["refund"], tenantId: null, enabled: true });

    const res = await httpRequest(server, "GET", "/playbooks/suggest?text=I+want+a+refund");
    expect(res.status).toBe(200);
    const data = res.json() as { suggestions: unknown[]; count: number };
    expect(Array.isArray(data.suggestions)).toBe(true);
    expect(data.count).toBeGreaterThanOrEqual(1);
  });

  it("GET /playbooks/suggest: returns 400 if text is missing", async () => {
    const res = await httpRequest(server, "GET", "/playbooks/suggest");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("text");
  });

  // ── GET /playbooks/:entryId ────────────────────────────────────────

  it("GET /playbooks/:entryId: returns 400 on invalid id format", async () => {
    const res = await httpRequest(server, "GET", "/playbooks/bad..id!!!");
    expect(res.status).toBe(400);
  });

  it("GET /playbooks/:entryId: returns 404 on missing entry", async () => {
    const res = await httpRequest(server, "GET", "/playbooks/nonexistent-entry-id");
    expect(res.status).toBe(404);
  });

  it("GET /playbooks/:entryId: returns entry when found", async () => {
    const created = store.createEntry({ name: "Fetchable", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });

    const res = await httpRequest(server, "GET", `/playbooks/${created.entryId}`);
    expect(res.status).toBe(200);
    const data = res.json() as { entryId: string; name: string };
    expect(data.entryId).toBe(created.entryId);
    expect(data.name).toBe("Fetchable");
  });

  // ── POST /playbooks ────────────────────────────────────────────────

  it("POST /playbooks: returns 400 on missing name", async () => {
    const res = await httpRequest(server, "POST", "/playbooks", {
      scenario: "faq",
      script: "A script.",
    });
    expect(res.status).toBe(400);
  });

  it("POST /playbooks: returns 400 on missing script", async () => {
    const res = await httpRequest(server, "POST", "/playbooks", {
      name: "Entry",
      scenario: "faq",
    });
    expect(res.status).toBe(400);
  });

  it("POST /playbooks: returns 400 on missing scenario", async () => {
    const res = await httpRequest(server, "POST", "/playbooks", {
      name: "Entry",
      script: "A script.",
    });
    expect(res.status).toBe(400);
  });

  it("POST /playbooks: returns 400 on invalid scenario", async () => {
    const res = await httpRequest(server, "POST", "/playbooks", {
      name: "Entry",
      scenario: "not-a-scenario",
      script: "A script.",
    });
    expect(res.status).toBe(400);
  });

  it("POST /playbooks: returns 201 and created entry on valid payload", async () => {
    const res = await httpRequest(server, "POST", "/playbooks", {
      name: "New FAQ",
      scenario: "faq",
      script: "The answer is 42.",
      keywords: ["answer", "question"],
      tenantId: "tenant-x",
    });

    expect(res.status).toBe(201);
    const data = res.json() as { entryId: string; name: string; scenario: string; enabled: boolean };
    expect(data.entryId).toBeDefined();
    expect(data.name).toBe("New FAQ");
    expect(data.scenario).toBe("faq");
    expect(data.enabled).toBe(true);
  });

  // ── PUT /playbooks/:entryId ────────────────────────────────────────

  it("PUT /playbooks/:entryId: returns 404 on missing entry", async () => {
    const res = await httpRequest(server, "PUT", "/playbooks/ghost-entry-id", {
      name: "Ghost",
    });
    expect(res.status).toBe(404);
  });

  it("PUT /playbooks/:entryId: updates fields on valid patch", async () => {
    const created = store.createEntry({ name: "Before", scenario: "custom", script: "Old", keywords: [], tenantId: null, enabled: true });

    const res = await httpRequest(server, "PUT", `/playbooks/${created.entryId}`, {
      name: "After",
      script: "New",
    });

    expect(res.status).toBe(200);
    const data = res.json() as { name: string; script: string };
    expect(data.name).toBe("After");
    expect(data.script).toBe("New");
  });

  // ── DELETE /playbooks/:entryId ─────────────────────────────────────

  it("DELETE /playbooks/:entryId: returns 404 on missing entry", async () => {
    const res = await httpRequest(server, "DELETE", "/playbooks/ghost-delete-id");
    expect(res.status).toBe(404);
  });

  it("DELETE /playbooks/:entryId: returns 204 on success", async () => {
    const created = store.createEntry({ name: "Delete Me", scenario: "custom", script: ".", keywords: [], tenantId: null, enabled: true });

    const res = await httpRequest(server, "DELETE", `/playbooks/${created.entryId}`);
    expect(res.status).toBe(204);

    const checkRes = await httpRequest(server, "GET", `/playbooks/${created.entryId}`);
    expect(checkRes.status).toBe(404);
  });

  // ── GET /playbooks: enabled filter branches ────────────────────────

  it("GET /playbooks: enabled=true filters to only enabled entries", async () => {
    store.createEntry({ name: "Enabled Filter Test", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });
    store.createEntry({ name: "Disabled Filter Test", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: false });

    const res = await httpRequest(server, "GET", "/playbooks?enabled=true");
    expect(res.status).toBe(200);
    const data = res.json() as { entries: Array<{ enabled: boolean }>; count: number };
    expect(data.entries.every((e) => e.enabled === true)).toBe(true);
  });

  it("GET /playbooks: enabled=false filters to only disabled entries", async () => {
    store.createEntry({ name: "Enabled B", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });
    store.createEntry({ name: "Disabled B", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: false });

    const res = await httpRequest(server, "GET", "/playbooks?enabled=false");
    expect(res.status).toBe(200);
    const data = res.json() as { entries: Array<{ enabled: boolean }>; count: number };
    expect(data.entries.every((e) => e.enabled === false)).toBe(true);
    expect(data.count).toBeGreaterThanOrEqual(1);
  });

  // ── POST /playbooks: keywords and enabled validation ───────────────

  it("POST /playbooks: returns 400 when keywords is not an array of strings", async () => {
    const res = await httpRequest(server, "POST", "/playbooks", {
      name: "Bad Keywords",
      scenario: "faq",
      script: "Some script.",
      keywords: "not-an-array",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("keywords");
  });

  it("POST /playbooks: returns 400 when keywords contains non-string elements", async () => {
    const res = await httpRequest(server, "POST", "/playbooks", {
      name: "Mixed Keywords",
      scenario: "faq",
      script: "Some script.",
      keywords: ["valid", 42],
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("keywords");
  });

  it("POST /playbooks: returns 400 when enabled is not a boolean", async () => {
    const res = await httpRequest(server, "POST", "/playbooks", {
      name: "Bad Enabled",
      scenario: "faq",
      script: "Some script.",
      enabled: "yes",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("enabled");
  });

  // ── PUT /playbooks/:entryId: validation branches ───────────────────

  it("PUT /playbooks/:entryId: returns 400 on invalid entryId format", async () => {
    const res = await httpRequest(server, "PUT", "/playbooks/bad..id!!!", { name: "X" });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("entryId");
  });

  it("PUT /playbooks/:entryId: returns 400 when name is not a string", async () => {
    const created = store.createEntry({ name: "For Name Check", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });

    const res = await httpRequest(server, "PUT", `/playbooks/${created.entryId}`, {
      name: 999,
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("name");
  });

  it("PUT /playbooks/:entryId: returns 400 when scenario is invalid", async () => {
    const created = store.createEntry({ name: "For Scenario Check", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });

    const res = await httpRequest(server, "PUT", `/playbooks/${created.entryId}`, {
      scenario: "not-valid-scenario",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("scenario");
  });

  it("PUT /playbooks/:entryId: returns 400 when script is not a string", async () => {
    const created = store.createEntry({ name: "For Script Check", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });

    const res = await httpRequest(server, "PUT", `/playbooks/${created.entryId}`, {
      script: true,
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("script");
  });

  it("PUT /playbooks/:entryId: returns 400 when keywords is not string[]", async () => {
    const created = store.createEntry({ name: "For Keywords Check", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });

    const res = await httpRequest(server, "PUT", `/playbooks/${created.entryId}`, {
      keywords: { wrong: true },
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("keywords");
  });

  it("PUT /playbooks/:entryId: returns 400 when enabled is not a boolean", async () => {
    const created = store.createEntry({ name: "For Enabled Check", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });

    const res = await httpRequest(server, "PUT", `/playbooks/${created.entryId}`, {
      enabled: "true",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("enabled");
  });

  it("PUT /playbooks/:entryId: sets tenantId to null when tenantId is non-string", async () => {
    const created = store.createEntry({ name: "Tenant Null Test", scenario: "faq", script: "S", keywords: [], tenantId: "original-tenant", enabled: true });

    const res = await httpRequest(server, "PUT", `/playbooks/${created.entryId}`, {
      tenantId: 0,
    });
    expect(res.status).toBe(200);
    const data = res.json() as { tenantId: string | null };
    expect(data.tenantId).toBeNull();
  });

  it("PUT /playbooks/:entryId: returns 404 when updateEntry returns undefined (race condition fallback)", async () => {
    const created = store.createEntry({ name: "Race Condition Entry", scenario: "faq", script: "S", keywords: [], tenantId: null, enabled: true });

    // Temporarily make updateEntry return undefined to simulate race condition
    const originalUpdate = store.updateEntry.bind(store);
    jest.spyOn(store, "updateEntry").mockImplementationOnce(() => undefined);

    const res = await httpRequest(server, "PUT", `/playbooks/${created.entryId}`, {
      name: "Updated",
    });
    expect(res.status).toBe(404);

    // Restore original
    jest.spyOn(store, "updateEntry").mockImplementation(originalUpdate);
  });

  // ── DELETE /playbooks/:entryId: invalid id format ──────────────────

  it("DELETE /playbooks/:entryId: returns 400 on invalid entryId format", async () => {
    const res = await httpRequest(server, "DELETE", "/playbooks/bad..id!!!");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("entryId");
  });
});
