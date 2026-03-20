/**
 * onboardingWizardHtml Unit Tests
 *
 * Verifies the self-contained HTML wizard returned by onboardingWizardHtml().
 * Tests structural requirements: doctype, title, step names, progress bar,
 * panel presence, CSS variables, and API call patterns.
 */

import { onboardingWizardHtml } from "../../api/onboardingWizardHtml.js";

describe("onboardingWizardHtml()", () => {
  let html: string;

  beforeAll(() => {
    html = onboardingWizardHtml();
  });

  it("starts with DOCTYPE html", () => {
    expect(html.trim().toLowerCase()).toMatch(/^<!doctype html/);
  });

  it("contains a <title> with 'Onboarding'", () => {
    expect(html).toMatch(/<title[^>]*>[^<]*[Oo]nboarding[^<]*<\/title>/);
  });

  it("contains all 5 step names in the progress bar", () => {
    expect(html).toMatch(/Registration/i);
    expect(html).toMatch(/Voice/i);
    expect(html).toMatch(/Claims/i);
    expect(html).toMatch(/Policy/i);
    expect(html).toMatch(/Test Call/i);
  });

  it("contains progress bar step elements (prog-0 through prog-4)", () => {
    for (let i = 0; i < 5; i++) {
      expect(html).toContain(`id="prog-${i}"`);
    }
  });

  it("contains all 5 step panels (panel-0 through panel-4)", () => {
    for (let i = 0; i < 5; i++) {
      expect(html).toContain(`id="panel-${i}"`);
    }
  });

  it("contains the Tenant Registration step panel", () => {
    expect(html).toMatch(/Tenant Registration/i);
  });

  it("contains the Voice Configuration step panel", () => {
    expect(html).toMatch(/Voice Configuration/i);
  });

  it("contains the Claims Registry step panel", () => {
    expect(html).toMatch(/Claims Registry/i);
  });

  it("contains the Policy Rules step panel", () => {
    expect(html).toMatch(/Policy Rules/i);
  });

  it("contains the Test Call step panel with a 'Run Test Call' button", () => {
    expect(html).toMatch(/Run Test Call/i);
  });

  it("uses CSS custom properties from the electric blue design system (--blue)", () => {
    expect(html).toContain("--blue:");
  });

  it("uses --bg and --surface CSS variables", () => {
    expect(html).toContain("--bg:");
    expect(html).toContain("--surface:");
  });

  it("references the complete-step API endpoint", () => {
    expect(html).toMatch(/complete-step/);
  });

  it("includes a success screen element", () => {
    expect(html).toContain("success-screen");
    expect(html).toMatch(/Onboarding Complete/i);
  });
});
