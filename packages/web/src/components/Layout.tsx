import { useEffect, useState } from "react";
import { LogOut, Menu, Moon, Shield, Sun, X } from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { clearAdminKey } from "../lib/admin";
import { applyTheme, persistTheme, readStoredTheme, type ThemeMode } from "../lib/theme";

export const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    clearAdminKey();
    navigate("/login", { replace: true });
  };

  const handleThemeToggle = () => {
    setTheme((previous) => (previous === "dark" ? "light" : "dark"));
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1920px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4 lg:px-8">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/30 bg-primary/12 text-primary shadow-panel">
              <Shield className="h-5 w-5 drop-shadow-sm" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Unimarket</p>
              <p className="text-lg font-semibold leading-none">Admin Console</p>
            </div>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <Button variant="outline" size="icon" onClick={handleThemeToggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="outline" onClick={handleLogout} className="gap-2">
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>

          <Button
            variant="outline"
            size="icon"
            className="sm:hidden"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>

          <div
            className={cn(
              "w-full items-center justify-end gap-2 border-t border-border/60 pt-3 sm:hidden",
              mobileMenuOpen ? "flex animate-in fade-in-0 slide-in-from-top-1 duration-200" : "hidden",
            )}
          >
            <Button variant="outline" size="icon" onClick={handleThemeToggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="outline" onClick={handleLogout} className="gap-2">
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1920px] px-4 pb-14 pt-6 sm:px-5 sm:pb-16 sm:pt-8 lg:px-8">
        <div key={location.pathname} className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
