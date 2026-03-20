/**
 * Onboarding API Tests
 *
 * Tests for the /onboarding router produced by createOnboardingRouter().
 * OnboardingWizardService is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createOnboardingRouter } from "../../api/onboarding.js";

// ── Mock OnboardingWizardService ──────────────────────────────────────

const mockSvc = {
  createSession: jest.fn(),
  getSession: jest.fn(),
  getSessionByTenant: jest.fn(),
  listSessions: jest.fn(),
  completeStep: jest.fn(),
  skipStep: jest.fn(),
  goBack: jest.fn(),
  resetSession: jest.fn(),
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
  app.use("/onboarding", createOnboardingRouter(mockSvc as never));
  return app;
}

// ── Fixture data ──────────────────────────────────────────────────────

const FIXTURE_SESSION = {
  sessionId: "sess-001",
  tenantId: "org_acme",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  currentStep: "tenant_registration",
  steps: [
    { step: "tenant_registration", status: "pending" },
    { step: "voice_configuration", status: "pending" },
    { step: "claims_registry", status: "pending" },
    { step: "policy_rules", status: "pending" },
    { step: "test_call", status: "pending" },
  ],
  complete: false,
};

const ADVANCED_SESSION = {
  ...FIXTURE_SESSION,
  currentStep: "voice_configuration",
  steps: [
    { step: "tenant_registration", status: "complete", completedAt: "2026-03-01T10:01:00.000Z" },
    { step: "voice_configuration", status: "pending" },
    { step: "claims_registry", status: "pending" },
    { step: "policy_rules", status: "pending" },
    { step: "test_call", status: "pending" },
  ],
  updatedAt: "2026-03-01T10:01:00.000Z",
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("Onboarding API", () => {
  let app: Express;
  let server: Server;

  beforeAll((done) => {
    app = buildApp();
    server = createServer(app);
    server.listen(0, "127.0.0.1", done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── POST /onboarding/sessions ─────────────────────────────────────

  describe("POST /onboarding/sessions", () => {
    it("returns 201 with an OnboardingSession on success", async () => {
      mockSvc.getSessionByTenant.mockReturnValue(undefined);
      mockSvc.createSession.mockReturnValue(FIXTURE_SESSION);

      const res = await httpRequest(server, "POST", "/onboarding/sessions", {
        tenantId: "org_acme",
      });

      expect(res.status).toBe(201);
      const body = res.json() as typeof FIXTURE_SESSION;
      expect(body.sessionId).toBe("sess-001");
      expect(body.tenantId).toBe("org_acme");
    });

    it("returns 400 when tenantId is missing", async () => {
      const res = await httpRequest(server, "POST", "/onboarding/sessions", {});

      expect(res.status).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toMatch(/tenantId/);
    });

    it("returns 400 when tenantId is empty string", async () => {
      const res = await httpRequest(server, "POST", "/onboarding/sessions", {
        tenantId: "",
      });

      expect(res.status).toBe(400);
    });

    it("returns 409 with existing session when tenantId already has a session", async () => {
      mockSvc.getSessionByTenant.mockReturnValue(FIXTURE_SESSION);

      const res = await httpRequest(server, "POST", "/onboarding/sessions", {
        tenantId: "org_acme",
      });

      expect(res.status).toBe(409);
      const body = res.json() as typeof FIXTURE_SESSION;
      expect(body.sessionId).toBe("sess-001");
    });
  });

  // ── GET /onboarding/sessions/:sessionId ───────────────────────────

  describe("GET /onboarding/sessions/:sessionId", () => {
    it("returns 200 with the session", async () => {
      mockSvc.getSession.mockReturnValue(FIXTURE_SESSION);

      const res = await httpRequest(server, "GET", "/onboarding/sessions/sess-001");

      expect(res.status).toBe(200);
      const body = res.json() as typeof FIXTURE_SESSION;
      expect(body.sessionId).toBe("sess-001");
    });

    it("returns 404 for an unknown session ID", async () => {
      mockSvc.getSession.mockReturnValue(undefined);

      const res = await httpRequest(server, "GET", "/onboarding/sessions/no-such-id");

      expect(res.status).toBe(404);
    });
  });

  // ── GET /onboarding/tenants/:tenantId ─────────────────────────────

  describe("GET /onboarding/tenants/:tenantId", () => {
    it("returns 200 with the session for the tenant", async () => {
      mockSvc.getSessionByTenant.mockReturnValue(FIXTURE_SESSION);

      const res = await httpRequest(server, "GET", "/onboarding/tenants/org_acme");

      expect(res.status).toBe(200);
      const body = res.json() as typeof FIXTURE_SESSION;
      expect(body.tenantId).toBe("org_acme");
    });

    it("returns 404 when no session exists for the tenant", async () => {
      mockSvc.getSessionByTenant.mockReturnValue(undefined);

      const res = await httpRequest(server, "GET", "/onboarding/tenants/org_ghost");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /onboarding/sessions/:sessionId/complete-step ────────────

  describe("POST /onboarding/sessions/:sessionId/complete-step", () => {
    it("returns 200 with the updated session on success", async () => {
      mockSvc.getSession.mockReturnValue(FIXTURE_SESSION);
      mockSvc.completeStep.mockReturnValue(ADVANCED_SESSION);

      const res = await httpRequest(
        server,
        "POST",
        "/onboarding/sessions/sess-001/complete-step",
        { tenantName: "Acme Corp" },
      );

      expect(res.status).toBe(200);
      const body = res.json() as typeof ADVANCED_SESSION;
      expect(body.currentStep).toBe("voice_configuration");
    });

    it("returns 400 with validationErrors when validation fails", async () => {
      mockSvc.getSession.mockReturnValue(FIXTURE_SESSION);

      const validationError = new Error("Validation failed") as Error & {
        validationErrors: string[];
      };
      validationError.validationErrors = ["tenantName is required and must be a non-empty string"];
      mockSvc.completeStep.mockImplementation(() => {
        throw validationError;
      });

      const res = await httpRequest(
        server,
        "POST",
        "/onboarding/sessions/sess-001/complete-step",
        {},
      );

      expect(res.status).toBe(400);
      const body = res.json() as { validationErrors: string[] };
      expect(body.validationErrors).toBeDefined();
      expect(body.validationErrors.length).toBeGreaterThan(0);
    });

    it("returns 404 when session is not found", async () => {
      mockSvc.getSession.mockReturnValue(undefined);

      const res = await httpRequest(
        server,
        "POST",
        "/onboarding/sessions/no-such/complete-step",
        { tenantName: "X" },
      );

      expect(res.status).toBe(404);
    });
  });

  // ── POST /onboarding/sessions/:sessionId/skip ─────────────────────

  describe("POST /onboarding/sessions/:sessionId/skip", () => {
    it("returns 200 with the updated session", async () => {
      mockSvc.getSession.mockReturnValue(FIXTURE_SESSION);
      mockSvc.skipStep.mockReturnValue(ADVANCED_SESSION);

      const res = await httpRequest(server, "POST", "/onboarding/sessions/sess-001/skip");

      expect(res.status).toBe(200);
    });

    it("returns 404 when session not found", async () => {
      mockSvc.getSession.mockReturnValue(undefined);

      const res = await httpRequest(server, "POST", "/onboarding/sessions/no-such/skip");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /onboarding/sessions/:sessionId/back ─────────────────────

  describe("POST /onboarding/sessions/:sessionId/back", () => {
    it("returns 200 with the updated session", async () => {
      mockSvc.getSession.mockReturnValue(ADVANCED_SESSION);
      mockSvc.goBack.mockReturnValue(FIXTURE_SESSION);

      const res = await httpRequest(server, "POST", "/onboarding/sessions/sess-001/back");

      expect(res.status).toBe(200);
      const body = res.json() as typeof FIXTURE_SESSION;
      expect(body.currentStep).toBe("tenant_registration");
    });

    it("returns 404 when session not found", async () => {
      mockSvc.getSession.mockReturnValue(undefined);

      const res = await httpRequest(server, "POST", "/onboarding/sessions/no-such/back");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /onboarding/sessions/:sessionId/reset ────────────────────

  describe("POST /onboarding/sessions/:sessionId/reset", () => {
    it("returns 200 with the reset session", async () => {
      mockSvc.getSession.mockReturnValue(ADVANCED_SESSION);
      mockSvc.resetSession.mockReturnValue(FIXTURE_SESSION);

      const res = await httpRequest(server, "POST", "/onboarding/sessions/sess-001/reset");

      expect(res.status).toBe(200);
      const body = res.json() as typeof FIXTURE_SESSION;
      expect(body.currentStep).toBe("tenant_registration");
    });

    it("returns 404 when session not found", async () => {
      mockSvc.getSession.mockReturnValue(undefined);

      const res = await httpRequest(server, "POST", "/onboarding/sessions/no-such/reset");

      expect(res.status).toBe(404);
    });
  });

  // ── GET /onboarding/wizard ─────────────────────────────────────────

  describe("GET /onboarding/wizard", () => {
    it("returns 200 with HTML content-type", async () => {
      const res = await httpRequest(server, "GET", "/onboarding/wizard");

      expect(res.status).toBe(200);
      const contentType = res.headers["content-type"] as string;
      expect(contentType).toMatch(/text\/html/);
    });

    it("returns HTML body containing the wizard", async () => {
      const res = await httpRequest(server, "GET", "/onboarding/wizard");

      expect(res.body).toMatch(/<!DOCTYPE html/i);
    });
  });
});
