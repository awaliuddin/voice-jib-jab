/**
 * Demo API Unit Tests
 *
 * Tests the /demo/* HTTP endpoints exposed by createDemoRouter() and the
 * demoDashboardHtml() helper. Uses a standalone Express app with a mocked
 * DemoPlayer so no real playback is needed.
 *
 * Pattern: builds an HTTP server per describe block, uses a plain Node.js
 * http.request helper (no external test HTTP libraries required).
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { createDemoRouter, _clearActiveSessions } from "../../api/demo.js";
import { demoDashboardHtml } from "../../api/demoDashboard.js";

// ── Mock DemoPlayer ───────────────────────────────────────────────────

jest.mock("../../demo/DemoPlayer.js", () => ({
  DemoPlayer: jest.fn().mockImplementation(() => ({
    play: jest.fn().mockImplementation(async (_scenarioId: string) => "sess_test_001"),
    getEvents: jest.fn().mockReturnValue([]),
    isPlaying: jest.fn().mockReturnValue(false),
    getSessionId: jest.fn().mockReturnValue("sess_test_001"),
  })),
}));

// ── HTTP helper ───────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
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

// ── App factory ───────────────────────────────────────────────────────

function buildTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/demo", createDemoRouter());
  return app;
}

function startServer(app: Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ── Test helpers ──────────────────────────────────────────────────────

async function seedSession(
  server: Server,
  scenarioId = "support",
): Promise<string> {
  const res = await httpRequest(server, "POST", "/demo/start", { scenarioId });
  const data = res.json() as { sessionId: string };
  return data.sessionId;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("GET /demo/scenarios", () => {
  let server: Server;

  beforeEach(async () => {
    _clearActiveSessions();
    server = await startServer(buildTestApp());
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it("returns 200", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios");
    expect(res.status).toBe(200);
  });

  it("returns scenarios array with 3 entries", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios");
    const data = res.json() as { scenarios: unknown[] };
    expect(Array.isArray(data.scenarios)).toBe(true);
    expect(data.scenarios).toHaveLength(3);
  });

  it("each scenario has id, name, description", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios");
    const data = res.json() as { scenarios: Array<{ id: string; name: string; description: string }> };
    data.scenarios.forEach((s) => {
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
      expect(typeof s.description).toBe("string");
    });
  });

  it("returns count equal to number of scenarios", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios");
    const data = res.json() as { scenarios: unknown[]; count: number };
    expect(data.count).toBe(data.scenarios.length);
  });
});

describe("GET /demo/scenarios/:id", () => {
  let server: Server;

  beforeEach(async () => {
    _clearActiveSessions();
    server = await startServer(buildTestApp());
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it("returns 200 for support scenario", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios/support");
    expect(res.status).toBe(200);
  });

  it("support scenario has sampleUtterances and pitchPoints", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios/support");
    const data = res.json() as { scenario: { sampleUtterances: unknown[]; pitchPoints: unknown[] } };
    expect(Array.isArray(data.scenario.sampleUtterances)).toBe(true);
    expect(data.scenario.sampleUtterances.length).toBeGreaterThan(0);
    expect(Array.isArray(data.scenario.pitchPoints)).toBe(true);
    expect(data.scenario.pitchPoints.length).toBeGreaterThan(0);
  });

  it("returns 200 for compliance scenario", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios/compliance");
    expect(res.status).toBe(200);
  });

  it("returns 200 for sales scenario", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios/sales");
    expect(res.status).toBe(200);
  });

  it("returns 404 for unknown scenario", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios/unknown");
    expect(res.status).toBe(404);
  });

  it("404 body contains error field", async () => {
    const res = await httpRequest(server, "GET", "/demo/scenarios/unknown");
    const data = res.json() as { error: string };
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });
});

describe("POST /demo/start", () => {
  let server: Server;

  beforeEach(async () => {
    _clearActiveSessions();
    server = await startServer(buildTestApp());
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it("returns 200 with sessionId and startedAt for valid scenarioId", async () => {
    const res = await httpRequest(server, "POST", "/demo/start", { scenarioId: "support" });
    expect(res.status).toBe(200);
    const data = res.json() as { sessionId: string; startedAt: string };
    expect(typeof data.sessionId).toBe("string");
    expect(data.sessionId.length).toBeGreaterThan(0);
    expect(typeof data.startedAt).toBe("string");
    expect(new Date(data.startedAt).toISOString()).toBe(data.startedAt);
  });

  it("echoes scenarioId in response", async () => {
    const res = await httpRequest(server, "POST", "/demo/start", { scenarioId: "compliance" });
    const data = res.json() as { scenarioId: string };
    expect(data.scenarioId).toBe("compliance");
  });

  it("returns 400 when scenarioId is missing", async () => {
    const res = await httpRequest(server, "POST", "/demo/start", {});
    expect(res.status).toBe(400);
  });

  it("returns 400 when scenarioId is invalid", async () => {
    const res = await httpRequest(server, "POST", "/demo/start", { scenarioId: "invalid_id" });
    expect(res.status).toBe(400);
  });

  it("accepts speed param 0-5", async () => {
    const res = await httpRequest(server, "POST", "/demo/start", { scenarioId: "sales", speed: 2 });
    expect(res.status).toBe(200);
  });

  it("accepts speed of 0", async () => {
    const res = await httpRequest(server, "POST", "/demo/start", { scenarioId: "support", speed: 0 });
    expect(res.status).toBe(200);
  });

  it("clamps speed > 5 to 5 (returns 200, not 400)", async () => {
    const res = await httpRequest(server, "POST", "/demo/start", { scenarioId: "support", speed: 99 });
    expect(res.status).toBe(200);
  });

  it("returns 400 when speed is a non-number string", async () => {
    const res = await httpRequest(server, "POST", "/demo/start", {
      scenarioId: "support",
      speed: "fast",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /demo/events/:sessionId", () => {
  let server: Server;

  beforeEach(async () => {
    _clearActiveSessions();
    server = await startServer(buildTestApp());
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it("returns 200 for known sessionId", async () => {
    const sid = await seedSession(server);
    const res = await httpRequest(server, "GET", `/demo/events/${sid}`);
    expect(res.status).toBe(200);
  });

  it("response includes events array and playing boolean", async () => {
    const sid = await seedSession(server);
    const res = await httpRequest(server, "GET", `/demo/events/${sid}`);
    const data = res.json() as { events: unknown[]; playing: boolean; sessionId: string };
    expect(Array.isArray(data.events)).toBe(true);
    expect(typeof data.playing).toBe("boolean");
    expect(data.sessionId).toBe(sid);
  });

  it("returns events from player.getEvents()", async () => {
    const sid = await seedSession(server);
    const res = await httpRequest(server, "GET", `/demo/events/${sid}`);
    const data = res.json() as { events: unknown[] };
    // Mock returns empty array
    expect(data.events).toEqual([]);
  });

  it("returns 404 for unknown sessionId", async () => {
    const res = await httpRequest(server, "GET", "/demo/events/sess_nonexistent");
    expect(res.status).toBe(404);
  });

  it("404 body contains error field", async () => {
    const res = await httpRequest(server, "GET", "/demo/events/sess_nonexistent");
    const data = res.json() as { error: string };
    expect(typeof data.error).toBe("string");
  });
});

describe("DELETE /demo/session/:sessionId", () => {
  let server: Server;

  beforeEach(async () => {
    _clearActiveSessions();
    server = await startServer(buildTestApp());
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it("returns 204 for known sessionId", async () => {
    const sid = await seedSession(server);
    const res = await httpRequest(server, "DELETE", `/demo/session/${sid}`);
    expect(res.status).toBe(204);
  });

  it("returns 404 for unknown sessionId", async () => {
    const res = await httpRequest(server, "DELETE", "/demo/session/sess_ghost");
    expect(res.status).toBe(404);
  });

  it("removes session so subsequent GET /demo/events returns 404", async () => {
    const sid = await seedSession(server);
    await httpRequest(server, "DELETE", `/demo/session/${sid}`);
    const getRes = await httpRequest(server, "GET", `/demo/events/${sid}`);
    expect(getRes.status).toBe(404);
  });

  it("second DELETE on same sessionId returns 404", async () => {
    const sid = await seedSession(server);
    await httpRequest(server, "DELETE", `/demo/session/${sid}`);
    const res2 = await httpRequest(server, "DELETE", `/demo/session/${sid}`);
    expect(res2.status).toBe(404);
  });
});

describe("demoDashboardHtml()", () => {
  it("returns a non-empty string", () => {
    expect(typeof demoDashboardHtml()).toBe("string");
    expect(demoDashboardHtml().length).toBeGreaterThan(0);
  });

  it("contains DOCTYPE declaration", () => {
    expect(demoDashboardHtml()).toContain("<!DOCTYPE html>");
  });

  it("contains Voice Agent Demo title", () => {
    expect(demoDashboardHtml()).toContain("Voice Agent Demo");
  });

  it("contains scenario selector reference", () => {
    expect(demoDashboardHtml().toLowerCase()).toContain("scenario");
  });

  it("contains play button text", () => {
    expect(demoDashboardHtml()).toContain("Play");
  });

  it("contains support scenario option", () => {
    expect(demoDashboardHtml()).toContain("support");
  });

  it("references POST /demo/start in JavaScript", () => {
    expect(demoDashboardHtml()).toContain("/demo/start");
  });

  it("references /demo/events in JavaScript", () => {
    expect(demoDashboardHtml()).toContain("/demo/events");
  });

  it("references /demo/scenarios in JavaScript", () => {
    expect(demoDashboardHtml()).toContain("/demo/scenarios");
  });

  it("contains electric blue CSS variable", () => {
    expect(demoDashboardHtml()).toContain("--blue:#3b82f6");
  });
});
