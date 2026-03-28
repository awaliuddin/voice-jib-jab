/**
 * VoiceProfileStore — Per-tenant voice profile metadata persistence.
 *
 * Stores voice profile metadata as JSON files per tenant.
 * Each tenant gets its own JSON file: {storageDir}/voices/{tenantId}.json
 * Audio files are managed externally; this store only tracks metadata.
 *
 * Usage:
 *   const store = initVoiceProfileStore("/path/to/storage");
 *   const profile = store.createProfile({ tenantId: "org_acme", name: "Bella", audioPath: "/audio/bella.wav" });
 *   const all = store.listProfiles("org_acme");
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

// ── Types ─────────────────────────────────────────────────────────────

/** Metadata for a custom TTS voice profile. */
export interface VoiceProfile {
  profileId: string;
  tenantId: string;
  name: string;
  createdAt: string;
  audioPath: string;
  durationMs: number | null;
  engineData?: Record<string, unknown>;
}

/** Options for creating a new voice profile (profileId and createdAt are generated). */
export interface CreateProfileOptions {
  tenantId: string;
  name: string;
  audioPath: string;
  durationMs?: number;
  engineData?: Record<string, unknown>;
}

// ── VoiceProfileStore ─────────────────────────────────────────────────

/** Per-tenant voice profile metadata store with JSON file persistence. */
export class VoiceProfileStore {
  private storageDir: string;
  private cache = new Map<string, VoiceProfile[]>();
  private index = new Map<string, string>();

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    mkdirSync(this.voicesDir(), { recursive: true });
    mkdirSync(this.getAudioDir(), { recursive: true });
  }

  /** Resolve the voices metadata directory. */
  private voicesDir(): string {
    return join(this.storageDir, "voices");
  }

  /** Resolve the JSON file path for a given tenant. */
  private filePath(tenantId: string): string {
    return join(this.voicesDir(), `${tenantId}.json`);
  }

  /** Returns the audio directory path. */
  getAudioDir(): string {
    return join(this.storageDir, "audio");
  }

  /** Load all tenant files from the voices directory into cache. */
  private loadAllTenants(): void {
    try {
      const files = readdirSync(this.voicesDir());
      for (const file of files) {
        if (file.endsWith(".json")) {
          const tenantId = file.slice(0, -5);
          this.loadTenant(tenantId);
        }
      }
    } catch {
      // Directory may not exist yet — nothing to load
    }
  }

  /** Load profiles for a tenant from disk. Returns [] if no file. Caches in memory. */
  private loadTenant(tenantId: string): VoiceProfile[] {
    if (this.cache.has(tenantId)) {
      return this.cache.get(tenantId)!;
    }

    const path = this.filePath(tenantId);
    let profiles: VoiceProfile[];
    try {
      const raw = readFileSync(path, "utf-8");
      profiles = JSON.parse(raw) as VoiceProfile[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        profiles = [];
      } else {
        throw err;
      }
    }

    this.cache.set(tenantId, profiles);
    for (const p of profiles) {
      this.index.set(p.profileId, tenantId);
    }
    return profiles;
  }

  /** Persist profiles for a tenant to disk. */
  private save(tenantId: string, profiles: VoiceProfile[]): void {
    writeFileSync(this.filePath(tenantId), JSON.stringify(profiles, null, 2), "utf-8");
  }

  /** Create a new voice profile. Persists immediately. */
  createProfile(opts: CreateProfileOptions): VoiceProfile {
    const profile: VoiceProfile = {
      profileId: uuidv4(),
      tenantId: opts.tenantId,
      name: opts.name,
      createdAt: new Date().toISOString(),
      audioPath: opts.audioPath,
      durationMs: opts.durationMs ?? null,
      ...(opts.engineData !== undefined ? { engineData: opts.engineData } : {}),
    };

    const profiles = this.loadTenant(opts.tenantId);
    profiles.push(profile);
    this.cache.set(opts.tenantId, profiles);
    this.index.set(profile.profileId, opts.tenantId);
    this.save(opts.tenantId, profiles);

    return profile;
  }

  /** Get a single profile by profileId. Returns undefined if not found. */
  getProfile(profileId: string): VoiceProfile | undefined {
    const tenantId = this.index.get(profileId);
    if (tenantId) {
      const profiles = this.loadTenant(tenantId);
      return profiles.find((p) => p.profileId === profileId);
    }

    // Profile not in index — load all tenant files from disk
    this.loadAllTenants();

    const resolvedTenantId = this.index.get(profileId);
    if (resolvedTenantId) {
      const profiles = this.loadTenant(resolvedTenantId);
      return profiles.find((p) => p.profileId === profileId);
    }

    return undefined;
  }

  /** List all profiles for a tenant. Returns empty array for unknown tenant. */
  listProfiles(tenantId: string): VoiceProfile[] {
    return [...this.loadTenant(tenantId)];
  }

  /**
   * Delete a profile by profileId.
   *
   * @returns true if the profile was found and removed, false otherwise.
   */
  deleteProfile(profileId: string): boolean {
    const tenantId = this.index.get(profileId);
    if (!tenantId) {
      return false;
    }

    const profiles = this.loadTenant(tenantId);
    const idx = profiles.findIndex((p) => p.profileId === profileId);
    if (idx === -1) {
      return false;
    }

    profiles.splice(idx, 1);
    this.cache.set(tenantId, profiles);
    this.index.delete(profileId);
    this.save(tenantId, profiles);

    return true;
  }
}

// ── Factory ───────────────────────────────────────────────────────────

/** Initialize a VoiceProfileStore with the given storage directory. */
export function initVoiceProfileStore(storageDir: string): VoiceProfileStore {
  return new VoiceProfileStore(storageDir);
}
