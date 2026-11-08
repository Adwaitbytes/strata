export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  /** Return false for errors that will not go away by waiting. Default: retry everything. */
  shouldRetry?: (err: unknown) => boolean;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
}

export async function retryWithBackoff<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const wait = opts.sleep ?? sleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) throw err;
      if (attempt < opts.attempts - 1) await wait(backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs));
    }
  }
  throw lastError;
}
