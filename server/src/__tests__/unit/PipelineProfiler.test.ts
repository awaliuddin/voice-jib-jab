/**
 * PipelineProfiler Tests
 *
 * Tests PipelineProfiler service and the Profiler API endpoints.
 * Follows the ConversationMemory.test.ts pattern: standalone Express app
 * with injected profiler instance.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import {
  PipelineProfiler,
  BOTTLENECK_THRESHOLD_MS,
  VALID_PIPELINE_STAGES,
  type PipelineStage,
  type StageTimingRecord,
  type PipelineProfile,
} from "../../services/PipelineProfiler.js";
import { createProfilerRouter } from "../../api/profiler.js";

// ── HTTP helpers ──────────────────────────────────────────────────────

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

// ── Test app factory ──────────────────────────────────────────────────

function buildTestApp(profiler: PipelineProfiler): Express {
  const app = express();
  app.use(express.json());
  app.use("/sessions", createProfilerRouter(profiler));
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Returns a start/end pair with the given duration. */
function timingAt(durationMs: number): { startMs: number; endMs: number } {
  const startMs = Date.now();
  return { startMs, endMs: startMs + durationMs };
}

// ─────────────────────────────────────────────────────────────────────
// 1. BOTTLENECK_THRESHOLD_MS constant
// ─────────────────────────────────────────────────────────────────────

