/**
 * Voice Jib-Jab Server Entry Point
 * NextGen AI Voice Orchestrator
 */

import express from "express";
import { createServer } from "http";
import { config } from "./config/index.js";
import { VoiceWebSocketServer } from "./api/websocket.js";
import { sessionManager } from "./orchestrator/SessionManager.js";
import { OpaEvaluator } from "./insurance/opa_evaluator.js";

const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());

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

async function startServer(): Promise<void> {
  // Initialize OPA singleton before accepting any sessions
  const opaEvaluator = await initializeOpa();

  // Initialize WebSocket server — passes pre-initialized OPA singleton
  // so every per-session ControlEngine receives the same loaded bundle.
  new VoiceWebSocketServer(server, opaEvaluator);

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
    console.log(`[Server] Status: http://localhost:${config.port}/status\n`);

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
