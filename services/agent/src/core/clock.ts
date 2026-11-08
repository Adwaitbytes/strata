/**
 * Monotonic wall-clock milliseconds for recorded events (PRD 9.2 step 6). If the system clock
 * steps backward (NTP), timestamps keep increasing so event order in the DB matches real order.
 */
export interface Clock {
  now(): number;
}

export class MonotonicClock implements Clock {
  #last = 0;
  readonly #source: () => number;

  constructor(source: () => number = Date.now) {
    this.#source = source;
  }

  now(): number {
    const t = Math.max(this.#source(), this.#last + 1);
    this.#last = t;
    return t;
  }
}
