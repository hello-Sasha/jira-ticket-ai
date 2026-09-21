/**
 * A failure that will fail identically on every retry: a missing document, a
 * template that does not exist, malformed data.
 *
 * Retrying these burns render capacity to reach the same conclusion three
 * times, so they go straight to FAILED with a reason. Everything else - a
 * throttle, a timeout, a transient AWS error - is retryable by default.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}
