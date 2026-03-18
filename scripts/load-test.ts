#!/usr/bin/env npx tsx
/**
 * Load Test — voice-jib-jab
 *
 * Measures HTTP health endpoint latency and WebSocket connection capacity
 * across multiple concurrency levels. Designed to run against a live server.
 *
 * Usage:
 *   npx tsx scripts/load-test.ts
 *   PORT=8080 npx tsx scripts/load-test.ts
 */

import http from "node:http";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const BASE_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}`;

const HTTP_REQUEST_COUNT = 100;
const WS_CONCURRENCY_LEVELS = [10, 50, 100];
const WS_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Utility: percentile from sorted array
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const index = Math.floor(sorted.length * p);
  const clamped = Math.min(index, sorted.length - 1);
  return sorted[clamped] ?? 0;
}

function formatMs(ms: number): string {
  return ms < 1 ? `${ms.toFixed(3)}ms` : `${ms.toFixed(1)}ms`;
}

// ---------------------------------------------------------------------------
// HTTP /health latency test
// ---------------------------------------------------------------------------

interface HttpResult {
  p50: number;
  p95: number;
  errors: number;
}

function httpGet(url: string): Promise<{ status: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = http.get(url, (res) => {
      // Consume response body to free the socket.
      res.resume();
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, durationMs: performance.now() - t0 });
      });
    });
    req.on("error", (err) => reject(err));
    req.setTimeout(5_000, () => {
      req.destroy(new Error("HTTP request timed out"));
    });
  });
}

async function runHttpHealthTest(): Promise<HttpResult> {
  const timings: number[] = [];
  let errors = 0;

  for (let i = 0; i < HTTP_REQUEST_COUNT; i++) {
    try {
      const { durationMs } = await httpGet(`${BASE_URL}/health`);
      timings.push(durationMs);
    } catch {
      errors++;
    }
  }

  timings.sort((a, b) => a - b);

  return {
    p50: percentile(timings, 0.5),
    p95: percentile(timings, 0.95),
    errors,
  };
}

// ---------------------------------------------------------------------------
// WebSocket concurrency test
// ---------------------------------------------------------------------------

interface WsSessionResult {
  connected: boolean;
  connectMs: number;
  responseMs: number;
}

function testWsSession(): Promise<WsSessionResult> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let connectMs = 0;
    let resolved = false;

    const finish = (result: WsSessionResult): void => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        // Ignore close errors during cleanup.
      }
      resolve(result);
    };

    const ws = new WebSocket(WS_URL);

    const timeout = setTimeout(() => {
      finish({ connected: false, connectMs: 0, responseMs: 0 });
    }, WS_TIMEOUT_MS);

    ws.on("open", () => {
      connectMs = performance.now() - t0;
      const sendTime = performance.now();
      ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));

      ws.on("message", () => {
        clearTimeout(timeout);
        finish({
          connected: true,
          connectMs,
          responseMs: performance.now() - sendTime,
        });
      });

      // If server does not respond to the ping within the timeout,
      // still record a successful connection with no response time.
      setTimeout(() => {
        clearTimeout(timeout);
        finish({ connected: true, connectMs, responseMs: 0 });
      }, WS_TIMEOUT_MS - connectMs);
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      finish({ connected: false, connectMs: 0, responseMs: 0 });
    });
  });
}

interface WsConcurrencyResult {
  level: number;
  connectedCount: number;
  avgConnectMs: number;
  p95ConnectMs: number;
}

async function runWsConcurrencyTest(level: number): Promise<WsConcurrencyResult> {
  const promises = Array.from({ length: level }, () => testWsSession());
  const settled = await Promise.allSettled(promises);

  const results: WsSessionResult[] = settled
    .filter((s): s is PromiseFulfilledResult<WsSessionResult> => s.status === "fulfilled")
    .map((s) => s.value);

  const connected = results.filter((r) => r.connected);
  const connectTimes = connected.map((r) => r.connectMs).sort((a, b) => a - b);

  const avgConnect =
    connectTimes.length > 0
      ? connectTimes.reduce((sum, v) => sum + v, 0) / connectTimes.length
      : 0;

  return {
    level,
    connectedCount: connected.length,
    avgConnectMs: avgConnect,
    p95ConnectMs: percentile(connectTimes, 0.95),
  };
}

// ---------------------------------------------------------------------------
// Server reachability check
// ---------------------------------------------------------------------------

async function checkServerReachable(): Promise<boolean> {
  try {
    await httpGet(`${BASE_URL}/health`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n=== voice-jib-jab Load Test ===`);
  console.log(`Target: ${BASE_URL} / ${WS_URL}\n`);

  const reachable = await checkServerReachable();
  if (!reachable) {
    console.error(
      `ERROR: Server not reachable at ${BASE_URL}/health\n` +
        `\n` +
        `Start the server first:\n` +
        `  cd server && npm run dev\n` +
        `\n` +
        `Or set a custom port:\n` +
        `  PORT=8080 npx tsx scripts/load-test.ts\n`,
    );
    process.exit(1);
  }

  // --- HTTP /health ---
  console.log(`HTTP /health (n=${HTTP_REQUEST_COUNT}):`);
  const httpResult = await runHttpHealthTest();
  console.log(
    `  p50: ${formatMs(httpResult.p50)}  p95: ${formatMs(httpResult.p95)}  errors: ${httpResult.errors}`,
  );

  // --- WebSocket concurrency ---
  console.log(`\nWebSocket concurrent sessions:`);

  for (const level of WS_CONCURRENCY_LEVELS) {
    const result = await runWsConcurrencyTest(level);
    const pad = String(level).padStart(3, " ");
    console.log(
      `  ${pad} concurrent:  connected: ${result.connectedCount}/${level}` +
        `  avg_connect: ${formatMs(result.avgConnectMs)}` +
        `  p95_connect: ${formatMs(result.p95ConnectMs)}`,
    );
  }

  console.log(`\nDone.\n`);
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
