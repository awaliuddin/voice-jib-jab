# Security Model — voice-jib-jab
**Last Updated**: 2026-03-18

## Threat Model

voice-jib-jab is a multi-tenant voice agent runtime exposed via WebSocket and HTTP APIs.
Primary threats:

| Threat | Mitigation |
|--------|-----------|
| Tenant data leakage | Per-tenant claim registries, OPA policy data, and ChromaDB collections isolated by tenantId at construction time |
| API abuse / flooding | Rate limiting per IP (admin: 30/min, voice: 10/min, analytics/sessions: 60/min) |
| Prompt injection via audio | Lane C policy gate evaluates all transcribed text before response delivery |
| Escalation suppression | Fire-and-forget ticketing; ticket_error events are logged, not silently dropped |
| Path traversal in IDs | Session and tenant IDs validated against allowlist `[a-zA-Z0-9_-]` |
| Oversized requests | Express default 100kb JSON limit applies to all endpoints |
| XSS via dashboard | X-Content-Type-Options + X-Frame-Options headers on all responses |

## Authentication

The current version does not include authentication middleware (enterprise deployments add auth at the load balancer / API gateway layer). All admin endpoints should be placed behind network ACLs or an API gateway in production.

## Rate Limiting

| Endpoint group | Limit | Window | Rationale |
|---------------|-------|--------|-----------|
| `POST /admin/*` | 30 req | 1 min | Prevent tenant enumeration/flooding |
| `POST /voice/trigger` | 10 req | 1 min | Prevent session creation abuse |
| `GET /analytics/*` | 60 req | 1 min | Burst analytics reads allowed |
| `GET /sessions/*` | 60 req | 1 min | Burst session reads allowed |

## Input Validation

- `tenantId`: no path traversal characters (`../`)
- `callbackUrl`: must be a valid URL (`new URL()` parse check)
- `phoneNumber`: digits, spaces, hyphens, parentheses, leading `+` only
- `claimsThreshold`: must be 0.0–1.0 if provided
- Session/trigger IDs in URL params: `[a-zA-Z0-9_-]` only
- Analytics date range: must parse as valid ISO date

## Audit Trail

All policy decisions are immutably logged to JSONL files per session at `data/audit/{sessionId}.jsonl`. Replay-ready for compliance audits. PII redaction available via `ENABLE_PII_REDACTION=true`.

## Known Risks

- No authentication on HTTP endpoints — mitigate with API gateway / network ACL
- Rate limiter is in-memory only — does not survive restarts, not shared across instances (single-instance mitigation only)
- GitHub Dependabot reports 1 high + 1 moderate vulnerability — see GitHub Security tab for details
