/**
 * CallQueueService -- Per-tenant FIFO call queue.
 *
 * Provides enqueue / dequeue / position lookup for callers waiting to be
 * connected. Each tenant maintains its own ordered queue of session IDs.
 *
 * Usage:
 *   const queue = new CallQueueService();
 *   const entry = queue.enqueue("sess-1", "tenant-acme");
 *   const next  = queue.dequeue("tenant-acme");
 */

// -- Types ------------------------------------------------------------------

export interface QueueEntry {
  sessionId: string;
  tenantId: string;
  enqueuedAt: string;
  position: number;
}

export interface QueueStatus {
  tenantId: string;
  length: number;
  entries: QueueEntry[];
  estimatedWaitMs: number;
}

// -- Constants --------------------------------------------------------------

const AVG_HANDLE_TIME_MS = 180_000; // 3 minutes per caller

// -- CallQueueService -------------------------------------------------------

export class CallQueueService {
  private queues = new Map<string, string[]>();
  private meta = new Map<string, { tenantId: string; enqueuedAt: string }>();

  /** Add a session to the end of the tenant queue. Returns the new entry with position. */
  enqueue(sessionId: string, tenantId: string): QueueEntry {
    if (!this.queues.has(tenantId)) {
      this.queues.set(tenantId, []);
    }

    const queue = this.queues.get(tenantId)!;
    queue.push(sessionId);

    const enqueuedAt = new Date().toISOString();
    this.meta.set(sessionId, { tenantId, enqueuedAt });

    return {
      sessionId,
      tenantId,
      enqueuedAt,
      position: queue.length,
    };
  }

  /** Remove and return the first session in the tenant queue. Null if empty. */
  dequeue(tenantId: string): string | null {
    const queue = this.queues.get(tenantId);
    if (!queue || queue.length === 0) {
      return null;
    }

    const sessionId = queue.shift()!;
    this.meta.delete(sessionId);
    return sessionId;
  }

  /** Get 1-based position for a session. Null if not found. */
  getPosition(sessionId: string): number | null {
    const entry = this.meta.get(sessionId);
    if (!entry) {
      return null;
    }

    const queue = this.queues.get(entry.tenantId);
    if (!queue) {
      return null;
    }

    const idx = queue.indexOf(sessionId);
    return idx === -1 ? null : idx + 1;
  }

  /** Get queue status for a specific tenant. */
  getQueueStatus(tenantId: string): QueueStatus {
    const queue = this.queues.get(tenantId) ?? [];

    const entries: QueueEntry[] = queue.map((sessionId, idx) => {
      const m = this.meta.get(sessionId)!;
      return {
        sessionId,
        tenantId,
        enqueuedAt: m.enqueuedAt,
        position: idx + 1,
      };
    });

    return {
      tenantId,
      length: queue.length,
      entries,
      estimatedWaitMs: queue.length * AVG_HANDLE_TIME_MS,
    };
  }

  /** Remove a session from whichever queue it is in. Returns true if found. */
  remove(sessionId: string): boolean {
    const entry = this.meta.get(sessionId);
    if (!entry) {
      return false;
    }

    const queue = this.queues.get(entry.tenantId);
    if (queue) {
      const idx = queue.indexOf(sessionId);
      if (idx !== -1) {
        queue.splice(idx, 1);
      }
    }

    this.meta.delete(sessionId);
    return true;
  }

  /** Get queue status for all non-empty tenants. */
  getAllQueueStatuses(): QueueStatus[] {
    const statuses: QueueStatus[] = [];

    for (const [tenantId, queue] of this.queues.entries()) {
      if (queue.length > 0) {
        statuses.push(this.getQueueStatus(tenantId));
      }
    }

    return statuses;
  }
}
