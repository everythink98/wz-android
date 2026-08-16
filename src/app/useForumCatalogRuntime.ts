import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoriesResponse } from '@/domain/forum/models';
import { forumReadPlanScopesKey } from '@/domain/forum/readPlan';
import { sourceValues, type Source } from '@/domain/forum/sourceCatalog';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';

type ForumCatalogRuntimeOptions = {
  active: boolean;
  enabledFeedSources: readonly Source[];
  enabledSourcesKey: string;
  notify: (message: string) => void;
  onSettled?: (settled: boolean) => void;
  readGateway: ReadGateway;
  sessionEpochs?: ForumSessionEpochs;
};

function aggregateReadPlanScopes(queryKey: readonly unknown[]) {
  const state = queryKey[3] as { readPlanScope?: unknown } | undefined;
  if (typeof state?.readPlanScope !== 'string') return null;
  const scopes = new Map<Source, string>();
  for (const entry of state.readPlanScope.split(',')) {
    const source = sourceValues.find((candidate) => entry.startsWith(`${candidate}:`));
    if (source) scopes.set(source, entry.slice(source.length + 1));
  }
  return scopes;
}

function safeCategoriesPlaceholder(
  previousData: CategoriesResponse | undefined,
  previousQueryKey: readonly unknown[] | undefined,
  currentQueryKey: readonly unknown[]
) {
  if (!previousData || !previousQueryKey) return undefined;
  const previousState = previousQueryKey[3] as Record<string, unknown> | undefined;
  const currentState = currentQueryKey[3] as Record<string, unknown> | undefined;
  if (
    previousQueryKey[0] !== currentQueryKey[0] ||
    previousQueryKey[1] !== currentQueryKey[1] ||
    previousQueryKey[2] !== currentQueryKey[2] ||
    previousState?.enabledSources !== currentState?.enabledSources
  ) {
    return undefined;
  }
  const previousScopes = aggregateReadPlanScopes(previousQueryKey);
  const currentScopes = aggregateReadPlanScopes(currentQueryKey);
  if (!previousScopes || !currentScopes) return undefined;
  const changedSources = new Set(
    sourceValues.filter((source) => previousScopes.get(source) !== currentScopes.get(source))
  );
  if (!changedSources.size) return previousData;
  const items = previousData.items.filter((category) => !changedSources.has(category.source));
  return items.length
    ? {
        ...previousData,
        errors: Object.fromEntries(
          Object.entries(previousData.errors || {}).filter(([source]) => !changedSources.has(source as Source))
        ),
        items
      }
    : undefined;
}

export function useForumCatalogRuntime({
  active,
  enabledFeedSources,
  enabledSourcesKey,
  notify,
  onSettled,
  readGateway,
  sessionEpochs = initialForumSessionEpochs
}: ForumCatalogRuntimeOptions) {
  const queryClient = useQueryClient();
  const handledErrorRef = useRef<unknown>(undefined);
  const readPlanScopes = enabledFeedSources.map(
    (source) => [source, readGateway.getReadPlan(source, 'categories').cacheScope] as const
  );
  const readPlanScope = forumReadPlanScopesKey(readPlanScopes);
  const queryKey = forumQueryKeys.categories('all', sessionEpochs, enabledSourcesKey, readPlanScope);
  const query = useQuery<CategoriesResponse>({
    queryKey,
    enabled: active && enabledFeedSources.length > 0,
    placeholderData: (previousData, previousQuery) =>
      safeCategoriesPlaceholder(previousData, previousQuery?.queryKey, queryKey),
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('feed', 'categories', { source: 'all' });
      try {
        const data = await readGateway.getCategories(
          { source: 'all', signal },
          { includedSources: enabledFeedSources, readPlanScopes, trace }
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

  useEffect(() => {
    if (!active || !query.isError || query.isFetching || handledErrorRef.current === query.error) return;
    handledErrorRef.current = query.error;
    notify(sourceErrorFromUnknown('all', query.error).message);
  }, [active, notify, query.error, query.errorUpdatedAt, query.isError, query.isFetching]);

  useEffect(() => {
    if (active) return;
    void queryClient.cancelQueries({ queryKey: ['forum', 'all', 'categories'] });
  }, [active, queryClient]);

  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: ['forum', 'all', 'categories'] });
    },
    [queryClient]
  );

  const settled = enabledFeedSources.length === 0 || query.isSuccess || query.isError;
  useEffect(() => onSettled?.(settled), [onSettled, settled]);

  return {
    categories: query.data?.items || [],
    settled
  };
}
