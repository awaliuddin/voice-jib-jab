# Insurance Stubs Documentation

This document provides detailed information about the "insurance stubs" used in the Voice Jib-Jab system. These components are essential for ensuring safety, compliance, and graceful error handling.

## 1. PolicyGate

The `PolicyGate` is the central decision-making component for policy enforcement. It evaluates content against a series of checks and returns a binding decision that other parts of the system (like Lane B) must follow.

### Purpose
- To aggregate decisions from multiple policy checks (e.g., moderation, PII, claims).
- To provide a single, authoritative policy decision (`allow`, `rewrite`, `refuse`, etc.).
- To ensure that all content adheres to predefined safety and compliance rules.

### Architecture and Configuration
The `PolicyGate` is configured with an array of `PolicyCheck` objects. It runs these checks to determine the final outcome.

```typescript
// Location: server/src/insurance/policy_gate.ts

export interface PolicyCheck {
  readonly name: string;
  evaluate(ctx: EvaluationContext): CheckResult;
}

export class PolicyGate {
  private checks: PolicyCheck[];

  constructor(checks: PolicyCheck[] = []) {
    // ...
  }

  evaluate(ctx: EvaluationContext): GateResult {
    // ...
  }
}
```

The `PolicyGate` is instantiated within the `ControlEngine` and configured with all the enabled checks.

### Usage Example
The `ControlEngine` uses the `PolicyGate` to evaluate incoming text.

```typescript
// Location: server/src/lanes/laneC_control.ts

// Inside ControlEngine:
const gateResult = this.gate.evaluate({
  sessionId: this.sessionId,
  role: "assistant",
  text: "Some proposed response text.",
  isFinal: true,
});

if (gateResult.decision !== "allow") {
  // Take action based on the decision, e.g., emit a policy.decision event
  this.emit("policy.decision", {
    decision: gateResult.decision,
    reason_codes: gateResult.reasonCodes,
    // ...
  });
}
```

### Extension Points
To extend the `PolicyGate`, you can create a new class that implements the `PolicyCheck` interface and add it to the array of checks passed to the `PolicyGate` constructor.

---

## 2. AllowedClaimsRegistry

The `AllowedClaimsRegistry` is a repository of approved factual statements that the system is permitted to make. It is used by the `ClaimsChecker` to validate responses.

### Purpose
- To maintain a list of verified, approved claims.
- To prevent the system from making unverified or false statements.
- To provide a basis for rewriting responses to be factually correct.

### Architecture and Configuration
The registry is initialized with a list of `ApprovedClaim` objects, which can be loaded from a JSON file.

```typescript
// Location: server/src/insurance/allowed_claims_registry.ts

export interface ApprovedClaim {
  id: string;
  text: string;
  // ... other metadata
}

export interface AllowedClaimsRegistryConfig {
  claims?: ApprovedClaim[];
  disallowedPatterns?: string[];
  sourcePath?: string; // Path to the JSON file
}

export class AllowedClaimsRegistry {
  constructor(config: Partial<AllowedClaimsRegistryConfig> = {}) {
    // ... loads claims from file or config
  }
}
```

The `allowed_claims.json` file is expected to be in the `knowledge/` directory.

### Usage Example
The `ClaimsChecker` (a `PolicyCheck`) uses the registry to validate text.

```typescript
// Location: server/src/insurance/policy_gate.ts (inside ClaimsCheck)

const registry = new AllowedClaimsRegistry();
const claimsCheck = new ClaimsCheck(registry);

const result = claimsCheck.evaluate({
  sessionId: "some-session",
  role: "assistant",
  text: "A statement to check.",
  isFinal: true,
});

if (result.decision === "rewrite") {
  console.log("Rewrite needed. Safe version:", result.safeRewrite);
}
```

---

## 3. PIIRedactor

The `PIIRedactor` is a specialized `PolicyCheck` responsible for detecting and redacting Personally Identifiable Information (PII) from text.

### Purpose
- To protect user privacy by removing sensitive information.
- To ensure compliance with data protection regulations.
- To sanitize data before it is logged or sent to external services.

