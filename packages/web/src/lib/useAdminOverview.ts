import { useCallback, useEffect, useRef, useState } from "react";

import { createAdminApiClient, isAdminAuthError, type OverviewResponse } from "./admin-api";

export const useAdminOverview = ({
  adminKey,
  onAuthError,
}: {
  adminKey: string;
  onAuthError: () => void;
}) => {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Use refs to avoid re-creating fetchOverview when callbacks change
  const overviewRef = useRef(overview);
  overviewRef.current = overview;
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;

  const fetchOverview = useCallback(
    async (): Promise<void> => {
      if (!adminKey) {
        setError("Missing admin key. Please sign in.");
        setOverview(null);
        return;
      }

      setLoading(true);

      try {
        const client = createAdminApiClient({ adminKey, onAuthError: () => onAuthErrorRef.current() });
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
    [adminKey],
  );

  // Fetch once on mount
  useEffect(() => {
    if (!adminKey) return;
    void fetchOverview();
  }, [adminKey, fetchOverview]);

  return {
    overview,
    error,
    loading,
    refresh: fetchOverview,
  };
};
