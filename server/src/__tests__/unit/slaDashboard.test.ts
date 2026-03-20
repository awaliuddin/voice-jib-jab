/**
 * slaDashboard Unit Tests
 *
 * Verifies that slaDashboardHtml() returns a valid, complete HTML page
 * that satisfies structural, content, and behaviour requirements.
 */

import { slaDashboardHtml } from "../../api/slaDashboard.js";

describe("slaDashboardHtml()", () => {
  let html: string;

  beforeAll(() => {
    html = slaDashboardHtml();
  });

  it("returns a non-empty string", () => {
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("is valid HTML — starts with DOCTYPE", () => {
    expect(html.toLowerCase().trimStart()).toMatch(/^<!doctype html>/);
  });

  it("is valid HTML — closes with </html>", () => {
    expect(html.trimEnd().toLowerCase()).toMatch(/<\/html>$/);
  });

  it("title contains 'SLA Monitor'", () => {
    expect(html).toContain("SLA Monitor");
  });

  it("contains a link to /dashboard", () => {
    expect(html).toContain('href="/dashboard"');
  });

  it("contains fetch('/sla/status') for data polling", () => {
    expect(html).toContain("fetch('/sla/status')");
  });

  it("contains metric key 'ttfb'", () => {
    expect(html).toContain("ttfb");
  });

  it("contains metric key 'policyEval'", () => {
    expect(html).toContain("policyEval");
  });

  it("contains metric key 'ttsLatency'", () => {
    expect(html).toContain("ttsLatency");
  });

  it("contains metric key 'sttLatency'", () => {
    expect(html).toContain("sttLatency");
  });

  it("contains CSS variable --bg:#0a0a0f", () => {
    expect(html).toContain("--bg:#0a0a0f");
  });

  it("contains setInterval for auto-refresh", () => {
    expect(html).toContain("setInterval");
  });

  it("contains 'OK' status label", () => {
    expect(html).toContain("'OK'");
  });

  it("contains 'WARNING' status label", () => {
    expect(html).toContain("'WARNING'");
  });

  it("contains 'CRITICAL' status label", () => {
    expect(html).toContain("'CRITICAL'");
  });
});
