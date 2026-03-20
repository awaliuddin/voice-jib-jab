/**
 * Training API Tests
 *
 * Tests the /training router produced by createTrainingRouter().
 * TrainingDataService is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createTrainingRouter } from "../../api/training.js";

// ── Mock TrainingDataService ──────────────────────────────────────────

const mockSvc = {
  addAnnotation: jest.fn(),
  getAnnotation: jest.fn(),
  listAnnotations: jest.fn(),
  deleteAnnotation: jest.fn(),
  updateAnnotationLabel: jest.fn(),
  buildDataset: jest.fn(),
  getDataset: jest.fn(),
  listDatasets: jest.fn(),
  exportJsonl: jest.fn(),
  exportGoodExamplesJsonl: jest.fn(),
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

// ── Test app ──────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/training", createTrainingRouter(mockSvc as never));
  return app;
}

// ── Fixture data ──────────────────────────────────────────────────────

const ANNOTATION_1 = {
  annotationId: "ann-001",
  sessionId: "sess-abc",
  turnIndex: 1,
  speaker: "assistant",
  text: "I can help you with that.",
  label: "good_response",
  createdAt: "2026-03-01T10:00:00.000Z",
};

const ANNOTATION_2 = {
  annotationId: "ann-002",
  sessionId: "sess-abc",
  turnIndex: 3,
  speaker: "assistant",
  text: "Please hold on.",
  label: "needs_improvement",
  createdAt: "2026-03-01T10:05:00.000Z",
};

const DATASET_1 = {
  datasetId: "ds-001",
  name: "My Dataset",
  createdAt: "2026-03-10T08:00:00.000Z",
  exampleCount: 2,
  sessionCount: 1,
  goodResponseCount: 1,
  needsImprovementCount: 1,
  filters: {},
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("Training API", () => {
  let server: Server;

  beforeEach((done) => {
    jest.clearAllMocks();
    server = createServer(buildApp());
    server.listen(0, "127.0.0.1", done);
  });

  afterEach((done) => {
    server.close(done);
  });

  const req = (method: string, path: string, body?: unknown) =>
    httpRequest(server, method, `/training${path}`, body);

  // ── POST /training/annotations ─────────────────────────────────

  describe("POST /training/annotations", () => {
    it("returns 201 with annotation on success", async () => {
      mockSvc.addAnnotation.mockReturnValue(ANNOTATION_1);

      const res = await req("POST", "/annotations", {
        sessionId: "sess-abc",
        turnIndex: 1,
        speaker: "assistant",
        text: "I can help you with that.",
        label: "good_response",
      });

      expect(res.status).toBe(201);
      const body = res.json() as typeof ANNOTATION_1;
      expect(body.annotationId).toBe("ann-001");
    });

    it("returns 400 when sessionId is missing", async () => {
      const res = await req("POST", "/annotations", {
        turnIndex: 1,
        speaker: "assistant",
        text: "Hello",
        label: "good_response",
      });

      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("sessionId");
    });

    it("returns 400 for invalid label", async () => {
      const res = await req("POST", "/annotations", {
        sessionId: "sess-abc",
        turnIndex: 1,
        speaker: "assistant",
        text: "Hello",
        label: "totally_wrong",
      });

      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("label");
    });
  });

  // ── GET /training/annotations ──────────────────────────────────

  describe("GET /training/annotations", () => {
    it("returns 200 with annotations array", async () => {
      mockSvc.listAnnotations.mockReturnValue([ANNOTATION_1, ANNOTATION_2]);

      const res = await req("GET", "/annotations");

      expect(res.status).toBe(200);
      const body = res.json() as { annotations: unknown[]; total: number };
      expect(Array.isArray(body.annotations)).toBe(true);
      expect(body.total).toBe(2);
    });

    it("filters by sessionId query param", async () => {
      mockSvc.listAnnotations.mockReturnValue([ANNOTATION_1]);

      const res = await req("GET", "/annotations?sessionId=sess-abc");

      expect(res.status).toBe(200);
      expect(mockSvc.listAnnotations).toHaveBeenCalledWith("sess-abc");
    });
  });

  // ── GET /training/annotations/:annotationId ────────────────────

  describe("GET /training/annotations/:annotationId", () => {
    it("returns 200 with annotation", async () => {
      mockSvc.getAnnotation.mockReturnValue(ANNOTATION_1);

      const res = await req("GET", "/annotations/ann-001");

      expect(res.status).toBe(200);
      const body = res.json() as typeof ANNOTATION_1;
      expect(body.annotationId).toBe("ann-001");
    });

    it("returns 404 for unknown annotation", async () => {
      mockSvc.getAnnotation.mockReturnValue(undefined);

      const res = await req("GET", "/annotations/does-not-exist");

      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /training/annotations/:annotationId ──────────────────

  describe("PATCH /training/annotations/:annotationId", () => {
    it("returns 200 with updated annotation", async () => {
      const updated = { ...ANNOTATION_1, label: "needs_improvement" };
      mockSvc.updateAnnotationLabel.mockReturnValue(updated);

      const res = await req("PATCH", "/annotations/ann-001", {
        label: "needs_improvement",
      });

      expect(res.status).toBe(200);
      const body = res.json() as typeof updated;
      expect(body.label).toBe("needs_improvement");
    });

    it("returns 404 for unknown annotation", async () => {
      mockSvc.updateAnnotationLabel.mockReturnValue(undefined);

      const res = await req("PATCH", "/annotations/no-such-id", {
        label: "neutral",
      });

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /training/annotations/:annotationId ─────────────────

  describe("DELETE /training/annotations/:annotationId", () => {
    it("returns 204 on success", async () => {
      mockSvc.deleteAnnotation.mockReturnValue(true);

      const res = await req("DELETE", "/annotations/ann-001");

      expect(res.status).toBe(204);
    });

    it("returns 404 for unknown annotation", async () => {
      mockSvc.deleteAnnotation.mockReturnValue(false);

      const res = await req("DELETE", "/annotations/does-not-exist");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /training/datasets ────────────────────────────────────

  describe("POST /training/datasets", () => {
    it("returns 201 with dataset on success", async () => {
      mockSvc.buildDataset.mockReturnValue(DATASET_1);

      const res = await req("POST", "/datasets", {
        name: "My Dataset",
        filters: {},
      });

      expect(res.status).toBe(201);
      const body = res.json() as typeof DATASET_1;
      expect(body.datasetId).toBe("ds-001");
    });
  });

  // ── GET /training/datasets ─────────────────────────────────────

  describe("GET /training/datasets", () => {
    it("returns 200 with datasets array", async () => {
      mockSvc.listDatasets.mockReturnValue([DATASET_1]);

      const res = await req("GET", "/datasets");

      expect(res.status).toBe(200);
      const body = res.json() as { datasets: unknown[]; total: number };
      expect(Array.isArray(body.datasets)).toBe(true);
      expect(body.total).toBe(1);
    });
  });

  // ── GET /training/datasets/:datasetId/export ───────────────────

  describe("GET /training/datasets/:datasetId/export", () => {
    it("returns 200 on success", async () => {
      mockSvc.getDataset.mockReturnValue(DATASET_1);
      mockSvc.exportJsonl.mockReturnValue('{"messages":[]}\n{"messages":[]}');

      const res = await req("GET", "/datasets/ds-001/export");

      expect(res.status).toBe(200);
    });

    it("has Content-Type application/x-ndjson", async () => {
      mockSvc.getDataset.mockReturnValue(DATASET_1);
      mockSvc.exportJsonl.mockReturnValue('{"messages":[]}');

      const res = await req("GET", "/datasets/ds-001/export");

      expect(res.headers["content-type"]).toContain("application/x-ndjson");
    });

    it("has Content-Disposition with filename including dataset id", async () => {
      mockSvc.getDataset.mockReturnValue(DATASET_1);
      mockSvc.exportJsonl.mockReturnValue('{"messages":[]}');

      const res = await req("GET", "/datasets/ds-001/export");

      const disposition = res.headers["content-disposition"] as string;
      expect(disposition).toContain("attachment");
      expect(disposition).toContain("ds-001.jsonl");
    });

    it("returns 404 when dataset not found", async () => {
      mockSvc.getDataset.mockReturnValue(undefined);

      const res = await req("GET", "/datasets/no-such-dataset/export");

      expect(res.status).toBe(404);
    });
  });

  // ── GET /training/export/good-examples ────────────────────────

  describe("GET /training/export/good-examples", () => {
    it("returns 200 with JSONL", async () => {
      mockSvc.exportGoodExamplesJsonl.mockReturnValue('{"messages":[]}');

      const res = await req("GET", "/export/good-examples");

      expect(res.status).toBe(200);
    });

    it("has Content-Type application/x-ndjson", async () => {
      mockSvc.exportGoodExamplesJsonl.mockReturnValue('{"messages":[]}');

      const res = await req("GET", "/export/good-examples");

      expect(res.headers["content-type"]).toContain("application/x-ndjson");
    });
  });
});
