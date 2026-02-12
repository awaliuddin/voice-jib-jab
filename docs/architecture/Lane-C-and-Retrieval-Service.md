# Lane C (Control) and Retrieval Service Architecture

This document details the architecture, interfaces, and usage of Lane C (ControlEngine), PolicyGate, FallbackPlanner, and the Retrieval Service within the Voice Jib-Jab orchestrator. These components are critical for ensuring safety, compliance, and controlled responses in the system.

## 1. Lane C: ControlEngine

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

### ControlEngine Subcomponents:

Lane C is composed of several specialized subcomponents that work together to fulfill its mandate:

#### 1.1 Moderator
- **Purpose:** Classifies incoming transcript segments and proposed responses against predefined moderation policies.
- **Functionality:** Determines if content is permissible, requires rewriting, should be refused, or necessitates escalation.
- **Decisions:** `allow`, `refuse`, `escalate`.

#### 1.2 ClaimsChecker
- **Purpose:** Validates proposed claims or factual statements against a registry of approved claims.
- **Functionality:** Compares content with the `AllowedClaimsRegistry` and identifies disallowed patterns or unverified assertions.
- **Dependency:** Relies on the `AllowedClaimsRegistry` managed by the Retrieval Service.

#### 1.3 PIIRedactor
- **Purpose:** Ensures sensitive data (Personally Identifiable Information) is scrubbed or anonymized.
- **Functionality:** Redacts PII from transcripts or proposed responses before they are processed by other components (e.g., before tool calls, logging, or transmission to external services) based on configured policies.

#### 1.4 OverrideController
- **Purpose:** Manages the execution of policy decisions that impact the flow of other lanes.
- **Functionality:** Can issue commands such as `cancel_output` to stop Lane B's audio stream or trigger the `FallbackPlanner` for safe responses.

### Lane C Data Schemas:

Lane C primarily interacts through canonical events, particularly publishing `policy.decision` events based on its internal evaluations.

#### Policy Decision Event (`policy.decision`)
This event is emitted by the ControlEngine to signal policy outcomes.

```json
{
  "type": "policy.decision",
  "payload": {
    "decision": "allow|rewrite|refuse|escalate|cancel_output",
    "reason_codes": ["CLAIMS_RISK", "PII_DETECTED", "REGULATED_TOPIC"],
    "safe_rewrite": "string|null",     // Optional: a sanitized version of the response
    "required_disclaimer_id": "string|null", // Optional: ID of a disclaimer to append
    "severity": 0                     // Severity score for the decision
  }
}
```

#### Transcript Events (`transcript.delta` / `transcript.final`)
Lane C consumes these events from the orchestrator to analyze user input.

```json
{
  "type": "transcript.delta|transcript.final",
  "payload": {
    "text": "string",
    "confidence": 0.0,            // Confidence score of the transcription
    "is_final": false,            // True if this is the final segment of the utterance
    "span_ms": { "start": 0, "end": 0 } // Start and end timestamps of the segment
  }
}
```

### Integration Examples with Lane B:

- **Canceling Lane B Output:** If the ControlEngine detects a policy violation (e.g., hate speech) in Lane B's proposed response, the `OverrideController` can emit a `policy.decision` with `"decision": "cancel_output"`. The Orchestrator intercepts this and immediately stops Lane B's audio stream.
- **Forcing a Rewrite:** If Lane B proposes a response containing a disallowed claim, the `ClaimsChecker` might flag it. The ControlEngine could then issue a `policy.decision` with `"decision": "rewrite"` and provide a `safe_rewrite` string, instructing Lane B to use the sanitized version.
- **Triggering Fallback:** For severe policy violations or unresolvable issues, Lane C might decide to `"escalate"` or `"refuse"`, which can lead the Orchestrator to engage the `FallbackPlanner` to provide a pre-defined safe response.

---

## 2. PolicyGate

The PolicyGate is a critical component within the Lane C architecture, often acting as the primary decision-making interface for policy enforcement. It is an "insurance stub" designed to ensure that all responses adhere to predefined rules and safety guidelines.

- **Purpose:** To evaluate proposed actions or responses against a set of policies and make a binding decision (e.g., allow, rewrite, refuse, escalate). Lane B is contractually bound to obey PolicyGate decisions.
- **Decisions:** The PolicyGate can issue the following decisions:
    - `allow`: The action/response is approved.
    - `rewrite`: The action/response needs modification, typically with a suggested `safe_rewrite`.
    - `refuse`: The action/response is entirely rejected.
    - `escalate`: The situation requires human intervention or a higher-level process.
    - `cancel_output`: Immediately halt any ongoing audio output from other lanes, particularly Lane B.
- **Usage:** While conceptually a part of the ControlEngine, the PolicyGate might exist as a distinct module (`/server/src/insurance/policy_gate.ts`) that the `OverrideController` (within ControlEngine) interacts with to determine the final policy decision.

---

## 3. FallbackPlanner

The FallbackPlanner is an "insurance stub" module designed to provide a set of predefined, safe responses or actions when the system encounters unresolvable issues, policy violations, or when Lane B's output is cancelled by Lane C. It ensures graceful degradation and maintains user trust by always offering a reasonable next step.

- **Purpose:** To manage and execute safe maneuvers when normal conversational flow cannot proceed due to policy decisions, errors, or unhandled states.
- **Safe Maneuvers:**
    - `ask clarifying question`: Request more information from the user.
    - `refuse politely`: Decline to answer the query.
    - `switch to “text summary”`: Suggest moving the conversation to a text-based format.
    - `escalate to human`: Flag the conversation for human review (placeholder).
    - `offer to send email or link`: Provide alternative contact or information sources (placeholder).
