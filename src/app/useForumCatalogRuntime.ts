import { useEffect } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { sourceValues, type Source } from '@/domain/forum/sourceCatalog';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { readWithinAggregateSourceBudget } from '@/sources/readAggregation';

type ForumCatalogRuntimeOptions = {
  active: boolean;
  deferSecondary?: boolean;
  enabledFeedSources: readonly Source[];
  onSettled?: (settled: boolean) => void;
  readGateway: ReadGateway;
  sessionEpochs?: ForumSessionEpochs;
};

export function useForumCatalogRuntime({
  active,
  deferSecondary = false,
  enabledFeedSources,
  onSettled,
  readGateway,
  sessionEpochs = initialForumSessionEpochs
}: ForumCatalogRuntimeOptions) {
  const queryClient = useQueryClient();
  const sources = sourceValues.filter((source) => enabledFeedSources.includes(source));
  const plans = sources.map((source) => readGateway.getReadPlan(source, 'categories'));
  const { categories, settled } = useQueries({
    queries: sources.map((source, index) => {
      const plan = plans[index];
      return {
        queryKey: forumQueryKeys.categories(source, sessionEpochs, undefined, plan.cacheScope),
        // linux.do needs site metadata to render complete TopicCards. Other remote
        // catalogs can wait for posts; a single-source Feed still requests its own.
        enabled: active && plan.state === 'ready' && (!deferSecondary || source === 'linuxdo' || plan.lane === 'local'),
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          const trace = beginDiagnosticTrace('feed', 'categories', { source });
          try {
            const data = await readWithinAggregateSourceBudget(source, signal, (sourceSignal) =>
              readGateway.getCategories({ source, signal: sourceSignal }, { readPlanScope: plan.cacheScope, trace })
            );
            const error = Object.values(data.errors || {}).find(Boolean);
            if (error) throw Object.assign(new Error(error.message), error);
            finishDiagnosticTrace(trace, 'success', { source, itemCount: data.items.length });
            return data;
          } catch (error) {
            finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
              source,
              reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
            });
            throw error;
          }
        }
      };
    }),
    combine: (queries) => ({
      categories: queries.flatMap((query) => query.data?.items || []),
      settled: queries.every((query, index) => plans[index].state === 'blocked' || query.isSuccess || query.isError)
    })
  });

  useEffect(() => {
    if (active) return;
    void queryClient.cancelQueries({
      predicate: (query) => query.queryKey[0] === 'forum' && query.queryKey[2] === 'categories' && !query.isActive()
    });
  }, [active, queryClient]);

  useEffect(() => onSettled?.(settled), [onSettled, settled]);

  return { categories, settled };
}
