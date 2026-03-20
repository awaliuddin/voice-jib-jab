/**
 * SlaMonitor Unit Tests
 *
 * Covers record(), getStatus(), getMetricStats(), getSamples(), clear(),
 * event emission, webhook behaviour, and window pruning.
 */

import { SlaMonitor, DEFAULT_SLA_TARGETS } from "../../services/SlaMonitor.js";

// ── Helpers ───────────────────────────────────────────────────────────

function makeSample(metric: string, valueMs: number, timestamp = Date.now()) {
  return { metric, valueMs, timestamp };
}

function makeMonitor(opts?: ConstructorParameters<typeof SlaMonitor>[0]) {
  return new SlaMonitor(opts);
}

// ── record() ──────────────────────────────────────────────────────────

describe("SlaMonitor — record()", () => {
  it("adds sample to the buffer", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 100));
    expect(m.getSamples("ttfb")).toHaveLength(1);
  });

  it("adds multiple samples for the same metric", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 100));
    m.record(makeSample("ttfb", 200));
    m.record(makeSample("ttfb", 300));
    expect(m.getSamples("ttfb")).toHaveLength(3);
  });

  it("prunes samples older than windowMinutes", () => {
    const m = makeMonitor({ windowMinutes: 1 });
    const oldTs = Date.now() - 2 * 60 * 1000; // 2 minutes ago
    m.record(makeSample("ttfb", 100, oldTs));
    m.record(makeSample("ttfb", 200)); // current
    const samples = m.getSamples("ttfb");
    // Old sample should have been pruned when the second was added
    expect(samples.every((s) => s.timestamp >= Date.now() - 60 * 1000 - 100)).toBe(true);
    expect(samples).toHaveLength(1);
  });

  it("does not prune samples within the window", () => {
    const m = makeMonitor({ windowMinutes: 60 });
    const recentTs = Date.now() - 30 * 60 * 1000; // 30 minutes ago — still in window
    m.record(makeSample("ttfb", 100, recentTs));
    m.record(makeSample("ttfb", 200));
    expect(m.getSamples("ttfb")).toHaveLength(2);
  });
});

// ── getStatus() — overall classification ─────────────────────────────

describe("SlaMonitor — getStatus() overall", () => {
  it("returns overall 'ok' when no samples have been recorded", () => {
    const m = makeMonitor();
    expect(m.getStatus().overall).toBe("ok");
  });

  it("returns overall 'ok' when all samples are below targetMs", () => {
    const m = makeMonitor();
    // ttfb targetMs = 500 — add 10 samples well below
    for (let i = 0; i < 10; i++) m.record(makeSample("ttfb", 100));
    expect(m.getStatus().overall).toBe("ok");
  });

  it("returns overall 'warning' when breach rate >= 5% but < 20%", () => {
    const m = makeMonitor();
    // 10% breach rate: 1 breach out of 10
    for (let i = 0; i < 9; i++) m.record(makeSample("ttfb", 100));
    m.record(makeSample("ttfb", 600)); // > 500ms target
    expect(m.getStatus().overall).toBe("warning");
  });

  it("returns overall 'critical' when any breach rate >= 20%", () => {
    const m = makeMonitor();
    // 20% breach rate: 2 out of 10
    for (let i = 0; i < 8; i++) m.record(makeSample("ttfb", 100));
    m.record(makeSample("ttfb", 600));
    m.record(makeSample("ttfb", 600));
    expect(m.getStatus().overall).toBe("critical");
  });
});

// ── getStatus() — metric stats ────────────────────────────────────────

