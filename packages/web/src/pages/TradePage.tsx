import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { AgentPicker } from "../components/trade/AgentPicker";
import { CreateTraderCard } from "../components/trade/CreateTraderCard";
import { MarketSearchPanel } from "../components/trade/MarketSearchPanel";
import { PortfolioPanels } from "../components/trade/PortfolioPanels";
import { TradeTicketCard } from "../components/trade/TradeTicketCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { clearAdminKey, readStoredAdminKey } from "../lib/admin";
import {
  AdminApiError,
  createAdminApiClient,
  type AgentOption,
  type MarketInfo,
  type MarketReferenceResult,
  type PlaceOrderInput,
  type PortfolioData,
  type QuoteData,
  type TradingConstraints,
  isAdminAuthError,
} from "../lib/admin-api";

type OrderResult = { ok: boolean; message: string } | null;

const DISCOVERY_PAGE_SIZE = 20;

const getErrorMessage = (error: unknown, fallback: string): string => {
  return error instanceof Error ? error.message : fallback;
};

const mergeReferences = (
  previous: MarketReferenceResult[],
  incoming: MarketReferenceResult[],
): MarketReferenceResult[] => {
  const merged = new Map(previous.map((item) => [item.reference, item] as const));
  for (const item of incoming) {
    merged.set(item.reference, item);
  }
  return Array.from(merged.values());
};

