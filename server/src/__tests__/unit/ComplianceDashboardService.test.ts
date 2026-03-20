/**
 * ComplianceDashboardService Unit Tests
 *
 * Mock strategy: jest.fn() mocks for TenantRegistry and SessionRecorder.
 * No disk I/O. All session data constructed in-memory.
 */

import {
  ComplianceDashboardService,
  type TenantComplianceReport,
} from "../../services/ComplianceDashboardService.js";
import type { TenantRegistry, TenantConfig } from "../../services/TenantRegistry.js";
import type { SessionRecorder, SessionRecording } from "../../services/SessionRecorder.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTenant(tenantId: string): TenantConfig {
  return {
    tenantId,
    name: tenantId,
    createdAt: "2026-01-01T00:00:00.000Z",
    policyLevel: "standard",
    claimsThreshold: 0.5,
    claims: [],
    disallowedPatterns: [],
  };
}

function makeRecording(overrides: Partial<SessionRecording> = {}): SessionRecording {
  return {
    sessionId: overrides.sessionId ?? "sess-001",
    startedAt: overrides.startedAt ?? "2026-03-01T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-01T10:05:00.000Z",
    durationMs: overrides.durationMs ?? 300_000,
    tenantId: overrides.tenantId ?? "tenant-a",
    timeline: overrides.timeline ?? [],
    summary: overrides.summary ?? {
      turnCount: 5,
      policyDecisions: { allow: 8, refuse: 1, escalate: 0, rewrite: 1, cancel_output: 0 },
      audioInputChunks: 100,
      audioOutputChunks: 80,
    },
  };
}

function makePolicyDecisionEntry(decision: string) {
  return {
    t_ms: 1000,
    type: "policy.decision",
    payload: { decision },
  };
}

function makeSessionStartEntry() {
  return {
    t_ms: 0,
    type: "session.start",
    payload: {},
  };
}

function makeMockRegistry(tenants: TenantConfig[]): Pick<TenantRegistry, "listTenants" | "getTenant"> {
  return {
    listTenants: jest.fn(() => tenants),
    getTenant: jest.fn((id: string) => tenants.find((t) => t.tenantId === id) ?? null),
  };
}

function makeMockRecorder(
  recordings: SessionRecording[],
): Pick<SessionRecorder, "listRecordings" | "loadRecording"> {
  const metaList = recordings.map(({ timeline: _t, ...meta }) => meta);
  return {
    listRecordings: jest.fn(() => metaList),
    loadRecording: jest.fn((sessionId: string) =>
      recordings.find((r) => r.sessionId === sessionId) ?? null,
    ),
  };
}

