import { useCallback, useEffect, useState } from "react";

export type TimelineEvent = {
    type: "order" | "order.cancelled" | "journal";
    data: {
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
        symbolName?: string | null;
    };
    reasoning: string | null;
    createdAt: string;
};

const PAGE_SIZE = 20;

export const useAgentTimeline = ({
    userId,
    adminKey,
}: {
    userId: string | undefined;
    adminKey: string;
}) => {
    const [events, setEvents] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);

    const fetchPage = useCallback(async (pageNum: number) => {
        if (!userId || !adminKey) return;

        setLoading(true);
        try {
            const offset = pageNum * PAGE_SIZE;
            const response = await fetch(
                `/api/admin/users/${userId}/timeline?limit=${PAGE_SIZE}&offset=${offset}`,
                { headers: { Authorization: `Bearer ${adminKey}` } },
            );

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            const payload = await response.json();
            const newEvents: TimelineEvent[] = payload.events ?? [];

            setEvents(newEvents);
            setHasMore(newEvents.length >= PAGE_SIZE);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load timeline");
        } finally {
            setLoading(false);
        }
    }, [adminKey, userId]);

    // Reset pagination when switching to a different agent.
    useEffect(() => {
        setEvents([]);
        setError(null);
        setHasMore(true);
        setPage(0);
    }, [userId]);

    // Fetch on mount and when page changes.
    useEffect(() => {
        void fetchPage(page);
    }, [fetchPage, page]);

    const goToPage = useCallback((p: number) => setPage(p), []);
    const nextPage = useCallback(() => setPage((p) => p + 1), []);
    const prevPage = useCallback(() => setPage((p) => Math.max(0, p - 1)), []);

    return { events, loading, error, page, hasMore, goToPage, nextPage, prevPage };
};
