export type EventType = "system.ready" | "order.filled" | "order.cancelled" | "position.settled";

type UserScopedEventType = Exclude<EventType, "system.ready">;

type BaseEvent<TType extends UserScopedEventType, TData extends Record<string, unknown>> = {
  type: TType;
  userId: string;
  accountId: string;
  orderId?: string;
  data: TData;
};

export type OrderFilledEvent = BaseEvent<
  "order.filled",
  {
    market: string;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    executionPrice: number;
    filledAt: string;
    limitPrice: number | null;
  }
>;

export type OrderCancelledEvent = BaseEvent<
  "order.cancelled",
  {
    market: string;
    symbol: string;
    side: string;
    quantity: number;
    reasoning: string;
    cancelledAt: string;
  }
>;

export type PositionSettledEvent = BaseEvent<
  "position.settled",
  {
    market: string;
    symbol: string;
    quantity: number;
    settlementPrice: number;
    proceeds: number;
    settledAt: string;
  }
>;

export type SystemReadyEvent = {
  type: "system.ready";
  data: { version: string; connectedAt: string };
};

export type TradingEvent = SystemReadyEvent | OrderFilledEvent | OrderCancelledEvent | PositionSettledEvent;
export type EmittedTradingEvent = Exclude<TradingEvent, SystemReadyEvent>;
export type TradingEventListener = (event: EmittedTradingEvent) => void;

const ALL_USERS_CHANNEL = "*";
export const ALL_EVENTS_SUBSCRIBER = ALL_USERS_CHANNEL;

class EventBus {
  static readonly ALL_USERS = ALL_USERS_CHANNEL;
  private listenersByUserId = new Map<string, Set<TradingEventListener>>();

  emit(event: EmittedTradingEvent): void {
    this.dispatch(event.userId, event);
    this.dispatch(ALL_EVENTS_SUBSCRIBER, event);
  }

  subscribe(userId: string, callback: TradingEventListener): () => void {
    const listeners = this.listenersByUserId.get(userId) ?? new Set<TradingEventListener>();
    listeners.add(callback);
    this.listenersByUserId.set(userId, listeners);
    return () => this.unsubscribe(userId, callback);
  }

  unsubscribe(userId: string, callback: TradingEventListener): void {
    const listeners = this.listenersByUserId.get(userId);
    if (!listeners) return;
    listeners.delete(callback);
    if (listeners.size === 0) {
      this.listenersByUserId.delete(userId);
    }
  }

  private dispatch(userId: string, event: EmittedTradingEvent): void {
    const listeners = this.listenersByUserId.get(userId);
    if (!listeners) return;

    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[eventBus] listener error", error);
      }
    }
  }
}

export const eventBus = new EventBus();
