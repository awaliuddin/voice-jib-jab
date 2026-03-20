/**
 * ComplianceDashboardService — per-regulation compliance evaluation across all tenants.
 *
 * Evaluates each tenant against a set of built-in regulatory requirements (GDPR,
 * HIPAA, SOC2, PCI_DSS, CCPA) by inspecting their session recordings. Produces
 * per-tenant compliance reports, a portfolio-level overview, and HTML certificate
 * exports for tenants that meet the eligibility threshold.
 */

import type { TenantRegistry } from "./TenantRegistry.js";
import type { SessionRecorder } from "./SessionRecorder.js";

// ── Regulation types ───────────────────────────────────────────────────────

export type RegulationId = "GDPR" | "HIPAA" | "SOC2" | "PCI_DSS" | "CCPA";

// ── Context built from session recordings ──────────────────────────────────

export interface TenantComplianceContext {
  tenantId: string;
  sessionCount: number;
  hasAuditTrail: boolean;          // sessions have policy.decision events recorded
  hasDataRetentionPolicy: boolean; // recordingRetentionDays is configured (not null)
  hasEscalationPolicy: boolean;    // at least one escalate decision exists in sessions
  hasConsentTracking: boolean;     // sessions have session.start events
  avgQualityScore: number;
  escalationRatePct: number;
  policyDecisionCoverage: number;  // % of sessions with at least one policy.decision event
}

// ── Requirement definition ─────────────────────────────────────────────────

export interface PolicyRequirement {
  requirementId: string;
  description: string;
  regulation: RegulationId;
  check(context: TenantComplianceContext): boolean;
}

// ── Report types ───────────────────────────────────────────────────────────

export interface RequirementStatus {
  requirementId: string;
  description: string;
  passed: boolean;
  regulation: RegulationId;
}

export interface TenantComplianceReport {
  tenantId: string;
  evaluatedAt: string;
  overallStatus: "compliant" | "partial" | "non_compliant";
  complianceScorePct: number;
  byRegulation: Record<RegulationId, {
    status: "compliant" | "partial" | "non_compliant";
    passed: number;
    total: number;
    requirements: RequirementStatus[];
  }>;
  gaps: RequirementStatus[];       // failed requirements across all regulations
  certificateEligible: boolean;    // true if complianceScorePct >= 80
}

export interface ComplianceOverview {
  generatedAt: string;
  totalTenants: number;
  compliantTenants: number;
  partialTenants: number;
  nonCompliantTenants: number;
  regulationSummary: Record<RegulationId, {
    compliantTenants: number;
    partialTenants: number;
    nonCompliantTenants: number;
  }>;
  tenantReports: TenantComplianceReport[];
}

// ── Built-in requirement definitions ──────────────────────────────────────

