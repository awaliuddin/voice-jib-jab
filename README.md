# Voice Jib-Jab: NextGen AI Voice Orchestrator

A browser-based speech-to-speech voice assistant with lane-based orchestration, ensuring responsive, natural conversations with built-in safety controls and retrieval-augmented generation.

## Architecture

### Three-Lane System

- **Lane A (Reflex):** Instant backchannel audio and short acknowledgements
- **Lane B (Reasoned):** Streaming intelligent responses with RAG grounding
- **Lane C (Control):** Parallel policy enforcement, moderation, and audit

### Tech Stack

**Client:** React 18 + TypeScript + Vite
**Server:** Node.js 20 + TypeScript + Express + WebSocket
**Voice Provider:** OpenAI Realtime API (pluggable)
**Vector Store:** ChromaDB
**Real-time:** WebSocket

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- OpenAI API key

### Installation

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Start development servers
npm run dev
```

This starts:
- Client on http://localhost:5173
- Server on http://localhost:3000

### Project Structure

```
voice-jib-jab/
├── client/           # React browser application
│   └── src/
│       ├── audio/    # Mic capture, playback
│       ├── ui/       # UI components
│       ├── state/    # State management
│       └── events/   # Event handling
├── server/           # Node.js orchestrator
│   └── src/
│       ├── api/      # HTTP endpoints
│       ├── orchestrator/  # Session manager, event bus
│       ├── lanes/    # Lane A, B, C implementations
│       ├── providers/     # Voice provider adapters
│       ├── retrieval/     # RAG and vector store
│       ├── insurance/     # PolicyGate, audit, etc.
│       └── schemas/  # Event schemas
├── knowledge/        # NextGen AI knowledge pack
├── docs/            # Documentation
└── .claude/         # NXTG-Forge configuration
```

## Development

### NXTG-Forge Commands

```bash
/status           # View project state
/enable-forge     # Activate forge orchestrator
/feature "name"   # Add new feature
/report           # View session activity
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Linting

```bash
npm run lint
npm run format
```

## Performance Targets

- **TTFB p50:** <400ms (p95: <900ms)
- **Barge-in stop p95:** <250ms
- **Turn latency p95:** <1200ms

## Documentation

- [Project Spec](docs/PROJECT-SPEC.md)
- [Voice UX Principles](.claude/skills/domain/voice-ux.md)
- [Lane System Architecture](.claude/skills/domain/lane-system.md)

## License

MIT
