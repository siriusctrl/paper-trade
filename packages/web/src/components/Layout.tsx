import { LogOut, Shield } from "lucide-react";
import { Outlet, useNavigate } from "react-router-dom";

import { Button } from "./ui/button";
import { clearAdminKey } from "../lib/admin";

export const Layout = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAdminKey();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-primary/10 bg-card/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Unimarket</p>
              <p className="text-lg font-semibold">Admin Console</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleLogout} className="gap-2">
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1360px] px-5 pb-16 pt-8">
        <Outlet />
      </main>
    </div>
  );
};
