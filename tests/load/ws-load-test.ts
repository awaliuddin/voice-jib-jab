/**
 * WebSocket Load Test — N-10 Production Readiness SLA Baseline
 *
 * Simulates N concurrent WebSocket sessions against the voice-jib-jab server
 * to determine the concurrency ceiling before latency degrades past the SLA
 * target (p95 TTFB < 1200ms, from NEXUS).
 *
 * Architecture:
 *   1. A mock OpenAI Realtime WebSocket server is started (responds to the
 *      adapter protocol with synthetic audio/transcript events).
 *   2. The real voice-jib-jab Express+WS server is started, configured to
 *      connect Lane B to the mock OpenAI instead of the real API.
 *   3. N WebSocket clients connect in parallel and execute a 3-turn
 *      conversation script, measuring per-turn TTFB.
 *
 * Usage:
 *   npx tsx tests/load/ws-load-test.ts [--concurrency 5,10,20]
 *
 * Constraints:
 *   - No real OpenAI API key required (mock server).
 *   - Measures, does not optimize.
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer, Server as HttpServer } from "http";

// ── Types ────────────────────────────────────────────────────────────────

interface TurnResult {
  clientId: number;
  turn: number;
  ttfbMs: number;
  totalMs: number;
  success: boolean;
  error?: string;
}

interface SessionResult {
  clientId: number;
  connectMs: number;
  turns: TurnResult[];
  disconnectClean: boolean;
}

interface LoadTestResult {
  concurrency: number;
  sessions: SessionResult[];
  aggregate: {
    totalSessions: number;
    successfulSessions: number;
    failedSessions: number;
    ttfb: { p50: number; p95: number; p99: number; max: number; avg: number };
    turnTotal: { p50: number; p95: number; max: number; avg: number };
    connectTime: { p50: number; p95: number; avg: number };
  };
}

// ── Mock OpenAI Realtime Server ──────────────────────────────────────────

/**
 * Simulates the OpenAI Realtime WebSocket API. When the voice-jib-jab server
 * connects Lane B, this mock responds with the correct protocol messages:
 *   - session.created on connect
 *   - response.created / response.audio.delta / response.audio_transcript.delta /
 *     response.done when input_audio_buffer.commit or response.create is received
 */
async function createMockOpenAIServer(): Promise<{ server: HttpServer; port: number; close: () => Promise<void> }> {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    // Send session.created immediately (OpenAI protocol)
    ws.send(JSON.stringify({
      type: "session.created",
      session: {
        id: `mock-${Date.now()}`,
        model: "gpt-4o-realtime-preview",
        modalities: ["text", "audio"],
        voice: "alloy",
      },
    }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMockMessage(ws, msg);
      } catch {
        // Ignore binary data
      }
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        server: httpServer,
        port,
        close: () => new Promise<void>((res) => {
          wss.close(() => httpServer.close(() => res()));
        }),
      });
    });
  });
}

// Synthetic 100ms of PCM16 audio at 24kHz = 4800 bytes
const MOCK_AUDIO_CHUNK = Buffer.alloc(4800).toString("base64");

function handleMockMessage(ws: WebSocket, msg: any): void {
  switch (msg.type) {
    case "session.update":
      ws.send(JSON.stringify({ type: "session.updated", session: msg.session || {} }));
      break;

    case "input_audio_buffer.append":
      // No server event for append — just accumulate
      break;

    case "input_audio_buffer.commit":
      // Simulate the OpenAI flow: committed → speech events → transcript
      // Do NOT send a response here — the adapter will send response.create after
      // receiving committed, and THAT triggers the response flow.
      ws.send(JSON.stringify({ type: "input_audio_buffer.committed" }));
      ws.send(JSON.stringify({
        type: "input_audio_buffer.speech_started",
        audio_start_ms: 0,
      }));
      ws.send(JSON.stringify({
        type: "input_audio_buffer.speech_stopped",
        audio_end_ms: 500,
      }));
      ws.send(JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "Hello, this is a load test message.",
      }));
      break;

    case "response.create":
      simulateResponse(ws);
      break;

    case "response.cancel":
      ws.send(JSON.stringify({ type: "response.cancelled" }));
      break;

    case "input_audio_buffer.clear":
      ws.send(JSON.stringify({ type: "input_audio_buffer.cleared" }));
      break;
  }
}

