/**
 * complianceDashboard-api Unit Tests
 *
 * Tests for:
 *   GET /compliance-dashboard/overview
 *   GET /compliance-dashboard/tenants/:tenantId
 *   GET /compliance-dashboard/tenants/:tenantId/certificate
 *   GET /compliance-dashboard/dashboard
 *
 * Mock strategy: jest.fn() mock for ComplianceDashboardService. Uses raw
 * http.request helper on a standalone Express server.
 */

import express from "express";
import { createServer, type Server } from "http";
import { createComplianceDashboardRouter } from "../../api/complianceDashboard.js";
import type {
  ComplianceDashboardService,
  TenantComplianceReport,
  ComplianceOverview,
} from "../../services/ComplianceDashboardService.js";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function httpGet(server: Server, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }
    import("http").then(({ default: http }) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: (addr as { port: number }).port,
          path,
          method: "GET",
        },
        (res) => {
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
        },
      );
      req.on("error", reject);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeByRegulation(): TenantComplianceReport["byRegulation"] {
  const byReg = {} as TenantComplianceReport["byRegulation"];
  for (const reg of ["GDPR", "HIPAA", "SOC2", "PCI_DSS", "CCPA"] as const) {
    byReg[reg] = { status: "compliant", passed: 2, total: 2, requirements: [] };
  }
  return byReg;
}

function makeTenantReport(overrides: Partial<TenantComplianceReport> = {}): TenantComplianceReport {
  return {
    tenantId: "acme-corp",
    evaluatedAt: "2026-03-20T00:00:00.000Z",
    overallStatus: "compliant",
    complianceScorePct: 100,
    byRegulation: makeByRegulation(),
    gaps: [],
    certificateEligible: true,
    ...overrides,
  };
}

function makeOverview(reports: TenantComplianceReport[] = []): ComplianceOverview {
  const regSummary = {} as ComplianceOverview["regulationSummary"];
  for (const reg of ["GDPR", "HIPAA", "SOC2", "PCI_DSS", "CCPA"] as const) {
    regSummary[reg] = { compliantTenants: 1, partialTenants: 0, nonCompliantTenants: 0 };
  }
  return {
    generatedAt: "2026-03-20T00:00:00.000Z",
    totalTenants: reports.length,
    compliantTenants: reports.filter((r) => r.overallStatus === "compliant").length,
    partialTenants: reports.filter((r) => r.overallStatus === "partial").length,
    nonCompliantTenants: reports.filter((r) => r.overallStatus === "non_compliant").length,
    regulationSummary: regSummary,
    tenantReports: reports,
  };
}

// ---------------------------------------------------------------------------
// Mock service factory
// ---------------------------------------------------------------------------

