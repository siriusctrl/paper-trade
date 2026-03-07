type CacheValue<T> = {
  value: T;
  expiresAt: number;
};

type CacheLoadOptions<T> = {
  ttlMs: number;
  load: () => T | Promise<T>;
  shouldCache?: (value: T) => boolean;
};

export class TtlCache {
  private readonly store = new Map<string, CacheValue<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1_000) {
    this.maxEntries = Math.max(1, Math.trunc(maxEntries));
  }

  get<T>(key: string): T | undefined {
    const item = this.store.get(key);
    if (!item) {
      return undefined;
    }

    if (Date.now() >= item.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return item.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) {
      this.store.delete(key);
      return;
    }

    this.pruneExpired();
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.store.delete(oldestKey);
    }
  }

  async remember<T>(key: string, options: CacheLoadOptions<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await options.load();
    if (options.shouldCache?.(value) ?? true) {
      this.set(key, value, options.ttlMs);
    }
    return value;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, item] of this.store) {
      if (now >= item.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}
