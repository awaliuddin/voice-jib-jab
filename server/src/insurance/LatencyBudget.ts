/**
 * Latency Budget Tracker
 * Captures and computes latency metrics
 */

export interface LatencyMetrics {
  ttfb: number[]; // Time to first byte
  turnLatency: number[]; // End-to-end turn latency
  bargeInStop: number[]; // Barge-in stop time
}

export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
  count: number;
}

export class LatencyBudget {
  private metrics: Map<string, LatencyMetrics>;
  private sessionMarkers: Map<string, Map<string, number>>;

  constructor() {
    this.metrics = new Map();
    this.sessionMarkers = new Map();
  }

  /**
   * Mark a timestamp for a session event
   */
  mark(sessionId: string, marker: string): void {
    if (!this.sessionMarkers.has(sessionId)) {
      this.sessionMarkers.set(sessionId, new Map());
    }

    this.sessionMarkers.get(sessionId)!.set(marker, Date.now());
  }

  /**
   * Get time since marker
   */
  timeSince(sessionId: string, marker: string): number | null {
    const markers = this.sessionMarkers.get(sessionId);
    if (!markers) return null;

    const markerTime = markers.get(marker);
    if (!markerTime) return null;

    return Date.now() - markerTime;
  }

  /**
   * Record TTFB metric
   */
  recordTTFB(sessionId: string, ttfb: number): void {
    if (!this.metrics.has(sessionId)) {
      this.metrics.set(sessionId, {
        ttfb: [],
        turnLatency: [],
        bargeInStop: [],
      });
    }

    this.metrics.get(sessionId)!.ttfb.push(ttfb);
  }

  /**
   * Record turn latency
   */
  recordTurnLatency(sessionId: string, latency: number): void {
    if (!this.metrics.has(sessionId)) {
      this.metrics.set(sessionId, {
        ttfb: [],
        turnLatency: [],
        bargeInStop: [],
      });
    }

    this.metrics.get(sessionId)!.turnLatency.push(latency);
  }

  /**
   * Record barge-in stop time
   */
  recordBargeInStop(sessionId: string, stopTime: number): void {
    if (!this.metrics.has(sessionId)) {
      this.metrics.set(sessionId, {
        ttfb: [],
        turnLatency: [],
        bargeInStop: [],
      });
    }

    this.metrics.get(sessionId)!.bargeInStop.push(stopTime);
  }

  /**
   * Compute statistics for a metric array
   */
  private computeStats(values: number[]): LatencyStats {
    if (values.length === 0) {
      return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0, count: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;

    const p50Index = Math.floor(count * 0.5);
    const p95Index = Math.floor(count * 0.95);
    const p99Index = Math.floor(count * 0.99);

    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const mean = sum / count;

    return {
      p50: sorted[p50Index],
      p95: sorted[p95Index],
      p99: sorted[p99Index],
      mean,
      min: sorted[0],
      max: sorted[count - 1],
      count,
    };
  }

  /**
   * Get statistics for a session
   */
  getSessionStats(sessionId: string): {
    ttfb: LatencyStats;
    turnLatency: LatencyStats;
    bargeInStop: LatencyStats;
  } | null {
    const metrics = this.metrics.get(sessionId);
    if (!metrics) return null;

    return {
      ttfb: this.computeStats(metrics.ttfb),
      turnLatency: this.computeStats(metrics.turnLatency),
      bargeInStop: this.computeStats(metrics.bargeInStop),
    };
  }

  /**
   * Get aggregate statistics across all sessions
   */
  getAggregateStats(): {
    ttfb: LatencyStats;
    turnLatency: LatencyStats;
    bargeInStop: LatencyStats;
  } {
    const allTTFB: number[] = [];
    const allTurnLatency: number[] = [];
    const allBargeInStop: number[] = [];

    for (const metrics of this.metrics.values()) {
      allTTFB.push(...metrics.ttfb);
      allTurnLatency.push(...metrics.turnLatency);
      allBargeInStop.push(...metrics.bargeInStop);
    }

    return {
      ttfb: this.computeStats(allTTFB),
      turnLatency: this.computeStats(allTurnLatency),
      bargeInStop: this.computeStats(allBargeInStop),
    };
  }

  /**
   * Clear metrics for a session
   */
  clearSession(sessionId: string): void {
    this.metrics.delete(sessionId);
    this.sessionMarkers.delete(sessionId);
  }
}

// Singleton instance
export const latencyBudget = new LatencyBudget();
