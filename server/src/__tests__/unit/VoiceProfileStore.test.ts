/**
 * VoiceProfileStore Unit Tests
 *
 * Tests the VoiceProfileStore service that manages per-tenant voice
 * profile metadata with JSON-file persistence. Uses real filesystem
 * via OS temp directories.
 */

import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync } from "fs";
import {
  VoiceProfileStore,
  initVoiceProfileStore,
} from "../../services/VoiceProfileStore.js";

// ── Test helpers ──────────────────────────────────────────────────────

function tempDir(label: string): string {
  return join(
    tmpdir(),
    `voice-profile-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("VoiceProfileStore", () => {
  let store: VoiceProfileStore;
  let dir: string;

  beforeEach(() => {
    dir = tempDir("store");
    store = new VoiceProfileStore(dir);
  });

  afterEach(() => {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── createProfile ───────────────────────────────────────────────────

  describe("createProfile()", () => {
    it("creates a profile with generated uuid and createdAt", () => {
      const profile = store.createProfile({
        tenantId: "org_a",
        name: "Bella",
        audioPath: "/audio/bella.wav",
      });

      expect(profile.profileId).toBeDefined();
      expect(typeof profile.profileId).toBe("string");
      expect(profile.profileId.length).toBeGreaterThan(0);
      expect(profile.createdAt).toBeDefined();
      expect(new Date(profile.createdAt).toISOString()).toBe(profile.createdAt);
      expect(profile.tenantId).toBe("org_a");
      expect(profile.name).toBe("Bella");
      expect(profile.audioPath).toBe("/audio/bella.wav");
    });

    it("stores profile in memory and persists to JSON", () => {
      const profile = store.createProfile({
        tenantId: "org_b",
        name: "Nova",
        audioPath: "/audio/nova.wav",
      });

      // Verify persisted by re-reading from a fresh store
      const store2 = new VoiceProfileStore(dir);
      const reloaded = store2.getProfile(profile.profileId);
      expect(reloaded).toBeDefined();
      expect(reloaded!.name).toBe("Nova");
    });

    it("two profiles same tenant are both in list", () => {
      store.createProfile({ tenantId: "org_c", name: "Voice1", audioPath: "/a.wav" });
      store.createProfile({ tenantId: "org_c", name: "Voice2", audioPath: "/b.wav" });

      const list = store.listProfiles("org_c");
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.name).sort()).toEqual(["Voice1", "Voice2"]);
    });

    it("two profiles different tenants produce separate files", () => {
      store.createProfile({ tenantId: "org_d", name: "D-Voice", audioPath: "/d.wav" });
      store.createProfile({ tenantId: "org_e", name: "E-Voice", audioPath: "/e.wav" });

      expect(existsSync(join(dir, "voices", "org_d.json"))).toBe(true);
      expect(existsSync(join(dir, "voices", "org_e.json"))).toBe(true);

      expect(store.listProfiles("org_d")).toHaveLength(1);
      expect(store.listProfiles("org_e")).toHaveLength(1);
    });

    it("preserves engineData when provided", () => {
      const profile = store.createProfile({
        tenantId: "org_f",
        name: "Custom",
        audioPath: "/custom.wav",
        engineData: { model: "v2", quality: "high" },
      });

      expect(profile.engineData).toEqual({ model: "v2", quality: "high" });
    });

    it("preserves durationMs when provided", () => {
      const profile = store.createProfile({
        tenantId: "org_g",
        name: "Timed",
        audioPath: "/timed.wav",
        durationMs: 3200,
      });

      expect(profile.durationMs).toBe(3200);
    });

    it("defaults durationMs to null when not provided", () => {
      const profile = store.createProfile({
        tenantId: "org_h",
        name: "NoTime",
        audioPath: "/notime.wav",
      });

      expect(profile.durationMs).toBeNull();
    });
  });

  // ── getProfile ──────────────────────────────────────────────────────

  describe("getProfile()", () => {
    it("returns correct profile by profileId", () => {
      const created = store.createProfile({
        tenantId: "org_i",
        name: "FindMe",
        audioPath: "/findme.wav",
      });

      const found = store.getProfile(created.profileId);
      expect(found).toBeDefined();
      expect(found!.profileId).toBe(created.profileId);
      expect(found!.name).toBe("FindMe");
    });

    it("returns undefined for unknown id", () => {
      const result = store.getProfile("nonexistent-profile-id");
      expect(result).toBeUndefined();
    });
  });

  // ── listProfiles ────────────────────────────────────────────────────

  describe("listProfiles()", () => {
    it("returns all profiles for a tenant", () => {
      store.createProfile({ tenantId: "org_j", name: "V1", audioPath: "/v1.wav" });
      store.createProfile({ tenantId: "org_j", name: "V2", audioPath: "/v2.wav" });
      store.createProfile({ tenantId: "org_j", name: "V3", audioPath: "/v3.wav" });

      const list = store.listProfiles("org_j");
      expect(list).toHaveLength(3);
    });

    it("returns empty array for unknown tenant", () => {
      const list = store.listProfiles("org_unknown");
      expect(list).toEqual([]);
    });

    it("does not include deleted profiles", () => {
      const p1 = store.createProfile({ tenantId: "org_k", name: "Keep", audioPath: "/k.wav" });
      const p2 = store.createProfile({ tenantId: "org_k", name: "Remove", audioPath: "/r.wav" });

      store.deleteProfile(p2.profileId);

      const list = store.listProfiles("org_k");
      expect(list).toHaveLength(1);
      expect(list[0].profileId).toBe(p1.profileId);
    });
  });

  // ── deleteProfile ───────────────────────────────────────────────────

  describe("deleteProfile()", () => {
    it("removes profile and returns true", () => {
      const profile = store.createProfile({
        tenantId: "org_l",
        name: "Deletable",
        audioPath: "/del.wav",
      });

      const result = store.deleteProfile(profile.profileId);
      expect(result).toBe(true);
    });

    it("returns false for unknown id", () => {
      const result = store.deleteProfile("nonexistent-id");
      expect(result).toBe(false);
    });

    it("after delete getProfile returns undefined", () => {
      const profile = store.createProfile({
        tenantId: "org_m",
        name: "Gone",
        audioPath: "/gone.wav",
      });

      store.deleteProfile(profile.profileId);

      const found = store.getProfile(profile.profileId);
      expect(found).toBeUndefined();
    });
  });

  // ── Persistence ─────────────────────────────────────────────────────

  describe("persistence", () => {
    it("new store instance reloads profiles from disk", () => {
      store.createProfile({ tenantId: "org_n", name: "Persistent", audioPath: "/p.wav", durationMs: 1500 });
      store.createProfile({ tenantId: "org_n", name: "Also Persistent", audioPath: "/p2.wav" });

      // Create entirely new store pointing at the same directory
      const store2 = new VoiceProfileStore(dir);
      const list = store2.listProfiles("org_n");

      expect(list).toHaveLength(2);
      expect(list[0].name).toBe("Persistent");
      expect(list[0].durationMs).toBe(1500);
      expect(list[1].name).toBe("Also Persistent");
    });
  });

  // ── getAudioDir ─────────────────────────────────────────────────────

  describe("getAudioDir()", () => {
    it("returns storageDir/audio path", () => {
      const expected = join(dir, "audio");
      expect(store.getAudioDir()).toBe(expected);
    });
  });

  // ── initVoiceProfileStore factory ───────────────────────────────────

  describe("initVoiceProfileStore()", () => {
    it("returns a VoiceProfileStore instance", () => {
      const factoryDir = tempDir("factory");
      try {
        const result = initVoiceProfileStore(factoryDir);
        expect(result).toBeInstanceOf(VoiceProfileStore);
      } finally {
        if (existsSync(factoryDir)) {
          rmSync(factoryDir, { recursive: true, force: true });
        }
      }
    });
  });
});

// ── Branch coverage ────────────────────────────────────────────────────

describe("VoiceProfileStore — branch coverage", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `voice-profile-branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
  });

  afterEach(() => {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // L93 false-branch: loadTenant re-throws non-ENOENT errors
  it("loadTenant re-throws non-ENOENT filesystem errors (L93 false branch)", () => {
    const { writeFileSync, mkdirSync } = require("fs") as typeof import("fs");
    mkdirSync(join(dir, "voices"), { recursive: true });
    mkdirSync(join(dir, "audio"), { recursive: true });

    // Write a corrupt (non-JSON) file so JSON.parse throws a SyntaxError — not an ENOENT
    writeFileSync(join(dir, "voices", "org_corrupt.json"), "{ this is not valid json }", "utf-8");

    const store = new VoiceProfileStore(dir);
    // listProfiles calls loadTenant which will read the corrupt file and fail with SyntaxError
    expect(() => store.listProfiles("org_corrupt")).toThrow();
  });

  // L171 true-branch: deleteProfile returns false when profileId is in the index
  // but the profile array does not contain it (stale index after manual cache mutation)
  it("deleteProfile returns false when index entry exists but profile absent (L171 true branch)", () => {
    const store = new VoiceProfileStore(dir);

    // Create a profile so the index has an entry
    const profile = store.createProfile({
      tenantId: "org_stale",
      name: "Stale",
      audioPath: "/stale.wav",
    });

    // Reach into private internals to corrupt the cache so the profile is gone
    // from the array while the index still points at the tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeAny = store as any;
    storeAny.cache.set("org_stale", []); // empty the tenant's profile list

    // The index still maps profileId → "org_stale", but the array is empty
    const result = store.deleteProfile(profile.profileId);
    expect(result).toBe(false);
  });
});
