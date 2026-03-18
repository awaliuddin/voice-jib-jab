/**
 * Voice Jib-Jab Server Entry Point
 * NextGen AI Voice Orchestrator
 */

import express from "express";
import { createServer } from "http";
import { dirname, resolve } from "path";
import { config } from "./config/index.js";
import { VoiceWebSocketServer } from "./api/websocket.js";
import { sessionManager } from "./orchestrator/SessionManager.js";
import { OpaEvaluator } from "./insurance/opa_evaluator.js";
import { SessionRecorder } from "./services/SessionRecorder.js";
import { createSessionsRouter } from "./api/sessions.js";
import { createAdminRouter } from "./api/admin.js";
import { createVoiceRouter } from "./api/voice.js";
import { AnalyticsService } from "./services/AnalyticsService.js";
import { createAnalyticsRouter } from "./api/analytics.js";
import { tenantRegistry, initTenantRegistry } from "./services/TenantRegistry.js";
import { systemConfigStore } from "./services/SystemConfigStore.js";
import { VoiceTriggerService } from "./services/VoiceTriggerService.js";
import { initConversationMemoryStore } from "./services/ConversationMemoryStore.js";
import { createMemoryRouter } from "./api/memory.js";
import { createRateLimiter } from "./middleware/rateLimiter.js";
import { securityHeaders } from "./middleware/securityHeaders.js";

const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());

// Security headers
app.use(securityHeaders);

// CORS for development
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept",
  );
  next();
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    sessions: sessionManager.getSessionCount(),
  });
});

// Status endpoint
app.get("/status", (_req, res) => {
  const activeSessions = sessionManager.getActiveSessions();

  res.json({
    status: "running",
    version: "0.1.0",
    activeSessions: activeSessions.length,
    sessions: activeSessions.map((s) => ({
      id: s.id,
      state: s.state,
      uptime: Date.now() - s.createdAt,
    })),
    config: {
      features: config.features,
      latencyTargets: config.latency,
    },
  });
});

// Metrics endpoint
app.get("/metrics", (_req, res) => {
  const activeSessions = sessionManager.getActiveSessions();
  res.json({
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    sessions: {
      active: activeSessions.length,
      total: sessionManager.getSessionCount(),
    },
    memory: {
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heap_used_mb: Math.round(
        process.memoryUsage().heapUsed / 1024 / 1024,
      ),
      heap_total_mb: Math.round(
        process.memoryUsage().heapTotal / 1024 / 1024,
      ),
    },
    session_detail: activeSessions.map((s) => ({
      id: s.id,
      state: s.state,
      uptime_ms: Date.now() - s.createdAt,
    })),
  });
});

