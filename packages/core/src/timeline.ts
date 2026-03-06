export type TimelineEventType =
  | "order"
  | "order.cancelled"
  | "journal"
  | "funding.applied"
  | "position.liquidated";

export type TimelineEventData = {
  id: string;
  symbol?: string;
  market?: string;
  side?: string;
  quantity?: number;
  status?: string;
  filledPrice?: number | null;
  filledAt?: string | null;
  cancelledAt?: string | null;
  content?: string;
  tags?: string[];
  fundingRate?: number;
  payment?: number;
  appliedAt?: string;
  triggerPrice?: number;
  executionPrice?: number;
  triggerPositionEquity?: number;
  maintenanceMargin?: number;
  grossPayout?: number;
  feeCharged?: number;
  netPayout?: number;
  liquidatedAt?: string;
  cancelledReduceOnlyOrderIds?: string[];
  symbolName?: string | null;
};

export type TimelineEventRecord = {
  type: TimelineEventType;
  data: TimelineEventData;
  reasoning: string | null;
  createdAt: string;
};
