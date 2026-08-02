import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { categoryKey } from '@/domain/reader/readerData';
import { mergeCategories } from '@/domain/forum/feed';
import type { CategoriesResponse, Category } from '@/domain/forum/models';
import type { ReadGateway } from '@/sources/readGateway';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  normalizeDiagnosticReason
} from '@/platform/diagnostics/diagnostics';
import {
  canRetainTrustedSource,
  changedSessionSources,
  changedSourcesForIdentityTransition,
  identityBarriersOnlyRemoved,
  normalizeIdentityBarriers,
  sameIdentityBarriers,
  sameSessionEpochs,
  visibleIdentityErrors,
  withoutChangedSourceErrors
} from '@/platform/query/identityProjection';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys, type ForumIdentityBarrierSource } from '@/platform/query/serverState';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';

function mergeTrustedCategories(
  current: Category[],
  trusted: Category[],
  blockedSources: ReadonlySet<ForumIdentityBarrierSource>,
  retainableSources: ReadonlySet<ForumIdentityBarrierSource>
) {
  const visibleTrusted = trusted.filter((category) =>
    canRetainTrustedSource(category.source, blockedSources, retainableSources)
  );
  const merged = mergeCategories(current, visibleTrusted);
  const remaining = new Map(merged.map((category) => [categoryKey(category), category]));
  const stable = visibleTrusted.flatMap((category) => {
    const key = categoryKey(category);
    const retained = remaining.get(key);
    if (!retained) {
      return [];
    }
    remaining.delete(key);
    return [retained];
  });
  return [...stable, ...remaining.values()];
}

function projectSafeCategoriesPlaceholder(
  previousData: CategoriesResponse | undefined,
  previousQueryKey: readonly unknown[] | undefined,
  currentQueryKey: readonly unknown[]
) {
  const changedSources = changedSourcesForIdentityTransition(previousQueryKey, currentQueryKey, 'categories');
  if (!previousData || !changedSources) {
    return undefined;
  }
  if (!changedSources.size) {
    return previousData.items.length ? previousData : undefined;
  }
  const items = previousData.items.filter(
    (category) => !changedSources.has(category.source as ForumIdentityBarrierSource)
  );
  return items.length
    ? {
        ...previousData,
        errors: withoutChangedSourceErrors(previousData.errors, changedSources),
        items
      }
    : undefined;
}

