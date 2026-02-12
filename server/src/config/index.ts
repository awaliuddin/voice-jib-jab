/**
 * Configuration loader for Voice Jib-Jab server
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "path";
import { existsSync } from "fs";
import type { FallbackMode } from "../schemas/events.js";

// Determine the project root directory
// When running from server/ directory, we need to look in parent directory
const currentDir = process.cwd();
const parentDir = resolve(currentDir, "..");

// Try multiple locations for .env file
const envPaths = [
  resolve(parentDir, ".env"), // Project root (most common)
  resolve(currentDir, ".env"), // Current directory (fallback)
];

// Find and load the first existing .env file
let envLoaded = false;
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    const result = loadEnv({ path: envPath });
    if (!result.error) {
      console.log(`✓ Loaded environment variables from: ${envPath}`);
      envLoaded = true;
      break;
    }
  }
}

if (!envLoaded) {
  console.warn("⚠ No .env file found in expected locations:");
  envPaths.forEach((p) => console.warn(`  - ${p}`));
  console.warn("Continuing with environment variables from shell/system...");
}

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  openai: {
    apiKey: string;
    model: string;
  };
  features: {
    enableLaneA: boolean;
    enableRAG: boolean;
    enablePolicyGate: boolean;
    enableAuditTrail: boolean;
    enablePersistentMemory: boolean;
  };
  latency: {
    ttfbTargetP50: number;
    ttfbTargetP95: number;
    bargeInTargetP95: number;
  };
  safety: {
    enablePIIRedaction: boolean;
    storeRawAudio: boolean;
    maxSessionDurationMinutes: number;
  };
  rag: {
    topK: number;
    maxTokens: number;
    maxBytes: number;
  };
  storage: {
    databasePath: string;
    enableWalMode: boolean;
    maxHistoryTurns: number;
    maxSummaryLength: number;
  };
  fallback: {
    mode: FallbackMode;
  };
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === "true";
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`Invalid number for ${key}: ${value}`);
  }
  return num;
}

function getEnvFallbackMode(
  key: string,
  defaultValue: FallbackMode,
): FallbackMode {
  const value = process.env[key];
  if (!value) return defaultValue;

  const normalized = value.trim().toLowerCase();
  const allowed: FallbackMode[] = [
    "auto",
    "ask_clarifying_question",
    "refuse_politely",
    "switch_to_text_summary",
    "escalate_to_human",
    "offer_email_or_link",
  ];

  if (allowed.includes(normalized as FallbackMode)) {
    return normalized as FallbackMode;
  }

  console.warn(
    `[Config] Invalid ${key}="${value}". Using default "${defaultValue}".`,
  );
  return defaultValue;
}

export const config: ServerConfig = {
  port: getEnvNumber("PORT", 3000),
  nodeEnv: getEnvVar("NODE_ENV", "development"),
  openai: {
    apiKey: getEnvVar("OPENAI_API_KEY"),
    model: getEnvVar("OPENAI_MODEL", "gpt-realtime"),
  },
  features: {
    enableLaneA: getEnvBool("ENABLE_LANE_A", true),
    enableRAG: getEnvBool("ENABLE_RAG", true),
    enablePolicyGate: getEnvBool("ENABLE_POLICY_GATE", true),
    enableAuditTrail: getEnvBool("ENABLE_AUDIT_TRAIL", true),
    enablePersistentMemory: getEnvBool("ENABLE_PERSISTENT_MEMORY", true),
  },
  latency: {
    ttfbTargetP50: getEnvNumber("TTFB_TARGET_P50", 400),
    ttfbTargetP95: getEnvNumber("TTFB_TARGET_P95", 900),
    bargeInTargetP95: getEnvNumber("BARGE_IN_TARGET_P95", 250),
  },
  safety: {
    enablePIIRedaction: getEnvBool("ENABLE_PII_REDACTION", true),
    storeRawAudio: getEnvBool("STORE_RAW_AUDIO", false),
    maxSessionDurationMinutes: getEnvNumber("MAX_SESSION_DURATION_MINUTES", 30),
  },
  rag: {
    topK: getEnvNumber("RAG_TOP_K", 5),
    maxTokens: getEnvNumber("RAG_MAX_TOKENS", 600),
    maxBytes: getEnvNumber("RAG_MAX_BYTES", 4000),
  },
  storage: {
    databasePath: getEnvVar(
      "DATABASE_PATH",
      resolve(parentDir, "data", "voice-jib-jab.db"),
    ),
    enableWalMode: getEnvBool("DATABASE_WAL_MODE", true),
    maxHistoryTurns: getEnvNumber("MAX_HISTORY_TURNS", 20),
    maxSummaryLength: getEnvNumber("MAX_SUMMARY_LENGTH", 2000),
  },
  fallback: {
    mode: getEnvFallbackMode("FALLBACK_MODE", "auto"),
  },
};
