/**
 * Training Data API
 *
 * GET    /training/annotations                — list all annotations (filter: ?sessionId=)
 * POST   /training/annotations                — add annotation
 * GET    /training/annotations/:annotationId  — get one annotation
 * PATCH  /training/annotations/:annotationId  — update label/note
 * DELETE /training/annotations/:annotationId  — delete annotation (204)
 * GET    /training/datasets                   — list datasets
 * POST   /training/datasets                   — build dataset
 * GET    /training/datasets/:datasetId/export — export as JSONL
 * GET    /training/export/good-examples       — export good_response examples as JSONL
 */

import { Router } from "express";
import type { TrainingDataService } from "../services/TrainingDataService.js";
import type { AnnotationLabel } from "../services/TrainingDataService.js";

// ── Validation helpers ─────────────────────────────────────────────────

const VALID_LABELS: AnnotationLabel[] = [
  "good_response",
  "needs_improvement",
  "neutral",
];

function isValidLabel(value: unknown): value is AnnotationLabel {
  return typeof value === "string" && VALID_LABELS.includes(value as AnnotationLabel);
}

function requireString(value: unknown, field: string): { value: string } | { error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { error: `${field} is required and must be a non-empty string` };
  }
  return { value: value.trim() };
}

// ── Router factory ─────────────────────────────────────────────────────

