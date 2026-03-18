# Capacity Planning — voice-jib-jab

**Last Updated**: 2026-03-18 | **Baseline**: 2,491 tests passing

## Summary

voice-jib-jab is a single-Node.js-process server. No sidecars except ChromaDB.
All concurrency is within a single event loop.

## Benchmark Baselines (from PipelineLatency.test.ts)

| Operation | p50 | p95 | Notes |
|-----------|-----|-----|-------|
| TF-IDF claim match | <1ms | <5ms | In-process, synchronous |
| Tenant registry lookup | <0.05ms | <0.1ms | O(1) Map |
| OPA policy eval | <0.5ms | <1ms | WASM, in-process |
| Ticket fire-and-forget | 0ms | 0ms | Non-blocking |
| Full Lane C evaluate() | ~2ms | ~7ms | Estimated sum of above |

## Session Memory Profile

| Component | Per-session estimate |
|-----------|---------------------|
| WebSocket connection | ~50KB |
| Session state (EventBus, LaneA/B/C) | ~2-5MB |
| AllowedClaimsRegistry (per tenant, shared) | ~1-3MB (loaded once, shared) |
| OpaEvaluator (per tenant, shared) | ~5-15MB WASM |
| ChromaDB collections (external) | N/A (external process) |
| SQLite WAL per session | ~100KB writes/session |

Heap budget estimate: ~5MB overhead x concurrent sessions + ~20MB base process.

## Concurrent Session Targets

| Sessions | Est. Heap | Est. CPU (Lane C) | Notes |
|----------|-----------|-------------------|-------|
| 10 | ~70MB | <1% | Comfortable headroom |
| 50 | ~270MB | ~2% | Production baseline |
| 100 | ~520MB | ~5% | Near ceiling for 1GB container |
| 200 | ~1020MB | ~10% | Requires 2GB RAM + connection pooling |

Recommendation: **50 concurrent sessions** per instance with 512MB RAM. Scale horizontally beyond that (each instance is stateless except SQLite + ChromaDB).

## Scaling Architecture

```
                    +------------------------+
                    |    Load Balancer        |
                    |  (sticky sessions)      |
                    +----------+-------------+
               +---------------+--------------+
         +-----+-----+              +-----+-----+
         |  VJJ #1   |              |  VJJ #2   |
         | 50 sess   |              | 50 sess   |
         +-----+-----+              +-----+-----+
               +---------------+--------------+
                    +----------+-------------+
                    |       ChromaDB          |  <-- shared
                    +------------------------+
```

Sticky sessions required because WebSocket connections are stateful. SQLite must be replaced with PostgreSQL in multi-instance deployments (see docker-compose.yml).

## Load Test Results

Run `npx tsx scripts/load-test.ts` against a running server.

Example expected output (warm server, localhost):
- HTTP /health p95 < 2ms
- 10 WS concurrent: all connected, avg connect < 20ms
- 50 WS concurrent: >95% connected, avg connect < 50ms
- 100 WS concurrent: >90% connected, avg connect < 100ms

## Bottleneck Analysis

1. **ChromaDB** -- the most likely bottleneck under heavy RAG load. Each semantic search is an HTTP call to ChromaDB. At 100 concurrent sessions all doing retrieval, ChromaDB becomes the gating factor.
2. **OpenAI Realtime API** -- hard external limit. Rate limits apply per API key.
3. **OPA WASM** -- in-process, <1ms. Not a bottleneck.
4. **SQLite WAL** -- concurrent writes may queue at high session counts. Migrate to PostgreSQL for >50 concurrent sessions.

## Recommended Production Configuration

- **Instance size**: 2 vCPU, 1GB RAM for 50 sessions
- **Max sessions per instance**: 50
- **Health check path**: GET /health (JSON, <1ms)
- **Startup probe**: /health, initial delay 10s, period 5s, failure threshold 3
- **Resource limits** (Kubernetes):
  ```yaml
  resources:
    requests: { cpu: 500m, memory: 512Mi }
    limits:   { cpu: 2000m, memory: 1024Mi }
  ```
