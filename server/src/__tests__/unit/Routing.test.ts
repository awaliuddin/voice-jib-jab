/**
 * Routing API Router Tests
 *
 * Tests the createRoutingRouter(engine, queue) HTTP endpoints.
 * Builds a standalone Express app with mocked RoutingEngine and
 * CallQueueService — no filesystem or real service instantiation needed.
 *
 * Endpoints covered:
 *   GET    /routing/rules            — list rules (optional ?tenantId filter)
 *   POST   /routing/rules            — create rule
 *   PUT    /routing/rules/:ruleId    — update rule
 *   DELETE /routing/rules/:ruleId    — delete rule
 *   POST   /routing/evaluate         — evaluate session meta
 *   GET    /routing/queue            — all queue statuses
 *   GET    /routing/queue/:tenantId  — queue status for tenant
 *   POST   /routing/queue/enqueue    — enqueue a session
 *   POST   /routing/queue/dequeue    — dequeue next session
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { createRoutingRouter } from "../../api/routing.js";
import type { RoutingEngine } from "../../services/RoutingEngine.js";
import type { CallQueueService } from "../../services/CallQueueService.js";

// ── HTTP helper ──────────────────────────────────────────────────────────────

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

// ── Fixture data ─────────────────────────────────────────────────────────────

const SAMPLE_RULE = {
  ruleId: "rule-001",
  tenantId: "tenant-acme",
  priority: 10,
  conditions: { language: "en" },
  targetTemplateId: "tmpl-default",
  maxConcurrentSessions: 5,
  active: true,
  createdAt: "2026-03-01T00:00:00.000Z",
};

const SAMPLE_QUEUE_STATUS = {
  tenantId: "tenant-acme",
  depth: 2,
  entries: [
    { sessionId: "sess-1", tenantId: "tenant-acme", position: 1, enqueuedAt: "2026-03-19T10:00:00.000Z" },
    { sessionId: "sess-2", tenantId: "tenant-acme", position: 2, enqueuedAt: "2026-03-19T10:01:00.000Z" },
  ],
};

// ── Mock factories ────────────────────────────────────────────────────────────

function makeMockEngine(): jest.Mocked<
  Pick<RoutingEngine, "getRules" | "getRule" | "addRule" | "updateRule" | "deleteRule" | "evaluate">
> {
  return {
    getRules: jest.fn(),
    getRule: jest.fn(),
    addRule: jest.fn(),
    updateRule: jest.fn(),
    deleteRule: jest.fn(),
    evaluate: jest.fn(),
  };
}

function makeMockQueue(): jest.Mocked<
  Pick<CallQueueService, "getAllQueueStatuses" | "getQueueStatus" | "enqueue" | "dequeue">
> {
  return {
    getAllQueueStatuses: jest.fn(),
    getQueueStatus: jest.fn(),
    enqueue: jest.fn(),
    dequeue: jest.fn(),
  };
}

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp(engine: RoutingEngine, queue: CallQueueService): Express {
  const app = express();
  app.use(express.json());
  app.use("/routing", createRoutingRouter(engine, queue));
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Routing API Endpoints", () => {
  let engine: ReturnType<typeof makeMockEngine>;
  let queue: ReturnType<typeof makeMockQueue>;
  let server: Server;

  beforeAll((done) => {
    engine = makeMockEngine();
    queue = makeMockQueue();
    const app = buildApp(engine as unknown as RoutingEngine, queue as unknown as CallQueueService);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /routing/rules ────────────────────────────────────────────────────

  describe("GET /routing/rules", () => {
    it("returns 200 with rules array and count", async () => {
      engine.getRules.mockReturnValue([SAMPLE_RULE] as never);
      const res = await httpRequest(server, "GET", "/routing/rules");
      expect(res.status).toBe(200);
      const body = res.json() as { rules: unknown[]; count: number };
      expect(body.count).toBe(1);
      expect(body.rules).toHaveLength(1);
    });

    it("returns 200 with empty array when no rules exist", async () => {
      engine.getRules.mockReturnValue([]);
      const res = await httpRequest(server, "GET", "/routing/rules");
      expect(res.status).toBe(200);
      const body = res.json() as { rules: unknown[]; count: number };
      expect(body.rules).toEqual([]);
      expect(body.count).toBe(0);
    });

    it("passes tenantId query param to engine.getRules", async () => {
      engine.getRules.mockReturnValue([]);
      await httpRequest(server, "GET", "/routing/rules?tenantId=tenant-acme");
      expect(engine.getRules).toHaveBeenCalledWith("tenant-acme");
    });

    it("calls engine.getRules with undefined when no tenantId query param", async () => {
      engine.getRules.mockReturnValue([]);
      await httpRequest(server, "GET", "/routing/rules");
      expect(engine.getRules).toHaveBeenCalledWith(undefined);
    });
  });

  // ── POST /routing/rules ───────────────────────────────────────────────────

  describe("POST /routing/rules", () => {
    const validBody = {
      tenantId: "tenant-acme",
      priority: 10,
      conditions: { language: "en" },
      targetTemplateId: "tmpl-default",
      active: true,
    };

    it("returns 201 with created rule on valid input", async () => {
      engine.addRule.mockReturnValue(SAMPLE_RULE as never);
      const res = await httpRequest(server, "POST", "/routing/rules", validBody);
      expect(res.status).toBe(201);
      const body = res.json() as { ruleId: string };
      expect(body.ruleId).toBe("rule-001");
    });

    it("passes correct fields to engine.addRule", async () => {
      engine.addRule.mockReturnValue(SAMPLE_RULE as never);
      await httpRequest(server, "POST", "/routing/rules", validBody);
      expect(engine.addRule).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-acme",
          priority: 10,
          conditions: { language: "en" },
          targetTemplateId: "tmpl-default",
          active: true,
        }),
      );
    });

    it("returns 400 when priority is missing", async () => {
      const { priority: _p, ...body } = validBody;
      const res = await httpRequest(server, "POST", "/routing/rules", body);
      expect(res.status).toBe(400);
      const err = res.json() as { error: string };
      expect(err.error).toContain("priority");
    });

    it("returns 400 when conditions is missing", async () => {
      const { conditions: _c, ...body } = validBody;
      const res = await httpRequest(server, "POST", "/routing/rules", body);
      expect(res.status).toBe(400);
      const err = res.json() as { error: string };
      expect(err.error).toContain("conditions");
    });

    it("returns 400 when targetTemplateId is missing", async () => {
      const { targetTemplateId: _t, ...body } = validBody;
      const res = await httpRequest(server, "POST", "/routing/rules", body);
      expect(res.status).toBe(400);
      const err = res.json() as { error: string };
      expect(err.error).toContain("targetTemplateId");
    });

    it("returns 400 when active is missing", async () => {
      const { active: _a, ...body } = validBody;
      const res = await httpRequest(server, "POST", "/routing/rules", body);
      expect(res.status).toBe(400);
      const err = res.json() as { error: string };
      expect(err.error).toContain("active");
    });

    it("returns 400 when tenantId is not a string (number provided)", async () => {
      const res = await httpRequest(server, "POST", "/routing/rules", {
        ...validBody,
        tenantId: 42,
      });
      expect(res.status).toBe(400);
      const err = res.json() as { error: string };
      expect(err.error).toContain("tenantId");
    });

    it("accepts null tenantId (global rule)", async () => {
      engine.addRule.mockReturnValue({ ...SAMPLE_RULE, tenantId: null } as never);
      const res = await httpRequest(server, "POST", "/routing/rules", { ...validBody, tenantId: null });
      expect(res.status).toBe(201);
    });

    it("defaults maxConcurrentSessions to null when not provided", async () => {
      engine.addRule.mockReturnValue(SAMPLE_RULE as never);
      await httpRequest(server, "POST", "/routing/rules", validBody);
      expect(engine.addRule).toHaveBeenCalledWith(
        expect.objectContaining({ maxConcurrentSessions: null }),
      );
    });
  });

  // ── PUT /routing/rules/:ruleId ────────────────────────────────────────────

  describe("PUT /routing/rules/:ruleId", () => {
    it("returns 200 with updated rule on success", async () => {
      engine.getRule.mockReturnValue(SAMPLE_RULE as never);
      const updated = { ...SAMPLE_RULE, priority: 20 };
      engine.updateRule.mockReturnValue(updated as never);
      const res = await httpRequest(server, "PUT", "/routing/rules/rule-001", { priority: 20 });
      expect(res.status).toBe(200);
      const body = res.json() as { priority: number };
      expect(body.priority).toBe(20);
    });

    it("returns 404 when rule does not exist", async () => {
      engine.getRule.mockReturnValue(undefined);
      const res = await httpRequest(server, "PUT", "/routing/rules/rule-missing", { priority: 5 });
      expect(res.status).toBe(404);
      const body = res.json() as { error: string };
      expect(body.error).toBe("Rule not found");
    });

    it("returns 400 for an invalid ruleId format", async () => {
      const res = await httpRequest(server, "PUT", "/routing/rules/bad%20id", { priority: 5 });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("Invalid ruleId");
    });

    it("applies partial patch — only provided fields are forwarded", async () => {
      engine.getRule.mockReturnValue(SAMPLE_RULE as never);
      engine.updateRule.mockReturnValue({ ...SAMPLE_RULE, active: false } as never);
      await httpRequest(server, "PUT", "/routing/rules/rule-001", { active: false });
      expect(engine.updateRule).toHaveBeenCalledWith("rule-001", expect.objectContaining({ active: false }));
    });

    it("handles updateRule returning null as a 404", async () => {
      engine.getRule.mockReturnValue(SAMPLE_RULE as never);
      engine.updateRule.mockReturnValue(null as never);
      const res = await httpRequest(server, "PUT", "/routing/rules/rule-001", { priority: 99 });
      expect(res.status).toBe(404);
    });

    it("sets maxConcurrentSessions to null when explicitly passed null", async () => {
      engine.getRule.mockReturnValue(SAMPLE_RULE as never);
      engine.updateRule.mockReturnValue({ ...SAMPLE_RULE, maxConcurrentSessions: null } as never);
      await httpRequest(server, "PUT", "/routing/rules/rule-001", { maxConcurrentSessions: null });
      expect(engine.updateRule).toHaveBeenCalledWith(
        "rule-001",
        expect.objectContaining({ maxConcurrentSessions: null }),
      );
    });
  });

  // ── DELETE /routing/rules/:ruleId ─────────────────────────────────────────

  describe("DELETE /routing/rules/:ruleId", () => {
    it("returns 204 on successful deletion", async () => {
      engine.deleteRule.mockReturnValue(true);
      const res = await httpRequest(server, "DELETE", "/routing/rules/rule-001");
      expect(res.status).toBe(204);
      expect(res.body).toBe("");
    });

    it("returns 404 when rule does not exist", async () => {
      engine.deleteRule.mockReturnValue(false);
      const res = await httpRequest(server, "DELETE", "/routing/rules/rule-missing");
      expect(res.status).toBe(404);
      const body = res.json() as { error: string };
      expect(body.error).toBe("Rule not found");
    });

    it("returns 400 for an invalid ruleId format", async () => {
      const res = await httpRequest(server, "DELETE", "/routing/rules/bad%20id");
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("Invalid ruleId");
    });
  });

  // ── POST /routing/evaluate ────────────────────────────────────────────────

  describe("POST /routing/evaluate", () => {
    const decision = { matched: true, targetTemplateId: "tmpl-default", reason: "language match" };

    it("returns 200 with routing decision on valid input", async () => {
      engine.evaluate.mockReturnValue(decision as never);
      const res = await httpRequest(server, "POST", "/routing/evaluate", {
        tenantId: "tenant-acme",
        language: "en",
        topic: "billing",
        callerType: "returning",
      });
      expect(res.status).toBe(200);
      expect(res.json()).toEqual(decision);
    });

    it("returns 400 when tenantId is missing", async () => {
      const res = await httpRequest(server, "POST", "/routing/evaluate", { language: "en" });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("tenantId");
    });

    it("passes optional fields to engine.evaluate when provided", async () => {
      engine.evaluate.mockReturnValue(decision as never);
      await httpRequest(server, "POST", "/routing/evaluate", {
        tenantId: "t1",
        language: "fr",
        topic: "claims",
        callerType: "new",
      });
      expect(engine.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1", language: "fr", topic: "claims", callerType: "new" }),
      );
    });

    it("omits unknown callerType (not 'new' or 'returning') from evaluate call", async () => {
      engine.evaluate.mockReturnValue(decision as never);
      await httpRequest(server, "POST", "/routing/evaluate", {
        tenantId: "t1",
        callerType: "vip",
      });
      expect(engine.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ callerType: undefined }),
      );
    });
  });

  // ── GET /routing/queue ────────────────────────────────────────────────────

  describe("GET /routing/queue", () => {
    it("returns 200 with all queue statuses and count", async () => {
      queue.getAllQueueStatuses.mockReturnValue([SAMPLE_QUEUE_STATUS] as never);
      const res = await httpRequest(server, "GET", "/routing/queue");
      expect(res.status).toBe(200);
      const body = res.json() as { queues: unknown[]; count: number };
      expect(body.count).toBe(1);
      expect(body.queues).toHaveLength(1);
    });

    it("returns 200 with empty queues when none exist", async () => {
      queue.getAllQueueStatuses.mockReturnValue([]);
      const res = await httpRequest(server, "GET", "/routing/queue");
      expect(res.status).toBe(200);
      const body = res.json() as { queues: unknown[]; count: number };
      expect(body.queues).toEqual([]);
      expect(body.count).toBe(0);
    });
  });

  // ── GET /routing/queue/:tenantId ──────────────────────────────────────────

  describe("GET /routing/queue/:tenantId", () => {
    it("returns 200 with queue status for the tenant", async () => {
      queue.getQueueStatus.mockReturnValue(SAMPLE_QUEUE_STATUS as never);
      const res = await httpRequest(server, "GET", "/routing/queue/tenant-acme");
      expect(res.status).toBe(200);
      const body = res.json() as { tenantId: string; depth: number };
      expect(body.tenantId).toBe("tenant-acme");
      expect(body.depth).toBe(2);
    });

    it("calls queue.getQueueStatus with the correct tenantId", async () => {
      queue.getQueueStatus.mockReturnValue(SAMPLE_QUEUE_STATUS as never);
      await httpRequest(server, "GET", "/routing/queue/tenant-beta");
      expect(queue.getQueueStatus).toHaveBeenCalledWith("tenant-beta");
    });
  });

  // ── POST /routing/queue/enqueue ───────────────────────────────────────────

  describe("POST /routing/queue/enqueue", () => {
    const enqueueEntry = {
      sessionId: "sess-new",
      tenantId: "tenant-acme",
      position: 3,
      enqueuedAt: "2026-03-19T10:05:00.000Z",
    };

    it("returns 201 with queue entry on success", async () => {
      queue.enqueue.mockReturnValue(enqueueEntry as never);
      const res = await httpRequest(server, "POST", "/routing/queue/enqueue", {
        sessionId: "sess-new",
        tenantId: "tenant-acme",
      });
      expect(res.status).toBe(201);
      const body = res.json() as { sessionId: string; position: number };
      expect(body.sessionId).toBe("sess-new");
      expect(body.position).toBe(3);
    });

    it("returns 400 when sessionId is missing", async () => {
      const res = await httpRequest(server, "POST", "/routing/queue/enqueue", {
        tenantId: "tenant-acme",
      });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("sessionId");
    });

    it("returns 400 when tenantId is missing", async () => {
      const res = await httpRequest(server, "POST", "/routing/queue/enqueue", {
        sessionId: "sess-x",
      });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("tenantId");
    });

    it("calls queue.enqueue with sessionId and tenantId", async () => {
      queue.enqueue.mockReturnValue(enqueueEntry as never);
      await httpRequest(server, "POST", "/routing/queue/enqueue", {
        sessionId: "sess-new",
        tenantId: "tenant-acme",
      });
      expect(queue.enqueue).toHaveBeenCalledWith("sess-new", "tenant-acme");
    });
  });

  // ── POST /routing/queue/dequeue ───────────────────────────────────────────

  describe("POST /routing/queue/dequeue", () => {
    it("returns 200 with sessionId when queue has entries", async () => {
      queue.dequeue.mockReturnValue("sess-1" as never);
      const res = await httpRequest(server, "POST", "/routing/queue/dequeue", {
        tenantId: "tenant-acme",
      });
      expect(res.status).toBe(200);
      const body = res.json() as { sessionId: string };
      expect(body.sessionId).toBe("sess-1");
    });

    it("returns 204 when queue is empty", async () => {
      queue.dequeue.mockReturnValue(null as never);
      const res = await httpRequest(server, "POST", "/routing/queue/dequeue", {
        tenantId: "tenant-empty",
      });
      expect(res.status).toBe(204);
      expect(res.body).toBe("");
    });

    it("returns 400 when tenantId is missing", async () => {
      const res = await httpRequest(server, "POST", "/routing/queue/dequeue", {});
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("tenantId");
    });

    it("calls queue.dequeue with the correct tenantId", async () => {
      queue.dequeue.mockReturnValue("sess-1" as never);
      await httpRequest(server, "POST", "/routing/queue/dequeue", { tenantId: "tenant-acme" });
      expect(queue.dequeue).toHaveBeenCalledWith("tenant-acme");
    });
  });
});

// ── Branch coverage: uncovered source paths ───────────────────────────────────

describe("Routing API — branch coverage", () => {
  let engine: ReturnType<typeof makeMockEngine>;
  let queue: ReturnType<typeof makeMockQueue>;
  let server: Server;

  beforeAll((done) => {
    engine = makeMockEngine();
    queue = makeMockQueue();
    const app = buildApp(engine as unknown as RoutingEngine, queue as unknown as CallQueueService);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── POST /routing/rules — conditions is a string (not object) ─────────────

  describe("POST /routing/rules — conditions type guard", () => {
    it("returns 400 when conditions is a string (not an object)", async () => {
      const res = await httpRequest(server, "POST", "/routing/rules", {
        tenantId: "tenant-acme",
        priority: 10,
        conditions: "invalid-string",
        targetTemplateId: "tmpl-default",
        active: true,
      });
      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("conditions");
    });
  });

  // ── PUT /routing/rules/:ruleId — tenantId null ────────────────────────────

  describe("PUT /routing/rules/:ruleId — tenantId: null", () => {
    it("sets tenantId to null in the patch when body.tenantId is null", async () => {
      engine.getRule.mockReturnValue(SAMPLE_RULE as never);
      const updatedRule = { ...SAMPLE_RULE, tenantId: null };
      engine.updateRule.mockReturnValue(updatedRule as never);

      const res = await httpRequest(server, "PUT", "/routing/rules/rule-001", { tenantId: null });

      expect(res.status).toBe(200);
      expect(engine.updateRule).toHaveBeenCalledWith(
        "rule-001",
        expect.objectContaining({ tenantId: null }),
      );
    });
  });

  // ── PUT /routing/rules/:ruleId — conditions is null ──────────────────────

  describe("PUT /routing/rules/:ruleId — conditions: null", () => {
    it("succeeds (200) but does not include conditions in the patch when body.conditions is null", async () => {
      engine.getRule.mockReturnValue(SAMPLE_RULE as never);
      engine.updateRule.mockReturnValue(SAMPLE_RULE as never);

      const res = await httpRequest(server, "PUT", "/routing/rules/rule-001", { conditions: null });

      expect(res.status).toBe(200);
      const patch = (engine.updateRule.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(patch).not.toHaveProperty("conditions");
    });
  });

  // ── PUT /routing/rules/:ruleId — conditions is a string ──────────────────

  describe("PUT /routing/rules/:ruleId — conditions: string", () => {
    it("succeeds (200) but does not include conditions in the patch when body.conditions is a string", async () => {
      engine.getRule.mockReturnValue(SAMPLE_RULE as never);
      engine.updateRule.mockReturnValue(SAMPLE_RULE as never);

      const res = await httpRequest(server, "PUT", "/routing/rules/rule-001", {
        conditions: "string-value",
      });

      expect(res.status).toBe(200);
      const patch = (engine.updateRule.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(patch).not.toHaveProperty("conditions");
    });
  });
});
