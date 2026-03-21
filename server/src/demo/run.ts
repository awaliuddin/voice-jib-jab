#!/usr/bin/env node
/* istanbul ignore file */
/**
 * CLI demo runner — plays a pre-recorded demo scenario.
 *
 * Usage:
 *   npx tsx src/demo/run.ts [support|compliance|sales]
 *
 * Defaults to "support" if no argument is provided.
 */

import { DemoPlayer } from "./DemoPlayer.js";
import type { DemoPlaybackEvent } from "./DemoPlayer.js";

// ── Argument parsing ───────────────────────────────────────────────────────

const VALID_SCENARIOS = ["support", "compliance", "sales"] as const;
type ValidScenario = (typeof VALID_SCENARIOS)[number];

function parseScenario(arg: string | undefined): ValidScenario {
  if (!arg) return "support";
  if ((VALID_SCENARIOS as readonly string[]).includes(arg)) {
    return arg as ValidScenario;
  }
  console.error(
    `Unknown scenario "${arg}". Valid options: ${VALID_SCENARIOS.join(", ")}`
  );
  process.exit(1);
}

const scenarioId = parseScenario(process.argv[2]);

// ── Renderer ───────────────────────────────────────────────────────────────

function renderEvent(event: DemoPlaybackEvent): void {
  switch (event.type) {
    case "session_start":
      console.log(`\n╔${"═".repeat(50)}╗`);
      console.log(`  DEMO START: ${scenarioId.toUpperCase()}`);
      console.log(`  Session: ${event.sessionId}`);
      console.log(`╚${"═".repeat(50)}╝\n`);
      break;

    case "turn":
      if (event.speaker === "agent") {
        console.log(`  Agent: ${event.text}`);
      } else {
        console.log(`  User: ${event.text}`);
      }
      break;

    case "policy":
      switch (event.policyDecision) {
        case "allow":
          process.stdout.write(`     Policy: ALLOW`);
          if (event.claimMatched) {
            process.stdout.write(` (claim: ${event.claimMatched})`);
          }
          console.log();
          break;

        case "refuse":
          console.log(
            `     Policy: REFUSE — ${(event.reasonCodes ?? []).join(", ")}`
          );
          break;

        case "escalate":
          console.log(
            `     Policy: ESCALATE (severity ${event.severity ?? "?"})`
          );
          break;

        case "rewrite":
          console.log(`     Policy: REWRITE`);
          if (event.reasonCodes && event.reasonCodes.length > 0) {
            console.log(`       Reason: ${event.reasonCodes.join(", ")}`);
          }
          break;

        default:
          console.log(`     Policy: ${event.policyDecision ?? "unknown"}`);
      }
      break;

    case "sentiment":
      console.log(`     Sentiment: ${event.sentiment}`);
      break;

    case "session_end":
      console.log(`\n╚${"═".repeat(50)}╝`);
      console.log("  DEMO END");
      console.log(`╚${"═".repeat(50)}╝\n`);
      break;

    case "summary": {
      const decisions = event.policyDecisions ?? [];
      const counts: Record<string, number> = {};
      for (const d of decisions) {
        counts[d] = (counts[d] ?? 0) + 1;
      }

      console.log("\n  --- SUMMARY ---");
      console.log(`  Total turns       : ${event.totalTurns ?? 0}`);
      console.log(
        `  Policy decisions  : ${decisions.length} (${Object.entries(counts)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")})`
      );
      console.log(
        `  Escalated         : ${event.escalated ? "YES" : "no"}`
      );
      console.log(
        `  Final sentiment   : ${event.finalSentiment ?? "n/a"}`
      );
      break;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

const player = new DemoPlayer({ speedMultiplier: 1.0 });

player.on("playback_event", (event: DemoPlaybackEvent) => {
  renderEvent(event);
});

player.play(scenarioId).catch((err: unknown) => {
  console.error("Demo playback failed:", err);
  process.exit(1);
});
