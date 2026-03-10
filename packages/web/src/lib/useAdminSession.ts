import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { clearAdminKey, readStoredAdminKey } from "./admin";
import { createAdminApiClient } from "./admin-api";

export const useAdminSession = () => {
  const navigate = useNavigate();
  const adminKey = readStoredAdminKey();

  const logout = useCallback(() => {
    clearAdminKey();
    navigate("/login", { replace: true });
  }, [navigate]);

  const client = useMemo(
    () =>
      createAdminApiClient({
        adminKey,
        onAuthError: logout,
      }),
    [adminKey, logout],
  );

  return {
    adminKey,
    client,
  };
};
