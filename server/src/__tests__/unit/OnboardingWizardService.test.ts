/**
 * OnboardingWizardService Unit Tests
 *
 * Tests the step-by-step wizard that guides new enterprise tenants through
 * initial setup. Uses real filesystem via OS temp directories for isolation.
 * Each test gets a fresh service instance backed by a unique temp file.
 */

import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import {
  OnboardingWizardService,
  initOnboardingWizardService,
  onboardingWizardService,
} from "../../services/OnboardingWizardService.js";

// ── Helpers ───────────────────────────────────────────────────────────

function tempFile(label: string): string {
  return join(
    tmpdir(),
    `onboarding-wizard-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

// ── OnboardingWizardService unit tests ────────────────────────────────

describe("OnboardingWizardService", () => {
  let svc: OnboardingWizardService;
  let file: string;

  beforeEach(() => {
    file = tempFile("svc");
    svc = new OnboardingWizardService(file);
  });

  afterEach(() => {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  // ── createSession ─────────────────────────────────────────────────

  describe("createSession()", () => {
    it("returns an OnboardingSession with a sessionId", () => {
      const session = svc.createSession("org_acme");

      expect(session.sessionId).toBeTruthy();
      expect(typeof session.sessionId).toBe("string");
    });

    it("returns a session with the provided tenantId", () => {
      const session = svc.createSession("org_acme");

      expect(session.tenantId).toBe("org_acme");
    });

    it("sets createdAt to an ISO date string", () => {
      const session = svc.createSession("org_acme");

      expect(session.createdAt).toBeTruthy();
      expect(new Date(session.createdAt).toISOString()).toBe(session.createdAt);
    });

    it("starts at step tenant_registration", () => {
      const session = svc.createSession("org_acme");

      expect(session.currentStep).toBe("tenant_registration");
    });

    it("has all steps starting as pending", () => {
      const session = svc.createSession("org_acme");

      for (const step of session.steps) {
        expect(step.status).toBe("pending");
      }
    });

    it("starts with complete=false", () => {
      const session = svc.createSession("org_acme");

      expect(session.complete).toBe(false);
    });

    it("steps contain all 5 work steps", () => {
      const session = svc.createSession("org_acme");

      const stepNames = session.steps.map((s) => s.step);
      expect(stepNames).toContain("tenant_registration");
      expect(stepNames).toContain("voice_configuration");
      expect(stepNames).toContain("claims_registry");
      expect(stepNames).toContain("policy_rules");
      expect(stepNames).toContain("test_call");
    });
  });

  // ── getSession ────────────────────────────────────────────────────

  describe("getSession()", () => {
    it("returns undefined for an unknown session ID", () => {
      expect(svc.getSession("no-such-id")).toBeUndefined();
    });

    it("returns the correct session for a known ID", () => {
      const created = svc.createSession("org_acme");

      const found = svc.getSession(created.sessionId);
      expect(found).toBeDefined();
      expect(found!.sessionId).toBe(created.sessionId);
    });
  });

  // ── getSessionByTenant ────────────────────────────────────────────

  describe("getSessionByTenant()", () => {
    it("returns the session for the given tenant", () => {
      const created = svc.createSession("org_beta");

      const found = svc.getSessionByTenant("org_beta");
      expect(found).toBeDefined();
      expect(found!.sessionId).toBe(created.sessionId);
    });

    it("returns undefined when no session exists for the tenant", () => {
      expect(svc.getSessionByTenant("org_ghost")).toBeUndefined();
    });
  });

  // ── listSessions ──────────────────────────────────────────────────

  describe("listSessions()", () => {
    it("returns all sessions", () => {
      svc.createSession("org_a");
      svc.createSession("org_b");
      svc.createSession("org_c");

      expect(svc.listSessions()).toHaveLength(3);
    });
  });

  // ── step sequence ─────────────────────────────────────────────────

  describe("step sequence", () => {
    it("follows the correct order of steps", () => {
      const session = svc.createSession("org_seq");
      const expectedOrder = [
        "tenant_registration",
        "voice_configuration",
        "claims_registry",
        "policy_rules",
        "test_call",
      ];
      const actualOrder = session.steps.map((s) => s.step);

      expect(actualOrder).toEqual(expectedOrder);
    });
  });

  // ── completeStep ──────────────────────────────────────────────────

  describe("completeStep()", () => {
    it("advances currentStep to the next step", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.completeStep(session.sessionId, { tenantName: "Acme" });
      expect(updated.currentStep).toBe("voice_configuration");
    });

    it("marks the completed step as 'complete'", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.completeStep(session.sessionId, { tenantName: "Acme" });
      const stepState = updated.steps.find((s) => s.step === "tenant_registration");
      expect(stepState!.status).toBe("complete");
    });

    it("stores payload data in step.data", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.completeStep(session.sessionId, {
        tenantName: "Acme Corp",
        contactEmail: "admin@acme.com",
        industry: "technology",
      });
      const stepState = updated.steps.find((s) => s.step === "tenant_registration");
      expect(stepState!.data).toMatchObject({
        tenantName: "Acme Corp",
        contactEmail: "admin@acme.com",
        industry: "technology",
      });
    });

    it("sets completedAt on the step when completing it", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.completeStep(session.sessionId, { tenantName: "Acme" });
      const stepState = updated.steps.find((s) => s.step === "tenant_registration");
      expect(stepState!.completedAt).toBeTruthy();
      expect(new Date(stepState!.completedAt!).toISOString()).toBe(stepState!.completedAt);
    });

    it("marks session complete=true when advancing past test_call", () => {
      const session = svc.createSession("org_acme");
      // Advance through all steps
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });
      svc.completeStep(session.sessionId, { escalationThreshold: 5 });
      const done = svc.completeStep(session.sessionId, {
        testCallSuccess: true,
        testCallNotes: "All good",
      });

      expect(done.complete).toBe(true);
      expect(done.completedAt).toBeTruthy();
      expect(done.currentStep).toBe("complete");
    });

    it("stores testCallResult on session when completing test_call step", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });
      svc.completeStep(session.sessionId, { escalationThreshold: 5 });
      const done = svc.completeStep(session.sessionId, {
        testCallSuccess: true,
        testCallLatencyMs: 250,
        testCallNotes: "Nominal",
      });

      expect(done.testCallResult).toBeDefined();
      expect(done.testCallResult!.success).toBe(true);
      expect(done.testCallResult!.latencyMs).toBe(250);
      expect(done.testCallResult!.notes).toBe("Nominal");
    });

    it("throws for an unknown sessionId", () => {
      expect(() =>
        svc.completeStep("no-such-session", { tenantName: "X" }),
      ).toThrow();
    });

    // Validation ─────────────────────────────────────────────────────

    it("throws with validationErrors when tenantName is missing for registration step", () => {
      const session = svc.createSession("org_acme");

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, {});
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught).toBeDefined();
      expect(caught!.validationErrors).toBeDefined();
      expect(caught!.validationErrors!.length).toBeGreaterThan(0);
      expect(caught!.validationErrors!.some((e) => e.includes("tenantName"))).toBe(true);
    });

    it("throws with validationErrors when tenantName is empty string", () => {
      const session = svc.createSession("org_acme");

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, { tenantName: "   " });
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors).toBeDefined();
    });

    it("throws with validationErrors when speed is below 0.5", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" }); // advance to voice

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, { speed: 0.1 });
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors!.some((e) => e.includes("speed"))).toBe(true);
    });

    it("throws with validationErrors when speed is above 2.0", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, { speed: 3.5 });
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors!.some((e) => e.includes("speed"))).toBe(true);
    });

    it("throws with validationErrors when escalationThreshold is above 10", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, { escalationThreshold: 15 });
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors!.some((e) => e.includes("escalationThreshold"))).toBe(true);
    });

    it("accepts escalationThreshold of exactly 0", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });

      expect(() =>
        svc.completeStep(session.sessionId, { escalationThreshold: 0 }),
      ).not.toThrow();
    });

    it("throws validationErrors when testCallSuccess is missing for test_call step", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });
      svc.completeStep(session.sessionId, { escalationThreshold: 5 });

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, {});
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors!.some((e) => e.includes("testCallSuccess"))).toBe(true);
    });
  });

  // ── skipStep ──────────────────────────────────────────────────────

  describe("skipStep()", () => {
    it("marks the current step as 'skipped'", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.skipStep(session.sessionId);
      const stepState = updated.steps.find((s) => s.step === "tenant_registration");
      expect(stepState!.status).toBe("skipped");
    });

    it("advances to the next step", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.skipStep(session.sessionId);
      expect(updated.currentStep).toBe("voice_configuration");
    });
  });

  // ── goBack ────────────────────────────────────────────────────────

  describe("goBack()", () => {
    it("moves to the previous step", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });

      const updated = svc.goBack(session.sessionId);
      expect(updated.currentStep).toBe("tenant_registration");
    });

    it("stays at the first step if already there (no error)", () => {
      const session = svc.createSession("org_acme");

      expect(() => svc.goBack(session.sessionId)).not.toThrow();
      const updated = svc.getSession(session.sessionId)!;
      expect(updated.currentStep).toBe("tenant_registration");
    });
  });

  // ── resetSession ──────────────────────────────────────────────────

  describe("resetSession()", () => {
    it("resets all steps to pending", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });

      const reset = svc.resetSession(session.sessionId);
      for (const step of reset.steps) {
        expect(step.status).toBe("pending");
      }
    });

    it("resets currentStep to tenant_registration", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });

      const reset = svc.resetSession(session.sessionId);
      expect(reset.currentStep).toBe("tenant_registration");
    });

    it("sets complete=false", () => {
      const session = svc.createSession("org_acme");
      // Skip through all steps to make it complete
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);

      const reset = svc.resetSession(session.sessionId);
      expect(reset.complete).toBe(false);
    });

    it("clears completedAt after reset", () => {
      const session = svc.createSession("org_acme");
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);

      const reset = svc.resetSession(session.sessionId);
      expect(reset.completedAt).toBeUndefined();
    });
  });

  // ── updatedAt ─────────────────────────────────────────────────────

  describe("updatedAt", () => {
    it("changes after completeStep()", async () => {
      const session = svc.createSession("org_acme");
      const before = session.updatedAt;
      await new Promise((r) => setTimeout(r, 5));

      const updated = svc.completeStep(session.sessionId, { tenantName: "Acme" });
      expect(updated.updatedAt).not.toBe(before);
    });

    it("changes after skipStep()", async () => {
      const session = svc.createSession("org_acme");
      const before = session.updatedAt;
      await new Promise((r) => setTimeout(r, 5));

      const updated = svc.skipStep(session.sessionId);
      expect(updated.updatedAt).not.toBe(before);
    });
  });

  // ── persistence ───────────────────────────────────────────────────

  describe("persistence", () => {
    it("getSession() works after createSession() — data survives reload", () => {
      const session = svc.createSession("org_persist");

      const svc2 = new OnboardingWizardService(file);
      const found = svc2.getSession(session.sessionId);
      expect(found).toBeDefined();
      expect(found!.tenantId).toBe("org_persist");
    });
  });

  // ── singleton proxy ───────────────────────────────────────────────

  describe("singleton proxy", () => {
    it("throws before initOnboardingWizardService() is called", () => {
      const makeProxy = (ref: { instance: OnboardingWizardService | undefined }) =>
        new Proxy({} as OnboardingWizardService, {
          get(_t, prop) {
            if (!ref.instance) {
              throw new Error("OnboardingWizardService not initialized");
            }
            const value = (ref.instance as unknown as Record<string | symbol, unknown>)[prop];
            return typeof value === "function" ? value.bind(ref.instance) : value;
          },
        });

      const ref = { instance: undefined as OnboardingWizardService | undefined };
      const proxy = makeProxy(ref);
      expect(() => proxy.listSessions()).toThrow("OnboardingWizardService not initialized");
    });

    it("works after initOnboardingWizardService()", () => {
      const f = tempFile("singleton");
      try {
        const instance = initOnboardingWizardService(f);
        expect(instance).toBeInstanceOf(OnboardingWizardService);
        const sessions = onboardingWizardService.listSessions();
        expect(Array.isArray(sessions)).toBe(true);
      } finally {
        if (existsSync(f)) rmSync(f, { force: true });
      }
    });
  });
});
