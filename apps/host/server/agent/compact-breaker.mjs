/**
 * The compaction breaker (HARNESS_ROADMAP 阶段一 H2): automatic summarizing that fails the same chat's window three times in a row is
 * stopped, and the chat is told once; it stays usable — the next message goes through as it is. A success closes the breaker and the
 * count starts again. Pure state, one chat per key; the bridge feeds it and decides.
 */
export class CompactBreaker {
  /** @param {{compactFailures?: number}} [limits] 0 turns the breaker off. */
  constructor({ compactFailures = 3 } = {}) {
    this.limit = Math.max(0, Math.floor(Number(compactFailures) || 0));
    this.streaks = new Map();
  }

  #streak(sessionId) {
    let n = this.streaks.get(sessionId) ?? 0;
    if (!this.streaks.has(sessionId)) this.streaks.set(sessionId, n);
    return n;
  }

  /** A summarizing attempt failed for this chat. */
  failure(sessionId) {
    if (this.limit <= 0) return;
    this.streaks.set(sessionId, this.#streak(sessionId) + 1);
  }

  /** A summarizing attempt worked (or the person ran /compact by hand): the count starts again. */
  success(sessionId) { this.streaks.delete(sessionId); }

  /** True when the next automatic attempt should be skipped and the person told once. */
  blocked(sessionId) {
    return this.limit > 0 && this.#streak(sessionId) >= this.limit;
  }
}
