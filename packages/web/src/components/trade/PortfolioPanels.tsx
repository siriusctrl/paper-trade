import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { formatCurrency, formatSignedCurrency } from "../../lib/admin";
import type { AgentOption, PortfolioData } from "../../lib/admin-api";

export const PortfolioPanels = ({
  selectedAgent,
  portfolio,
}: {
  selectedAgent: AgentOption | null;
  portfolio: PortfolioData | null;
}) => {
  if (!selectedAgent) {
    return null;
  }

  return (
    <>
      <Card className="animate-in fade-in-0 border-border/60 bg-card/55 duration-200">
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trading as</p>
              <p className="font-medium">{selectedAgent.userName}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Balance</p>
              <p className="font-mono text-lg font-semibold">{formatCurrency(portfolio?.balance ?? selectedAgent.balance)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {portfolio && portfolio.positions.length > 0 ? (
        <Card className="animate-in fade-in-0 border-border/50 bg-card/45 duration-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Open Positions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {portfolio.positions.slice(0, 8).map((position) => (
              <div
                key={`${position.market}:${position.symbol}`}
                className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="max-w-[140px] truncate font-mono font-medium">{position.symbol}</p>
                  <p className="capitalize text-muted-foreground">{position.market}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono">
                    {position.quantity} @ {position.avgCost.toFixed(2)}
                  </p>
                  {position.unrealizedPnl !== null ? (
                    <p className={position.unrealizedPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                      {formatSignedCurrency(position.unrealizedPnl)}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            {portfolio.positions.length > 8 ? (
              <p className="text-center text-[10px] text-muted-foreground">+{portfolio.positions.length - 8} more positions</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {portfolio && portfolio.openOrders.length > 0 ? (
        <Card className="animate-in fade-in-0 border-border/50 bg-card/45 duration-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Open Orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {portfolio.openOrders.slice(0, 10).map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`px-1.5 text-[10px] ${
                      order.side === "buy"
                        ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : "border-rose-500/40 text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {order.side.toUpperCase()}
                  </Badge>
                  <span className="max-w-[100px] truncate font-mono">{order.symbol}</span>
                </div>
                <div className="text-right">
                  <p className="font-mono">
                    {order.quantity} @ {order.limitPrice?.toFixed(2) ?? "—"}
                  </p>
                  <p className="capitalize text-muted-foreground">{order.status}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {portfolio && portfolio.recentOrders.length > 0 ? (
        <Card className="animate-in fade-in-0 border-border/50 bg-card/45 duration-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent Orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {portfolio.recentOrders.slice(0, 10).map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`px-1.5 text-[10px] ${
                      order.side === "buy"
                        ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : "border-rose-500/40 text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {order.side.toUpperCase()}
                  </Badge>
                  <span className="max-w-[100px] truncate font-mono">{order.symbol}</span>
                </div>
                <div className="text-right">
                  <p className="font-mono">
                    {order.quantity} @ {order.filledPrice?.toFixed(2) ?? order.limitPrice?.toFixed(2) ?? "—"}
                  </p>
                  <p className="capitalize text-muted-foreground">{order.status}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
};
