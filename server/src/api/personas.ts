/**
 * Personas API Routers
 *
 * createPersonasRouter  — mounts at /personas
 *   GET    /personas                       — list all (optional ?tenantId=)
 *   GET    /personas/:personaId            — get single persona
 *   POST   /personas                       — create custom persona
 *   PUT    /personas/:personaId            — update custom persona
 *   DELETE /personas/:personaId            — delete custom persona
 *
 * createTenantPersonaRouter  — mounts at /tenants
 *   GET    /tenants/:tenantId/persona      — get assigned persona for tenant
 *   POST   /tenants/:tenantId/persona      — assign persona to tenant
 *   DELETE /tenants/:tenantId/persona      — unassign persona from tenant
 */

import { Router } from "express";
import type {
  PersonaStore,
  PersonaTone,
  VocabularyLevel,
  ResponseLengthPreference,
} from "../services/PersonaStore.js";

// ── Validation helpers ─────────────────────────────────────────────────

const VALID_TONES: PersonaTone[] = ["formal", "casual", "empathetic"];
const VALID_VOCAB_LEVELS: VocabularyLevel[] = ["simple", "standard", "technical"];
const VALID_LENGTH_PREFS: ResponseLengthPreference[] = ["brief", "standard", "detailed"];

function isValidTone(value: unknown): value is PersonaTone {
  return typeof value === "string" && (VALID_TONES as string[]).includes(value);
}

function isValidVocabLevel(value: unknown): value is VocabularyLevel {
  return typeof value === "string" && (VALID_VOCAB_LEVELS as string[]).includes(value);
}

function isValidLengthPref(value: unknown): value is ResponseLengthPreference {
  return typeof value === "string" && (VALID_LENGTH_PREFS as string[]).includes(value);
}

// ── Personas CRUD router ───────────────────────────────────────────────

