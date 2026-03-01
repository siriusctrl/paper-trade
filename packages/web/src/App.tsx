import { useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, CircleAlert, Gauge, PieChart as PieChartIcon, RefreshCw, Search, Shield } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./components/ui/accordion";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

type PositionView = {
  market: string;
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  quoteTimestamp?: string | null;
};

type AccountView = {
  accountId: string;
  accountName: string;
  balance: number;
  positions: PositionView[];
  totals: {
    positions: number;
    marketValue: number;
    unrealizedPnl: number;
    equity: number;
  };
};

type AgentView = {
  userId: string;
  userName: string;
  accounts: AccountView[];
  totals: {
    accounts: number;
    positions: number;
    balance: number;
    marketValue: number;
    unrealizedPnl: number;
    equity: number;
  };
};

type MarketView = {
  marketId: string;
  marketName: string;
  accounts: number;
  users: number;
  positions: number;
  totalQuantity: number;
  totalMarketValue: number;
  totalUnrealizedPnl: number;
  quotedPositions: number;
  unpricedPositions: number;
};

type OverviewResponse = {
  generatedAt: string;
  totals: {
    users: number;
    accounts: number;
    positions: number;
    balance: number;
    marketValue: number;
    unrealizedPnl: number;
    equity: number;
  };
  markets: MarketView[];
  agents: AgentView[];
};

type PositionTableRow = {
  id: string;
  userId: string;
  userName: string;
  accountId: string;
  accountName: string;
  market: string;
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
};

type AgentMixRow = {
  name: string;
  value: number;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const chartPalette = ["#0e7490", "#0284c7", "#10b981", "#f59e0b", "#f97316", "#ef4444", "#14b8a6", "#1d4ed8"];

const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return currencyFormatter.format(value);
};

const formatSignedCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "N/A";
  }

  const abs = currencyFormatter.format(Math.abs(value));
  if (value > 0) {
    return `+${abs}`;
  }
  if (value < 0) {
    return `-${abs}`;
  }

  return abs;
};

const formatNumber = (value: number): string => {
  return numberFormatter.format(value);
};

const readStoredAdminKey = (): string => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem("unimarket_admin_key") ?? "";
};

const flattenPositions = (overview: OverviewResponse | null): PositionTableRow[] => {
  if (!overview) {
    return [];
  }

  return overview.agents.flatMap((agent) =>
    agent.accounts.flatMap((account) =>
      account.positions.map((position) => ({
        id: `${agent.userId}:${account.accountId}:${position.market}:${position.symbol}`,
        userId: agent.userId,
        userName: agent.userName,
        accountId: account.accountId,
        accountName: account.accountName,
        market: position.market,
        symbol: position.symbol,
        quantity: position.quantity,
        avgCost: position.avgCost,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        unrealizedPnl: position.unrealizedPnl,
      })),
    ),
  );
};

const buildAgentMix = (overview: OverviewResponse | null): AgentMixRow[] => {
  if (!overview) {
    return [];
  }

  const sorted = [...overview.agents]
    .sort((a, b) => b.totals.equity - a.totals.equity)
    .map((agent) => ({ name: agent.userName, value: Number(agent.totals.equity.toFixed(6)) }));

  if (sorted.length <= 6) {
    return sorted;
  }

  const topRows = sorted.slice(0, 6);
  const otherEquity = sorted.slice(6).reduce((sum, row) => sum + row.value, 0);

  return [...topRows, { name: "Others", value: Number(otherEquity.toFixed(6)) }];
};

const tooltipCurrencyFormatter = (value: number | string | undefined): string => {
  if (typeof value !== "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return "N/A";
    }
    return currencyFormatter.format(parsed);
  }

  return currencyFormatter.format(value);
};

