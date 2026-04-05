/**
 * LanguageDetector Tests
 *
 * Tests the LanguageDetector service and Language API endpoints.
 * Follows the AgentTemplates.test.ts pattern: standalone Express app with
 * injected deps and raw HTTP request helpers.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, mkdtempSync } from "fs";
import { LanguageDetector } from "../../services/LanguageDetector.js";
import { AgentTemplateStore } from "../../services/AgentTemplateStore.js";
import { createLanguageRouter } from "../../api/language.js";

// ── HTTP helpers ──────────────────────────────────────────────────────

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
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: { "Content-Type": "application/json" },
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
      req.end();
    });
  });
}

// ── Test setup helpers ────────────────────────────────────────────────

function tempFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `lang-test-${name}-`));
  return join(dir, "templates.json");
}

function buildTestApp(store: AgentTemplateStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/language", createLanguageRouter(store));
  return app;
}

// ── Unit Tests: LanguageDetector ──────────────────────────────────────

describe("LanguageDetector", () => {
  let detector: LanguageDetector;

  beforeEach(() => {
    detector = new LanguageDetector();
  });

  it("detects English text as 'en'", () => {
    const result = detector.detect("The quick brown fox jumps over the lazy dog. This is a sentence with many common English words.");
    expect(result.language).toBe("en");
  });

  it("detects Spanish text as 'es'", () => {
    const result = detector.detect("el coche es muy rápido y la casa es grande para los niños del barrio");
    expect(result.language).toBe("es");
  });

  it("detects French text as 'fr'", () => {
    const result = detector.detect("le chat est sur la table et les enfants sont avec nous au parc");
    expect(result.language).toBe("fr");
  });

  it("detects German text as 'de'", () => {
    const result = detector.detect("der Mann und die Frau sind nicht zu Hause ich bin auch von der Schule");
    expect(result.language).toBe("de");
  });

  it("short text (1 word) falls back to 'en'", () => {
    const result = detector.detect("hello");
    expect(result.fallback).toBe(true);
    expect(result.language).toBe("en");
  });

  it("empty string falls back to 'en'", () => {
    const result = detector.detect("");
    expect(result.fallback).toBe(true);
    expect(result.language).toBe("en");
  });

  it("whitespace-only string falls back to 'en'", () => {
    const result = detector.detect("   ");
    expect(result.fallback).toBe(true);
    expect(result.language).toBe("en");
  });

  it("mixed language text returns highest scoring language", () => {
    // Heavily Spanish biased mix
    const result = detector.detect("el la de que en y es por los se del las un con una para como pero más hay");
    expect(result.language).toBe("es");
  });

  it("confidence > 0.5 for clear English sample", () => {
    const result = detector.detect("the dog is running and they have been waiting with that can would could should");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("confidence > 0.5 for clear Spanish sample", () => {
    const result = detector.detect("el la de que en y es por los se del las un con una para como pero más hay");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("confidence > 0.5 for clear French sample", () => {
    const result = detector.detect("le la de et en est les des que un une pas je vous nous il qui sur au avec");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("confidence > 0.5 for clear German sample", () => {
    const result = detector.detect("der die das und ist ich ein nicht sie es den zu mit auf dem für im an auch von");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("fallback=true when confidence below threshold (gibberish)", () => {
    const result = detector.detect("xyz qrz blrp fnwq zmpt dkrq wvxz pqrst mnbvcxz lkjhg");
    expect(result.fallback).toBe(true);
  });

  it("fallback=false for clear Spanish detection", () => {
    const result = detector.detect("el la de que en y es por los se del las un con una para como pero más hay");
    expect(result.fallback).toBe(false);
  });

  it("confidence is always in range 0.0-1.0", () => {
    const texts = [
      "hello world",
      "el la de que en",
      "le la de et en",
      "",
      "中文字符",
      "xkcd qwerty zxcv",
    ];
    for (const text of texts) {
      const result = detector.detect(text);
      expect(result.confidence).toBeGreaterThanOrEqual(0.0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  it("detect() result always has language, confidence, fallback fields", () => {
    const result = detector.detect("some text here");
    expect(result).toHaveProperty("language");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("fallback");
  });

  it("Portuguese has some detection (any result, not testing exact since pt/es word overlap)", () => {
    const result = detector.detect("de a o que e do da em um para com uma os no se na por mais as dos");
    // Result is valid — either 'pt' or 'es' due to word overlap; just confirm no crash and valid fields
    expect(["pt", "es", "en", "fr", "de"]).toContain(result.language);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("CJK characters trigger fallback to 'en'", () => {
    const result = detector.detect("这是中文文本 你好世界");
    expect(result.language).toBe("en");
    expect(result.fallback).toBe(true);
  });

  it("Cyrillic characters trigger fallback to 'en'", () => {
    const result = detector.detect("Привет мир это русский текст");
    expect(result.language).toBe("en");
    expect(result.fallback).toBe(true);
  });

  it("Arabic characters trigger fallback to 'en'", () => {
    const result = detector.detect("مرحبا هذا نص عربي");
    expect(result.language).toBe("en");
    expect(result.fallback).toBe(true);
  });

  it("unknown/gibberish text falls back to 'en'", () => {
    const result = detector.detect("fhqwhgads fhqwhgadshgnsdhjsdbkhsdabkfabkveib");
    expect(result.language).toBe("en");
    expect(result.fallback).toBe(true);
  });
});

// ── Integration Tests: Language API ──────────────────────────────────

describe("Language API Endpoints", () => {
  let app: Express;
  let server: Server;
  let store: AgentTemplateStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("api");
    store = new AgentTemplateStore(storageFile);
    app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
      done();
    });
  });

  it("GET /language/detect?text=... returns 200 with language fields", async () => {
    const res = await httpRequest(server, "GET", "/language/detect?text=the+quick+brown+fox+jumps+over+the+lazy+dog");
    expect(res.status).toBe(200);

    const data = res.json() as { language: string; confidence: number; fallback: boolean; templateId: string };
    expect(data).toHaveProperty("language");
    expect(data).toHaveProperty("confidence");
    expect(data).toHaveProperty("fallback");
    expect(data).toHaveProperty("templateId");
  });

  it("GET /language/detect returns templateId=builtin-support-es for Spanish text", async () => {
    const text = encodeURIComponent("el la de que en y es por los se del las un con una para como pero más hay");
    const res = await httpRequest(server, "GET", `/language/detect?text=${text}`);
    expect(res.status).toBe(200);

    const data = res.json() as { language: string; templateId: string };
    expect(data.language).toBe("es");
    expect(data.templateId).toBe("builtin-support-es");
  });

  it("GET /language/detect returns templateId=builtin-support-fr for French text", async () => {
    const text = encodeURIComponent("le la de et en est les des que un une pas je vous nous il qui sur au avec");
    const res = await httpRequest(server, "GET", `/language/detect?text=${text}`);
    expect(res.status).toBe(200);

    const data = res.json() as { language: string; templateId: string };
    expect(data.language).toBe("fr");
    expect(data.templateId).toBe("builtin-support-fr");
  });

  it("GET /language/detect missing text param returns 400", async () => {
    const res = await httpRequest(server, "GET", "/language/detect");
    expect(res.status).toBe(400);

    const data = res.json() as { error: string };
    expect(data.error).toBe("text query parameter is required");
  });

  it("GET /language/templates returns grouped object", async () => {
    const res = await httpRequest(server, "GET", "/language/templates");
    expect(res.status).toBe(200);

    const data = res.json() as Record<string, unknown[]>;
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
    // Should have at least some language groups
    expect(Object.keys(data).length).toBeGreaterThan(0);
  });

  it("builtin-support-es appears in 'es' group in /language/templates", async () => {
    const res = await httpRequest(server, "GET", "/language/templates");
    expect(res.status).toBe(200);

    const data = res.json() as Record<string, Array<{ templateId: string }>>;
    expect(data.es).toBeDefined();
    const esIds = data.es.map((t) => t.templateId);
    expect(esIds).toContain("builtin-support-es");
  });

  it("builtin-support-fr appears in 'fr' group in /language/templates", async () => {
    const res = await httpRequest(server, "GET", "/language/templates");
    expect(res.status).toBe(200);

    const data = res.json() as Record<string, Array<{ templateId: string }>>;
    expect(data.fr).toBeDefined();
    const frIds = data.fr.map((t) => t.templateId);
    expect(frIds).toContain("builtin-support-fr");
  });

  it("builtin-customer-support appears in 'en' group in /language/templates", async () => {
    const res = await httpRequest(server, "GET", "/language/templates");
    expect(res.status).toBe(200);

    const data = res.json() as Record<string, Array<{ templateId: string }>>;
    expect(data.en).toBeDefined();
    const enIds = data.en.map((t) => t.templateId);
    expect(enIds).toContain("builtin-customer-support");
  });
});

// ── Branch coverage ───────────────────────────────────────────────────

describe("Language API — branch coverage", () => {
  // L49 binary-expr: the `?? "builtin-customer-support"` fallback fires when
  // result.language is not a key in LANGUAGE_TEMPLATE_MAP.  The typed
  // LanguageDetector can never return such a value, so we mock the prototype.
  it("GET /language/detect falls back to builtin-customer-support for unmapped language (L49 ?? branch)", async () => {
    const { LanguageDetector } = await import("../../services/LanguageDetector.js");
    const detectSpy = jest
      .spyOn(LanguageDetector.prototype, "detect")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockReturnValueOnce({ language: "xx" as any, confidence: 0.9, fallback: false });

    const { AgentTemplateStore } = await import("../../services/AgentTemplateStore.js");
    const { createLanguageRouter } = await import("../../api/language.js");
    const express = (await import("express")).default;
    const { createServer } = await import("http");

    const dir = mkdtempSync(join(tmpdir(), "lang-branch-"));
    const storeFile = join(dir, "templates.json");
    const store = new AgentTemplateStore(storeFile);

    const app = express();
    app.use(express.json());
    app.use("/language", createLanguageRouter(store));

    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    try {
      const res = await httpRequest(server, "GET", "/language/detect?text=sometext");
      expect(res.status).toBe(200);
      const data = res.json() as { templateId: string; language: string };
      expect(data.templateId).toBe("builtin-customer-support");
    } finally {
      detectSpy.mockRestore();
      await new Promise<void>((r) => server.close(() => r()));
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

// ── Integration Tests: AgentTemplateStore count ───────────────────────

describe("AgentTemplateStore with new language templates", () => {
  let store: AgentTemplateStore;
  let storageFile: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "lang-store-test-"));
    storageFile = join(dir, "templates.json");
    store = new AgentTemplateStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("listTemplates() with new language templates returns 7+ templates (was 4)", () => {
    const all = store.listTemplates();
    expect(all.length).toBeGreaterThanOrEqual(7);
  });

  it("builtin-support-es is in the store", () => {
    const tpl = store.getTemplate("builtin-support-es");
    expect(tpl).toBeDefined();
    expect(tpl!.builtIn).toBe(true);
    expect(tpl!.name).toBe("Customer Support (Spanish)");
  });

  it("builtin-support-fr is in the store", () => {
    const tpl = store.getTemplate("builtin-support-fr");
    expect(tpl).toBeDefined();
    expect(tpl!.builtIn).toBe(true);
    expect(tpl!.name).toBe("Customer Support (French)");
  });

  it("builtin-support-de is in the store", () => {
    const tpl = store.getTemplate("builtin-support-de");
    expect(tpl).toBeDefined();
    expect(tpl!.builtIn).toBe(true);
    expect(tpl!.name).toBe("Customer Support (German)");
  });
});
