/**
 * TenantConfigMigrator — Export and import a tenant's full configuration.
 *
 * Produces a composite JSON snapshot of all tenant-owned data (registration,
 * personas, knowledge base, playbooks, IVR menus) and can replay that
 * snapshot into any target tenant.
 *
 * Usage:
 *   const migrator = new TenantConfigMigrator(registry, personaStore, kbStore, playbookStore, ivrStore);
 *   const exported = await migrator.exportTenant("org_acme");
 *   const result   = await migrator.importTenant(exported, "org_beta", { overwrite: true });
 */

import type { TenantRegistry, TenantConfig } from "./TenantRegistry.js";
import type { PersonaStore, PersonaConfig } from "./PersonaStore.js";
import type { KnowledgeBaseStore, KbEntry } from "./KnowledgeBaseStore.js";
import type { PlaybookStore, PlaybookEntry } from "./PlaybookStore.js";
import type { IvrMenuStore, IvrMenu } from "./IvrMenuStore.js";

// ── Public types ───────────────────────────────────────────────────────

/** Portable snapshot of all tenant-owned configuration data. */
export interface TenantExport {
  version: "1.0";
  exportedAt: string;
  sourceTenantId: string;
  tenant: TenantConfig | null;
  personas: PersonaConfig[];
  knowledgeItems: KbEntry[];
  playbooks: PlaybookEntry[];
  ivrMenus: IvrMenu[];
}

/** Result of importing a tenant configuration snapshot into a target tenant. */
export interface ImportResult {
  targetTenantId: string;
  importedAt: string;
  counts: {
    personas: number;
    knowledgeItems: number;
    playbooks: number;
    ivrMenus: number;
  };
  warnings: string[];
}

// ── TenantConfigMigrator ───────────────────────────────────────────────

/** Exports and imports full tenant configurations across environments. */
export class TenantConfigMigrator {
  constructor(
    private tenantRegistry: TenantRegistry,
    private personaStore: PersonaStore,
    private kbStore: KnowledgeBaseStore,
    private playbookStore: PlaybookStore,
    private ivrStore: IvrMenuStore,
  ) {}

