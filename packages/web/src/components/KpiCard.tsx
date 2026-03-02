import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export const KpiCard = ({ title, value, detail }: { title: string; value: string; detail: string }) => {
  return (
    <Card className="bg-gradient-to-br from-card to-card/70 shadow-panel">
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl font-semibold tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
};