describe("SlaMonitor — getStatus() metric stats", () => {
  it("sampleCount matches recorded samples", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 100));
    m.record(makeSample("ttfb", 200));
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    expect(stats.sampleCount).toBe(2);
  });

  it("breachCount counts samples > targetMs", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 400));  // below 500 target — not a breach
    m.record(makeSample("ttfb", 500));  // equal — not a breach
    m.record(makeSample("ttfb", 501));  // above — breach
    m.record(makeSample("ttfb", 1000)); // above — breach
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    expect(stats.breachCount).toBe(2);
  });

  it("criticalBreachCount counts samples > criticalMs", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 600));  // > target but < 1200 critical
    m.record(makeSample("ttfb", 1201)); // > 1200 critical
    m.record(makeSample("ttfb", 1300)); // > 1200 critical
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    expect(stats.criticalBreachCount).toBe(2);
  });

  it("breachRatePct = breachCount / sampleCount * 100", () => {
    const m = makeMonitor();
    for (let i = 0; i < 8; i++) m.record(makeSample("ttfb", 100));
    m.record(makeSample("ttfb", 600));
    m.record(makeSample("ttfb", 600));
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    expect(stats.breachRatePct).toBeCloseTo(20, 5);
  });

  it("uptimePct = 100 - breachRatePct", () => {
    const m = makeMonitor();
    for (let i = 0; i < 9; i++) m.record(makeSample("ttfb", 100));
    m.record(makeSample("ttfb", 600)); // 10% breach
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    expect(stats.uptimePct).toBeCloseTo(90, 5);
  });

  it("windowStartedAt is set to ISO string when samples exist", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 100));
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    expect(typeof stats.windowStartedAt).toBe("string");
    expect(() => new Date(stats.windowStartedAt)).not.toThrow();
  });

  it("evaluatedAt is set to ISO string", () => {
    const m = makeMonitor();
    const status = m.getStatus();
    expect(typeof status.evaluatedAt).toBe("string");
    expect(new Date(status.evaluatedAt).getTime()).toBeGreaterThan(0);
  });

  it("windowMinutes matches configured value", () => {
    const m = makeMonitor({ windowMinutes: 30 });
    expect(m.getStatus().windowMinutes).toBe(30);
  });

  it("status has 4 metrics matching DEFAULT_SLA_TARGETS", () => {
    const m = makeMonitor();
    const keys = m.getStatus().metrics.map((x) => x.metric);
    expect(keys).toEqual(expect.arrayContaining(Object.keys(DEFAULT_SLA_TARGETS)));
    expect(keys).toHaveLength(4);
  });
});

// ── getStatus() — percentiles ─────────────────────────────────────────

describe("SlaMonitor — percentiles", () => {
  it("p50 correct for [100, 200, 300, 400, 500] (= 300)", () => {
    const m = makeMonitor();
    [100, 200, 300, 400, 500].forEach((v) => m.record(makeSample("ttfb", v)));
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    // floor(5 * 0.5) = floor(2.5) = 2 → sorted[2] = 300
    expect(stats.p50Ms).toBe(300);
  });

  it("p95 correct for 20-element sorted array", () => {
    const m = makeMonitor();
    for (let i = 1; i <= 20; i++) m.record(makeSample("ttfb", i * 10));
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    // floor(20 * 0.95) = floor(19) = 19 → sorted[19] = 200
    expect(stats.p95Ms).toBe(200);
  });

  it("metrics with 0 samples return all zeros and uptimePct=100", () => {
    const m = makeMonitor();
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    expect(stats.sampleCount).toBe(0);
    expect(stats.p50Ms).toBe(0);
    expect(stats.p95Ms).toBe(0);
    expect(stats.p99Ms).toBe(0);
    expect(stats.breachCount).toBe(0);
    expect(stats.criticalBreachCount).toBe(0);
    expect(stats.breachRatePct).toBe(0);
    expect(stats.uptimePct).toBe(100);
  });
});

// ── events ────────────────────────────────────────────────────────────

