import { useCallback, useEffect, useRef, useState } from "react";

import { type AdminApiClient, type MarketInfo, type MarketReferenceResult, isAdminAuthError } from "./admin-api";
import {
  clearDiscoveryCacheEntry,
  readDiscoveryCache,
  type DiscoveryCacheRequest,
  writeDiscoveryCache,
} from "./discovery-cache";

const DISCOVERY_PAGE_SIZE = 20;

const mergeReferences = (
  previous: MarketReferenceResult[],
  incoming: MarketReferenceResult[],
): MarketReferenceResult[] => {
  const merged = new Map(previous.map((item) => [item.reference, item] as const));
  for (const item of incoming) {
    merged.set(item.reference, item);
  }
  return Array.from(merged.values());
};

export const useMarketDiscovery = ({
  client,
  selectedMarket,
  selectedMarketInfo,
  onError,
}: {
  client: AdminApiClient;
  selectedMarket: string;
  selectedMarketInfo: MarketInfo | null;
  onError: (message: string) => void;
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [browseSort, setBrowseSort] = useState("");
  const [searchSort, setSearchSort] = useState("");
  const [results, setResults] = useState<MarketReferenceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const discoveryRequestRef = useRef(0);

  const discoveryMode = searchQuery.trim().length > 0 ? "search" : "browse";
  const activeSort = discoveryMode === "search" ? (searchSort || undefined) : (browseSort || undefined);

  const loadDiscoveries = useCallback(
    async ({
      marketId,
      query,
      sort,
      offset = 0,
      append = false,
      force = false,
    }: {
      marketId: string;
      query: string;
      sort?: string;
      offset?: number;
      append?: boolean;
      force?: boolean;
    }) => {
      if (!marketId) {
        return;
      }

      const requestId = ++discoveryRequestRef.current;
      const trimmedQuery = query.trim();
      const cacheRequest: DiscoveryCacheRequest = {
        marketId,
        query: trimmedQuery,
        sort,
        limit: DISCOVERY_PAGE_SIZE,
        offset,
      };
      const cached = force ? null : readDiscoveryCache(cacheRequest);
      const shouldShowLoader = force || cached === null;

      if (force) {
        clearDiscoveryCacheEntry(cacheRequest);
      }

      if (cached) {
        setResults((previous) => (append ? mergeReferences(previous, cached.results) : cached.results));
        setHasMore(cached.hasMore);
        setLoading(false);
        setLoadingMore(false);
      }

      if (shouldShowLoader) {
        if (append) {
          setLoadingMore(true);
          setLoading(false);
        } else {
          setLoading(true);
          setLoadingMore(false);
        }
      }

      try {
        const payload = trimmedQuery
          ? await client.searchMarketReferences(marketId, trimmedQuery, DISCOVERY_PAGE_SIZE, offset, sort)
          : await client.browseMarketReferences(marketId, sort, DISCOVERY_PAGE_SIZE, offset);

        writeDiscoveryCache(cacheRequest, {
          results: payload.results,
          hasMore: payload.hasMore,
        });

        if (requestId !== discoveryRequestRef.current) {
          return;
        }

        setResults((previous) => (append ? mergeReferences(previous, payload.results) : payload.results));
        setHasMore(payload.hasMore);
      } catch (searchError) {
        if (requestId !== discoveryRequestRef.current) {
          return;
        }
        if (isAdminAuthError(searchError)) {
          return;
        }
        if (!cached && !append) {
          setResults([]);
          setHasMore(false);
        }
        if (!cached || force) {
          onError(searchError instanceof Error ? searchError.message : "Failed to load market references");
        }
      } finally {
        if (requestId === discoveryRequestRef.current) {
          if (append) {
            setLoadingMore(false);
          } else {
            setLoading(false);
          }
        }
      }
    },
    [client, onError],
  );

  useEffect(() => {
    const browseOptions = selectedMarketInfo?.browseOptions ?? [];
    if (browseOptions.length === 0) {
      if (browseSort !== "") {
        setBrowseSort("");
      }
      return;
    }

    if (!browseOptions.some((option) => option.value === browseSort)) {
      setBrowseSort(browseOptions[0]?.value ?? "");
    }
  }, [browseSort, selectedMarketInfo]);

  useEffect(() => {
    const searchSortOptions = selectedMarketInfo?.searchSortOptions ?? [];
    if (searchSort.length === 0) {
      return;
    }

    if (!searchSortOptions.some((option) => option.value === searchSort)) {
      setSearchSort("");
    }
  }, [searchSort, selectedMarketInfo]);

  useEffect(() => {
    if (!selectedMarket) {
      return;
    }

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length === 0) {
      void loadDiscoveries({ marketId: selectedMarket, query: "", sort: activeSort });
      return;
    }

    searchTimerRef.current = setTimeout(() => {
      void loadDiscoveries({ marketId: selectedMarket, query: trimmedQuery, sort: activeSort });
    }, 350);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [activeSort, loadDiscoveries, searchQuery, selectedMarket]);

  const reset = useCallback(() => {
    setResults([]);
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
    setSearchQuery("");
  }, []);

  const refresh = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    void loadDiscoveries({
      marketId: selectedMarket,
      query: searchQuery.trim(),
      sort: activeSort,
      force: true,
    });
  }, [activeSort, loadDiscoveries, searchQuery, selectedMarket]);

  const loadMore = useCallback(() => {
    void loadDiscoveries({
      marketId: selectedMarket,
      query: searchQuery.trim(),
      sort: activeSort,
      offset: results.length,
      append: true,
    });
  }, [activeSort, loadDiscoveries, results.length, searchQuery, selectedMarket]);

  return {
    searchQuery,
    setSearchQuery,
    browseSort,
    setBrowseSort,
    searchSort,
    setSearchSort,
    results,
    loading,
    loadingMore,
    hasMore,
    reset,
    refresh,
    loadMore,
  };
};
