/**
 * TenantClaimsLoader — Per-tenant AllowedClaimsRegistry factory and cache.
 *
 * Ensures each tenant gets an isolated AllowedClaimsRegistry instance so that
 * Tenant A's approved claim set never leaks into Tenant B's policy evaluation.
 *
 * Usage:
 *   const registry = tenantClaimsLoader.getRegistryForTenant("org_acme", claimsConfig);
 *   // Returns the same instance on subsequent calls for the same tenantId.
 *
 * The module-level singleton (`tenantClaimsLoader`) is used by ControlEngine
 * when `tenantId` is set in ControlEngineConfig without an explicit claimsRegistry.
 */

import {
  AllowedClaimsRegistry,
  type AllowedClaimsRegistryConfig,
} from "../insurance/allowed_claims_registry.js";

// ── TenantClaimsLoader ─────────────────────────────────────────────────

/** Per-tenant AllowedClaimsRegistry factory and cache for isolated policy evaluation. */
export class TenantClaimsLoader {
  private readonly registries = new Map<string, AllowedClaimsRegistry>();

  /**
   * Get (or create) an isolated AllowedClaimsRegistry for the given tenantId.
   *
   * - If a registry already exists for this tenantId it is returned as-is.
   * - If not, a new registry is created with `config` (or a safe default) and cached.
   *
   * The `config` argument is only used on first creation; subsequent calls with
   * the same tenantId return the cached instance regardless of `config`.
   */
  getRegistryForTenant(
    tenantId: string,
    config?: Partial<AllowedClaimsRegistryConfig>,
  ): AllowedClaimsRegistry {
    if (!this.registries.has(tenantId)) {
      // Default: no file loading — caller must provide claims via config.claims.
      this.registries.set(
        tenantId,
        new AllowedClaimsRegistry(config ?? { enableFileLoad: false }),
      );
    }
    return this.registries.get(tenantId)!;
  }

  /**
   * Inject a pre-constructed registry for a tenant.
   * Useful for testing or for callers that need full control over the instance.
   * Overwrites any previously cached registry for this tenantId.
   */
  setRegistryForTenant(tenantId: string, registry: AllowedClaimsRegistry): void {
    this.registries.set(tenantId, registry);
  }

  /** Returns true if a registry has been created for the given tenantId. */
  hasRegistry(tenantId: string): boolean {
    return this.registries.has(tenantId);
  }

  /** Number of tenant registries currently cached. */
  get size(): number {
    return this.registries.size;
  }

  /**
   * Remove the cached registry for a specific tenant, or clear all if no argument.
   * Primarily for testing. Does not affect in-flight evaluations.
   */
  clear(tenantId?: string): void {
    if (tenantId !== undefined) {
      this.registries.delete(tenantId);
    } else {
      this.registries.clear();
    }
  }
}

/** Module-level singleton. ControlEngine uses this when tenantId is set. */
export const tenantClaimsLoader = new TenantClaimsLoader();
