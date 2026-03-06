package voice_jib_jab.policy

import rego.v1

# ── PolicyGate Aggregation — Rego Implementation ─────────────────────────
#
# Translates the TypeScript DECISION_PRIORITY merge from policy_gate.ts into
# declarative Rego rules. Replaces the imperative aggregation loop in
# PolicyGate.evaluate() with an OPA WASM instance (Phase 1 of N-14).
#
# Input schema:
#   { "checks": [{ "name": string, "decision": string, "severity": number,
#                  "reasonCodes": string[], "safeRewrite"?: string,
#                  "requiredDisclaimerId"?: string }] }
#
# Output (result rule):
#   { "decision": string, "severity": number,
#     "safeRewrite": string|null, "requiredDisclaimerId": string|null }
#
# Mirror of TypeScript DECISION_PRIORITY constant:
#   allow=0, rewrite=1, refuse=2, escalate=3, cancel_output=4
# ─────────────────────────────────────────────────────────────────────────

# Decision priority — higher number = more severe action
decision_priority := {
	"allow":         0,
	"rewrite":       1,
	"refuse":        2,
	"escalate":      3,
	"cancel_output": 4,
}

# ── Default result (no checks, or all checks allow) ──────────────────────

default result := {
	"decision":             "allow",
	"severity":             0,
	"safeRewrite":          null,
	"requiredDisclaimerId": null,
}

# ── Winning decision ──────────────────────────────────────────────────────

# The result rule is only defined (overrides default) when there are checks.
result := {
	"decision":             w.decision,
	"severity":             w.severity,
	"safeRewrite":          object.get(w, "safeRewrite", null),
	"requiredDisclaimerId": object.get(w, "requiredDisclaimerId", null),
} if {
	count(input.checks) > 0
	w := winning_check
}

# The winning check: highest priority decision, then highest severity.
# Among ties, first check by array index wins (matches TypeScript loop semantics).
winning_check := input.checks[winning_idx]

winning_idx := idx if {
	# Step 1: find the maximum decision priority across all checks
	max_p := max({decision_priority[c.decision] | some c in input.checks})

	# Step 2: among checks at max priority, find the maximum severity
	max_s := max({c.severity |
		some c in input.checks
		decision_priority[c.decision] == max_p
	})

	# Step 3: collect indices of checks that match both max priority and max severity
	candidates := [i |
		some i
		c := input.checks[i]
		decision_priority[c.decision] == max_p
		c.severity == max_s
	]

	# Step 4: take the first matching index (preserves TypeScript first-wins semantics)
	idx := candidates[0]
}

# ── Short-circuit signal ──────────────────────────────────────────────────
#
# Mirrors the early-exit condition in PolicyGate.evaluate():
#   break on cancel_output, or critical-severity refuse/escalate.
# PolicyGate reads this to stop running remaining checks.

default should_short_circuit := false

should_short_circuit if {
	winning_check.decision == "cancel_output"
}

should_short_circuit if {
	winning_check.severity >= 4
	winning_check.decision in {"refuse", "escalate"}
}

# ── ModeratorCheck — OPA threshold evaluation ─────────────────────────────
#
# Input: input.moderator_check = {
#   "categories": [{ "name": string, "score": number }],
#   "thresholds": { "<CATEGORY>": number, "default": number }
# }
# Output: { "decision": string, "severity": number, "reason_code": string|null }
#
# Score model: Tier 1 (pattern matching) produces binary scores —
#   1.0 = category pattern matched, 0.0 = not matched.
# Future: OpenAI Moderation API replaces 0/1 with real float scores.
# ─────────────────────────────────────────────────────────────────────────

default moderator_check := {"decision": "allow", "severity": 0, "reason_code": null}

moderator_check := res if {
	some cat in input.moderator_check.categories
	threshold := object.get(
		input.moderator_check.thresholds,
		cat.name,
		object.get(input.moderator_check.thresholds, "default", 0.5),
	)
	cat.score >= threshold
	res := _moderator_result(cat.name)
}

_moderator_result(name) := {"decision": "escalate", "severity": 4, "reason_code": "MODERATION:SELF_HARM"} if {
	name == "SELF_HARM"
}

_moderator_result(name) := {"decision": "refuse", "severity": 4, "reason_code": concat("", ["MODERATION:", name])} if {
	name != "SELF_HARM"
}