function makeMockService(opts: {
  overview?: ComplianceOverview;
  tenantReport?: TenantComplianceReport | null; // null = not found
  certificateHtml?: string;
}): ComplianceDashboardService {
  return {
    generateOverview: jest.fn(async () => opts.overview ?? makeOverview()),
    evaluateTenant: jest.fn(async (tenantId: string) => {
      if (opts.tenantReport === null) {
        throw new Error(`Tenant "${tenantId}" not found`);
      }
      return opts.tenantReport ?? makeTenantReport({ tenantId });
    }),
    generateCertificateHtml: jest.fn(
      (_report: TenantComplianceReport) =>
        opts.certificateHtml ?? "<html><body>Certificate</body></html>",
    ),
  } as unknown as ComplianceDashboardService;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let server: Server;
let mockService: ComplianceDashboardService;

function startServer(svc: ComplianceDashboardService): Promise<Server> {
  const app = express();
  app.use("/compliance-dashboard", createComplianceDashboardRouter(svc));
  return new Promise((resolve) => {
    const s = createServer(app);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /compliance-dashboard/overview", () => {
  it("returns 200 with ComplianceOverview", async () => {
    const report = makeTenantReport({ tenantId: "acme" });
    const overview = makeOverview([report]);
    mockService = makeMockService({ overview });
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/overview");
    expect(res.status).toBe(200);
    const body = res.json() as ComplianceOverview;
    expect(body.totalTenants).toBe(1);
    expect(body.compliantTenants).toBe(1);
  });

  it("overview has totalTenants, compliantTenants, and tenantReports fields", async () => {
    const overview = makeOverview([makeTenantReport()]);
    mockService = makeMockService({ overview });
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/overview");
    const body = res.json() as ComplianceOverview;
    expect(body).toHaveProperty("totalTenants");
    expect(body).toHaveProperty("compliantTenants");
    expect(body).toHaveProperty("tenantReports");
    expect(Array.isArray(body.tenantReports)).toBe(true);
  });
});

describe("GET /compliance-dashboard/tenants/:tenantId", () => {
  it("returns 200 with TenantComplianceReport for a known tenant", async () => {
    const report = makeTenantReport({ tenantId: "acme-corp" });
    mockService = makeMockService({ tenantReport: report });
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/tenants/acme-corp");
    expect(res.status).toBe(200);
    const body = res.json() as TenantComplianceReport;
    expect(body.tenantId).toBe("acme-corp");
  });

  it("returns 404 for an unknown tenant", async () => {
    mockService = makeMockService({ tenantReport: null });
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/tenants/ghost-tenant");
    expect(res.status).toBe(404);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it("tenant report has byRegulation, gaps, and certificateEligible fields", async () => {
    const report = makeTenantReport();
    mockService = makeMockService({ tenantReport: report });
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/tenants/acme-corp");
    const body = res.json() as TenantComplianceReport;
    expect(body).toHaveProperty("byRegulation");
    expect(body).toHaveProperty("gaps");
    expect(body).toHaveProperty("certificateEligible");
  });
});

describe("GET /compliance-dashboard/tenants/:tenantId/certificate", () => {
  it("returns 200 HTML when tenant is certificate eligible", async () => {
    const report = makeTenantReport({ certificateEligible: true });
    const certHtml = "<!DOCTYPE html><html><body>Certificate for acme-corp</body></html>";
    mockService = makeMockService({ tenantReport: report, certificateHtml: certHtml });
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/tenants/acme-corp/certificate");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("Certificate");
  });

  it("returns 403 when tenant is not certificate eligible", async () => {
    const report = makeTenantReport({ certificateEligible: false, complianceScorePct: 60 });
    mockService = makeMockService({ tenantReport: report });
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/tenants/acme-corp/certificate");
    expect(res.status).toBe(403);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/80%|not certificate eligible/i);
  });

  it("returns 404 for unknown tenant on certificate endpoint", async () => {
    mockService = makeMockService({ tenantReport: null });
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/tenants/ghost/certificate");
    expect(res.status).toBe(404);
  });

  it("returns application/pdf Content-Type when ?format=pdf", async () => {
    const report = makeTenantReport({ certificateEligible: true });
    mockService = makeMockService({ tenantReport: report });
    server = await startServer(mockService);

    const res = await httpGet(
      server,
      "/compliance-dashboard/tenants/acme-corp/certificate?format=pdf",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });

  it("PDF certificate response includes Content-Disposition header", async () => {
    const report = makeTenantReport({ certificateEligible: true });
    mockService = makeMockService({ tenantReport: report });
    server = await startServer(mockService);

    const res = await httpGet(
      server,
      "/compliance-dashboard/tenants/acme-corp/certificate?format=pdf",
    );
    expect(res.headers["content-disposition"]).toMatch(/filename=/);
  });
});

describe("GET /compliance-dashboard/dashboard", () => {
  it("returns 200 HTML", async () => {
    mockService = makeMockService({});
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/dashboard");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });

  it("dashboard HTML contains compliance-related content", async () => {
    mockService = makeMockService({});
    server = await startServer(mockService);

    const res = await httpGet(server, "/compliance-dashboard/dashboard");
    expect(res.body).toMatch(/compliance/i);
  });
});
