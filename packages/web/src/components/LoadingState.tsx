import { RefreshCw } from "lucide-react";

import { Card, CardContent } from "./ui/card";

export const LoadingState = ({ label = "Loading admin overview..." }: { label?: string }) => {
  return (
    <Card className="border-primary/20 bg-card/70">
      <CardContent className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        {label}
      </CardContent>
    </Card>
  );
};