const KpiCard = ({ title, value, detail }: { title: string; value: string; detail: string }) => {
  return (
    <Card className="bg-gradient-to-br from-card to-card/70">
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

export const App = () => {
  const [adminKey, setAdminKey] = useState<string>(readStoredAdminKey);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [marketFilter, setMarketFilter] = useState<string>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "marketValue", desc: true }]);

  const fetchOverview = async (silent = false): Promise<void> => {
    if (!adminKey) {
      setError("Please provide ADMIN_API_KEY to load dashboard data.");
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/admin/overview", {
        headers: {
          Authorization: `Bearer ${adminKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("Invalid admin key. Update key and retry.");
        }
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as OverviewResponse;
      setOverview(payload);
      setError(null);
    } catch (fetchError) {
      if (fetchError instanceof Error) {
        setError(fetchError.message);
      } else {
        setError("Unknown error while loading overview.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!adminKey) {
      return;
    }

    window.localStorage.setItem("unimarket_admin_key", adminKey);
    void fetchOverview();
  }, [adminKey]);

  useEffect(() => {
    if (!adminKey) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchOverview(true);
    }, 20_000);

    return () => window.clearInterval(timer);
  }, [adminKey]);

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

      const searchable = [row.userName, row.userId, row.accountName, row.accountId, row.market, row.symbol]
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedSearch);
    });
  }, [marketFilter, positionRows, search]);

  const marketChartData = useMemo(() => {
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

  const columns = useMemo<ColumnDef<PositionTableRow>[]>(
    () => [
      {
        accessorKey: "userName",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Agent
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="font-medium">{row.original.userName}</p>
            <p className="font-mono text-xs text-muted-foreground">{row.original.accountName}</p>
          </div>
        ),
      },
      {
        accessorKey: "market",
        header: () => "Market / Symbol",
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <Badge variant="secondary" className="w-fit">
              {row.original.market}
            </Badge>
            <p className="font-mono text-xs text-muted-foreground">{row.original.symbol}</p>
          </div>
        ),
      },
      {
        accessorKey: "quantity",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Quantity
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => <span>{formatNumber(row.original.quantity)}</span>,
      },
      {
        accessorKey: "avgCost",
        header: "Avg Cost",
        cell: ({ row }) => <span className="font-mono text-xs">{formatCurrency(row.original.avgCost)}</span>,
      },
      {
        accessorKey: "currentPrice",
        header: "Mark",
        cell: ({ row }) => <span className="font-mono text-xs">{formatCurrency(row.original.currentPrice)}</span>,
      },
      {
        accessorKey: "marketValue",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Value
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => <span className="font-semibold">{formatCurrency(row.original.marketValue)}</span>,
      },
      {
        accessorKey: "unrealizedPnl",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            PnL
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const value = row.original.unrealizedPnl;
          if (value === null) {
            return <span className="text-muted-foreground">N/A</span>;
          }

          return <span className={value >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatSignedCurrency(value)}</span>;
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="relative min-h-screen pb-12">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-80 w-[72rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,_hsl(196_90%_52%_/_0.16),_transparent_68%)]" />

      <main className="container relative space-y-6 pt-8">
        <Card className="border-primary/20 bg-card/80 backdrop-blur">
          <CardHeader className="gap-5 md:flex-row md:items-end md:justify-between md:space-y-0">
            <div className="space-y-2">
              <Badge variant="secondary" className="w-fit gap-1">
                <Shield className="h-3 w-3" />
                Admin Dashboard
              </Badge>
              <CardTitle className="text-3xl font-bold tracking-tight">Unimarket Portfolio Atlas</CardTitle>
              <CardDescription>
                Live market totals and user or agent holdings from <span className="font-mono">/api/admin/overview</span>
              </CardDescription>
            </div>

            <div className="w-full max-w-md space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ADMIN_API_KEY</p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={adminKey}
                  onChange={(event) => setAdminKey(event.target.value.trim())}
                  placeholder="Paste admin key"
                  className="font-mono"
                />
                <Button type="button" onClick={() => void fetchOverview()} disabled={loading || !adminKey}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Last snapshot: {generatedAtLabel}</p>
            </div>
          </CardHeader>
        </Card>

        {error ? (
          <Card className="border-destructive/40 bg-destructive/5 shadow-none">
            <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
              <CircleAlert className="h-4 w-4" />
              {error}
            </CardContent>
          </Card>
        ) : null}

        {overview ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                title="Portfolio Equity"
                value={formatCurrency(overview.totals.equity)}
                detail={`${compactFormatter.format(overview.totals.users)} users across all markets`}
              />
              <KpiCard
                title="Cash Balance"
                value={formatCurrency(overview.totals.balance)}
                detail={`${compactFormatter.format(overview.totals.accounts)} active accounts`}
              />
              <KpiCard
                title="Marked Value"
                value={formatCurrency(overview.totals.marketValue)}
                detail={`${compactFormatter.format(overview.totals.positions)} open positions`}
              />
              <KpiCard
                title="Unrealized PnL"
                value={formatSignedCurrency(overview.totals.unrealizedPnl)}
                detail="Based on latest cached market marks"
              />
            </section>

            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">
                  <Gauge className="mr-2 h-4 w-4" />
                  Market Overview
                </TabsTrigger>
                <TabsTrigger value="positions">
                  <Search className="mr-2 h-4 w-4" />
                  Position Explorer
                </TabsTrigger>
                <TabsTrigger value="agents">
                  <PieChartIcon className="mr-2 h-4 w-4" />
                  Agent Drilldown
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <section className="grid gap-4 xl:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>Market Value by Venue</CardTitle>
                      <CardDescription>Top markets by current marked exposure</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[310px]">
                      {marketChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={marketChartData} margin={{ top: 10, right: 8, left: 0, bottom: 10 }}>
                            <CartesianGrid vertical={false} strokeDasharray="3 3" />
                            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                            <YAxis tickFormatter={(value) => compactFormatter.format(value)} tick={{ fontSize: 12 }} />
                            <Tooltip formatter={tooltipCurrencyFormatter} />
                            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                              {marketChartData.map((entry, index) => (
                                <Cell key={`${entry.name}-cell`} fill={chartPalette[index % chartPalette.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          No priced market data yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Agent Equity Mix</CardTitle>
                      <CardDescription>Equity concentration across users or agents</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[310px]">
                      {agentMixData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={agentMixData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={72}
                              outerRadius={112}
                              paddingAngle={2}
                            >
                              {agentMixData.map((entry, index) => (
                                <Cell key={`${entry.name}-slice`} fill={chartPalette[index % chartPalette.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={tooltipCurrencyFormatter} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          No account equity data yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {overview.markets.map((market) => (
                    <Card key={market.marketId}>
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
                          <span className={market.totalUnrealizedPnl >= 0 ? "text-emerald-600" : "text-rose-600"}>
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
              </TabsContent>

              <TabsContent value="positions" className="space-y-4">
                <Card>
                  <CardHeader className="space-y-4">
                    <div>
                      <CardTitle>Position Explorer</CardTitle>
                      <CardDescription>Filter and sort holdings by user, account, market, and symbol.</CardDescription>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search user, account, market, symbol"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {marketOptions.map((option) => (
                          <Button
                            key={option}
                            size="sm"
                            variant={marketFilter === option ? "default" : "outline"}
                            onClick={() => setMarketFilter(option)}
                          >
                            {option}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                          <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                              <TableHead key={header.id}>
                                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                              </TableHead>
                            ))}
                          </TableRow>
                        ))}
                      </TableHeader>
                      <TableBody>
                        {table.getRowModel().rows.length > 0 ? (
                          table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id}>
                              {row.getVisibleCells().map((cell) => (
                                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                              ))}
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={columns.length} className="h-16 text-center text-muted-foreground">
                              No positions match current filters.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="agents" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Agent / User Drilldown</CardTitle>
                    <CardDescription>Inspect account-level balances and open position details.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Accordion type="single" collapsible className="w-full">
                      {overview.agents.map((agent) => (
                        <AccordionItem key={agent.userId} value={agent.userId}>
                          <AccordionTrigger>
                            <div className="flex flex-1 flex-wrap items-center justify-between gap-3 pr-2 text-left">
                              <div>
                                <p className="font-medium">{agent.userName}</p>
                                <p className="font-mono text-xs text-muted-foreground">{agent.userId}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">{agent.totals.accounts} accounts</Badge>
                                <Badge variant="secondary">{agent.totals.positions} positions</Badge>
                                <Badge variant={agent.totals.unrealizedPnl >= 0 ? "success" : "danger"}>
                                  {formatSignedCurrency(agent.totals.unrealizedPnl)}
                                </Badge>
                                <Badge>{formatCurrency(agent.totals.equity)}</Badge>
                              </div>
                            </div>
                          </AccordionTrigger>

                          <AccordionContent className="space-y-3">
                            {agent.accounts.map((account) => (
                              <Card key={account.accountId} className="shadow-none">
                                <CardHeader className="pb-2">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <CardTitle className="text-base">{account.accountName}</CardTitle>
                                      <CardDescription className="font-mono text-xs">{account.accountId}</CardDescription>
                                    </div>
                                    <div className="grid gap-1 text-right text-sm">
                                      <span>
                                        Balance: <strong>{formatCurrency(account.balance)}</strong>
                                      </span>
                                      <span>
                                        Equity: <strong>{formatCurrency(account.totals.equity)}</strong>
                                      </span>
                                    </div>
                                  </div>
                                </CardHeader>

                                <CardContent>
                                  {account.positions.length > 0 ? (
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Market</TableHead>
                                          <TableHead>Symbol</TableHead>
                                          <TableHead>Qty</TableHead>
                                          <TableHead>Avg Cost</TableHead>
                                          <TableHead>Mark</TableHead>
                                          <TableHead>Value</TableHead>
                                          <TableHead>PnL</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {account.positions.map((position) => (
                                          <TableRow key={`${account.accountId}:${position.market}:${position.symbol}`}>
                                            <TableCell>{position.market}</TableCell>
                                            <TableCell className="font-mono text-xs">{position.symbol}</TableCell>
                                            <TableCell>{formatNumber(position.quantity)}</TableCell>
                                            <TableCell>{formatCurrency(position.avgCost)}</TableCell>
                                            <TableCell>{formatCurrency(position.currentPrice)}</TableCell>
                                            <TableCell>{formatCurrency(position.marketValue)}</TableCell>
                                            <TableCell
                                              className={
                                                position.unrealizedPnl === null
                                                  ? "text-muted-foreground"
                                                  : position.unrealizedPnl >= 0
                                                    ? "text-emerald-600"
                                                    : "text-rose-600"
                                              }
                                            >
                                              {formatSignedCurrency(position.unrealizedPnl)}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">No open positions in this account.</p>
                                  )}
                                </CardContent>
                              </Card>
                            ))}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-sm text-muted-foreground">
                Enter <span className="font-mono">ADMIN_API_KEY</span> to load market totals and holdings.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};
