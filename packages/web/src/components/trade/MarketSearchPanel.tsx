import { Loader2, Search } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import type { AssetResult, MarketInfo } from "../../lib/admin-api";

export const MarketSearchPanel = ({
  markets,
  selectedMarket,
  selectedAsset,
  searchQuery,
  searchResults,
  searchLoading,
  onSelectMarket,
  onSearchQueryChange,
  onSearch,
  onSelectAsset,
}: {
  markets: MarketInfo[];
  selectedMarket: string;
  selectedAsset: AssetResult | null;
  searchQuery: string;
  searchResults: AssetResult[];
  searchLoading: boolean;
  onSelectMarket: (marketId: string) => void;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  onSelectAsset: (asset: AssetResult) => void;
}) => {
  const selectedMarketName = markets.find((market) => market.id === selectedMarket)?.name ?? "market";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/50 bg-muted/50 p-1">
        {markets.map((market) => (
          <Button
            key={market.id}
            variant={selectedMarket === market.id ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs capitalize"
            onClick={() => onSelectMarket(market.id)}
          >
            {market.name}
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="asset-search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={`Search ${selectedMarketName}…`}
            className="pl-9"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSearch();
              }
            }}
          />
          {searchLoading ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        <Button
          id="btn-search"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={onSearch}
          disabled={searchLoading}
        >
          <Search className="h-4 w-4" />
          Search
        </Button>
      </div>

      <div className="space-y-2">
        {searchResults.length === 0 && !searchLoading ? (
          <Card className="bg-card/30">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {searchQuery ? "No assets found." : "Enter a search query or browse assets above."}
            </CardContent>
          </Card>
        ) : null}
        {searchResults.map((asset) => (
          <Card
            key={asset.symbol}
            className={`cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
              selectedAsset?.symbol === asset.symbol ? "border-primary/40 bg-primary/5" : "bg-card/40 hover:bg-card/60"
            }`}
            onClick={() => onSelectAsset(asset)}
          >
            <CardContent className="flex items-center justify-between py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{asset.name}</p>
                <p className="max-w-[360px] truncate font-mono text-xs text-muted-foreground">{asset.symbol}</p>
              </div>
              {selectedAsset?.symbol === asset.symbol ? (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  Selected
                </Badge>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