function buildService(
  tenants: TenantConfig[],
  recordings: SessionRecording[],
  retentionDays: number | null = 30,
): ComplianceDashboardService {
  return new ComplianceDashboardService(
    makeMockRegistry(tenants) as unknown as TenantRegistry,
    makeMockRecorder(recordings) as unknown as SessionRecorder,
    retentionDays,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ComplianceDashboardService", () => {

  // ── evaluateTenant ───────────────────────────────────────────────────────

  describe("evaluateTenant()", () => {
    it("throws if tenant is not registered", async () => {
      const svc = buildService([], []);
      await expect(svc.evaluateTenant("unknown-tenant")).rejects.toThrow("not found");
    });

    it("builds context with correct sessionCount", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({ sessionId: "s1", tenantId: "tenant-a" }),
        makeRecording({ sessionId: "s2", tenantId: "tenant-a" }),
        makeRecording({ sessionId: "s3", tenantId: "tenant-b" }), // different tenant
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      // Only sessions belonging to tenant-a counted
      expect(report.complianceScorePct).toBeGreaterThanOrEqual(0);
      // Indirectly verify by checking gaps — with 2 sessions we can check behavior
      // We verify sessionCount by checking HIPAA-3 (passes when sessionCount===0 or score>=60)
      // Since sessions exist (count=2) and avgQuality=0, HIPAA-3 fails
      const hipaa3 = report.byRegulation.HIPAA.requirements.find(
        (r) => r.requirementId === "HIPAA-3",
      );
      expect(hipaa3).toBeDefined();
      // sessionCount is 2, quality is 0 → HIPAA-3 should fail
      expect(hipaa3!.passed).toBe(false);
    });

    it("hasAuditTrail=true when policy.decision events exist in timeline", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makePolicyDecisionEntry("allow")],
        }),
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      const hipaa1 = report.byRegulation.HIPAA.requirements.find(
        (r) => r.requirementId === "HIPAA-1",
      );
      expect(hipaa1!.passed).toBe(true);
    });

    it("hasAuditTrail=false when no policy.decision events in timeline", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry()],
        }),
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      const hipaa1 = report.byRegulation.HIPAA.requirements.find(
        (r) => r.requirementId === "HIPAA-1",
      );
      expect(hipaa1!.passed).toBe(false);
    });

    it("hasDataRetentionPolicy=true when retentionDays is non-null", async () => {
      const tenants = [makeTenant("tenant-a")];
      const svc = buildService(tenants, [], 30);
      const report = await svc.evaluateTenant("tenant-a");
      const gdpr2 = report.byRegulation.GDPR.requirements.find(
        (r) => r.requirementId === "GDPR-2",
      );
      expect(gdpr2!.passed).toBe(true);
    });

    it("hasDataRetentionPolicy=false when retentionDays is null", async () => {
      const tenants = [makeTenant("tenant-a")];
      const svc = buildService(tenants, [], null);
      const report = await svc.evaluateTenant("tenant-a");
      const gdpr2 = report.byRegulation.GDPR.requirements.find(
        (r) => r.requirementId === "GDPR-2",
      );
      expect(gdpr2!.passed).toBe(false);
    });

    it("hasEscalationPolicy=true when escalate decision exists in session summaries", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 5, refuse: 0, escalate: 2, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      const hipaa2 = report.byRegulation.HIPAA.requirements.find(
        (r) => r.requirementId === "HIPAA-2",
      );
      expect(hipaa2!.passed).toBe(true);
    });

    it("hasEscalationPolicy=false when no escalate decisions exist", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 5, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      const hipaa2 = report.byRegulation.HIPAA.requirements.find(
        (r) => r.requirementId === "HIPAA-2",
      );
      expect(hipaa2!.passed).toBe(false);
    });

    it("hasConsentTracking=true when session.start events exist in timeline", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry()],
        }),
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      const gdpr1 = report.byRegulation.GDPR.requirements.find(
        (r) => r.requirementId === "GDPR-1",
      );
      expect(gdpr1!.passed).toBe(true);
    });

    it("hasConsentTracking=false when no session.start events exist", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makePolicyDecisionEntry("allow")],
        }),
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      const gdpr1 = report.byRegulation.GDPR.requirements.find(
        (r) => r.requirementId === "GDPR-1",
      );
      expect(gdpr1!.passed).toBe(false);
    });

    it("policyDecisionCoverage computed correctly", async () => {
      const tenants = [makeTenant("tenant-a")];
      // 2 sessions with policy.decision events, 1 without
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makePolicyDecisionEntry("allow")],
        }),
        makeRecording({
          sessionId: "s2",
          tenantId: "tenant-a",
          timeline: [makePolicyDecisionEntry("refuse")],
        }),
        makeRecording({
          sessionId: "s3",
          tenantId: "tenant-a",
          timeline: [],
        }),
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      // 2/3 sessions have policy.decision → 66.7% coverage → GDPR-3 should fail (< 80%)
      const gdpr3 = report.byRegulation.GDPR.requirements.find(
        (r) => r.requirementId === "GDPR-3",
      );
      expect(gdpr3!.passed).toBe(false);
    });

    it("policyDecisionCoverage=100% when all sessions have policy.decision events", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makePolicyDecisionEntry("allow")],
        }),
        makeRecording({
          sessionId: "s2",
          tenantId: "tenant-a",
          timeline: [makePolicyDecisionEntry("allow")],
        }),
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      const gdpr3 = report.byRegulation.GDPR.requirements.find(
        (r) => r.requirementId === "GDPR-3",
      );
      expect(gdpr3!.passed).toBe(true);
    });

    it("GDPR-1 passes when hasConsentTracking=true", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry()],
        }),
      ];
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      expect(report.byRegulation.GDPR.requirements.find(r => r.requirementId === "GDPR-1")!.passed).toBe(true);
    });

    it("GDPR-2 fails when no retention policy", async () => {
      const tenants = [makeTenant("tenant-a")];
      const svc = buildService(tenants, [], null);
      const report = await svc.evaluateTenant("tenant-a");
      expect(report.byRegulation.GDPR.requirements.find(r => r.requirementId === "GDPR-2")!.passed).toBe(false);
    });

    it("HIPAA-3 passes when sessionCount=0 (no sessions)", async () => {
      const tenants = [makeTenant("tenant-a")];
      const svc = buildService(tenants, []);
      const report = await svc.evaluateTenant("tenant-a");
      const hipaa3 = report.byRegulation.HIPAA.requirements.find(
        (r) => r.requirementId === "HIPAA-3",
      );
      expect(hipaa3!.passed).toBe(true);
    });

    it("SOC2-3 passes when escalationRatePct < 20", async () => {
      const tenants = [makeTenant("tenant-a")];
      // 1 out of 10 sessions escalates = 10% rate
      const recordings = Array.from({ length: 10 }, (_, i) =>
        makeRecording({
          sessionId: `s${i}`,
          tenantId: "tenant-a",
          summary: {
            turnCount: 2,
            policyDecisions: {
              allow: 5, refuse: 0,
              escalate: i === 0 ? 1 : 0,
              rewrite: 0, cancel_output: 0,
            },
            audioInputChunks: 5,
            audioOutputChunks: 5,
          },
        }),
      );
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      const soc23 = report.byRegulation.SOC2.requirements.find(
        (r) => r.requirementId === "SOC2-3",
      );
      expect(soc23!.passed).toBe(true);
    });

    it("SOC2-3 fails when escalationRatePct >= 20", async () => {
      const tenants = [makeTenant("tenant-a")];
      // 3 out of 5 sessions escalate = 60% rate
      const recordings = Array.from({ length: 5 }, (_, i) =>
        makeRecording({
          sessionId: `s${i}`,
          tenantId: "tenant-a",
          summary: {
            turnCount: 2,
            policyDecisions: {
              allow: 5, refuse: 0,
              escalate: i < 3 ? 1 : 0,
              rewrite: 0, cancel_output: 0,
            },
            audioInputChunks: 5,
            audioOutputChunks: 5,
          },
        }),
      );
      const svc = buildService(tenants, recordings);
      const report = await svc.evaluateTenant("tenant-a");
      const soc23 = report.byRegulation.SOC2.requirements.find(
        (r) => r.requirementId === "SOC2-3",
      );
      expect(soc23!.passed).toBe(false);
    });

    it("overallStatus=compliant when all requirements pass", async () => {
      const tenants = [makeTenant("tenant-a")];
      // For full compliance we need:
      //   - hasConsentTracking: session.start events (GDPR-1, CCPA-1)
      //   - hasAuditTrail: policy.decision in timeline (HIPAA-1, SOC2-1, PCI-1, GDPR-3)
      //   - hasDataRetentionPolicy: retentionDays non-null (GDPR-2, SOC2-2, PCI-2, CCPA-2)
      //   - hasEscalationPolicy: at least one escalate in summary (HIPAA-2)
      //   - avgQualityScore >= 60 (HIPAA-3) → attach quality field to summary
      //   - escalationRatePct < 20% (SOC2-3) → only 1 out of 10 sessions escalates
      const recordings = Array.from({ length: 10 }, (_, i) =>
        makeRecording({
          sessionId: `s${i}`,
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry(), makePolicyDecisionEntry("allow")],
          summary: {
            turnCount: 3,
            policyDecisions: {
              allow: 5, refuse: 0,
              escalate: i === 0 ? 1 : 0, // only first session escalates = 10% rate
              rewrite: 0, cancel_output: 0,
            },
            audioInputChunks: 10,
            audioOutputChunks: 10,
            // quality field accessed via dynamic cast in service
            ...({ quality: { totalScore: 80 } } as unknown as object),
          },
        }),
      );
      const svc = buildService(tenants, recordings, 30);
      const report = await svc.evaluateTenant("tenant-a");
      expect(report.overallStatus).toBe("compliant");
    });

    it("overallStatus=non_compliant when < 50% of requirements pass", async () => {
      const tenants = [makeTenant("tenant-a")];
      // null retention = fail GDPR-2, SOC2-2, PCI-2, CCPA-2 (4 fails)
      // no audit trail = fail GDPR-3, HIPAA-1, SOC2-1, PCI-1 (4 more fails)
      // no consent = fail GDPR-1, CCPA-1 (2 more)
      // escalation rate >= 20 with many sessions escalating = SOC2-3 fail
      // total ~11 fails out of 13 = <50% passing = non_compliant
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [], // no audit trail, no consent tracking
          summary: {
            turnCount: 2,
            policyDecisions: { allow: 1, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 5,
            audioOutputChunks: 5,
          },
        }),
        makeRecording({
          sessionId: "s2",
          tenantId: "tenant-a",
          timeline: [],
          summary: {
            turnCount: 2,
            policyDecisions: { allow: 1, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 5,
            audioOutputChunks: 5,
          },
        }),
      ];
      const svc = buildService(tenants, recordings, null);
      const report = await svc.evaluateTenant("tenant-a");
      expect(report.overallStatus).toBe("non_compliant");
    });

    it("overallStatus=partial when 50-99% of requirements pass", async () => {
      const tenants = [makeTenant("tenant-a")];
      // Only fail null retention (4 requirements fail: GDPR-2, SOC2-2, PCI-2, CCPA-2)
      // With consent tracking, audit trail, and escalation policy in place → 9/13 pass = ~69%
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry(), makePolicyDecisionEntry("allow")],
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 5, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(tenants, recordings, null); // only fail retention
      const report = await svc.evaluateTenant("tenant-a");
      expect(report.overallStatus).toBe("partial");
    });

    it("complianceScorePct computed correctly as passed/total*100", async () => {
      const tenants = [makeTenant("tenant-a")];
      // Use zero sessions: sessionCount=0 makes HIPAA-3 pass, and escalationRatePct=0 makes SOC2-3 pass.
      // With retentionDays=30 and no sessions, all 13 requirements pass:
      //   GDPR-1 (hasConsentTracking=false) → FAILS with no sessions
      // Actually with no sessions all tracking fields are false. Let's verify exactly:
      //   GDPR-1: hasConsentTracking=false → FAIL
      //   GDPR-2: hasDataRetentionPolicy=true → PASS
      //   GDPR-3: policyDecisionCoverage=0 (0% coverage, 0/0 sessions) → special case: 0 >= 80 is false
      //           BUT sessionCount=0 means 0/0 * 100 = 0 coverage → FAIL
      // So with zero sessions we don't get 100%.
      // Instead use 10 sessions with quality data and only 1 escalating (10% rate).
      const recordings = Array.from({ length: 10 }, (_, i) =>
        makeRecording({
          sessionId: `s${i}`,
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry(), makePolicyDecisionEntry("allow")],
          summary: {
            turnCount: 3,
            policyDecisions: {
              allow: 5, refuse: 0,
              escalate: i === 0 ? 1 : 0,
              rewrite: 0, cancel_output: 0,
            },
            audioInputChunks: 10,
            audioOutputChunks: 10,
            ...({ quality: { totalScore: 80 } } as unknown as object),
          },
        }),
      );
      const svc = buildService(tenants, recordings, 30);
      const report = await svc.evaluateTenant("tenant-a");
      // All 13 requirements should pass → 100%
      expect(report.complianceScorePct).toBe(100);
    });

    it("gaps contains only failed requirements", async () => {
      const tenants = [makeTenant("tenant-a")];
      const svc = buildService(tenants, [], null); // no retention = 4 gaps
      const report = await svc.evaluateTenant("tenant-a");
      expect(report.gaps.every((g) => g.passed === false)).toBe(true);
      expect(report.gaps.length).toBeGreaterThan(0);
    });

    it("certificateEligible=true when complianceScorePct >= 80", async () => {
      const tenants = [makeTenant("tenant-a")];
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry(), makePolicyDecisionEntry("allow")],
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 5, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(tenants, recordings, 30);
      const report = await svc.evaluateTenant("tenant-a");
      expect(report.complianceScorePct).toBeGreaterThanOrEqual(80);
      expect(report.certificateEligible).toBe(true);
    });

    it("certificateEligible=false when complianceScorePct < 80", async () => {
      const tenants = [makeTenant("tenant-a")];
      // null retention fails 4/13 requirements = 69.2% → not eligible
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry(), makePolicyDecisionEntry("allow")],
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 5, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(tenants, recordings, null);
      const report = await svc.evaluateTenant("tenant-a");
      expect(report.complianceScorePct).toBeLessThan(80);
      expect(report.certificateEligible).toBe(false);
    });

    it("byRegulation has all 5 regulations", async () => {
      const tenants = [makeTenant("tenant-a")];
      const svc = buildService(tenants, []);
      const report = await svc.evaluateTenant("tenant-a");
      expect(Object.keys(report.byRegulation)).toEqual(
        expect.arrayContaining(["GDPR", "HIPAA", "SOC2", "PCI_DSS", "CCPA"]),
      );
      expect(Object.keys(report.byRegulation)).toHaveLength(5);
    });

    it("byRegulation.GDPR.passed counted correctly", async () => {
      const tenants = [makeTenant("tenant-a")];
      // Enable consent + audit trail (GDPR-1 and GDPR-3 pass), but no retention (GDPR-2 fails)
      const recordings = [
        makeRecording({
          sessionId: "s1",
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry(), makePolicyDecisionEntry("allow")],
        }),
      ];
      const svc = buildService(tenants, recordings, null);
      const report = await svc.evaluateTenant("tenant-a");
      // GDPR-1: pass (hasConsentTracking), GDPR-2: fail (no retention), GDPR-3: pass (100% coverage)
      expect(report.byRegulation.GDPR.passed).toBe(2);
      expect(report.byRegulation.GDPR.total).toBe(3);
    });
  });

  // ── generateOverview ─────────────────────────────────────────────────────

  describe("generateOverview()", () => {
    it("includes all registered tenants", async () => {
      const tenants = [makeTenant("tenant-a"), makeTenant("tenant-b"), makeTenant("tenant-c")];
      const svc = buildService(tenants, []);
      const overview = await svc.generateOverview();
      expect(overview.totalTenants).toBe(3);
      expect(overview.tenantReports).toHaveLength(3);
    });

    it("compliantTenants counts only fully compliant tenants", async () => {
      const tenants = [makeTenant("tenant-a"), makeTenant("tenant-b")];
      // tenant-a: fully compliant — 10 sessions, 1 escalating (10% rate), quality 80, all events present
      const recordings = Array.from({ length: 10 }, (_, i) =>
        makeRecording({
          sessionId: `a${i}`,
          tenantId: "tenant-a",
          timeline: [makeSessionStartEntry(), makePolicyDecisionEntry("allow")],
          summary: {
            turnCount: 3,
            policyDecisions: {
              allow: 5, refuse: 0,
              escalate: i === 0 ? 1 : 0,
              rewrite: 0, cancel_output: 0,
            },
            audioInputChunks: 10,
            audioOutputChunks: 10,
            ...({ quality: { totalScore: 80 } } as unknown as object),
          },
        }),
      );
      // tenant-b: no sessions → hasEscalationPolicy=false, hasConsentTracking=false → non_compliant
      const svc = buildService(tenants, recordings, 30);
      const overview = await svc.generateOverview();
      // tenant-a should be compliant
      expect(overview.compliantTenants).toBeGreaterThanOrEqual(1);
      expect(overview.compliantTenants + overview.partialTenants + overview.nonCompliantTenants)
        .toBe(overview.totalTenants);
    });

    it("regulationSummary has all 5 regulations", async () => {
      const tenants = [makeTenant("tenant-a")];
      const svc = buildService(tenants, []);
      const overview = await svc.generateOverview();
      expect(Object.keys(overview.regulationSummary)).toEqual(
        expect.arrayContaining(["GDPR", "HIPAA", "SOC2", "PCI_DSS", "CCPA"]),
      );
      expect(Object.keys(overview.regulationSummary)).toHaveLength(5);
    });

    it("regulationSummary counts sum to totalTenants per regulation", async () => {
      const tenants = [makeTenant("t1"), makeTenant("t2"), makeTenant("t3")];
      const svc = buildService(tenants, []);
      const overview = await svc.generateOverview();
      for (const reg of ["GDPR", "HIPAA", "SOC2", "PCI_DSS", "CCPA"] as const) {
        const s = overview.regulationSummary[reg];
        expect(s.compliantTenants + s.partialTenants + s.nonCompliantTenants)
          .toBe(overview.totalTenants);
      }
    });

    it("tenantReports contains a report for each tenant", async () => {
      const tenants = [makeTenant("tenant-a"), makeTenant("tenant-b")];
      const svc = buildService(tenants, []);
      const overview = await svc.generateOverview();
      const ids = overview.tenantReports.map((r) => r.tenantId);
      expect(ids).toContain("tenant-a");
      expect(ids).toContain("tenant-b");
    });

    it("generatedAt is a valid ISO timestamp", async () => {
      const tenants = [makeTenant("tenant-a")];
      const svc = buildService(tenants, []);
      const overview = await svc.generateOverview();
      expect(new Date(overview.generatedAt).toISOString()).toBe(overview.generatedAt);
    });
  });

  // ── generateCertificateHtml ──────────────────────────────────────────────

  describe("generateCertificateHtml()", () => {
    function makeReport(overrides: Partial<TenantComplianceReport> = {}): TenantComplianceReport {
      const byRegulation = {} as TenantComplianceReport["byRegulation"];
      for (const reg of ["GDPR", "HIPAA", "SOC2", "PCI_DSS", "CCPA"] as const) {
        byRegulation[reg] = {
          status: "compliant",
          passed: 2,
          total: 2,
          requirements: [],
        };
      }
      return {
        tenantId: overrides.tenantId ?? "acme-corp",
        evaluatedAt: overrides.evaluatedAt ?? "2026-03-20T00:00:00.000Z",
        overallStatus: overrides.overallStatus ?? "compliant",
        complianceScorePct: overrides.complianceScorePct ?? 100,
        byRegulation: overrides.byRegulation ?? byRegulation,
        gaps: overrides.gaps ?? [],
        certificateEligible: overrides.certificateEligible ?? true,
      };
    }

    it("returns a non-empty string", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport());
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains the tenant ID", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport({ tenantId: "acme-corp" }));
      expect(html).toContain("acme-corp");
    });

    it("contains 'Compliance Certificate' heading", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport());
      expect(html).toContain("Compliance Certificate");
    });

    it("shows warning when not eligible", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(
        makeReport({ certificateEligible: false, complianceScorePct: 60 }),
      );
      expect(html).toMatch(/not met the 80%|not valid for regulatory|warning/i);
    });

    it("does not show warning when eligible", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport({ certificateEligible: true }));
      expect(html).not.toMatch(/not met the 80%/i);
    });

    it("contains @media print CSS block", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport());
      expect(html).toContain("@media print");
    });

    it("contains window.print() call", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport());
      expect(html).toContain("window.print()");
    });

    it("contains compliance score percentage", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport({ complianceScorePct: 92.3 }));
      expect(html).toContain("92.3");
    });

    it("contains WATERMARK text", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport());
      expect(html).toContain("CERTIFICATE");
    });

    it("contains disclaimer about not being legal advice", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport());
      expect(html).toMatch(/not legal advice|legal counsel/i);
    });

    it("is valid HTML with doctype and closing html tag", () => {
      const svc = buildService([makeTenant("acme-corp")], []);
      const html = svc.generateCertificateHtml(makeReport());
      expect(html).toMatch(/^<!DOCTYPE html>/i);
      expect(html).toContain("</html>");
    });
  });
});
