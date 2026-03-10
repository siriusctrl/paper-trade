import { useCallback, useEffect, useRef, useState } from "react";

import { type AdminApiClient, isAdminAuthError, type OverviewResponse } from "./admin-api";

export const useAdminOverview = ({
  client,
  enabled,
}: {
  client: AdminApiClient;
  enabled: boolean;
}) => {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Keep stale data visible if a refresh fails after the first successful load.
  const overviewRef = useRef(overview);
  overviewRef.current = overview;

  const fetchOverview = useCallback(
    async (): Promise<void> => {
      if (!enabled) {
        setError("Missing admin key. Please sign in.");
        setOverview(null);
        return;
      }

      setLoading(true);

      try {
        const payload = await client.getOverview();
        setOverview(payload);
        setError(null);
      } catch (fetchError) {
        if (isAdminAuthError(fetchError)) {
          return;
        }
        // Only show error if we have no data yet — otherwise keep stale data visible
        if (!overviewRef.current) {
          if (fetchError instanceof Error) {
            setError(fetchError.message);
          } else {
            setError("Unknown error while loading overview.");
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [client, enabled],
  );

  // Fetch once on mount
  useEffect(() => {
    if (!enabled) return;
    void fetchOverview();
  }, [enabled, fetchOverview]);

  return {
    overview,
    error,
    loading,
    refresh: fetchOverview,
  };
};
