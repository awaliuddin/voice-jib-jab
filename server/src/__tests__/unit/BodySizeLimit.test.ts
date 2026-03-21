/**
 * Request Body Size Limit Tests (N-44)
 *
 * Verifies that the 256 KB JSON body size limit returns HTTP 413 for oversized
 * payloads and processes normal payloads correctly.
 *
 * Uses a minimal Express app with express.json({ limit: "256kb" }) — the same
 * configuration applied in index.ts — to keep tests isolated from server startup.
 */

import express from "express";
import { createServer, type Server } from "http";
import http from "http";

const LIMIT = "256kb";
const LIMIT_BYTES = 256 * 1024; // 262,144 bytes

function makeApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: LIMIT }));
  app.post("/echo", (req, res) => {
    res.json({ received: true, keys: Object.keys(req.body as object).length });
  });
  return app;
}

function startServer(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

interface RawResponse {
  status: number;
  body: string;
}

function post(server: Server, payload: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Not listening"));
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path: "/echo",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("Request body size limit (N-44)", () => {
  let server: Server;

  beforeAll(async () => {
    server = await startServer(makeApp());
  });

  afterAll(async () => stopServer(server));

  it("accepts a small JSON body (well under 256 KB)", async () => {
    const payload = JSON.stringify({ message: "hello" });
    const { status } = await post(server, payload);
    expect(status).toBe(200);
  });

  it("accepts a body just under the 256 KB limit", async () => {
    // Build a body that serialises to just under 256 KB
    const value = "x".repeat(LIMIT_BYTES - 30);
    const payload = JSON.stringify({ data: value });
    expect(Buffer.byteLength(payload)).toBeLessThan(LIMIT_BYTES);
    const { status } = await post(server, payload);
    expect(status).toBe(200);
  });

  it("rejects a body over 256 KB with HTTP 413", async () => {
    const value = "x".repeat(LIMIT_BYTES + 100);
    const payload = JSON.stringify({ data: value });
    expect(Buffer.byteLength(payload)).toBeGreaterThan(LIMIT_BYTES);
    const { status } = await post(server, payload);
    expect(status).toBe(413);
  });

  it("rejects a significantly oversized body (1 MB) with HTTP 413", async () => {
    const value = "x".repeat(1024 * 1024);
    const payload = JSON.stringify({ data: value });
    const { status } = await post(server, payload);
    expect(status).toBe(413);
  });

  it("returns a non-empty response body on 413", async () => {
    const value = "x".repeat(LIMIT_BYTES + 100);
    const payload = JSON.stringify({ data: value });
    const { status, body } = await post(server, payload);
    expect(status).toBe(413);
    expect(body.length).toBeGreaterThan(0);
  });

  it("processes a valid body after a rejected oversized one (no state corruption)", async () => {
    // First, send oversized body to trigger 413
    const big = JSON.stringify({ data: "x".repeat(LIMIT_BYTES + 100) });
    const { status: s1 } = await post(server, big);
    expect(s1).toBe(413);

    // Then, send a normal body — should succeed
    const small = JSON.stringify({ ok: true });
    const { status: s2 } = await post(server, small);
    expect(s2).toBe(200);
  });

  it("empty body is accepted (0 bytes)", async () => {
    const payload = "{}";
    const { status } = await post(server, payload);
    expect(status).toBe(200);
  });
});
