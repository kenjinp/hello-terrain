/**
 * Creates a semaphore with a given number of permits.
 * A semaphore is a concurrency primitive that controls access to a limited number of resources.
 *
 * @param {number} permits - The maximum number of concurrent permits allowed. Will be floored to an integer ≥ 1.
 * @returns An object with an `acquire` method to request a permit.
 *
 * @example
 * const sem = semaphore(2);
 * const release = await sem.acquire();
 * // critical section
 * release();
 */
export function semaphore(permits: number) {
  const floored = Number.isFinite(permits) ? Math.floor(permits) : 1;
  let available = Math.max(1, floored);
  const waiters: VoidFunction[] = [];

  /**
   * Releases a previously acquired permit, making it available to the next queued waiter (if any).
   * If any waiters are queued, the next one will be resolved immediately.
   */
  function release() {
    available += 1;
    const next = waiters.shift();
    next?.();
  }

  return {
    /**
     * Acquires a permit from the semaphore. If a permit is available, this resolves immediately.
     * Otherwise, waits until a permit is available.
     *
     * @returns A Promise that resolves to a release function. Call the release function to return the permit.
     */
    async acquire(): Promise<VoidFunction> {
      if (available > 0) {
        available -= 1;
        return () => release();
      }

      await new Promise<void>((resolve) => waiters.push(resolve));
      available -= 1;
      return () => release();
    },
  };
}
