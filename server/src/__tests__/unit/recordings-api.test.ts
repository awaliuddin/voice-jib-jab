/**
 * Recordings API Tests
 *
 * Tests the /recordings router produced by createRecordingsRouter().
 * RecordingStore is fully mocked. File streaming is tested by mocking
 * "fs" so createReadStream returns a controllable PassThrough stream.
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import { PassThrough } from "stream";
import express, { type Express } from "express";
import { createServer, type Server } from "http";

// ── Mock "fs" before any imports that touch it ────────────────────────

const mockCreateReadStream = jest.fn();

jest.mock("fs", () => ({
  // Spread real fs so other imports (e.g. path helpers) are unaffected,
  // but replace createReadStream with the spy.
  ...jest.requireActual<typeof import("fs")>("fs"),
  createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
}));

// ── Import router AFTER the fs mock is in place ───────────────────────

import { createRecordingsRouter } from "../../api/recordings.js";

// ── Mock RecordingStore ───────────────────────────────────────────────

const mockStore = {
  listRecordings: jest.fn(),
  getAudioPath: jest.fn(),
  hasRecording: jest.fn(),
  deleteRecording: jest.fn(),
};

// ── HTTP helper (mirrors AdminApi.test.ts pattern) ────────────────────

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
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
    };

    import("http").then(({ default: http }) => {
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<
              string,
              string | string[] | undefined
            >,
            body: rawBody,
            json: () => JSON.parse(rawBody),
          });
        });
      });
      req.on("error", reject);
      req.end();
    });
  });
}

// ── Test app ──────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/recordings", createRecordingsRouter(mockStore as never));
  return app;
}

// ── Sample fixture data ───────────────────────────────────────────────

const RECORDING_A = {
  sessionId: "sess-aaa",
  tenantId: "org_acme",
  startedAt: "2026-01-10T10:00:00.000Z",
  endedAt: "2026-01-10T10:05:00.000Z",
  durationMs: 300_000,
  audioSizeBytes: 14_400_000,
  audioAvailable: true,
  retentionExpiresAt: "2026-04-10T10:00:00.000Z",
  sampleRate: 24000,
  channels: 1,
};

const RECORDING_B = {
  sessionId: "sess-bbb",
  tenantId: "org_beta",
  startedAt: "2026-02-15T14:00:00.000Z",
  endedAt: "2026-02-15T14:10:00.000Z",
  durationMs: 600_000,
  audioSizeBytes: 28_800_000,
  audioAvailable: true,
  retentionExpiresAt: "2026-05-15T14:00:00.000Z",
  sampleRate: 24000,
  channels: 1,
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("Recordings API", () => {
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

  // ── GET /recordings ────────────────────────────────────────────────

  describe("GET /recordings", () => {
    it("returns 200 with recordings array and envelope", async () => {
      mockStore.listRecordings.mockResolvedValue([RECORDING_A, RECORDING_B]);

      const res = await httpRequest(server, "GET", "/recordings");

      expect(res.status).toBe(200);
      const data = res.json() as {
        recordings: typeof RECORDING_A[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(Array.isArray(data.recordings)).toBe(true);
      expect(data.recordings).toHaveLength(2);
      expect(data.total).toBe(2);
      expect(data.limit).toBe(100);
      expect(data.offset).toBe(0);
    });

    it("passes tenantId filter to store", async () => {
      mockStore.listRecordings.mockResolvedValue([RECORDING_A]);

      await httpRequest(server, "GET", "/recordings?tenant=org_acme");

      expect(mockStore.listRecordings).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "org_acme" }),
      );
    });

    it("passes from and to as Date objects to store", async () => {
      mockStore.listRecordings.mockResolvedValue([]);

      await httpRequest(
        server,
        "GET",
        "/recordings?from=2026-01-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z",
      );

      expect(mockStore.listRecordings).toHaveBeenCalledWith(
        expect.objectContaining({
          from: new Date("2026-01-01T00:00:00.000Z"),
          to: new Date("2026-03-01T00:00:00.000Z"),
        }),
      );
    });

    it("returns 400 for an invalid from date", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/recordings?from=not-a-date",
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("from");
    });

    it("returns 400 for an invalid to date", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/recordings?to=definitely-wrong",
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("to");
    });

    it("applies limit and offset to the result set", async () => {
      const all = [RECORDING_A, RECORDING_B];
      mockStore.listRecordings.mockResolvedValue(all);

      const res = await httpRequest(
        server,
        "GET",
        "/recordings?limit=1&offset=1",
      );

      expect(res.status).toBe(200);
      const data = res.json() as {
        recordings: typeof RECORDING_B[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(data.recordings).toHaveLength(1);
      expect(data.recordings[0].sessionId).toBe("sess-bbb");
      expect(data.total).toBe(2);
      expect(data.limit).toBe(1);
      expect(data.offset).toBe(1);
    });

    it("returns total as pre-slice count when offset exceeds results", async () => {
      mockStore.listRecordings.mockResolvedValue([RECORDING_A]);

      const res = await httpRequest(
        server,
        "GET",
        "/recordings?offset=999",
      );

      expect(res.status).toBe(200);
      const data = res.json() as { recordings: unknown[]; total: number };
      expect(data.total).toBe(1);
      expect(data.recordings).toHaveLength(0);
    });

    it("caps limit at 500 when a larger value is requested", async () => {
      mockStore.listRecordings.mockResolvedValue([]);

      const res = await httpRequest(
        server,
        "GET",
        "/recordings?limit=9999",
      );

      expect(res.status).toBe(200);
      const data = res.json() as { limit: number };
      expect(data.limit).toBe(500);
    });

    it("returns 500 when listRecordings throws", async () => {
      mockStore.listRecordings.mockRejectedValue(new Error("db unavailable"));

      const res = await httpRequest(server, "GET", "/recordings");

      expect(res.status).toBe(500);
      const data = res.json() as { error: string };
      expect(data.error).toContain("db unavailable");
    });
  });

  // ── GET /recordings/:sessionId ─────────────────────────────────────

  describe("GET /recordings/:sessionId", () => {
    it("returns 404 when hasRecording returns false", async () => {
      mockStore.hasRecording.mockReturnValue(false);

      const res = await httpRequest(server, "GET", "/recordings/sess-missing");

      expect(res.status).toBe(404);
    });

    it("streams file bytes when recording exists", async () => {
      mockStore.hasRecording.mockReturnValue(true);
      mockStore.getAudioPath.mockReturnValue("/recordings/sess-aaa.wav");

      const pt = new PassThrough();
      mockCreateReadStream.mockReturnValue(pt);

      const responsePromise = httpRequest(server, "GET", "/recordings/sess-aaa");

      // Push data after the request is initiated
      setImmediate(() => {
        pt.end(Buffer.from("RIFF...."));
      });

      const res = await responsePromise;

      expect(res.status).toBe(200);
      expect(res.body).toContain("RIFF");
    });

    it("sets Content-Type to audio/wav", async () => {
      mockStore.hasRecording.mockReturnValue(true);
      mockStore.getAudioPath.mockReturnValue("/recordings/sess-aaa.wav");

      const pt = new PassThrough();
      mockCreateReadStream.mockReturnValue(pt);

      const responsePromise = httpRequest(server, "GET", "/recordings/sess-aaa");
      setImmediate(() => pt.end());

      const res = await responsePromise;

      expect(res.headers["content-type"]).toContain("audio/wav");
    });

    it("sets Content-Disposition with the sessionId filename", async () => {
      mockStore.hasRecording.mockReturnValue(true);
      mockStore.getAudioPath.mockReturnValue("/recordings/sess-aaa.wav");

      const pt = new PassThrough();
      mockCreateReadStream.mockReturnValue(pt);

      const responsePromise = httpRequest(server, "GET", "/recordings/sess-aaa");
      setImmediate(() => pt.end());

      const res = await responsePromise;

      expect(res.headers["content-disposition"]).toContain("sess-aaa.wav");
      expect(res.headers["content-disposition"]).toContain("attachment");
    });

    it("sets Cache-Control to no-store", async () => {
      mockStore.hasRecording.mockReturnValue(true);
      mockStore.getAudioPath.mockReturnValue("/recordings/sess-aaa.wav");

      const pt = new PassThrough();
      mockCreateReadStream.mockReturnValue(pt);

      const responsePromise = httpRequest(server, "GET", "/recordings/sess-aaa");
      setImmediate(() => pt.end());

      const res = await responsePromise;

      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });

  // ── DELETE /recordings/:sessionId ──────────────────────────────────

  describe("DELETE /recordings/:sessionId", () => {
    it("returns 404 when hasRecording returns false", async () => {
      mockStore.hasRecording.mockReturnValue(false);

      const res = await httpRequest(
        server,
        "DELETE",
        "/recordings/sess-ghost",
      );

      expect(res.status).toBe(404);
    });

    it("calls deleteRecording and returns 204", async () => {
      mockStore.hasRecording.mockReturnValue(true);
      mockStore.deleteRecording.mockResolvedValue(undefined);

      const res = await httpRequest(
        server,
        "DELETE",
        "/recordings/sess-aaa",
      );

      expect(res.status).toBe(204);
      expect(mockStore.deleteRecording).toHaveBeenCalledWith("sess-aaa");
    });

    it("returns 500 when deleteRecording throws", async () => {
      mockStore.hasRecording.mockReturnValue(true);
      mockStore.deleteRecording.mockRejectedValue(new Error("storage failure"));

      const res = await httpRequest(
        server,
        "DELETE",
        "/recordings/sess-aaa",
      );

      expect(res.status).toBe(500);
      const data = res.json() as { error: string };
      expect(data.error).toContain("storage failure");
    });
  });
});
