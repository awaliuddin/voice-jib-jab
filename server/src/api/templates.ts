/**
 * Templates API Router — provides HTTP endpoints for managing agent templates.
 *
 * Endpoints:
 *   GET    /templates                      — list all (optional ?tenantId=x&persona=y)
 *   GET    /templates/builtin              — list only built-in templates
 *   GET    /templates/:templateId          — get single template
 *   POST   /templates                      — create custom template
 *   PUT    /templates/:templateId          — update custom template (partial patch)
 *   DELETE /templates/:templateId          — delete custom template (204)
 *   GET    /templates/:templateId/config   — returns getSessionConfig() result
 */

import { Router } from "express";
import type { AgentTemplateStore, PersonaType } from "../services/AgentTemplateStore.js";

// ── Validation helpers ────────────────────────────────────────────────

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const VALID_PERSONAS: ReadonlySet<string> = new Set([
  "customer_support", "sales", "tech_support", "receptionist", "custom",
]);

function isValidId(value: string): boolean {
  return VALID_ID_PATTERN.test(value);
}

function isValidPersona(value: unknown): value is PersonaType {
  return typeof value === "string" && VALID_PERSONAS.has(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// ── Router factory ────────────────────────────────────────────────────

/** Router for /templates — agent template CRUD, built-in listing, marketplace, and config generation. */
export function createTemplatesRouter(store: AgentTemplateStore): Router {
  const router = Router();

  /** GET /templates — list all templates with optional filters. */
  router.get("/", (req, res) => {
    const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    const persona = typeof req.query.persona === "string" ? req.query.persona : undefined;

    const validPersona = isValidPersona(persona) ? persona : undefined;

    const templates = store.listTemplates({ tenantId, persona: validPersona });
    res.json({ templates, count: templates.length });
  });

  /** GET /templates/builtin — list only built-in templates. */
  router.get("/builtin", (_req, res) => {
    const templates = store.listTemplates().filter((tpl) => tpl.builtIn);
    res.json({ templates, count: templates.length });
  });

  /** GET /templates/marketplace — browse the published template catalog. */
  router.get("/marketplace", (req, res) => {
    const persona = typeof req.query.persona === "string" ? req.query.persona : undefined;
    const validPersona = isValidPersona(persona) ? persona : undefined;
    const templates = store.listMarketplace({ persona: validPersona });
    res.json({ templates, count: templates.length });
  });

  /** GET /templates/:templateId — get a single template. */
  router.get("/:templateId", (req, res) => {
    if (!isValidId(req.params.templateId)) {
      res.status(400).json({ error: "Invalid templateId format" });
      return;
    }

    const template = store.getTemplate(req.params.templateId);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    res.json(template);
  });

  /** POST /templates — create a new custom template. */
  router.post("/", (req, res) => {
    const body = req.body ?? {};

    if (!body.name || typeof body.name !== "string") {
      res.status(400).json({ error: "name is required and must be a string" });
      return;
    }

    if (!isValidPersona(body.persona)) {
      res.status(400).json({ error: "persona is required and must be a valid PersonaType" });
      return;
    }

    if (!body.greeting || typeof body.greeting !== "string") {
      res.status(400).json({ error: "greeting is required and must be a string" });
      return;
    }

    const template = store.createTemplate({
      name: body.name,
      persona: body.persona,
      greeting: body.greeting,
      claims: isStringArray(body.claims) ? body.claims : [],
      disallowedPatterns: isStringArray(body.disallowedPatterns) ? body.disallowedPatterns : [],
      moderationSensitivity: ["low", "medium", "high"].includes(body.moderationSensitivity)
        ? body.moderationSensitivity
        : "medium",
      ttsVoice: typeof body.ttsVoice === "string" ? body.ttsVoice : "nova",
      escalationRules: body.escalationRules && typeof body.escalationRules === "object"
        ? {
            escalateOnFrustration: Boolean(body.escalationRules.escalateOnFrustration),
            escalateOnKeywords: isStringArray(body.escalationRules.escalateOnKeywords)
              ? body.escalationRules.escalateOnKeywords
              : [],
            maxTurnsBeforeEscalate: typeof body.escalationRules.maxTurnsBeforeEscalate === "number"
              ? body.escalationRules.maxTurnsBeforeEscalate
              : null,
          }
        : { escalateOnFrustration: false, escalateOnKeywords: [], maxTurnsBeforeEscalate: null },
      tenantId: typeof body.tenantId === "string" ? body.tenantId : null,
    });

    res.status(201).json(template);
  });

  /** PUT /templates/:templateId — update a custom template. */
  router.put("/:templateId", (req, res) => {
    if (!isValidId(req.params.templateId)) {
      res.status(400).json({ error: "Invalid templateId format" });
      return;
    }

    const existing = store.getTemplate(req.params.templateId);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    if (existing.builtIn) {
      res.status(403).json({ error: "Cannot modify built-in template" });
      return;
    }

    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};

    if (body.name !== undefined && typeof body.name === "string") patch.name = body.name;
    if (isValidPersona(body.persona)) patch.persona = body.persona;
    if (body.greeting !== undefined && typeof body.greeting === "string") patch.greeting = body.greeting;
    if (isStringArray(body.claims)) patch.claims = body.claims;
    if (isStringArray(body.disallowedPatterns)) patch.disallowedPatterns = body.disallowedPatterns;
    if (["low", "medium", "high"].includes(body.moderationSensitivity)) {
      patch.moderationSensitivity = body.moderationSensitivity;
    }
    if (typeof body.ttsVoice === "string") patch.ttsVoice = body.ttsVoice;
    if (body.escalationRules && typeof body.escalationRules === "object") {
      patch.escalationRules = {
        escalateOnFrustration: Boolean(body.escalationRules.escalateOnFrustration),
        escalateOnKeywords: isStringArray(body.escalationRules.escalateOnKeywords)
          ? body.escalationRules.escalateOnKeywords
          : existing.escalationRules.escalateOnKeywords,
        maxTurnsBeforeEscalate: typeof body.escalationRules.maxTurnsBeforeEscalate === "number"
          ? body.escalationRules.maxTurnsBeforeEscalate
          : existing.escalationRules.maxTurnsBeforeEscalate,
      };
    }
    if (body.tenantId !== undefined) {
      patch.tenantId = typeof body.tenantId === "string" ? body.tenantId : null;
    }

    const updated = store.updateTemplate(req.params.templateId, patch);
    if (!updated) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    res.json(updated);
  });

  /** DELETE /templates/:templateId — delete a custom template. */
  router.delete("/:templateId", (req, res) => {
    if (!isValidId(req.params.templateId)) {
      res.status(400).json({ error: "Invalid templateId format" });
      return;
    }

    const existing = store.getTemplate(req.params.templateId);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    if (existing.builtIn) {
      res.status(403).json({ error: "Cannot delete built-in template" });
      return;
    }

    store.deleteTemplate(req.params.templateId);
    res.status(204).send();
  });

  /** POST /templates/:templateId/publish — publish a template to the marketplace. */
  router.post("/:templateId/publish", (req, res) => {
    if (!isValidId(req.params.templateId)) {
      res.status(400).json({ error: "Invalid templateId format" });
      return;
    }
    const existing = store.getTemplate(req.params.templateId);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (existing.builtIn) {
      res.status(403).json({ error: "Built-in templates are always published" });
      return;
    }
    const updated = store.publishTemplate(req.params.templateId);
    res.json(updated);
  });

  /** POST /templates/:templateId/unpublish — remove a template from the marketplace. */
  router.post("/:templateId/unpublish", (req, res) => {
    if (!isValidId(req.params.templateId)) {
      res.status(400).json({ error: "Invalid templateId format" });
      return;
    }
    const existing = store.getTemplate(req.params.templateId);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (existing.builtIn) {
      res.status(403).json({ error: "Cannot unpublish built-in templates" });
      return;
    }
    const updated = store.unpublishTemplate(req.params.templateId);
    res.json(updated);
  });

  /** POST /templates/marketplace/:templateId/install — install a published template for a tenant. */
  router.post("/marketplace/:templateId/install", (req, res) => {
    if (!isValidId(req.params.templateId)) {
      res.status(400).json({ error: "Invalid templateId format" });
      return;
    }
    const body = req.body ?? {};
    if (!body.tenantId || typeof body.tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    const installed = store.installTemplate(req.params.templateId, body.tenantId);
    if (!installed) {
      res.status(404).json({ error: "Template not found or not published" });
      return;
    }
    res.status(201).json(installed);
  });

  /** GET /templates/:templateId/config — session config derived from template. */
  router.get("/:templateId/config", (req, res) => {
    if (!isValidId(req.params.templateId)) {
      res.status(400).json({ error: "Invalid templateId format" });
      return;
    }

    const sessionConfig = store.getSessionConfig(req.params.templateId);
    if (!sessionConfig) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    res.json(sessionConfig);
  });

  return router;
}