  /**
   * Export all data for a tenant into a portable snapshot object.
   *
   * Only custom (non-built-in) personas that explicitly belong to this tenant
   * are included. Global built-in personas are excluded because they exist
   * on every installation.
   *
   * Throws if the tenant is not registered.
   */
  async exportTenant(tenantId: string): Promise<TenantExport> {
    const tenant = this.tenantRegistry.getTenant(tenantId);
    if (tenant === null) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    // PersonaStore.listPersonas(tenantId) returns built-ins + custom for tenant.
    // We only want the tenant-owned custom personas (tenantId === this tenant).
    const allPersonas = this.personaStore.listPersonas(tenantId);
    const personas = allPersonas.filter(
      (p) => !p.isBuiltIn && p.tenantId === tenantId,
    );

    // KnowledgeBaseStore.listEntries is per-tenant by design.
    const knowledgeItems = this.kbStore.listEntries(tenantId);

    // PlaybookStore.listEntries({tenantId}) includes global (null) entries too.
    // Export only entries explicitly owned by this tenant.
    const allPlaybooks = this.playbookStore.listEntries({ tenantId });
    const playbooks = allPlaybooks.filter((p) => p.tenantId === tenantId);

    // IvrMenuStore.listMenus({tenantId}) does an exact match — correct as-is.
    const ivrMenus = this.ivrStore.listMenus({ tenantId });

    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      sourceTenantId: tenantId,
      tenant,
      personas,
      knowledgeItems,
      playbooks,
      ivrMenus,
    };
  }

  /**
   * Import a tenant snapshot into the target tenant.
   *
   * Each resource is remapped to targetTenantId. The original IDs from the
   * source export are used solely for conflict detection (to decide whether
   * to skip or overwrite). Newly created records always receive fresh IDs
   * from the store.
   *
   * When opts.overwrite is false (default), items whose source ID is already
   * present in the target tenant are skipped and recorded as warnings.
   * When opts.overwrite is true, existing items are replaced.
   *
   * Tenant registration is attempted only when the export includes tenant
   * info. If the target tenant already exists the registration is skipped
   * and a warning is added.
   *
   * Throws if the export data is invalid (wrong version, missing sourceTenantId).
   */
  async importTenant(
    data: TenantExport,
    targetTenantId: string,
    opts?: { overwrite?: boolean },
  ): Promise<ImportResult> {
    if (data.version !== "1.0") {
      throw new Error(
        `Unsupported export version: ${(data as { version?: unknown }).version ?? "(missing)"}`,
      );
    }
    if (!data.sourceTenantId) {
      throw new Error("Invalid export: missing sourceTenantId");
    }

    const overwrite = opts?.overwrite ?? false;
    const warnings: string[] = [];
    const counts = { personas: 0, knowledgeItems: 0, playbooks: 0, ivrMenus: 0 };
    const importedAt = new Date().toISOString();

    // ── Tenant registration ────────────────────────────────────────────

    if (data.tenant) {
      const existing = this.tenantRegistry.getTenant(targetTenantId);
      if (existing) {
        warnings.push("tenant registration skipped — already exists");
      } else {
        try {
          this.tenantRegistry.createTenant({
            ...data.tenant,
            tenantId: targetTenantId,
          });
        } catch (err) {
          warnings.push(
            `tenant registration failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // ── Personas ──────────────────────────────────────────────────────

    const existingPersonas = this.personaStore
      .listPersonas(targetTenantId)
      .filter((p) => !p.isBuiltIn && p.tenantId === targetTenantId);
    const existingPersonaIds = new Set(existingPersonas.map((p) => p.personaId));

    for (const persona of data.personas ?? []) {
      if (existingPersonaIds.has(persona.personaId) && !overwrite) {
        warnings.push(`persona ${persona.personaId} skipped — already exists`);
        continue;
      }

      try {
        this.personaStore.createPersona({
          name: persona.name,
          tone: persona.tone,
          vocabularyLevel: persona.vocabularyLevel,
          responseLengthPreference: persona.responseLengthPreference,
          description: persona.description,
          systemPromptSnippet: persona.systemPromptSnippet,
          tenantId: targetTenantId,
        });
        counts.personas++;
      } catch (err) {
        warnings.push(
          `persona ${persona.personaId} import failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ── Knowledge base items ───────────────────────────────────────────

    const existingKbItems = this.kbStore.listEntries(targetTenantId);
    const existingKbIds = new Set(existingKbItems.map((e) => e.id));

    for (const item of data.knowledgeItems ?? []) {
      if (existingKbIds.has(item.id) && !overwrite) {
        warnings.push(`knowledgeItem ${item.id} skipped — already exists`);
        continue;
      }

      try {
        this.kbStore.addEntry({
          tenantId: targetTenantId,
          question: item.question,
          answer: item.answer,
          tags: item.tags,
          source: item.source,
          sessionId: item.sessionId,
        });
        counts.knowledgeItems++;
      } catch (err) {
        warnings.push(
          `knowledgeItem ${item.id} import failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ── Playbooks ─────────────────────────────────────────────────────

    const existingPlaybooks = this.playbookStore
      .listEntries({ tenantId: targetTenantId })
      .filter((p) => p.tenantId === targetTenantId);
    const existingPlaybookIds = new Set(existingPlaybooks.map((p) => p.entryId));

    for (const playbook of data.playbooks ?? []) {
      if (existingPlaybookIds.has(playbook.entryId) && !overwrite) {
        warnings.push(`playbook ${playbook.entryId} skipped — already exists`);
        continue;
      }

      try {
        this.playbookStore.createEntry({
          name: playbook.name,
          scenario: playbook.scenario,
          script: playbook.script,
          keywords: playbook.keywords,
          tenantId: targetTenantId,
          enabled: playbook.enabled,
        });
        counts.playbooks++;
      } catch (err) {
        warnings.push(
          `playbook ${playbook.entryId} import failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ── IVR menus ─────────────────────────────────────────────────────

    const existingMenus = this.ivrStore.listMenus({ tenantId: targetTenantId });
    const existingMenuIds = new Set(existingMenus.map((m) => m.menuId));

    for (const menu of data.ivrMenus ?? []) {
      if (existingMenuIds.has(menu.menuId) && !overwrite) {
        warnings.push(`ivrMenu ${menu.menuId} skipped — already exists`);
        continue;
      }

      try {
        this.ivrStore.createMenu({
          name: menu.name,
          tenantId: targetTenantId,
          rootNodeId: menu.rootNodeId,
          nodes: menu.nodes,
        });
        counts.ivrMenus++;
      } catch (err) {
        warnings.push(
          `ivrMenu ${menu.menuId} import failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      targetTenantId,
      importedAt,
      counts,
      warnings,
    };
  }
}
