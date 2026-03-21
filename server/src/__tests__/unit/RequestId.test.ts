/**
 * RequestId Middleware Tests (N-37)
 *
 * Verifies that requestIdMiddleware correctly generates, propagates, and
 * validates X-Request-ID correlation identifiers.
 */

import { requestIdMiddleware } from "../../middleware/requestId.js";
import type { Request, Response, NextFunction } from "express";

function makeReq(headers: Record<string, string | string[] | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): { setHeader: jest.Mock; header: Record<string, string> } {
  const res = {
    setHeader: jest.fn(function (this: { header: Record<string, string> }, name: string, value: string) {
      this.header[name] = value;
    }),
    header: {} as Record<string, string>,
  };
  return res;
}

// ── UUID v4 pattern ───────────────────────────────────────────────────────
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("requestIdMiddleware", () => {
  describe("generation — no inbound header", () => {
    it("generates a UUID v4 when X-Request-ID header is absent", () => {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();
      requestIdMiddleware(req, res as unknown as Response, next as NextFunction);
      expect(req.requestId).toMatch(UUID_V4);
    });

    it("generates a unique ID on each call", () => {
      const req1 = makeReq();
      const req2 = makeReq();
      const res = makeRes();
      requestIdMiddleware(req1, res as unknown as Response, jest.fn());
      requestIdMiddleware(req2, makeRes() as unknown as Response, jest.fn());
      expect(req1.requestId).not.toBe(req2.requestId);
    });

    it("calls next()", () => {
      const next = jest.fn();
      requestIdMiddleware(makeReq(), makeRes() as unknown as Response, next as NextFunction);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("sets X-Request-ID response header to the generated ID", () => {
      const req = makeReq();
      const res = makeRes();
      requestIdMiddleware(req, res as unknown as Response, jest.fn());
      expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
    });
  });

  describe("propagation — valid inbound header", () => {
    it("uses client-supplied X-Request-ID when valid", () => {
      const req = makeReq({ "x-request-id": "my-trace-abc-123" });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toBe("my-trace-abc-123");
    });

    it("echoes client ID in response header", () => {
      const req = makeReq({ "x-request-id": "echo-me" });
      const res = makeRes();
      requestIdMiddleware(req, res as unknown as Response, jest.fn());
      expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", "echo-me");
    });

    it("accepts UUID-formatted client IDs", () => {
      const id = "550e8400-e29b-41d4-a716-446655440000";
      const req = makeReq({ "x-request-id": id });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toBe(id);
    });

    it("accepts alphanumeric IDs with dots and underscores", () => {
      const id = "svc1_req.001";
      const req = makeReq({ "x-request-id": id });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toBe(id);
    });
  });

  describe("validation — rejects unsafe inbound headers", () => {
    it("generates new ID when client ID is empty string", () => {
      const req = makeReq({ "x-request-id": "" });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toMatch(UUID_V4);
    });

    it("generates new ID when client ID exceeds 128 chars", () => {
      const req = makeReq({ "x-request-id": "a".repeat(129) });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toMatch(UUID_V4);
    });

    it("generates new ID when client ID contains spaces (log injection attempt)", () => {
      const req = makeReq({ "x-request-id": "bad id here" });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toMatch(UUID_V4);
    });

    it("generates new ID when client ID contains newline (log injection attempt)", () => {
      const req = makeReq({ "x-request-id": "id\ninjected-header: x" });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toMatch(UUID_V4);
    });

    it("generates new ID when client ID contains semicolons", () => {
      const req = makeReq({ "x-request-id": "id;drop-table" });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toMatch(UUID_V4);
    });

    it("accepts exactly 128-char ID (boundary)", () => {
      const id = "a".repeat(128);
      const req = makeReq({ "x-request-id": id });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toBe(id);
    });

    it("generates new ID when header is an array (multi-value attack)", () => {
      const req = makeReq({ "x-request-id": ["id1", "id2"] });
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(req.requestId).toMatch(UUID_V4);
    });
  });

  describe("req.requestId attachment", () => {
    it("attaches requestId to req object", () => {
      const req = makeReq();
      requestIdMiddleware(req, makeRes() as unknown as Response, jest.fn());
      expect(typeof req.requestId).toBe("string");
      expect(req.requestId.length).toBeGreaterThan(0);
    });

    it("propagated ID matches response header", () => {
      const req = makeReq({ "x-request-id": "match-me" });
      const res = makeRes();
      requestIdMiddleware(req, res as unknown as Response, jest.fn());
      expect(res.header["X-Request-ID"]).toBe(req.requestId);
    });
  });
});
