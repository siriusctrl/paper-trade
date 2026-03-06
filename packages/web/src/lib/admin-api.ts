import type { TimelineEventRecord } from "@unimarket/core";

import { readStoredAdminKey } from "./admin";

export type PositionView = {
  market: string;
  symbol: string;
  symbolName?: string | null;
  side?: string | null;
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  quoteTimestamp?: string | null;
};

export type AgentView = {
  userId: string;
  userName: string;
  createdAt: string;
  accountId: string | null;
  accountName: string | null;
  balance: number;
  positions: PositionView[];
  totals: {
    positions: number;
    marketValue: number;
    unrealizedPnl: number;
    equity: number;
  };
};

export type MarketView = {
  marketId: string;
  marketName: string;
  users: number;
  positions: number;
  totalQuantity: number;
  totalMarketValue: number;
  totalUnrealizedPnl: number;
  quotedPositions: number;
  unpricedPositions: number;
};

export type OverviewResponse = {
  generatedAt: string;
  totals: {
    users: number;
    positions: number;
    balance: number;
    marketValue: number;
    unrealizedPnl: number;
    equity: number;
  };
  markets: MarketView[];
  agents: AgentView[];
};

export type MarketInfo = {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  referenceFormat: string;
  browseOptions: BrowseOption[];
};

export type BrowseOption = {
  value: string;
  label: string;
};

export type MarketReferenceResult = {
  reference: string;
  name: string;
  price?: number;
  volume?: number;
  liquidity?: number;
  endDate?: string | null;
  metadata?: Record<string, unknown>;
};

export type QuoteData = {
  reference: string;
  price: number;
  bid?: number;
  ask?: number;
  timestamp: string;
};

export type TradingConstraints = {
  minQuantity: number;
  quantityStep: number;
  supportsFractional: boolean;
  maxLeverage: number | null;
};

export type AgentOption = {
  userId: string;
  userName: string;
  balance: number;
  equity: number;
};

export type PortfolioPosition = {
  market: string;
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  leverage: number | null;
};

export type PortfolioOrder = {
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
};

export type PortfolioData = {
  userId: string;
  userName: string;
  accountId: string;
  balance: number;
  positions: PortfolioPosition[];
  openOrders: PortfolioOrder[];
  recentOrders: PortfolioOrder[];
  totalValue: number;
  totalPnl: number;
  totalFunding: number;
};

export type CreateTraderResponse = {
  userId: string;
  userName: string;
  accountId: string;
  balance: number;
};

export type AdminOrderResponse = {
  id: string;
  market: string;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  limitPrice: number | null;
  filledPrice: number | null;
  status: string;
  reasoning: string;
  createdAt: string;
  filledAt: string | null;
  cancelledAt: string | null;
  reduceOnly?: boolean;
  leverage?: number;
};

export type EquitySnapshot = {
  snapshotAt: string;
  equity: number;
  balance: number;
  marketValue: number;
  unrealizedPnl: number;
};

export type AgentSeries = {
  userId: string;
  userName: string;
  snapshots: EquitySnapshot[];
};

export type EquityHistoryResponse = {
  range: string;
  series: AgentSeries[];
};

export type TimelineResponse = {
  events: TimelineEventRecord[];
};

export type PlaceOrderInput = {
  accountId?: string;
  market: string;
  reference: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  quantity: number;
  limitPrice?: number;
  leverage?: number;
  reduceOnly?: boolean;
  reasoning: string;
};

const AUTH_ERROR_MESSAGE = "Invalid admin key. Please sign in again.";

export class AdminApiError extends Error {
  status: number;
  code: string | null;
  auth: boolean;

  constructor(message: string, { status, code = null, auth = false }: { status: number; code?: string | null; auth?: boolean }) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.auth = auth;
  }
}

export const isAdminAuthError = (error: unknown): error is AdminApiError => {
  return error instanceof AdminApiError && error.auth;
};

const parseErrorPayload = async (response: Response): Promise<{ message: string; code: string | null }> => {
  try {
    const payload = await response.json() as { error?: { message?: string; code?: string } };
    return {
      message: payload.error?.message ?? `Request failed with status ${response.status}`,
      code: payload.error?.code ?? null,
    };
  } catch {
    return {
      message: `Request failed with status ${response.status}`,
      code: null,
    };
  }
};

const requestJson = async <TResponse>(
  path: string,
  {
    adminKey = readStoredAdminKey(),
    onAuthError,
    init,
  }: {
    adminKey?: string;
    onAuthError?: () => void;
    init?: RequestInit;
  } = {},
): Promise<TResponse> => {
  if (!adminKey) {
    throw new AdminApiError("Missing admin key. Please sign in.", { status: 401, auth: true });
  }

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${adminKey}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    const isAuth = response.status === 401 || response.status === 403;
    if (isAuth) {
      onAuthError?.();
    }
    const { message, code } = await parseErrorPayload(response);
    throw new AdminApiError(isAuth ? AUTH_ERROR_MESSAGE : message, {
      status: response.status,
      code,
      auth: isAuth,
    });
  }

  return await response.json() as TResponse;
};

export const createIdempotencyKey = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `admin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const createAdminApiClient = ({
  adminKey = readStoredAdminKey(),
  onAuthError,
}: {
  adminKey?: string;
  onAuthError?: () => void;
}) => {
  const request = <TResponse>(path: string, init?: RequestInit) =>
    requestJson<TResponse>(path, { adminKey, onAuthError, init });

  return {
    getMarkets: () => request<{ markets: MarketInfo[] }>("/api/markets"),
    getOverview: () => request<OverviewResponse>("/api/admin/overview"),
    getEquityHistory: (range: string) =>
      request<EquityHistoryResponse>(`/api/admin/equity-history?range=${encodeURIComponent(range)}`),
    getUserPortfolio: (userId: string) => request<PortfolioData>(`/api/admin/users/${userId}/portfolio`),
    getUserTimeline: (userId: string, { limit, offset }: { limit: number; offset: number }) =>
      request<TimelineResponse>(`/api/admin/users/${userId}/timeline?limit=${limit}&offset=${offset}`),
    searchMarketReferences: (marketId: string, query: string, limit = 20, offset = 0) =>
      request<{ results: MarketReferenceResult[] }>(
        `/api/markets/${marketId}/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
      ),
    browseMarketReferences: (marketId: string, sort: string | undefined, limit = 20, offset = 0) =>
      request<{ results: MarketReferenceResult[] }>(
        `/api/markets/${marketId}/browse?limit=${limit}&offset=${offset}${sort ? `&sort=${encodeURIComponent(sort)}` : ""}`,
      ),
    getQuote: (marketId: string, reference: string) =>
      request<QuoteData>(`/api/markets/${marketId}/quote?reference=${encodeURIComponent(reference)}`),
    getTradingConstraints: (marketId: string, reference: string) =>
      request<{ reference: string; constraints: TradingConstraints }>(
        `/api/markets/${marketId}/trading-constraints?reference=${encodeURIComponent(reference)}`,
      ),
    createTrader: (userName: string) =>
      request<CreateTraderResponse>("/api/admin/traders", {
        method: "POST",
        body: JSON.stringify({ userName }),
      }),
    placeUserOrder: (userId: string, order: PlaceOrderInput, idempotencyKey = createIdempotencyKey()) =>
      request<AdminOrderResponse>(`/api/admin/users/${userId}/orders`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(order),
      }),
  };
};
