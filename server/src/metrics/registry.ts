/**
 * Prometheus metrics registry — N-66.
 *
 * Four metrics exported per the directive:
 *   - httpRequestsTotal      (Counter)   — total HTTP requests by method/route/status
 *   - httpRequestDurationMs  (Histogram) — request duration in milliseconds
 *   - wsConnectionsActive    (Gauge)     — active WebSocket connections at scrape time
 *   - ttsProcessingDurationMs (Histogram) — TTS speech generation latency
 *
 * Design decisions:
 *   - Uses a non-default Registry so tests can create isolated instances without
 *     polluting the global prom-client default registry.
 *   - wsConnectionsActive uses a lazy getter injected at startup (setWsConnectionGetter)
 *     so the metrics module doesn't hold a reference to the WS server during import.
 *   - All metrics use milliseconds to match the rest of the codebase (latency in ms).
 */

import { Counter, Histogram, Gauge, Registry } from "prom-client";

/** Non-default Prometheus registry scoped to the voice-jib-jab service. */
export const register = new Registry();

register.setDefaultLabels({ service: "voice-jib-jab" });

// ── HTTP request counter ────────────────────────────────────────────────────

/** Counter: total HTTP requests by method, route, and status code. */
export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests received",
  labelNames: ["method", "route", "status"] as const,
  registers: [register],
});

// ── HTTP request duration histogram ────────────────────────────────────────
// Buckets chosen for sub-400ms latency target: granular below 400ms, coarser above.

/** Histogram: HTTP request duration in milliseconds with sub-400ms granularity. */
export const httpRequestDurationMs = new Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [5, 10, 25, 50, 100, 200, 400, 800, 1600, 3200],
  registers: [register],
});

// ── Active WebSocket connections gauge ─────────────────────────────────────
// Populated at scrape time via the injected getter to avoid circular imports.

let _getWsCount: (() => number) | null = null;

/** Inject a getter for the active WebSocket count, called at scrape time. */
export function setWsConnectionGetter(fn: () => number): void {
  _getWsCount = fn;
}

/** Gauge: number of active WebSocket connections, populated via lazy getter. */
export const wsConnectionsActive = new Gauge({
  name: "ws_connections_active",
  help: "Number of active WebSocket connections",
  registers: [register],
  collect() {
    this.set(_getWsCount ? _getWsCount() : 0);
  },
});

// ── TTS processing duration histogram ──────────────────────────────────────
// Buckets cover the expected 50–2000ms range for OpenAI TTS API calls.

/** Histogram: TTS speech generation latency in milliseconds. */
export const ttsProcessingDurationMs = new Histogram({
  name: "tts_processing_duration_ms",
  help: "TTS speech generation duration in milliseconds",
  buckets: [50, 100, 250, 500, 1000, 2000, 5000],
  registers: [register],
});