/** Router for /personas — persona library CRUD (list, get, create, update, delete). */
export function createPersonasRouter(store: PersonaStore): Router {
  const router = Router();

  /**
   * GET / — list personas with optional tenantId filter.
   *
   * Query: tenantId (optional)
   */
  router.get("/", (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;

    const personas = store.listPersonas(tenantId);
    res.json({ personas, count: personas.length });
  });

  /** GET /:personaId — get a single persona. */
  router.get("/:personaId", (req, res) => {
    const { personaId } = req.params;

    const persona = store.getPersona(personaId);
    if (!persona) {
      res.status(404).json({ error: "Persona not found" });
      return;
    }

    res.json(persona);
  });

  /**
   * POST / — create a custom persona.
   *
   * Body: name, tone, vocabularyLevel, responseLengthPreference,
   *       description, systemPromptSnippet, tenantId?
   */
  router.post("/", (req, res) => {
    const body = req.body ?? {};

    if (!body.name || typeof body.name !== "string") {
      res.status(400).json({ error: "name is required and must be a string" });
      return;
    }

    if (body.name.length > 100) {
      res.status(400).json({ error: "name must be 100 characters or fewer" });
      return;
    }

    if (!isValidTone(body.tone)) {
      res.status(400).json({
        error: `tone is required and must be one of: ${VALID_TONES.join(", ")}`,
      });
      return;
    }

    if (!isValidVocabLevel(body.vocabularyLevel)) {
      res.status(400).json({
        error: `vocabularyLevel is required and must be one of: ${VALID_VOCAB_LEVELS.join(", ")}`,
      });
      return;
    }

    if (!isValidLengthPref(body.responseLengthPreference)) {
      res.status(400).json({
        error: `responseLengthPreference is required and must be one of: ${VALID_LENGTH_PREFS.join(", ")}`,
      });
      return;
    }

    if (!body.description || typeof body.description !== "string") {
      res.status(400).json({ error: "description is required and must be a string" });
      return;
    }

    if (!body.systemPromptSnippet || typeof body.systemPromptSnippet !== "string") {
      res
        .status(400)
        .json({ error: "systemPromptSnippet is required and must be a string" });
      return;
    }

    const persona = store.createPersona({
      name: body.name,
      tone: body.tone,
      vocabularyLevel: body.vocabularyLevel,
      responseLengthPreference: body.responseLengthPreference,
      description: body.description,
      systemPromptSnippet: body.systemPromptSnippet,
      tenantId: typeof body.tenantId === "string" ? body.tenantId : null,
    });

    res.status(201).json(persona);
  });

  /**
   * PUT /:personaId — partially update a custom persona.
   * Returns 400 if trying to update a built-in.
   */
  router.put("/:personaId", (req, res) => {
    const { personaId } = req.params;

    const existing = store.getPersona(personaId);
    if (!existing) {
      res.status(404).json({ error: "Persona not found" });
      return;
    }

    if (existing.isBuiltIn) {
      res.status(400).json({ error: "Cannot update a built-in persona" });
      return;
    }

    const body = req.body ?? {};
    const patch: Parameters<typeof store.updatePersona>[1] = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        res.status(400).json({ error: "name must be a string" });
        return;
      }
      if (body.name.length > 100) {
        res.status(400).json({ error: "name must be 100 characters or fewer" });
        return;
      }
      patch.name = body.name;
    }

    if (body.tone !== undefined) {
      if (!isValidTone(body.tone)) {
        res.status(400).json({
          error: `tone must be one of: ${VALID_TONES.join(", ")}`,
        });
        return;
      }
      patch.tone = body.tone;
    }

    if (body.vocabularyLevel !== undefined) {
      if (!isValidVocabLevel(body.vocabularyLevel)) {
        res.status(400).json({
          error: `vocabularyLevel must be one of: ${VALID_VOCAB_LEVELS.join(", ")}`,
        });
        return;
      }
      patch.vocabularyLevel = body.vocabularyLevel;
    }

    if (body.responseLengthPreference !== undefined) {
      if (!isValidLengthPref(body.responseLengthPreference)) {
        res.status(400).json({
          error: `responseLengthPreference must be one of: ${VALID_LENGTH_PREFS.join(", ")}`,
        });
        return;
      }
      patch.responseLengthPreference = body.responseLengthPreference;
    }

    if (body.description !== undefined) {
      if (typeof body.description !== "string") {
        res.status(400).json({ error: "description must be a string" });
        return;
      }
      patch.description = body.description;
    }

    if (body.systemPromptSnippet !== undefined) {
      if (typeof body.systemPromptSnippet !== "string") {
        res.status(400).json({ error: "systemPromptSnippet must be a string" });
        return;
      }
      patch.systemPromptSnippet = body.systemPromptSnippet;
    }

    if (body.tenantId !== undefined) {
      patch.tenantId = typeof body.tenantId === "string" ? body.tenantId : null;
    }

    const updated = store.updatePersona(personaId, patch);
    if (!updated) {
      // updatePersona returns undefined for built-ins and missing — both handled above,
      // but guard defensively.
      res.status(404).json({ error: "Persona not found" });
      return;
    }

    res.json(updated);
  });

  /**
   * DELETE /:personaId — delete a custom persona (204).
   * Returns 400 if trying to delete a built-in.
   */
  router.delete("/:personaId", (req, res) => {
    const { personaId } = req.params;

    const existing = store.getPersona(personaId);
    if (!existing) {
      res.status(404).json({ error: "Persona not found" });
      return;
    }

    if (existing.isBuiltIn) {
      res.status(400).json({ error: "Cannot delete a built-in persona" });
      return;
    }

    store.deletePersona(personaId);
    res.status(204).send();
  });

  return router;
}

// ── Tenant persona assignment router ──────────────────────────────────

/** Router for /tenants — per-tenant persona assignment (get, assign, unassign). */
export function createTenantPersonaRouter(store: PersonaStore): Router {
  const router = Router();

  /**
   * GET /:tenantId/persona — get assigned persona for tenant.
   *
   * Returns { tenantId, persona } where persona may be null if unassigned.
   */
  router.get("/:tenantId/persona", (req, res) => {
    const { tenantId } = req.params;

    const persona = store.getTenantPersona(tenantId);
    res.json({ tenantId, persona: persona ?? null });
  });

  /**
   * POST /:tenantId/persona — assign a persona to a tenant.
   *
   * Body: { personaId }
   * Returns 404 if personaId does not exist.
   */
  router.post("/:tenantId/persona", (req, res) => {
    const { tenantId } = req.params;
    const body = req.body ?? {};

    if (!body.personaId || typeof body.personaId !== "string") {
      res.status(400).json({ error: "personaId is required and must be a string" });
      return;
    }

    const assigned = store.assignPersonaToTenant(tenantId, body.personaId);
    if (!assigned) {
      res.status(404).json({ error: "Persona not found" });
      return;
    }

    res.json({ tenantId, personaId: body.personaId });
  });

  /**
   * DELETE /:tenantId/persona — unassign the persona from a tenant.
   *
   * Always returns 204 (idempotent).
   */
  router.delete("/:tenantId/persona", (req, res) => {
    const { tenantId } = req.params;
    store.unassignPersonaFromTenant(tenantId);
    res.status(204).send();
  });

  return router;
}
