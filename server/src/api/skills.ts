/**
 * Skills API
 *
 * GET    /skills                    — list skills (filter: ?tenantId=&category=&enabled=)
 * POST   /skills                    — create a skill (201)
 * POST   /skills/suggest            — auto-suggest skills for an utterance (registered BEFORE /:skillId)
 * GET    /skills/:skillId           — get one skill (200/404)
 * PATCH  /skills/:skillId           — update a skill (200/404)
 * DELETE /skills/:skillId           — delete a skill (204/404)
 * POST   /skills/:skillId/invoke    — record usage + return invocation context (200/404)
 */

import { Router } from "express";
import type { SkillStore, SkillCategory } from "../services/SkillStore.js";

// ── Validation helpers ─────────────────────────────────────────────────

/**
 * Return a non-empty string from an unknown value, or an error descriptor.
 */
function requireString(
  value: unknown,
  field: string,
): { value: string } | { error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { error: `${field} is required and must be a non-empty string` };
  }
  return { value: value.trim() };
}

// ── Router factory ─────────────────────────────────────────────────────

export function createSkillsRouter(store: SkillStore): Router {
  const router = Router();

  // ── GET /skills ──────────────────────────────────────────────────────

  /**
   * List skills.
   *
   * Query params:
   *   tenantId — include global + tenant-specific skills
   *   category — filter by SkillCategory
   *   enabled  — "true" | "false"
   *
   * Returns: { skills: Skill[], total: number }
   */
  router.get("/", (req, res) => {
    const tenantId =
      typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    const category =
      typeof req.query.category === "string"
        ? (req.query.category as SkillCategory)
        : undefined;
    const enabledRaw =
      typeof req.query.enabled === "string" ? req.query.enabled : undefined;

    let enabled: boolean | undefined;
    if (enabledRaw === "true") enabled = true;
    else if (enabledRaw === "false") enabled = false;

    const skills = store.listSkills({ tenantId, category, enabled });
    res.json({ skills, total: skills.length });
  });

  // ── POST /skills/suggest ─────────────────────────────────────────────
  //
  // IMPORTANT: registered before /:skillId so Express does not treat "suggest"
  // as a skillId parameter.

  /**
   * Auto-suggest skills for a caller utterance.
   *
   * Body: { utterance: string, tenantId?: string, maxResults?: number }
   *
   * Returns: { suggestions: SkillSuggestion[] }
   * Returns 400 when utterance is missing or empty.
   */
  router.post("/suggest", (req, res) => {
    const body = req.body as Record<string, unknown>;

    const utteranceResult = requireString(body.utterance, "utterance");
    if ("error" in utteranceResult) {
      res.status(400).json({ error: utteranceResult.error });
      return;
    }

    const tenantId =
      typeof body.tenantId === "string" ? body.tenantId : undefined;
    const maxResults =
      typeof body.maxResults === "number" ? body.maxResults : undefined;

    const suggestions = store.suggestSkills(
      utteranceResult.value,
      tenantId,
      maxResults,
    );

    res.json({ suggestions });
  });

  // ── POST /skills ─────────────────────────────────────────────────────

  /**
   * Create a new skill.
   *
   * Body: { name, description, category, triggerPhrases, parameters?,
   *         webhookUrl?, enabled?, tenantId? }
   *
   * Returns 201 + the created Skill.
   * Returns 400 when required fields are missing or triggerPhrases is empty.
   */
  router.post("/", (req, res) => {
    const body = req.body as Record<string, unknown>;

    const nameResult = requireString(body.name, "name");
    if ("error" in nameResult) {
      res.status(400).json({ error: nameResult.error });
      return;
    }

    const descriptionResult = requireString(body.description, "description");
    if ("error" in descriptionResult) {
      res.status(400).json({ error: descriptionResult.error });
      return;
    }

    const categoryResult = requireString(body.category, "category");
    if ("error" in categoryResult) {
      res.status(400).json({ error: categoryResult.error });
      return;
    }

    if (
      !Array.isArray(body.triggerPhrases) ||
      (body.triggerPhrases as unknown[]).length === 0
    ) {
      res.status(400).json({
        error: "triggerPhrases is required and must be a non-empty array",
      });
      return;
    }

    try {
      const skill = store.createSkill({
        name: nameResult.value,
        description: descriptionResult.value,
        category: categoryResult.value as SkillCategory,
        triggerPhrases: body.triggerPhrases as string[],
        parameters: Array.isArray(body.parameters)
          ? (body.parameters as never)
          : [],
        webhookUrl:
          typeof body.webhookUrl === "string" ? body.webhookUrl : undefined,
        enabled:
          typeof body.enabled === "boolean" ? body.enabled : true,
        tenantId:
          typeof body.tenantId === "string" ? body.tenantId : undefined,
      });

      res.status(201).json(skill);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ── GET /skills/:skillId ─────────────────────────────────────────────

  /**
   * Get a skill by ID.
   *
   * Returns 200 + Skill, or 404 when not found.
   */
  router.get("/:skillId", (req, res) => {
    const { skillId } = req.params;
    const skill = store.getSkill(skillId);

    if (!skill) {
      res.status(404).json({ error: `Skill not found: ${skillId}` });
      return;
    }

    res.json(skill);
  });

  // ── PATCH /skills/:skillId ───────────────────────────────────────────

  /**
   * Partially update a skill.
   *
   * Returns 200 + updated Skill, or 404 when not found.
   */
  router.patch("/:skillId", (req, res) => {
    const { skillId } = req.params;
    const updates = req.body as Record<string, unknown>;

    const skill = store.updateSkill(skillId, updates as never);

    if (!skill) {
      res.status(404).json({ error: `Skill not found: ${skillId}` });
      return;
    }

    res.json(skill);
  });

  // ── DELETE /skills/:skillId ──────────────────────────────────────────

  /**
   * Delete a skill.
   *
   * Returns 204 on success, 404 when not found.
   */
  router.delete("/:skillId", (req, res) => {
    const { skillId } = req.params;
    const deleted = store.deleteSkill(skillId);

    if (!deleted) {
      res.status(404).json({ error: `Skill not found: ${skillId}` });
      return;
    }

    res.status(204).send();
  });

  // ── POST /skills/:skillId/invoke ─────────────────────────────────────

  /**
   * Record invocation of a skill and return invocation context.
   *
   * Body: { parameters?: Record<string, unknown>, sessionId?: string }
   *
   * Returns 200 + { skill, parameters, invokedAt, webhookUrl }.
   * Returns 404 when skill not found.
   * Calls incrementUsage() on the skill.
   */
  router.post("/:skillId/invoke", (req, res) => {
    const { skillId } = req.params;
    const body = req.body as Record<string, unknown>;

    const skill = store.getSkill(skillId);

    if (!skill) {
      res.status(404).json({ error: `Skill not found: ${skillId}` });
      return;
    }

    store.incrementUsage(skillId);

    const parameters =
      body.parameters !== undefined &&
      typeof body.parameters === "object" &&
      body.parameters !== null
        ? (body.parameters as Record<string, unknown>)
        : {};

    res.json({
      skill,
      parameters,
      invokedAt: new Date().toISOString(),
      webhookUrl: skill.webhookUrl,
    });
  });

  return router;
}
