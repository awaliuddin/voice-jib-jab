/**
 * Webhook Retry Queue API tests
 *
 * Tests the router produced by createWebhookRetryRouter().
 * WebhookRetryQueue is fully mocked with jest.fn() — no file I/O, no timers.
 *
 * HTTP transport uses the same plain Node http helper used by other API tests
 * (tenantMigration-api.test.ts pattern): real Express server on random port (:0).
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createWebhookRetryRouter } from "../../api/webhookRetry.js";
import type { WebhookRetryQueue } from "../../services/WebhookRetryQueue.js";
import type { RetryQueueItem, DeadLetterItem, RetryQueueStats } from "../../services/WebhookRetryQueue.js";

// ── Mock queue ────────────────────────────────────────────────────────

const mockQueue = {
  getQueue: jest.fn(),
  getDeadLetter: jest.fn(),
  getStats: jest.fn(),
  processQueue: jest.fn(),
  retryDeadLetter: jest.fn(),
  clearDeadLetter: jest.fn(),
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

    const payload =
      body !== undefined ? JSON.stringify(body) : undefined;

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

// ── App builder ───────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/webhooks", createWebhookRetryRouter(mockQueue as unknown as WebhookRetryQueue));
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────

function makeRetryQueueItem(overrides: Partial<RetryQueueItem> = {}): RetryQueueItem {
  return {
    itemId: "item-001",
    webhookId: "wh-001",
    tenantId: "org-abc",
    event: "call_start",
    payload: {
      event: "call_start",
      tenantId: "org-abc",
      sessionId: "s1",
      timestamp: "2026-03-21T00:00:00.000Z",
      data: {},
    },
    attemptCount: 0,
    maxAttempts: 5,
    nextAttemptAt: Date.now(),
    createdAt: "2026-03-21T00:00:00.000Z",
    ...overrides,
  };
}

function makeDeadLetterItem(overrides: Partial<DeadLetterItem> = {}): DeadLetterItem {
  return {
    itemId: "dead-001",
    webhookId: "wh-001",
    tenantId: "org-abc",
    event: "call_end",
    payload: {
      event: "call_end",
      tenantId: "org-abc",
      sessionId: "s1",
      timestamp: "2026-03-21T00:00:00.000Z",
      data: {},
    },
    attemptCount: 5,
    lastError: "connection refused",
    exhaustedAt: "2026-03-21T01:00:00.000Z",
    originalCreatedAt: "2026-03-21T00:00:00.000Z",
    ...overrides,
  };
}

const STATS_FIXTURE: RetryQueueStats = {
  queueDepth: 3,
  deadLetterDepth: 1,
  totalEnqueued: 10,
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("Webhook Retry Queue API", () => {
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

  // ── GET /webhooks/queue ─────────────────────────────────────────────

  describe("GET /webhooks/queue", () => {
    it("returns 200 with a JSON array", async () => {
      const items = [makeRetryQueueItem()];
      mockQueue.getQueue.mockReturnValue(items);

      const res = await httpRequest(server, "GET", "/webhooks/queue");

      expect(res.status).toBe(200);
      const data = res.json() as RetryQueueItem[];
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
    });

    it("calls getQueue(undefined) when no tenantId query param is provided", async () => {
      mockQueue.getQueue.mockReturnValue([]);

      await httpRequest(server, "GET", "/webhooks/queue");

      expect(mockQueue.getQueue).toHaveBeenCalledWith(undefined);
    });

    it("calls getQueue(tenantId) when tenantId query param is provided", async () => {
      mockQueue.getQueue.mockReturnValue([]);

      await httpRequest(server, "GET", "/webhooks/queue?tenantId=org-abc");

      expect(mockQueue.getQueue).toHaveBeenCalledWith("org-abc");
    });

    it("returns empty array when queue is empty", async () => {
      mockQueue.getQueue.mockReturnValue([]);

      const res = await httpRequest(server, "GET", "/webhooks/queue");

      expect(res.status).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("returns all items from getQueue without modification", async () => {
      const items = [
        makeRetryQueueItem({ itemId: "item-001", tenantId: "org-abc" }),
        makeRetryQueueItem({ itemId: "item-002", tenantId: "org-xyz" }),
      ];
      mockQueue.getQueue.mockReturnValue(items);

      const res = await httpRequest(server, "GET", "/webhooks/queue");
      const data = res.json() as RetryQueueItem[];

      expect(data).toHaveLength(2);
      expect(data[0].itemId).toBe("item-001");
      expect(data[1].itemId).toBe("item-002");
    });
  });

  // ── GET /webhooks/dead-letter ───────────────────────────────────────

  describe("GET /webhooks/dead-letter", () => {
    it("returns 200 with a JSON array", async () => {
      const items = [makeDeadLetterItem()];
      mockQueue.getDeadLetter.mockReturnValue(items);

      const res = await httpRequest(server, "GET", "/webhooks/dead-letter");

      expect(res.status).toBe(200);
      const data = res.json() as DeadLetterItem[];
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
    });

    it("calls getDeadLetter(undefined) when no tenantId query param is provided", async () => {
      mockQueue.getDeadLetter.mockReturnValue([]);

      await httpRequest(server, "GET", "/webhooks/dead-letter");

      expect(mockQueue.getDeadLetter).toHaveBeenCalledWith(undefined);
    });

    it("calls getDeadLetter(tenantId) when tenantId query param is provided", async () => {
      mockQueue.getDeadLetter.mockReturnValue([]);

      await httpRequest(server, "GET", "/webhooks/dead-letter?tenantId=org-abc");

      expect(mockQueue.getDeadLetter).toHaveBeenCalledWith("org-abc");
    });

    it("returns empty array when dead-letter queue is empty", async () => {
      mockQueue.getDeadLetter.mockReturnValue([]);

      const res = await httpRequest(server, "GET", "/webhooks/dead-letter");

      expect(res.status).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("returns all dead-letter fields intact", async () => {
      const item = makeDeadLetterItem({ itemId: "dead-999", lastError: "timeout" });
      mockQueue.getDeadLetter.mockReturnValue([item]);

      const res = await httpRequest(server, "GET", "/webhooks/dead-letter");
      const data = res.json() as DeadLetterItem[];

      expect(data[0].itemId).toBe("dead-999");
      expect(data[0].lastError).toBe("timeout");
      expect(data[0].exhaustedAt).toBeDefined();
    });
  });

  // ── GET /webhooks/retry-stats ───────────────────────────────────────

  describe("GET /webhooks/retry-stats", () => {
    it("returns 200 with stats object", async () => {
      mockQueue.getStats.mockReturnValue(STATS_FIXTURE);

      const res = await httpRequest(server, "GET", "/webhooks/retry-stats");

      expect(res.status).toBe(200);
    });

    it("response contains queueDepth", async () => {
      mockQueue.getStats.mockReturnValue(STATS_FIXTURE);

      const res = await httpRequest(server, "GET", "/webhooks/retry-stats");
      const data = res.json() as RetryQueueStats;

      expect(data.queueDepth).toBe(3);
    });

    it("response contains deadLetterDepth", async () => {
      mockQueue.getStats.mockReturnValue(STATS_FIXTURE);

      const res = await httpRequest(server, "GET", "/webhooks/retry-stats");
      const data = res.json() as RetryQueueStats;

      expect(data.deadLetterDepth).toBe(1);
    });

    it("response contains totalEnqueued", async () => {
      mockQueue.getStats.mockReturnValue(STATS_FIXTURE);

      const res = await httpRequest(server, "GET", "/webhooks/retry-stats");
      const data = res.json() as RetryQueueStats;

      expect(data.totalEnqueued).toBe(10);
    });

    it("calls getStats() exactly once per request", async () => {
      mockQueue.getStats.mockReturnValue(STATS_FIXTURE);

      await httpRequest(server, "GET", "/webhooks/retry-stats");

      expect(mockQueue.getStats).toHaveBeenCalledTimes(1);
    });
  });

  // ── POST /webhooks/process-queue ───────────────────────────────────

  describe("POST /webhooks/process-queue", () => {
    it("returns 200 with processed count", async () => {
      mockQueue.processQueue.mockResolvedValue(3);

      const res = await httpRequest(server, "POST", "/webhooks/process-queue");

      expect(res.status).toBe(200);
      const data = res.json() as { processed: number };
      expect(data.processed).toBe(3);
    });

    it("returns processed: 0 when queue was empty", async () => {
      mockQueue.processQueue.mockResolvedValue(0);

      const res = await httpRequest(server, "POST", "/webhooks/process-queue");
      const data = res.json() as { processed: number };

      expect(data.processed).toBe(0);
    });

    it("calls processQueue() exactly once", async () => {
      mockQueue.processQueue.mockResolvedValue(1);

      await httpRequest(server, "POST", "/webhooks/process-queue");

      expect(mockQueue.processQueue).toHaveBeenCalledTimes(1);
    });

    it("response body has only the processed field", async () => {
      mockQueue.processQueue.mockResolvedValue(2);

      const res = await httpRequest(server, "POST", "/webhooks/process-queue");
      const data = res.json() as Record<string, unknown>;

      expect(Object.keys(data)).toEqual(["processed"]);
    });
  });

  // ── POST /webhooks/dead-letter/:itemId/retry ────────────────────────

  describe("POST /webhooks/dead-letter/:itemId/retry", () => {
    it("returns 200 with the requeued item when found", async () => {
      const item = makeRetryQueueItem({ itemId: "dead-001", attemptCount: 0 });
      mockQueue.retryDeadLetter.mockReturnValue(item);

      const res = await httpRequest(
        server,
        "POST",
        "/webhooks/dead-letter/dead-001/retry",
      );

      expect(res.status).toBe(200);
      const data = res.json() as RetryQueueItem;
      expect(data.itemId).toBe("dead-001");
    });

    it("calls retryDeadLetter with the itemId from the URL", async () => {
      mockQueue.retryDeadLetter.mockReturnValue(makeRetryQueueItem());

      await httpRequest(
        server,
        "POST",
        "/webhooks/dead-letter/dead-001/retry",
      );

      expect(mockQueue.retryDeadLetter).toHaveBeenCalledWith("dead-001");
    });

    it("returns 404 when retryDeadLetter returns null", async () => {
      mockQueue.retryDeadLetter.mockReturnValue(null);

      const res = await httpRequest(
        server,
        "POST",
        "/webhooks/dead-letter/no-such-item/retry",
      );

      expect(res.status).toBe(404);
    });

    it("returns error message containing the itemId when not found", async () => {
      mockQueue.retryDeadLetter.mockReturnValue(null);

      const res = await httpRequest(
        server,
        "POST",
        "/webhooks/dead-letter/no-such-item/retry",
      );
      const data = res.json() as { error: string };

      expect(data.error).toContain("no-such-item");
    });

    it("returns 404 when retryDeadLetter returns undefined", async () => {
      mockQueue.retryDeadLetter.mockReturnValue(undefined);

      const res = await httpRequest(
        server,
        "POST",
        "/webhooks/dead-letter/ghost-id/retry",
      );

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /webhooks/dead-letter/:itemId ────────────────────────────

  describe("DELETE /webhooks/dead-letter/:itemId", () => {
    it("returns 204 when clearDeadLetter returns true", async () => {
      mockQueue.clearDeadLetter.mockReturnValue(true);

      const res = await httpRequest(
        server,
        "DELETE",
        "/webhooks/dead-letter/dead-001",
      );

      expect(res.status).toBe(204);
    });

    it("returns empty body on 204", async () => {
      mockQueue.clearDeadLetter.mockReturnValue(true);

      const res = await httpRequest(
        server,
        "DELETE",
        "/webhooks/dead-letter/dead-001",
      );

      expect(res.body).toBe("");
    });

    it("calls clearDeadLetter with the itemId from the URL", async () => {
      mockQueue.clearDeadLetter.mockReturnValue(true);

      await httpRequest(server, "DELETE", "/webhooks/dead-letter/dead-001");

      expect(mockQueue.clearDeadLetter).toHaveBeenCalledWith("dead-001");
    });

    it("returns 404 when clearDeadLetter returns false", async () => {
      mockQueue.clearDeadLetter.mockReturnValue(false);

      const res = await httpRequest(
        server,
        "DELETE",
        "/webhooks/dead-letter/no-such-item",
      );

      expect(res.status).toBe(404);
    });

    it("returns error message containing the itemId when not found", async () => {
      mockQueue.clearDeadLetter.mockReturnValue(false);

      const res = await httpRequest(
        server,
        "DELETE",
        "/webhooks/dead-letter/no-such-item",
      );
      const data = res.json() as { error: string };

      expect(data.error).toContain("no-such-item");
    });

    it("returns 404 when clearDeadLetter returns null", async () => {
      mockQueue.clearDeadLetter.mockReturnValue(null);

      const res = await httpRequest(
        server,
        "DELETE",
        "/webhooks/dead-letter/null-item",
      );

      expect(res.status).toBe(404);
    });
  });
});
