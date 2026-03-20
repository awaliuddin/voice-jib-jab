/**
 * conversationAnalyticsDashboard Unit Tests
 *
 * Verifies the self-contained HTML output of conversationAnalyticsDashboardHtml().
 * All assertions operate on the raw HTML string — no DOM parsing required.
 */

import { conversationAnalyticsDashboardHtml } from "../../api/conversationAnalyticsDashboard.js";

describe("conversationAnalyticsDashboardHtml()", () => {
  let html: string;

  beforeAll(() => {
    html = conversationAnalyticsDashboardHtml();
  });

  it("begins with a DOCTYPE declaration", () => {
    expect(html.trim().toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("has title 'Conversation Analytics'", () => {
    expect(html).toContain("<title>Conversation Analytics</title>");
  });

  it("contains a link back to /dashboard", () => {
    expect(html).toContain('href="/dashboard"');
  });

  it("fetches the /analytics/conversations/insights endpoint", () => {
    expect(html).toContain("/analytics/conversations/insights");
  });

  it("contains a topic clusters section", () => {
    expect(html.toLowerCase()).toContain("topic cluster");
  });

  it("contains an FAQ table element", () => {
    // FAQ section rendered as a <table>
    expect(html).toContain('<table');
    expect(html.toLowerCase()).toContain("frequent question");
  });

  it("contains CSS custom property variables (design system tokens)", () => {
    expect(html).toContain("--blue:");
    expect(html).toContain("--bg:");
  });

  it("uses setInterval for auto-refresh", () => {
    expect(html).toContain("setInterval");
  });

  it("auto-refresh interval is 60000ms", () => {
    expect(html).toContain("60000");
  });

  it("contains filter form controls for tenantId and date range", () => {
    expect(html).toContain("f-tenant");
    expect(html).toContain("f-from");
    expect(html).toContain("f-to");
  });

  it("contains a handle time section", () => {
    expect(html.toLowerCase()).toContain("handle time");
  });
});
