/**
 * capacityCalculatorHtml Unit Tests
 *
 * Verifies the self-contained HTML output contains all required structural
 * elements for the capacity calculator UI.
 */

import { capacityCalculatorHtml } from "../../api/capacityCalculatorHtml.js";

describe("capacityCalculatorHtml()", () => {
  let html: string;

  beforeAll(() => {
    html = capacityCalculatorHtml();
  });

  it("starts with a DOCTYPE declaration", () => {
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html/i);
  });

  it("contains a descriptive page title", () => {
    expect(html).toMatch(/<title>[^<]*[Cc]apacity[^<]*<\/title>/);
  });

  it("contains a peakConcurrentSessions number input", () => {
    expect(html).toMatch(/id="peakConcurrentSessions"/);
    expect(html).toMatch(/type="number"/);
  });

  it("contains avgSessionDurationMinutes input", () => {
    expect(html).toMatch(/id="avgSessionDurationMinutes"/);
  });

  it("contains dailyCallVolume input", () => {
    expect(html).toMatch(/id="dailyCallVolume"/);
  });

  it("POSTs to /capacity/calculate in the JavaScript", () => {
    expect(html).toContain("/capacity/calculate");
  });

  it("contains CSS custom property tokens (design system)", () => {
    expect(html).toMatch(/--blue:/);
    expect(html).toMatch(/--bg:/);
  });

  it("contains recording toggle checkbox", () => {
    expect(html).toMatch(/id="recordingsEnabled"/);
    expect(html).toMatch(/type="checkbox"/);
  });

  it("contains ragEnabled toggle", () => {
    expect(html).toMatch(/id="ragEnabled"/);
  });

  it("contains sentimentAnalysisEnabled toggle", () => {
    expect(html).toMatch(/id="sentimentAnalysisEnabled"/);
  });

  it("contains policyEvaluationEnabled toggle", () => {
    expect(html).toMatch(/id="policyEvaluationEnabled"/);
  });

  it("contains deploymentTarget select element", () => {
    expect(html).toMatch(/id="deploymentTarget"/);
    expect(html).toContain('value="single_server"');
    expect(html).toContain('value="docker"');
    expect(html).toContain('value="kubernetes"');
  });

  it("contains a results section element", () => {
    expect(html).toMatch(/id="results"/);
  });

  it("contains Kubernetes block element", () => {
    expect(html).toMatch(/id="k8s-block"/);
  });

  it("contains warnings list element", () => {
    expect(html).toMatch(/id="warnings-list"/);
  });

  it("contains scaling notes list element", () => {
    expect(html).toMatch(/id="notes-list"/);
  });

  it("contains storage breakdown table body", () => {
    expect(html).toMatch(/id="storage-body"/);
  });
});
