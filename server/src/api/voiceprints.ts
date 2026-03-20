/**
 * Voiceprints API Router — HTTP endpoints for caller voice biometrics.
 *
 * Endpoints:
 *   POST   /voiceprints/enroll         — enroll or update a caller voiceprint
 *   POST   /voiceprints/identify       — identify a caller from audio
 *   GET    /voiceprints?tenantId=x     — list voiceprints for a tenant
 *   GET    /voiceprints/:voiceprintId  — get single voiceprint (without embedding)
 *   DELETE /voiceprints/:voiceprintId  — delete a voiceprint
 *
 * NOTE: POST /enroll and POST /identify are registered BEFORE
 *       GET /:voiceprintId to avoid Express route shadowing.
 */

import { Router } from "express";
import type { VoiceprintStore, Voiceprint } from "../services/VoiceprintStore.js";
import type { ConversationMemoryStore, MemoryEntry } from "../services/ConversationMemoryStore.js";

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Strip the embedding array from a voiceprint before sending over the wire.
 * Embeddings are large (64 floats) and not useful to API consumers.
 */
function stripEmbedding(
  vp: Voiceprint,
): Omit<Voiceprint, "embedding"> {
  const { embedding: _embedding, ...rest } = vp;
  void _embedding;
  return rest;
}

// ── Router factory ─────────────────────────────────────────────────────

/**
 * Create an Express router for voiceprint enrollment and identification.
 *
 * @param store       - VoiceprintStore for embedding persistence
 * @param memoryStore - Optional ConversationMemoryStore for caller context enrichment
 */
export function createVoiceprintsRouter(
  store: VoiceprintStore,
  memoryStore?: ConversationMemoryStore,
): Router {
  const router = Router();

  /**
   * POST /voiceprints/enroll — enroll a voiceprint.
   *
   * Body: { tenantId: string, callerId: string, audioData: string (base64) }
   * Returns 201 + voiceprint summary (embedding omitted).
   *
   * Registered BEFORE /:voiceprintId to prevent route shadowing.
   */
  router.post("/enroll", (req, res) => {
    const { tenantId, callerId, audioData } = req.body ?? {};

    if (!tenantId || typeof tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required and must be a string" });
      return;
    }

    if (!callerId || typeof callerId !== "string") {
      res.status(400).json({ error: "callerId is required and must be a string" });
      return;
    }

    if (!audioData || typeof audioData !== "string") {
      res.status(400).json({ error: "audioData is required and must be a base64 string" });
      return;
    }

    const audioBuffer = Buffer.from(audioData, "base64");
    const voiceprint = store.enroll(tenantId, callerId, audioBuffer);

    res.status(201).json(stripEmbedding(voiceprint));
  });

  /**
   * POST /voiceprints/identify — identify a caller from audio.
   *
   * Body: { tenantId: string, audioData: string (base64) }
   * Returns IdentifyResult; if identified and memoryStore is available,
   * also returns context[] with memory entries for the tenant.
   *
   * Registered BEFORE /:voiceprintId to prevent route shadowing.
   */
  router.post("/identify", (req, res) => {
    const { tenantId, audioData } = req.body ?? {};

    if (!tenantId || typeof tenantId !== "string") {
      res.status(400).json({ error: "tenantId is required and must be a string" });
      return;
    }

    if (!audioData || typeof audioData !== "string") {
      res.status(400).json({ error: "audioData is required and must be a base64 string" });
      return;
    }

    const audioBuffer = Buffer.from(audioData, "base64");
    const result = store.identify(tenantId, audioBuffer);

    let context: MemoryEntry[] | undefined;
    if (result.identified && memoryStore) {
      context = memoryStore.load(tenantId);
    }

    res.json({
      ...result,
      ...(context !== undefined ? { context } : {}),
    });
  });

  /**
   * GET /voiceprints?tenantId=x — list all voiceprints for a tenant.
   *
   * Query: tenantId (required)
   * Embedding is omitted from each item in the response.
   */
  router.get("/", (req, res) => {
    const tenantId = req.query.tenantId;

    if (!tenantId || typeof tenantId !== "string") {
      res.status(400).json({ error: "tenantId query parameter is required" });
      return;
    }

    const voiceprints = store.listVoiceprints(tenantId).map(stripEmbedding);
    res.json({ voiceprints, count: voiceprints.length });
  });

  /**
   * GET /voiceprints/:voiceprintId — get a single voiceprint.
   *
   * Embedding is omitted from the response.
   */
  router.get("/:voiceprintId", (req, res) => {
    const voiceprint = store.getVoiceprint(req.params.voiceprintId);

    if (!voiceprint) {
      res.status(404).json({ error: "Voiceprint not found" });
      return;
    }

    res.json(stripEmbedding(voiceprint));
  });

  /**
   * DELETE /voiceprints/:voiceprintId — delete a voiceprint.
   *
   * Returns 204 on success, 404 if not found.
   */
  router.delete("/:voiceprintId", (req, res) => {
    const deleted = store.deleteVoiceprint(req.params.voiceprintId);

    if (!deleted) {
      res.status(404).json({ error: "Voiceprint not found" });
      return;
    }

    res.status(204).send();
  });

  return router;
}
