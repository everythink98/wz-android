import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  CancelledError,
  InfiniteQueryObserver,
  hashKey,
  isCancelledError,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type Query,
  type QueryClient,
  type QueryFunction,
  type QueryKey,
  type UseInfiniteQueryOptions
} from '@tanstack/react-query';

export type FirstPageInfiniteQueryOptions<Page, Cursor> = Pick<
  UseInfiniteQueryOptions<Page, Error, InfiniteData<Page, Cursor>, QueryKey, Cursor>,
  'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam' | 'getPreviousPageParam' | 'structuralSharing'
> & { enabled: boolean; subscribed?: boolean };

/** Keep all cached pages visible until an explicit refresh has a new first page. */
export function useFirstPageInfiniteQuery<Page, Cursor>(options: FirstPageInfiniteQueryOptions<Page, Cursor>) {
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
      const { queryKey, queryFn, initialPageParam, getNextPageParam, structuralSharing } = owner;
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
        ...(structuralSharing === undefined ? {} : { structuralSharing }),
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

type ExactReadOutcome = { kind: 'success' } | { kind: 'failed'; error: unknown } | { kind: 'stale' };
type GuardRead = <Page, Cursor>(
  queryFn: QueryFunction<Page, QueryKey, Cursor>
) => QueryFunction<Page, QueryKey, Cursor>;

async function resumeRead<Data>(
  client: QueryClient,
  queryKey: QueryKey,
  ownsRead: () => boolean,
  signal: AbortSignal | undefined,
  load: (query: Query<Data>, guard: GuardRead) => Promise<unknown> | undefined
): Promise<ExactReadOutcome> {
  const findQuery = () => client.getQueryCache().find<Data>({ queryKey, exact: true });
  const query = findQuery();
  if (!query || signal?.aborted || !ownsRead() || query.state.fetchStatus !== 'idle') return { kind: 'stale' };
  const current = () => !signal?.aborted && ownsRead() && findQuery() === query;
  let requestSignal: AbortSignal | undefined;
  let pausedState: typeof query.state | undefined;
  const abort = () => {
    if (findQuery() !== query) return;
    if (requestSignal ? requestSignal.aborted : pausedState !== query.state) return;
    void query.cancel({ revert: true });
  };
  const guard: GuardRead = (queryFn) => async (context) => {
    requestSignal = context.signal;
    const assertCurrent = () => {
      if (!context.signal.aborted && current()) return;
      abort();
      throw new CancelledError({ revert: true });
    };
    assertCurrent();
    try {
      return await queryFn(context);
    } finally {
      assertCurrent();
    }
  };
  const dataUpdateCount = query.state.dataUpdateCount;
  try {
    const pending = load(query, guard);
    if (!pending) return { kind: 'stale' };
    const started = findQuery()?.state;
    if (started?.fetchStatus === 'paused') pausedState = started;
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    await pending;
    return current() && query.state.dataUpdateCount > dataUpdateCount ? { kind: 'success' } : { kind: 'stale' };
  } catch (error) {
    return !current() || isCancelledError(error) ? { kind: 'stale' } : { kind: 'failed', error };
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export async function resumeExactQuery<Data>(
  client: QueryClient,
  options: { queryKey: QueryKey; queryFn: QueryFunction<Data, QueryKey> },
  ownsRead: () => boolean,
  signal?: AbortSignal
): Promise<ExactReadOutcome> {
  if (signal?.aborted || !ownsRead()) return { kind: 'stale' };
  client.getQueryCache().build(client, client.defaultQueryOptions(options));
  return resumeRead<Data>(client, options.queryKey, ownsRead, signal, (_query, guard) =>
    client.fetchQuery({ ...options, queryFn: guard(options.queryFn), staleTime: 0 })
  );
}

/** Retry the failed page in its original cache, even while the UI observes another read scope. */
export async function resumeInfiniteQueryPage<Page, Cursor>(
  client: QueryClient,
  options: FirstPageInfiniteQueryOptions<Page, Cursor>,
  target: { kind: 'first' } | { kind: 'next' | 'previous'; pageParam: NoInfer<Cursor> },
  ownsRead: () => boolean,
  signal?: AbortSignal
): Promise<ExactReadOutcome> {
  const { queryKey, queryFn, initialPageParam, getNextPageParam, getPreviousPageParam, structuralSharing } = options;
  if (typeof queryFn !== 'function') return { kind: 'stale' };
  return resumeRead<InfiniteData<Page, Cursor>>(client, queryKey, ownsRead, signal, (query, guard) => {
    const exactOptions = {
      queryKey,
      queryFn: guard(queryFn),
      initialPageParam,
      getNextPageParam,
      getPreviousPageParam,
      ...(structuralSharing === undefined ? {} : { structuralSharing })
    };
    if (target.kind === 'first') return client.fetchInfiniteQuery({ ...exactOptions, pages: 1, staleTime: 0 });
    const previous = query.state.data;
    if (!previous?.pages.length) return;
    const previousPage = target.kind === 'previous';
    const index = previousPage ? 0 : previous.pages.length - 1;
    const pageParam = (previousPage ? getPreviousPageParam : getNextPageParam)?.(
      previous.pages[index]!,
      previous.pages,
      previous.pageParams[index]!,
      previous.pageParams
    );
    if (pageParam == null || hashKey([pageParam]) !== hashKey([target.pageParam])) return;
    const observer = new InfiniteQueryObserver(client, { ...exactOptions, enabled: false });
    const fetchOptions = { cancelRefetch: false, throwOnError: true };
    return (previousPage ? observer.fetchPreviousPage(fetchOptions) : observer.fetchNextPage(fetchOptions)).finally(
      () => observer.destroy()
    );
  });
}
