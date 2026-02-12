# Lane C: ControlEngine

Lane C, also known as the ControlEngine, operates in parallel to other lanes (Lane A and Lane B) with the primary responsibility of policy enforcement, moderation, and auditing. It acts as the "control intelligence" for making policy decisions and gathering evidence, and has the authority to intervene with Lane B's operations.

- **Purpose:** To enforce policies, moderate content, conduct audits, and collect metrics. It can cancel Lane B's output and force safe patterns or alternative responses.
- **Inputs:**
    - Streaming transcript segments (partial and final) from user input.
    - Current session state.
    - Proposed response metadata from Lane B.
    - Optionally, retrieved snippets from the Retrieval Service for claims checking.
- **Outputs:**
    - Policy decision events (e.g., allow, rewrite, refuse, escalate, cancel_output).
    - Audit events for session logging and replay.
    - Performance metrics related to policy evaluations.
- **Constraints:**
    - The ControlEngine itself **must not generate user-facing content or directly answer the user**. Its role is purely governance: it dictates how Lane B is allowed to answer or whether an answer should be suppressed/modified.
    - Decisions are typically non-blocking but can be critical (e.g., `cancel_output`).

## Architecture and Subcomponents

The `ControlEngine` is the central nervous system for Lane C. It is instantiated per-session and coordinates a collection of "checks" which are specialized sub-modules responsible for specific policy evaluations.

```typescript
// Location: server/src/lanes/laneC_control.ts

export class ControlEngine extends EventEmitter {
  private config: ControlEngineConfig;
  private gate: PolicyGate;
  private piiRedactor: PIIRedactor | null = null;
  // ...
}
```

The primary subcomponents are:

- **PolicyGate:** The core decision-making engine. It aggregates results from multiple checks to arrive at a final policy decision.
- **PIIRedactor:** A specialized check that scans text for Personally Identifiable Information (PII) and redacts it.
- **ClaimsChecker:** Validates statements against the `AllowedClaimsRegistry`.
- **Moderator:** Classifies content against moderation policies.

## Configuration

The `ControlEngine` is configured via the `ControlEngineConfig` interface.

```typescript
// Location: server/src/lanes/laneC_control.ts

export interface ControlEngineConfig {
  enabled: boolean;
  claimsRegistry: AllowedClaimsRegistry;
  checks: {
    pii: {
      enabled: boolean;
      mode: PII_REDACTION_MODE;
      scanMetadata: boolean;
    };
    claims: {
      enabled: boolean;
    };
    moderation: {
      enabled: boolean;
    };
  };
}
```

### Configuration Options

- `enabled`: A boolean to enable or disable the `ControlEngine` entirely.
- `claimsRegistry`: An instance of `AllowedClaimsRegistry` to be used by the `ClaimsChecker`.
- `checks.pii.enabled`: Enable or disable PII scanning.
- `checks.pii.mode`: The redaction mode (e.g., `REDACT`, `MASK`).
- `checks.pii.scanMetadata`: Whether to scan metadata fields for PII.
- `checks.claims.enabled`: Enable or disable claims checking.
- `checks.moderation.enabled`: Enable or disable content moderation.

This configuration is typically provided when the `ControlEngine` is instantiated within the session setup (e.g., in `server/src/api/websocket.ts`).

## Extension Points

The `ControlEngine` is designed to be extensible by adding new "checks" to the `PolicyGate`. A check is any class that implements the `PolicyCheck` interface.

```typescript
// Location: server/src/insurance/policy_gate.ts

export interface PolicyCheck {
  id: string;
  check(ctx: PolicyCheckContext): Promise<PolicyCheckResult[]>;
  onRegister?(gate: PolicyGate): void;
}
```

To add a new check:
1.  **Create a new class** that implements `PolicyCheck`. The `check` method should contain the core logic for your policy evaluation.
2.  **Instantiate your check** and add it to the `checks` array that is passed to the `PolicyGate` constructor. The `ControlEngine` creates the `PolicyGate` and passes in the configured checks.

### Example: Adding a Custom Check

```typescript
// 1. Define the new check
class MyCustomCheck implements PolicyCheck {
  id = "custom-check";

  async check(ctx: PolicyCheckContext): Promise<PolicyCheckResult[]> {
    if (ctx.text.includes("secret-code")) {
      return [{
        decision: "refuse",
        reason_code: "SECRET_CODE_DETECTED",
        message: "The input contains a forbidden secret code.",
      }];
    }
    return []; // No issue found
  }
}

// 2. Add it to the PolicyGate in laneC_control.ts
// ... inside ControlEngine constructor
const myCheck = new MyCustomCheck();
const checks: PolicyCheck[] = [
  // ... other checks
];
checks.push(myCheck);

this.gate = new PolicyGate(checks);
//...
```

This allows developers to easily extend the `ControlEngine`'s capabilities without modifying its core logic.
