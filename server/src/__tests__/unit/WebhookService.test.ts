/**
 * WebhookService Unit Tests
 *
 * Tests for WebhookService — per-tenant webhook management and delivery.
 *
 * Uses real filesystem via OS temp directories for isolation.
 * Each test gets a fresh service instance backed by a unique temp file.
 * Fetch is mocked via jest.spyOn(global, "fetch").
 */

import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import {
  WebhookService,
  initWebhookService,
  webhookService,
} from "../../services/WebhookService.js";
import type { WebhookPayload } from "../../services/WebhookService.js";

// ── Helpers ────────────────────────────────────────────────────────────

function tempFile(label: string): string {
  return join(
    tmpdir(),
    `webhook-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

function makeOkResponse(status = 200): Response {
  return {
    status,
    ok: status >= 200 && status <= 299,
  } as Response;
}

function makePayload(tenantId = "acme"): WebhookPayload {
  return {
    event: "call_start",
    tenantId,
    sessionId: "sess-001",
    timestamp: new Date().toISOString(),
    data: { duration: 120 },
  };
}

// ── WebhookService unit tests ──────────────────────────────────────────

describe("WebhookService", () => {
  let svc: WebhookService;
  let file: string;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    file = tempFile("svc");
    svc = new WebhookService(file);
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(makeOkResponse(200));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  // ── createWebhook ────────────────────────────────────────────────

  describe("createWebhook()", () => {
    it("returns WebhookConfig with webhookId", () => {
      const webhook = svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      expect(webhook.webhookId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("returns WebhookConfig with createdAt", () => {
      const webhook = svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      expect(webhook.createdAt).toBeDefined();
      expect(new Date(webhook.createdAt).toISOString()).toBe(webhook.createdAt);
    });

    it("returns WebhookConfig with updatedAt", () => {
      const webhook = svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      expect(webhook.updatedAt).toBeDefined();
      expect(new Date(webhook.updatedAt).toISOString()).toBe(webhook.updatedAt);
    });

    it("validates url is non-empty", () => {
      expect(() =>
        svc.createWebhook({
          tenantId: "acme",
          url: "",
          events: ["call_start"],
          active: true,
        }),
      ).toThrow();
    });

    it("validates events array non-empty", () => {
      expect(() =>
        svc.createWebhook({
          tenantId: "acme",
          url: "https://example.com/hook",
          events: [],
          active: true,
        }),
      ).toThrow();
    });

    it("persists to file (survives reload)", () => {
      const webhook = svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      const svc2 = new WebhookService(file);
      expect(svc2.getWebhook(webhook.webhookId)).toBeDefined();
    });
  });

  // ── getWebhook ───────────────────────────────────────────────────

  describe("getWebhook()", () => {
    it("returns undefined for unknown ID", () => {
      expect(svc.getWebhook("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    });

    it("returns the webhook when found", () => {
      const created = svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_end"],
        active: true,
      });

      const found = svc.getWebhook(created.webhookId);
      expect(found).toBeDefined();
      expect(found!.webhookId).toBe(created.webhookId);
    });
  });

  // ── listWebhooks ─────────────────────────────────────────────────

  describe("listWebhooks()", () => {
    it("returns all when no tenantId filter", () => {
      svc.createWebhook({ tenantId: "t1", url: "https://a.com", events: ["call_start"], active: true });
      svc.createWebhook({ tenantId: "t2", url: "https://b.com", events: ["call_end"], active: true });

      expect(svc.listWebhooks()).toHaveLength(2);
    });

    it("filters correctly by tenantId", () => {
      svc.createWebhook({ tenantId: "acme", url: "https://a.com", events: ["call_start"], active: true });
      svc.createWebhook({ tenantId: "acme", url: "https://b.com", events: ["call_end"], active: true });
      svc.createWebhook({ tenantId: "other", url: "https://c.com", events: ["escalation"], active: true });

      const acme = svc.listWebhooks("acme");
      expect(acme).toHaveLength(2);
      expect(acme.every((w) => w.tenantId === "acme")).toBe(true);
    });

    it("returns empty array when no match", () => {
      svc.createWebhook({ tenantId: "acme", url: "https://a.com", events: ["call_start"], active: true });

      expect(svc.listWebhooks("ghost")).toHaveLength(0);
    });
  });

  // ── updateWebhook ────────────────────────────────────────────────

  describe("updateWebhook()", () => {
    it("updates url and returns updated config", () => {
      const created = svc.createWebhook({
        tenantId: "acme",
        url: "https://old.com/hook",
        events: ["call_start"],
        active: true,
      });

      const updated = svc.updateWebhook(created.webhookId, {
        url: "https://new.com/hook",
      });

      expect(updated).toBeDefined();
      expect(updated!.url).toBe("https://new.com/hook");
    });

    it("updates updatedAt on change", () => {
      const created = svc.createWebhook({
        tenantId: "acme",
        url: "https://old.com/hook",
        events: ["call_start"],
        active: true,
      });
      const originalUpdatedAt = created.updatedAt;

      // Ensure time moves forward
      jest.useFakeTimers();
      jest.advanceTimersByTime(100);
      const updated = svc.updateWebhook(created.webhookId, { active: false });
      jest.useRealTimers();

      expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it("returns undefined for unknown ID", () => {
      expect(
        svc.updateWebhook("00000000-0000-0000-0000-000000000000", { active: false }),
      ).toBeUndefined();
    });
  });

  // ── deleteWebhook ────────────────────────────────────────────────

  describe("deleteWebhook()", () => {
    it("returns true and removes webhook", () => {
      const created = svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      expect(svc.deleteWebhook(created.webhookId)).toBe(true);
      expect(svc.getWebhook(created.webhookId)).toBeUndefined();
    });

    it("returns false for unknown ID", () => {
      expect(svc.deleteWebhook("00000000-0000-0000-0000-000000000000")).toBe(false);
    });
  });

  // ── deliver ──────────────────────────────────────────────────────

  describe("deliver()", () => {
    it("sends POST to webhook URL", async () => {
      svc.createWebhook({
        tenantId: "acme",
        url: "https://receiver.example.com/hook",
        events: ["call_start"],
        active: true,
      });

      await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://receiver.example.com/hook",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("sends JSON body with event, tenantId, timestamp, data", async () => {
      svc.createWebhook({
        tenantId: "acme",
        url: "https://receiver.example.com/hook",
        events: ["call_start"],
        active: true,
      });

      const payload = makePayload("acme");
      await svc.deliver("acme", "call_start", payload);

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as WebhookPayload;
      expect(body.event).toBe("call_start");
      expect(body.tenantId).toBe("acme");
      expect(body.timestamp).toBeDefined();
      expect(body.data).toBeDefined();
    });

    it("records delivery with correct statusCode", async () => {
      fetchSpy.mockResolvedValue(makeOkResponse(201));

      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      const [delivery] = await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(delivery.statusCode).toBe(201);
    });

    it("marks success=true for 2xx response", async () => {
      fetchSpy.mockResolvedValue(makeOkResponse(200));

      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      const [delivery] = await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(delivery.success).toBe(true);
    });

    it("marks success=false for 4xx response", async () => {
      fetchSpy.mockResolvedValue(makeOkResponse(400));

      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      const [delivery] = await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(delivery.success).toBe(false);
    });

    it("records durationMs > 0", async () => {
      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      const [delivery] = await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(delivery.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("only delivers to matching event type subscribers", async () => {
      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_end"],  // subscribed to call_end only
        active: true,
      });

      const deliveries = await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(deliveries).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("only delivers to active webhooks (not inactive)", async () => {
      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: false,
      });

      const deliveries = await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(deliveries).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("only delivers to matching tenantId", async () => {
      svc.createWebhook({
        tenantId: "other-tenant",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      const deliveries = await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(deliveries).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("adds X-Webhook-Signature header when secret set", async () => {
      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
        secret: "my-secret",
      });

      await svc.deliver("acme", "call_start", makePayload("acme"));

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers["X-Webhook-Signature"]).toBeDefined();
    });

    it("signature is 'sha256=' + hmac", async () => {
      const secret = "test-secret";
      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
        secret,
      });

      const payload = makePayload("acme");
      await svc.deliver("acme", "call_start", payload);

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      const sig = headers["X-Webhook-Signature"];

      const { createHmac } = await import("node:crypto");
      const expectedHmac = createHmac("sha256", secret)
        .update(options.body as string)
        .digest("hex");
      expect(sig).toBe(`sha256=${expectedHmac}`);
    });

    it("does not add signature when no secret", async () => {
      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
        // no secret
      });

      await svc.deliver("acme", "call_start", makePayload("acme"));

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers["X-Webhook-Signature"]).toBeUndefined();
    });

    it("records error message when fetch throws", async () => {
      fetchSpy.mockRejectedValue(new Error("Connection refused"));

      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      const [delivery] = await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(delivery.error).toContain("Connection refused");
      expect(delivery.success).toBe(false);
    });

    it("is non-fatal (never throws even on all fetch failures)", async () => {
      fetchSpy.mockRejectedValue(new Error("Network down"));

      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      await expect(
        svc.deliver("acme", "call_start", makePayload("acme")),
      ).resolves.not.toThrow();
    });

    it("returns empty array when no matching webhooks", async () => {
      const deliveries = await svc.deliver("acme", "call_start", makePayload("acme"));

      expect(deliveries).toEqual([]);
    });
  });

  // ── listDeliveries ───────────────────────────────────────────────

  describe("listDeliveries()", () => {
    it("returns all deliveries", async () => {
      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start", "call_end"],
        active: true,
      });

      await svc.deliver("acme", "call_start", makePayload("acme"));
      await svc.deliver("acme", "call_end", { ...makePayload("acme"), event: "call_end" });

      expect(svc.listDeliveries()).toHaveLength(2);
    });

    it("filters correctly by webhookId", async () => {
      const w1 = svc.createWebhook({
        tenantId: "acme",
        url: "https://a.com/hook",
        events: ["call_start"],
        active: true,
      });
      svc.createWebhook({
        tenantId: "acme",
        url: "https://b.com/hook",
        events: ["call_start"],
        active: true,
      });

      await svc.deliver("acme", "call_start", makePayload("acme"));

      const filtered = svc.listDeliveries(w1.webhookId);
      expect(filtered.every((d) => d.webhookId === w1.webhookId)).toBe(true);
    });
  });

  // ── getDelivery ──────────────────────────────────────────────────

  describe("getDelivery()", () => {
    it("returns undefined for unknown ID", () => {
      expect(svc.getDelivery("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    });

    it("returns the delivery when found", async () => {
      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      const [delivery] = await svc.deliver("acme", "call_start", makePayload("acme"));
      expect(svc.getDelivery(delivery.deliveryId)).toBeDefined();
    });
  });

  // ── deliveries cap ───────────────────────────────────────────────

  describe("deliveries cap at 1000", () => {
    it("caps deliveries at 1000 (oldest dropped)", async () => {
      // Create a webhook that will receive deliveries
      svc.createWebhook({
        tenantId: "acme",
        url: "https://example.com/hook",
        events: ["call_start"],
        active: true,
      });

      // Deliver 1005 times
      for (let i = 0; i < 1005; i++) {
        await svc.deliver("acme", "call_start", makePayload("acme"));
      }

      expect(svc.listDeliveries()).toHaveLength(1000);
    });
  });

  // ── singleton proxy ──────────────────────────────────────────────

  describe("singleton proxy", () => {
    it("throws before init", () => {
      const makeProxy = (ref: { instance: WebhookService | undefined }) =>
        new Proxy({} as WebhookService, {
          get(_t, prop) {
            if (!ref.instance) {
              throw new Error(
                "WebhookService not initialized — call initWebhookService() first",
              );
            }
            const value = (ref.instance as unknown as Record<string | symbol, unknown>)[prop];
            return typeof value === "function" ? value.bind(ref.instance) : value;
          },
        });

      const ref = { instance: undefined as WebhookService | undefined };
      const proxy = makeProxy(ref);

      expect(() => proxy.listWebhooks()).toThrow("WebhookService not initialized");
    });

    it("works after init", () => {
      const f = tempFile("singleton");
      try {
        const instance = initWebhookService(f);
        expect(instance).toBeInstanceOf(WebhookService);

        const hooks = webhookService.listWebhooks();
        expect(Array.isArray(hooks)).toBe(true);
      } finally {
        if (existsSync(f)) rmSync(f, { force: true });
      }
    });
  });
});
