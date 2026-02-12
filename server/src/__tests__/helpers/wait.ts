/**
 * Async Test Helpers
 * Utilities for handling async operations in tests
 */

import { EventEmitter } from "events";

/**
 * Wait for event with timeout
 * @param emitter - EventEmitter to listen on
 * @param event - Event name to wait for
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves with event data
 */
export function waitForEvent<T = any>(
  emitter: EventEmitter,
  event: string,
  timeoutMs: number = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      emitter.removeListener(event, handler);
      reject(new Error(`Timeout waiting for event: ${event} (${timeoutMs}ms)`));
    }, timeoutMs);

    const handler = (data: T) => {
      clearTimeout(timeout);
      resolve(data);
    };

    emitter.once(event, handler);
  });
}

/**
 * Wait for multiple events in order
 * @param emitter - EventEmitter to listen on
 * @param events - Array of event names to wait for
 * @param timeoutMs - Timeout in milliseconds per event
 * @returns Promise that resolves with array of event data
 */
export async function waitForEvents<T = any>(
  emitter: EventEmitter,
  events: string[],
  timeoutMs: number = 5000,
): Promise<T[]> {
  const results: T[] = [];

  for (const event of events) {
    const data = await waitForEvent<T>(emitter, event, timeoutMs);
    results.push(data);
  }

  return results;
}

/**
 * Wait for condition to be true
 * @param condition - Function that returns boolean
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @param intervalMs - Check interval in milliseconds (default: 10)
 * @returns Promise that resolves when condition is true
 */
export function waitForCondition(
  condition: () => boolean,
  timeoutMs: number = 5000,
  intervalMs: number = 10,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for condition (${timeoutMs}ms)`));
      } else {
        setTimeout(check, intervalMs);
      }
    };

    check();
  });
}

/**
 * Sleep for specified duration
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for next tick
 */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => process.nextTick(resolve));
}
