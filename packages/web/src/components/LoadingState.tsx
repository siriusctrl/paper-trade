import { RefreshCw } from "lucide-react";

import { Card, CardContent } from "./ui/card";

export const LoadingState = ({ label = "Loading admin overview..." }: { label?: string }) => {
  return (
    <Card className="border-primary/25 bg-card/55 animate-in fade-in-0 duration-300">
      <CardContent className="flex items-center justify-center gap-3 py-14 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin text-primary" />
        {label}
      </CardContent>
    </Card>
  );
};
