/**
 * Configuration loader for Voice Jib-Jab server
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Load .env file
loadEnv({ path: resolve(process.cwd(), '.env') });

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
  return value.toLowerCase() === 'true';
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

export const config: ServerConfig = {
  port: getEnvNumber('PORT', 3000),
  nodeEnv: getEnvVar('NODE_ENV', 'development'),
  openai: {
    apiKey: getEnvVar('OPENAI_API_KEY'),
    model: getEnvVar('OPENAI_MODEL', 'gpt-4-realtime-preview'),
  },
  features: {
    enableLaneA: getEnvBool('ENABLE_LANE_A', true),
    enableRAG: getEnvBool('ENABLE_RAG', true),
    enablePolicyGate: getEnvBool('ENABLE_POLICY_GATE', true),
    enableAuditTrail: getEnvBool('ENABLE_AUDIT_TRAIL', true),
  },
  latency: {
    ttfbTargetP50: getEnvNumber('TTFB_TARGET_P50', 400),
    ttfbTargetP95: getEnvNumber('TTFB_TARGET_P95', 900),
    bargeInTargetP95: getEnvNumber('BARGE_IN_TARGET_P95', 250),
  },
  safety: {
    enablePIIRedaction: getEnvBool('ENABLE_PII_REDACTION', true),
    storeRawAudio: getEnvBool('STORE_RAW_AUDIO', false),
    maxSessionDurationMinutes: getEnvNumber('MAX_SESSION_DURATION_MINUTES', 30),
  },
};
