import { useMemo, useState } from "react";
import { ArrowUpRight, CircleAlert, RefreshCw, Search, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { KpiCard } from "../components/KpiCard";
import { LoadingState } from "../components/LoadingState";
import { MarketCharts } from "../components/MarketCharts";
import { PositionsTable } from "../components/PositionsTable";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import {
  buildAgentMix,
  chartPalette,
  clearAdminKey,
  flattenPositions,
  formatCompactNumber,
  formatCurrency,
  formatNumber,
  formatSignedCurrency,
  type MarketChartRow,
  readStoredAdminKey,
} from "../lib/admin";
import { useAdminOverview } from "../lib/useAdminOverview";

export const DashboardPage = () => {
  const navigate = useNavigate();
  const adminKey = readStoredAdminKey();
  const [search, setSearch] = useState<string>("");
  const [marketFilter, setMarketFilter] = useState<string>("all");

  const handleAuthError = () => {
    clearAdminKey();
    navigate("/login", { replace: true });
  };

  const { overview, error, loading, refresh } = useAdminOverview({ adminKey, onAuthError: handleAuthError });

  const generatedAtLabel = useMemo(() => {
    if (!overview?.generatedAt) {
      return "-";
    }

    return new Date(overview.generatedAt).toLocaleString();
  }, [overview?.generatedAt]);

  const positionRows = useMemo(() => flattenPositions(overview), [overview]);

  const marketOptions = useMemo(() => {
    const set = new Set(positionRows.map((row) => row.market));
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [positionRows]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return positionRows.filter((row) => {
      const matchesMarket = marketFilter === "all" || row.market === marketFilter;
      if (!matchesMarket) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const searchable = [row.userName, row.userId, row.accountName ?? "", row.market, row.symbol]
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedSearch);
    });
  }, [marketFilter, positionRows, search]);

  const marketChartData = useMemo<MarketChartRow[]>(() => {
    if (!overview) {
      return [];
    }

    return [...overview.markets]
      .sort((a, b) => b.totalMarketValue - a.totalMarketValue)
      .slice(0, 8)
      .map((market) => ({
        name: market.marketName,
        value: Number(market.totalMarketValue.toFixed(2)),
        pnl: Number(market.totalUnrealizedPnl.toFixed(2)),
      }));
  }, [overview]);

  const agentMixData = useMemo(() => buildAgentMix(overview), [overview]);

  if (loading && !overview) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/25 bg-card/55 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-1 duration-300">
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between md:space-y-0">
          <div className="space-y-2">
            <Badge variant="secondary" className="w-fit gap-1 border border-border/40">
              <Users className="h-3 w-3" />
              Admin Overview
            </Badge>
            <CardTitle className="text-3xl font-bold tracking-tight sm:text-4xl">Unimarket Portfolio Atlas</CardTitle>
            <CardDescription>
              Live market totals and user holdings from <span className="font-mono">/api/admin/overview</span>
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:justify-end">
            <div className="text-xs text-muted-foreground md:text-right">
              <p className="font-semibold uppercase tracking-wide">Last snapshot</p>
              <p>{generatedAtLabel}</p>
            </div>
            <Button type="button" onClick={refresh} disabled={loading} className="gap-2">
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </Button>
          </div>
        </CardHeader>
      </Card>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/10 shadow-none animate-in fade-in-0 duration-200">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <CircleAlert className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      ) : null}

      {overview ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            <KpiCard
              title="Portfolio Equity"
              value={formatCurrency(overview.totals.equity)}
              detail={`${formatCompactNumber(overview.totals.users)} users across all markets`}
            />
            <KpiCard title="Cash Balance" value={formatCurrency(overview.totals.balance)} detail="Single account per user" />
            <KpiCard
              title="Marked Value"
              value={formatCurrency(overview.totals.marketValue)}
              detail={`${formatCompactNumber(overview.totals.positions)} open positions`}
            />
            <KpiCard
              title="Unrealized PnL"
              value={formatSignedCurrency(overview.totals.unrealizedPnl)}
              detail="Based on latest cached market marks"
            />
          </section>

          <MarketCharts marketChartData={marketChartData} agentMixData={agentMixData} />

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {overview.markets.map((market, index) => (
              <Card key={market.marketId} className="relative overflow-hidden bg-card/50 hover:-translate-y-0.5 hover:border-primary/30">
                <div
                  className="pointer-events-none absolute right-0 top-0 h-24 w-24 -translate-y-8 translate-x-8 rounded-full opacity-30 blur-sm"
                  style={{ backgroundColor: chartPalette[index % chartPalette.length] }}
                />
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{market.marketName}</CardTitle>
                  <CardDescription className="font-mono text-xs">{market.marketId}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Market Value</span>
                    <span className="font-semibold">{formatCurrency(market.totalMarketValue)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Unrealized PnL</span>
                    <span
                      className={
                        market.totalUnrealizedPnl >= 0
                          ? "font-medium text-emerald-600 dark:text-emerald-400"
                          : "font-medium text-rose-600 dark:text-rose-400"
                      }
                    >
                      {formatSignedCurrency(market.totalUnrealizedPnl)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Users</span>
                    <span>{formatNumber(market.users)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Positions</span>
                    <span>{formatNumber(market.positions)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr] animate-in fade-in-0 duration-300">
            <Card className="bg-card/55 hover:border-primary/30">
              <CardHeader>
                <CardTitle>Position Explorer</CardTitle>
                <CardDescription>Filter and sort holdings by user, market, and symbol.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search user, market, symbol"
                      className="pl-9"
                    />
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {marketOptions.map((option) => (
                      <Button
                        key={option}
                        size="sm"
                        variant={marketFilter === option ? "default" : "outline"}
                        className="shrink-0"
                        onClick={() => setMarketFilter(option)}
                      >
                        {option}
                      </Button>
                    ))}
                  </div>
                </div>

                <PositionsTable rows={filteredRows} />
              </CardContent>
            </Card>

            <Card className="bg-card/55 hover:border-primary/30">
              <CardHeader>
                <CardTitle>Agent Summary</CardTitle>
                <CardDescription>Click any agent to view balances and positions.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Positions</TableHead>
                      <TableHead>Equity</TableHead>
                      <TableHead>PnL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.agents.map((agent) => (
                      <TableRow
                        key={agent.userId}
                        className="cursor-pointer transition-all duration-200 hover:bg-accent/60"
                        onClick={() => navigate(`/agents/${agent.userId}`)}
                      >
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-medium">{agent.userName}</p>
                            <p className="font-mono text-xs text-muted-foreground">{agent.userId}</p>
                          </div>
                        </TableCell>
                        <TableCell>{formatNumber(agent.totals.positions)}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(agent.totals.equity)}</TableCell>
                        <TableCell
                          className={
                            agent.totals.unrealizedPnl >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }
                        >
                          {formatSignedCurrency(agent.totals.unrealizedPnl)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {overview.agents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                          No agent accounts found.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Showing {overview.agents.length} agents</span>
                  <div className="flex items-center gap-2">
                    <ArrowUpRight className="h-3 w-3" />
                    Click an agent row to drill down.
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : (
        <Card className="bg-card/55">
          <CardContent className="py-16 text-center">
            <p className="text-sm text-muted-foreground">Admin overview not available yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