function simulateResponse(ws: WebSocket): void {
  const responseId = `resp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // response.created — Lane B measures TTFB from here
  ws.send(JSON.stringify({
    type: "response.created",
    response: { id: responseId, status: "in_progress" },
  }));

  // 20ms simulated "thinking" time (fast mock)
  setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) return;

    // 3 audio chunks
    for (let i = 0; i < 3; i++) {
      ws.send(JSON.stringify({
        type: "response.audio.delta",
        delta: MOCK_AUDIO_CHUNK,
        response_id: responseId,
      }));
    }

    // Transcript
    ws.send(JSON.stringify({
      type: "response.audio_transcript.delta",
      delta: "This is a mock response for load testing.",
      response_id: responseId,
    }));
    ws.send(JSON.stringify({
      type: "response.audio_transcript.done",
      transcript: "This is a mock response for load testing.",
      response_id: responseId,
    }));

    // response.done
    ws.send(JSON.stringify({
      type: "response.done",
      response: {
        id: responseId,
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "audio", transcript: "This is a mock response for load testing." }],
        }],
      },
    }));
  }, 20);
}

// ── Voice-Jib-Jab Server (with mock OpenAI) ─────────────────────────────

async function startVoiceServer(mockOpenAIPort: number): Promise<{ port: number; close: () => Promise<void> }> {
  // Set environment BEFORE importing server modules (config reads env at import time)
  process.env.OPENAI_API_KEY = "sk-mock-load-test";
  process.env.OPENAI_REALTIME_URL = `ws://127.0.0.1:${mockOpenAIPort}`;
  process.env.ENABLE_PERSISTENT_MEMORY = "false";
  process.env.ENABLE_AUDIT_TRAIL = "false";
  process.env.ENABLE_RAG = "false";
  process.env.ENABLE_LANE_A = "false"; // Skip TTS preload (needs real API key)
  process.env.ENABLE_POLICY_GATE = "true"; // Keep policy gate on — it's part of the load
  process.env.NODE_ENV = "test";

  // Dynamic import so env vars are picked up by config loader
  const express = (await import("express")).default;
  const { VoiceWebSocketServer } = await import("../../server/src/api/websocket.js");

  const app = express();
  const httpServer = createServer(app);
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  new VoiceWebSocketServer(httpServer);

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => new Promise<void>((res) => httpServer.close(() => res())),
      });
    });
  });
}

// ── Generate audio data that passes the RMS energy gate ─────────────────

/**
 * The server drops audio chunks with RMS < 200 (silence gate, see websocket.ts).
 * Generate a PCM16 buffer with a 1kHz sine wave loud enough to pass the gate.
 * 100ms at 24kHz = 2400 samples = 4800 bytes.
 */
function generateLoudAudioChunk(): string {
  const sampleRate = 24000;
  const durationSec = 0.1;
  const frequency = 1000; // 1kHz tone
  const amplitude = 8000; // Well above RMS 200 threshold
  const numSamples = sampleRate * durationSec;
  const buf = Buffer.alloc(numSamples * 2); // 16-bit PCM

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate));
    buf.writeInt16LE(sample, i * 2);
  }
  return buf.toString("base64");
}

const LOUD_AUDIO_CHUNK = generateLoudAudioChunk();

// ── Client Session Simulation ────────────────────────────────────────────