describe("BOTTLENECK_THRESHOLD_MS", () => {
  it("is exported and equals 200", () => {
    expect(BOTTLENECK_THRESHOLD_MS).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. PipelineProfiler.record()
// ─────────────────────────────────────────────────────────────────────

describe("PipelineProfiler.record()", () => {
  let profiler: PipelineProfiler;

  beforeEach(() => {
    profiler = new PipelineProfiler();
  });

  it("returns a StageTimingRecord with correct fields", () => {
    const { startMs, endMs } = timingAt(100);
    const record = profiler.record("sess-1", "stt", startMs, endMs);

    expect(record.stage).toBe("stt");
    expect(record.startMs).toBe(startMs);
    expect(record.endMs).toBe(endMs);
    expect(record.durationMs).toBe(100);
  });

  it("calculates durationMs as endMs - startMs", () => {
    const startMs = 1_000_000;
    const endMs = 1_000_350;
    const record = profiler.record("sess-2", "lane_b", startMs, endMs);
    expect(record.durationMs).toBe(350);
  });

  it("isBottleneck is true when durationMs > 200", () => {
    const { startMs, endMs } = timingAt(201);
    const record = profiler.record("sess-3", "lane_b", startMs, endMs);
    expect(record.isBottleneck).toBe(true);
  });

  it("isBottleneck is false when durationMs === 200 (boundary)", () => {
    const { startMs, endMs } = timingAt(200);
    const record = profiler.record("sess-4", "tts", startMs, endMs);
    expect(record.isBottleneck).toBe(false);
  });

  it("isBottleneck is false when durationMs < 200", () => {
    const { startMs, endMs } = timingAt(50);
    const record = profiler.record("sess-5", "stt", startMs, endMs);
    expect(record.isBottleneck).toBe(false);
  });

  it("creates a profile for the session if none exists", () => {
    expect(profiler.getProfile("new-sess")).toBeUndefined();
    profiler.record("new-sess", "stt", 0, 100);
    expect(profiler.getProfile("new-sess")).toBeDefined();
  });

  it("adds to an existing profile without removing prior records", () => {
    profiler.record("sess-multi", "stt", 0, 80);
    profiler.record("sess-multi", "tts", 100, 200);

    const profile = profiler.getProfile("sess-multi")!;
    expect(profile.stages).toHaveLength(2);
  });

  it("records for different sessions are isolated", () => {
    profiler.record("sess-a", "stt", 0, 50);
    profiler.record("sess-b", "lane_a", 0, 300);

    expect(profiler.getProfile("sess-a")!.stages).toHaveLength(1);
    expect(profiler.getProfile("sess-b")!.stages).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. PipelineProfiler.getProfile()
// ─────────────────────────────────────────────────────────────────────

describe("PipelineProfiler.getProfile()", () => {
  let profiler: PipelineProfiler;

  beforeEach(() => {
    profiler = new PipelineProfiler();
  });

  it("returns undefined for unknown session", () => {
    expect(profiler.getProfile("ghost-session")).toBeUndefined();
  });

  it("returns PipelineProfile with sessionId", () => {
    profiler.record("s1", "stt", 0, 100);
    const profile = profiler.getProfile("s1")!;
    expect(profile.sessionId).toBe("s1");
  });

  it("bottlenecks list contains only stages with durationMs > 200", () => {
    profiler.record("s2", "stt", 0, 100);        // not a bottleneck
    profiler.record("s2", "lane_b", 0, 250);     // bottleneck
    profiler.record("s2", "tts", 0, 200);        // exactly 200 — not a bottleneck

    const profile = profiler.getProfile("s2")!;
    expect(profile.bottlenecks).toEqual(["lane_b"]);
  });

  it("bottleneckAlert is true when any bottleneck exists", () => {
    profiler.record("s3", "policy_gate", 0, 300);
    expect(profiler.getProfile("s3")!.bottleneckAlert).toBe(true);
  });

  it("bottleneckAlert is false when no bottlenecks", () => {
    profiler.record("s4", "stt", 0, 50);
    expect(profiler.getProfile("s4")!.bottleneckAlert).toBe(false);
  });

  it("totalDurationMs is the sum of all stage durations", () => {
    profiler.record("s5", "stt", 0, 80);       // 80
    profiler.record("s5", "lane_a", 0, 120);   // 120
    profiler.record("s5", "tts", 0, 60);       // 60

    const profile = profiler.getProfile("s5")!;
    expect(profile.totalDurationMs).toBe(260);
  });

  it("recordCount matches the number of records added", () => {
    profiler.record("s6", "stt", 0, 10);
    profiler.record("s6", "lane_b", 0, 10);
    profiler.record("s6", "tts", 0, 10);

    expect(profiler.getProfile("s6")!.recordCount).toBe(3);
  });

  it("lastRecordedAt is a valid ISO timestamp string", () => {
    const endMs = Date.now() + 500;
    profiler.record("s7", "tts", 0, endMs);

    const profile = profiler.getProfile("s7")!;
    expect(() => new Date(profile.lastRecordedAt)).not.toThrow();
    expect(new Date(profile.lastRecordedAt).toISOString()).toBe(profile.lastRecordedAt);
  });

  it("createdAt is a valid ISO timestamp string", () => {
    profiler.record("s8", "stt", 0, 100);

    const profile = profiler.getProfile("s8")!;
    expect(() => new Date(profile.createdAt)).not.toThrow();
    expect(new Date(profile.createdAt).toISOString()).toBe(profile.createdAt);
  });

  it("stages array is a copy and has correct shape", () => {
    const { startMs, endMs } = timingAt(150);
    profiler.record("s9", "lane_c", startMs, endMs);

    const profile = profiler.getProfile("s9")!;
    expect(profile.stages).toHaveLength(1);
    expect(profile.stages[0]).toMatchObject<Partial<StageTimingRecord>>({
      stage: "lane_c",
      durationMs: 150,
      isBottleneck: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. PipelineProfiler.listProfiledSessions()
// ─────────────────────────────────────────────────────────────────────

describe("PipelineProfiler.listProfiledSessions()", () => {
  let profiler: PipelineProfiler;

  beforeEach(() => {
    profiler = new PipelineProfiler();
  });

  it("returns empty array when no sessions recorded", () => {
    expect(profiler.listProfiledSessions()).toEqual([]);
  });

  it("returns sessionIds after recording", () => {
    profiler.record("alpha", "stt", 0, 50);
    profiler.record("beta", "tts", 0, 80);

    const sessions = profiler.listProfiledSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions).toContain("alpha");
    expect(sessions).toContain("beta");
  });

  it("does not include cleared sessions", () => {
    profiler.record("to-clear", "stt", 0, 50);
    profiler.clearProfile("to-clear");

    expect(profiler.listProfiledSessions()).not.toContain("to-clear");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. PipelineProfiler.clearProfile()
// ─────────────────────────────────────────────────────────────────────

describe("PipelineProfiler.clearProfile()", () => {
  let profiler: PipelineProfiler;

  beforeEach(() => {
    profiler = new PipelineProfiler();
  });

  it("removes profile so getProfile returns undefined", () => {
    profiler.record("sess-del", "stt", 0, 100);
    profiler.clearProfile("sess-del");
    expect(profiler.getProfile("sess-del")).toBeUndefined();
  });

  it("is a no-op for unknown session (no throw)", () => {
    expect(() => profiler.clearProfile("ghost")).not.toThrow();
  });

  it("only removes the targeted session", () => {
    profiler.record("keep", "stt", 0, 50);
    profiler.record("remove", "stt", 0, 50);
    profiler.clearProfile("remove");

    expect(profiler.getProfile("keep")).toBeDefined();
    expect(profiler.getProfile("remove")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. PipelineProfiler.getBottlenecks()
// ─────────────────────────────────────────────────────────────────────

describe("PipelineProfiler.getBottlenecks()", () => {
  let profiler: PipelineProfiler;

  beforeEach(() => {
    profiler = new PipelineProfiler();
  });

  it("returns null for a session with no profile", () => {
    expect(profiler.getBottlenecks("unknown-sess")).toBeNull();
  });

  it("returns { sessionId, bottlenecks, alert } for a known session", () => {
    profiler.record("bn-sess", "lane_b", 0, 250);

    const result = profiler.getBottlenecks("bn-sess");
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("bn-sess");
    expect(result!.bottlenecks).toContain("lane_b");
    expect(result!.alert).toBe(true);
  });

  it("alert is false when no bottlenecks", () => {
    profiler.record("no-bn", "stt", 0, 50);

    const result = profiler.getBottlenecks("no-bn")!;
    expect(result.alert).toBe(false);
    expect(result.bottlenecks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. HTTP routes — setup
// ─────────────────────────────────────────────────────────────────────

describe("Profiler API Endpoints", () => {
  let profiler: PipelineProfiler;
  let app: Express;
  let server: Server;

  beforeAll((done) => {
    profiler = new PipelineProfiler();
    app = buildTestApp(profiler);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    // Wipe all profiles between tests so tests are independent.
    for (const id of profiler.listProfiledSessions()) {
      profiler.clearProfile(id);
    }
  });

  // ── GET /:sessionId/profile ────────────────────────────────────────

  describe("GET /:sessionId/profile", () => {
    it("returns 200 with PipelineProfile when profile exists", async () => {
      profiler.record("http-s1", "stt", 0, 100);

      const res = await httpRequest(server, "GET", "/sessions/http-s1/profile");
      expect(res.status).toBe(200);

      const profile = res.json() as PipelineProfile;
      expect(profile.sessionId).toBe("http-s1");
      expect(profile.stages).toHaveLength(1);
      expect(profile.recordCount).toBe(1);
    });

    it("returns 404 when no profile exists for session", async () => {
      const res = await httpRequest(server, "GET", "/sessions/ghost-s1/profile");
      expect(res.status).toBe(404);

      const body = res.json() as { error: string };
      expect(body.error).toContain("ghost-s1");
    });
  });

  // ── POST /:sessionId/profile ───────────────────────────────────────

  describe("POST /:sessionId/profile", () => {
    it("returns 201 with StageTimingRecord on valid input", async () => {
      const { startMs, endMs } = timingAt(150);
      const res = await httpRequest(server, "POST", "/sessions/post-s1/profile", {
        stage: "stt",
        startMs,
        endMs,
      });

      expect(res.status).toBe(201);
      const record = res.json() as StageTimingRecord;
      expect(record.stage).toBe("stt");
      expect(record.durationMs).toBe(150);
      expect(record.isBottleneck).toBe(false);
    });

    it("returns 400 when stage is missing", async () => {
      const res = await httpRequest(server, "POST", "/sessions/post-s2/profile", {
        startMs: 0,
        endMs: 100,
      });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/stage/i);
    });

    it("returns 400 for invalid stage value", async () => {
      const res = await httpRequest(server, "POST", "/sessions/post-s3/profile", {
        stage: "not_a_stage",
        startMs: 0,
        endMs: 100,
      });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/invalid stage/i);
    });

    it("returns 400 when startMs is missing", async () => {
      const res = await httpRequest(server, "POST", "/sessions/post-s4/profile", {
        stage: "stt",
        endMs: 100,
      });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/startMs/i);
    });

    it("returns 400 when endMs is missing", async () => {
      const res = await httpRequest(server, "POST", "/sessions/post-s5/profile", {
        stage: "stt",
        startMs: 0,
      });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/endMs/i);
    });

    it("correctly flags isBottleneck=true when durationMs > 200", async () => {
      const { startMs, endMs } = timingAt(201);
      const res = await httpRequest(server, "POST", "/sessions/post-s6/profile", {
        stage: "lane_b",
        startMs,
        endMs,
      });
      expect(res.status).toBe(201);
      const record = res.json() as StageTimingRecord;
      expect(record.isBottleneck).toBe(true);
    });

    it("accepts all valid PipelineStage values", async () => {
      const validStages = [...VALID_PIPELINE_STAGES] as PipelineStage[];
      for (const stage of validStages) {
        const res = await httpRequest(server, "POST", `/sessions/stage-check-${stage}/profile`, {
          stage,
          startMs: 0,
          endMs: 50,
        });
        expect(res.status).toBe(201);
      }
    });
  });

  // ── DELETE /:sessionId/profile ─────────────────────────────────────

  describe("DELETE /:sessionId/profile", () => {
    it("returns 204 and removes the profile", async () => {
      profiler.record("del-s1", "stt", 0, 100);

      const res = await httpRequest(server, "DELETE", "/sessions/del-s1/profile");
      expect(res.status).toBe(204);
      expect(profiler.getProfile("del-s1")).toBeUndefined();
    });

    it("returns 404 when no profile exists", async () => {
      const res = await httpRequest(server, "DELETE", "/sessions/ghost-del/profile");
      expect(res.status).toBe(404);
      const body = res.json() as { error: string };
      expect(body.error).toContain("ghost-del");
    });
  });

  // ── GET /:sessionId/profile/bottlenecks ────────────────────────────

  describe("GET /:sessionId/profile/bottlenecks", () => {
    it("returns 200 with bottleneck summary for known session", async () => {
      profiler.record("bn-http-1", "lane_b", 0, 300);

      const res = await httpRequest(server, "GET", "/sessions/bn-http-1/profile/bottlenecks");
      expect(res.status).toBe(200);

      const body = res.json() as { sessionId: string; bottlenecks: string[]; alert: boolean };
      expect(body.sessionId).toBe("bn-http-1");
      expect(body.bottlenecks).toContain("lane_b");
      expect(body.alert).toBe(true);
    });

    it("returns 200 with empty bottlenecks when no bottlenecks present", async () => {
      profiler.record("bn-http-2", "stt", 0, 50);

      const res = await httpRequest(server, "GET", "/sessions/bn-http-2/profile/bottlenecks");
      expect(res.status).toBe(200);

      const body = res.json() as { sessionId: string; bottlenecks: string[]; alert: boolean };
      expect(body.bottlenecks).toEqual([]);
      expect(body.alert).toBe(false);
    });

    it("returns 404 when no profile found for session", async () => {
      const res = await httpRequest(server, "GET", "/sessions/ghost-bn/profile/bottlenecks");
      expect(res.status).toBe(404);

      const body = res.json() as { error: string };
      expect(body.error).toContain("ghost-bn");
    });

    it("does not shadow GET /:sessionId/profile route", async () => {
      profiler.record("shadow-test", "tts", 0, 80);

      const profileRes = await httpRequest(server, "GET", "/sessions/shadow-test/profile");
      const bnRes = await httpRequest(server, "GET", "/sessions/shadow-test/profile/bottlenecks");

      expect(profileRes.status).toBe(200);
      expect(bnRes.status).toBe(200);

      const profile = profileRes.json() as PipelineProfile;
      const bn = bnRes.json() as { sessionId: string };
      expect(profile.stages).toBeDefined();
      expect(bn.sessionId).toBe("shadow-test");
    });
  });
});
