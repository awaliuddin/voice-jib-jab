/**
 * AgentVersionStore — Agent configuration version management.
 *
 * Versions agent configurations, supports deploying specific versions to
 * tenants, rollback to prior versions, and canary deployments (routing a
 * percentage of sessions to a new version based on session ID hash).
 *
 * Persistence: single JSON file at the path given to initAgentVersionStore().
 * Singleton: initAgentVersionStore() + agentVersionStore proxy.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { v4 as uuidv4 } from "uuid";

// ── Types ──────────────────────────────────────────────────────────────

/** Extensible agent configuration snapshot. */
export interface AgentConfig {
  systemPrompt?: string;
  voiceId?: string;
  personaId?: string;
  temperature?: number;       // 0-2
  maxTokens?: number;
  enableLaneA?: boolean;
  enableRAG?: boolean;
  tags?: string[];
  [key: string]: unknown;     // extensible
}

/** An immutable snapshot of an agent configuration at a point in time. */
export interface AgentVersion {
  versionId: string;          // uuid
  agentId: string;            // logical agent identifier
  versionNumber: number;      // monotonically increasing per agentId
  label: string;              // e.g. "v1.2.0" or "hotfix-march"
  config: AgentConfig;
  createdAt: string;
  createdBy?: string;
  changelog?: string;         // what changed from previous version
  isStable: boolean;          // manually marked as stable
}

/** Describes which version a tenant is running for a given agent. */
export interface TenantDeployment {
  deploymentId: string;       // uuid
  tenantId: string;
  agentId: string;
  activeVersionId: string;    // the primary deployed version
  canaryVersionId?: string;   // if set, canary is active
  canaryPercent: number;      // 0-100, % of traffic to canary (0 = no canary)
  deployedAt: string;
  deployedBy?: string;
}

/** Result of resolving which version a session should use. */
export interface VersionRoutingResult {
  versionId: string;
  isCanary: boolean;
  config: AgentConfig;
}

interface StorageFormat {
  versions: AgentVersion[];
  deployments: TenantDeployment[];
}

// ── AgentVersionStore ──────────────────────────────────────────────────

/** Versioned agent configuration store with deployment, canary, and rollback support. */
export class AgentVersionStore {
  private storageFile: string;
  private data: StorageFormat;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.data = this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────

