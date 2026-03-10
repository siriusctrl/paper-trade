import type { MarketReferenceResult } from "./admin-api";

const DISCOVERY_CACHE_TTL_MS = 60_000;
const DISCOVERY_CACHE_MAX_ENTRIES = 200;

export type DiscoveryCacheRequest = {
  marketId: string;
  query: string;
  sort?: string;
  limit: number;
  offset: number;
};

export type DiscoveryCacheValue = {
  results: MarketReferenceResult[];
  hasMore: boolean;
};

type DiscoveryCacheEntry = {
  value: DiscoveryCacheValue;
  expiresAt: number;
};

const store = new Map<string, DiscoveryCacheEntry>();

const normalizeRequest = (request: DiscoveryCacheRequest) => {
  const query = request.query.trim();

  return {
    marketId: request.marketId.trim().toLowerCase(),
    query,
    sort: request.sort?.trim() ?? "",
    limit: Math.max(0, Math.trunc(request.limit)),
    offset: Math.max(0, Math.trunc(request.offset)),
  };
};

const buildKey = (request: DiscoveryCacheRequest): string => {
  const normalized = normalizeRequest(request);
  return JSON.stringify([normalized.marketId, normalized.query, normalized.sort, normalized.limit, normalized.offset]);
};

const pruneExpired = (): void => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.expiresAt) {
      store.delete(key);
    }
  }
};

const evictOverflow = (): void => {
  while (store.size > DISCOVERY_CACHE_MAX_ENTRIES) {
    const oldestKey = store.keys().next().value as string | undefined;
    if (!oldestKey) {
      return;
    }
    store.delete(oldestKey);
  }
};

export const readDiscoveryCache = (request: DiscoveryCacheRequest): DiscoveryCacheValue | null => {
  pruneExpired();

  const key = buildKey(request);
  const entry = store.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return null;
  }

  store.delete(key);
  store.set(key, entry);
  return entry.value;
};

export const writeDiscoveryCache = (request: DiscoveryCacheRequest, value: DiscoveryCacheValue): void => {
  pruneExpired();

  const key = buildKey(request);
  if (store.has(key)) {
    store.delete(key);
  }

  store.set(key, {
    value,
    expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
  });

  evictOverflow();
};

export const clearDiscoveryCacheEntry = (request: DiscoveryCacheRequest): void => {
  store.delete(buildKey(request));
};
