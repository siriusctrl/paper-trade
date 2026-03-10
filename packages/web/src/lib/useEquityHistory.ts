import { useCallback, useEffect, useRef, useState } from "react";

import { type AdminApiClient, isAdminAuthError, type EquityHistoryResponse } from "./admin-api";

export const useEquityHistory = ({
  client,
  enabled,
  range = "1m",
}: {
  client: AdminApiClient;
  enabled: boolean;
  range?: string;
}) => {
  const [data, setData] = useState<EquityHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const fetchHistory = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setLoading(true);
    try {
      const payload = await client.getEquityHistory(range);
      setData(payload);
      setError(null);
    } catch (error) {
      if (isAdminAuthError(error)) {
        return;
      }
      if (!dataRef.current) {
        setError(error instanceof Error ? error.message : "Failed to load equity history");
      }
    } finally {
      setLoading(false);
    }
  }, [client, enabled, range]);

  useEffect(() => {
    if (!enabled) return;
    void fetchHistory();
  }, [enabled, fetchHistory]);

  return { data, loading, error, refresh: fetchHistory };
};
