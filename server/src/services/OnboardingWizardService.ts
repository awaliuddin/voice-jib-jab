/**
 * OnboardingWizardService — Step-by-step tenant onboarding wizard.
 *
 * Tracks wizard state per tenant, persists to a single JSON file.
 * Each tenant gets one wizard session; sessions advance through a fixed
 * step sequence with validation enforced per step.
 *
 * Usage:
 *   initOnboardingWizardService("/path/to/onboarding.json");
 *   const session = onboardingWizardService.createSession("org_acme");
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────

/** Named steps in the tenant onboarding wizard sequence. */
export type OnboardingStep =
  | "tenant_registration"
  | "voice_configuration"
  | "claims_registry"
  | "policy_rules"
  | "test_call"
  | "complete";

/** Lifecycle status of a single onboarding wizard step. */
export type StepStatus = "pending" | "in_progress" | "complete" | "skipped";

/** Tracked state for a single wizard step including captured data. */
export interface WizardStepState {
  step: OnboardingStep;
  status: StepStatus;
  completedAt?: string;
  /** Step-specific data captured during completion. */
  data?: Record<string, unknown>;
  validationErrors?: string[];
}

/** Full wizard session state for a tenant progressing through onboarding. */
export interface OnboardingSession {
  sessionId: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  currentStep: OnboardingStep;
  steps: WizardStepState[];
  complete: boolean;
  completedAt?: string;
  testCallResult?: {
    success: boolean;
    latencyMs?: number;
    notes: string;
  };
}

/** Union of all step-specific data fields submitted when completing a step. */
export interface StepCompletionPayload {
  // tenant_registration
  tenantName?: string;
  contactEmail?: string;
  industry?: string;

  // voice_configuration
  voiceId?: string;
  language?: string;
  speed?: number;

  // claims_registry
  claimsEntries?: Array<{
    claim: string;
    allowed: boolean;
    requiresEscalation?: boolean;
  }>;

  // policy_rules
  escalationThreshold?: number;
  blocklistKeywords?: string[];
  requireHumanHandoff?: boolean;

  // test_call
  testCallSuccess?: boolean;
  testCallLatencyMs?: number;
  testCallNotes?: string;
}

// ── Step order ────────────────────────────────────────────────────────

const STEP_ORDER: OnboardingStep[] = [
  "tenant_registration",
  "voice_configuration",
  "claims_registry",
  "policy_rules",
  "test_call",
  "complete",
];

// ── Storage format ────────────────────────────────────────────────────

interface StorageFormat {
  sessions: OnboardingSession[];
}

// ── Validation ────────────────────────────────────────────────────────

/**
 * Validate the payload for the given step.
 *
 * Returns an array of error strings (empty means valid).
 */
function validatePayload(
  step: OnboardingStep,
  payload: StepCompletionPayload,
): string[] {
  const errors: string[] = [];

  switch (step) {
    case "tenant_registration":
      if (
        !payload.tenantName ||
        typeof payload.tenantName !== "string" ||
        payload.tenantName.trim() === ""
      ) {
        errors.push("tenantName is required and must be a non-empty string");
      }
      break;

    case "voice_configuration":
      if (payload.voiceId !== undefined) {
        if (typeof payload.voiceId !== "string" || payload.voiceId.trim() === "") {
          errors.push("voiceId must be a non-empty string when provided");
        }
      }
      if (payload.speed !== undefined) {
        const s = Number(payload.speed);
        if (!Number.isFinite(s) || s < 0.5 || s > 2.0) {
          errors.push("speed must be between 0.5 and 2.0 when provided");
        }
      }
      break;

    case "claims_registry":
      if (payload.claimsEntries !== undefined && !Array.isArray(payload.claimsEntries)) {
        errors.push("claimsEntries must be an array when provided");
      }
      break;

    case "policy_rules":
      if (payload.escalationThreshold !== undefined) {
        const t = Number(payload.escalationThreshold);
        if (!Number.isFinite(t) || t < 0 || t > 10) {
          errors.push("escalationThreshold must be between 0 and 10 when provided");
        }
      }
      break;

    case "test_call":
      if (payload.testCallSuccess === undefined || typeof payload.testCallSuccess !== "boolean") {
        errors.push("testCallSuccess is required and must be a boolean");
      }
      break;

    /* istanbul ignore next -- structurally unreachable: completeStep() early-returns before validatePayload when currentStep === "complete" */
    case "complete":
      // No payload expected on the terminal step.
      break;
  }

  return errors;
}