### Architecture and Configuration
The `PIIRedactor` uses regular expressions to find common PII patterns. It can be configured to either `redact` the PII or simply `flag` its presence.

```typescript
// Location: server/src/insurance/policy_gate.ts

export interface PIIRedactorConfig {
  mode?: "redact" | "flag";
  patterns?: Array<{ name: string; regex: RegExp; replacement: string }>;
}

export class PIIRedactorCheck implements PolicyCheck {
  constructor(config: PIIRedactorConfig = {}) {
    // ...
  }

  redactText(text: string): { redactedText: string; detectedTypes: string[] } {
    // ...
  }
}
```

### Usage Example
The `PIIRedactor` is typically used as a check within the `PolicyGate`. It can also be used directly to sanitize text.

```typescript
// Direct usage
const piiRedactor = new PIIRedactor({ mode: "redact" });
const { redactedText, detectedTypes } = piiRedactor.redactText("My email is test@example.com");

console.log(redactedText); // "My email is [EMAIL_REDACTED]"
console.log(detectedTypes); // ["email"]
```

---

## 4. FallbackPlanner

The `FallbackPlanner` is responsible for generating safe, predefined responses when the system cannot proceed normally, for example, after a policy violation.

### Purpose
- To provide a graceful way to handle errors and policy violations.
- To ensure the user always receives a response, even if it's a polite refusal.
- To manage different "safe maneuvers" like asking a clarifying question or escalating to a human.

### Architecture and Configuration
The `FallbackPlanner` is configured with lists of phrases for different fallback scenarios.

```typescript
// Location: server/src/insurance/fallback_planner.ts

export interface FallbackPlannerConfig {
  enabled: boolean;
  mode: "auto" | "refuse_politely" | "ask_clarifying_question" | ...;
  phrases: string[]; // for polite refusal
  clarifyingQuestions: string[];
  // ... other phrase lists
}

export class FallbackPlanner extends EventEmitter {
  constructor(sessionId: string, config: Partial<FallbackPlannerConfig> = {}) {
    // ...
  }

  trigger(payload?: PolicyDecisionPayload): Promise<void> {
    // ...
  }
}
```

### Usage Example
The `FallbackPlanner` is typically triggered by the orchestrator in response to a `policy.decision` event.

```typescript
// In the websocket handler, after a "refuse" decision
const fallbackPlanner = new FallbackPlanner(sessionId, config);

fallbackPlanner.on("audio", (chunk) => {
  // stream audio to client
});

fallbackPlanner.trigger({ decision: "refuse" });
```

---

## 5. AuditTrail

The `AuditTrail` is a system for logging important events for the purpose of debugging, analysis, and compliance. It creates an append-only log of events for each session.

### Purpose
- To create a persistent, tamper-resistant record of session events.
- To enable session replay and analysis for debugging and quality assurance.
- To meet audit and compliance requirements.

### Architecture and Configuration
The `AuditTrail` subscribes to events from the global `eventBus` and writes them to both a SQLite database and JSONL files (one per session).

```typescript
// Location: server/src/insurance/audit_trail.ts

export interface AuditTrailConfig {
  enabled: boolean;
  databasePath: string;
  jsonlDir?: string;
  includeTranscripts?: boolean;
}

export function initializeAuditTrail(config: AuditTrailConfig): AuditTrail | null {
  // ...
}
```

### Usage Example
The `AuditTrail` is initialized once at application startup and runs in the background.

```typescript
// Location: server/src/index.ts

const auditTrail = initializeAuditTrail({
  enabled: config.features.enableAuditTrail,
  databasePath: config.storage.databasePath,
  jsonlDir: "data/audit",
  includeTranscripts: true,
});
```

To replay a session, you can use the `loadSessionTimeline` function:

```typescript
import { loadSessionTimeline } from "../insurance/audit_trail.js";

async function replay(sessionId: string) {
  const events = await loadSessionTimeline(sessionId);
  for (const event of events) {
    console.log(event.type, event.payload);
  }
}
```
