/**
 * Skills API Tests
 *
 * Tests the /skills router produced by createSkillsRouter().
 * SkillStore is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createSkillsRouter } from "../../api/skills.js";
import type { Skill, SkillSuggestion } from "../../services/SkillStore.js";

// ── Mock SkillStore ────────────────────────────────────────────────────

const mockStore = {
  createSkill: jest.fn(),
  getSkill: jest.fn(),
  listSkills: jest.fn(),
  updateSkill: jest.fn(),
  deleteSkill: jest.fn(),
  incrementUsage: jest.fn(),
  suggestSkills: jest.fn(),
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

// ── Test app ──────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/skills", createSkillsRouter(mockStore as never));
  return app;
}

// ── Fixture data ──────────────────────────────────────────────────────

const SKILL_1: Skill = {
  skillId: "skill-001",
  name: "Lookup Customer",
  description: "Find a customer by account number",
  category: "customer_lookup",
  triggerPhrases: ["look up customer", "find account"],
  parameters: [
    { name: "accountNumber", type: "string", required: true, description: "Account ID" },
  ],
  enabled: true,
  tenantId: "org_acme",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  usageCount: 5,
};

const SKILL_2: Skill = {
  skillId: "skill-002",
  name: "Schedule Appointment",
  description: "Book an appointment for the caller",
  category: "scheduling",
  triggerPhrases: ["schedule appointment", "book a time"],
  parameters: [],
  enabled: true,
  createdAt: "2026-03-02T10:00:00.000Z",
  updatedAt: "2026-03-02T10:00:00.000Z",
  usageCount: 0,
};

const SUGGESTION_1: SkillSuggestion = {
  skill: SKILL_1,
  score: 0.8,
  matchedPhrase: "look up customer",
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("Skills API", () => {
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

  // ── GET /skills ───────────────────────────────────────────────────

  describe("GET /skills", () => {
    it("returns 200 with skills array and total", async () => {
      mockStore.listSkills.mockReturnValue([SKILL_1, SKILL_2]);

      const res = await httpRequest(server, "GET", "/skills");

      expect(res.status).toBe(200);
      const data = res.json() as { skills: unknown[]; total: number };
      expect(Array.isArray(data.skills)).toBe(true);
      expect(data.skills).toHaveLength(2);
      expect(data.total).toBe(2);
    });

    it("passes tenantId query param to listSkills", async () => {
      mockStore.listSkills.mockReturnValue([SKILL_1]);

      await httpRequest(server, "GET", "/skills?tenantId=org_acme");

      expect(mockStore.listSkills).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "org_acme" }),
      );
    });

    it("passes category query param to listSkills", async () => {
      mockStore.listSkills.mockReturnValue([]);

      await httpRequest(server, "GET", "/skills?category=scheduling");

      expect(mockStore.listSkills).toHaveBeenCalledWith(
        expect.objectContaining({ category: "scheduling" }),
      );
    });

    it("passes enabled=true query param to listSkills as boolean", async () => {
      mockStore.listSkills.mockReturnValue([SKILL_1]);

      await httpRequest(server, "GET", "/skills?enabled=true");

      expect(mockStore.listSkills).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    });
  });

  // ── POST /skills ──────────────────────────────────────────────────

  describe("POST /skills", () => {
    it("returns 201 with created skill", async () => {
      mockStore.createSkill.mockReturnValue(SKILL_1);

      const res = await httpRequest(server, "POST", "/skills", {
        name: "Lookup Customer",
        description: "Find a customer",
        category: "customer_lookup",
        triggerPhrases: ["look up customer"],
      });

      expect(res.status).toBe(201);
      const skill = res.json() as Skill;
      expect(skill.skillId).toBe("skill-001");
    });

    it("returns 400 when name is missing", async () => {
      const res = await httpRequest(server, "POST", "/skills", {
        description: "desc",
        category: "custom",
        triggerPhrases: ["phrase"],
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toMatch(/name/i);
    });

    it("returns 400 when name is empty string", async () => {
      const res = await httpRequest(server, "POST", "/skills", {
        name: "",
        description: "desc",
        category: "custom",
        triggerPhrases: ["phrase"],
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when triggerPhrases is empty array", async () => {
      const res = await httpRequest(server, "POST", "/skills", {
        name: "My Skill",
        description: "desc",
        category: "custom",
        triggerPhrases: [],
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toMatch(/triggerPhrases/i);
    });

    it("returns 400 when description is missing", async () => {
      const res = await httpRequest(server, "POST", "/skills", {
        name: "My Skill",
        category: "custom",
        triggerPhrases: ["phrase"],
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when category is missing", async () => {
      const res = await httpRequest(server, "POST", "/skills", {
        name: "My Skill",
        description: "desc",
        triggerPhrases: ["phrase"],
      });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /skills/suggest ──────────────────────────────────────────
  //
  // This describe block verifies the route resolves before /:skillId

  describe("POST /skills/suggest", () => {
    it("returns 200 with suggestions array", async () => {
      mockStore.suggestSkills.mockReturnValue([SUGGESTION_1]);

      const res = await httpRequest(server, "POST", "/skills/suggest", {
        utterance: "look up customer",
      });

      expect(res.status).toBe(200);
      const data = res.json() as { suggestions: SkillSuggestion[] };
      expect(Array.isArray(data.suggestions)).toBe(true);
      expect(data.suggestions).toHaveLength(1);
    });

    it("returns 400 when utterance is missing", async () => {
      const res = await httpRequest(server, "POST", "/skills/suggest", {});

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toMatch(/utterance/i);
    });

    it("returns 400 when utterance is empty string", async () => {
      const res = await httpRequest(server, "POST", "/skills/suggest", {
        utterance: "",
      });

      expect(res.status).toBe(400);
    });

    it("passes tenantId and maxResults to suggestSkills", async () => {
      mockStore.suggestSkills.mockReturnValue([]);

      await httpRequest(server, "POST", "/skills/suggest", {
        utterance: "look up customer",
        tenantId: "org_acme",
        maxResults: 5,
      });

      expect(mockStore.suggestSkills).toHaveBeenCalledWith(
        "look up customer",
        "org_acme",
        5,
      );
    });
  });

  // ── GET /skills/:skillId ──────────────────────────────────────────

  describe("GET /skills/:skillId", () => {
    it("returns 200 with the skill", async () => {
      mockStore.getSkill.mockReturnValue(SKILL_1);

      const res = await httpRequest(server, "GET", "/skills/skill-001");

      expect(res.status).toBe(200);
      const skill = res.json() as Skill;
      expect(skill.skillId).toBe("skill-001");
    });

    it("returns 404 when skill not found", async () => {
      mockStore.getSkill.mockReturnValue(undefined);

      const res = await httpRequest(server, "GET", "/skills/unknown-id");

      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /skills/:skillId ────────────────────────────────────────

  describe("PATCH /skills/:skillId", () => {
    it("returns 200 with updated skill", async () => {
      const updated = { ...SKILL_1, name: "Updated Name" };
      mockStore.updateSkill.mockReturnValue(updated);

      const res = await httpRequest(server, "PATCH", "/skills/skill-001", {
        name: "Updated Name",
      });

      expect(res.status).toBe(200);
      const skill = res.json() as Skill;
      expect(skill.name).toBe("Updated Name");
    });

    it("returns 404 when skill not found", async () => {
      mockStore.updateSkill.mockReturnValue(undefined);

      const res = await httpRequest(server, "PATCH", "/skills/unknown-id", {
        name: "X",
      });

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /skills/:skillId ───────────────────────────────────────

  describe("DELETE /skills/:skillId", () => {
    it("returns 204 when skill is deleted", async () => {
      mockStore.deleteSkill.mockReturnValue(true);

      const res = await httpRequest(server, "DELETE", "/skills/skill-001");

      expect(res.status).toBe(204);
    });

    it("returns 404 when skill not found", async () => {
      mockStore.deleteSkill.mockReturnValue(false);

      const res = await httpRequest(server, "DELETE", "/skills/unknown-id");

      expect(res.status).toBe(404);
    });
  });

  // ── POST /skills/:skillId/invoke ──────────────────────────────────

  describe("POST /skills/:skillId/invoke", () => {
    it("returns 200 with invocation context", async () => {
      mockStore.getSkill.mockReturnValue(SKILL_1);
      mockStore.incrementUsage.mockReturnValue(undefined);

      const res = await httpRequest(server, "POST", "/skills/skill-001/invoke", {
        parameters: { accountNumber: "ACC-123" },
        sessionId: "sess-abc",
      });

      expect(res.status).toBe(200);
      const data = res.json() as {
        skill: Skill;
        parameters: Record<string, unknown>;
        invokedAt: string;
        webhookUrl: string | undefined;
      };
      expect(data.skill.skillId).toBe("skill-001");
      expect(data.parameters).toEqual({ accountNumber: "ACC-123" });
      expect(data.invokedAt).toBeDefined();
    });

    it("returns 404 when skill not found", async () => {
      mockStore.getSkill.mockReturnValue(undefined);

      const res = await httpRequest(
        server,
        "POST",
        "/skills/unknown-id/invoke",
        {},
      );

      expect(res.status).toBe(404);
    });

    it("calls incrementUsage on the skill", async () => {
      mockStore.getSkill.mockReturnValue(SKILL_2);
      mockStore.incrementUsage.mockReturnValue(undefined);

      await httpRequest(server, "POST", "/skills/skill-002/invoke", {});

      expect(mockStore.incrementUsage).toHaveBeenCalledWith("skill-002");
    });

    it("returns empty parameters object when no parameters provided", async () => {
      mockStore.getSkill.mockReturnValue(SKILL_2);
      mockStore.incrementUsage.mockReturnValue(undefined);

      const res = await httpRequest(server, "POST", "/skills/skill-002/invoke", {});

      expect(res.status).toBe(200);
      const data = res.json() as { parameters: Record<string, unknown> };
      expect(data.parameters).toEqual({});
    });
  });
});
