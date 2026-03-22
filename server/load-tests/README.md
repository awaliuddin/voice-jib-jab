# Load Tests

Artillery-based load test scenarios for voice-jib-jab server.

## Install Artillery

```bash
npm install -g artillery
```

## Running Tests

From the `server/` directory:

```bash
# REST API load test (warm up → sustained → peak → cool down)
npm run test:load

# Health endpoint stress test
npm run test:load:health

# Graceful shutdown verification under load
npm run test:load:shutdown
```

## Performance Targets

| Endpoint category | p95 target | Max error rate |
|-------------------|-----------|----------------|
| Health endpoints  | < 200ms   | < 0.1%         |
| API endpoints     | < 500ms   | < 1%           |

## Environment Variables

The API load test reads `VJJ_LOAD_TEST_API_KEY` from the environment to set
the `x-api-key` header on every request. Leave it unset to test unauthenticated
paths (the scenario expects 401/403 responses for guarded routes in that case).

```bash
export VJJ_LOAD_TEST_API_KEY=your-key-here
npm run test:load
```

## Scenarios

### `health.yml`

Three-phase stress test against `/health`, `/health/live`, and `/ready`:

- Warm up: 10 arrivals/s for 30 s
- Load: 50 arrivals/s for 60 s
- Cool down: 10 arrivals/s for 30 s

### `api.yml`

Four-phase test covering core API flows (70 % weight) and tenant admin
endpoints (30 % weight):

- Warm up: 5 arrivals/s for 30 s
- Sustained load: 25 arrivals/s for 60 s
- Peak load: 50 arrivals/s for 30 s
- Cool down: 5 arrivals/s for 30 s

### `graceful-shutdown.sh`

Starts the compiled server, hammers `/health` with 100 virtual users across
10 concurrent connections, sends SIGTERM after 5 s, then asserts the process
exits with code 0. Requires `npm run build` to have been run first.