export function useForumCatalogRuntime({
  active,
  identityBarriers = [],
  identityReconciliationPending,
  notify,
  readGateway,
  retainableIdentityBarriers = [],
  sessionEpochs = initialForumSessionEpochs
}: {
  active: boolean;
  identityBarriers?: readonly ForumIdentityBarrierSource[];
  identityReconciliationPending: boolean;
  notify: (message: string) => void;
  readGateway: ReadGateway;
  retainableIdentityBarriers?: readonly ForumIdentityBarrierSource[];
  sessionEpochs?: ForumSessionEpochs;
}) {
  const queryClient = useQueryClient();
  const [queryIdentityBarriers, setQueryIdentityBarriers] = useState(() => normalizeIdentityBarriers(identityBarriers));
  const [queryRetainableIdentityBarriers, setQueryRetainableIdentityBarriers] = useState(() =>
    normalizeIdentityBarriers(retainableIdentityBarriers)
  );
  const [querySessionEpochs, setQuerySessionEpochs] = useState(sessionEpochs);
  const trustedCategoriesRef = useRef<{ data: CategoriesResponse; queryKey: readonly unknown[] } | undefined>(
    undefined
  );
  const handledErrorRef = useRef<unknown>(undefined);
  const blockedSources = useMemo(() => new Set(identityBarriers), [identityBarriers]);
  const retainableSources = useMemo(() => new Set(retainableIdentityBarriers), [retainableIdentityBarriers]);
  const changedIdentitySources = useMemo(
    () => changedSessionSources(querySessionEpochs, sessionEpochs),
    [querySessionEpochs, sessionEpochs]
  );
  const blockedIdentitySources = useMemo(
    () => new Set([...blockedSources, ...changedIdentitySources]),
    [blockedSources, changedIdentitySources]
  );
  const retainableIdentitySources = useMemo(
    () => new Set([...retainableSources].filter((source) => !changedIdentitySources.has(source))),
    [changedIdentitySources, retainableSources]
  );
  const identitySnapshotReady =
    !identityReconciliationPending &&
    sameIdentityBarriers(queryIdentityBarriers, identityBarriers) &&
    sameSessionEpochs(querySessionEpochs, sessionEpochs);
  const queryKey = forumQueryKeys.categories('all', querySessionEpochs, queryIdentityBarriers);
  const visibleQueryKey = forumQueryKeys.categories('all', sessionEpochs, identityBarriers);
  const query = useQuery<CategoriesResponse>({
    queryKey,
    enabled: active && identitySnapshotReady,
    placeholderData: (previousData, previousQuery) =>
      projectSafeCategoriesPlaceholder(previousData, previousQuery?.queryKey, queryKey),
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('feed', 'categories', { source: 'all' });
      try {
        const data = await readGateway.getCategories(
          { source: 'all', signal },
          { identityBarriers: queryIdentityBarriers, trace }
        );
        finishDiagnosticTrace(trace, Object.keys(data.errors || {}).length ? 'partial' : 'success', {
          source: 'all',
          itemCount: data.items.length,
          partialErrorCount: Object.keys(data.errors || {}).length
        });
        return data;
      } catch (error) {
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: 'all',
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    }
  });
  const effectiveRetainableIdentityBarriers = sameIdentityBarriers(queryIdentityBarriers, identityBarriers)
    ? normalizeIdentityBarriers(retainableIdentityBarriers)
    : queryRetainableIdentityBarriers;
  const trustedState = trustedCategoriesRef.current;
  const trustedChangedSources = trustedState
    ? changedSourcesForIdentityTransition(trustedState.queryKey, visibleQueryKey, 'categories')
    : null;
  const trustedData =
    trustedState && (effectiveRetainableIdentityBarriers.length || trustedChangedSources?.size)
      ? projectSafeCategoriesPlaceholder(trustedState.data, trustedState.queryKey, visibleQueryKey)
      : undefined;
  const currentCategories = (query.data?.items || []).filter((category) =>
    canRetainTrustedSource(category.source, blockedIdentitySources, retainableIdentitySources)
  );
  const categories = useMemo(() => {
    if (!trustedData?.items.length) {
      return currentCategories;
    }
    return mergeTrustedCategories(
      currentCategories,
      trustedData.items,
      blockedIdentitySources,
      retainableIdentitySources
    );
  }, [blockedIdentitySources, currentCategories, retainableIdentitySources, trustedData?.items]);

  useEffect(() => {
    if (
      queryIdentityBarriers.length ||
      !query.isSuccess ||
      query.isFetching ||
      query.isPlaceholderData ||
      !query.data
    ) {
      return;
    }
    if (trustedChangedSources?.size && trustedData?.items.length) {
      const stableData = { ...query.data, items: categories };
      trustedCategoriesRef.current = { data: stableData, queryKey };
      queryClient.setQueryData<CategoriesResponse>(queryKey, stableData);
      return;
    }
    trustedCategoriesRef.current = { data: query.data, queryKey };
  }, [
    categories,
    query.data,
    query.isFetching,
    query.isPlaceholderData,
    query.isSuccess,
    queryClient,
    queryIdentityBarriers.length,
    queryKey,
    trustedChangedSources?.size,
    trustedData?.items.length
  ]);

  useEffect(() => {
    if (identityReconciliationPending) {
      return;
    }
    const nextRetainableIdentityBarriers = normalizeIdentityBarriers(retainableIdentityBarriers);
    if (
      sameIdentityBarriers(queryIdentityBarriers, identityBarriers) &&
      sameSessionEpochs(querySessionEpochs, sessionEpochs)
    ) {
      if (!sameIdentityBarriers(queryRetainableIdentityBarriers, nextRetainableIdentityBarriers)) {
        setQueryRetainableIdentityBarriers(nextRetainableIdentityBarriers);
      }
      return;
    }
    if (query.isFetching) {
      return;
    }
    const nextIdentityBarriers = normalizeIdentityBarriers(identityBarriers);
    const targetQueryKey = forumQueryKeys.categories('all', sessionEpochs, nextIdentityBarriers);
    if (identityBarriersOnlyRemoved(queryIdentityBarriers, nextIdentityBarriers)) {
      if (categories.length) {
        queryClient.setQueryData<CategoriesResponse>(targetQueryKey, {
          errors: visibleIdentityErrors(query.data?.errors, blockedIdentitySources, retainableIdentitySources),
          items: categories
        });
        void queryClient.invalidateQueries({ queryKey: targetQueryKey, exact: true, refetchType: 'none' });
      } else {
        queryClient.removeQueries({ queryKey: targetQueryKey, exact: true });
      }
    } else {
      queryClient.removeQueries({ queryKey: targetQueryKey, exact: true });
    }
    setQueryIdentityBarriers(nextIdentityBarriers);
    setQueryRetainableIdentityBarriers(nextRetainableIdentityBarriers);
    setQuerySessionEpochs(sessionEpochs);
  }, [
    blockedIdentitySources,
    categories,
    identityBarriers,
    identityReconciliationPending,
    query.data?.errors,
    query.isFetching,
    queryClient,
    queryIdentityBarriers,
    queryRetainableIdentityBarriers,
    querySessionEpochs,
    retainableIdentityBarriers,
    retainableIdentitySources,
    sessionEpochs
  ]);

  useEffect(() => {
    if (!active || !query.isError || query.isFetching || handledErrorRef.current === query.error) {
      return;
    }
    handledErrorRef.current = query.error;
    notify(sourceErrorFromUnknown('all', query.error).message);
  }, [active, notify, query.error, query.errorUpdatedAt, query.isError, query.isFetching]);

  useEffect(() => {
    if (active) {
      return;
    }
    void queryClient.cancelQueries({ queryKey: ['forum', 'all', 'categories'] });
  }, [active, queryClient]);

  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: ['forum', 'all', 'categories'] });
    },
    [queryClient]
  );

  return { categories };
}
