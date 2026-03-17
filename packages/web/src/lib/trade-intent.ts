import type { MarketReferenceResult, PlaceOrderInput } from "./admin-api";

type TradeSelection = "buy" | "sell";

export type TradeIntent = {
  mode: "default" | "binary-outcome";
  buyLabel: string;
  sellLabel: string;
  reference: string;
  side: PlaceOrderInput["side"];
  actionLabel: string;
};

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const normalizeOutcomeLabel = (value: string): string => {
  return value.trim().toLowerCase();
};

const getBinaryOutcomeChoices = (
  marketId: string,
  asset: MarketReferenceResult | null,
): Array<{ label: string; reference: string }> | null => {
  if (marketId !== "polymarket" || !asset?.metadata) {
    return null;
  }

  const outcomes = parseStringArray(asset.metadata.outcomes);
  const outcomeTokenIds = parseStringArray(asset.metadata.outcomeTokenIds);
  if (outcomes.length !== 2 || outcomeTokenIds.length !== 2) {
    return null;
  }

  const paired = outcomes
    .map((label, index) => {
      const reference = outcomeTokenIds[index];
      return reference ? { label, reference } : null;
    })
    .filter((item): item is { label: string; reference: string } => item !== null);

  if (paired.length !== 2) {
    return null;
  }

  const yesIndex = paired.findIndex((choice) => normalizeOutcomeLabel(choice.label) === "yes");
  const noIndex = paired.findIndex((choice) => normalizeOutcomeLabel(choice.label) === "no");
  if (yesIndex >= 0 && noIndex >= 0) {
    return [paired[yesIndex]!, paired[noIndex]!];
  }

  return paired;
};

export const resolveTradeIntent = (
  marketId: string,
  asset: MarketReferenceResult | null,
  selection: TradeSelection,
): TradeIntent | null => {
  if (!asset) {
    return null;
  }

  const binaryOutcomeChoices = getBinaryOutcomeChoices(marketId, asset);
  if (binaryOutcomeChoices) {
    const activeChoice = selection === "buy" ? binaryOutcomeChoices[0]! : binaryOutcomeChoices[1]!;
    return {
      mode: "binary-outcome",
      buyLabel: binaryOutcomeChoices[0]!.label,
      sellLabel: binaryOutcomeChoices[1]!.label,
      reference: activeChoice.reference,
      side: "buy",
      actionLabel: activeChoice.label,
    };
  }

  return {
    mode: "default",
    buyLabel: "Buy",
    sellLabel: "Sell",
    reference: asset.reference,
    side: selection,
    actionLabel: selection === "buy" ? "Buy" : "Sell",
  };
};
