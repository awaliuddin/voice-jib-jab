/**
 * Voices API tests
 *
 * Tests all 11 endpoints produced by createVoicesRouter().
 * VoiceProfileStore, VoiceEngine, and VoiceAbTestService are fully mocked.
 *
 * HTTP transport uses the plain Node http helper consistent with the rest of
 * the API test suite in this directory.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createVoicesRouter } from "../../api/voices.js";
import type { VoiceProfileStore } from "../../services/VoiceProfileStore.js";
import type { VoiceEngine } from "../../services/KokoroVoiceEngine.js";
import type { VoiceAbTestService } from "../../services/VoiceAbTestService.js";
import type { VoiceProfile } from "../../services/VoiceProfileStore.js";
import type { VoiceAbTestConfig } from "../../services/VoiceAbTestService.js";

// ── Mock services ─────────────────────────────────────────────────────

const mockStore = {
  listProfiles: jest.fn(),
  createProfile: jest.fn(),
  getProfile: jest.fn(),
  deleteProfile: jest.fn(),
  getAudioDir: jest.fn().mockReturnValue("/tmp/audio"),
};

const mockVoiceEngine = {
  synthesize: jest.fn(),
};

const mockAbTestService = {
  listTests: jest.fn(),
  createTest: jest.fn(),
  getTestStats: jest.fn(),
  deactivateTest: jest.fn(),
};

// ── HTTP helper ───────────────────────────────────────────────────────

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
      headers: payload
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          }
        : {},
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

// ── App builders ──────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/voices",
    createVoicesRouter(
      mockStore as unknown as VoiceProfileStore,
      mockVoiceEngine as unknown as VoiceEngine,
      mockAbTestService as unknown as VoiceAbTestService,
    ),
  );
  return app;
}

function buildAppNoEngine(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/voices",
    createVoicesRouter(
      mockStore as unknown as VoiceProfileStore,
      undefined,
      mockAbTestService as unknown as VoiceAbTestService,
    ),
  );
  return app;
}

function buildAppNoAbTest(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/voices",
    createVoicesRouter(
      mockStore as unknown as VoiceProfileStore,
      mockVoiceEngine as unknown as VoiceEngine,
      undefined,
    ),
  );
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────

const TENANT_ID = "org_acme";
const PROFILE_ID = "profile-uuid-1234";

const SAMPLE_PROFILE: VoiceProfile = {
  profileId: PROFILE_ID,
  tenantId: TENANT_ID,
  name: "Acme Voice",
  createdAt: "2026-03-01T00:00:00.000Z",
  audioPath: "/tmp/audio/sample.wav",
  durationMs: 3200,
};

const SAMPLE_TEST: VoiceAbTestConfig = {
  testId: "test-uuid-5678",
  tenantId: TENANT_ID,
  name: "Bella vs Emma",
  voiceA: "af_bella",
  voiceB: "bf_emma",
  splitRatio: 0.5,
  active: true,
  createdAt: "2026-03-10T00:00:00.000Z",
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("Voices API — full service configuration", () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(buildApp());
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /voices/available ──────────────────────────────────────────

  describe("GET /voices/available", () => {
    it("returns 200 with built-in voices and empty custom array when no tenantId", async () => {
      const res = await httpRequest(server, "GET", "/voices/available");

      expect(res.status).toBe(200);
      const data = res.json() as { builtIn: unknown[]; custom: unknown[]; total: number };
      expect(data.builtIn).toHaveLength(8);
      expect(data.custom).toEqual([]);
      expect(data.total).toBe(8);
      expect(mockStore.listProfiles).not.toHaveBeenCalled();
    });

    it("returns built-in voices with previewText for each entry", async () => {
      const res = await httpRequest(server, "GET", "/voices/available");

      const data = res.json() as { builtIn: Array<{ name: string; previewText: string }> };
      for (const voice of data.builtIn) {
        expect(voice.name).toBeDefined();
        expect(voice.previewText).toBe("Hello, how can I help you today?");
      }
    });

    it("calls listProfiles and includes custom voices when tenantId is provided", async () => {
      mockStore.listProfiles.mockReturnValue([SAMPLE_PROFILE]);

      const res = await httpRequest(server, "GET", `/voices/available?tenantId=${TENANT_ID}`);

      expect(res.status).toBe(200);
      const data = res.json() as { builtIn: unknown[]; custom: VoiceProfile[]; total: number };
      expect(mockStore.listProfiles).toHaveBeenCalledWith(TENANT_ID);
      expect(data.custom).toHaveLength(1);
      expect(data.custom[0]).toMatchObject({ profileId: PROFILE_ID });
      expect(data.total).toBe(9);
    });
  });

  // ── GET /voices/abtests ───────────────────────────────────────────

  describe("GET /voices/abtests", () => {
    it("returns 400 when tenantId is absent", async () => {
      const res = await httpRequest(server, "GET", "/voices/abtests");

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tenantId");
    });

    it("returns 200 with test list when tenantId is provided", async () => {
      mockAbTestService.listTests.mockReturnValue([SAMPLE_TEST]);

      const res = await httpRequest(server, "GET", `/voices/abtests?tenantId=${TENANT_ID}`);

      expect(res.status).toBe(200);
      const data = res.json() as { tests: VoiceAbTestConfig[]; count: number };
      expect(mockAbTestService.listTests).toHaveBeenCalledWith(TENANT_ID);
      expect(data.tests).toHaveLength(1);
      expect(data.count).toBe(1);
    });

    it("returns empty tests array when no tests exist for tenant", async () => {
      mockAbTestService.listTests.mockReturnValue([]);

      const res = await httpRequest(server, "GET", `/voices/abtests?tenantId=${TENANT_ID}`);

      expect(res.status).toBe(200);
      const data = res.json() as { tests: unknown[]; count: number };
      expect(data.tests).toEqual([]);
      expect(data.count).toBe(0);
    });
  });

  // ── POST /voices/abtests ──────────────────────────────────────────

  describe("POST /voices/abtests", () => {
    it("returns 400 when tenantId is missing", async () => {
      const res = await httpRequest(server, "POST", "/voices/abtests", {
        name: "Test",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tenantId");
      expect(mockAbTestService.createTest).not.toHaveBeenCalled();
    });

    it("returns 400 when name is missing", async () => {
      const res = await httpRequest(server, "POST", "/voices/abtests", {
        tenantId: TENANT_ID,
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });

      expect(res.status).toBe(400);
      expect(mockAbTestService.createTest).not.toHaveBeenCalled();
    });

    it("returns 400 when voiceA is missing", async () => {
      const res = await httpRequest(server, "POST", "/voices/abtests", {
        tenantId: TENANT_ID,
        name: "Test",
        voiceB: "bf_emma",
      });

      expect(res.status).toBe(400);
      expect(mockAbTestService.createTest).not.toHaveBeenCalled();
    });

    it("returns 400 when voiceB is an empty string (isString false path)", async () => {
      const res = await httpRequest(server, "POST", "/voices/abtests", {
        tenantId: TENANT_ID,
        name: "Test",
        voiceA: "af_bella",
        voiceB: "",
      });

      expect(res.status).toBe(400);
      expect(mockAbTestService.createTest).not.toHaveBeenCalled();
    });

    it("returns 201 with created test when all required fields are present", async () => {
      mockAbTestService.createTest.mockReturnValue(SAMPLE_TEST);

      const res = await httpRequest(server, "POST", "/voices/abtests", {
        tenantId: TENANT_ID,
        name: "Bella vs Emma",
        voiceA: "af_bella",
        voiceB: "bf_emma",
      });

      expect(res.status).toBe(201);
      const data = res.json() as { test: VoiceAbTestConfig };
      expect(data.test).toMatchObject({ testId: SAMPLE_TEST.testId });
      expect(mockAbTestService.createTest).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          name: "Bella vs Emma",
          voiceA: "af_bella",
          voiceB: "bf_emma",
          splitRatio: undefined,
        }),
      );
    });

    it("passes numeric splitRatio when provided (typeof number true path)", async () => {
      mockAbTestService.createTest.mockReturnValue({ ...SAMPLE_TEST, splitRatio: 0.7 });

      await httpRequest(server, "POST", "/voices/abtests", {
        tenantId: TENANT_ID,
        name: "Weighted test",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: 0.7,
      });

      expect(mockAbTestService.createTest).toHaveBeenCalledWith(
        expect.objectContaining({ splitRatio: 0.7 }),
      );
    });

    it("passes splitRatio as undefined when it is a non-number (typeof number false path)", async () => {
      mockAbTestService.createTest.mockReturnValue(SAMPLE_TEST);

      await httpRequest(server, "POST", "/voices/abtests", {
        tenantId: TENANT_ID,
        name: "String ratio test",
        voiceA: "af_bella",
        voiceB: "bf_emma",
        splitRatio: "0.6",
      });

      expect(mockAbTestService.createTest).toHaveBeenCalledWith(
        expect.objectContaining({ splitRatio: undefined }),
      );
    });
  });

  // ── GET /voices/abtests/:testId/stats ─────────────────────────────

  describe("GET /voices/abtests/:testId/stats", () => {
    it("returns 404 when stats are not found", async () => {
      mockAbTestService.getTestStats.mockReturnValue(undefined);

      const res = await httpRequest(server, "GET", "/voices/abtests/nonexistent/stats");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("not found");
    });

    it("returns 200 with stats when test exists", async () => {
      const stats = {
        testId: SAMPLE_TEST.testId,
        voiceA: { name: "af_bella", sessions: 10, avgQuality: 0.85 },
        voiceB: { name: "bf_emma", sessions: 9, avgQuality: 0.82 },
      };
      mockAbTestService.getTestStats.mockReturnValue(stats);

      const res = await httpRequest(server, "GET", `/voices/abtests/${SAMPLE_TEST.testId}/stats`);

      expect(res.status).toBe(200);
      const data = res.json() as typeof stats;
      expect(data.testId).toBe(SAMPLE_TEST.testId);
      expect(data.voiceA.sessions).toBe(10);
      expect(mockAbTestService.getTestStats).toHaveBeenCalledWith(SAMPLE_TEST.testId);
    });
  });

  // ── POST /voices/abtests/:testId/deactivate ───────────────────────

  describe("POST /voices/abtests/:testId/deactivate", () => {
    it("returns 404 when test is not found", async () => {
      mockAbTestService.deactivateTest.mockReturnValue(undefined);

      const res = await httpRequest(server, "POST", "/voices/abtests/ghost-id/deactivate");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("not found");
    });

    it("returns 200 with deactivated test when test exists", async () => {
      const deactivated = { ...SAMPLE_TEST, active: false };
      mockAbTestService.deactivateTest.mockReturnValue(deactivated);

      const res = await httpRequest(
        server,
        "POST",
        `/voices/abtests/${SAMPLE_TEST.testId}/deactivate`,
      );

      expect(res.status).toBe(200);
      const data = res.json() as { test: VoiceAbTestConfig };
      expect(data.test.active).toBe(false);
      expect(mockAbTestService.deactivateTest).toHaveBeenCalledWith(SAMPLE_TEST.testId);
    });
  });

  // ── GET /voices ───────────────────────────────────────────────────

  describe("GET /voices", () => {
    it("returns 400 when tenantId is absent", async () => {
      const res = await httpRequest(server, "GET", "/voices");

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tenantId");
      expect(mockStore.listProfiles).not.toHaveBeenCalled();
    });

    it("returns 200 with profiles array when tenantId is provided", async () => {
      mockStore.listProfiles.mockReturnValue([SAMPLE_PROFILE]);

      const res = await httpRequest(server, "GET", `/voices?tenantId=${TENANT_ID}`);

      expect(res.status).toBe(200);
      const data = res.json() as { profiles: VoiceProfile[] };
      expect(mockStore.listProfiles).toHaveBeenCalledWith(TENANT_ID);
      expect(data.profiles).toHaveLength(1);
      expect(data.profiles[0].profileId).toBe(PROFILE_ID);
    });
  });

  // ── POST /voices ──────────────────────────────────────────────────

  describe("POST /voices", () => {
    it("returns 400 when tenantId is missing (isMissingRequired true path)", async () => {
      const res = await httpRequest(server, "POST", "/voices", {
        name: "Acme Voice",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tenantId");
      expect(mockStore.createProfile).not.toHaveBeenCalled();
    });

    it("returns 400 when name is missing (isMissingRequired true path)", async () => {
      const res = await httpRequest(server, "POST", "/voices", {
        tenantId: TENANT_ID,
      });

      expect(res.status).toBe(400);
      expect(mockStore.createProfile).not.toHaveBeenCalled();
    });

    it("returns 400 when tenantId is an empty string (isMissingRequired true path)", async () => {
      const res = await httpRequest(server, "POST", "/voices", {
        tenantId: "",
        name: "Acme Voice",
      });

      expect(res.status).toBe(400);
      expect(mockStore.createProfile).not.toHaveBeenCalled();
    });

    it("returns 201 with created profile when required fields are present", async () => {
      mockStore.createProfile.mockReturnValue(SAMPLE_PROFILE);

      const res = await httpRequest(server, "POST", "/voices", {
        tenantId: TENANT_ID,
        name: "Acme Voice",
      });

      expect(res.status).toBe(201);
      const data = res.json() as { profile: VoiceProfile };
      expect(data.profile.profileId).toBe(PROFILE_ID);
    });

    it("uses generated audioPath from getAudioDir when audioPath is omitted", async () => {
      mockStore.createProfile.mockReturnValue(SAMPLE_PROFILE);
      mockStore.getAudioDir.mockReturnValue("/tmp/audio");

      await httpRequest(server, "POST", "/voices", {
        tenantId: TENANT_ID,
        name: "Acme Voice",
      });

      expect(mockStore.getAudioDir).toHaveBeenCalled();
      const call = mockStore.createProfile.mock.calls[0][0] as { audioPath: string };
      expect(call.audioPath).toMatch(/^\/tmp\/audio\/.+\.wav$/);
    });

    it("passes provided audioPath directly when given (optional field path)", async () => {
      mockStore.createProfile.mockReturnValue(SAMPLE_PROFILE);

      await httpRequest(server, "POST", "/voices", {
        tenantId: TENANT_ID,
        name: "Acme Voice",
        audioPath: "/custom/path/voice.wav",
      });

      const call = mockStore.createProfile.mock.calls[0][0] as { audioPath: string };
      expect(call.audioPath).toBe("/custom/path/voice.wav");
      expect(mockStore.getAudioDir).not.toHaveBeenCalled();
    });
  });

  // ── GET /voices/:profileId ────────────────────────────────────────

  describe("GET /voices/:profileId", () => {
    it("returns 404 when profile does not exist", async () => {
      mockStore.getProfile.mockReturnValue(undefined);

      const res = await httpRequest(server, "GET", "/voices/unknown-id");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("not found");
    });

    it("returns 200 with profile when it exists", async () => {
      mockStore.getProfile.mockReturnValue(SAMPLE_PROFILE);

      const res = await httpRequest(server, "GET", `/voices/${PROFILE_ID}`);

      expect(res.status).toBe(200);
      const data = res.json() as { profile: VoiceProfile };
      expect(data.profile.profileId).toBe(PROFILE_ID);
      expect(mockStore.getProfile).toHaveBeenCalledWith(PROFILE_ID);
    });
  });

  // ── DELETE /voices/:profileId ─────────────────────────────────────

  describe("DELETE /voices/:profileId", () => {
    it("returns 404 when profile does not exist", async () => {
      mockStore.getProfile.mockReturnValue(undefined);

      const res = await httpRequest(server, "DELETE", "/voices/unknown-id");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("not found");
      expect(mockStore.deleteProfile).not.toHaveBeenCalled();
    });

    it("returns 204 and calls deleteProfile when profile exists", async () => {
      mockStore.getProfile.mockReturnValue(SAMPLE_PROFILE);
      mockStore.deleteProfile.mockReturnValue(true);

      const res = await httpRequest(server, "DELETE", `/voices/${PROFILE_ID}`);

      expect(res.status).toBe(204);
      expect(res.body).toBe("");
      expect(mockStore.deleteProfile).toHaveBeenCalledWith(PROFILE_ID);
    });
  });

  // ── POST /voices/:profileId/synthesize ────────────────────────────

  describe("POST /voices/:profileId/synthesize", () => {
    it("returns 400 when text is missing", async () => {
      const res = await httpRequest(server, "POST", `/voices/${PROFILE_ID}/synthesize`, {});

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("text");
      expect(mockVoiceEngine.synthesize).not.toHaveBeenCalled();
    });

    it("returns 400 when text is not a string", async () => {
      const res = await httpRequest(server, "POST", `/voices/${PROFILE_ID}/synthesize`, {
        text: 42,
      });

      expect(res.status).toBe(400);
      expect(mockVoiceEngine.synthesize).not.toHaveBeenCalled();
    });

    it("returns 404 when profile is not found", async () => {
      mockStore.getProfile.mockReturnValue(undefined);

      const res = await httpRequest(server, "POST", `/voices/nonexistent/synthesize`, {
        text: "Hello world",
      });

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("not found");
      expect(mockVoiceEngine.synthesize).not.toHaveBeenCalled();
    });

    it("returns 200 with audio/wav content-type on successful synthesis", async () => {
      mockStore.getProfile.mockReturnValue(SAMPLE_PROFILE);
      mockVoiceEngine.synthesize.mockResolvedValue(Buffer.from("fake-audio"));

      const res = await httpRequest(server, "POST", `/voices/${PROFILE_ID}/synthesize`, {
        text: "Hello world",
      });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("audio/wav");
      expect(mockVoiceEngine.synthesize).toHaveBeenCalledWith("Hello world", {
        voiceId: PROFILE_ID,
      });
    });

    it("returns audio bytes in response body on success", async () => {
      const fakeAudio = Buffer.from("fake-audio");
      mockStore.getProfile.mockReturnValue(SAMPLE_PROFILE);
      mockVoiceEngine.synthesize.mockResolvedValue(fakeAudio);

      const res = await httpRequest(server, "POST", `/voices/${PROFILE_ID}/synthesize`, {
        text: "Say something",
      });

      // Body bytes should equal the fake audio buffer content
      expect(Buffer.from(res.body, "utf-8")).toEqual(fakeAudio);
    });

    it("returns 500 with err.message when synthesize throws an Error instance", async () => {
      mockStore.getProfile.mockReturnValue(SAMPLE_PROFILE);
      mockVoiceEngine.synthesize.mockRejectedValue(new Error("Model not loaded"));

      const res = await httpRequest(server, "POST", `/voices/${PROFILE_ID}/synthesize`, {
        text: "Hello",
      });

      expect(res.status).toBe(500);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Model not loaded");
    });

    it("returns 500 with 'Synthesis failed' when synthesize throws a non-Error value", async () => {
      mockStore.getProfile.mockReturnValue(SAMPLE_PROFILE);
      mockVoiceEngine.synthesize.mockRejectedValue("plain string rejection");

      const res = await httpRequest(server, "POST", `/voices/${PROFILE_ID}/synthesize`, {
        text: "Hello",
      });

      expect(res.status).toBe(500);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Synthesis failed");
    });
  });
});

// ── No-engine configuration ───────────────────────────────────────────

describe("Voices API — no voice engine", () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(buildAppNoEngine());
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST /voices/:profileId/synthesize returns 503 when voiceEngine is absent", async () => {
    const res = await httpRequest(server, "POST", `/voices/${PROFILE_ID}/synthesize`, {
      text: "Hello",
    });

    expect(res.status).toBe(503);
    const data = res.json() as { error: string };
    expect(data.error).toContain("not configured");
  });

  it("other endpoints still work without voice engine (GET /voices/:profileId)", async () => {
    mockStore.getProfile.mockReturnValue(SAMPLE_PROFILE);

    const res = await httpRequest(server, "GET", `/voices/${PROFILE_ID}`);

    expect(res.status).toBe(200);
  });
});

// ── No-abTestService configuration ───────────────────────────────────

describe("Voices API — no A/B test service", () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(buildAppNoAbTest());
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /voices/abtests returns 503 when abTestService is absent", async () => {
    const res = await httpRequest(server, "GET", `/voices/abtests?tenantId=${TENANT_ID}`);

    expect(res.status).toBe(503);
    const data = res.json() as { error: string };
    expect(data.error).toContain("not configured");
  });

  it("POST /voices/abtests returns 503 when abTestService is absent", async () => {
    const res = await httpRequest(server, "POST", "/voices/abtests", {
      tenantId: TENANT_ID,
      name: "Test",
      voiceA: "af_bella",
      voiceB: "bf_emma",
    });

    expect(res.status).toBe(503);
    const data = res.json() as { error: string };
    expect(data.error).toContain("not configured");
  });

  it("GET /voices/abtests/:testId/stats returns 503 when abTestService is absent", async () => {
    const res = await httpRequest(server, "GET", "/voices/abtests/some-id/stats");

    expect(res.status).toBe(503);
    const data = res.json() as { error: string };
    expect(data.error).toContain("not configured");
  });

  it("POST /voices/abtests/:testId/deactivate returns 503 when abTestService is absent", async () => {
    const res = await httpRequest(server, "POST", "/voices/abtests/some-id/deactivate");

    expect(res.status).toBe(503);
    const data = res.json() as { error: string };
    expect(data.error).toContain("not configured");
  });

  it("GET /voices/available still works without abTestService", async () => {
    const res = await httpRequest(server, "GET", "/voices/available");

    expect(res.status).toBe(200);
  });
});

// ── Catch block coverage (store/service throws → 500) ──────────────────────

describe("Voices API — 500 error paths when store/service throws", () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(buildApp());
    server.listen(0, "127.0.0.1", done);
  });

  afterAll((done) => { server.close(done); });
  beforeEach(() => { jest.clearAllMocks(); });

  it("GET /voices/available returns 500 when store.listProfiles throws", async () => {
    mockStore.listProfiles.mockImplementation(() => { throw new Error("store down"); });
    const res = await httpRequest(server, "GET", `/voices/available?tenantId=${TENANT_ID}`);
    expect(res.status).toBe(500);
  });

  it("GET /voices/abtests returns 500 when abTestService.listTests throws", async () => {
    mockAbTestService.listTests.mockImplementation(() => { throw new Error("svc err"); });
    const res = await httpRequest(server, "GET", `/voices/abtests?tenantId=${TENANT_ID}`);
    expect(res.status).toBe(500);
  });

  it("POST /voices/abtests returns 500 when abTestService.createTest throws", async () => {
    mockAbTestService.createTest.mockImplementation(() => { throw new Error("svc err"); });
    const res = await httpRequest(server, "POST", "/voices/abtests", {
      tenantId: TENANT_ID, name: "T", voiceA: "af_bella", voiceB: "bf_emma",
    });
    expect(res.status).toBe(500);
  });

  it("GET /voices/abtests/:testId/stats returns 500 when getTestStats throws", async () => {
    mockAbTestService.getTestStats.mockImplementation(() => { throw new Error("svc err"); });
    const res = await httpRequest(server, "GET", "/voices/abtests/t1/stats");
    expect(res.status).toBe(500);
  });

  it("POST /voices/abtests/:testId/deactivate returns 500 when deactivateTest throws", async () => {
    mockAbTestService.deactivateTest.mockImplementation(() => { throw new Error("svc err"); });
    const res = await httpRequest(server, "POST", "/voices/abtests/t1/deactivate");
    expect(res.status).toBe(500);
  });

  it("GET /voices returns 500 when store.listProfiles throws", async () => {
    mockStore.listProfiles.mockImplementation(() => { throw new Error("store down"); });
    const res = await httpRequest(server, "GET", `/voices?tenantId=${TENANT_ID}`);
    expect(res.status).toBe(500);
  });

  it("POST /voices returns 500 when store.createProfile throws", async () => {
    mockStore.createProfile.mockImplementation(() => { throw new Error("store down"); });
    const res = await httpRequest(server, "POST", "/voices", { tenantId: TENANT_ID, name: "V" });
    expect(res.status).toBe(500);
  });

  it("GET /voices/:profileId returns 500 when store.getProfile throws", async () => {
    mockStore.getProfile.mockImplementation(() => { throw new Error("store down"); });
    const res = await httpRequest(server, "GET", "/voices/some-id");
    expect(res.status).toBe(500);
  });

  it("DELETE /voices/:profileId returns 500 when store.getProfile throws", async () => {
    mockStore.getProfile.mockImplementation(() => { throw new Error("store down"); });
    const res = await httpRequest(server, "DELETE", "/voices/some-id");
    expect(res.status).toBe(500);
  });

  // req.body ?? {} fallback — fires when no body + no Content-Type (express.json skips)
  it("POST /voices/abtests covers req.body ?? {} fallback (line 115) when no body sent", async () => {
    // No body → req.body = undefined → uses {} → missing fields → 400
    const res = await httpRequest(server, "POST", "/voices/abtests");
    expect(res.status).toBe(400);
  });

  it("POST /voices covers req.body ?? {} fallback (line 204) when no body sent", async () => {
    const res = await httpRequest(server, "POST", "/voices");
    expect(res.status).toBe(400);
  });

  it("POST /voices/:profileId/synthesize covers req.body ?? {} fallback (line 271) when no body sent", async () => {
    mockStore.getProfile.mockReturnValue({ profileId: "p1", tenantId: TENANT_ID, name: "V" });
    const res = await httpRequest(server, "POST", "/voices/p1/synthesize");
    expect(res.status).toBe(400);
  });
});
