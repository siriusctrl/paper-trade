import { useEffect, useState } from "react";
import { KeyRound, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { readStoredAdminKey, storeAdminKey } from "../lib/admin";

export const LoginPage = () => {
  const navigate = useNavigate();
  const [adminKey, setAdminKey] = useState<string>(readStoredAdminKey);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (readStoredAdminKey()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = adminKey.trim();

    if (!trimmed) {
      setError("Enter your admin key to continue.");
      return;
    }

    storeAdminKey(trimmed);
    setError(null);
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-28 top-[-80px] h-80 w-80 rounded-full bg-primary/18 blur-3xl" />
        <div className="absolute -right-24 bottom-[-120px] h-96 w-96 rounded-full bg-cyan-400/15 blur-3xl dark:bg-sky-400/22" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,hsl(var(--background)_/_0.2),hsl(var(--background)_/_0.75))]" />
      </div>

      <div className="relative grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden flex-col justify-center rounded-3xl border border-border/65 bg-card/45 p-9 backdrop-blur-xl lg:flex animate-in fade-in-0 slide-in-from-left-2 duration-500">
          <Badge variant="outline" className="mb-5 w-fit gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Secure Admin Access
          </Badge>
          <h1 className="max-w-lg text-4xl font-bold leading-tight tracking-tight text-balance">
            Portfolio command center for multi-market paper trading.
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Inspect exposure, compare market concentration, and drill into agent-level holdings in one place with a
            fully simulated execution model.
          </p>
          <div className="mt-8 space-y-3 text-xs text-muted-foreground">
            <p className="font-semibold uppercase tracking-[0.18em]">What you get</p>
            <p>Unified totals across markets and users</p>
            <p>Sortable position explorer with drill-down navigation</p>
            <p>No exchange keys required for core paper workflows</p>
          </div>
        </section>

        <Card className="relative w-full border-primary/25 bg-card/58 shadow-panel-strong backdrop-blur-2xl animate-in fade-in-0 zoom-in-95 duration-300">
          <CardHeader className="space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/35 bg-primary/18 text-primary shadow-panel">
              <Shield className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-2xl font-semibold">Unimarket Admin</CardTitle>
              <CardDescription>Sign in with your admin key to access the live overview.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Admin Key</label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="password"
                    value={adminKey}
                    onChange={(event) => setAdminKey(event.target.value)}
                    placeholder="Paste admin key"
                    className="pl-9 font-mono"
                  />
                </div>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full">
                Continue to dashboard
              </Button>
            </form>
            <p className="mt-4 text-xs text-muted-foreground">
              Keys are stored locally in your browser. Logging out clears local key data.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