function runClientSession(
  serverPort: number,
  clientId: number,
  numTurns: number,
  timeoutMs: number,
): Promise<SessionResult> {
  return new Promise((resolve) => {
    const result: SessionResult = {
      clientId,
      connectMs: 0,
      turns: [],
      disconnectClean: false,
    };

    const connectStart = performance.now();
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);
    let resolved = false;

    let currentTurn = 0;
    let turnStart = 0;
    let gotFirstResponse = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      for (let t = currentTurn; t < numTurns; t++) {
        if (!result.turns[t]) {
          result.turns.push({
            clientId, turn: t, ttfbMs: -1, totalMs: -1,
            success: false, error: "timeout",
          });
        }
      }
      try { ws.close(); } catch {}
      resolved = true;
      resolve(result);
    }, timeoutMs);

    ws.on("open", () => {
      result.connectMs = performance.now() - connectStart;
    });

    ws.on("message", (data) => {
      if (resolved) return;
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "session.ready") {
          ws.send(JSON.stringify({
            type: "session.start",
            voiceMode: "push-to-talk",
            fingerprint: `load-test-${clientId}`,
          }));
        }

        if (msg.type === "provider.ready") {
          // Provider connected to mock OpenAI — start first turn
          startTurn();
        }

        // TTFB: first response.start after we sent audio
        if (msg.type === "response.start" && !gotFirstResponse && turnStart > 0) {
          gotFirstResponse = true;
          const ttfb = performance.now() - turnStart;
          if (!result.turns[currentTurn]) {
            result.turns[currentTurn] = {
              clientId, turn: currentTurn, ttfbMs: ttfb, totalMs: -1, success: false,
            };
          } else {
            result.turns[currentTurn].ttfbMs = ttfb;
          }
        }

        // Turn complete: response.end
        if (msg.type === "response.end" && turnStart > 0) {
          const totalMs = performance.now() - turnStart;
          result.turns[currentTurn] = {
            clientId,
            turn: currentTurn,
            ttfbMs: result.turns[currentTurn]?.ttfbMs ?? totalMs,
            totalMs,
            success: true,
          };
          currentTurn++;
          gotFirstResponse = false;
          turnStart = 0;

          if (currentTurn < numTurns) {
            // Must exceed RESPONSE_COOLDOWN_MS (1500ms) or server drops audio
            setTimeout(() => startTurn(), 2000);
          } else {
            // All turns complete — disconnect cleanly
            ws.send(JSON.stringify({ type: "session.end" }));
          }
        }
      } catch {
        // Ignore parse errors on binary frames
      }
    });

    ws.on("close", () => {
      if (resolved) return;
      clearTimeout(timer);
      result.disconnectClean = currentTurn >= numTurns;
      resolved = true;
      resolve(result);
    });

    ws.on("error", (err) => {
      if (resolved) return;
      clearTimeout(timer);
      for (let t = currentTurn; t < numTurns; t++) {
        if (!result.turns[t]) {
          result.turns.push({
            clientId, turn: t, ttfbMs: -1, totalMs: -1,
            success: false, error: err.message,
          });
        }
      }
      resolved = true;
      resolve(result);
    });

    function startTurn(): void {
      turnStart = performance.now();
      gotFirstResponse = false;

      // Send 3 audio chunks with energy above the RMS gate threshold
      for (let i = 0; i < 3; i++) {
        ws.send(JSON.stringify({
          type: "audio.chunk",
          data: LOUD_AUDIO_CHUNK,
          format: "pcm",
          sampleRate: 24000,
        }));
      }

      // Commit audio to trigger response
      ws.send(JSON.stringify({ type: "audio.commit" }));
    }
  });
}

// ── Stats Helpers ────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeStats(results: SessionResult[]): LoadTestResult["aggregate"] {
  const ttfbs: number[] = [];
  const totals: number[] = [];
  const connects: number[] = [];
  let successfulSessions = 0;
  let failedSessions = 0;

  for (const s of results) {
    connects.push(s.connectMs);
    const allSuccess = s.turns.length > 0 && s.turns.every((t) => t.success);
    if (allSuccess) successfulSessions++;
    else failedSessions++;

    for (const t of s.turns) {
      if (t.success) {
        ttfbs.push(t.ttfbMs);
        totals.push(t.totalMs);
      }
    }
  }

  ttfbs.sort((a, b) => a - b);
  totals.sort((a, b) => a - b);
  connects.sort((a, b) => a - b);

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    totalSessions: results.length,
    successfulSessions,
    failedSessions,
    ttfb: {
      p50: percentile(ttfbs, 50),
      p95: percentile(ttfbs, 95),
      p99: percentile(ttfbs, 99),
      max: ttfbs.length > 0 ? ttfbs[ttfbs.length - 1] : 0,
      avg: avg(ttfbs),
    },
    turnTotal: {
      p50: percentile(totals, 50),
      p95: percentile(totals, 95),
      max: totals.length > 0 ? totals[totals.length - 1] : 0,
      avg: avg(totals),
    },
    connectTime: {
      p50: percentile(connects, 50),
      p95: percentile(connects, 95),
      avg: avg(connects),
    },
  };
}

// ── Main Runner ──────────────────────────────────────────────────────────

async function runLoadTest(
  concurrency: number,
  serverPort: number,
  turnsPerSession: number = 3,
  sessionTimeoutMs: number = 60_000,
): Promise<LoadTestResult> {
  console.log(
    `\n  Running: ${concurrency} concurrent sessions, ${turnsPerSession} turns each...`,
  );

  const promises: Promise<SessionResult>[] = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(
      runClientSession(serverPort, i, turnsPerSession, sessionTimeoutMs),
    );
  }

  const sessions = await Promise.all(promises);
  const aggregate = computeStats(sessions);

  return { concurrency, sessions, aggregate };
}