export const TradePage = () => {
  const navigate = useNavigate();
  const adminKey = readStoredAdminKey();
  const client = useMemo(
    () =>
      createAdminApiClient({
        adminKey,
        onAuthError: () => {
          clearAdminKey();
          navigate("/login", { replace: true });
        },
      }),
    [adminKey, navigate],
  );

  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [selectedMarket, setSelectedMarket] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [browseSort, setBrowseSort] = useState("");
  const [searchResults, setSearchResults] = useState<MarketReferenceResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<MarketReferenceResult | null>(null);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [constraints, setConstraints] = useState<TradingConstraints | null>(null);

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);

  const [showCreateTrader, setShowCreateTrader] = useState(false);
  const [newTraderName, setNewTraderName] = useState("");
  const [creatingTrader, setCreatingTrader] = useState(false);

  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [reasoning, setReasoning] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<OrderResult>(null);

  const [error, setError] = useState<string | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  const discoveryRequestRef = useRef(0);

  const selectedAgentInfo = useMemo(
    () => agents.find((agent) => agent.userId === selectedAgent) ?? null,
    [agents, selectedAgent],
  );

  const selectedMarketInfo = useMemo(
    () => markets.find((entry) => entry.id === selectedMarket) ?? null,
    [markets, selectedMarket],
  );

  const isPerpMarket = Boolean(selectedMarketInfo?.capabilities.includes("funding"));
  const discoveryMode = searchQuery.trim().length > 0 ? "search" : "browse";

  const canSubmit = Boolean(
    !submitting &&
    selectedAgent &&
    selectedAsset &&
    quantity &&
    reasoning.trim() &&
    (orderType !== "limit" || limitPrice),
  );

  const clearSelectionState = useCallback(() => {
    setSelectedAsset(null);
    setQuote(null);
    setConstraints(null);
    setQuoteLoading(false);
    setSearchResults([]);
    setHasMoreResults(false);
    setSearchQuery("");
    setOrderResult(null);
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const overview = await client.getOverview();
      const nextAgents: AgentOption[] = overview.agents.map((agent) => ({
        userId: agent.userId,
        userName: agent.userName,
        balance: agent.balance,
        equity: agent.totals.equity,
      }));
      setAgents(nextAgents);
      if (nextAgents.length > 0 && !selectedAgent) {
        setSelectedAgent(nextAgents[0].userId);
      }
    } catch (fetchError) {
      if (!isAdminAuthError(fetchError)) {
        setError(getErrorMessage(fetchError, "Failed to load agents"));
      }
    }
  }, [client, selectedAgent]);

  const loadDiscoveries = useCallback(
    async ({
      marketId,
      query,
      sort,
      offset = 0,
      append = false,
    }: {
      marketId: string;
      query: string;
      sort?: string;
      offset?: number;
      append?: boolean;
    }) => {
      if (!marketId) {
        return;
      }

      const requestId = ++discoveryRequestRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setSearchLoading(true);
      }

      try {
        const trimmedQuery = query.trim();
        const payload = trimmedQuery
          ? await client.searchMarketReferences(marketId, trimmedQuery, DISCOVERY_PAGE_SIZE, offset)
          : await client.browseMarketReferences(marketId, sort, DISCOVERY_PAGE_SIZE, offset);

        if (requestId !== discoveryRequestRef.current) {
          return;
        }

        setSearchResults((previous) => (append ? mergeReferences(previous, payload.results) : payload.results));
        setHasMoreResults(payload.results.length === DISCOVERY_PAGE_SIZE);
      } catch (searchError) {
        if (requestId !== discoveryRequestRef.current) {
          return;
        }
        if (isAdminAuthError(searchError)) {
          return;
        }
        if (!append) {
          setSearchResults([]);
          setHasMoreResults(false);
        }
        setError(getErrorMessage(searchError, "Failed to load market references"));
      } finally {
        if (requestId === discoveryRequestRef.current) {
          if (append) {
            setLoadingMore(false);
          } else {
            setSearchLoading(false);
          }
        }
      }
    },
    [client],
  );

  useEffect(() => {
    if (!adminKey) {
      return;
    }

    void (async () => {
      try {
        const payload = await client.getMarkets();
        const discoverableMarkets = payload.markets.filter((market) =>
          market.capabilities.includes("search") || market.capabilities.includes("browse"),
        );
        setMarkets(discoverableMarkets);
        if (discoverableMarkets.length > 0 && !selectedMarket) {
          setSelectedMarket(discoverableMarkets[0].id);
        }
      } catch (fetchError) {
        if (!isAdminAuthError(fetchError)) {
          setError(getErrorMessage(fetchError, "Failed to load markets"));
        }
      }
    })();
  }, [adminKey, client, selectedMarket]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(event.target as Node)) {
        setAgentDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const browseOptions = selectedMarketInfo?.browseOptions ?? [];
    if (browseOptions.length === 0) {
      if (browseSort !== "") {
        setBrowseSort("");
      }
      return;
    }

    if (!browseOptions.some((option) => option.value === browseSort)) {
      setBrowseSort(browseOptions[0]?.value ?? "");
    }
  }, [browseSort, selectedMarketInfo]);

  useEffect(() => {
    if (!selectedMarket) {
      return;
    }

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length === 0) {
      void loadDiscoveries({ marketId: selectedMarket, query: "", sort: browseSort });
      return;
    }

    searchTimerRef.current = setTimeout(() => {
      void loadDiscoveries({ marketId: selectedMarket, query: trimmedQuery, sort: browseSort });
    }, 350);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [browseSort, loadDiscoveries, searchQuery, selectedMarket]);

  useEffect(() => {
    if (!selectedAsset || !selectedMarket) {
      setQuote(null);
      setConstraints(null);
      return;
    }

    setQuote(null);
    setConstraints(null);
    setQuoteLoading(true);
    let active = true;

    void (async () => {
      try {
        const [nextQuote, constraintsResponse] = await Promise.all([
          client.getQuote(selectedMarket, selectedAsset.reference),
          client.getTradingConstraints(selectedMarket, selectedAsset.reference),
        ]);

        if (!active) {
          return;
        }

        setQuote(nextQuote);
        setConstraints(constraintsResponse.constraints);
      } catch (fetchError) {
        if (!active) {
          return;
        }

        setQuote(null);
        setConstraints(null);
        if (!isAdminAuthError(fetchError)) {
          setError(getErrorMessage(fetchError, "Failed to load quote"));
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
  }, [client, selectedAsset, selectedMarket]);

  useEffect(() => {
    if (!selectedAgent || !adminKey) {
      setPortfolio(null);
      return;
    }

    setPortfolio(null);
    void (async () => {
      try {
        setPortfolio(await client.getUserPortfolio(selectedAgent));
      } catch (fetchError) {
        if (!isAdminAuthError(fetchError)) {
          setError(getErrorMessage(fetchError, "Failed to load portfolio"));
        }
      }
    })();
  }, [adminKey, client, selectedAgent]);

  useEffect(() => {
    if (!selectedAsset || !selectedMarket) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        setQuote(await client.getQuote(selectedMarket, selectedAsset.reference));
      } catch (fetchError) {
        if (!isAdminAuthError(fetchError)) {
          setQuote(null);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [client, selectedAsset, selectedMarket]);

  const handleCreateTrader = async () => {
    if (!newTraderName.trim()) {
      return;
    }

    setCreatingTrader(true);
    try {
      const createdTrader = await client.createTrader(newTraderName.trim());
      setShowCreateTrader(false);
      setNewTraderName("");
      await fetchAgents();
      setSelectedAgent(createdTrader.userId);
      setError(null);
    } catch (createError) {
      if (!isAdminAuthError(createError)) {
        setError(getErrorMessage(createError, "Failed to create trader"));
      }
    } finally {
      setCreatingTrader(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (!selectedAgent || !selectedAsset || !selectedMarket || !quantity || !reasoning.trim()) {
      return;
    }

    setSubmitting(true);
    setOrderResult(null);

    const order: PlaceOrderInput = {
      market: selectedMarket,
      reference: selectedAsset.reference,
      side: orderSide,
      type: orderType,
      quantity: Number(quantity),
      reasoning: reasoning.trim(),
      ...(portfolio?.accountId ? { accountId: portfolio.accountId } : {}),
      ...(orderType === "limit" && limitPrice ? { limitPrice: Number(limitPrice) } : {}),
      ...(isPerpMarket && Number(leverage) > 1 ? { leverage: Number(leverage) } : {}),
    };

    try {
      const createdOrder = await client.placeUserOrder(selectedAgent, order);
      setOrderResult({
        ok: true,
        message: `Order ${createdOrder.status}: ${createdOrder.side} ${createdOrder.quantity} @ ${createdOrder.filledPrice ?? createdOrder.limitPrice ?? "market"}`,
      });
      setQuantity("");
      setLimitPrice("");
      setReasoning("");

      const [nextPortfolio, nextQuote] = await Promise.all([
        client.getUserPortfolio(selectedAgent),
        client.getQuote(selectedMarket, selectedAsset.reference),
      ]);
      setPortfolio(nextPortfolio);
      setQuote(nextQuote);
      setError(null);
    } catch (placeError) {
      if (!isAdminAuthError(placeError)) {
        const message =
          placeError instanceof AdminApiError ? placeError.message : "Order failed";
        setOrderResult({ ok: false, message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectAsset = (asset: MarketReferenceResult) => {
    setSelectedAsset(asset);
    setQuote(null);
    setConstraints(null);
    setQuoteLoading(true);
    setOrderResult(null);
  };

  return (
    <div className="space-y-5">
      <Card className="animate-in fade-in-0 slide-in-from-top-1 border-primary/25 bg-card/55 backdrop-blur-xl duration-300">
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between md:space-y-0">
          <div className="space-y-2">
            <Badge variant="secondary" className="w-fit gap-1 border border-border/40">
              <ShoppingCart className="h-3 w-3" />
              Manual Trading
            </Badge>
            <CardTitle className="text-3xl font-bold tracking-tight sm:text-4xl">Trade</CardTitle>
            <CardDescription>
              Browse live market references, inspect quotes, and place trades on behalf of any agent or trader.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AgentPicker
              agents={agents}
              selectedAgentId={selectedAgent}
              selectedAgentName={selectedAgentInfo?.userName ?? null}
              open={agentDropdownOpen}
              dropdownRef={agentDropdownRef}
              onToggle={() => setAgentDropdownOpen((open) => !open)}
              onSelect={(userId) => {
                setSelectedAgent(userId);
                setAgentDropdownOpen(false);
              }}
              onCreateTrader={() => {
                setShowCreateTrader(true);
                setAgentDropdownOpen(false);
              }}
            />
          </div>
        </CardHeader>
      </Card>

      <CreateTraderCard
        open={showCreateTrader}
        name={newTraderName}
        creating={creatingTrader}
        onNameChange={setNewTraderName}
        onCreate={() => void handleCreateTrader()}
        onClose={() => setShowCreateTrader(false)}
      />

      {error ? (
        <Card className="animate-in fade-in-0 border-destructive/40 bg-destructive/10 shadow-none duration-200">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <CircleAlert className="h-4 w-4" />
            {error}
            <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_420px]">
        <MarketSearchPanel
          markets={markets}
          selectedMarket={selectedMarket}
          selectedAsset={selectedAsset}
          searchQuery={searchQuery}
          searchResults={searchResults}
          searchLoading={searchLoading}
          browseSort={browseSort}
          browseOptions={selectedMarketInfo?.browseOptions ?? []}
          hasMoreResults={hasMoreResults}
          loadingMore={loadingMore}
          onSelectMarket={(marketId) => {
            setSelectedMarket(marketId);
            clearSelectionState();
          }}
          onSearchQueryChange={setSearchQuery}
          onSearch={() => {
            if (searchTimerRef.current) {
              clearTimeout(searchTimerRef.current);
            }
            void loadDiscoveries({
              marketId: selectedMarket,
              query: searchQuery.trim(),
              sort: browseSort,
            });
          }}
          onBrowseSortChange={(nextSort) => {
            setBrowseSort(nextSort);
          }}
          onLoadMore={() => {
            void loadDiscoveries({
              marketId: selectedMarket,
              query: searchQuery.trim(),
              sort: browseSort,
              offset: searchResults.length,
              append: true,
            });
          }}
          onSelectAsset={handleSelectAsset}
        />

        <div className="space-y-4">
          <TradeTicketCard
            selectedAsset={selectedAsset}
            quote={quote}
            quoteLoading={quoteLoading}
            constraints={constraints}
            isPerpMarket={isPerpMarket}
            orderSide={orderSide}
            orderType={orderType}
            quantity={quantity}
            limitPrice={limitPrice}
            leverage={leverage}
            reasoning={reasoning}
            submitting={submitting}
            orderResult={orderResult}
            onOrderSideChange={setOrderSide}
            onOrderTypeChange={setOrderType}
            onQuantityChange={setQuantity}
            onLimitPriceChange={setLimitPrice}
            onLeverageChange={setLeverage}
            onReasoningChange={setReasoning}
            onSubmit={() => void handlePlaceOrder()}
            canSubmit={canSubmit}
          />

          <PortfolioPanels selectedAgent={selectedAgentInfo} portfolio={portfolio} />
        </div>
      </div>
    </div>
  );
};