  private load(): StorageFormat {
    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      return JSON.parse(raw) as StorageFormat;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { versions: [], deployments: [] };
      }
      throw err;
    }
  }

  private save(): void {
    mkdirSync(dirname(this.storageFile), { recursive: true });
    writeFileSync(this.storageFile, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // ── Version management ───────────────────────────────────────────

  /**
   * Create a new version for an agent.
   *
   * versionNumber is assigned as max existing versionNumber for agentId + 1
   * (starting at 1 for the first version).
   *
   * @param agentId - Logical agent identifier
   * @param label - Human-readable label, must be non-empty
   * @param config - Agent configuration snapshot
   * @param opts - Optional creator and changelog
   * @returns The created AgentVersion
   * @throws If label is empty
   */
  createVersion(
    agentId: string,
    label: string,
    config: AgentConfig,
    opts?: { createdBy?: string; changelog?: string },
  ): AgentVersion {
    if (!label || label.trim() === "") {
      throw new Error("label must be a non-empty string");
    }

    const existing = this.data.versions.filter((v) => v.agentId === agentId);
    const maxNumber = existing.reduce((max, v) => Math.max(max, v.versionNumber), 0);

    const version: AgentVersion = {
      versionId: uuidv4(),
      agentId,
      versionNumber: maxNumber + 1,
      label: label.trim(),
      config,
      createdAt: new Date().toISOString(),
      createdBy: opts?.createdBy,
      changelog: opts?.changelog,
      isStable: false,
    };

    this.data.versions.push(version);
    this.save();
    return version;
  }

  /**
   * Get a version by its UUID.
   *
   * @param versionId - The version UUID
   * @returns The version or undefined if not found
   */
  getVersion(versionId: string): AgentVersion | undefined {
    return this.data.versions.find((v) => v.versionId === versionId);
  }

  /**
   * List all versions for an agent, sorted by versionNumber descending.
   *
   * @param agentId - Logical agent identifier
   * @returns Sorted array of versions (newest first)
   */
  listVersions(agentId: string): AgentVersion[] {
    return this.data.versions
      .filter((v) => v.agentId === agentId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  /**
   * Mark a version as stable.
   *
   * @param versionId - The version UUID
   * @returns The updated version, or undefined if not found
   */
  markStable(versionId: string): AgentVersion | undefined {
    const version = this.data.versions.find((v) => v.versionId === versionId);
    if (!version) {
      return undefined;
    }
    version.isStable = true;
    this.save();
    return version;
  }

  /**
   * Delete a version.
   *
   * Returns false (without deleting) if the version is currently deployed
   * as the active or canary version for any tenant.
   *
   * @param versionId - The version UUID
   * @returns true if deleted, false if in use or not found
   */
  deleteVersion(versionId: string): boolean {
    const index = this.data.versions.findIndex((v) => v.versionId === versionId);
    if (index === -1) {
      return false;
    }

    const inUse = this.data.deployments.some(
      (d) => d.activeVersionId === versionId || d.canaryVersionId === versionId,
    );
    if (inUse) {
      return false;
    }

    this.data.versions.splice(index, 1);
    this.save();
    return true;
  }

  // ── Deployments ──────────────────────────────────────────────────

  /**
   * Deploy a specific version to a tenant for an agent.
   *
   * Upserts: if a deployment already exists for (tenantId, agentId) it is
   * replaced. Any existing canary is cleared on the new deployment.
   *
   * @param tenantId - Tenant to deploy to
   * @param agentId - Logical agent identifier
   * @param versionId - Version to deploy
   * @param opts - Optional deployer identity
   * @returns The created or updated TenantDeployment
   * @throws If versionId does not exist
   */
  deploy(
    tenantId: string,
    agentId: string,
    versionId: string,
    opts?: { deployedBy?: string },
  ): TenantDeployment {
    if (!this.data.versions.find((v) => v.versionId === versionId)) {
      throw new Error(`Version not found: ${versionId}`);
    }

    const existingIndex = this.data.deployments.findIndex(
      (d) => d.tenantId === tenantId && d.agentId === agentId,
    );

    const deployment: TenantDeployment = {
      deploymentId: existingIndex >= 0
        ? this.data.deployments[existingIndex].deploymentId
        : uuidv4(),
      tenantId,
      agentId,
      activeVersionId: versionId,
      canaryVersionId: undefined,
      canaryPercent: 0,
      deployedAt: new Date().toISOString(),
      deployedBy: opts?.deployedBy,
    };

    if (existingIndex >= 0) {
      this.data.deployments[existingIndex] = deployment;
    } else {
      this.data.deployments.push(deployment);
    }

    this.save();
    return deployment;
  }

  /**
   * Get the active deployment for a (tenantId, agentId) pair.
   *
   * @param tenantId - Tenant identifier
   * @param agentId - Logical agent identifier
   * @returns The deployment or undefined if none exists
   */
  getDeployment(tenantId: string, agentId: string): TenantDeployment | undefined {
    return this.data.deployments.find(
      (d) => d.tenantId === tenantId && d.agentId === agentId,
    );
  }

  /**
   * List deployments, optionally filtered by tenantId.
   *
   * @param tenantId - Optional tenant filter
   * @returns Array of matching deployments
   */
  listDeployments(tenantId?: string): TenantDeployment[] {
    if (tenantId === undefined) {
      return [...this.data.deployments];
    }
    return this.data.deployments.filter((d) => d.tenantId === tenantId);
  }

  // ── Canary ───────────────────────────────────────────────────────

  /**
   * Activate a canary deployment alongside the active version.
   *
   * @param tenantId - Tenant identifier
   * @param agentId - Logical agent identifier
   * @param canaryVersionId - Version to canary (must differ from active)
   * @param canaryPercent - Percentage of traffic to route to canary (1-100)
   * @returns The updated TenantDeployment
   * @throws If no deployment exists, canaryPercent is out of range, canary
   *         version does not exist, or canary version equals active version
   */
  setCanary(
    tenantId: string,
    agentId: string,
    canaryVersionId: string,
    canaryPercent: number,
  ): TenantDeployment {
    const deployment = this.data.deployments.find(
      (d) => d.tenantId === tenantId && d.agentId === agentId,
    );
    if (!deployment) {
      throw new Error(`No deployment found for tenant ${tenantId}, agent ${agentId}`);
    }

    if (!Number.isInteger(canaryPercent) || canaryPercent < 1 || canaryPercent > 100) {
      throw new Error("canaryPercent must be an integer between 1 and 100");
    }

    if (!this.data.versions.find((v) => v.versionId === canaryVersionId)) {
      throw new Error(`Version not found: ${canaryVersionId}`);
    }

    if (canaryVersionId === deployment.activeVersionId) {
      throw new Error("canaryVersionId must differ from activeVersionId");
    }

    deployment.canaryVersionId = canaryVersionId;
    deployment.canaryPercent = canaryPercent;
    this.save();
    return deployment;
  }

  /**
   * Clear the canary from a deployment.
   *
   * @param tenantId - Tenant identifier
   * @param agentId - Logical agent identifier
   * @returns The updated deployment, or undefined if no deployment exists
   */
  clearCanary(tenantId: string, agentId: string): TenantDeployment | undefined {
    const deployment = this.data.deployments.find(
      (d) => d.tenantId === tenantId && d.agentId === agentId,
    );
    if (!deployment) {
      return undefined;
    }

    deployment.canaryVersionId = undefined;
    deployment.canaryPercent = 0;
    this.save();
    return deployment;
  }

  // ── Rollback ─────────────────────────────────────────────────────

  /**
   * Roll back the active version to the previous version by versionNumber.
   *
   * "Previous" means the version with versionNumber = active.versionNumber - 1
   * for the same agentId. Clears any active canary.
   *
   * @param tenantId - Tenant identifier
   * @param agentId - Logical agent identifier
   * @returns The updated TenantDeployment
   * @throws If no deployment exists or no previous version is available
   */
  rollback(tenantId: string, agentId: string): TenantDeployment {
    const deployment = this.data.deployments.find(
      (d) => d.tenantId === tenantId && d.agentId === agentId,
    );
    if (!deployment) {
      throw new Error(`No deployment found for tenant ${tenantId}, agent ${agentId}`);
    }

    const activeVersion = this.data.versions.find(
      (v) => v.versionId === deployment.activeVersionId,
    );
    if (!activeVersion) {
      throw new Error(`Active version not found: ${deployment.activeVersionId}`);
    }

    const previousVersion = this.data.versions.find(
      (v) => v.agentId === agentId && v.versionNumber === activeVersion.versionNumber - 1,
    );
    if (!previousVersion) {
      throw new Error(
        `No previous version exists for agent ${agentId} (current versionNumber: ${activeVersion.versionNumber})`,
      );
    }

    deployment.activeVersionId = previousVersion.versionId;
    deployment.canaryVersionId = undefined;
    deployment.canaryPercent = 0;
    deployment.deployedAt = new Date().toISOString();
    this.save();
    return deployment;
  }

  // ── Routing ──────────────────────────────────────────────────────

  /**
   * Resolve which version a session should use.
   *
   * When a canary is active, routes based on a deterministic hash of sessionId:
   *   hash = sum(charCodes of sessionId) % 100
   *   if hash < canaryPercent → canary version
   *   else → active version
   *
   * @param tenantId - Tenant identifier
   * @param agentId - Logical agent identifier
   * @param sessionId - Session identifier for deterministic routing
   * @returns VersionRoutingResult or undefined if no deployment exists
   */
  resolveVersion(
    tenantId: string,
    agentId: string,
    sessionId: string,
  ): VersionRoutingResult | undefined {
    const deployment = this.data.deployments.find(
      (d) => d.tenantId === tenantId && d.agentId === agentId,
    );
    if (!deployment) {
      return undefined;
    }

    // No canary — always route to active
    if (!deployment.canaryVersionId || deployment.canaryPercent === 0) {
      const version = this.data.versions.find(
        (v) => v.versionId === deployment.activeVersionId,
      );
      if (!version) return undefined;
      return { versionId: version.versionId, isCanary: false, config: version.config };
    }

    // Canary active — hash the session ID
    const hash = sessionId.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 100;

    if (hash < deployment.canaryPercent) {
      const canaryVersion = this.data.versions.find(
        (v) => v.versionId === deployment.canaryVersionId,
      );
      if (!canaryVersion) return undefined;
      return { versionId: canaryVersion.versionId, isCanary: true, config: canaryVersion.config };
    }

    const activeVersion = this.data.versions.find(
      (v) => v.versionId === deployment.activeVersionId,
    );
    if (!activeVersion) return undefined;
    return { versionId: activeVersion.versionId, isCanary: false, config: activeVersion.config };
  }
}

// ── Singleton factory ──────────────────────────────────────────────────

let _instance: AgentVersionStore | undefined;

/**
 * Initialize the module-level AgentVersionStore singleton.
 *
 * @param storageFile - Absolute path to the JSON persistence file
 * @returns The initialized store instance
 */
export function initAgentVersionStore(storageFile: string): AgentVersionStore {
  _instance = new AgentVersionStore(storageFile);
  return _instance;
}

/**
 * Module-level singleton proxy.
 *
 * Delegates all method calls to the instance created by initAgentVersionStore().
 * Throws if the store has not been initialized.
 */
export const agentVersionStore: AgentVersionStore = new Proxy(
  {} as AgentVersionStore,
  {
    get(_target, prop) {
      if (!_instance) {
        throw new Error(
          "AgentVersionStore not initialized — call initAgentVersionStore() first",
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
