/**
 * WebhookRetryQueue unit tests
 *
 * Uses jest fake timers to control Date.now() / new Date() so that
 * backoff scheduling and nextAttemptAt assertions are deterministic.
 */

import { unlinkSync, existsSync } from "fs";
import { WebhookRetryQueue } from "../../services/WebhookRetryQueue.js";
import type { DeadLetterItem } from "../../services/WebhookRetryQueue.js";
import type { WebhookService, WebhookPayload, WebhookDelivery } from "../../services/WebhookService.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeMockService(): jest.Mocked<Pick<WebhookService, "deliver">> & WebhookService {
  return {
    deliver: jest.fn(),
  } as unknown as jest.Mocked<Pick<WebhookService, "deliver">> & WebhookService;
}

function makePayload(tenantId = "t1"): WebhookPayload {
  return {
    event: "call_start",
    tenantId,
    sessionId: "s1",
    timestamp: new Date().toISOString(),
    data: { foo: "bar" },
  };
}

function makeDelivery(success: boolean, error?: string): WebhookDelivery {
  return {
    deliveryId: "d1",
    webhookId: "w1",
    tenantId: "t1",
    event: "call_start",
    payload: {},
    attemptedAt: new Date().toISOString(),
    statusCode: success ? 200 : 500,
    success,
    durationMs: 10,
    error,
  };
}

