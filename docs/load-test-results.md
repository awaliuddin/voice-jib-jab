# Load Test Results — Breaking Point Analysis

**Date**: 2026-03-20  
**Node.js**: v22.21.1  
**SLA Target**: TTFB p95 < 1200ms  
**Breaking criteria**: Error rate > 10% OR p95 > 1200ms OR p95 > 5x baseline

## Executive Summary

| Metric | Value |
|--------|-------|
| Breaking point | **N=100** — Error rate 24.0% > 10% |
| Max safe concurrency | **N=50** |
| Baseline TTFB p95 (N=5) | 62.7ms |
| Breaking TTFB p95 | 200.2ms |
| Degradation factor | 3.2x |

## Test Setup

| Parameter | Value |
|-----------|-------|
| Server | voice-jib-jab (Express + ws) |
| OpenAI API | Mocked (20ms simulated thinking) |
| Turns per session | 3 |
| Inter-turn delay | 2000ms (echo-cancellation cooldown) |
| Lane A | Disabled |
| Lane C (PolicyGate) | Enabled |
| Persistent Memory | Disabled |
| Audit Trail | Disabled |
| Platform | Linux (WSL2) |

## HTTP Endpoint Load

### GET /health

| Concurrency | Requests | p50 | p95 | p99 | Max | Throughput | Error Rate |
|-------------|----------|-----|-----|-----|-----|------------|------------|
| 10 | 200 | 2.5ms | 4.7ms | 15.7ms | 18.8ms | 3090.4 rps | 0.0% |
| 50 | 200 | 4.3ms | 73.3ms | 96.9ms | 97.2ms | 2037.5 rps | 0.0% |
| 100 | 200 | 10.4ms | 38.0ms | 39.3ms | 39.5ms | 4924.7 rps | 0.0% |
| 200 | 200 | 47.4ms | 66.6ms | 68.3ms | 68.7ms | 2813.5 rps | 0.0% |

### GET /metrics

| Concurrency | Requests | p50 | p95 | p99 | Max | Throughput | Error Rate |
|-------------|----------|-----|-----|-----|-----|------------|------------|
| 10 | 200 | 1.8ms | 2.5ms | 2.9ms | 3.3ms | 5400.1 rps | 0.0% |
| 50 | 200 | 7.2ms | 10.7ms | 10.7ms | 10.7ms | 6410.9 rps | 0.0% |
| 100 | 200 | 14.0ms | 15.0ms | 15.2ms | 15.2ms | 6874.7 rps | 0.0% |
| 200 | 200 | 26.4ms | 27.0ms | 27.0ms | 27.0ms | 7086.4 rps | 0.0% |

## WebSocket Voice Pipeline

| Concurrency | Sessions | Successful | TTFB p50 | TTFB p95 | TTFB p99 | TTFB max | Turn p95 | Connect p95 | Heap ΔMB | SLA |
|-------------|----------|------------|----------|----------|----------|----------|----------|-------------|----------|-----|
| 5 | 5 | 5 | 52.6ms | 62.7ms | 62.7ms | 62.7ms | 84.8ms | 25.2ms | -6 | PASS |
| 10 | 10 | 10 | 51.9ms | 53.5ms | 54.5ms | 54.5ms | 75.2ms | 29.8ms | -10 | PASS |
| 25 | 25 | 25 | 51.6ms | 60.9ms | 66.0ms | 66.0ms | 80.3ms | 77.4ms | +3 | PASS |
| 50 | 50 | 50 | 51.8ms | 78.8ms | 86.3ms | 88.9ms | 97.1ms | 181.0ms | +4 | PASS |
| 100 | 100 | 76 | 51.9ms | 200.2ms | 229.0ms | 261.4ms | 210.7ms | 704.3ms | -9 | **BREACH** — Error rate 24.0% > 10% |

## Latency Degradation Curve

TTFB p95 vs. concurrency (baseline = N=5 @ 62.7ms):

| N | TTFB p95 | vs. Baseline | Connect p95 |
|---|----------|--------------|-------------|
| 5 | 62.7ms | 1.0x | 25.2ms |
| 10 | 53.5ms | 0.9x | 29.8ms |
| 25 | 60.9ms | 1.0x | 77.4ms |
| 50 | 78.8ms | 1.3x | 181.0ms |
| 100 | 200.2ms | 3.2x | 704.3ms |

## Memory Growth

| Concurrency | Heap Before (MB) | Heap After (MB) | Heap Δ (MB) | RSS After (MB) |
|-------------|-----------------|-----------------|-------------|----------------|
| 5 | 38 | 31 | -7 | 161 |
| 10 | 31 | 22 | -9 | 117 |
| 25 | 22 | 25 | +3 | 137 |
| 50 | 25 | 29 | +4 | 164 |
| 100 | 29 | 20 | -9 | 135 |

## Analysis

### Breaking Point

The server reaches its breaking point at **N=100** concurrent sessions. 
At this level: Error rate 24.0% > 10%.

The safe operating range is **N≤50** where:
- TTFB p95 stays at 78.8ms (vs. SLA 1200ms)
- Error rate: 0.0%

### Where the Server Spends Time

1. **~50ms**: OpenAI adapter buffer stabilization (hardcoded in `commitAudio()`)
2. **~20ms**: Mock OpenAI "thinking" time (real API: 100–500ms)
3. **~2ms**: Server processing (arbitrator, event bus, policy gate, routing)

### Connection Time Scaling

WebSocket upgrade + Lane init cost grows with concurrency due to:
- Session object allocation (EventEmitter chain, Lane A/B/C constructors)
- Node.js event loop scheduling under concurrent I/O
- Policy gate initialization (OPA-off mode is O(1), but claims registry init adds ~5ms)

### Production Implications

- With real OpenAI Realtime API (100–500ms TTFB), the bottleneck shifts entirely to the external API
- Server-side processing overhead (~2ms/turn) is negligible
- The 1500ms echo-cancellation cooldown is the real throughput limiter for multi-turn sessions
- Connection establishment at N=100+ benefits from connection pooling or pre-warming

## How to Reproduce

```bash
# Baseline (fast)
npx tsx tests/load/advanced-load-test.ts --concurrency 5,10,25,50,100

# Full breaking-point discovery
npx tsx tests/load/advanced-load-test.ts --concurrency 5,10,25,50,100,200,300,500
```

Requires: `ws` package (already in server deps), `tsx` for TypeScript execution.
