/**
 * GracefulShutdown — Coordinated server shutdown (N-38)
 *
 * Closes a set of ShutdownTargets concurrently, then exits. If any target
 * fails to close within `timeoutMs`, the process is force-killed with exit
 * code 1. Idempotent: subsequent calls after the first are no-ops.
 *
 * Usage:
 *   const shutdown = new GracefulShutdown([voiceWss, supervisorWss, httpServer]);
 *   shutdown.register(); // wires SIGTERM + SIGINT
 */

export interface ShutdownTarget {
  close(callback?: (err?: Error) => void): void;
}

export class GracefulShutdown {
  private readonly targets: ShutdownTarget[];
  private readonly timeoutMs: number;
  private readonly exitFn: (code: number) => void;
  private isShuttingDown = false;

  constructor(
    targets: ShutdownTarget[],
    timeoutMs = 10_000,
    exitFn: (code: number) => void = process.exit.bind(process),
  ) {
    this.targets = targets;
    this.timeoutMs = timeoutMs;
    this.exitFn = exitFn;
  }

  /**
   * Orchestrate shutdown:
   * 1. Set the in-progress flag (idempotency guard).
   * 2. Start a force-exit timer.
   * 3. Close all targets concurrently; errors are logged but do not block.
   * 4. Cancel the timer and call exitFn(0).
   */
  async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log(`\n[Server] ${signal} received, shutting down gracefully...`);

    const timer = setTimeout(() => {
      console.error("[Server] Graceful shutdown timeout — forcing exit");
      this.exitFn(1);
    }, this.timeoutMs).unref();

    await Promise.allSettled(
      this.targets.map(
        (target) =>
          new Promise<void>((resolve) => {
            try {
              target.close((err) => {
                if (err) {
                  console.error("[Server] Error closing shutdown target:", err.message);
                }
                resolve();
              });
            } catch (err) {
              console.error("[Server] Exception closing shutdown target:", err);
              resolve();
            }
          }),
      ),
    );

    clearTimeout(timer);
    console.log("[Server] Shutdown complete");
    this.exitFn(0);
  }

  /** Wire SIGTERM and SIGINT to shutdown(). */
  register(): void {
    process.on("SIGTERM", () => void this.shutdown("SIGTERM"));
    process.on("SIGINT", () => void this.shutdown("SIGINT"));
  }
}
