/**
 * complianceDashboardHtml Unit Tests
 *
 * Verifies the static HTML output of complianceDashboardPageHtml().
 */

import { complianceDashboardPageHtml } from "../../api/complianceDashboardHtml.js";

describe("complianceDashboardPageHtml()", () => {
  let html: string;

  beforeAll(() => {
    html = complianceDashboardPageHtml();
  });

  it("returns a non-empty string", () => {
    expect(html.length).toBeGreaterThan(0);
  });

  it("is valid HTML: has doctype and closing html tag", () => {
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain("</html>");
  });

  it("title contains 'Compliance'", () => {
    expect(html).toMatch(/<title[^>]*>[^<]*[Cc]ompliance[^<]*<\/title>/);
  });

  it("contains back link to /dashboard", () => {
    expect(html).toContain("href=\"/dashboard\"");
  });

  it("contains fetch('/compliance-dashboard/overview') call", () => {
    expect(html).toContain("fetch('/compliance-dashboard/overview')");
  });

  it("contains all 5 regulation names", () => {
    expect(html).toContain("GDPR");
    expect(html).toContain("HIPAA");
    expect(html).toContain("SOC2");
    expect(html).toContain("PCI_DSS");
    expect(html).toContain("CCPA");
  });

  it("contains CSS variables matching electric blue design system (--bg:#0a0a0f)", () => {
    expect(html).toContain("--bg:#0a0a0f");
  });

  it("contains status classes: compliant, partial, non_compliant", () => {
    expect(html).toContain("badge-compliant");
    expect(html).toContain("badge-partial");
    expect(html).toContain("badge-non_compliant");
  });

  it("contains setInterval for auto-refresh", () => {
    expect(html).toContain("setInterval");
  });

  it("contains 'certificate' reference (for cert link rendering)", () => {
    expect(html).toMatch(/certificate/i);
  });
});
