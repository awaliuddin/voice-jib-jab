/**
 * Voices API Router — provides HTTP endpoints for managing voice profiles
 * used by the Kokoro voice engine for custom TTS synthesis.
 *
 * Endpoints:
 *   GET    /voices/available             — list built-in Kokoro voices + custom profiles
 *   GET    /voices/abtests?tenantId=x   — list A/B tests for a tenant
 *   POST   /voices/abtests              — create an A/B test
 *   GET    /voices/abtests/:testId/stats — get aggregate stats for a test
 *   POST   /voices/abtests/:testId/deactivate — deactivate a test
 *   GET    /voices?tenantId=x           — list voice profiles for a tenant
 *   POST   /voices                      — create a voice profile
 *   GET    /voices/:profileId           — get a single voice profile
 *   DELETE /voices/:profileId           — delete a voice profile
 *   POST   /voices/:profileId/synthesize — test synthesis with a voice profile
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { VoiceProfileStore } from "../services/VoiceProfileStore.js";
import type { VoiceEngine } from "../services/KokoroVoiceEngine.js";
import type { VoiceAbTestService } from "../services/VoiceAbTestService.js";

// ── Constants ─────────────────────────────────────────────────────────

const BUILTIN_VOICES = [
  "af_bella",
  "af_sarah",
  "am_adam",
  "am_michael",
  "bf_emma",
  "bf_isabella",
  "bm_george",
  "bm_lewis",
] as const;

const BUILTIN_PREVIEW_TEXT = "Hello, how can I help you today?";

// ── Validation helpers ────────────────────────────────────────────────

function isMissingRequired(tenantId: unknown, name: unknown): boolean {
  return !tenantId || typeof tenantId !== "string" || !name || typeof name !== "string";
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ── Router factory ────────────────────────────────────────────────────

/**
 * Create an Express router for voice profile CRUD, test synthesis, and A/B testing.
 *
 * @param store - Voice profile persistence layer
 * @param voiceEngine - Optional Kokoro voice engine for synthesis testing
 * @param abTestService - Optional A/B test service for voice experiments
 */
