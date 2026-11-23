import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  CancelledError,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryOptions
} from '@tanstack/react-query';

/** Keep all cached pages visible until an explicit refresh has a new first page. */
export function useFirstPageInfiniteQuery<Page, Cursor>(
  options: Pick<
    UseInfiniteQueryOptions<Page, Error, InfiniteData<Page, Cursor>, QueryKey, Cursor>,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  > & { enabled: boolean; subscribed?: boolean }
) {
  const query = useInfiniteQuery(options);
  const client = useQueryClient();
  const current = useRef<typeof options | null>(options);
  useLayoutEffect(() => {
    current.current = options;
    return () => {
      current.current = null;
    };
  }, [options]);
  const refreshFirstPage = useCallback(async () => {
    try {
      const owner = current.current;
      if (!owner) throw new CancelledError();
      const { queryKey, queryFn, initialPageParam, getNextPageParam } = owner;
      const cacheEntry = (key: QueryKey) =>
        client.getQueryCache().get(client.defaultQueryOptions({ queryKey: key }).queryHash);
      const entry = cacheEntry(queryKey);
      if (entry && entry.state.fetchStatus !== 'idle' && entry.state.fetchMeta?.fetchMore) {
        await client.cancelQueries({ queryKey, exact: true });
        const active = current.current;
        if (!active?.enabled || active.subscribed === false || cacheEntry(active.queryKey) !== entry)
          throw new CancelledError();
      }
      const data = await client.fetchInfiniteQuery({
        queryKey,
        queryFn,
        initialPageParam,
        getNextPageParam,
        pages: 1,
        staleTime: 0
      });
      // Observers receive the cache's structurally shared value, including the error objects already handled.
      return {
        data: client.getQueryData<InfiniteData<Page, Cursor>>(queryKey) ?? data,
        error: null,
        isError: false as const
      };
    } catch (error) {
      return { data: undefined, error, isError: true as const };
    }
  }, [client]);
  return [query, refreshFirstPage] as const;
}
