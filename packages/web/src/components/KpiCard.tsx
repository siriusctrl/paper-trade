import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export const KpiCard = ({ title, value, detail }: { title: string; value: string; detail: string }) => {
  return (
    <Card className="group relative overflow-hidden border-border/80 bg-card/55 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-panel-strong">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-primary/12 to-transparent opacity-70" />
      <CardHeader className="pb-1">
        <CardDescription className="text-[11px] font-semibold uppercase tracking-[0.16em]">{title}</CardDescription>
        <CardTitle className="text-3xl font-semibold tracking-tight sm:text-[2rem]">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
};
