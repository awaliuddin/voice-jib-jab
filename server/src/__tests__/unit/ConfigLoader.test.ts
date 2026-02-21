/**
 * ConfigLoader Unit Tests
 *
 * Tests the configuration module (config/index.ts) which loads environment
 * variables, applies defaults, and exports a typed ServerConfig object.
 *
 * Because the config module executes side effects on import (dotenv loading,
 * fs checks), each test uses jest.isolateModules() to get a fresh import
 * with controlled process.env values. The helpers getEnvVar, getEnvBool,
 * getEnvNumber, and getEnvFallbackMode are NOT exported, so they are tested
 * indirectly through the shape and values of the config object.
 */

// ── Mocks (must be before imports for jest hoisting) ────────────────────

jest.mock("dotenv", () => ({
  config: jest.fn(() => ({ error: null })),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(() => false),
}));

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Import config/index.ts inside an isolated module scope so each test
 * gets a fresh evaluation with whatever process.env values were set.
 * OPENAI_API_KEY is always injected because the module throws without it.
 */
function loadConfigIsolated(
  envOverrides: Record<string, string | undefined> = {},
): Promise<{ config: import("../../config/index.js").ServerConfig }> {
  return new Promise((resolve, reject) => {
    jest.isolateModules(() => {
      // Apply env overrides; always include OPENAI_API_KEY
      const savedEnv = { ...process.env };
      process.env.OPENAI_API_KEY =
        envOverrides.OPENAI_API_KEY ?? "test-api-key";
      for (const [key, value] of Object.entries(envOverrides)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      try {
        const mod = require("../../config/index.js");
        resolve(mod);
      } catch (err) {
        reject(err);
      } finally {
        // Restore env to avoid leaking between tests
        process.env = savedEnv;
      }
    });
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("ConfigLoader", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Start with a clean env so prior test values don't leak
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── getEnvVar branches ──────────────────────────────────────────────

  describe("getEnvVar (tested via config fields)", () => {
    it("should return env var value when set", async () => {
      const { config } = await loadConfigIsolated({
        OPENAI_API_KEY: "my-custom-key",
      });
      expect(config.openai.apiKey).toBe("my-custom-key");
    });

    it("should return default value when env var is not set", async () => {
      // NODE_ENV is set to "test" by Jest, so explicitly delete it
      const { config } = await loadConfigIsolated({ NODE_ENV: undefined });
      expect(config.nodeEnv).toBe("development");
    });

    it("should use env var over default when both available", async () => {
      const { config } = await loadConfigIsolated({
        NODE_ENV: "production",
      });
      expect(config.nodeEnv).toBe("production");
    });

    it("should throw when required env var is missing and no default", async () => {
      await expect(
        loadConfigIsolated({ OPENAI_API_KEY: undefined }),
      ).rejects.toThrow("Missing required environment variable: OPENAI_API_KEY");
    });
  });

  // ── getEnvBool branches ─────────────────────────────────────────────

  describe("getEnvBool (tested via config.features)", () => {
    it("should return default when env var is not set", async () => {
      const { config } = await loadConfigIsolated();
      // ENABLE_LANE_A defaults to true
      expect(config.features.enableLaneA).toBe(true);
    });

    it("should return true when env is 'true'", async () => {
      const { config } = await loadConfigIsolated({
        ENABLE_LANE_A: "true",
      });
      expect(config.features.enableLaneA).toBe(true);
    });

    it("should return true when env is 'TRUE' (case insensitive)", async () => {
      const { config } = await loadConfigIsolated({
        ENABLE_LANE_A: "TRUE",
      });
      expect(config.features.enableLaneA).toBe(true);
    });

    it("should return true when env is 'True' (mixed case)", async () => {
      const { config } = await loadConfigIsolated({
        ENABLE_LANE_A: "True",
      });
      expect(config.features.enableLaneA).toBe(true);
    });

    it("should return false when env is 'false'", async () => {
      const { config } = await loadConfigIsolated({
        ENABLE_LANE_A: "false",
      });
      expect(config.features.enableLaneA).toBe(false);
    });

    it("should return false for any non-true string", async () => {
      const { config } = await loadConfigIsolated({
        ENABLE_LANE_A: "yes",
      });
      expect(config.features.enableLaneA).toBe(false);
    });

    it("should return false default when env not set and default is false", async () => {
      const { config } = await loadConfigIsolated();
      // STORE_RAW_AUDIO defaults to false
      expect(config.safety.storeRawAudio).toBe(false);
    });
  });

  // ── getEnvNumber branches ───────────────────────────────────────────

  describe("getEnvNumber (tested via config numeric fields)", () => {
    it("should return default when env var is not set", async () => {
      const { config } = await loadConfigIsolated();
      expect(config.port).toBe(3000);
    });

    it("should return parsed number when env var is set", async () => {
      const { config } = await loadConfigIsolated({ PORT: "8080" });
      expect(config.port).toBe(8080);
    });

    it("should throw when env var is not a valid number", async () => {
      await expect(
        loadConfigIsolated({ PORT: "not-a-number" }),
      ).rejects.toThrow("Invalid number for PORT: not-a-number");
    });

    it("should parse latency target numbers correctly", async () => {
      const { config } = await loadConfigIsolated({
        TTFB_TARGET_P50: "200",
        TTFB_TARGET_P95: "500",
      });
      expect(config.latency.ttfbTargetP50).toBe(200);
      expect(config.latency.ttfbTargetP95).toBe(500);
    });
  });

  // ── getEnvFallbackMode branches ─────────────────────────────────────

  describe("getEnvFallbackMode (tested via config.fallback.mode)", () => {
    it("should return default when env var is not set", async () => {
      const { config } = await loadConfigIsolated();
      expect(config.fallback.mode).toBe("auto");
    });

    it("should return valid fallback mode", async () => {
      const { config } = await loadConfigIsolated({
        FALLBACK_MODE: "refuse_politely",
      });
      expect(config.fallback.mode).toBe("refuse_politely");
    });

    it("should accept ask_clarifying_question mode", async () => {
      const { config } = await loadConfigIsolated({
        FALLBACK_MODE: "ask_clarifying_question",
      });
      expect(config.fallback.mode).toBe("ask_clarifying_question");
    });

    it("should accept escalate_to_human mode", async () => {
      const { config } = await loadConfigIsolated({
        FALLBACK_MODE: "escalate_to_human",
      });
      expect(config.fallback.mode).toBe("escalate_to_human");
    });

    it("should warn and return default for invalid fallback mode", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      const { config } = await loadConfigIsolated({
        FALLBACK_MODE: "invalid_mode",
      });
      expect(config.fallback.mode).toBe("auto");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid FALLBACK_MODE="invalid_mode"'),
      );
      warnSpy.mockRestore();
    });
  });

  // ── dotenv loading ──────────────────────────────────────────────────

  describe("dotenv loading", () => {
    it("should warn when no .env file is found", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      const fs = require("fs") as { existsSync: jest.Mock };
      fs.existsSync.mockReturnValue(false);

      await loadConfigIsolated();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("No .env file found"),
      );
      warnSpy.mockRestore();
    });

    it("should log success when .env file is loaded", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation();
      const fs = require("fs") as { existsSync: jest.Mock };
      fs.existsSync.mockReturnValue(true);

      await loadConfigIsolated();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Loaded environment variables from"),
      );
      logSpy.mockRestore();
    });
  });

  // ── Config object shape ─────────────────────────────────────────────

  describe("config object shape", () => {
    it("should have all top-level sections", async () => {
      const { config } = await loadConfigIsolated();
      expect(config).toHaveProperty("port");
      expect(config).toHaveProperty("nodeEnv");
      expect(config).toHaveProperty("openai");
      expect(config).toHaveProperty("features");
      expect(config).toHaveProperty("latency");
      expect(config).toHaveProperty("safety");
      expect(config).toHaveProperty("rag");
      expect(config).toHaveProperty("storage");
      expect(config).toHaveProperty("fallback");
    });

    it("should have correct openai sub-fields", async () => {
      const { config } = await loadConfigIsolated();
      expect(config.openai).toHaveProperty("apiKey");
      expect(config.openai).toHaveProperty("model");
      expect(typeof config.openai.apiKey).toBe("string");
      expect(typeof config.openai.model).toBe("string");
    });

    it("should have correct features sub-fields with boolean types", async () => {
      const { config } = await loadConfigIsolated();
      expect(typeof config.features.enableLaneA).toBe("boolean");
      expect(typeof config.features.enableRAG).toBe("boolean");
      expect(typeof config.features.enablePolicyGate).toBe("boolean");
      expect(typeof config.features.enableAuditTrail).toBe("boolean");
      expect(typeof config.features.enablePersistentMemory).toBe("boolean");
    });

    it("should have correct latency sub-fields with number types", async () => {
      const { config } = await loadConfigIsolated();
      expect(typeof config.latency.ttfbTargetP50).toBe("number");
      expect(typeof config.latency.ttfbTargetP95).toBe("number");
      expect(typeof config.latency.bargeInTargetP95).toBe("number");
    });

    it("should have correct rag sub-fields with defaults", async () => {
      const { config } = await loadConfigIsolated();
      expect(config.rag.topK).toBe(5);
      expect(config.rag.maxTokens).toBe(600);
      expect(config.rag.maxBytes).toBe(4000);
    });

    it("should have correct safety sub-fields with defaults", async () => {
      const { config } = await loadConfigIsolated();
      expect(config.safety.enablePIIRedaction).toBe(true);
      expect(config.safety.storeRawAudio).toBe(false);
      expect(config.safety.maxSessionDurationMinutes).toBe(30);
    });

    it("should have correct storage sub-fields", async () => {
      const { config } = await loadConfigIsolated();
      expect(typeof config.storage.databasePath).toBe("string");
      expect(config.storage.enableWalMode).toBe(true);
      expect(config.storage.maxHistoryTurns).toBe(20);
      expect(config.storage.maxSummaryLength).toBe(2000);
    });

    it("should use default model when OPENAI_MODEL not set", async () => {
      const { config } = await loadConfigIsolated();
      expect(config.openai.model).toBe("gpt-realtime");
    });

    it("should override model when OPENAI_MODEL is set", async () => {
      const { config } = await loadConfigIsolated({
        OPENAI_MODEL: "gpt-4o-mini",
      });
      expect(config.openai.model).toBe("gpt-4o-mini");
    });
  });
});
