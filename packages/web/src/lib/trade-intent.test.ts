import { describe, expect, it } from "vitest";

import { resolveTradeIntent } from "./trade-intent";

describe("resolveTradeIntent", () => {
  it("maps binary polymarket previews to outcome buys", () => {
    const asset = {
      reference: "fed-cut",
      name: "Will the Fed cut?",
      metadata: {
        outcomes: ["No", "Yes"],
        outcomeTokenIds: ["222", "111"],
      },
    };

    expect(resolveTradeIntent("polymarket", asset, "buy")).toEqual({
      mode: "binary-outcome",
      buyLabel: "Yes",
      sellLabel: "No",
      reference: "111",
      side: "buy",
      actionLabel: "Yes",
    });
    expect(resolveTradeIntent("polymarket", asset, "sell")).toEqual({
      mode: "binary-outcome",
      buyLabel: "Yes",
      sellLabel: "No",
      reference: "222",
      side: "buy",
      actionLabel: "No",
    });
  });

  it("falls back to buy and sell for token-level or non-binary assets", () => {
    const tokenAsset = {
      reference: "12345",
      name: "Token",
    };

    expect(resolveTradeIntent("polymarket", tokenAsset, "sell")).toEqual({
      mode: "default",
      buyLabel: "Buy",
      sellLabel: "Sell",
      reference: "12345",
      side: "sell",
      actionLabel: "Sell",
    });
  });
});
