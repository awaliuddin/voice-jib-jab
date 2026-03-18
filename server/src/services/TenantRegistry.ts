/**
 * TenantRegistry — In-memory tenant configuration store with JSON file persistence.
 *
 * Holds per-tenant configuration (policy level, claims, moderation thresholds)
 * and persists to a JSON file so tenant data survives server restarts.
 *
 * Usage:
 *   initTenantRegistry("/path/to/tenants.json");
 *   const tenant = tenantRegistry.createTenant({ tenantId: "org_acme", ... });
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

// ── Types ─────────────────────────────────────────────────────────────

export interface TenantConfig {
  tenantId: string;
  name: string;
  createdAt: string;
  policyLevel: "strict" | "standard" | "permissive";
  claimsThreshold: number;
  claims: Array<{ id: string; text: string }>;
  disallowedPatterns: string[];
  moderationThresholds?: {
    JAILBREAK?: number;
    HATE_SPEECH?: number;
    VIOLENCE_THREATS?: number;
  };
}

/** Default claimsThreshold values per policy level. */
const POLICY_LEVEL_DEFAULTS: Record<TenantConfig["policyLevel"], number> = {
  strict: 0.2,
  standard: 0.5,
  permissive: 0.85,
};

// ── TenantRegistry ────────────────────────────────────────────────────

export class TenantRegistry {
  private tenants = new Map<string, TenantConfig>();
  private persistPath: string;

  constructor(persistPath: string) {
    this.persistPath = persistPath;
  }

  /** Load from disk on startup. No-op if file doesn't exist. */
  load(): void {
    if (!existsSync(this.persistPath)) {
      return;
    }
    const raw = readFileSync(this.persistPath, "utf-8");
    const entries: TenantConfig[] = JSON.parse(raw);
    this.tenants.clear();
    for (const entry of entries) {
      this.tenants.set(entry.tenantId, entry);
    }
  }

  /** Save current state to disk. */
  save(): void {
    const entries = Array.from(this.tenants.values());
    writeFileSync(this.persistPath, JSON.stringify(entries, null, 2), "utf-8");
  }

  /** Create a new tenant. Throws if tenantId already exists. */
  createTenant(config: Omit<TenantConfig, "createdAt">): TenantConfig {
    if (this.tenants.has(config.tenantId)) {
      throw new Error(`Tenant "${config.tenantId}" already exists`);
    }

    const tenant: TenantConfig = {
      ...config,
      createdAt: new Date().toISOString(),
      claims: config.claims ?? [],
      disallowedPatterns: config.disallowedPatterns ?? [],
      claimsThreshold:
        config.claimsThreshold ?? POLICY_LEVEL_DEFAULTS[config.policyLevel],
    };

    this.tenants.set(tenant.tenantId, tenant);
    this.save();
    return tenant;
  }

  /** Get a tenant by ID. Returns null if not found. */
  getTenant(tenantId: string): TenantConfig | null {
    return this.tenants.get(tenantId) ?? null;
  }

  /** List all tenants. */
  listTenants(): TenantConfig[] {
    return Array.from(this.tenants.values());
  }

  /** Update a tenant (partial update). Throws if not found. */
  updateTenant(
    tenantId: string,
    update: Partial<Omit<TenantConfig, "tenantId" | "createdAt">>,
  ): TenantConfig {
    const existing = this.tenants.get(tenantId);
    if (!existing) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    const updated: TenantConfig = { ...existing, ...update };
    this.tenants.set(tenantId, updated);
    this.save();
    return updated;
  }

  /** Delete a tenant. Returns false if not found. */
  deleteTenant(tenantId: string): boolean {
    if (!this.tenants.has(tenantId)) {
      return false;
    }
    this.tenants.delete(tenantId);
    this.save();
    return true;
  }

  /** Number of tenants currently stored. */
  get size(): number {
    return this.tenants.size;
  }
}

// ── Module-level singleton ────────────────────────────────────────────

let _registry: TenantRegistry | null = null;

/** Module-level singleton. Access after calling initTenantRegistry(). */
export const tenantRegistry: TenantRegistry = new Proxy(
  {} as TenantRegistry,
  {
    get(_target, prop) {
      if (!_registry) {
        throw new Error(
          "TenantRegistry not initialized. Call initTenantRegistry() first.",
        );
      }
      const value = (_registry as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(_registry);
      }
      return value;
    },
  },
);

/** Initialize the module-level singleton with a persist path and load from disk. */
export function initTenantRegistry(path: string): void {
  _registry = new TenantRegistry(path);
  _registry.load();
}