const REQUIREMENTS: PolicyRequirement[] = [
  // GDPR
  {
    requirementId: "GDPR-1",
    description: "Consent tracking: sessions must record session.start events",
    regulation: "GDPR",
    check: (ctx) => ctx.hasConsentTracking,
  },
  {
    requirementId: "GDPR-2",
    description: "Data retention policy configured",
    regulation: "GDPR",
    check: (ctx) => ctx.hasDataRetentionPolicy,
  },
  {
    requirementId: "GDPR-3",
    description: "Audit trail: policy decisions recorded for all sessions",
    regulation: "GDPR",
    check: (ctx) => ctx.policyDecisionCoverage >= 80,
  },

  // HIPAA
  {
    requirementId: "HIPAA-1",
    description: "Audit trail enabled",
    regulation: "HIPAA",
    check: (ctx) => ctx.hasAuditTrail,
  },
  {
    requirementId: "HIPAA-2",
    description: "Escalation policy in place",
    regulation: "HIPAA",
    check: (ctx) => ctx.hasEscalationPolicy,
  },
  {
    requirementId: "HIPAA-3",
    description: "Minimum quality score 60+ for healthcare context",
    regulation: "HIPAA",
    check: (ctx) => ctx.avgQualityScore >= 60 || ctx.sessionCount === 0,
  },

  // SOC2
  {
    requirementId: "SOC2-1",
    description: "Audit trail: all policy decisions logged",
    regulation: "SOC2",
    check: (ctx) => ctx.hasAuditTrail,
  },
  {
    requirementId: "SOC2-2",
    description: "Data retention policy configured",
    regulation: "SOC2",
    check: (ctx) => ctx.hasDataRetentionPolicy,
  },
  {
    requirementId: "SOC2-3",
    description: "Escalation rate below 20%",
    regulation: "SOC2",
    check: (ctx) => ctx.escalationRatePct < 20,
  },

  // PCI_DSS
  {
    requirementId: "PCI-1",
    description: "Audit trail: transaction-related policy decisions logged",
    regulation: "PCI_DSS",
    check: (ctx) => ctx.hasAuditTrail,
  },
  {
    requirementId: "PCI-2",
    description: "Data retention policy configured",
    regulation: "PCI_DSS",
    check: (ctx) => ctx.hasDataRetentionPolicy,
  },

  // CCPA
  {
    requirementId: "CCPA-1",
    description: "Consent tracking: session.start events recorded",
    regulation: "CCPA",
    check: (ctx) => ctx.hasConsentTracking,
  },
  {
    requirementId: "CCPA-2",
    description: "Data retention policy configured",
    regulation: "CCPA",
    check: (ctx) => ctx.hasDataRetentionPolicy,
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const ALL_REGULATIONS: RegulationId[] = ["GDPR", "HIPAA", "SOC2", "PCI_DSS", "CCPA"];

function computeRegulationStatus(
  passed: number,
  total: number,
): "compliant" | "partial" | "non_compliant" {
  if (passed === total) return "compliant";
  if (passed / total >= 0.5) return "partial";
  return "non_compliant";
}

function computeOverallStatus(
  passedCount: number,
  totalCount: number,
): "compliant" | "partial" | "non_compliant" {
  if (totalCount === 0) return "compliant";
  if (passedCount === totalCount) return "compliant";
  if (passedCount / totalCount < 0.5) return "non_compliant";
  return "partial";
}

// ── ComplianceDashboardService ─────────────────────────────────────────────

export class ComplianceDashboardService {
  constructor(
    private readonly tenantRegistry: TenantRegistry,
    private readonly recorder: SessionRecorder,
    private readonly recordingRetentionDays: number | null,
  ) {}

  /**
   * Evaluate a single tenant against all built-in regulatory requirements.
   *
   * Builds a TenantComplianceContext from the tenant's session recordings, then
   * runs every requirement check and groups results by regulation.
   *
   * @throws Error if tenantId is not registered
   */
  async evaluateTenant(tenantId: string): Promise<TenantComplianceReport> {
    const tenant = this.tenantRegistry.getTenant(tenantId);
    if (tenant === null) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    // Collect all session metadata for this tenant.
    const allMeta = this.recorder.listRecordings();
    const tenantMeta = allMeta.filter((m) => m.tenantId === tenantId);

    // Load full recordings to inspect timelines.
    const recordings = tenantMeta
      .map((m) => this.recorder.loadRecording(m.sessionId))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const sessionCount = recordings.length;

    // Determine audit trail: any session that has at least one policy.decision event.
    const hasAuditTrail = recordings.some((r) =>
      r.timeline.some((e) => e.type === "policy.decision"),
    );

    // Data retention policy: whether retentionDays was configured at construction.
    const hasDataRetentionPolicy = this.recordingRetentionDays !== null;

    // Escalation policy: any session with a policy.decision where decision="escalate".
    const hasEscalationPolicy = recordings.some((r) =>
      r.summary.policyDecisions["escalate"] != null &&
      r.summary.policyDecisions["escalate"] > 0,
    );

    // Consent tracking: any session with a session.start timeline event.
    const hasConsentTracking = recordings.some((r) =>
      r.timeline.some((e) => e.type === "session.start"),
    );

    // Average quality score: use summary data if available, else 0.
    const avgQualityScore =
      sessionCount === 0
        ? 0
        : recordings.reduce((sum, r) => {
            // Quality score lives on VoiceQualityScorer output, not directly on the
            // recording. The recording summary does not carry a quality field by default.
            // We read summary.quality?.totalScore for recordings that were annotated with
            // it, and fall back to 0 otherwise.
            const quality = (r.summary as Record<string, unknown>)["quality"] as
              | { totalScore?: number }
              | undefined;
            return sum + (quality?.totalScore ?? 0);
          }, 0) / sessionCount;

    // Escalation rate: % of sessions that have at least one escalate decision.
    const sessionsWithEscalation = recordings.filter(
      (r) => (r.summary.policyDecisions["escalate"] ?? 0) > 0,
    ).length;
    const escalationRatePct =
      sessionCount === 0 ? 0 : (sessionsWithEscalation / sessionCount) * 100;

    // Policy decision coverage: % of sessions with at least one policy.decision event.
    const sessionsWithPolicyDecision = recordings.filter((r) =>
      r.timeline.some((e) => e.type === "policy.decision"),
    ).length;
    const policyDecisionCoverage =
      sessionCount === 0 ? 0 : (sessionsWithPolicyDecision / sessionCount) * 100;

    const context: TenantComplianceContext = {
      tenantId,
      sessionCount,
      hasAuditTrail,
      hasDataRetentionPolicy,
      hasEscalationPolicy,
      hasConsentTracking,
      avgQualityScore,
      escalationRatePct,
      policyDecisionCoverage,
    };

    // Run all requirement checks.
    const allStatuses: RequirementStatus[] = REQUIREMENTS.map((req) => ({
      requirementId: req.requirementId,
      description: req.description,
      passed: req.check(context),
      regulation: req.regulation,
    }));

    // Group by regulation.
    const byRegulation = {} as TenantComplianceReport["byRegulation"];
    for (const reg of ALL_REGULATIONS) {
      const regStatuses = allStatuses.filter((s) => s.regulation === reg);
      const passed = regStatuses.filter((s) => s.passed).length;
      const total = regStatuses.length;
      byRegulation[reg] = {
        status: computeRegulationStatus(passed, total),
        passed,
        total,
        requirements: regStatuses,
      };
    }

    const totalPassed = allStatuses.filter((s) => s.passed).length;
    const totalRequirements = allStatuses.length;
    const complianceScorePct =
      totalRequirements === 0 ? 100 : (totalPassed / totalRequirements) * 100;

    const overallStatus = computeOverallStatus(totalPassed, totalRequirements);
    const gaps = allStatuses.filter((s) => !s.passed);
    const certificateEligible = complianceScorePct >= 80;

    return {
      tenantId,
      evaluatedAt: new Date().toISOString(),
      overallStatus,
      complianceScorePct,
      byRegulation,
      gaps,
      certificateEligible,
    };
  }

  /**
   * Generate an overview of compliance status across all registered tenants.
   */
  async generateOverview(): Promise<ComplianceOverview> {
    const tenants = this.tenantRegistry.listTenants();
    const tenantReports = await Promise.all(
      tenants.map((t) => this.evaluateTenant(t.tenantId)),
    );

    const compliantTenants = tenantReports.filter(
      (r) => r.overallStatus === "compliant",
    ).length;
    const partialTenants = tenantReports.filter(
      (r) => r.overallStatus === "partial",
    ).length;
    const nonCompliantTenants = tenantReports.filter(
      (r) => r.overallStatus === "non_compliant",
    ).length;

    const regulationSummary = {} as ComplianceOverview["regulationSummary"];
    for (const reg of ALL_REGULATIONS) {
      regulationSummary[reg] = {
        compliantTenants: tenantReports.filter(
          (r) => r.byRegulation[reg].status === "compliant",
        ).length,
        partialTenants: tenantReports.filter(
          (r) => r.byRegulation[reg].status === "partial",
        ).length,
        nonCompliantTenants: tenantReports.filter(
          (r) => r.byRegulation[reg].status === "non_compliant",
        ).length,
      };
    }

    return {
      generatedAt: new Date().toISOString(),
      totalTenants: tenants.length,
      compliantTenants,
      partialTenants,
      nonCompliantTenants,
      regulationSummary,
      tenantReports,
    };
  }

  /**
   * Generate a self-contained HTML compliance certificate for the given report.
   *
   * Only meaningful when report.certificateEligible === true. Shows a warning
   * banner when the tenant has not reached the 80% threshold.
   */
  generateCertificateHtml(report: TenantComplianceReport): string {
    const passingRegs = ALL_REGULATIONS.filter(
      (reg) => report.byRegulation[reg].status === "compliant",
    );

    const warningBanner = !report.certificateEligible
      ? `<div class="warning">
          This tenant has not met the 80% compliance score required for certificate
          eligibility. Current score: ${report.complianceScorePct.toFixed(1)}%.
          This certificate is not valid for regulatory purposes.
        </div>`
      : "";

    const passingRegsList =
      passingRegs.length > 0
        ? passingRegs
            .map((r) => `<li class="reg-item reg-passed">${r}</li>`)
            .join("\n")
        : "<li class=\"reg-item reg-none\">No regulations fully compliant</li>";

    const evaluatedDate = new Date(report.evaluatedAt).toLocaleDateString(
      "en-US",
      { year: "numeric", month: "long", day: "numeric" },
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Compliance Certificate — ${report.tenantId}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#111118;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--blue:#3b82f6;--blue-dim:#1d4ed8;
  --green:#22c55e;--red:#ef4444;--yellow:#eab308;
}
body{
  font-family:'Segoe UI',system-ui,sans-serif;
  background:var(--bg);color:var(--text);
  min-height:100vh;display:flex;flex-direction:column;
  align-items:center;justify-content:center;padding:2rem;
}
.cert-wrapper{
  position:relative;max-width:700px;width:100%;
  background:var(--surface);border:2px solid var(--blue);
  border-radius:12px;padding:3rem;overflow:hidden;
}
.watermark{
  position:absolute;inset:0;display:flex;align-items:center;
  justify-content:center;pointer-events:none;user-select:none;
  font-size:8rem;font-weight:900;color:var(--blue);opacity:0.04;
  transform:rotate(-30deg);letter-spacing:.1em;
}
.cert-header{text-align:center;margin-bottom:2rem}
.cert-title{
  font-size:2rem;font-weight:800;color:var(--blue);
  letter-spacing:.05em;text-transform:uppercase;margin-bottom:.5rem;
}
.cert-subtitle{color:var(--muted);font-size:.9rem}
.divider{border:none;border-top:1px solid var(--border);margin:1.5rem 0}
.field-label{
  font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);margin-bottom:.25rem;font-weight:600;
}
.field-value{font-size:1.1rem;color:var(--text);margin-bottom:1.25rem;font-weight:500}
.score-block{
  background:var(--bg);border:1px solid var(--border);border-radius:8px;
  padding:1rem 1.25rem;margin:1.25rem 0;display:flex;
  align-items:center;justify-content:space-between;
}
.score-num{font-size:2.5rem;font-weight:800;color:var(--blue)}
.score-label{font-size:.8rem;color:var(--muted);text-align:right}
.regs-list{list-style:none;display:flex;flex-wrap:wrap;gap:.5rem;margin:.75rem 0}
.reg-item{
  padding:.3rem .75rem;border-radius:9999px;font-size:.8rem;font-weight:600;
}
.reg-passed{background:#1e3a8a33;color:var(--blue);border:1px solid #1d4ed855}
.reg-none{color:var(--muted);font-style:italic}
.warning{
  background:#78350f22;border:1px solid var(--yellow);border-radius:8px;
  padding:1rem;color:var(--yellow);font-size:.85rem;margin-bottom:1.5rem;
  line-height:1.5;
}
.disclaimer{
  margin-top:2rem;padding:1rem;background:var(--bg);
  border:1px solid var(--border);border-radius:8px;
  font-size:.75rem;color:var(--muted);line-height:1.6;
}
.print-btn{
  display:block;margin:2rem auto 0;padding:.7rem 2rem;
  background:var(--blue);color:#000;border:none;border-radius:6px;
  font-size:.9rem;font-weight:700;cursor:pointer;letter-spacing:.02em;
}
.print-btn:hover{opacity:.85}
@media print{
  body{background:#fff;color:#000;padding:0}
  .cert-wrapper{border-color:#1d4ed8;max-width:100%;box-shadow:none}
  .watermark{color:#1d4ed8;opacity:0.05}
  .print-btn{display:none}
  .score-num{color:#1d4ed8}
  .cert-title{color:#1d4ed8}
  .reg-passed{background:#dbeafe;color:#1d4ed8}
  .warning{background:#fef3c7;color:#92400e;border-color:#d97706}
  .disclaimer{background:#f9fafb;color:#6b7280}
  .score-block{background:#f3f4f6;border-color:#d1d5db}
}
</style>
</head>
<body>
<div class="cert-wrapper">
  <div class="watermark">CERTIFICATE</div>

  ${warningBanner}

  <div class="cert-header">
    <div class="cert-title">Compliance Certificate</div>
    <div class="cert-subtitle">Voice Agent Regulatory Compliance Assessment</div>
  </div>

  <hr class="divider"/>

  <div class="field-label">Tenant ID</div>
  <div class="field-value">${report.tenantId}</div>

  <div class="field-label">Evaluation Date</div>
  <div class="field-value">${evaluatedDate}</div>

  <div class="score-block">
    <div>
      <div class="field-label" style="margin-bottom:.25rem">Overall Compliance Score</div>
      <div class="score-num">${report.complianceScorePct.toFixed(1)}%</div>
    </div>
    <div class="score-label">
      Overall Status<br/>
      <strong style="font-size:1rem;color:${
        report.overallStatus === "compliant"
          ? "var(--green)"
          : report.overallStatus === "partial"
            ? "var(--yellow)"
            : "var(--red)"
      }">${report.overallStatus.replace("_", " ").toUpperCase()}</strong>
    </div>
  </div>

  <div class="field-label">Regulations Fully Compliant</div>
  <ul class="regs-list">
    ${passingRegsList}
  </ul>

  <hr class="divider"/>

  <div class="disclaimer">
    <strong>Disclaimer:</strong> This certificate is generated automatically by the
    Voice Jib-Jab compliance assessment system and reflects the state of your
    deployment at the time of evaluation. This is not legal advice and does not
    constitute a guarantee of regulatory compliance. Consult qualified legal counsel
    to assess your obligations under applicable regulations.
  </div>

  <button class="print-btn" onclick="window.print()">Export / Print Certificate</button>
</div>
</body>
</html>`;
  }
}
