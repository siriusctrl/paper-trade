import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "../components/ui/button";
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
    <div className="relative flex min-h-screen items-center justify-center px-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_hsl(197_92%_55%_/_0.18),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-white/60 to-transparent" />

      <Card className="relative w-full max-w-md border-primary/20 bg-card/80 shadow-panel backdrop-blur">
        <CardHeader className="space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl font-semibold">Unimarket Admin</CardTitle>
          <CardDescription>Sign in with your admin key to access the live overview.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Admin Key</label>
              <Input
                type="password"
                value={adminKey}
                onChange={(event) => setAdminKey(event.target.value)}
                placeholder="Paste admin key"
                className="font-mono"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full">
              Continue to dashboard
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Keys are stored locally in your browser. Log out to clear them.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
