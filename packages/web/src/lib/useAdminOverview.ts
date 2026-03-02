import { useCallback, useEffect, useState } from "react";

import { type OverviewResponse } from "./admin";

const AUTH_ERROR_MESSAGE = "Invalid admin key. Please sign in again.";

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

  const fetchOverview = useCallback(
    async (silent = false): Promise<void> => {
      if (!adminKey) {
        setError("Missing admin key. Please sign in.");
        setOverview(null);
        return;
      }

      if (!silent) {
        setLoading(true);
      }

      try {
        const response = await fetch("/api/admin/overview", {
          headers: {
            Authorization: `Bearer ${adminKey}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            onAuthError();
            throw new Error(AUTH_ERROR_MESSAGE);
          }
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as OverviewResponse;
        setOverview(payload);
        setError(null);
      } catch (fetchError) {
        if (fetchError instanceof Error) {
          setError(fetchError.message);
        } else {
          setError("Unknown error while loading overview.");
        }
      } finally {
        setLoading(false);
      }
    },
    [adminKey, onAuthError],
  );

  useEffect(() => {
    if (!adminKey) {
      return;
    }

    void fetchOverview();
  }, [adminKey, fetchOverview]);

  useEffect(() => {
    if (!adminKey) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchOverview(true);
    }, 20_000);

    return () => window.clearInterval(timer);
  }, [adminKey, fetchOverview]);

  return {
    overview,
    error,
    loading,
    refresh: () => fetchOverview(false),
  };
};
