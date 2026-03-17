import { ArrowDownUp, Loader2, ShoppingCart, TrendingDown, TrendingUp } from "lucide-react";

import { PriceChart, type CandlePoint, type TradeMarker } from "./PriceChart";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { formatCurrency } from "../../lib/admin";
import {
  describeFundingDirection,
  formatAnnualizedFundingRate,
  formatFundingCadence,
  formatFundingRate,
  formatFundingTime,
} from "../../lib/funding";
import type { FundingPreview, MarketReferenceResult, PriceHistoryInterval, QuoteData, TradingConstraints } from "../../lib/admin-api";

type OrderResult = { ok: boolean; message: string } | null;

export const TradeTicketCard = ({
  selectedAsset,
  quote,
  quoteLoading,
  constraints,
  fundingPreview,
  isPerpMarket,
  buyLabel,
  sellLabel,
  executionSide,
  selectionHint,
  submitLabel,
  orderSide,
  orderType,
  quantity,
  limitPrice,
  leverage,
  reasoning,
  submitting,
  orderResult,
  candles,
  tradeMarkers,
  chartLoading,
  chartInterval,
  chartIntervals,
  onOrderSideChange,
  onOrderTypeChange,
  onQuantityChange,
  onLimitPriceChange,
  onLeverageChange,
  onReasoningChange,
  onSubmit,
  canSubmit,
  onChartIntervalChange,
}: {
  selectedAsset: MarketReferenceResult | null;
  quote: QuoteData | null;
  quoteLoading: boolean;
  constraints: TradingConstraints | null;
  fundingPreview: FundingPreview | null;
  isPerpMarket: boolean;
  buyLabel: string;
  sellLabel: string;
  executionSide: "buy" | "sell";
  selectionHint: string | null;
  submitLabel: string;
  orderSide: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: string;
  limitPrice: string;
  leverage: string;
  reasoning: string;
  submitting: boolean;
  orderResult: OrderResult;
  candles: CandlePoint[];
  tradeMarkers: TradeMarker[];
  chartLoading: boolean;
  chartInterval: PriceHistoryInterval;
  chartIntervals: PriceHistoryInterval[];
  onOrderSideChange: (side: "buy" | "sell") => void;
  onOrderTypeChange: (type: "market" | "limit") => void;
  onQuantityChange: (value: string) => void;
  onLimitPriceChange: (value: string) => void;
  onLeverageChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  onChartIntervalChange: (interval: PriceHistoryInterval) => void;
}) => {
  if (!selectedAsset) {
    return (
      <Card className="border-border/40 bg-card/30">
        <CardContent className="flex items-center gap-3 py-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/40">
            <ArrowDownUp className="h-4 w-4 text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">No asset selected</p>
            <p className="text-xs text-muted-foreground/50">Pick a market from the left to start trading.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const numericQuantity = Number(quantity);
  const executablePrice = quote
    ? orderType === "limit" && limitPrice
      ? Number(limitPrice)
      : executionSide === "buy"
        ? (quote.ask ?? quote.price)
        : (quote.bid ?? quote.price)
    : null;
  const fundingRateTone = fundingPreview
    ? fundingPreview.rate > 0
      ? "text-rose-600 dark:text-rose-400"
      : fundingPreview.rate < 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground"
    : "text-muted-foreground";

  return (
    <Card className="animate-in fade-in-0 border-primary/25 bg-card/55 backdrop-blur-xl duration-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-lg">{selectedAsset.name}</CardTitle>
            <CardDescription className="truncate font-mono text-xs">{selectedAsset.reference}</CardDescription>
          </div>
          {quoteLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Price chart */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Price History</span>
            <div className="flex gap-0.5 rounded border border-border/40 p-0.5">
              {chartIntervals.map((iv) => (
                <button
                  key={iv}
                  type="button"
                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase transition-colors ${chartInterval === iv
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                  onClick={() => onChartIntervalChange(iv)}
                >
                  {iv}
                </button>
              ))}
            </div>
          </div>
          <PriceChart candles={candles} loading={chartLoading} interval={chartInterval} />
        </div>

        {quote ? (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/50 p-2.5 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Price</p>
              <p className="font-mono text-lg font-bold">{quote.price.toFixed(quote.price < 1 ? 4 : 2)}</p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-2.5 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Bid</p>
              <p className="font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {(quote.bid ?? quote.price).toFixed(quote.price < 1 ? 4 : 2)}
              </p>
            </div>
            <div className="rounded-lg bg-rose-500/10 p-2.5 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">Ask</p>
              <p className="font-mono text-lg font-bold text-rose-600 dark:text-rose-400">
                {(quote.ask ?? quote.price).toFixed(quote.price < 1 ? 4 : 2)}
              </p>
            </div>
          </div>
        ) : null}

        {constraints ? (
          <div className="flex flex-wrap gap-2 text-[10px]">
            <Badge variant="outline" className="gap-1 font-mono text-[10px]">
              Min: {constraints.minQuantity}
            </Badge>
            <Badge variant="outline" className="gap-1 font-mono text-[10px]">
              Step: {constraints.quantityStep}
            </Badge>
            {constraints.supportsFractional ? <Badge variant="outline" className="text-[10px]">Fractional ✓</Badge> : null}
            {constraints.maxLeverage ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                Max Lev: {constraints.maxLeverage}×
              </Badge>
            ) : null}
          </div>
        ) : null}

        {isPerpMarket ? (
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Funding</p>
                <p className="text-sm font-medium text-foreground">
                  {describeFundingDirection(fundingPreview?.direction, fundingPreview?.rate)}
                </p>
              </div>
              <span className={`font-mono text-sm font-semibold ${fundingRateTone}`}>
                {fundingPreview ? formatFundingRate(fundingPreview.rate) : "N/A"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {fundingPreview
                ? `Next funding ${formatFundingTime(fundingPreview.nextFundingAt)}.`
                : "Funding preview is currently unavailable for this contract."}
            </p>
            {fundingPreview?.annualizedRate !== undefined ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {`Reference APR ${formatAnnualizedFundingRate(fundingPreview.annualizedRate)} based on ${formatFundingCadence(fundingPreview.intervalHours)} funding cadence.`}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3 border-t border-border/50 pt-4">
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border/50 p-1">
            <Button
              id="btn-buy"
              variant={orderSide === "buy" ? "default" : "ghost"}
              size="sm"
              className={`h-9 gap-1.5 ${orderSide === "buy" ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600" : ""}`}
              onClick={() => onOrderSideChange("buy")}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              {buyLabel}
            </Button>
            <Button
              id="btn-sell"
              variant={orderSide === "sell" ? "default" : "ghost"}
              size="sm"
              className={`h-9 gap-1.5 ${orderSide === "sell" ? "bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600" : ""}`}
              onClick={() => onOrderSideChange("sell")}
            >
              <TrendingDown className="h-3.5 w-3.5" />
              {sellLabel}
            </Button>
          </div>
          {selectionHint ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {selectionHint}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border/50 p-1">
            <Button
              variant={orderType === "market" ? "default" : "ghost"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => onOrderTypeChange("market")}
            >
              Market
            </Button>
            <Button
              variant={orderType === "limit" ? "default" : "ghost"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => onOrderTypeChange("limit")}
            >
              Limit
            </Button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quantity
            </label>
            <Input
              id="order-quantity"
              type="number"
              value={quantity}
              onChange={(event) => onQuantityChange(event.target.value)}
              placeholder={constraints ? `Min ${constraints.minQuantity}` : "0"}
              step={constraints?.quantityStep ?? 1}
              min={constraints?.minQuantity ?? 0}
            />
          </div>

          {orderType === "limit" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Limit Price
              </label>
              <Input
                id="order-limit-price"
                type="number"
                value={limitPrice}
                onChange={(event) => onLimitPriceChange(event.target.value)}
                placeholder="0.00"
                step="any"
                min="0"
              />
            </div>
          ) : null}

          {isPerpMarket ? (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Leverage {constraints?.maxLeverage ? `(max ${constraints.maxLeverage}×)` : ""}
              </label>
              <Input
                id="order-leverage"
                type="number"
                value={leverage}
                onChange={(event) => onLeverageChange(event.target.value)}
                placeholder="1"
                step="1"
                min="1"
                max={constraints?.maxLeverage ?? 100}
              />
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Reasoning
            </label>
            <textarea
              id="order-reasoning"
              value={reasoning}
              onChange={(event) => onReasoningChange(event.target.value)}
              placeholder="Why are you making this trade?"
              className="flex min-h-[60px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              rows={2}
            />
          </div>

          {quote && quantity && numericQuantity > 0 && executablePrice !== null ? (
            <div className="space-y-1 rounded-lg bg-muted/40 p-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated cost</span>
                <span className="font-mono font-medium">
                  {formatCurrency(numericQuantity * executablePrice)}
                </span>
              </div>
              {isPerpMarket && Number(leverage) > 1 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Margin required</span>
                  <span className="font-mono font-medium">
                    {formatCurrency((numericQuantity * executablePrice) / Number(leverage))}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          <Button
            id="btn-place-order"
            className={`h-11 w-full gap-2 text-sm font-semibold ${orderSide === "buy"
              ? "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
              : "bg-rose-600 hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600"
              }`}
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            {submitLabel} {orderType === "limit" ? "Limit" : "Market"}
          </Button>

          {orderResult ? (
            <div
              className={`rounded-lg border p-3 text-sm ${orderResult.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                }`}
            >
              {orderResult.message}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};
