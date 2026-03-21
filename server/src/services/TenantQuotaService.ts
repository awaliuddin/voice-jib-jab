/**
 * TenantQuotaService — Per-tenant rate limiting and monthly usage quota enforcement.
 *
 * Manages per-tenant API rate limits (sliding window) and monthly audio-minutes
 * quotas. Rate limit counters are in-memory only; quota configs and usage records
 * are persisted to a JSON file.
 *
 * Persistence: single JSON file at the path given to the constructor.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// ── Types ───────────────────────────────────────────────────────────────

export interface TenantQuotaConfig {
  tenantId: string;
  requestsPerMinute: number;
  maxConcurrentSessions: number;
  monthlyMinutesQuota: number;
  updatedAt: string;
}

export interface TenantUsageRecord {
  tenantId: string;
  monthKey: string;
  minutesUsed: number;
  sessionsStarted: number;
  updatedAt: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  reason?: string;
}

interface SlidingWindowEntry {
  count: number;
  resetAt: number;
}

interface StorageFormat {
  quotas: TenantQuotaConfig[];
  usage: TenantUsageRecord[];
}

// ── Defaults ────────────────────────────────────────────────────────────

const DEFAULT_REQUESTS_PER_MINUTE = 60;
const DEFAULT_MAX_CONCURRENT_SESSIONS = 5;
const DEFAULT_MONTHLY_MINUTES_QUOTA = 0;
const WINDOW_MS = 60_000;

// ── TenantQuotaService ──────────────────────────────────────────────────

export class TenantQuotaService {
  private storageFile: string;
  private data: StorageFormat;
  private rateLimitWindows: Map<string, SlidingWindowEntry>;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.data = this.load();
    this.rateLimitWindows = new Map();
  }

  // ── Persistence ─────────────────────────────────────────────────────

  private load(): StorageFormat {
    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      return JSON.parse(raw) as StorageFormat;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { quotas: [], usage: [] };
      }
      throw err;
    }
  }

  private save(): void {
    mkdirSync(dirname(this.storageFile), { recursive: true });
    writeFileSync(this.storageFile, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // ── Quota CRUD ───────────────────────────────────────────────────────

  /**
   * Upsert a quota configuration for a tenant.
   *
   * Unset fields default to: requestsPerMinute=60, maxConcurrentSessions=5,
   * monthlyMinutesQuota=0 (unlimited). Existing values are preserved on
   * partial update.
   *
   * @param tenantId - The tenant to configure
   * @param quota - Fields to set (partial, excluding tenantId and updatedAt)
   * @returns The resulting TenantQuotaConfig
   */
  setQuota(
    tenantId: string,
    quota: Partial<Omit<TenantQuotaConfig, "tenantId" | "updatedAt">>,
  ): TenantQuotaConfig {
    const now = new Date().toISOString();
    const existing = this.data.quotas.find((q) => q.tenantId === tenantId);

    if (existing) {
      if (quota.requestsPerMinute !== undefined) {
        existing.requestsPerMinute = quota.requestsPerMinute;
      }
      if (quota.maxConcurrentSessions !== undefined) {
        existing.maxConcurrentSessions = quota.maxConcurrentSessions;
      }
      if (quota.monthlyMinutesQuota !== undefined) {
        existing.monthlyMinutesQuota = quota.monthlyMinutesQuota;
      }
      existing.updatedAt = now;
      this.save();
      return existing;
    }

    const config: TenantQuotaConfig = {
      tenantId,
      requestsPerMinute: quota.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE,
      maxConcurrentSessions:
        quota.maxConcurrentSessions ?? DEFAULT_MAX_CONCURRENT_SESSIONS,
      monthlyMinutesQuota:
        quota.monthlyMinutesQuota ?? DEFAULT_MONTHLY_MINUTES_QUOTA,
      updatedAt: now,
    };

    this.data.quotas.push(config);
    this.save();
    return config;
  }

  /**
   * Get the quota config for a tenant.
   *
   * @param tenantId - The tenant to look up
   * @returns TenantQuotaConfig or null if not configured
   */
  getQuota(tenantId: string): TenantQuotaConfig | null {
    return this.data.quotas.find((q) => q.tenantId === tenantId) ?? null;
  }

  /**
   * List all configured tenant quotas.
   *
   * @returns Array of all TenantQuotaConfig records
   */
  listQuotas(): TenantQuotaConfig[] {
    return [...this.data.quotas];
  }

  /**
   * Delete the quota config for a tenant.
   *
   * @param tenantId - The tenant to remove
   * @returns true if deleted, false if not found
   */
  deleteQuota(tenantId: string): boolean {
    const index = this.data.quotas.findIndex((q) => q.tenantId === tenantId);
    if (index === -1) return false;
    this.data.quotas.splice(index, 1);
    this.save();
    return true;
  }

  // ── Rate Limiting ────────────────────────────────────────────────────

  /**
   * Check and record a rate-limited API call for a tenant.
   *
   * Uses an in-memory sliding window (1 minute). The counter resets when
   * the window expires. Increments on every call, including the one that
   * exceeds the limit.
   *
   * @param tenantId - The tenant making the request
   * @returns RateLimitResult with allowed flag and window metadata
   */
  checkRateLimit(tenantId: string): RateLimitResult {
    const quota = this.getQuota(tenantId);
    const max = quota?.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE;
    const now = Date.now();

    let entry = this.rateLimitWindows.get(tenantId);

    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + WINDOW_MS };
      this.rateLimitWindows.set(tenantId, entry);
      return { allowed: true, remaining: max - 1, resetAt: entry.resetAt };
    }

    entry.count++;

    if (entry.count > max) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        reason: "Rate limit exceeded",
      };
    }

    return {
      allowed: true,
      remaining: max - entry.count,
      resetAt: entry.resetAt,
    };
  }

  // ── Usage Recording ──────────────────────────────────────────────────

  /**
   * Add audio minutes to the current month's usage for a tenant.
   *
   * @param tenantId - The tenant to record usage for
   * @param minutes - Number of minutes to add
   */
  recordSessionMinutes(tenantId: string, minutes: number): void {
    const monthKey = this.getCurrentMonthKey();
    const record = this.getOrCreateUsageRecord(tenantId, monthKey);
    record.minutesUsed += minutes;
    record.updatedAt = new Date().toISOString();
    this.save();
  }

  /**
   * Increment the session count for the current month for a tenant.
   *
   * @param tenantId - The tenant to record the session start for
   */
  recordSessionStart(tenantId: string): void {
    const monthKey = this.getCurrentMonthKey();
    const record = this.getOrCreateUsageRecord(tenantId, monthKey);
    record.sessionsStarted++;
    record.updatedAt = new Date().toISOString();
    this.save();
  }

  /**
   * Get usage for a tenant for a given month (defaults to current month).
   *
   * @param tenantId - The tenant to look up
   * @param monthKey - Optional "YYYY-MM" key; defaults to current month
   * @returns TenantUsageRecord or null if no usage recorded
   */
  getUsage(tenantId: string, monthKey?: string): TenantUsageRecord | null {
    const key = monthKey ?? this.getCurrentMonthKey();
    return (
      this.data.usage.find(
        (u) => u.tenantId === tenantId && u.monthKey === key,
      ) ?? null
    );
  }

  // ── Quota Check ──────────────────────────────────────────────────────

  /**
   * Check whether the tenant has remaining monthly minutes quota.
   *
   * Returns allowed=true when monthlyMinutesQuota=0 (unlimited) or when
   * minutesUsed < quota. Returns allowed=false with reason when exhausted.
   *
   * @param tenantId - The tenant to check
   * @returns Object with allowed flag and optional reason
   */
  checkQuota(tenantId: string): { allowed: boolean; reason?: string } {
    const quota = this.getQuota(tenantId);
    const monthlyLimit = quota?.monthlyMinutesQuota ?? DEFAULT_MONTHLY_MINUTES_QUOTA;

    if (monthlyLimit === 0) {
      return { allowed: true };
    }

    const usage = this.getUsage(tenantId);
    const minutesUsed = usage?.minutesUsed ?? 0;

    if (minutesUsed >= monthlyLimit) {
      return {
        allowed: false,
        reason: `Monthly minutes quota exhausted (${minutesUsed}/${monthlyLimit})`,
      };
    }

    return { allowed: true };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Return the current calendar month key in "YYYY-MM" format.
   *
   * @returns Month key string
   */
  getCurrentMonthKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  private getOrCreateUsageRecord(
    tenantId: string,
    monthKey: string,
  ): TenantUsageRecord {
    const existing = this.data.usage.find(
      (u) => u.tenantId === tenantId && u.monthKey === monthKey,
    );

    if (existing) return existing;

    const record: TenantUsageRecord = {
      tenantId,
      monthKey,
      minutesUsed: 0,
      sessionsStarted: 0,
      updatedAt: new Date().toISOString(),
    };

    this.data.usage.push(record);
    return record;
  }
}
