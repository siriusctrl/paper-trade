import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowDownUp,
    ChevronDown,
    CircleAlert,
    Loader2,
    Plus,
    RefreshCw,
    Search,
    ShoppingCart,
    TrendingDown,
    TrendingUp,
    UserPlus,
    X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import {
    clearAdminKey,
    formatCurrency,
    formatSignedCurrency,
    readStoredAdminKey,
} from "../lib/admin";

// ─── Types ───────────────────────────────────────────────────────────────────

type MarketInfo = {
    id: string;
    name: string;
    description: string;
    capabilities: string[];
};

type AssetResult = {
    symbol: string;
    name: string;
    metadata?: Record<string, unknown>;
};

type QuoteData = {
    symbol: string;
    price: number;
    bid?: number;
    ask?: number;
    timestamp: string;
};

type TradingConstraints = {
    minQuantity: number;
    quantityStep: number;
    supportsFractional: boolean;
    maxLeverage: number | null;
};

type AgentOption = {
    userId: string;
    userName: string;
    balance: number;
    equity: number;
};

type PortfolioPosition = {
    market: string;
    symbol: string;
    quantity: number;
    avgCost: number;
    currentPrice: number | null;
    marketValue: number | null;
    unrealizedPnl: number | null;
    leverage: number | null;
};

type PortfolioData = {
    userId: string;
    userName: string;
    accountId: string;
    balance: number;
    positions: PortfolioPosition[];
    openOrders: Array<{
        id: string;
        market: string;
        symbol: string;
        side: string;
        type: string;
        quantity: number;
        limitPrice: number | null;
        status: string;
        filledPrice: number | null;
        reasoning: string;
        createdAt: string;
    }>;
    recentOrders: Array<{
        id: string;
        market: string;
        symbol: string;
        side: string;
        type: string;
        quantity: number;
        limitPrice: number | null;
        status: string;
        filledPrice: number | null;
        reasoning: string;
        createdAt: string;
    }>;
};

// ─── API helpers ─────────────────────────────────────────────────────────────

