/**
 * Translation Tests
 *
 * Tests isSupportedPair(), StubTranslationProvider, TranslationService,
 * and the Translation API endpoints.
 *
 * Follows the ConversationMemory.test.ts pattern: standalone Express app
 * with injected deps, native http module for requests.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import {
  isSupportedPair,
  StubTranslationProvider,
  TranslationService,
  type TranslationLanguage,
} from "../../services/TranslationService.js";
import { createTranslationRouter } from "../../api/translation.js";

// ── HTTP helper (same pattern as ConversationMemory.test.ts) ──────────

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload).toString() } : {}),
      },
    };

    import("http").then(({ default: http }) => {
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: rawBody,
            json: () => JSON.parse(rawBody),
          });
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ── Test app builder ──────────────────────────────────────────────────

function buildTestApp(service: TranslationService): Express {
  const app = express();
  app.use(express.json());
  app.use("/translation", createTranslationRouter(service));
  return app;
}

// ── 1. isSupportedPair() ──────────────────────────────────────────────

describe("isSupportedPair()", () => {
  it("returns true for en→es", () => {
    expect(isSupportedPair("en", "es")).toBe(true);
  });

  it("returns true for es→en (reverse)", () => {
    expect(isSupportedPair("es", "en")).toBe(true);
  });

  it("returns true for en→fr", () => {
    expect(isSupportedPair("en", "fr")).toBe(true);
  });

  it("returns true for fr→en (reverse)", () => {
    expect(isSupportedPair("fr", "en")).toBe(true);
  });

  it("returns true for en→de", () => {
    expect(isSupportedPair("en", "de")).toBe(true);
  });

  it("returns true for de→en (reverse)", () => {
    expect(isSupportedPair("de", "en")).toBe(true);
  });

  it("returns true for same language (no-op passthrough)", () => {
    expect(isSupportedPair("en", "en")).toBe(true);
    expect(isSupportedPair("es", "es")).toBe(true);
    expect(isSupportedPair("fr", "fr")).toBe(true);
    expect(isSupportedPair("de", "de")).toBe(true);
  });

  it("returns false for es→fr (not a direct supported pair)", () => {
    expect(isSupportedPair("es", "fr")).toBe(false);
  });

  it("returns false for de→es", () => {
    expect(isSupportedPair("de", "es")).toBe(false);
  });

  it("returns false for fr→de", () => {
    expect(isSupportedPair("fr", "de")).toBe(false);
  });

  it("returns false for pt→en (pt not in supported pairs)", () => {
    expect(isSupportedPair("pt", "en")).toBe(false);
  });

  it("returns false for unknown language codes", () => {
    expect(isSupportedPair("zh", "en")).toBe(false);
    expect(isSupportedPair("en", "ja")).toBe(false);
  });
});

// ── 2. StubTranslationProvider ────────────────────────────────────────

describe("StubTranslationProvider", () => {
  let stub: StubTranslationProvider;

  beforeEach(() => {
    stub = new StubTranslationProvider();
  });

  it("has providerName 'stub'", () => {
    expect(stub.providerName).toBe("stub");
  });

  it("returns original text when from === to (en→en)", async () => {
    const result = await stub.translate("Hello world", "en", "en");
    expect(result).toBe("Hello world");
  });

  it("returns original text when from === to (es→es)", async () => {
    const result = await stub.translate("Hola mundo", "es", "es");
    expect(result).toBe("Hola mundo");
  });

  it("returns [EN→ES] prefix for en→es", async () => {
    const result = await stub.translate("Hello", "en", "es");
    expect(result).toBe("[EN→ES] Hello");
  });

  it("returns [ES→EN] prefix for es→en", async () => {
    const result = await stub.translate("Hola", "es", "en");
    expect(result).toBe("[ES→EN] Hola");
  });

  it("returns [EN→FR] prefix for en→fr", async () => {
    const result = await stub.translate("Good morning", "en", "fr");
    expect(result).toBe("[EN→FR] Good morning");
  });

  it("returns [DE→EN] prefix for de→en", async () => {
    const result = await stub.translate("Guten Tag", "de", "en");
    expect(result).toBe("[DE→EN] Guten Tag");
  });

  it("preserves multi-word text with spaces after prefix", async () => {
    const result = await stub.translate("one two three", "en", "de");
    expect(result).toBe("[EN→DE] one two three");
  });
});

// ── 3. TranslationService.detectLanguage() ───────────────────────────

describe("TranslationService.detectLanguage()", () => {
  let service: TranslationService;

  beforeEach(() => {
    service = new TranslationService();
  });

  it("returns a LanguageDetectionResult (not null)", () => {
    const result = service.detectLanguage("The quick brown fox");
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("returns result with language, confidence, and fallback fields", () => {
    const result = service.detectLanguage("Hello how are you");
    expect(result).toHaveProperty("language");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("fallback");
  });

  it("detects English for English text", () => {
    const result = service.detectLanguage("The quick brown fox jumps over the lazy dog");
    expect(result.language).toBe("en");
  });

  it("detects Spanish for Spanish text", () => {
    const result = service.detectLanguage("el la de que en y es por los se del las un con una para");
    expect(result.language).toBe("es");
  });

  it("confidence is between 0 and 1", () => {
    const result = service.detectLanguage("Hello world");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ── 4. TranslationService.translate() ────────────────────────────────

describe("TranslationService.translate()", () => {
  let service: TranslationService;

  beforeEach(() => {
    service = new TranslationService(new StubTranslationProvider());
  });

  it("same language (en→en): returns original text", async () => {
    const result = await service.translate("Hello", "en", "en");
    expect(result.translatedText).toBe("Hello");
    expect(result.originalText).toBe("Hello");
  });

  it("same language (en→en): latencyMs is 0", async () => {
    const result = await service.translate("Hello", "en", "en");
    expect(result.latencyMs).toBe(0);
  });

  it("same language (es→es): returns original text", async () => {
    const result = await service.translate("Hola", "es", "es");
    expect(result.translatedText).toBe("Hola");
  });

  it("cross-language (en→es): stub returns tagged text", async () => {
    const result = await service.translate("Hello", "en", "es");
    expect(result.translatedText).toBe("[EN→ES] Hello");
  });

  it("cross-language (es→en): stub returns tagged text", async () => {
    const result = await service.translate("Hola", "es", "en");
    expect(result.translatedText).toBe("[ES→EN] Hola");
  });

  it("cross-language (en→fr): stub returns tagged text", async () => {
    const result = await service.translate("Good morning", "en", "fr");
    expect(result.translatedText).toBe("[EN→FR] Good morning");
  });

  it("cross-language (en→de): stub returns tagged text", async () => {
    const result = await service.translate("Hello", "en", "de");
    expect(result.translatedText).toBe("[EN→DE] Hello");
  });

  it("latencyMs is a number >= 0 for cross-language", async () => {
    const result = await service.translate("Hello", "en", "es");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThan(1000);
  });

  it("provider name is 'stub'", async () => {
    const result = await service.translate("Hello", "en", "es");
    expect(result.provider).toBe("stub");
  });

  it("fromLanguage and toLanguage are set correctly", async () => {
    const result = await service.translate("Hello", "en", "fr");
    expect(result.fromLanguage).toBe("en");
    expect(result.toLanguage).toBe("fr");
  });

  it("throws for unsupported pair es→fr", async () => {
    await expect(service.translate("Hola", "es", "fr")).rejects.toThrow();
  });

  it("throws for unsupported pair de→es", async () => {
    await expect(service.translate("Guten Tag", "de", "es")).rejects.toThrow();
  });

  it("error message mentions the pair on unsupported translation", async () => {
    await expect(service.translate("text", "es" as TranslationLanguage, "fr" as TranslationLanguage))
      .rejects.toThrow("es→fr");
  });
});

// ── 5. TranslationService.runPipeline() ──────────────────────────────

describe("TranslationService.runPipeline()", () => {
  let service: TranslationService;

  beforeEach(() => {
    service = new TranslationService(new StubTranslationProvider());
  });

  it("same language (caller=en, agent=en): no translations performed", async () => {
    const result = await service.runPipeline(
      "Hello, I need help",
      "Here is your answer",
      "en",
      "en",
    );
    expect(result.translationsPerformed).toBe(0);
  });

  it("same language: agentInput equals callerText", async () => {
    const result = await service.runPipeline("Hello", "Response", "en", "en");
    expect(result.agentInput).toBe("Hello");
  });

  it("same language: callerResponse equals agentResponse", async () => {
    const result = await service.runPipeline("Hello", "The response", "en", "en");
    expect(result.callerResponse).toBe("The response");
  });

  it("cross-language (caller=es, agent=en): 2 translations performed", async () => {
    const result = await service.runPipeline(
      "Hola, necesito ayuda",
      "Here is your answer",
      "en",
      "es",
    );
    expect(result.translationsPerformed).toBe(2);
  });

  it("cross-language: agentInput is caller text translated to agent language", async () => {
    const result = await service.runPipeline("Hola", "Answer", "en", "es");
    expect(result.agentInput).toBe("[ES→EN] Hola");
  });

  it("cross-language: callerResponse is agent response translated to caller language", async () => {
    const result = await service.runPipeline("Hola", "Answer", "en", "es");
    expect(result.callerResponse).toBe("[EN→ES] Answer");
  });

  it("cross-language (en→fr): both translations use correct language tags", async () => {
    const result = await service.runPipeline("Good morning", "Bonjour la réponse", "fr", "en");
    expect(result.agentInput).toBe("[EN→FR] Good morning");
    expect(result.callerResponse).toBe("[FR→EN] Bonjour la réponse");
    expect(result.translationsPerformed).toBe(2);
  });

  it("agentLanguage defaults to 'en' when not provided", async () => {
    const result = await service.runPipeline("Hello", "Answer", undefined, "en");
    expect(result.translationsPerformed).toBe(0);
    expect(result.agentInput).toBe("Hello");
  });

  it("auto-detect: detects caller language from text when callerLanguage omitted", async () => {
    // German text — LanguageDetector should detect "de"
    const result = await service.runPipeline(
      "der die das und ist ich ein nicht sie",
      "Here is the answer",
      "en",
    );
    // Detection should return "de" (high-frequency German words)
    expect(result.detectedLanguage).toBe("de");
    expect(result.detectionConfidence).toBeGreaterThan(0);
  });

  it("auto-detect: callerInput is preserved in result", async () => {
    const callerText = "Hello, how can you help me?";
    const result = await service.runPipeline(callerText, "Response", "en");
    expect(result.callerInput).toBe(callerText);
  });

  it("auto-detect: agentResponse is preserved in result", async () => {
    const agentResp = "The agent response here";
    const result = await service.runPipeline("Hello", agentResp, "en");
    expect(result.agentResponse).toBe(agentResp);
  });

  it("pipelineLatencyMs is a number >= 0", async () => {
    const result = await service.runPipeline("Hello", "Response", "en", "en");
    expect(typeof result.pipelineLatencyMs).toBe("number");
    expect(result.pipelineLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.pipelineLatencyMs).toBeLessThan(1000);
  });

  it("detectionConfidence is 1.0 when callerLanguage is explicitly provided", async () => {
    const result = await service.runPipeline("Hello", "Response", "en", "en");
    expect(result.detectionConfidence).toBe(1.0);
  });
});

// ── 6-8. HTTP Endpoint Tests ──────────────────────────────────────────

describe("Translation API Endpoints", () => {
  let app: Express;
  let server: Server;
  let service: TranslationService;

  beforeAll((done) => {
    service = new TranslationService(new StubTranslationProvider());
    app = buildTestApp(service);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  // ── POST /translation/detect ────────────────────────────────────────

  describe("POST /translation/detect", () => {
    it("returns 200 with language and confidence for valid English text", async () => {
      const res = await httpRequest(server, "POST", "/translation/detect", {
        text: "The quick brown fox jumps over the lazy dog",
      });
      expect(res.status).toBe(200);

      const data = res.json() as {
        language: string;
        confidence: number;
        fallback: boolean;
        supported: boolean;
      };
      expect(data.language).toBeDefined();
      expect(typeof data.confidence).toBe("number");
      expect(typeof data.fallback).toBe("boolean");
      expect(typeof data.supported).toBe("boolean");
    });

    it("returns 200 with supported=true for English detection", async () => {
      const res = await httpRequest(server, "POST", "/translation/detect", {
        text: "The quick brown fox was jumping and had been running",
      });
      expect(res.status).toBe(200);
      const data = res.json() as { language: string; supported: boolean };
      expect(data.language).toBe("en");
      expect(data.supported).toBe(true);
    });

    it("returns 400 when text is missing", async () => {
      const res = await httpRequest(server, "POST", "/translation/detect", {});
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toBeDefined();
    });

    it("returns 400 when text is empty string", async () => {
      const res = await httpRequest(server, "POST", "/translation/detect", { text: "" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when text is not a string", async () => {
      const res = await httpRequest(server, "POST", "/translation/detect", { text: 42 });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /translation/translate ─────────────────────────────────────

  describe("POST /translation/translate", () => {
    it("returns 200 with translated text for en→es", async () => {
      const res = await httpRequest(server, "POST", "/translation/translate", {
        text: "Hello",
        from: "en",
        to: "es",
      });
      expect(res.status).toBe(200);

      const data = res.json() as {
        originalText: string;
        translatedText: string;
        fromLanguage: string;
        toLanguage: string;
        provider: string;
        latencyMs: number;
      };
      expect(data.originalText).toBe("Hello");
      expect(data.translatedText).toBe("[EN→ES] Hello");
      expect(data.fromLanguage).toBe("en");
      expect(data.toLanguage).toBe("es");
      expect(data.provider).toBe("stub");
    });

    it("returns 400 when text is missing", async () => {
      const res = await httpRequest(server, "POST", "/translation/translate", {
        from: "en",
        to: "es",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toBeDefined();
    });

    it("returns 400 when from is missing", async () => {
      const res = await httpRequest(server, "POST", "/translation/translate", {
        text: "Hello",
        to: "es",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when to is missing", async () => {
      const res = await httpRequest(server, "POST", "/translation/translate", {
        text: "Hello",
        from: "en",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for unsupported pair es→fr with descriptive message", async () => {
      const res = await httpRequest(server, "POST", "/translation/translate", {
        text: "Hola",
        from: "es",
        to: "fr",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("es");
      expect(data.error).toContain("fr");
    });

    it("returns 400 for unsupported pair de→es", async () => {
      const res = await httpRequest(server, "POST", "/translation/translate", {
        text: "Guten Tag",
        from: "de",
        to: "es",
      });
      expect(res.status).toBe(400);
    });

    it("returns 200 for same-language translation (en→en)", async () => {
      const res = await httpRequest(server, "POST", "/translation/translate", {
        text: "Hello",
        from: "en",
        to: "en",
      });
      expect(res.status).toBe(200);
      const data = res.json() as { translatedText: string; latencyMs: number };
      expect(data.translatedText).toBe("Hello");
      expect(data.latencyMs).toBe(0);
    });
  });

  // ── POST /translation/pipeline ──────────────────────────────────────

  describe("POST /translation/pipeline", () => {
    it("returns 200 with full PipelineResult for same-language pair", async () => {
      const res = await httpRequest(server, "POST", "/translation/pipeline", {
        callerText: "Hello, I need help",
        agentResponse: "Here is your answer",
        agentLanguage: "en",
        callerLanguage: "en",
      });
      expect(res.status).toBe(200);

      const data = res.json() as {
        callerInput: string;
        detectedLanguage: string;
        detectionConfidence: number;
        agentInput: string;
        agentResponse: string;
        callerResponse: string;
        pipelineLatencyMs: number;
        translationsPerformed: number;
      };
      expect(data.callerInput).toBe("Hello, I need help");
      expect(data.agentInput).toBe("Hello, I need help");
      expect(data.agentResponse).toBe("Here is your answer");
      expect(data.callerResponse).toBe("Here is your answer");
      expect(data.translationsPerformed).toBe(0);
      expect(typeof data.pipelineLatencyMs).toBe("number");
      expect(data.detectionConfidence).toBe(1.0);
    });

    it("returns 200 with 2 translations for cross-language (es caller, en agent)", async () => {
      const res = await httpRequest(server, "POST", "/translation/pipeline", {
        callerText: "Hola necesito ayuda",
        agentResponse: "Here is your answer",
        agentLanguage: "en",
        callerLanguage: "es",
      });
      expect(res.status).toBe(200);
      const data = res.json() as {
        translationsPerformed: number;
        agentInput: string;
        callerResponse: string;
      };
      expect(data.translationsPerformed).toBe(2);
      expect(data.agentInput).toBe("[ES→EN] Hola necesito ayuda");
      expect(data.callerResponse).toBe("[EN→ES] Here is your answer");
    });

    it("returns 400 when callerText is missing", async () => {
      const res = await httpRequest(server, "POST", "/translation/pipeline", {
        agentResponse: "The answer",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("callerText");
    });

    it("returns 400 when agentResponse is missing", async () => {
      const res = await httpRequest(server, "POST", "/translation/pipeline", {
        callerText: "Hello",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("agentResponse");
    });

    it("returns 400 when callerText is empty string", async () => {
      const res = await httpRequest(server, "POST", "/translation/pipeline", {
        callerText: "",
        agentResponse: "Response",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when agentResponse is empty string", async () => {
      const res = await httpRequest(server, "POST", "/translation/pipeline", {
        callerText: "Hello",
        agentResponse: "",
      });
      expect(res.status).toBe(400);
    });

    it("auto-detects language when callerLanguage is omitted", async () => {
      const res = await httpRequest(server, "POST", "/translation/pipeline", {
        callerText: "The quick brown fox was jumping and had been running",
        agentResponse: "Here is your answer",
        agentLanguage: "en",
      });
      expect(res.status).toBe(200);
      const data = res.json() as { detectedLanguage: string; translationsPerformed: number };
      // English text detected → same as agentLanguage → 0 translations
      expect(data.detectedLanguage).toBe("en");
      expect(data.translationsPerformed).toBe(0);
    });
  });
});

// ── Translation HTTP API — error branch coverage ───────────────────────

describe("Translation HTTP API — error branches", () => {
  let app: Express;
  let server: Server;

  beforeAll((done) => {
    // Use a service with a provider that throws
    const throwingProvider = {
      providerName: "throwing",
      translate: async () => { throw new Error("Provider unavailable"); },
    };
    const throwingService = new TranslationService(throwingProvider);
    app = buildTestApp(throwingService);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => { server.close(done); });

  it("POST /translation/translate returns 400 when provider throws", async () => {
    const res = await httpRequest(server, "POST", "/translation/translate", {
      text: "Hello world",
      from: "en",
      to: "es",
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Provider unavailable");
  });

  it("POST /translation/pipeline returns 500 when provider throws", async () => {
    const res = await httpRequest(server, "POST", "/translation/pipeline", {
      callerText: "Hola mundo el la de que",
      agentResponse: "Hello there",
      callerLanguage: "es",
    });
    expect(res.status).toBe(500);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Provider unavailable");
  });
});