// Dashboard endpoint — inline HTML with auto-refresh metrics display
app.get("/dashboard", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>voice-jib-jab — Live Metrics</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0f; color: #fff; font-family: 'Courier New', monospace; padding: 2rem; }
    h1 { color: #3b82f6; margin-bottom: 0.5rem; font-size: 1.4rem; }
    .updated { color: #888; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #111118; border: 1px solid #1e1e2e; border-radius: 8px; padding: 1rem; }
    .card .label { color: #888; font-size: 0.75rem; text-transform: uppercase; }
    .card .value { color: #3b82f6; font-size: 1.8rem; font-weight: bold; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.5rem 1rem; border-bottom: 1px solid #1e1e2e; }
    th { color: #3b82f6; font-size: 0.75rem; text-transform: uppercase; }
    td { color: #ccc; }
    #no-sessions { color: #555; padding: 1rem; }
  </style>
</head>
<body>
  <h1>voice-jib-jab &mdash; Live Metrics</h1>
  <div class="updated" id="updated">Last updated: --:--:--</div>
  <div class="grid">
    <div class="card"><div class="label">Uptime</div><div class="value" id="uptime">--</div></div>
    <div class="card"><div class="label">Active Sessions</div><div class="value" id="active">--</div></div>
    <div class="card"><div class="label">RSS (MB)</div><div class="value" id="rss">--</div></div>
    <div class="card"><div class="label">Heap Used (MB)</div><div class="value" id="heap-used">--</div></div>
    <div class="card"><div class="label">Heap Total (MB)</div><div class="value" id="heap-total">--</div></div>
  </div>
  <h2 style="color:#3b82f6;font-size:1rem;margin-bottom:0.5rem;">Active Sessions</h2>
  <table>
    <thead><tr><th>ID</th><th>State</th><th>Uptime (s)</th></tr></thead>
    <tbody id="sessions"><tr><td id="no-sessions" colspan="3">Loading...</td></tr></tbody>
  </table>
  <script>
    async function refresh() {
      try {
        const r = await fetch('/metrics');
        const d = await r.json();
        document.getElementById('uptime').textContent = d.uptime_seconds + 's';
        document.getElementById('active').textContent = d.sessions.active;
        document.getElementById('rss').textContent = d.memory.rss_mb;
        document.getElementById('heap-used').textContent = d.memory.heap_used_mb;
        document.getElementById('heap-total').textContent = d.memory.heap_total_mb;
        const tb = document.getElementById('sessions');
        if (d.session_detail.length === 0) {
          tb.innerHTML = '<tr><td id="no-sessions" colspan="3">No active sessions</td></tr>';
        } else {
          tb.innerHTML = d.session_detail.map(s =>
            '<tr><td>' + s.id + '</td><td>' + s.state + '</td><td>' + Math.round(s.uptime_ms / 1000) + '</td></tr>'
          ).join('');
        }
        const now = new Date();
        document.getElementById('updated').textContent =
          'Last updated: ' + now.toTimeString().split(' ')[0];
      } catch (e) { console.error('Fetch failed', e); }
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`);
});

// ── OPA singleton initialization ─────────────────────────────────────────
// WASM bundle loads once at startup and is shared across all sessions via the
// JS event loop (single-threaded — no locking required).
// Enable with ENABLE_OPA=true; bundle built by scripts/build-policy.sh.
async function initializeOpa(): Promise<OpaEvaluator | undefined> {
  if (!config.opa.enabled) return undefined;

  const evaluator = new OpaEvaluator(config.opa.bundlePath);
  try {
    await evaluator.initialize();
    console.log("[Server] OPA policy engine initialized");
    return evaluator;
  } catch (error) {
    console.warn(
      "[Server] OPA initialization failed — falling back to pattern-only moderation:",
      error,
    );
    return undefined;
  }
}

// ── Startup ───────────────────────────────────────────────────────────────

// ── Session Recorder singleton ────────────────────────────────────────
export const sessionRecorder = new SessionRecorder({
  recordingsDir: resolve(dirname(config.storage.databasePath), "recordings"),
  storeRawAudio: config.safety.storeRawAudio,
  retentionDays: 7,
});

// ── Rate limiters ────────────────────────────────────────────────────
const adminLimiter = createRateLimiter({ windowMs: 60_000, max: 30, message: "Admin API rate limit exceeded" });
const voiceLimiter = createRateLimiter({ windowMs: 60_000, max: 10, message: "Voice API rate limit exceeded" });
const analyticsLimiter = createRateLimiter({ windowMs: 60_000, max: 60, message: "Analytics API rate limit exceeded" });
const sessionsLimiter = createRateLimiter({ windowMs: 60_000, max: 60, message: "Sessions API rate limit exceeded" });

// Mount sessions API
app.use("/sessions", sessionsLimiter, createSessionsRouter(sessionRecorder));

// ── Analytics Service + API ───────────────────────────────────────────
const analyticsService = new AnalyticsService(sessionRecorder);
app.use("/analytics", analyticsLimiter, createAnalyticsRouter(analyticsService));

// ── Tenant Registry + Admin API ──────────────────────────────────────
initTenantRegistry(resolve(dirname(config.storage.databasePath), "tenants.json"));
app.use("/admin", adminLimiter, createAdminRouter(tenantRegistry, systemConfigStore));

// ── Conversation Memory Store + API ─────────────────────────────────
const memoryStore = initConversationMemoryStore(resolve(dirname(config.storage.databasePath), "memory"));
app.use("/tenants", createMemoryRouter(memoryStore));

// ── Voice Trigger Service + Voice API ────────────────────────────────
export const voiceTriggerService = new VoiceTriggerService(
  `http://localhost:${config.port}`,
  systemConfigStore,
);
app.use("/voice", voiceLimiter, createVoiceRouter(voiceTriggerService, `http://localhost:${config.port}`));

async function startServer(): Promise<void> {
  // Initialize OPA singleton before accepting any sessions
  const opaEvaluator = await initializeOpa();

  // Initialize WebSocket server — passes pre-initialized OPA singleton
  // so every per-session ControlEngine receives the same loaded bundle.
  new VoiceWebSocketServer(server, opaEvaluator, sessionRecorder, voiceTriggerService, memoryStore);

  server.listen(config.port, () => {
    console.log(
      "\n╔══════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║                                                          ║",
    );
    console.log(
      "║  🎙️  Voice Jib-Jab Server                                ║",
    );
    console.log(
      "║  NextGen AI Voice Orchestrator                           ║",
    );
    console.log(
      "║                                                          ║",
    );
    console.log(
      "╚══════════════════════════════════════════════════════════╝\n",
    );

    console.log(`[Server] Listening on port ${config.port}`);
    console.log(`[Server] Environment: ${config.nodeEnv}`);
    console.log(`[Server] WebSocket: ws://localhost:${config.port}`);
    console.log(`[Server] Health: http://localhost:${config.port}/health`);
    console.log(`[Server] Status: http://localhost:${config.port}/status`);
    console.log(`[Server] Metrics: http://localhost:${config.port}/metrics`);
    console.log(`[Server] Dashboard: http://localhost:${config.port}/dashboard`);
    console.log(`[Server] Sessions: http://localhost:${config.port}/sessions`);
    console.log(`[Server] Analytics: http://localhost:${config.port}/analytics/sessions`);
    console.log(`[Server] Admin API: http://localhost:${config.port}/admin`);
    console.log(`[Server] Memory API: http://localhost:${config.port}/tenants/{tenantId}/memory`);
    console.log(`[Server] Voice Triggers: http://localhost:${config.port}/voice/trigger\n`);

    console.log("Features:");
    console.log(
      `  Lane A (Reflex): ${config.features.enableLaneA ? "✓" : "✗"}`,
    );
    console.log(`  RAG: ${config.features.enableRAG ? "✓" : "✗"}`);
    console.log(
      `  Policy Gate: ${config.features.enablePolicyGate ? "✓" : "✗"}`,
    );
    console.log(
      `  Audit Trail: ${config.features.enableAuditTrail ? "✓" : "✗"}`,
    );
    console.log(`  OPA Engine: ${opaEvaluator ? "✓" : "✗ (disabled)"}\n`);

    console.log("Latency Targets:");
    console.log(`  TTFB p50: <${config.latency.ttfbTargetP50}ms`);
    console.log(`  TTFB p95: <${config.latency.ttfbTargetP95}ms`);
    console.log(`  Barge-in p95: <${config.latency.bargeInTargetP95}ms\n`);

    console.log("Ready for connections! 🚀\n");
  });
}

startServer().catch((error) => {
  console.error("[Server] Fatal startup error:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n[Server] SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("[Server] HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\n[Server] SIGINT received, shutting down gracefully...");
  server.close(() => {
    console.log("[Server] HTTP server closed");
    process.exit(0);
  });
});