- **Triggering:** The FallbackPlanner is typically triggered by the Orchestrator based on `policy.decision` events from Lane C (e.g., `refuse`, `escalate`, or following a `cancel_output`).

---

## 4. Retrieval Service

The Retrieval Service is responsible for accessing, searching, and providing verified knowledge to the orchestrator, primarily for Lane B's RAG (Retrieval-Augmented Generation) process and Lane C's `ClaimsChecker`. It ensures that factual statements are grounded in approved knowledge.

- **Purpose:** To perform vector-based searches against the NextGen AI Knowledge Pack and provide compact "facts pack" snippets. It also manages approved claims and disclaimer templates.
- **Constraints:**
    - **Hard cap on tokens/bytes returned:** To prevent payload bloat and maintain responsiveness.
    - **Source identifiers:** All returned facts must include clear source identifiers to support audit and traceability.
- **Key Knowledge Assets:** These assets are typically located in the `/knowledge` directory.
    - `nxtg_facts.jsonl`: A line-delimited JSON file containing individual facts about NextGen AI.
    - `disclaimers.json`: A collection of predefined disclaimer templates with unique IDs.
    - `allowed_claims.json`: A registry of approved claims that the system is permitted to make.

### Retrieval Service API:

The Retrieval Service exposes functions or an API for other modules to query its knowledge base.

#### 4.1 `retrieve_nxtg_facts(query: string)`
- **Description:** Performs a semantic search against the NextGen AI Knowledge Pack using the provided `query`.
- **Input:** `query` (string) - The user's query or a derived search term.
- **Output:** `facts_pack` (object) - A structured collection of relevant facts.

#### 4.2 `lookup_disclaimer(disclaimer_id: string)`
- **Description:** Retrieves the full text of a disclaimer based on its unique ID.
- **Input:** `disclaimer_id` (string) - The ID of the desired disclaimer (e.g., "DISC-001").
- **Output:** `text` (string) - The full text of the disclaimer.

### Facts Pack Schema:

The `facts_pack` is the canonical output structure from the `retrieve_nxtg_facts` function, designed to be compact and informative.

```json
{
  "topic": "string",
  "facts": [
    {
      "id": "NXTG-001",           // Unique identifier for the fact
      "text": "string",            // The factual statement
      "source": "doc|url|internal", // Origin of the fact (e.g., document, URL, internal knowledge)
      "timestamp": "YYYY-MM-DD"    // Date of verification or last update
    }
  ],
  "disclaimers": ["DISC-001", "DISC-002"] // List of disclaimer IDs relevant to the facts
}
```

---

## 5. Examples of Integration with Lane B and Lane C

The interaction between Lane B (ReasoningEngine) and Lane C (ControlEngine), often mediated by the Orchestrator, is central to the system's safe and controlled operation.

### Scenario 1: Lane C Cancels Lane B Output
1.  **Lane B** generates a streaming response chunk and proposes it to the Orchestrator.
2.  The **Orchestrator** forwards the proposed response metadata (and potentially the full text) to **Lane C**.
3.  **Lane C's Moderator** component identifies the content as inappropriate or a policy violation.
4.  The **ControlEngine** (via its `OverrideController`) issues a `policy.decision` event with `"decision": "cancel_output"` and a `reason_code` (e.g., "HATE_SPEECH_DETECTED").
5.  The **Orchestrator** receives this event and immediately halts Lane B's audio output stream to the client.
6.  The **Orchestrator** might then engage the `FallbackPlanner` to provide a generic, safe message to the user, such as "I cannot answer that question."

### Scenario 2: Lane C Forces a Rewrite based on Claims Checking
1.  **Lane B** constructs a response that includes a factual claim about NextGen AI, which it derived from its RAG process.
2.  The **Orchestrator** sends the proposed response to **Lane C**.
3.  **Lane C's ClaimsChecker** queries the `AllowedClaimsRegistry` via the **Retrieval Service** for the claim.
4.  The `ClaimsChecker` finds that the claim, while similar, is not an exact match or is slightly misphrased compared to the approved entry, or it requires a specific disclaimer.
5.  The **ControlEngine** emits a `policy.decision` event with `"decision": "rewrite"`, a `safe_rewrite` (e.g., "According to our latest documentation, [sanitized fact]."), and a `required_disclaimer_id` (e.g., "DISC-005").
6.  The **Orchestrator** intercepts this, applies the `safe_rewrite` to Lane B's response, and ensures the specified disclaimer is appended or presented appropriately before sending the revised response to the client.

### Scenario 3: Lane C Requests PII Redaction Before Tool Use
1.  A user asks a question to **Lane B** that inadvertently contains Personally Identifiable Information (PII), e.g., "What is the capital of France? My phone number is 555-1234."
2.  The **Orchestrator** sends the transcript to **Lane C**.
3.  **Lane C's PIIRedactor** identifies "555-1234" as PII.
4.  Before Lane B makes an external tool call (e.g., to a search engine for "capital of France"), the **ControlEngine** instructs the Orchestrator to redact the PII from the user's query that is passed to the tool.
5.  The tool call proceeds with the sanitized query ("What is the capital of France?"), protecting the user's privacy.

This comprehensive documentation aims to provide developers with a clear understanding of Lane C's control mechanisms and the Retrieval Service's role in ensuring the integrity and safety of the Voice Jib-Jab system.