describe("SlaMonitor — events", () => {
  it("emits 'breach' when sample > targetMs", (done) => {
    const m = makeMonitor();
    m.on("breach", () => done());
    m.record(makeSample("ttfb", 501)); // > 500 target
  });

  it("does NOT emit 'breach' when sample <= targetMs", () => {
    const m = makeMonitor();
    const spy = jest.fn();
    m.on("breach", spy);
    m.record(makeSample("ttfb", 500)); // equal — no breach
    m.record(makeSample("ttfb", 400)); // below — no breach
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits 'critical' when sample > criticalMs", (done) => {
    const m = makeMonitor();
    m.on("critical", () => done());
    m.record(makeSample("ttfb", 1201)); // > 1200 criticalMs
  });

  it("breach event has correct metric, valueMs, targetMs, severity, timestamp", (done) => {
    const m = makeMonitor();
    m.on("breach", (event) => {
      expect(event.metric).toBe("ttfb");
      expect(event.valueMs).toBe(600);
      expect(event.targetMs).toBe(500);
      expect(event.severity).toBe("warning");
      expect(typeof event.timestamp).toBe("string");
      done();
    });
    m.record(makeSample("ttfb", 600));
  });

  it("critical event has severity='critical'", (done) => {
    const m = makeMonitor();
    m.on("critical", (event) => {
      expect(event.severity).toBe("critical");
      done();
    });
    m.record(makeSample("ttfb", 1500));
  });

  it("critical event targetMs is the criticalMs threshold", (done) => {
    const m = makeMonitor();
    m.on("critical", (event) => {
      expect(event.targetMs).toBe(DEFAULT_SLA_TARGETS.ttfb.criticalMs);
      done();
    });
    m.record(makeSample("ttfb", 1500));
  });
});

// ── getSamples() ──────────────────────────────────────────────────────

describe("SlaMonitor — getSamples()", () => {
  it("returns all samples when no metric filter is supplied", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 100));
    m.record(makeSample("sttLatency", 50));
    expect(m.getSamples()).toHaveLength(2);
  });

  it("returns only samples for the specified metric", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 100));
    m.record(makeSample("ttfb", 200));
    m.record(makeSample("sttLatency", 50));
    const samples = m.getSamples("ttfb");
    expect(samples).toHaveLength(2);
    expect(samples.every((s) => s.metric === "ttfb")).toBe(true);
  });
});

// ── clear() ───────────────────────────────────────────────────────────

describe("SlaMonitor — clear()", () => {
  it("removes all samples across all metrics", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 100));
    m.record(makeSample("sttLatency", 50));
    m.clear();
    expect(m.getSamples()).toHaveLength(0);
  });

  it("getStatus() shows sampleCount=0 after clear()", () => {
    const m = makeMonitor();
    m.record(makeSample("ttfb", 100));
    m.clear();
    const stats = m.getStatus().metrics.find((x) => x.metric === "ttfb")!;
    expect(stats.sampleCount).toBe(0);
  });
});

// ── custom targets ────────────────────────────────────────────────────

describe("SlaMonitor — custom targets", () => {
  it("custom targets override defaults", () => {
    const m = makeMonitor({
      targets: {
        custom: { name: "Custom", targetMs: 50, criticalMs: 200, description: "Test" },
      },
    });
    m.record(makeSample("custom", 60)); // > 50 target
    const stats = m.getMetricStats("custom")!;
    expect(stats.breachCount).toBe(1);
  });

  it("getMetricStats returns undefined for unknown metric", () => {
    const m = makeMonitor();
    expect(m.getMetricStats("nonexistent")).toBeUndefined();
  });
});

// ── webhook ───────────────────────────────────────────────────────────

describe("SlaMonitor — webhook", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("webhook is called on critical breach", async () => {
    const m = makeMonitor({ webhookUrl: "https://example.com/webhook" });
    m.record(makeSample("ttfb", 1500)); // > 1200 criticalMs
    // Allow the async webhook call to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/webhook",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("webhook is NOT called on warning breach (sample > targetMs but < criticalMs)", async () => {
    const m = makeMonitor({ webhookUrl: "https://example.com/webhook" });
    m.record(makeSample("ttfb", 600)); // > 500 target, < 1200 critical
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("webhook failure is non-fatal", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"));
    const m = makeMonitor({ webhookUrl: "https://example.com/webhook" });
    expect(() => m.record(makeSample("ttfb", 1500))).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});