function printResult(result: LoadTestResult): void {
  const { concurrency, aggregate: a } = result;
  const slaExceeded = a.ttfb.p95 > 1200;

  console.log(
    `\n  ┌─── N=${concurrency} ${"─".repeat(46 - String(concurrency).length)}┐`,
  );
  console.log(
    `  │ Sessions: ${a.successfulSessions}/${a.totalSessions} successful`,
  );
  console.log(
    `  │ TTFB  p50: ${a.ttfb.p50.toFixed(1)}ms  p95: ${a.ttfb.p95.toFixed(1)}ms  p99: ${a.ttfb.p99.toFixed(1)}ms  max: ${a.ttfb.max.toFixed(1)}ms`,
  );
  console.log(
    `  │ Turn  p50: ${a.turnTotal.p50.toFixed(1)}ms  p95: ${a.turnTotal.p95.toFixed(1)}ms  max: ${a.turnTotal.max.toFixed(1)}ms`,
  );
  console.log(
    `  │ Conn  p50: ${a.connectTime.p50.toFixed(1)}ms  p95: ${a.connectTime.p95.toFixed(1)}ms`,
  );
  console.log(
    `  │ SLA (p95 TTFB < 1200ms): ${slaExceeded ? "EXCEEDED" : "PASS"}`,
  );
  console.log(`  └${"─".repeat(50)}┘`);
}

// ── Entrypoint ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let concurrencyLevels = [5, 10, 20];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--concurrency" && args[i + 1]) {
      concurrencyLevels = args[i + 1]
        .split(",")
        .map(Number)
        .filter((n) => n > 0);
    }
  }

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  voice-jib-jab Load Test — N-10 SLA Baseline           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // 1. Start mock OpenAI
  console.log("\n  Starting mock OpenAI Realtime server...");
  const mockOpenAI = await createMockOpenAIServer();
  console.log(`  Mock OpenAI listening on port ${mockOpenAI.port}`);

  // 2. Start voice-jib-jab server
  console.log("  Starting voice-jib-jab server...");
  let voiceServer: { port: number; close: () => Promise<void> };
  try {
    voiceServer = await startVoiceServer(mockOpenAI.port);
  } catch (err) {
    console.error("  Failed to start voice server:", err);
    await mockOpenAI.close();
    process.exit(1);
  }
  console.log(`  Voice server listening on port ${voiceServer.port}`);

  // 3. Run load tests at each concurrency level
  const results: LoadTestResult[] = [];

  for (const n of concurrencyLevels) {
    // Let connections drain between levels
    await new Promise((r) => setTimeout(r, 1000));
    const result = await runLoadTest(n, voiceServer.port);
    printResult(result);
    results.push(result);
  }

  // 4. Summary
  console.log("\n  ╔═══════════════════════════════════════════════════════╗");
  console.log("  ║  Summary                                              ║");
  console.log("  ╠═══════════════════════════════════════════════════════╣");
  const slaBreakpoint = results.find((r) => r.aggregate.ttfb.p95 > 1200);
  if (slaBreakpoint) {
    console.log(
      `  ║  SLA breached at N=${slaBreakpoint.concurrency} (p95 TTFB: ${slaBreakpoint.aggregate.ttfb.p95.toFixed(1)}ms > 1200ms)`,
    );
  } else {
    console.log(`  ║  SLA NOT breached at any tested concurrency level.`);
    const maxN = concurrencyLevels[concurrencyLevels.length - 1];
    console.log(
      `  ║  Server handles ${maxN} concurrent sessions within SLA.`,
    );
  }
  console.log("  ╚═══════════════════════════════════════════════════════╝");

  // 5. Output JSON for docs
  const jsonOutput = results.map((r) => ({
    concurrency: r.concurrency,
    sessions: r.aggregate.totalSessions,
    successful: r.aggregate.successfulSessions,
    failed: r.aggregate.failedSessions,
    ttfb_p50_ms: Number(r.aggregate.ttfb.p50.toFixed(1)),
    ttfb_p95_ms: Number(r.aggregate.ttfb.p95.toFixed(1)),
    ttfb_p99_ms: Number(r.aggregate.ttfb.p99.toFixed(1)),
    ttfb_max_ms: Number(r.aggregate.ttfb.max.toFixed(1)),
    turn_p50_ms: Number(r.aggregate.turnTotal.p50.toFixed(1)),
    turn_p95_ms: Number(r.aggregate.turnTotal.p95.toFixed(1)),
    connect_p50_ms: Number(r.aggregate.connectTime.p50.toFixed(1)),
    connect_p95_ms: Number(r.aggregate.connectTime.p95.toFixed(1)),
    sla_pass: r.aggregate.ttfb.p95 <= 1200,
  }));
  console.log("\n  JSON (for docs/load-test-results.md):");
  console.log(JSON.stringify(jsonOutput, null, 2));

  // 6. Cleanup
  await voiceServer.close();
  await mockOpenAI.close();

  process.exit(0);
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