export function createTrainingRouter(service: TrainingDataService): Router {
  const router = Router();

  // ── GET /training/annotations ─────────────────────────────────────

  /**
   * List all annotations, optionally filtered by sessionId.
   *
   * Query params:
   *   sessionId — filter to annotations for this session
   *
   * Returns: { annotations: TurnAnnotation[], total: number }
   */
  router.get("/annotations", (req, res) => {
    const sessionId =
      typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;

    const annotations = service.listAnnotations(sessionId);
    res.json({ annotations, total: annotations.length });
  });

  // ── POST /training/annotations ────────────────────────────────────

  /**
   * Add a new annotation.
   *
   * Body: { sessionId, turnIndex, speaker, text, label, note?, supervisorId? }
   *
   * Returns 201 + the created TurnAnnotation on success.
   * Returns 400 when required fields are missing or label is invalid.
   */
  router.post("/annotations", (req, res) => {
    const body = req.body as Record<string, unknown>;

    const sessionIdResult = requireString(body.sessionId, "sessionId");
    if ("error" in sessionIdResult) {
      res.status(400).json({ error: sessionIdResult.error });
      return;
    }

    if (typeof body.turnIndex !== "number") {
      res.status(400).json({ error: "turnIndex is required and must be a number" });
      return;
    }

    const speakerResult = requireString(body.speaker, "speaker");
    if ("error" in speakerResult) {
      res.status(400).json({ error: speakerResult.error });
      return;
    }

    if (speakerResult.value !== "user" && speakerResult.value !== "assistant") {
      res.status(400).json({ error: "speaker must be 'user' or 'assistant'" });
      return;
    }

    const textResult = requireString(body.text, "text");
    if ("error" in textResult) {
      res.status(400).json({ error: textResult.error });
      return;
    }

    if (!isValidLabel(body.label)) {
      res.status(400).json({
        error: `label must be one of: ${VALID_LABELS.join(", ")}`,
      });
      return;
    }

    const annotation = service.addAnnotation({
      sessionId: sessionIdResult.value,
      turnIndex: body.turnIndex as number,
      speaker: speakerResult.value as "user" | "assistant",
      text: textResult.value,
      label: body.label,
      ...(typeof body.note === "string" ? { note: body.note } : {}),
      ...(typeof body.supervisorId === "string" ? { supervisorId: body.supervisorId } : {}),
    });

    res.status(201).json(annotation);
  });

  // ── GET /training/annotations/:annotationId ───────────────────────

  /**
   * Get a single annotation by ID.
   *
   * Returns 200 + the TurnAnnotation, or 404 when not found.
   */
  router.get("/annotations/:annotationId", (req, res) => {
    const { annotationId } = req.params;
    const annotation = service.getAnnotation(annotationId);

    if (!annotation) {
      res.status(404).json({ error: `Annotation not found: ${annotationId}` });
      return;
    }

    res.json(annotation);
  });

  // ── PATCH /training/annotations/:annotationId ─────────────────────

  /**
   * Update the label (and optionally note) of an annotation.
   *
   * Body: { label, note? }
   *
   * Returns 200 + updated TurnAnnotation, or 404 when not found.
   * Returns 400 when label is invalid.
   */
  router.patch("/annotations/:annotationId", (req, res) => {
    const { annotationId } = req.params;
    const body = req.body as Record<string, unknown>;

    if (!isValidLabel(body.label)) {
      res.status(400).json({
        error: `label must be one of: ${VALID_LABELS.join(", ")}`,
      });
      return;
    }

    const note = typeof body.note === "string" ? body.note : undefined;
    const updated = service.updateAnnotationLabel(annotationId, body.label, note);

    if (!updated) {
      res.status(404).json({ error: `Annotation not found: ${annotationId}` });
      return;
    }

    res.json(updated);
  });

  // ── DELETE /training/annotations/:annotationId ────────────────────

  /**
   * Delete an annotation.
   *
   * Returns 204 on success, 404 when not found.
   */
  router.delete("/annotations/:annotationId", (req, res) => {
    const { annotationId } = req.params;
    const deleted = service.deleteAnnotation(annotationId);

    if (!deleted) {
      res.status(404).json({ error: `Annotation not found: ${annotationId}` });
      return;
    }

    res.status(204).send();
  });

  // ── GET /training/datasets ────────────────────────────────────────

  /**
   * List all datasets.
   *
   * Returns: { datasets: TrainingDataset[], total: number }
   */
  router.get("/datasets", (_req, res) => {
    const datasets = service.listDatasets();
    res.json({ datasets, total: datasets.length });
  });

  // ── POST /training/datasets ───────────────────────────────────────

  /**
   * Build a new dataset from annotations matching the given filters.
   *
   * Body: { name, filters }
   *
   * Returns 201 + the created TrainingDataset.
   * Returns 400 when name is missing.
   */
  router.post("/datasets", (req, res) => {
    const body = req.body as Record<string, unknown>;

    const nameResult = requireString(body.name, "name");
    if ("error" in nameResult) {
      res.status(400).json({ error: nameResult.error });
      return;
    }

    const rawFilters = (body.filters ?? {}) as Record<string, unknown>;
    const filters = {
      ...(Array.isArray(rawFilters.labels) ? { labels: rawFilters.labels as AnnotationLabel[] } : {}),
      ...(Array.isArray(rawFilters.sessionIds) ? { sessionIds: rawFilters.sessionIds as string[] } : {}),
      ...(typeof rawFilters.from === "string" ? { from: rawFilters.from } : {}),
      ...(typeof rawFilters.to === "string" ? { to: rawFilters.to } : {}),
      ...(typeof rawFilters.tenantId === "string" ? { tenantId: rawFilters.tenantId } : {}),
    };

    const dataset = service.buildDataset(nameResult.value, filters);
    res.status(201).json(dataset);
  });

  // ── GET /training/datasets/:datasetId/export ──────────────────────

  /**
   * Export a dataset as OpenAI fine-tuning JSONL.
   *
   * Returns 200 with Content-Type application/x-ndjson.
   * Returns 404 when the dataset is not found.
   */
  router.get("/datasets/:datasetId/export", (req, res) => {
    const { datasetId } = req.params;
    const dataset = service.getDataset(datasetId);

    if (!dataset) {
      res.status(404).json({ error: `Dataset not found: ${datasetId}` });
      return;
    }

    const jsonl = service.exportJsonl(datasetId);

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="dataset-${datasetId}.jsonl"`,
    );
    res.status(200).send(jsonl);
  });

  // ── GET /training/export/good-examples ────────────────────────────

  /**
   * Export only "good_response" annotations as JSONL without pre-building a dataset.
   *
   * Query params:
   *   tenantId — optional tenant filter
   *   from     — optional ISO date lower bound (inclusive)
   *   to       — optional ISO date upper bound (inclusive)
   *
   * Returns 200 with Content-Type application/x-ndjson.
   */
  router.get("/export/good-examples", (req, res) => {
    const filters = {
      ...(typeof req.query.tenantId === "string"
        ? { tenantId: req.query.tenantId }
        : {}),
      ...(typeof req.query.from === "string" ? { from: req.query.from } : {}),
      ...(typeof req.query.to === "string" ? { to: req.query.to } : {}),
    };

    const jsonl = service.exportGoodExamplesJsonl(filters);

    res.setHeader("Content-Type", "application/x-ndjson");
    res.status(200).send(jsonl);
  });

  return router;
}
