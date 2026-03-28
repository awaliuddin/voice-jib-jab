/**
 * Translation API Router
 *
 * POST /translation/detect   — detect language of provided text
 * POST /translation/translate — translate text between supported language pairs
 * POST /translation/pipeline  — run the full caller↔agent translation pipeline
 *
 * All endpoints accept JSON bodies and return JSON responses.
 */

import { Router } from "express";
import type { TranslationService } from "../services/TranslationService.js";
import { isSupportedPair, type TranslationLanguage } from "../services/TranslationService.js";

// ── Validation helpers ─────────────────────────────────────────────────

const VALID_LANGUAGES: ReadonlySet<TranslationLanguage> = new Set(["en", "es", "fr", "de"]);

function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return typeof value === "string" && VALID_LANGUAGES.has(value as TranslationLanguage);
}

// ── Router factory ─────────────────────────────────────────────────────

/** Router for /translation — language detection, text translation, and caller-agent pipeline. */
export function createTranslationRouter(service: TranslationService): Router {
  const router = Router();

  /**
   * POST /translation/detect
   *
   * Body: { text: string }
   * Response: LanguageDetectionResult + { supported: boolean }
   *
   * Returns 400 if text is missing or empty.
   */
  router.post("/detect", (req, res) => {
    const body = req.body ?? {};
    const { text } = body;

    if (typeof text !== "string" || text.trim() === "") {
      res.status(400).json({ error: "text is required and must be a non-empty string" });
      return;
    }

    const result = service.detectLanguage(text);

    // "supported" is true if the detected language is in our TranslationLanguage set
    const supported = VALID_LANGUAGES.has(result.language as TranslationLanguage);

    res.json({ ...result, supported });
  });

  /**
   * POST /translation/translate
   *
   * Body: { text: string, from: TranslationLanguage, to: TranslationLanguage }
   * Response: TranslationResult
   *
   * Returns 400 if any field is missing or the pair is unsupported.
   */
  router.post("/translate", async (req, res) => {
    const body = req.body ?? {};
    const { text, from, to } = body;

    if (typeof text !== "string" || text.trim() === "") {
      res.status(400).json({ error: "text is required and must be a non-empty string" });
      return;
    }

    if (!isTranslationLanguage(from)) {
      res.status(400).json({
        error: `from must be one of: ${[...VALID_LANGUAGES].join(", ")}`,
      });
      return;
    }

    if (!isTranslationLanguage(to)) {
      res.status(400).json({
        error: `to must be one of: ${[...VALID_LANGUAGES].join(", ")}`,
      });
      return;
    }

    if (!isSupportedPair(from, to)) {
      res.status(400).json({ error: `Unsupported translation pair: ${from}→${to}` });
      return;
    }

    try {
      const result = await service.translate(text, from, to);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Translation failed";
      res.status(400).json({ error: message });
    }
  });

  /**
   * POST /translation/pipeline
   *
   * Body: {
   *   callerText: string,
   *   agentResponse: string,
   *   agentLanguage?: TranslationLanguage,
   *   callerLanguage?: TranslationLanguage
   * }
   * Response: PipelineResult
   *
   * Returns 400 if callerText or agentResponse are missing.
   */
  router.post("/pipeline", async (req, res) => {
    const body = req.body ?? {};
    const { callerText, agentResponse, agentLanguage, callerLanguage } = body;

    if (typeof callerText !== "string" || callerText.trim() === "") {
      res.status(400).json({ error: "callerText is required and must be a non-empty string" });
      return;
    }

    if (typeof agentResponse !== "string" || agentResponse.trim() === "") {
      res.status(400).json({ error: "agentResponse is required and must be a non-empty string" });
      return;
    }

    const resolvedAgentLanguage: TranslationLanguage | undefined = isTranslationLanguage(agentLanguage)
      ? agentLanguage
      : undefined;

    const resolvedCallerLanguage: TranslationLanguage | undefined = isTranslationLanguage(callerLanguage)
      ? callerLanguage
      : undefined;

    try {
      const result = await service.runPipeline(
        callerText,
        agentResponse,
        resolvedAgentLanguage,
        resolvedCallerLanguage,
      );
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Pipeline failed";
      res.status(500).json({ error: message });
    }
  });

  return router;
}
