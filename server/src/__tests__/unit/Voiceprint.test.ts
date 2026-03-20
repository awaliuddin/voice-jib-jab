/**
 * Voiceprint Tests
 *
 * Tests the VoiceprintStore service and the Voiceprints API endpoints.
 *
 * Store unit tests use jest.doMock("fs") for isolation.
 * API integration tests use real temp-file stores with raw HTTP requests.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, mkdtempSync } from "fs";

// Static imports for real-fs integration tests (must be before any jest.doMock calls)
import { VoiceprintStore as RealVoiceprintStore, initVoiceprintStore } from "../../services/VoiceprintStore.js";
import { ConversationMemoryStore as RealConversationMemoryStore } from "../../services/ConversationMemoryStore.js";
import { createVoiceprintsRouter } from "../../api/voiceprints.js";

// ── HTTP helpers ────────────────────────────────────────────────────────

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

// ── Test helpers ────────────────────────────────────────────────────────

function tempFile(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `voiceprint-test-${label}-`));
  return join(dir, "voiceprints.json");
}

function makeAudioBuffer(size = 256): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buf[i] = (i * 37 + 13) % 256;
  }
  return buf;
}

function makeDifferentAudioBuffer(size = 256): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buf[i] = (i * 7 + 200) % 256;
  }
  return buf;
}

// ── VoiceprintStore unit tests (mocked fs) ─────────────────────────────

describe("VoiceprintStore (mocked fs)", () => {
  const STORAGE_PATH = "/fake/voiceprints.json";

  let mockReadFileSync: jest.Mock;
  let mockWriteFileSync: jest.Mock;
  let mockExistsSync: jest.Mock;
  let mockMkdirSync: jest.Mock;
  let VoiceprintStore: typeof import("../../services/VoiceprintStore.js").VoiceprintStore;

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

    const mod = await import("../../services/VoiceprintStore.js");
    VoiceprintStore = mod.VoiceprintStore;
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  // ── extractEmbedding (via enroll) ─────────────────────────────────

  it("empty audio buffer produces 64-element all-zeros embedding", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    const vp = store.enroll("t1", "caller-1", Buffer.alloc(0));

    expect(vp.embedding).toHaveLength(64);
    expect(vp.embedding.every((v) => v === 0)).toBe(true);
  });

  it("non-empty audio buffer produces 64-element array of floats in [0,1]", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    const vp = store.enroll("t1", "caller-1", makeAudioBuffer(512));

    expect(vp.embedding).toHaveLength(64);
    expect(vp.embedding.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  // ── enroll ────────────────────────────────────────────────────────

  it("enroll: new caller creates voiceprint with sampleCount=1", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    const vp = store.enroll("tenant-a", "customer-1", makeAudioBuffer());

    expect(vp.voiceprintId).toBeDefined();
    expect(vp.callerId).toBe("customer-1");
    expect(vp.tenantId).toBe("tenant-a");
    expect(vp.sampleCount).toBe(1);
    expect(vp.enrolledAt).toBeDefined();
    expect(new Date(vp.enrolledAt).toISOString()).toBe(vp.enrolledAt);
  });

  it("enroll: new caller persists to disk via writeFileSync", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    store.enroll("tenant-a", "customer-1", makeAudioBuffer());

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      STORAGE_PATH,
      expect.any(String),
      "utf-8",
    );
  });

  it("enroll: same caller second time averages embedding and increments sampleCount", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    const first = store.enroll("tenant-a", "customer-1", makeAudioBuffer(128));
    const firstEmbedding = [...first.embedding];

    const second = store.enroll("tenant-a", "customer-1", makeAudioBuffer(256));

    expect(second.sampleCount).toBe(2);
    expect(second.voiceprintId).toBe(first.voiceprintId);
    // Embedding should have changed (averaged with new sample)
    const changed = second.embedding.some((v, i) => v !== firstEmbedding[i]);
    expect(changed).toBe(true);
  });

  it("enroll: second enroll for same caller updates existing record (no duplicates)", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    store.enroll("tenant-a", "customer-1", makeAudioBuffer());
    store.enroll("tenant-a", "customer-1", makeAudioBuffer());

    const list = store.listVoiceprints("tenant-a");
    expect(list).toHaveLength(1);
  });

  it("enroll: different callers same tenant are both stored", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    store.enroll("tenant-a", "caller-1", makeAudioBuffer());
    store.enroll("tenant-a", "caller-2", makeAudioBuffer());

    const list = store.listVoiceprints("tenant-a");
    expect(list).toHaveLength(2);
    expect(list.map((v) => v.callerId).sort()).toEqual(["caller-1", "caller-2"]);
  });

  // ── listVoiceprints ───────────────────────────────────────────────

  it("listVoiceprints: filters by tenantId", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    store.enroll("tenant-a", "caller-1", makeAudioBuffer());
    store.enroll("tenant-b", "caller-2", makeAudioBuffer());

    const aList = store.listVoiceprints("tenant-a");
    expect(aList).toHaveLength(1);
    expect(aList[0].tenantId).toBe("tenant-a");

    const bList = store.listVoiceprints("tenant-b");
    expect(bList).toHaveLength(1);
    expect(bList[0].tenantId).toBe("tenant-b");
  });

  it("listVoiceprints: returns empty array when tenant has no voiceprints", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    expect(store.listVoiceprints("unknown-tenant")).toEqual([]);
  });

  // ── getVoiceprint ─────────────────────────────────────────────────

  it("getVoiceprint: returns voiceprint by id", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    const created = store.enroll("tenant-a", "caller-1", makeAudioBuffer());
    const found = store.getVoiceprint(created.voiceprintId);

    expect(found).toBeDefined();
    expect(found!.voiceprintId).toBe(created.voiceprintId);
    expect(found!.callerId).toBe("caller-1");
  });

  it("getVoiceprint: returns undefined for unknown id", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    expect(store.getVoiceprint("nonexistent-id")).toBeUndefined();
  });

  // ── deleteVoiceprint ──────────────────────────────────────────────

  it("deleteVoiceprint: found → returns true and removes record", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    const created = store.enroll("tenant-a", "caller-1", makeAudioBuffer());
    const result = store.deleteVoiceprint(created.voiceprintId);

    expect(result).toBe(true);
    expect(store.getVoiceprint(created.voiceprintId)).toBeUndefined();
  });

  it("deleteVoiceprint: not found → returns false", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    expect(store.deleteVoiceprint("ghost-id")).toBe(false);
  });

  it("deleteVoiceprint: persists to disk after removal", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);
    const created = store.enroll("tenant-a", "caller-1", makeAudioBuffer());
    mockWriteFileSync.mockClear();

    store.deleteVoiceprint(created.voiceprintId);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  // ── identify ──────────────────────────────────────────────────────

  it("identify: returns identified=true for identical audio (cosine sim ~1.0)", () => {
    mockExistsSync.mockReturnValue(false);
    // Use threshold of 0 so any positive similarity matches
    const store = new VoiceprintStore(STORAGE_PATH, 0.0);
    const audio = makeAudioBuffer(256);

    store.enroll("tenant-a", "caller-1", audio);
    const result = store.identify("tenant-a", audio);

    expect(result.identified).toBe(true);
    expect(result.callerId).toBe("caller-1");
    expect(result.confidence).toBeGreaterThan(0.99);
  });

  it("identify: identical embeddings produce confidence ~1.0", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH, 0.0);
    const audio = makeAudioBuffer(512);

    store.enroll("tenant-a", "caller-1", audio);
    const result = store.identify("tenant-a", audio);

    expect(result.confidence).toBeGreaterThan(0.99);
  });

  it("identify: not identified when cosine similarity is below threshold", () => {
    mockExistsSync.mockReturnValue(false);
    // Use high threshold to force no match
    const store = new VoiceprintStore(STORAGE_PATH, 0.9999);
    const enrollAudio = makeAudioBuffer(256);
    const queryAudio = makeDifferentAudioBuffer(256);

    store.enroll("tenant-a", "caller-1", enrollAudio);
    const result = store.identify("tenant-a", queryAudio);

    expect(result.identified).toBe(false);
    expect(result.callerId).toBeNull();
    expect(result.voiceprintId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("identify: empty store returns not identified", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH);

    const result = store.identify("tenant-a", makeAudioBuffer());

    expect(result.identified).toBe(false);
    expect(result.callerId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.threshold).toBe(0.82);
  });

  it("identify: filters by tenantId — does not match cross-tenant voiceprints", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH, 0.0);
    const audio = makeAudioBuffer(256);

    // Enroll under tenant-b
    store.enroll("tenant-b", "caller-x", audio);

    // Identify under tenant-a — should not find tenant-b's voiceprint
    const result = store.identify("tenant-a", audio);

    expect(result.identified).toBe(false);
  });

  it("identify: zero vector embedding produces confidence 0", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH, 0.0);

    // Enroll with empty buffer (zero embedding)
    store.enroll("tenant-a", "caller-1", Buffer.alloc(0));

    // Identify with empty buffer (also zero embedding)
    const result = store.identify("tenant-a", Buffer.alloc(0));

    // Cosine similarity of zero vectors is 0 by spec
    expect(result.confidence).toBe(0);
    expect(result.identified).toBe(false);
  });

  it("identify: result contains the configured threshold", () => {
    mockExistsSync.mockReturnValue(false);
    const store = new VoiceprintStore(STORAGE_PATH, 0.75);

    const result = store.identify("tenant-a", makeAudioBuffer());

    expect(result.threshold).toBe(0.75);
  });

  // ── constructor: disk loading ─────────────────────────────────────

  it("constructor: skips loadFromDisk when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    new VoiceprintStore(STORAGE_PATH);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("constructor: loads voiceprints from disk when file exists", () => {
    const stored: import("../../services/VoiceprintStore.js").Voiceprint[] = [
      {
        voiceprintId: "vp-abc-123",
        callerId: "caller-from-disk",
        tenantId: "tenant-disk",
        embedding: new Array(64).fill(0.5),
        enrolledAt: "2026-01-01T00:00:00.000Z",
        sampleCount: 2,
      },
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(stored));

    const store = new VoiceprintStore(STORAGE_PATH);
    const found = store.getVoiceprint("vp-abc-123");

    expect(found).toBeDefined();
    expect(found!.callerId).toBe("caller-from-disk");
    expect(found!.sampleCount).toBe(2);
  });

  it("constructor: re-throws non-ENOENT errors from readFileSync", () => {
    mockExistsSync.mockReturnValue(true);
    const accessError = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    mockReadFileSync.mockImplementation(() => { throw accessError; });

    expect(() => new VoiceprintStore(STORAGE_PATH)).toThrow("Permission denied");
  });

  // ── singleton proxy + initVoiceprintStore ─────────────────────────

  it("voiceprintStore proxy throws 'not initialized' when accessed before initVoiceprintStore()", async () => {
    jest.resetModules();
    jest.doMock("fs", () => ({
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
      mkdirSync: jest.fn(),
    }));

    const { voiceprintStore } = await import("../../services/VoiceprintStore.js");

    expect(() =>
      (voiceprintStore as unknown as { listVoiceprints: (t: string) => unknown }).listVoiceprints("t"),
    ).toThrow("VoiceprintStore not initialized");
  });

  it("initVoiceprintStore initializes singleton and allows method calls through proxy", async () => {
    jest.resetModules();
    jest.doMock("fs", () => ({
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
      mkdirSync: jest.fn(),
    }));

    const { initVoiceprintStore, voiceprintStore } = await import("../../services/VoiceprintStore.js");

    initVoiceprintStore("/fake/init-test.json");

    const list = (voiceprintStore as unknown as { listVoiceprints: (t: string) => unknown[] }).listVoiceprints("any-tenant");
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(0);
  });
});

// ── VoiceprintStore integration tests (real fs) ───────────────────────

describe("VoiceprintStore (real fs)", () => {
  let store: RealVoiceprintStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("store");
    store = new RealVoiceprintStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("new store instance reloads voiceprints from disk", () => {
    store.enroll("tenant-a", "caller-persist", makeAudioBuffer());

    const store2 = new RealVoiceprintStore(storageFile);
    const list = store2.listVoiceprints("tenant-a");

    expect(list).toHaveLength(1);
    expect(list[0].callerId).toBe("caller-persist");
  });

  it("enroll with same caller twice averages embedding across reloads", () => {
    store.enroll("tenant-a", "caller-avg", makeAudioBuffer(128));
    store.enroll("tenant-a", "caller-avg", makeAudioBuffer(256));

    const store2 = new RealVoiceprintStore(storageFile);
    const list = store2.listVoiceprints("tenant-a");

    expect(list).toHaveLength(1);
    expect(list[0].sampleCount).toBe(2);
  });

  it("initVoiceprintStore returns a working store instance", () => {
    const sf = tempFile("init-factory");
    try {
      const result = initVoiceprintStore(sf);
      expect(result).toBeInstanceOf(RealVoiceprintStore);
      expect(result.listVoiceprints("any")).toHaveLength(0);
    } finally {
      const dir = join(sf, "..");
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── API Endpoint tests ─────────────────────────────────────────────────

describe("Voiceprints API Endpoints", () => {
  let app: Express;
  let server: Server;
  let store: RealVoiceprintStore;
  let memoryStore: RealConversationMemoryStore;
  let storageFile: string;
  let memoryDir: string;

  beforeAll(async () => {
    storageFile = tempFile("api");
    memoryDir = mkdtempSync(join(tmpdir(), "voiceprint-mem-test-"));

    store = new RealVoiceprintStore(storageFile, 0.0); // threshold 0 so same audio always matches
    memoryStore = new RealConversationMemoryStore(memoryDir);

    app = express();
    app.use(express.json());
    app.use("/voiceprints", createVoiceprintsRouter(store, memoryStore));

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
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true, force: true });
        resolve();
      });
    });
  });

  // ── POST /voiceprints/enroll ───────────────────────────────────────

  it("POST /voiceprints/enroll: 400 on missing tenantId", async () => {
    const res = await httpRequest(server, "POST", "/voiceprints/enroll", {
      callerId: "c1",
      audioData: makeAudioBuffer(64).toString("base64"),
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/tenantId/);
  });

  it("POST /voiceprints/enroll: 400 on missing callerId", async () => {
    const res = await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId: "t1",
      audioData: makeAudioBuffer(64).toString("base64"),
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/callerId/);
  });

  it("POST /voiceprints/enroll: 400 on missing audioData", async () => {
    const res = await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId: "t1",
      callerId: "c1",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/audioData/);
  });

  it("POST /voiceprints/enroll: 201 on valid request", async () => {
    const res = await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId: "tenant-enroll",
      callerId: "enroll-caller",
      audioData: makeAudioBuffer(128).toString("base64"),
    });
    expect(res.status).toBe(201);
    const data = res.json() as { voiceprintId: string; callerId: string; sampleCount: number };
    expect(data.voiceprintId).toBeDefined();
    expect(data.callerId).toBe("enroll-caller");
    expect(data.sampleCount).toBe(1);
  });

  it("POST /voiceprints/enroll: response omits embedding field", async () => {
    const res = await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId: "tenant-embed-check",
      callerId: "embed-caller",
      audioData: makeAudioBuffer(64).toString("base64"),
    });
    expect(res.status).toBe(201);
    const data = res.json() as Record<string, unknown>;
    expect("embedding" in data).toBe(false);
  });

  // ── POST /voiceprints/identify ─────────────────────────────────────

  it("POST /voiceprints/identify: 400 on missing tenantId", async () => {
    const res = await httpRequest(server, "POST", "/voiceprints/identify", {
      audioData: makeAudioBuffer(64).toString("base64"),
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/tenantId/);
  });

  it("POST /voiceprints/identify: 400 on missing audioData", async () => {
    const res = await httpRequest(server, "POST", "/voiceprints/identify", {
      tenantId: "t1",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/audioData/);
  });

  it("POST /voiceprints/identify: returns IdentifyResult", async () => {
    const audio = makeAudioBuffer(128);

    // Enroll first
    await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId: "tenant-id-test",
      callerId: "id-caller",
      audioData: audio.toString("base64"),
    });

    const res = await httpRequest(server, "POST", "/voiceprints/identify", {
      tenantId: "tenant-id-test",
      audioData: audio.toString("base64"),
    });

    expect(res.status).toBe(200);
    const data = res.json() as {
      identified: boolean;
      callerId: string | null;
      confidence: number;
      threshold: number;
    };
    expect(typeof data.identified).toBe("boolean");
    expect(typeof data.threshold).toBe("number");
  });

  it("POST /voiceprints/identify: includes context from memoryStore when caller identified", async () => {
    const audio = makeAudioBuffer(192);
    const tenantId = "tenant-mem-ctx";
    const callerId = "ctx-caller";

    // Add a memory entry for the tenant
    memoryStore.add({ tenantId, fact: "Prefers formal tone", source: "manual" });

    // Enroll the caller
    await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId,
      callerId,
      audioData: audio.toString("base64"),
    });

    // Identify using same audio (threshold=0 so it matches)
    const res = await httpRequest(server, "POST", "/voiceprints/identify", {
      tenantId,
      audioData: audio.toString("base64"),
    });

    expect(res.status).toBe(200);
    const data = res.json() as { identified: boolean; context?: unknown[] };
    expect(data.identified).toBe(true);
    expect(Array.isArray(data.context)).toBe(true);
    expect((data.context as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  // ── GET /voiceprints ───────────────────────────────────────────────

  it("GET /voiceprints: 400 without tenantId", async () => {
    const res = await httpRequest(server, "GET", "/voiceprints");
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/tenantId/);
  });

  it("GET /voiceprints?tenantId=x: returns voiceprints array with count", async () => {
    // Enroll a caller for a specific tenant
    const tenantId = "tenant-list-test";
    await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId,
      callerId: "list-caller",
      audioData: makeAudioBuffer(64).toString("base64"),
    });

    const res = await httpRequest(server, "GET", `/voiceprints?tenantId=${tenantId}`);
    expect(res.status).toBe(200);
    const data = res.json() as { voiceprints: unknown[]; count: number };
    expect(Array.isArray(data.voiceprints)).toBe(true);
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(typeof data.count).toBe("number");
  });

  it("GET /voiceprints?tenantId=x: response items omit embedding fields", async () => {
    const tenantId = "tenant-list-embed-check";
    await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId,
      callerId: "embed-check-caller",
      audioData: makeAudioBuffer(64).toString("base64"),
    });

    const res = await httpRequest(server, "GET", `/voiceprints?tenantId=${tenantId}`);
    expect(res.status).toBe(200);
    const data = res.json() as { voiceprints: Array<Record<string, unknown>> };
    expect(data.voiceprints.every((vp) => !("embedding" in vp))).toBe(true);
  });

  // ── GET /voiceprints/:voiceprintId ─────────────────────────────────

  it("GET /voiceprints/:id: 404 on missing voiceprint", async () => {
    const res = await httpRequest(server, "GET", "/voiceprints/does-not-exist");
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/not found/i);
  });

  it("GET /voiceprints/:id: 200 on found voiceprint (without embedding)", async () => {
    const enrollRes = await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId: "tenant-get-single",
      callerId: "single-caller",
      audioData: makeAudioBuffer(64).toString("base64"),
    });
    const enrolled = enrollRes.json() as { voiceprintId: string };

    const res = await httpRequest(server, "GET", `/voiceprints/${enrolled.voiceprintId}`);
    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect(data.voiceprintId).toBe(enrolled.voiceprintId);
    expect("embedding" in data).toBe(false);
  });

  // ── DELETE /voiceprints/:voiceprintId ──────────────────────────────

  it("DELETE /voiceprints/:id: 404 on missing voiceprint", async () => {
    const res = await httpRequest(server, "DELETE", "/voiceprints/ghost-vp-id");
    expect(res.status).toBe(404);
    const data = res.json() as { error: string };
    expect(data.error).toMatch(/not found/i);
  });

  it("DELETE /voiceprints/:id: 204 on success", async () => {
    const enrollRes = await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId: "tenant-delete-test",
      callerId: "delete-caller",
      audioData: makeAudioBuffer(64).toString("base64"),
    });
    const enrolled = enrollRes.json() as { voiceprintId: string };

    const deleteRes = await httpRequest(server, "DELETE", `/voiceprints/${enrolled.voiceprintId}`);
    expect(deleteRes.status).toBe(204);

    // Verify gone
    const fetchRes = await httpRequest(server, "GET", `/voiceprints/${enrolled.voiceprintId}`);
    expect(fetchRes.status).toBe(404);
  });
});

// ── API without memoryStore ────────────────────────────────────────────

describe("Voiceprints API — no memoryStore", () => {
  let app: Express;
  let server: Server;
  let store: RealVoiceprintStore;
  let storageFile: string;

  beforeAll(async () => {
    storageFile = tempFile("api-nomem");

    store = new RealVoiceprintStore(storageFile, 0.0);

    app = express();
    app.use(express.json());
    app.use("/voiceprints", createVoiceprintsRouter(store)); // no memoryStore

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
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        resolve();
      });
    });
  });

  it("POST /voiceprints/identify: does not include context when memoryStore absent", async () => {
    const audio = makeAudioBuffer(128);
    const tenantId = "tenant-nomem";

    await httpRequest(server, "POST", "/voiceprints/enroll", {
      tenantId,
      callerId: "nomem-caller",
      audioData: audio.toString("base64"),
    });

    const res = await httpRequest(server, "POST", "/voiceprints/identify", {
      tenantId,
      audioData: audio.toString("base64"),
    });

    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect("context" in data).toBe(false);
  });
});