export function createVoicesRouter(
  store: VoiceProfileStore,
  voiceEngine?: VoiceEngine,
  abTestService?: VoiceAbTestService,
): Router {
  const router = Router();

  // ── Static routes (must be registered before /:profileId) ─────────

  /** GET /voices/available — list built-in Kokoro voices and custom profiles. */
  router.get("/available", (req: Request, res: Response) => {
    try {
      const tenantId = req.query.tenantId as string | undefined;
      const custom = tenantId ? store.listProfiles(tenantId) : [];
      const builtIn = BUILTIN_VOICES.map((name) => ({
        name,
        previewText: BUILTIN_PREVIEW_TEXT,
      }));
      res.json({ builtIn, custom, total: builtIn.length + custom.length });
    } catch (err) {
      console.error("[Voices API] GET /available error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** GET /voices/abtests?tenantId=x — list A/B tests for a tenant. */
  router.get("/abtests", (req: Request, res: Response) => {
    if (!abTestService) {
      res.status(503).json({ error: "A/B test service not configured" });
      return;
    }

    try {
      const tenantId = req.query.tenantId as string | undefined;

      if (!tenantId) {
        res.status(400).json({ error: "tenantId query parameter is required" });
        return;
      }

      const tests = abTestService.listTests(tenantId);
      res.json({ tests, count: tests.length });
    } catch (err) {
      console.error("[Voices API] GET /abtests error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** POST /voices/abtests — create an A/B test. */
  router.post("/abtests", (req: Request, res: Response) => {
    if (!abTestService) {
      res.status(503).json({ error: "A/B test service not configured" });
      return;
    }

    try {
      const { tenantId, name, voiceA, voiceB, splitRatio } = req.body ?? {};

      if (!isString(tenantId) || !isString(name) || !isString(voiceA) || !isString(voiceB)) {
        res.status(400).json({ error: "tenantId, name, voiceA, and voiceB are required" });
        return;
      }

      const test = abTestService.createTest({
        tenantId,
        name,
        voiceA,
        voiceB,
        splitRatio: typeof splitRatio === "number" ? splitRatio : undefined,
      });

      res.status(201).json({ test });
    } catch (err) {
      console.error("[Voices API] POST /abtests error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** GET /voices/abtests/:testId/stats — get aggregate stats for a test. */
  router.get("/abtests/:testId/stats", (req: Request, res: Response) => {
    if (!abTestService) {
      res.status(503).json({ error: "A/B test service not configured" });
      return;
    }

    try {
      const stats = abTestService.getTestStats(req.params.testId);

      if (!stats) {
        res.status(404).json({ error: "A/B test not found" });
        return;
      }

      res.json(stats);
    } catch (err) {
      console.error("[Voices API] GET /abtests/:testId/stats error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** POST /voices/abtests/:testId/deactivate — deactivate an A/B test. */
  router.post("/abtests/:testId/deactivate", (req: Request, res: Response) => {
    if (!abTestService) {
      res.status(503).json({ error: "A/B test service not configured" });
      return;
    }

    try {
      const test = abTestService.deactivateTest(req.params.testId);

      if (!test) {
        res.status(404).json({ error: "A/B test not found" });
        return;
      }

      res.json({ test });
    } catch (err) {
      console.error("[Voices API] POST /abtests/:testId/deactivate error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Parameterised profile routes ───────────────────────────────────

  /** GET /voices?tenantId=x — list all voice profiles for a tenant. */
  router.get("/", (req: Request, res: Response) => {
    try {
      const tenantId = req.query.tenantId as string | undefined;

      if (!tenantId) {
        res.status(400).json({ error: "tenantId query parameter is required" });
        return;
      }

      const profiles = store.listProfiles(tenantId);
      res.json({ profiles });
    } catch (err) {
      console.error("[Voices API] GET / error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** POST /voices — create a new voice profile. */
  router.post("/", (req: Request, res: Response) => {
    try {
      const { tenantId, name, audioPath, durationMs, engineData } = req.body ?? {};

      if (isMissingRequired(tenantId, name)) {
        res.status(400).json({ error: "tenantId and name are required" });
        return;
      }

      const resolvedAudioPath = audioPath ?? `${store.getAudioDir()}/${randomUUID()}.wav`;

      const profile = store.createProfile({
        tenantId,
        name,
        audioPath: resolvedAudioPath,
        durationMs: durationMs ?? undefined,
        engineData: engineData ?? undefined,
      });

      res.status(201).json({ profile });
    } catch (err) {
      console.error("[Voices API] POST / error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** GET /voices/:profileId — get a single voice profile. */
  router.get("/:profileId", (req: Request, res: Response) => {
    try {
      const profile = store.getProfile(req.params.profileId);

      if (!profile) {
        res.status(404).json({ error: "Voice profile not found" });
        return;
      }

      res.json({ profile });
    } catch (err) {
      console.error("[Voices API] GET /:profileId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** DELETE /voices/:profileId — delete a voice profile. */
  router.delete("/:profileId", (req: Request, res: Response) => {
    try {
      const profile = store.getProfile(req.params.profileId);

      if (!profile) {
        res.status(404).json({ error: "Voice profile not found" });
        return;
      }

      store.deleteProfile(req.params.profileId);
      res.status(204).send();
    } catch (err) {
      console.error("[Voices API] DELETE /:profileId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /** POST /voices/:profileId/synthesize — test synthesis with a voice profile. */
  router.post("/:profileId/synthesize", async (req: Request, res: Response) => {
    try {
      if (!voiceEngine) {
        res.status(503).json({ error: "Voice engine not configured" });
        return;
      }

      const { text } = req.body ?? {};

      if (!text || typeof text !== "string") {
        res.status(400).json({ error: "text is required and must be a string" });
        return;
      }

      const profile = store.getProfile(req.params.profileId);

      if (!profile) {
        res.status(404).json({ error: "Voice profile not found" });
        return;
      }

      const audioBuffer = await voiceEngine.synthesize(text, {
        voiceId: profile.profileId,
      });

      res.set("Content-Type", "audio/wav");
      res.send(audioBuffer);
    } catch (err) {
      console.error("[Voices API] POST /:profileId/synthesize error:", err);
      const message = err instanceof Error ? err.message : "Synthesis failed";
      res.status(500).json({ error: message });
    }
  });

  return router;
}
