/**
 * SystemConfigStore — In-memory writable configuration store for runtime settings.
 *
 * Extends the static ServerConfig with mutable values that can be changed
 * via the Admin API without requiring a server restart.
 *
 * Usage:
 *   const current = systemConfigStore.get();
 *   systemConfigStore.update({ maintenanceMode: true });
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface MutableSystemConfig {
  moderationSensitivity: "low" | "medium" | "high";
  sipTrunk: string | null;
  ttsEngine: "openai" | "stub";
  maxConcurrentSessions: number;
  maintenanceMode: boolean;
}

// ── Defaults ──────────────────────────────────────────────────────────

function defaultConfig(): MutableSystemConfig {
  return {
    moderationSensitivity: "medium",
    sipTrunk: null,
    ttsEngine: "openai",
    maxConcurrentSessions: 100,
    maintenanceMode: false,
  };
}

// ── SystemConfigStore ─────────────────────────────────────────────────

export class SystemConfigStore {
  private current: MutableSystemConfig = defaultConfig();

  /** Return a snapshot of the current mutable configuration. */
  get(): MutableSystemConfig {
    return { ...this.current };
  }

  /** Apply a partial update and return the resulting configuration. */
  update(patch: Partial<MutableSystemConfig>): MutableSystemConfig {
    this.current = { ...this.current, ...patch };
    return { ...this.current };
  }

  /** Reset all mutable settings to their defaults. */
  reset(): void {
    this.current = defaultConfig();
  }
}

// ── Module-level singleton ────────────────────────────────────────────

export const systemConfigStore = new SystemConfigStore();