const adminFetch = async (path: string, init?: RequestInit) => {
    const adminKey = readStoredAdminKey();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${adminKey}`);
    if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    return fetch(path, { ...init, headers });
};

// ─── Component ───────────────────────────────────────────────────────────────

export const TradePage = () => {
    const navigate = useNavigate();
    const adminKey = readStoredAdminKey();
    const isAuthFailure = useCallback((response: Response) => response.status === 401 || response.status === 403, []);

    // ── State ──────────────────────────────────────────────────────────────────
    const [markets, setMarkets] = useState<MarketInfo[]>([]);
    const [selectedMarket, setSelectedMarket] = useState<string>("");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<AssetResult[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<AssetResult | null>(null);
    const [quote, setQuote] = useState<QuoteData | null>(null);
    const [quoteLoading, setQuoteLoading] = useState(false);
    const [constraints, setConstraints] = useState<TradingConstraints | null>(null);

    // Agent selection
    const [agents, setAgents] = useState<AgentOption[]>([]);
    const [selectedAgent, setSelectedAgent] = useState<string>("");
    const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
    const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);

    // Create trader dialog
    const [showCreateTrader, setShowCreateTrader] = useState(false);
    const [newTraderName, setNewTraderName] = useState("");
    const [creatingTrader, setCreatingTrader] = useState(false);

    // Order form
    const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
    const [orderType, setOrderType] = useState<"market" | "limit">("market");
    const [quantity, setQuantity] = useState("");
    const [limitPrice, setLimitPrice] = useState("");
    const [leverage, setLeverage] = useState("1");
    const [reasoning, setReasoning] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [orderResult, setOrderResult] = useState<{ ok: boolean; message: string } | null>(null);

    // Error
    const [error, setError] = useState<string | null>(null);

    // Refs for search debounce
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const agentDropdownRef = useRef<HTMLDivElement>(null);

    const handleAuthError = useCallback(() => {
        clearAdminKey();
        navigate("/login", { replace: true });
    }, [navigate]);

    // ── Fetch markets ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!adminKey) return;
        void (async () => {
            try {
                const res = await adminFetch("/api/markets");
                if (res.status === 401 || res.status === 403) { handleAuthError(); return; }
                const data = await res.json();
                const mkt = (data.markets as MarketInfo[]).filter(m => m.capabilities.includes("search"));
                setMarkets(mkt);
                if (mkt.length > 0 && !selectedMarket) setSelectedMarket(mkt[0].id);
            } catch {
                setError("Failed to load markets");
            }
        })();
    }, [adminKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Fetch agents ───────────────────────────────────────────────────────────
    const fetchAgents = useCallback(async () => {
        if (!adminKey) return;
        try {
            const res = await adminFetch("/api/admin/overview");
            if (res.status === 401 || res.status === 403) { handleAuthError(); return; }
            const data = await res.json();
            const options: AgentOption[] = (data.agents as Array<{
                userId: string;
                userName: string;
                balance: number;
                totals: { equity: number };
            }>).map(a => ({
                userId: a.userId,
                userName: a.userName,
                balance: a.balance,
                equity: a.totals.equity,
            }));
            setAgents(options);
            if (options.length > 0 && !selectedAgent) setSelectedAgent(options[0].userId);
        } catch {
            setError("Failed to load agents");
        }
    }, [adminKey, handleAuthError]);

    useEffect(() => { void fetchAgents(); }, [fetchAgents]);

    // ── Close dropdown on outside click ────────────────────────────────────────
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
                setAgentDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // ── Search assets ──────────────────────────────────────────────────────────
    const doSearch = useCallback(async (query: string, market: string) => {
        if (!market) return;
        setSearchLoading(true);
        try {
            const q = query.trim();
            const res = await adminFetch(`/api/markets/${market}/search?q=${encodeURIComponent(q)}&limit=20`);
            if (isAuthFailure(res)) { handleAuthError(); return; }
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data.results as AssetResult[]);
            } else {
                setSearchResults([]);
            }
        } catch {
            // ignore
        } finally {
            setSearchLoading(false);
        }
    }, [handleAuthError, isAuthFailure]);

    // Auto-search on query change (debounced)
    useEffect(() => {
        if (!selectedMarket) return;
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

        searchTimerRef.current = setTimeout(() => {
            void doSearch(searchQuery, selectedMarket);
        }, 400);

        return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
    }, [searchQuery, selectedMarket, doSearch]);

    // ── Fetch quote + constraints when asset selected ──────────────────────────
    useEffect(() => {
        if (!selectedAsset || !selectedMarket) { setQuote(null); setConstraints(null); return; }
        setQuote(null);
        setConstraints(null);
        setQuoteLoading(true);
        let active = true;
        void (async () => {
            try {
                const [quoteRes, constraintsRes] = await Promise.all([
                    adminFetch(`/api/markets/${selectedMarket}/quote?symbol=${encodeURIComponent(selectedAsset.symbol)}`),
                    adminFetch(`/api/markets/${selectedMarket}/trading-constraints?symbol=${encodeURIComponent(selectedAsset.symbol)}`),
                ]);
                if (isAuthFailure(quoteRes) || isAuthFailure(constraintsRes)) { handleAuthError(); return; }
                if (quoteRes.ok && active) {
                    setQuote(await quoteRes.json() as QuoteData);
                } else if (active) {
                    setQuote(null);
                }
                if (constraintsRes.ok && active) {
                    const ct = await constraintsRes.json();
                    setConstraints(ct.constraints as TradingConstraints);
                } else if (active) {
                    setConstraints(null);
                }
            } catch {
                if (active) {
                    setQuote(null);
                    setConstraints(null);
                }
            } finally {
                if (active) {
                    setQuoteLoading(false);
                }
            }
        })();
        return () => {
            active = false;
        };
    }, [handleAuthError, isAuthFailure, selectedAsset, selectedMarket]);

    // ── Fetch portfolio for selected agent ─────────────────────────────────────
    useEffect(() => {
        if (!selectedAgent || !adminKey) { setPortfolio(null); return; }
        setPortfolio(null);
        void (async () => {
            try {
                const res = await adminFetch(`/api/admin/users/${selectedAgent}/portfolio`);
                if (isAuthFailure(res)) { handleAuthError(); return; }
                if (res.ok) setPortfolio(await res.json() as PortfolioData);
            } catch {
                // ignore
            }
        })();
    }, [adminKey, handleAuthError, isAuthFailure, selectedAgent]);

    // ── Refresh quote periodically ─────────────────────────────────────────────
    useEffect(() => {
        if (!selectedAsset || !selectedMarket) return;
        const interval = setInterval(async () => {
            try {
                const res = await adminFetch(`/api/markets/${selectedMarket}/quote?symbol=${encodeURIComponent(selectedAsset.symbol)}`);
                if (isAuthFailure(res)) { handleAuthError(); return; }
                if (res.ok) setQuote(await res.json() as QuoteData);
            } catch {
                // ignore
            }
        }, 5000);
        return () => clearInterval(interval);
    }, [handleAuthError, isAuthFailure, selectedAsset, selectedMarket]);

    // ── Is perp market ─────────────────────────────────────────────────────────
    const isPerpMarket = useMemo(() => {
        const market = markets.find(m => m.id === selectedMarket);
        return Boolean(market?.capabilities.includes("funding"));
    }, [markets, selectedMarket]);

    // ── Selected agent name ────────────────────────────────────────────────────
    const selectedAgentInfo = useMemo(
        () => agents.find(a => a.userId === selectedAgent),
        [agents, selectedAgent],
    );

    // ── Create trader ──────────────────────────────────────────────────────────
    const handleCreateTrader = async () => {
        if (!newTraderName.trim()) return;
        setCreatingTrader(true);
        try {
            const res = await adminFetch("/api/admin/traders", {
                method: "POST",
                body: JSON.stringify({ userName: newTraderName.trim() }),
            });
            if (isAuthFailure(res)) { handleAuthError(); return; }
            if (!res.ok) {
                const err = await res.json();
                setError(err.error?.message ?? "Failed to create trader");
                return;
            }
            const data = await res.json();
            setShowCreateTrader(false);
            setNewTraderName("");
            await fetchAgents();
            setSelectedAgent(data.userId as string);
        } catch {
            setError("Failed to create trader");
        } finally {
            setCreatingTrader(false);
        }
    };

    // ── Place order ────────────────────────────────────────────────────────────
    const handlePlaceOrder = async () => {
        if (!selectedAgent || !selectedAsset || !selectedMarket || !quantity || !reasoning.trim()) return;
        setSubmitting(true);
        setOrderResult(null);

        const body: Record<string, unknown> = {
            market: selectedMarket,
            symbol: selectedAsset.symbol,
            side: orderSide,
            type: orderType,
            quantity: Number(quantity),
            reasoning: reasoning.trim(),
        };
        if (portfolio?.accountId) {
            body.accountId = portfolio.accountId;
        }
        if (orderType === "limit" && limitPrice) {
            body.limitPrice = Number(limitPrice);
        }
        if (isPerpMarket && Number(leverage) > 1) {
            body.leverage = Number(leverage);
        }

        try {
            const idempotencyKey =
                typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : `admin-order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const res = await adminFetch(`/api/admin/users/${selectedAgent}/orders`, {
                method: "POST",
                headers: { "Idempotency-Key": idempotencyKey },
                body: JSON.stringify(body),
            });
            if (isAuthFailure(res)) { handleAuthError(); return; }
            const data = await res.json();
            if (res.ok) {
                setOrderResult({ ok: true, message: `Order ${data.status}: ${data.side} ${data.quantity} @ ${data.filledPrice ?? data.limitPrice ?? "market"}` });
                // Reset form
                setQuantity("");
                setLimitPrice("");
                setReasoning("");
                // Refresh portfolio and quote
                const [portfolioRes, quoteRes] = await Promise.all([
                    adminFetch(`/api/admin/users/${selectedAgent}/portfolio`),
                    adminFetch(`/api/markets/${selectedMarket}/quote?symbol=${encodeURIComponent(selectedAsset.symbol)}`),
                ]);
                if (isAuthFailure(portfolioRes) || isAuthFailure(quoteRes)) { handleAuthError(); return; }
                if (portfolioRes.ok) setPortfolio(await portfolioRes.json() as PortfolioData);
                if (quoteRes.ok) setQuote(await quoteRes.json() as QuoteData);
            } else {
                setOrderResult({ ok: false, message: data.error?.message ?? "Order failed" });
            }
        } catch {
            setOrderResult({ ok: false, message: "Network error" });
        } finally {
            setSubmitting(false);
        }
    };

    // ── Select asset ───────────────────────────────────────────────────────────
    const handleSelectAsset = (asset: AssetResult) => {
        setSelectedAsset(asset);
        setQuote(null);
        setConstraints(null);
        setQuoteLoading(true);
        setOrderResult(null);
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-5">
            {/* Header */}
            <Card className="border-primary/25 bg-card/55 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-1 duration-300">
                <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between md:space-y-0">
                    <div className="space-y-2">
                        <Badge variant="secondary" className="w-fit gap-1 border border-border/40">
                            <ShoppingCart className="h-3 w-3" />
                            Manual Trading
                        </Badge>
                        <CardTitle className="text-3xl font-bold tracking-tight sm:text-4xl">Trade</CardTitle>
                        <CardDescription>
                            Browse markets, search assets, and place trades on behalf of any agent or trader.
                        </CardDescription>
                    </div>

                    {/* Agent selector */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div ref={agentDropdownRef} className="relative">
                            <Button
                                id="agent-selector"
                                variant="outline"
                                className="gap-2 min-w-[200px] justify-between"
                                onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                            >
                                <span className="truncate max-w-[160px]">
                                    {selectedAgentInfo ? selectedAgentInfo.userName : "Select agent…"}
                                </span>
                                <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                            </Button>
                            {agentDropdownOpen && (
                                <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-border/70 bg-popover/98 p-1 shadow-panel-strong backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-1 duration-150">
                                    <div className="max-h-60 overflow-y-auto">
                                        {agents.map(agent => (
                                            <button
                                                key={agent.userId}
                                                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent/60 ${selectedAgent === agent.userId ? "bg-accent/50 font-medium" : ""
                                                    }`}
                                                onClick={() => {
                                                    setSelectedAgent(agent.userId);
                                                    setAgentDropdownOpen(false);
                                                }}
                                            >
                                                <span className="truncate">{agent.userName}</span>
                                                <span className="text-xs text-muted-foreground font-mono ml-2">
                                                    {formatCurrency(agent.balance)}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="border-t border-border/50 mt-1 pt-1">
                                        <button
                                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-primary transition-colors hover:bg-accent/60"
                                            onClick={() => { setShowCreateTrader(true); setAgentDropdownOpen(false); }}
                                        >
                                            <UserPlus className="h-3.5 w-3.5" />
                                            Create Trader
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </CardHeader>
            </Card>

            {/* Create Trader Dialog */}
            {showCreateTrader && (
                <Card className="border-primary/30 bg-card/70 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-1 duration-200">
                    <CardContent className="pt-5">
                        <div className="flex items-end gap-3">
                            <div className="flex-1">
                                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Trader Name
                                </label>
                                <Input
                                    id="new-trader-name"
                                    value={newTraderName}
                                    onChange={e => setNewTraderName(e.target.value)}
                                    placeholder="e.g. alice, manual-trader-1"
                                    onKeyDown={e => { if (e.key === "Enter") void handleCreateTrader(); }}
                                />
                            </div>
                            <Button onClick={handleCreateTrader} disabled={creatingTrader || !newTraderName.trim()} className="gap-2">
                                {creatingTrader ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Create
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => setShowCreateTrader(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Error */}
            {error && (
                <Card className="border-destructive/40 bg-destructive/10 shadow-none animate-in fade-in-0 duration-200">
                    <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
                        <CircleAlert className="h-4 w-4" />
                        {error}
                        <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setError(null)}>
                            Dismiss
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Main layout: 2-column */}
            <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
                {/* Left column: Market tabs + Search + Results */}
                <div className="space-y-4">
                    {/* Market tabs */}
                    <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/50 bg-muted/50 p-1">
                        {markets.map(market => (
                            <Button
                                key={market.id}
                                variant={selectedMarket === market.id ? "default" : "ghost"}
                                size="sm"
                                className="h-8 text-xs capitalize"
                                onClick={() => {
                                    setSelectedMarket(market.id);
                                    setSelectedAsset(null);
                                    setQuote(null);
                                    setConstraints(null);
                                    setQuoteLoading(false);
                                    setSearchResults([]);
                                    setSearchQuery("");
                                    setOrderResult(null);
                                }}
                            >
                                {market.name}
                            </Button>
                        ))}
                    </div>

                    {/* Search */}
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                id="asset-search"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder={`Search ${markets.find(m => m.id === selectedMarket)?.name ?? "market"}…`}
                                className="pl-9"
                                onKeyDown={e => { if (e.key === "Enter") { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); void doSearch(searchQuery, selectedMarket); } }}
                            />
                            {searchLoading && (
                                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                            )}
                        </div>
                        <Button
                            id="btn-search"
                            variant="outline"
                            className="gap-1.5 shrink-0"
                            onClick={() => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); void doSearch(searchQuery, selectedMarket); }}
                            disabled={searchLoading}
                        >
                            <Search className="h-4 w-4" />
                            Search
                        </Button>
                    </div>

                    {/* Search results */}
                    <div className="space-y-2">
                        {searchResults.length === 0 && !searchLoading && (
                            <Card className="bg-card/30">
                                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                                    {searchQuery ? "No assets found." : "Enter a search query or browse assets above."}
                                </CardContent>
                            </Card>
                        )}
                        {searchResults.map(asset => (
                            <Card
                                key={asset.symbol}
                                className={`cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${selectedAsset?.symbol === asset.symbol
                                    ? "border-primary/40 bg-primary/5"
                                    : "bg-card/40 hover:bg-card/60"
                                    }`}
                                onClick={() => handleSelectAsset(asset)}
                            >
                                <CardContent className="flex items-center justify-between py-3">
                                    <div className="min-w-0">
                                        <p className="font-medium text-sm truncate">{asset.name}</p>
                                        <p className="text-xs text-muted-foreground font-mono truncate max-w-[360px]">
                                            {asset.symbol}
                                        </p>
                                    </div>
                                    {selectedAsset?.symbol === asset.symbol && (
                                        <Badge variant="secondary" className="shrink-0 text-xs">Selected</Badge>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>

                {/* Right column: Quote + Order form + Portfolio */}
                <div className="space-y-4">
                    {/* Agent Balance Card */}
                    {selectedAgentInfo && (
                        <Card className="bg-card/55 border-border/60 animate-in fade-in-0 duration-200">
                            <CardContent className="py-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Trading as</p>
                                        <p className="font-medium">{selectedAgentInfo.userName}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-muted-foreground">Balance</p>
                                        <p className="text-lg font-semibold font-mono">{formatCurrency(portfolio?.balance ?? selectedAgentInfo.balance)}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Quote */}
                    {selectedAsset ? (
                        <Card className="border-primary/25 bg-card/55 backdrop-blur-xl animate-in fade-in-0 duration-200">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div className="min-w-0 flex-1">
                                        <CardTitle className="text-lg truncate">{selectedAsset.name}</CardTitle>
                                        <CardDescription className="font-mono text-xs truncate">{selectedAsset.symbol}</CardDescription>
                                    </div>
                                    {quoteLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {quote && (
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="rounded-lg bg-muted/50 p-2.5 text-center">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Price</p>
                                            <p className="text-lg font-bold font-mono">{quote.price.toFixed(quote.price < 1 ? 4 : 2)}</p>
                                        </div>
                                        <div className="rounded-lg bg-emerald-500/10 p-2.5 text-center">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Bid</p>
                                            <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                                                {(quote.bid ?? quote.price).toFixed(quote.price < 1 ? 4 : 2)}
                                            </p>
                                        </div>
                                        <div className="rounded-lg bg-rose-500/10 p-2.5 text-center">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">Ask</p>
                                            <p className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400">
                                                {(quote.ask ?? quote.price).toFixed(quote.price < 1 ? 4 : 2)}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {constraints && (
                                    <div className="flex flex-wrap gap-2 text-[10px]">
                                        <Badge variant="outline" className="gap-1 font-mono text-[10px]">
                                            Min: {constraints.minQuantity}
                                        </Badge>
                                        <Badge variant="outline" className="gap-1 font-mono text-[10px]">
                                            Step: {constraints.quantityStep}
                                        </Badge>
                                        {constraints.supportsFractional && (
                                            <Badge variant="outline" className="text-[10px]">Fractional ✓</Badge>
                                        )}
                                        {constraints.maxLeverage && (
                                            <Badge variant="outline" className="font-mono text-[10px]">
                                                Max Lev: {constraints.maxLeverage}×
                                            </Badge>
                                        )}
                                    </div>
                                )}

                                {/* ── Order Form ─────────────────────────────── */}
                                <div className="space-y-3 border-t border-border/50 pt-4">
                                    {/* Side toggle */}
                                    <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border/50 p-1">
                                        <Button
                                            id="btn-buy"
                                            variant={orderSide === "buy" ? "default" : "ghost"}
                                            size="sm"
                                            className={`h-9 gap-1.5 ${orderSide === "buy" ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600" : ""}`}
                                            onClick={() => setOrderSide("buy")}
                                        >
                                            <TrendingUp className="h-3.5 w-3.5" />
                                            Buy
                                        </Button>
                                        <Button
                                            id="btn-sell"
                                            variant={orderSide === "sell" ? "default" : "ghost"}
                                            size="sm"
                                            className={`h-9 gap-1.5 ${orderSide === "sell" ? "bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600" : ""}`}
                                            onClick={() => setOrderSide("sell")}
                                        >
                                            <TrendingDown className="h-3.5 w-3.5" />
                                            Sell
                                        </Button>
                                    </div>

                                    {/* Type toggle */}
                                    <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border/50 p-1">
                                        <Button
                                            variant={orderType === "market" ? "default" : "ghost"}
                                            size="sm"
                                            className="h-8 text-xs"
                                            onClick={() => setOrderType("market")}
                                        >
                                            Market
                                        </Button>
                                        <Button
                                            variant={orderType === "limit" ? "default" : "ghost"}
                                            size="sm"
                                            className="h-8 text-xs"
                                            onClick={() => setOrderType("limit")}
                                        >
                                            Limit
                                        </Button>
                                    </div>

                                    {/* Quantity */}
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Quantity
                                        </label>
                                        <Input
                                            id="order-quantity"
                                            type="number"
                                            value={quantity}
                                            onChange={e => setQuantity(e.target.value)}
                                            placeholder={constraints ? `Min ${constraints.minQuantity}` : "0"}
                                            step={constraints?.quantityStep ?? 1}
                                            min={constraints?.minQuantity ?? 0}
                                        />
                                    </div>

                                    {/* Limit price */}
                                    {orderType === "limit" && (
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Limit Price
                                            </label>
                                            <Input
                                                id="order-limit-price"
                                                type="number"
                                                value={limitPrice}
                                                onChange={e => setLimitPrice(e.target.value)}
                                                placeholder="0.00"
                                                step="any"
                                                min="0"
                                            />
                                        </div>
                                    )}

                                    {/* Leverage (perp only) */}
                                    {isPerpMarket && (
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Leverage {constraints?.maxLeverage ? `(max ${constraints.maxLeverage}×)` : ""}
                                            </label>
                                            <Input
                                                id="order-leverage"
                                                type="number"
                                                value={leverage}
                                                onChange={e => setLeverage(e.target.value)}
                                                placeholder="1"
                                                step="1"
                                                min="1"
                                                max={constraints?.maxLeverage ?? 100}
                                            />
                                        </div>
                                    )}

                                    {/* Reasoning */}
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Reasoning
                                        </label>
                                        <textarea
                                            id="order-reasoning"
                                            value={reasoning}
                                            onChange={e => setReasoning(e.target.value)}
                                            placeholder="Why are you making this trade?"
                                            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                                            rows={2}
                                        />
                                    </div>

                                    {/* Order cost preview */}
                                    {quote && quantity && Number(quantity) > 0 && (
                                        <div className="rounded-lg bg-muted/40 p-2.5 text-xs space-y-1">
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Estimated cost</span>
                                                <span className="font-mono font-medium">
                                                    {formatCurrency(
                                                        Number(quantity) * (orderType === "limit" && limitPrice ? Number(limitPrice) : (orderSide === "buy" ? (quote.ask ?? quote.price) : (quote.bid ?? quote.price)))
                                                    )}
                                                </span>
                                            </div>
                                            {isPerpMarket && Number(leverage) > 1 && (
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Margin required</span>
                                                    <span className="font-mono font-medium">
                                                        {formatCurrency(
                                                            Number(quantity) * (orderSide === "buy" ? (quote.ask ?? quote.price) : (quote.bid ?? quote.price)) / Number(leverage)
                                                        )}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Submit */}
                                    <Button
                                        id="btn-place-order"
                                        className={`w-full gap-2 h-11 text-sm font-semibold ${orderSide === "buy"
                                            ? "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                                            : "bg-rose-600 hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600"
                                            }`}
                                        disabled={submitting || !selectedAgent || !quantity || !reasoning.trim() || (orderType === "limit" && !limitPrice)}
                                        onClick={handlePlaceOrder}
                                    >
                                        {submitting ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <ArrowDownUp className="h-4 w-4" />
                                        )}
                                        {orderSide === "buy" ? "Buy" : "Sell"} {orderType === "limit" ? "Limit" : "Market"}
                                    </Button>

                                    {/* Order result */}
                                    {orderResult && (
                                        <div
                                            className={`rounded-lg p-3 text-sm ${orderResult.ok
                                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                                                : "bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30"
                                                }`}
                                        >
                                            {orderResult.message}
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="bg-card/30 border-border/40">
                            <CardContent className="py-16 text-center">
                                <ArrowDownUp className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                                <p className="text-sm text-muted-foreground">Select an asset from the search results to start trading.</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Portfolio positions */}
                    {portfolio && portfolio.positions.length > 0 && (
                        <Card className="bg-card/45 border-border/50 animate-in fade-in-0 duration-200">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Open Positions</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {portfolio.positions.slice(0, 8).map(pos => (
                                    <div
                                        key={`${pos.market}:${pos.symbol}`}
                                        className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-xs"
                                    >
                                        <div className="min-w-0">
                                            <p className="font-mono font-medium truncate max-w-[140px]">{pos.symbol}</p>
                                            <p className="text-muted-foreground capitalize">{pos.market}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-mono">{pos.quantity} @ {pos.avgCost.toFixed(2)}</p>
                                            {pos.unrealizedPnl !== null && (
                                                <p
                                                    className={
                                                        pos.unrealizedPnl >= 0
                                                            ? "text-emerald-600 dark:text-emerald-400"
                                                            : "text-rose-600 dark:text-rose-400"
                                                    }
                                                >
                                                    {formatSignedCurrency(pos.unrealizedPnl)}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {portfolio.positions.length > 8 && (
                                    <p className="text-[10px] text-muted-foreground text-center">
                                        +{portfolio.positions.length - 8} more positions
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Open orders */}
                    {portfolio && portfolio.openOrders.length > 0 && (
                        <Card className="bg-card/45 border-border/50 animate-in fade-in-0 duration-200">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Open Orders</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {portfolio.openOrders.slice(0, 10).map(order => (
                                    <div
                                        key={order.id}
                                        className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-xs"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Badge
                                                variant="outline"
                                                className={`text-[10px] px-1.5 ${order.side === "buy"
                                                    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                                                    : "border-rose-500/40 text-rose-600 dark:text-rose-400"
                                                    }`}
                                            >
                                                {order.side.toUpperCase()}
                                            </Badge>
                                            <span className="font-mono truncate max-w-[100px]">{order.symbol}</span>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-mono">{order.quantity} @ {order.limitPrice?.toFixed(2) ?? "—"}</p>
                                            <p className="text-muted-foreground capitalize">{order.status}</p>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    {/* Recent orders */}
                    {portfolio && portfolio.recentOrders.length > 0 && (
                        <Card className="bg-card/45 border-border/50 animate-in fade-in-0 duration-200">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Recent Orders</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {portfolio.recentOrders.slice(0, 10).map(order => (
                                    <div
                                        key={order.id}
                                        className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-xs"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Badge
                                                variant="outline"
                                                className={`text-[10px] px-1.5 ${order.side === "buy"
                                                    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                                                    : "border-rose-500/40 text-rose-600 dark:text-rose-400"
                                                    }`}
                                            >
                                                {order.side.toUpperCase()}
                                            </Badge>
                                            <span className="font-mono truncate max-w-[100px]">{order.symbol}</span>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-mono">{order.quantity} @ {order.filledPrice?.toFixed(2) ?? order.limitPrice?.toFixed(2) ?? "—"}</p>
                                            <p className="text-muted-foreground capitalize">{order.status}</p>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
};
