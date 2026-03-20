/**
 * Capacity Planner API Tests
 *
 * Tests for the /capacity router produced by createCapacityPlannerRouter().
 * Uses a real CapacityPlannerService (pure computation, no I/O).
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { CapacityPlannerService } from "../../services/CapacityPlannerService.js";
import { createCapacityPlannerRouter } from "../../api/capacityPlanner.js";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  const service = new CapacityPlannerService();
  app.use("/capacity", createCapacityPlannerRouter(service));
  return app;
}

const VALID_BODY = {
  peakConcurrentSessions: 20,
  avgSessionDurationMinutes: 5,
  dailyCallVolume: 200,
  recordingsEnabled: false,
  recordingRetentionDays: 0,
  ragEnabled: false,
  sentimentAnalysisEnabled: false,
  policyEvaluationEnabled: false,
  deploymentTarget: "single_server",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Capacity Planner API", () => {
  let app: Express;
  let server: Server;

  beforeAll((done) => {
    app = buildApp();
    server = createServer(app);
    server.listen(0, "127.0.0.1", done);
  });

  afterAll((done) => {
    server.close(done);
  });

  // ── POST /capacity/calculate ──────────────────────────────────────────────

  describe("POST /capacity/calculate", () => {
    it("returns 200 with a CapacityRecommendation for valid input", async () => {
      const res = await httpRequest(server, "POST", "/capacity/calculate", VALID_BODY);
      expect(res.status).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.generatedAt).toBeDefined();
      expect(body.input).toBeDefined();
    });

    it("response includes cpu, ram, storage, network, resources fields", async () => {
      const res = await httpRequest(server, "POST", "/capacity/calculate", VALID_BODY);
      const body = res.json() as Record<string, unknown>;
      expect(body.cpu).toBeDefined();
      expect(body.ram).toBeDefined();
      expect(body.storage).toBeDefined();
      expect(body.network).toBeDefined();
      expect(body.resources).toBeDefined();
    });

    it("returns 400 when peakConcurrentSessions is missing", async () => {
      const { peakConcurrentSessions: _omit, ...rest } = VALID_BODY;
      const res = await httpRequest(server, "POST", "/capacity/calculate", rest);
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/peakConcurrentSessions/);
    });

    it("returns 400 when peakConcurrentSessions is <= 0", async () => {
      const res = await httpRequest(server, "POST", "/capacity/calculate", {
        ...VALID_BODY,
        peakConcurrentSessions: 0,
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when peakConcurrentSessions is negative", async () => {
      const res = await httpRequest(server, "POST", "/capacity/calculate", {
        ...VALID_BODY,
        peakConcurrentSessions: -5,
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when avgSessionDurationMinutes is missing", async () => {
      const { avgSessionDurationMinutes: _omit, ...rest } = VALID_BODY;
      const res = await httpRequest(server, "POST", "/capacity/calculate", rest);
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/avgSessionDurationMinutes/);
    });

    it("returns 400 when avgSessionDurationMinutes is <= 0", async () => {
      const res = await httpRequest(server, "POST", "/capacity/calculate", {
        ...VALID_BODY,
        avgSessionDurationMinutes: 0,
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when dailyCallVolume is missing", async () => {
      const { dailyCallVolume: _omit, ...rest } = VALID_BODY;
      const res = await httpRequest(server, "POST", "/capacity/calculate", rest);
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/dailyCallVolume/);
    });

    it("returns 400 for invalid deploymentTarget", async () => {
      const res = await httpRequest(server, "POST", "/capacity/calculate", {
        ...VALID_BODY,
        deploymentTarget: "bare_metal",
      });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/deploymentTarget/);
    });

    it("accepts all three valid deploymentTarget values", async () => {
      for (const target of ["single_server", "docker", "kubernetes"] as const) {
        const res = await httpRequest(server, "POST", "/capacity/calculate", {
          ...VALID_BODY,
          deploymentTarget: target,
        });
        expect(res.status).toBe(200);
      }
    });
  });

  // ── GET /capacity/calculator ──────────────────────────────────────────────

  describe("GET /capacity/calculator", () => {
    it("returns 200 with HTML content-type", async () => {
      const res = await httpRequest(server, "GET", "/capacity/calculator");
      expect(res.status).toBe(200);
      const ct = res.headers["content-type"] as string;
      expect(ct).toMatch(/text\/html/);
    });

    it("returns a non-empty HTML body", async () => {
      const res = await httpRequest(server, "GET", "/capacity/calculator");
      expect(res.body).toMatch(/<!DOCTYPE html/i);
    });
  });
});