function makeTmpFile(): string {
  return `/tmp/webhook-retry-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
}

function cleanup(file: string): void {
  if (existsSync(file)) {
    unlinkSync(file);
  }
}

// ── Test suite ───────────────────────────────────────────────────────────

describe("WebhookRetryQueue", () => {
  let mockService: ReturnType<typeof makeMockService>;
  let tmpFile: string;
  const BASE_TIME = 1_700_000_000_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(BASE_TIME);
    mockService = makeMockService();
    tmpFile = makeTmpFile();
  });

  afterEach(() => {
    jest.useRealTimers();
    cleanup(tmpFile);
  });

  // ── enqueue() ──────────────────────────────────────────────────────

  describe("enqueue()", () => {
    it("adds an item to the queue", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      const payload = makePayload();

      q.enqueue("t1", "call_start", payload);

      expect(q.getQueue()).toHaveLength(1);
    });

    it("sets attemptCount to 0", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      const item = q.enqueue("t1", "call_start", makePayload());

      expect(item.attemptCount).toBe(0);
    });

    it("sets nextAttemptAt to now (immediate)", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      const item = q.enqueue("t1", "call_start", makePayload());

      expect(item.nextAttemptAt).toBe(BASE_TIME);
    });

    it("returns an item with a non-empty itemId", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      const item = q.enqueue("t1", "call_start", makePayload());

      expect(typeof item.itemId).toBe("string");
      expect(item.itemId.length).toBeGreaterThan(0);
    });

    it("returns an item with the correct tenantId and event", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      const payload = makePayload("tenant-x");
      const item = q.enqueue("tenant-x", "escalation", payload);

      expect(item.tenantId).toBe("tenant-x");
      expect(item.event).toBe("escalation");
    });

    it("persists the item across queue instances (reload)", () => {
      const q1 = new WebhookRetryQueue(mockService, tmpFile);
      q1.enqueue("t1", "call_start", makePayload());

      const q2 = new WebhookRetryQueue(mockService, tmpFile);
      expect(q2.getQueue()).toHaveLength(1);
    });
  });

  // ── getQueue() ──────────────────────────────────────────────────────

  describe("getQueue()", () => {
    it("returns all items when no tenantId filter", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload("t1"));
      q.enqueue("t2", "call_end", makePayload("t2"));

      expect(q.getQueue()).toHaveLength(2);
    });

    it("filters by tenantId", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload("t1"));
      q.enqueue("t2", "call_end", makePayload("t2"));

      const items = q.getQueue("t1");
      expect(items).toHaveLength(1);
      expect(items[0].tenantId).toBe("t1");
    });

    it("returns empty array when queue is empty", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      expect(q.getQueue()).toEqual([]);
    });
  });

  // ── processQueue() — basic ──────────────────────────────────────────

  describe("processQueue() — basic", () => {
    it("returns 0 when queue is empty", async () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      const count = await q.processQueue();

      expect(count).toBe(0);
      expect(mockService.deliver).not.toHaveBeenCalled();
    });

    it("calls deliver() for items due now", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(true)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();

      expect(mockService.deliver).toHaveBeenCalledTimes(1);
    });

    it("skips items with a future nextAttemptAt", async () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      const item = q.enqueue("t1", "call_start", makePayload());

      // Manually push nextAttemptAt into the future
      item.nextAttemptAt = BASE_TIME + 60_000;
      // Re-create queue from scratch so the future timestamp is in the file
      cleanup(tmpFile);
      const q2 = new WebhookRetryQueue(mockService, tmpFile);
      // Enqueue and then fast-forward past the item's nextAttemptAt manually:
      // Use a separate approach — enqueue and set time before nextAttemptAt
      q2.enqueue("t1", "call_start", makePayload());
      // Advance time by only 1 ms — item is still at BASE_TIME+1 which is now
      // Actually item was enqueued at BASE_TIME, time is still BASE_TIME — should be due
      // Let's instead test by advancing time to before the retry window
      // Enqueue, then fail once to get a future nextAttemptAt, then check skip

      cleanup(tmpFile);
      const q3 = new WebhookRetryQueue(mockService, tmpFile);
      mockService.deliver.mockResolvedValueOnce([makeDelivery(false)]);
      q3.enqueue("t1", "call_start", makePayload());
      await q3.processQueue(); // fails, schedules retry 1s from now

      mockService.deliver.mockClear();

      // Don't advance time — retry is in the future
      const count = await q3.processQueue();
      expect(count).toBe(0);
      expect(mockService.deliver).not.toHaveBeenCalled();
    });

    it("returns the count of items processed", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(true)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());
      q.enqueue("t1", "call_end", makePayload());

      const count = await q.processQueue();

      expect(count).toBe(2);
    });
  });

  // ── processQueue() — success path ──────────────────────────────────

  describe("processQueue() — success", () => {
    it("removes item from queue on successful delivery", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(true)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();

      expect(q.getQueue()).toHaveLength(0);
    });

    it("does not add item to dead-letter on success", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(true)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();

      expect(q.getDeadLetter()).toHaveLength(0);
    });
  });

  // ── processQueue() — failure & backoff ─────────────────────────────

  describe("processQueue() — failure and backoff", () => {
    it("increments attemptCount on delivery failure (success=false)", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();

      expect(q.getQueue()[0].attemptCount).toBe(1);
    });

    it("keeps item in queue after a failure below maxAttempts", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();

      expect(q.getQueue()).toHaveLength(1);
    });

    it("records lastError on failure", async () => {
      mockService.deliver.mockResolvedValue([
        makeDelivery(false, "connection refused"),
      ]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();

      expect(q.getQueue()[0].lastError).toBeTruthy();
    });

    it("treats deliver() throwing as a failure and schedules retry", async () => {
      mockService.deliver.mockRejectedValue(new Error("network error"));
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();

      const items = q.getQueue();
      expect(items).toHaveLength(1);
      expect(items[0].attemptCount).toBe(1);
      expect(items[0].lastError).toContain("network error");
    });

    it("treats empty deliveries array as failure", async () => {
      mockService.deliver.mockResolvedValue([]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();

      expect(q.getQueue()[0].attemptCount).toBe(1);
    });

    it("backoff attempt 0->1: nextRetry = now + 1000ms", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue(); // attempt 0, fails, attemptCount becomes 1

      // After first failure: nextAttemptAt = BASE_TIME + 1000 * 2^0 = BASE_TIME + 1000
      expect(q.getQueue()[0].nextAttemptAt).toBe(BASE_TIME + 1000);
    });

    it("backoff attempt 1->2: nextRetry = now + 2000ms", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue(); // attemptCount = 1, nextAttemptAt = BASE_TIME+1000

      jest.setSystemTime(BASE_TIME + 1000);
      await q.processQueue(); // attemptCount = 2, nextAttemptAt = BASE_TIME+1000+2000

      expect(q.getQueue()[0].nextAttemptAt).toBe(BASE_TIME + 1000 + 2000);
    });

    it("backoff attempt 2->3: nextRetry = now + 4000ms", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000);
      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000 + 2000);
      await q.processQueue(); // attemptCount = 3

      expect(q.getQueue()[0].nextAttemptAt).toBe(BASE_TIME + 1000 + 2000 + 4000);
    });

    it("backoff attempt 3->4: nextRetry = now + 8000ms", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000);
      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000 + 2000);
      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000 + 2000 + 4000);
      await q.processQueue(); // attemptCount = 4

      expect(q.getQueue()[0].nextAttemptAt).toBe(BASE_TIME + 1000 + 2000 + 4000 + 8000);
    });
  });

  // ── processQueue() — dead-letter after maxAttempts ─────────────────

  describe("processQueue() — dead-letter exhaustion", () => {
    it("moves item to dead-letter after maxAttempts failures", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false, "server error")]);
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 3 });
      q.enqueue("t1", "call_start", makePayload());

      // Exhaust all 3 attempts
      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000);
      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000 + 2000);
      await q.processQueue();

      expect(q.getQueue()).toHaveLength(0);
      expect(q.getDeadLetter()).toHaveLength(1);
    });

    it("dead-letter item has correct lastError", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false, "bad gateway")]);
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 2 });
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000);
      await q.processQueue();

      const dead = q.getDeadLetter();
      expect(dead[0].lastError).toBeTruthy();
    });

    it("dead-letter item has exhaustedAt timestamp", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 2 });
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000);
      await q.processQueue();

      expect(q.getDeadLetter()[0].exhaustedAt).toBeTruthy();
    });

    it("dead-letter item has correct attemptCount", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 2 });
      q.enqueue("t1", "call_start", makePayload());

      await q.processQueue();
      jest.setSystemTime(BASE_TIME + 1000);
      await q.processQueue();

      expect(q.getDeadLetter()[0].attemptCount).toBe(2);
    });
  });

  // ── getDeadLetter() ─────────────────────────────────────────────────

  describe("getDeadLetter()", () => {
    it("returns all dead-letter items when no tenantId filter", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 1 });
      q.enqueue("t1", "call_start", makePayload("t1"));
      q.enqueue("t2", "call_end", makePayload("t2"));

      await q.processQueue();

      expect(q.getDeadLetter()).toHaveLength(2);
    });

    it("filters dead-letter by tenantId", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 1 });
      q.enqueue("t1", "call_start", makePayload("t1"));
      q.enqueue("t2", "call_end", makePayload("t2"));

      await q.processQueue();

      const items = q.getDeadLetter("t1");
      expect(items).toHaveLength(1);
      expect(items[0].tenantId).toBe("t1");
    });
  });

  // ── retryDeadLetter() ───────────────────────────────────────────────

  describe("retryDeadLetter()", () => {
    async function buildDeadItem(
      q: WebhookRetryQueue,
    ): Promise<DeadLetterItem> {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      q.enqueue("t1", "call_start", makePayload());
      await q.processQueue(); // attempt 1 → dead (maxAttempts=1)
      return q.getDeadLetter()[0];
    }

    it("moves dead-letter item back to queue", async () => {
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 1 });
      const dead = await buildDeadItem(q);

      q.retryDeadLetter(dead.itemId);

      expect(q.getDeadLetter()).toHaveLength(0);
      expect(q.getQueue()).toHaveLength(1);
    });

    it("resets attemptCount to 0", async () => {
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 1 });
      const dead = await buildDeadItem(q);

      const item = q.retryDeadLetter(dead.itemId);

      expect(item?.attemptCount).toBe(0);
    });

    it("schedules item for immediate processing (nextAttemptAt = now)", async () => {
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 1 });
      const dead = await buildDeadItem(q);

      const item = q.retryDeadLetter(dead.itemId);

      expect(item?.nextAttemptAt).toBe(Date.now());
    });

    it("returns null for unknown itemId", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);

      expect(q.retryDeadLetter("no-such-id")).toBeNull();
    });

    it("returns the new RetryQueueItem on success", async () => {
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 1 });
      const dead = await buildDeadItem(q);

      const item = q.retryDeadLetter(dead.itemId);

      expect(item).not.toBeNull();
      expect(item?.itemId).toBe(dead.itemId);
    });
  });

  // ── clearDeadLetter() ───────────────────────────────────────────────

  describe("clearDeadLetter()", () => {
    it("removes item from dead-letter and returns true", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 1 });
      q.enqueue("t1", "call_start", makePayload());
      await q.processQueue();

      const dead = q.getDeadLetter()[0];
      const result = q.clearDeadLetter(dead.itemId);

      expect(result).toBe(true);
      expect(q.getDeadLetter()).toHaveLength(0);
    });

    it("returns false for unknown itemId", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);

      expect(q.clearDeadLetter("no-such-id")).toBe(false);
    });
  });

  // ── getStats() ──────────────────────────────────────────────────────

  describe("getStats()", () => {
    it("returns correct queueDepth", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("t1", "call_start", makePayload());
      q.enqueue("t1", "call_end", makePayload());

      expect(q.getStats().queueDepth).toBe(2);
    });

    it("returns correct deadLetterDepth", async () => {
      mockService.deliver.mockResolvedValue([makeDelivery(false)]);
      const q = new WebhookRetryQueue(mockService, tmpFile, { maxAttempts: 1 });
      q.enqueue("t1", "call_start", makePayload());
      await q.processQueue();

      expect(q.getStats().deadLetterDepth).toBe(1);
    });

    it("totalEnqueued increments on each enqueue()", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      expect(q.getStats().totalEnqueued).toBe(0);

      q.enqueue("t1", "call_start", makePayload());
      expect(q.getStats().totalEnqueued).toBe(1);

      q.enqueue("t1", "call_end", makePayload());
      expect(q.getStats().totalEnqueued).toBe(2);
    });

    it("totalEnqueued does not count items loaded from disk", () => {
      const q1 = new WebhookRetryQueue(mockService, tmpFile);
      q1.enqueue("t1", "call_start", makePayload());
      // q1 totalEnqueued = 1

      // New instance loads from file — totalEnqueued resets to 0
      const q2 = new WebhookRetryQueue(mockService, tmpFile);
      expect(q2.getStats().totalEnqueued).toBe(0);
    });
  });

  // ── Multi-tenant isolation ──────────────────────────────────────────

  describe("multi-tenant isolation", () => {
    it("each tenant's queue is independent", () => {
      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("tenant-a", "call_start", makePayload("tenant-a"));
      q.enqueue("tenant-b", "call_end", makePayload("tenant-b"));

      expect(q.getQueue("tenant-a")).toHaveLength(1);
      expect(q.getQueue("tenant-b")).toHaveLength(1);
    });

    it("processing one tenant's item does not affect another", async () => {
      mockService.deliver
        .mockResolvedValueOnce([makeDelivery(true)]) // tenant-a succeeds
        .mockResolvedValueOnce([makeDelivery(false)]); // tenant-b fails

      const q = new WebhookRetryQueue(mockService, tmpFile);
      q.enqueue("tenant-a", "call_start", makePayload("tenant-a"));
      q.enqueue("tenant-b", "call_start", makePayload("tenant-b"));

      await q.processQueue();

      expect(q.getQueue("tenant-a")).toHaveLength(0);
      expect(q.getQueue("tenant-b")).toHaveLength(1);
    });
  });
});
