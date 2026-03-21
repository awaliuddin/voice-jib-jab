/**
 * JSON 404 Handler Tests (N-46)
 *
 * Verifies that any request reaching the catch-all middleware receives a
 * structured JSON 404 instead of Express's default HTML "Cannot GET /" page.
 */

import express from "express";
import { createServer, type Server } from "http";
import http from "http";
import { jsonErrorHandler } from "../../middleware/errorHandler.js";

function makeApp(): express.Express {
  const app = express();

  // A known route to confirm normal routes still work
  app.get("/known", (_req, res) => res.json({ ok: true }));

  // N-46: catch-all 404 — same placement as in index.ts
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(jsonErrorHandler);
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

function request(
  server: Server,
  method: string,
  path: string,
): Promise<{ status: number; body: Record<string, unknown>; contentType: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Not listening"));
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(raw) as Record<string, unknown>,
            contentType: (res.headers["content-type"] as string) ?? "",
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("JSON 404 handler (N-46)", () => {
  let server: Server;

  beforeAll(async () => { server = await startServer(makeApp()); });
  afterAll(async () => stopServer(server));

  it("returns HTTP 404 for an unknown GET route", async () => {
    const { status } = await request(server, "GET", "/unknown-path");
    expect(status).toBe(404);
  });

  it("returns JSON body with 'error' key", async () => {
    const { body } = await request(server, "GET", "/unknown-path");
    expect(body.error).toBe("Not found");
  });

  it("returns application/json content-type", async () => {
    const { contentType } = await request(server, "GET", "/unknown-path");
    expect(contentType).toContain("application/json");
  });

  it("returns 404 for unknown POST route", async () => {
    const { status } = await request(server, "POST", "/does-not-exist");
    expect(status).toBe(404);
  });

  it("returns 404 for deeply nested unknown path", async () => {
    const { status } = await request(server, "GET", "/a/b/c/d/e");
    expect(status).toBe(404);
  });

  it("does NOT return HTML (no '<html>' in body)", async () => {
    const { body } = await request(server, "GET", "/unknown-path");
    expect(JSON.stringify(body)).not.toContain("<html>");
  });

  it("known route still returns 200", async () => {
    const { status } = await request(server, "GET", "/known");
    expect(status).toBe(200);
  });
});
