# Production Runbook — voice-jib-jab

## Deployment

### Prerequisites
- Node.js 22+
- OpenAI API key with Realtime API access
- ChromaDB instance (optional — for persistent memory)

### Environment Variables
```bash
# Required
OPENAI_API_KEY=sk-...

# Optional (defaults shown)
PORT=3000
NODE_ENV=production
ENABLE_LANE_A=true           # TTS reflex acknowledgements
ENABLE_PERSISTENT_MEMORY=true # ChromaDB cross-session memory
ENABLE_AUDIT_TRAIL=true       # Structured event logging
ENABLE_RAG=true               # Knowledge pack retrieval
ENABLE_POLICY_GATE=true       # Lane C content moderation
```

### Deploy Steps
```bash
git clone <repo> && cd voice-jib-jab
cp .env.example .env          # Fill in OPENAI_API_KEY
cd server && npm ci --omit=dev
cd ../client && npm ci && npm run build
cd ../server && NODE_ENV=production node dist/index.js
```

Serve `client/dist/` via nginx or a static file server. Point it at the server's WebSocket endpoint (`ws://host:3000`).

### Health Check
```
GET /health       → 200 OK
GET /status       → JSON with session count, uptime, feature flags
```

---

## Scaling Guide

### Capacity (measured 2026-02-22)
| Concurrent Sessions | p95 TTFB | Notes |
|---------------------|----------|-------|
| 20 | 74ms | Comfortable headroom |
| 50 | 153ms | Recommended max per instance |
| 100 | 146ms | TTFB stable, connection time rises |
| 200 | 127ms | Connection time p95 > 1.5s |

**Bottleneck**: WebSocket connection establishment (handshake + lane initialization), not event loop throughput. TTFB p50 stays at ~52ms regardless of load.

### Scaling Strategy
- **Vertical**: Single Node.js process handles 50 sessions comfortably. Beyond that, connection time degrades.
- **Horizontal**: Run multiple instances behind a WebSocket-aware load balancer (sticky sessions required — each session has server-side state). Use `SESSION_AFFINITY=ip_hash` in nginx.
- **OpenAI rate limits**: Each active session holds one persistent WebSocket to OpenAI Realtime API. Check your OpenAI tier for concurrent connection limits.

---

## Incident Response

### Session won't connect
1. Check `/health` endpoint — is the server up?
2. Check server logs for `[WebSocket] New client connected`
3. Verify `OPENAI_API_KEY` is set and valid
4. If Lane A errors (TTS preload 401), check OpenAI TTS quota separately

### High latency (TTFB > 1200ms)
1. Check OpenAI API status (status.openai.com)
2. Check server session count via `/status` — if > 50, scale horizontally
3. Check Node.js event loop lag: if > 100ms, investigate CPU-bound work
4. The 50ms buffer stabilization window in `commitAudio()` is intentional — do not remove

### Audio feedback loop (AI talking to itself)
Should not occur — 3-layer defense in place:
1. Browser `echoCancellation: true`
2. Server `RESPONSE_COOLDOWN_MS=1500` (rejects audio within 1.5s of last response)
3. Server `MIN_AUDIO_RMS=200` (drops silence/ambient noise)

If it recurs: check that the client is sending the `echoCancellation` constraint in `getUserMedia()`.

### Content moderation false positive
PolicyGate uses pattern-based moderation (7 categories). If legitimate content is blocked:
1. Check server logs for `MODERATION:<CATEGORY>` reason code
2. Review patterns in `server/src/insurance/moderation_patterns.ts`
3. Patterns use word boundaries and negative lookaheads to minimize false positives
4. For persistent issues, adjust patterns or add exceptions

### WebSocket disconnects
- Server sends ping frames; client should respond with pong
- If clients disconnect frequently, check network stability and proxy timeout settings
- nginx default `proxy_read_timeout` is 60s — increase to 300s for voice sessions
