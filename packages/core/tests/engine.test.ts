import { describe, expect, it } from "vitest";

import {
  calculateMarketValue,
  calculateUnrealizedPnl,
  executeFill,
  TradingError,
} from "../src/engine.js";

describe("executeFill", () => {
  it("buys and updates weighted average cost", () => {
    const result = executeFill({
      balance: 100,
      position: { quantity: 10, avgCost: 2 },
      side: "buy",
      quantity: 5,
      price: 4,
    });

    expect(result.nextBalance).toBe(80);
    expect(result.nextPosition).toEqual({ quantity: 15, avgCost: 2.666667 });
  });

  it("throws when balance is not enough", () => {
    expect(() =>
      executeFill({
        balance: 10,
        side: "buy",
        quantity: 100,
        price: 1,
      }),
    ).toThrowError(TradingError);
  });

  it("sells and realizes pnl", () => {
    const result = executeFill({
      balance: 0,
      position: { quantity: 10, avgCost: 0.4 },
      side: "sell",
      quantity: 5,
      price: 0.6,
    });

    expect(result.nextBalance).toBe(3);
    expect(result.nextPosition).toEqual({ quantity: 5, avgCost: 0.4 });
    expect(result.realizedPnl).toBe(1);
  });

  it("clears position when selling all units", () => {
    const result = executeFill({
      balance: 10,
      position: { quantity: 5, avgCost: 2 },
      side: "sell",
      quantity: 5,
      price: 3,
    });

    expect(result.nextBalance).toBe(25);
    expect(result.nextPosition).toBeNull();
    expect(result.realizedPnl).toBe(5);
  });

  it("throws when selling more than current position", () => {
    expect(() =>
      executeFill({
        balance: 0,
        position: { quantity: 2, avgCost: 1 },
        side: "sell",
        quantity: 3,
        price: 1,
      }),
    ).toThrowError(TradingError);
  });
});

describe("position helpers", () => {
  it("calculates unrealized pnl", () => {
    const unrealized = calculateUnrealizedPnl({ quantity: 3, avgCost: 1.234567 }, 1.5);
    expect(unrealized).toBe(0.796299);
  });

  it("calculates market value", () => {
    const value = calculateMarketValue({ quantity: 2.5, avgCost: 0 }, 1.111111);
    expect(value).toBe(2.777778);
  });
});
