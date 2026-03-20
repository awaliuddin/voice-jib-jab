/**
 * KB Search API Tests
 *
 * Tests the /kb-search router produced by createKbSearchRouter().
 * LiveKbSearchService is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 * Follows the same pattern as abtests-api.test.ts.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createKbSearchRouter } from "../../api/kbSearch.js";
import type { KbSearchResponse } from "../../services/LiveKbSearchService.js";

// ── Mock LiveKbSearchService ──────────────────────────────────────────

const mockSvc = {
  search: jest.fn(),
  extractSearchTerms: jest.fn(),
};

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
  app.use("/kb-search", createKbSearchRouter(mockSvc as never));
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────

const SEARCH_RESPONSE: KbSearchResponse = {
  query: "billing invoice",
  tenantId: "org-acme",
  results: [
    {
      entryId: "entry-001",
      title: "How do I view my billing invoice?",
      excerpt: "Go to Settings > Billing to download your invoice.",
      score: 0.8,
    },
  ],
  searchedAt: "2026-03-19T10:00:00.000Z",
  durationMs: 3,
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("KB Search API", () => {
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

  // ── POST /kb-search ───────────────────────────────────────────────

  describe("POST /kb-search", () => {
    it("returns 200 with search results", async () => {
      mockSvc.search.mockResolvedValue(SEARCH_RESPONSE);

      const res = await httpRequest(server, "POST", "/kb-search", {
        query: "billing invoice",
        tenantId: "org-acme",
      });

      expect(res.status).toBe(200);
    });

    it("response has query, tenantId, results, searchedAt, durationMs", async () => {
      mockSvc.search.mockResolvedValue(SEARCH_RESPONSE);

      const res = await httpRequest(server, "POST", "/kb-search", {
        query: "billing invoice",
        tenantId: "org-acme",
      });

      const data = res.json() as KbSearchResponse;
      expect(data.query).toBe("billing invoice");
      expect(data.tenantId).toBe("org-acme");
      expect(Array.isArray(data.results)).toBe(true);
      expect(typeof data.searchedAt).toBe("string");
      expect(typeof data.durationMs).toBe("number");
    });

    it("returns 400 for missing query", async () => {
      const res = await httpRequest(server, "POST", "/kb-search", {
        tenantId: "org-acme",
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for empty query", async () => {
      const res = await httpRequest(server, "POST", "/kb-search", {
        query: "   ",
        tenantId: "org-acme",
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing tenantId", async () => {
      const res = await httpRequest(server, "POST", "/kb-search", {
        query: "billing",
      });

      expect(res.status).toBe(400);
    });

    it("passes query param to service.search()", async () => {
      mockSvc.search.mockResolvedValue(SEARCH_RESPONSE);

      await httpRequest(server, "POST", "/kb-search", {
        query: "password reset",
        tenantId: "org-acme",
      });

      expect(mockSvc.search).toHaveBeenCalledWith("password reset", expect.any(String));
    });

    it("passes tenantId param to service.search()", async () => {
      mockSvc.search.mockResolvedValue(SEARCH_RESPONSE);

      await httpRequest(server, "POST", "/kb-search", {
        query: "billing",
        tenantId: "org-xyz",
      });

      expect(mockSvc.search).toHaveBeenCalledWith(expect.any(String), "org-xyz");
    });
  });

  // ── GET /kb-search/suggest ────────────────────────────────────────

  describe("GET /kb-search/suggest", () => {
    it("returns 200 with results", async () => {
      mockSvc.extractSearchTerms.mockReturnValue("billing invoice");
      mockSvc.search.mockResolvedValue(SEARCH_RESPONSE);

      const res = await httpRequest(
        server,
        "GET",
        "/kb-search/suggest?text=My+billing+invoice+is+missing&tenantId=org-acme",
      );

      expect(res.status).toBe(200);
    });

    it("calls extractSearchTerms then search", async () => {
      mockSvc.extractSearchTerms.mockReturnValue("billing invoice");
      mockSvc.search.mockResolvedValue(SEARCH_RESPONSE);

      await httpRequest(
        server,
        "GET",
        "/kb-search/suggest?text=My+billing+invoice+is+missing&tenantId=org-acme",
      );

      expect(mockSvc.extractSearchTerms).toHaveBeenCalledWith("My billing invoice is missing");
      expect(mockSvc.search).toHaveBeenCalledWith("billing invoice", "org-acme");
    });

    it("returns 400 for missing text", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/kb-search/suggest?tenantId=org-acme",
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 for empty text", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/kb-search/suggest?text=&tenantId=org-acme",
      );

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing tenantId", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/kb-search/suggest?text=billing+invoice",
      );

      expect(res.status).toBe(400);
    });

    it("response has results array", async () => {
      mockSvc.extractSearchTerms.mockReturnValue("billing");
      mockSvc.search.mockResolvedValue(SEARCH_RESPONSE);

      const res = await httpRequest(
        server,
        "GET",
        "/kb-search/suggest?text=billing+help&tenantId=org-acme",
      );

      const data = res.json() as KbSearchResponse;
      expect(Array.isArray(data.results)).toBe(true);
    });
  });
});
