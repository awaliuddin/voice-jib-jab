# CLAUDE.md — voice-jib-jab

## Project Overview

`voice-jib-jab` is a production voice-agent runtime focused on low latency, reliable turn-taking, and governed output.

## Architecture

- 3-lane interaction model: reflex acknowledgement, reasoning, and policy/governance
- realtime voice transport for microphone-to-model-to-playback flow
- persistent conversation memory
- enterprise-facing web UI

## Development

```bash
npm test
npm run dev
```

## Engineering Rules

- Preserve the 3-lane architecture unless an explicit product-level design change says otherwise.
- Protect latency-sensitive paths with measurable performance tests.
- Keep security, audit, and governance behavior observable and fail safely.
- Do not reduce test coverage or test counts without documented justification.
- Preserve public API, WebSocket, and configuration contracts.

## Public / Private Boundary

This is a public repository. Do not commit private portfolio state, internal directives or handoffs, local machine topology, absolute developer-machine paths, private memory/retrieval wiring, internal agent hooks, credentials, production tokens, or private cross-project operating data.

Use synthetic tenants, agents, endpoints, and fixture data in public examples and tests.

## Security

- Never commit `.env`, private keys, API credentials, or production customer data.
- Keep authentication, rate limiting, audit, and tenant-isolation tests in place.
- Treat transcripts and voice-derived data as sensitive by default.
