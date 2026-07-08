/** Per-key rate limiter used to cap how often we persist high-frequency feeds (order book, ticker). */
export class KeyedThrottle {
  private readonly lastRunAt = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  shouldRun(key: string, now = Date.now()): boolean {
    const last = this.lastRunAt.get(key) ?? 0;
    if (now - last < this.minIntervalMs) return false;
    this.lastRunAt.set(key, now);
    return true;
  }
}
