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

/** Runtime-mutable system settings adjustable via the Admin API. */
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

/** In-memory writable store for runtime system configuration. */
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

/** Module-level singleton for runtime config access. */
export const systemConfigStore = new SystemConfigStore();
