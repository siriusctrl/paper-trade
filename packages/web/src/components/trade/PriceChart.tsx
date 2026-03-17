import { useMemo } from "react";
import { Loader2 } from "lucide-react";

export type CandlePoint = {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

export type TradeMarker = {
    side: string;
    price: number;
    createdAt: string;
};

const CHART_HEIGHT = 180;
const CHART_PADDING = { top: 16, right: 54, bottom: 24, left: 8 };

const UP_COLOR = "rgb(16, 185, 129)";
const DOWN_COLOR = "rgb(239, 68, 68)";
const UP_FILL = "rgba(16, 185, 129, 0.85)";
const DOWN_FILL = "rgba(239, 68, 68, 0.85)";

const formatPrice = (price: number): string => {
    if (price >= 1000) return price.toFixed(0);
    if (price >= 1) return price.toFixed(2);
    return price.toFixed(4);
};

const formatTime = (iso: string, interval?: string): string => {
    const d = new Date(iso);
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    if (interval === "1d") return `${month}/${day}`;
    if (interval === "1m" || interval === "5m") return `${h}:${m}`;
    return `${month}/${day} ${h}:${m}`;
};

type CandleBar = {
    x: number;
    bodyTop: number;
    bodyBottom: number;
    wickTop: number;
    wickBottom: number;
    isUp: boolean;
    barWidth: number;
};

export const PriceChart = ({
    candles,
    trades,
    loading,
    width: containerWidth,
    interval,
}: {
    candles: CandlePoint[];
    trades?: TradeMarker[];
    loading?: boolean;
    width?: number;
    interval?: string;
}) => {
    const width = containerWidth ?? 360;

    const chartData = useMemo(() => {
        if (candles.length === 0) return null;

        const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
        const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

        // Compute price range from all OHLC values
        let minPrice = Infinity;
        let maxPrice = -Infinity;
        for (const c of candles) {
            if (c.low < minPrice) minPrice = c.low;
            if (c.high > maxPrice) maxPrice = c.high;
        }
        // Fallback for flat data
        if (minPrice === maxPrice) {
            minPrice -= 1;
            maxPrice += 1;
        }
        // Add 5% padding to price range
        const pricePad = (maxPrice - minPrice) * 0.05;
        minPrice -= pricePad;
        maxPrice += pricePad;

        const times = candles.map((c) => new Date(c.timestamp).getTime());
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const priceRange = maxPrice - minPrice;
        const timeRange = maxTime - minTime || 1;

        const toX = (t: number) => CHART_PADDING.left + ((t - minTime) / timeRange) * plotWidth;
        const toY = (p: number) => CHART_PADDING.top + plotHeight - ((p - minPrice) / priceRange) * plotHeight;

        // Calculate candle bar width (80% of available slot, min 1px, max 12px)
        const slotWidth = candles.length > 1 ? plotWidth / candles.length : plotWidth;
        const barWidth = Math.max(1, Math.min(12, slotWidth * 0.8));

        // Build candlestick bars
        const bars: CandleBar[] = candles.map((c, i) => {
            const isUp = c.close >= c.open;
            const bodyTop = toY(isUp ? c.close : c.open);
            const bodyBottom = toY(isUp ? c.open : c.close);

            return {
                x: toX(times[i]),
                bodyTop,
                bodyBottom: Math.max(bodyBottom, bodyTop + 1), // min 1px body
                wickTop: toY(c.high),
                wickBottom: toY(c.low),
                isUp,
                barWidth,
            };
        });

        // Generate ~5 time axis labels
        const timeLabels: Array<{ x: number; label: string }> = [];
        const labelCount = Math.min(5, candles.length);
        for (let i = 0; i < labelCount; i++) {
            const idx = Math.floor((i / (labelCount - 1 || 1)) * (candles.length - 1));
            timeLabels.push({
                x: toX(times[idx]),
                label: formatTime(candles[idx].timestamp, interval),
            });
        }

        // Generate 3 price axis labels (using padded range)
        const displayMin = minPrice + pricePad;
        const displayMax = maxPrice - pricePad;
        const priceLabels = [
            { y: toY(displayMax), label: formatPrice(displayMax) },
            { y: toY((displayMin + displayMax) / 2), label: formatPrice((displayMin + displayMax) / 2) },
            { y: toY(displayMin), label: formatPrice(displayMin) },
        ];

        // Map trade markers to coordinates
        const tradePoints = (trades ?? [])
            .map((t) => {
                const tTime = new Date(t.createdAt).getTime();
                if (tTime < minTime || tTime > maxTime) return null;
                return {
                    x: toX(tTime),
                    y: toY(t.price),
                    side: t.side,
                };
            })
            .filter((m): m is NonNullable<typeof m> => m !== null);

        // Overall trend
        const isUp = candles[candles.length - 1].close >= candles[0].open;

        return { bars, timeLabels, priceLabels, tradePoints, isUp, plotHeight };
    }, [candles, trades, width, interval]);

    if (loading && (!chartData || candles.length === 0)) {
        return (
            <div
                className="flex items-center justify-center rounded-lg bg-muted/30"
                style={{ height: CHART_HEIGHT }}
            >
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
            </div>
        );
    }

    if (!chartData || candles.length === 0) {
        return (
            <div
                className="flex items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground/50"
                style={{ height: CHART_HEIGHT }}
            >
                No price data available
            </div>
        );
    }

    return (
        <div className="relative rounded-lg bg-muted/30 p-2">
            {loading ? (
                <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-background/80 p-1.5 shadow-sm backdrop-blur-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
                </div>
            ) : null}
            <svg
                width={width}
                height={CHART_HEIGHT}
                viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
                className={`overflow-visible transition-opacity ${loading ? "opacity-70" : "opacity-100"}`}
            >
                {/* Grid lines */}
                {chartData.priceLabels.map((pl, i) => (
                    <line
                        key={`grid-${i}`}
                        x1={CHART_PADDING.left}
                        y1={pl.y}
                        x2={width - CHART_PADDING.right}
                        y2={pl.y}
                        stroke="currentColor"
                        strokeOpacity={0.06}
                        strokeDasharray="4 4"
                    />
                ))}

                {/* Candlestick bars */}
                {chartData.bars.map((bar, i) => {
                    const color = bar.isUp ? UP_COLOR : DOWN_COLOR;
                    const fill = bar.isUp ? UP_FILL : DOWN_FILL;
                    const halfW = bar.barWidth / 2;

                    return (
                        <g key={`candle-${i}`}>
                            {/* Wick (high-low line) */}
                            <line
                                x1={bar.x}
                                y1={bar.wickTop}
                                x2={bar.x}
                                y2={bar.wickBottom}
                                stroke={color}
                                strokeWidth={1}
                            />
                            {/* Body (open-close rect) */}
                            <rect
                                x={bar.x - halfW}
                                y={bar.bodyTop}
                                width={bar.barWidth}
                                height={bar.bodyBottom - bar.bodyTop}
                                fill={fill}
                                stroke={color}
                                strokeWidth={0.5}
                                rx={0.5}
                            />
                        </g>
                    );
                })}

                {/* Trade markers */}
                {chartData.tradePoints.map((tp, i) => (
                    <g key={`trade-${i}`}>
                        {tp.side === "buy" ? (
                            <polygon
                                points={`${tp.x},${tp.y - 10} ${tp.x - 5},${tp.y - 3} ${tp.x + 5},${tp.y - 3}`}
                                fill={UP_COLOR}
                                fillOpacity={0.9}
                                stroke="white"
                                strokeWidth={0.5}
                            />
                        ) : (
                            <polygon
                                points={`${tp.x},${tp.y + 10} ${tp.x - 5},${tp.y + 3} ${tp.x + 5},${tp.y + 3}`}
                                fill={DOWN_COLOR}
                                fillOpacity={0.9}
                                stroke="white"
                                strokeWidth={0.5}
                            />
                        )}
                    </g>
                ))}

                {/* Price axis labels */}
                {chartData.priceLabels.map((pl, i) => (
                    <text
                        key={`price-${i}`}
                        x={width - CHART_PADDING.right + 6}
                        y={pl.y + 3}
                        fill="currentColor"
                        fillOpacity={0.3}
                        fontSize={9}
                        fontFamily="monospace"
                    >
                        {pl.label}
                    </text>
                ))}

                {/* Time axis labels */}
                {chartData.timeLabels.map((tl, i) => (
                    <text
                        key={`time-${i}`}
                        x={tl.x}
                        y={CHART_HEIGHT - 4}
                        fill="currentColor"
                        fillOpacity={0.3}
                        fontSize={8}
                        fontFamily="monospace"
                        textAnchor="middle"
                    >
                        {tl.label}
                    </text>
                ))}
            </svg>
        </div>
    );
};