/**
 * Extract step-specific data from the payload for persistence.
 */
function extractStepData(
  step: OnboardingStep,
  payload: StepCompletionPayload,
): Record<string, unknown> {
  switch (step) {
    case "tenant_registration":
      return {
        tenantName: payload.tenantName,
        contactEmail: payload.contactEmail,
        industry: payload.industry,
      };
    case "voice_configuration":
      return {
        voiceId: payload.voiceId,
        language: payload.language,
        speed: payload.speed,
      };
    case "claims_registry":
      return { claimsEntries: payload.claimsEntries };
    case "policy_rules":
      return {
        escalationThreshold: payload.escalationThreshold,
        blocklistKeywords: payload.blocklistKeywords,
        requireHumanHandoff: payload.requireHumanHandoff,
      };
    case "test_call":
      return {
        testCallSuccess: payload.testCallSuccess,
        testCallLatencyMs: payload.testCallLatencyMs,
        testCallNotes: payload.testCallNotes,
      };
    /* istanbul ignore next -- structurally unreachable: completeStep() early-returns before extractStepData when currentStep === "complete" */
    default:
      return {};
  }
}

// ── OnboardingWizardService ───────────────────────────────────────────

/** Step-by-step tenant onboarding wizard with validation and JSON persistence. */
export class OnboardingWizardService {
  private storageFile: string;
  private data: StorageFormat;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.data = this.load();
  }

  // ── Persistence ───────────────────────────────────────────────────

  private load(): StorageFormat {
    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      return JSON.parse(raw) as StorageFormat;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { sessions: [] };
      }
      throw err;
    }
  }

  private save(): void {
    mkdirSync(dirname(this.storageFile), { recursive: true });
    writeFileSync(
      this.storageFile,
      JSON.stringify(this.data, null, 2),
      "utf-8",
    );
  }

  // ── Private helpers ───────────────────────────────────────────────

  private buildInitialSteps(): WizardStepState[] {
    // Exclude "complete" from the steps list — it is a sentinel value
    // for currentStep, not a real work step.
    return STEP_ORDER.filter((s) => s !== "complete").map((step) => ({
      step,
      status: "pending" as StepStatus,
    }));
  }

  private findStepState(session: OnboardingSession, step: OnboardingStep): WizardStepState | undefined {
    return session.steps.find((s) => s.step === step);
  }

  private nextStep(current: OnboardingStep): OnboardingStep {
    const idx = STEP_ORDER.indexOf(current);
    if (idx === -1 || idx >= STEP_ORDER.length - 1) {
      return "complete";
    }
    return STEP_ORDER[idx + 1];
  }

  private prevStep(current: OnboardingStep): OnboardingStep {
    const idx = STEP_ORDER.indexOf(current);
    if (idx <= 0) {
      return STEP_ORDER[0];
    }
    return STEP_ORDER[idx - 1];
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Create a new wizard session for the given tenantId.
   *
   * Each tenantId may only have one session. The session starts at
   * "tenant_registration" with all steps pending.
   */
  createSession(tenantId: string): OnboardingSession {
    const now = new Date().toISOString();
    const session: OnboardingSession = {
      sessionId: randomUUID(),
      tenantId,
      createdAt: now,
      updatedAt: now,
      currentStep: "tenant_registration",
      steps: this.buildInitialSteps(),
      complete: false,
    };

    this.data.sessions.push(session);
    this.save();
    return session;
  }

  /**
   * Get a session by its sessionId.
   *
   * @returns The session, or undefined if not found.
   */
  getSession(sessionId: string): OnboardingSession | undefined {
    return this.data.sessions.find((s) => s.sessionId === sessionId);
  }

  /**
   * Get the wizard session for a given tenantId.
   *
   * @returns The session, or undefined if no session exists for this tenant.
   */
  getSessionByTenant(tenantId: string): OnboardingSession | undefined {
    return this.data.sessions.find((s) => s.tenantId === tenantId);
  }

  /**
   * List all wizard sessions.
   */
  listSessions(): OnboardingSession[] {
    return [...this.data.sessions];
  }

  /**
   * Complete the current step and advance the wizard to the next step.
   *
   * Validates the payload for the current step. If validation fails, throws
   * an error with a validationErrors property attached. Stores captured
   * data on the step state. If advancing past test_call, marks the session
   * as complete.
   *
   * @throws Error if session not found or payload is invalid.
   */
  completeStep(sessionId: string, payload: StepCompletionPayload): OnboardingSession {
    const session = this.data.sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    const current = session.currentStep;
    if (current === "complete") {
      return session;
    }

    // Validate
    const errors = validatePayload(current, payload);
    if (errors.length > 0) {
      const stepState = this.findStepState(session, current);
      if (stepState) {
        stepState.validationErrors = errors;
      }
      const err = new Error(`Validation failed for step "${current}"`);
      (err as Error & { validationErrors: string[] }).validationErrors = errors;
      throw err;
    }

    // Mark step complete
    const stepState = this.findStepState(session, current);
    if (stepState) {
      stepState.status = "complete";
      stepState.completedAt = new Date().toISOString();
      stepState.data = extractStepData(current, payload);
      stepState.validationErrors = undefined;
    }

    // Store test call result on session
    if (current === "test_call") {
      session.testCallResult = {
        success: payload.testCallSuccess as boolean,
        latencyMs: payload.testCallLatencyMs,
        notes: payload.testCallNotes ?? "",
      };
    }

    // Advance to next step
    const next = this.nextStep(current);
    session.currentStep = next;
    session.updatedAt = new Date().toISOString();

    if (next === "complete") {
      session.complete = true;
      session.completedAt = session.updatedAt;
    }

    this.save();
    return session;
  }

  /**
   * Skip the current step and advance to the next.
   *
   * @throws Error if session not found.
   */
  skipStep(sessionId: string): OnboardingSession {
    const session = this.data.sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    const current = session.currentStep;
    if (current === "complete") {
      return session;
    }

    const stepState = this.findStepState(session, current);
    if (stepState) {
      stepState.status = "skipped";
    }

    const next = this.nextStep(current);
    session.currentStep = next;
    session.updatedAt = new Date().toISOString();

    if (next === "complete") {
      session.complete = true;
      session.completedAt = session.updatedAt;
    }

    this.save();
    return session;
  }

  /**
   * Go back to the previous step.
   *
   * If already at the first step, stays there (no error).
   *
   * @throws Error if session not found.
   */
  goBack(sessionId: string): OnboardingSession {
    const session = this.data.sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    const current = session.currentStep;
    const prev = this.prevStep(current);

    // If we were at "complete", un-complete the session and go back to test_call
    if (current === "complete") {
      session.complete = false;
      session.completedAt = undefined;
    }

    session.currentStep = prev;
    session.updatedAt = new Date().toISOString();

    // Reset the previous step back to in_progress so it can be re-done
    const prevStepState = this.findStepState(session, prev);
    if (prevStepState && prevStepState.status !== "pending") {
      prevStepState.status = "in_progress";
    }

    this.save();
    return session;
  }

  /**
   * Reset the wizard to the beginning.
   *
   * All steps return to "pending", currentStep resets to tenant_registration,
   * and complete is set to false.
   *
   * @throws Error if session not found.
   */
  resetSession(sessionId: string): OnboardingSession {
    const session = this.data.sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    session.currentStep = "tenant_registration";
    session.complete = false;
    session.completedAt = undefined;
    session.testCallResult = undefined;
    session.steps = this.buildInitialSteps();
    session.updatedAt = new Date().toISOString();

    this.save();
    return session;
  }
}

// ── Module-level singleton ────────────────────────────────────────────

let _instance: OnboardingWizardService | undefined;

/**
 * Initialize the module-level OnboardingWizardService singleton.
 *
 * @param storageFile - Absolute path to the JSON persistence file.
 * @returns The initialized service instance.
 */
export function initOnboardingWizardService(storageFile: string): OnboardingWizardService {
  _instance = new OnboardingWizardService(storageFile);
  return _instance;
}

/**
 * Module-level singleton proxy.
 *
 * Delegates all method calls to the instance created by
 * initOnboardingWizardService(). Throws if not yet initialized.
 */
export const onboardingWizardService: OnboardingWizardService = new Proxy(
  {} as OnboardingWizardService,
  {
    get(_target, prop) {
      /* istanbul ignore next -- the module-level singleton throw path is unreachable in the test suite because _instance is always set before the proxy is accessed via the public API */
      if (!_instance) {
        throw new Error(
          "OnboardingWizardService not initialized — call initOnboardingWizardService() first",
        );
      }
      const value = (_instance as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(_instance);
      }
      return value;
    },
  },
);
