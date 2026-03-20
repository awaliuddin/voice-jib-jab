/**
 * Agent Versions API Unit Tests
 *
 * Tests the /agent-versions router produced by createAgentVersionsRouter().
 * AgentVersionStore is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createAgentVersionsRouter } from "../../api/agentVersions.js";

// ── Mock AgentVersionStore ────────────────────────────────────────────

const mockStore = {
  createVersion: jest.fn(),
  getVersion: jest.fn(),
  listVersions: jest.fn(),
  markStable: jest.fn(),
  deleteVersion: jest.fn(),
  deploy: jest.fn(),
  getDeployment: jest.fn(),
  listDeployments: jest.fn(),
  setCanary: jest.fn(),
  clearCanary: jest.fn(),
  rollback: jest.fn(),
  resolveVersion: jest.fn(),
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

// ── Test app ──────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/agent-versions", createAgentVersionsRouter(mockStore as never));
  return app;
}

// ── Fixture data ──────────────────────────────────────────────────────

const BASE_CONFIG = { systemPrompt: "You are helpful.", voiceId: "af_bella" };

const VERSION_1 = {
  versionId: "ver-001",
  agentId: "agent-1",
  versionNumber: 1,
  label: "v1.0.0",
  config: BASE_CONFIG,
  createdAt: "2026-01-01T00:00:00.000Z",
  isStable: false,
};

const VERSION_2 = {
  ...VERSION_1,
  versionId: "ver-002",
  versionNumber: 2,
  label: "v1.1.0",
  isStable: false,
};

const DEPLOYMENT_1 = {
  deploymentId: "dep-001",
  tenantId: "tenant-1",
  agentId: "agent-1",
  activeVersionId: "ver-001",
  canaryVersionId: undefined as string | undefined,
  canaryPercent: 0,
  deployedAt: "2026-01-01T00:00:00.000Z",
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("Agent Versions API", () => {
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

  // ── GET /agent-versions ─────────────────────────────────────────────

  describe("GET /agent-versions", () => {
    it("returns 200 with versions array when agentId is provided", async () => {
      mockStore.listVersions.mockReturnValue([VERSION_1]);

      const res = await httpRequest(server, "GET", "/agent-versions?agentId=agent-1");

      expect(res.status).toBe(200);
      const body = res.json() as { versions: unknown[] };
      expect(Array.isArray(body.versions)).toBe(true);
      expect(body.versions).toHaveLength(1);
    });

    it("returns 400 when agentId query param is missing", async () => {
      const res = await httpRequest(server, "GET", "/agent-versions");

      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBeDefined();
    });

    it("returns empty array when listVersions returns empty", async () => {
      mockStore.listVersions.mockReturnValue([]);

      const res = await httpRequest(server, "GET", "/agent-versions?agentId=nonexistent");

      expect(res.status).toBe(200);
      const body = res.json() as { versions: unknown[] };
      expect(body.versions).toEqual([]);
    });
  });

  // ── POST /agent-versions ────────────────────────────────────────────

  describe("POST /agent-versions", () => {
    it("returns 201 with the created version", async () => {
      mockStore.createVersion.mockReturnValue(VERSION_1);

      const res = await httpRequest(server, "POST", "/agent-versions", {
        agentId: "agent-1",
        label: "v1.0.0",
        config: BASE_CONFIG,
      });

      expect(res.status).toBe(201);
      const body = res.json() as typeof VERSION_1;
      expect(body.versionId).toBe("ver-001");
    });

    it("returns 400 when agentId is missing", async () => {
      const res = await httpRequest(server, "POST", "/agent-versions", {
        label: "v1.0.0",
        config: BASE_CONFIG,
      });

      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/agentId/);
    });

    it("returns 400 when label is missing", async () => {
      const res = await httpRequest(server, "POST", "/agent-versions", {
        agentId: "agent-1",
        config: BASE_CONFIG,
      });

      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/label/);
    });

    it("returns 400 when config is missing", async () => {
      const res = await httpRequest(server, "POST", "/agent-versions", {
        agentId: "agent-1",
        label: "v1.0.0",
      });

      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/config/);
    });
  });

  // ── GET /agent-versions/deployments ─────────────────────────────────
  // Registered BEFORE /:versionId — must not be treated as an ID

  describe("GET /agent-versions/deployments", () => {
    it("returns 200 with deployments array", async () => {
      mockStore.listDeployments.mockReturnValue([DEPLOYMENT_1]);

      const res = await httpRequest(server, "GET", "/agent-versions/deployments");

      expect(res.status).toBe(200);
      const body = res.json() as { deployments: unknown[] };
      expect(Array.isArray(body.deployments)).toBe(true);
      expect(body.deployments).toHaveLength(1);
    });

    it("passes tenantId filter when query param provided", async () => {
      mockStore.listDeployments.mockReturnValue([DEPLOYMENT_1]);

      const res = await httpRequest(
        server,
        "GET",
        "/agent-versions/deployments?tenantId=tenant-1",
      );

      expect(res.status).toBe(200);
      expect(mockStore.listDeployments).toHaveBeenCalledWith("tenant-1");
    });
  });

  // ── POST /agent-versions/deployments ────────────────────────────────

  describe("POST /agent-versions/deployments", () => {
    it("returns 201 with TenantDeployment", async () => {
      mockStore.deploy.mockReturnValue(DEPLOYMENT_1);

      const res = await httpRequest(server, "POST", "/agent-versions/deployments", {
        tenantId: "tenant-1",
        agentId: "agent-1",
        versionId: "ver-001",
      });

      expect(res.status).toBe(201);
      const body = res.json() as typeof DEPLOYMENT_1;
      expect(body.tenantId).toBe("tenant-1");
    });

    it("returns 404 when store.deploy throws (versionId not found)", async () => {
      mockStore.deploy.mockImplementation(() => {
        throw new Error("Version not found: ver-999");
      });

      const res = await httpRequest(server, "POST", "/agent-versions/deployments", {
        tenantId: "tenant-1",
        agentId: "agent-1",
        versionId: "ver-999",
      });

      expect(res.status).toBe(404);
    });
  });

  // ── POST /agent-versions/deployments/canary ─────────────────────────

  describe("POST /agent-versions/deployments/canary", () => {
    it("returns 200 with updated TenantDeployment", async () => {
      const withCanary = { ...DEPLOYMENT_1, canaryVersionId: "ver-002", canaryPercent: 10 };
      mockStore.setCanary.mockReturnValue(withCanary);

      const res = await httpRequest(
        server,
        "POST",
        "/agent-versions/deployments/canary",
        {
          tenantId: "tenant-1",
          agentId: "agent-1",
          canaryVersionId: "ver-002",
          canaryPercent: 10,
        },
      );

      expect(res.status).toBe(200);
      const body = res.json() as typeof withCanary;
      expect(body.canaryVersionId).toBe("ver-002");
      expect(body.canaryPercent).toBe(10);
    });

    it("returns 400 when canaryPercent is out of range (store throws)", async () => {
      mockStore.setCanary.mockImplementation(() => {
        throw new Error("canaryPercent must be an integer between 1 and 100");
      });

      const res = await httpRequest(
        server,
        "POST",
        "/agent-versions/deployments/canary",
        {
          tenantId: "tenant-1",
          agentId: "agent-1",
          canaryVersionId: "ver-002",
          canaryPercent: 0,
        },
      );

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /agent-versions/deployments/canary ───────────────────────

  describe("DELETE /agent-versions/deployments/canary", () => {
    it("returns 200 with deployment after clearing canary", async () => {
      const cleared = { ...DEPLOYMENT_1, canaryVersionId: undefined, canaryPercent: 0 };
      mockStore.clearCanary.mockReturnValue(cleared);

      const res = await httpRequest(
        server,
        "DELETE",
        "/agent-versions/deployments/canary",
        { tenantId: "tenant-1", agentId: "agent-1" },
      );

      expect(res.status).toBe(200);
      const body = res.json() as typeof cleared;
      expect(body.canaryPercent).toBe(0);
    });

    it("returns 404 when no deployment exists (clearCanary returns undefined)", async () => {
      mockStore.clearCanary.mockReturnValue(undefined);

      const res = await httpRequest(
        server,
        "DELETE",
        "/agent-versions/deployments/canary",
        { tenantId: "ghost-tenant", agentId: "ghost-agent" },
      );

      expect(res.status).toBe(404);
    });
  });

  // ── POST /agent-versions/deployments/rollback ───────────────────────

  describe("POST /agent-versions/deployments/rollback", () => {
    it("returns 200 with updated deployment after rollback", async () => {
      const rolledBack = { ...DEPLOYMENT_1, activeVersionId: "ver-001" };
      mockStore.rollback.mockReturnValue(rolledBack);

      const res = await httpRequest(
        server,
        "POST",
        "/agent-versions/deployments/rollback",
        { tenantId: "tenant-1", agentId: "agent-1" },
      );

      expect(res.status).toBe(200);
      const body = res.json() as typeof rolledBack;
      expect(body.activeVersionId).toBe("ver-001");
    });

    it("returns 400 when no previous version exists (store throws)", async () => {
      mockStore.rollback.mockImplementation(() => {
        throw new Error("No previous version exists");
      });

      const res = await httpRequest(
        server,
        "POST",
        "/agent-versions/deployments/rollback",
        { tenantId: "tenant-1", agentId: "agent-1" },
      );

      expect(res.status).toBe(400);
    });
  });

  // ── POST /agent-versions/resolve ────────────────────────────────────

  describe("POST /agent-versions/resolve", () => {
    it("returns 200 with VersionRoutingResult", async () => {
      const routingResult = {
        versionId: "ver-001",
        isCanary: false,
        config: BASE_CONFIG,
      };
      mockStore.resolveVersion.mockReturnValue(routingResult);

      const res = await httpRequest(server, "POST", "/agent-versions/resolve", {
        tenantId: "tenant-1",
        agentId: "agent-1",
        sessionId: "session-xyz",
      });

      expect(res.status).toBe(200);
      const body = res.json() as typeof routingResult;
      expect(body.versionId).toBe("ver-001");
      expect(body.isCanary).toBe(false);
      expect(body.config).toBeDefined();
    });

    it("returns 404 when no deployment exists (resolveVersion returns undefined)", async () => {
      mockStore.resolveVersion.mockReturnValue(undefined);

      const res = await httpRequest(server, "POST", "/agent-versions/resolve", {
        tenantId: "ghost-tenant",
        agentId: "ghost-agent",
        sessionId: "session-xyz",
      });

      expect(res.status).toBe(404);
    });
  });

  // ── GET /agent-versions/:versionId ──────────────────────────────────

  describe("GET /agent-versions/:versionId", () => {
    it("returns 200 with the version when found", async () => {
      mockStore.getVersion.mockReturnValue(VERSION_1);

      const res = await httpRequest(server, "GET", `/agent-versions/${VERSION_1.versionId}`);

      expect(res.status).toBe(200);
      const body = res.json() as typeof VERSION_1;
      expect(body.versionId).toBe("ver-001");
    });

    it("returns 404 when versionId is not found", async () => {
      mockStore.getVersion.mockReturnValue(undefined);

      const res = await httpRequest(
        server,
        "GET",
        "/agent-versions/00000000-0000-0000-0000-000000000000",
      );

      expect(res.status).toBe(404);
    });
  });

  // ── POST /agent-versions/:versionId/mark-stable ─────────────────────

  describe("POST /agent-versions/:versionId/mark-stable", () => {
    it("returns 200 with updated version (isStable=true)", async () => {
      const stable = { ...VERSION_1, isStable: true };
      mockStore.markStable.mockReturnValue(stable);

      const res = await httpRequest(
        server,
        "POST",
        `/agent-versions/${VERSION_1.versionId}/mark-stable`,
      );

      expect(res.status).toBe(200);
      const body = res.json() as typeof stable;
      expect(body.isStable).toBe(true);
    });

    it("returns 404 when versionId is not found", async () => {
      mockStore.markStable.mockReturnValue(undefined);

      const res = await httpRequest(
        server,
        "POST",
        "/agent-versions/00000000-0000-0000-0000-000000000000/mark-stable",
      );

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /agent-versions/:versionId ───────────────────────────────

  describe("DELETE /agent-versions/:versionId", () => {
    it("returns 204 on successful delete", async () => {
      mockStore.getVersion.mockReturnValue(VERSION_1);
      mockStore.deleteVersion.mockReturnValue(true);

      const res = await httpRequest(
        server,
        "DELETE",
        `/agent-versions/${VERSION_1.versionId}`,
      );

      expect(res.status).toBe(204);
    });

    it("returns 404 when versionId does not exist", async () => {
      mockStore.getVersion.mockReturnValue(undefined);

      const res = await httpRequest(
        server,
        "DELETE",
        "/agent-versions/00000000-0000-0000-0000-000000000000",
      );

      expect(res.status).toBe(404);
    });

    it("returns 409 when version is deployed (deleteVersion returns false)", async () => {
      mockStore.getVersion.mockReturnValue(VERSION_2);
      mockStore.deleteVersion.mockReturnValue(false);

      const res = await httpRequest(
        server,
        "DELETE",
        `/agent-versions/${VERSION_2.versionId}`,
      );

      expect(res.status).toBe(409);
    });
  });
});
