import { hashKey, type QueryClient, type QueryFunctionContext } from '@tanstack/react-query';
import type { Topic, TopicDetail } from '@/domain/forum/models';
import { topicWithAuthorFallback } from '@/domain/forum/userNavigation';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { isCanceledRequest } from '@/platform/network/errors';
import { captureDiscoursePolicyRead } from '@/platform/query/discoursePolicyCache';
import { forumQueryKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { createTopicEntryVisit, type TopicEntryVisit } from './topicEntryVisit';

type PolicyAccount = Parameters<typeof captureDiscoursePolicyRead>[1];
type TopicQueryKey = ReturnType<typeof forumQueryKeys.topic>;

export function createTopicEntryRead({
  entryVisit,
  ordinaryLinuxDoTopic,
  policyAccount,
  queryClient,
  readGateway,
  topic,
  topicReadPlan
}: {
  entryVisit: TopicEntryVisit;
  ordinaryLinuxDoTopic: boolean;
  policyAccount?: PolicyAccount;
  queryClient: QueryClient;
  readGateway: Pick<ReadGateway, 'getTopic'>;
  topic: Topic;
  topicReadPlan: ReturnType<ReadGateway['getReadPlan']>;
}) {
  return async ({ signal }: QueryFunctionContext) => {
    const observePolicy =
      topic.source === 'linuxdo' &&
      policyAccount &&
      topicReadPlan.cacheScope === `authenticated:${policyAccount.sessionEpoch}`
        ? captureDiscoursePolicyRead(queryClient, policyAccount, topic.id)
        : undefined;
    const trackVisit = ordinaryLinuxDoTopic && entryVisit.claimVisit(signal);
    const trace = beginDiagnosticTrace('topic', 'open', {
      source: topic.source,
      topicRef: diagnosticRef('topic', `${topic.source}:${topic.id}`)
    });
    try {
      const loaded = await readGateway.getTopic(
        {
          source: topic.source,
          id: topic.id,
          topic,
          trackVisit,
          signal,
          timeoutMs: topic.source === 'nodeseek' || topic.source === 'linuxdo' ? 30000 : undefined
        },
        { plan: topicReadPlan, trace }
      );
      if (sourceDiagnosticSummary(loaded)?.isParseEmpty) {
        throw new Error('主题内容解析为空，无法显示，请重试。');
      }
      const detail = topicWithAuthorFallback(loaded, topic) || loaded;
      markDiagnosticStage(trace, 'apply', {
        itemCount: detail.replies?.length || 0,
        hasContent: Boolean(detail.contentHtml?.trim())
      });
      finishDiagnosticTrace(trace, 'success', {
        itemCount: detail.replies?.length || 0,
        hasContent: Boolean(detail.contentHtml?.trim())
      });
      entryVisit.settleRequest(signal);
      return !signal.aborted && observePolicy
        ? { ...observePolicy(detail), replies: detail.replies.map(observePolicy) }
        : detail;
    } catch (error) {
      if (!isCanceledRequest(error)) entryVisit.settleRequest(signal);
      finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
        source: topic.source,
        reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
      });
      throw error;
    }
  };
}

type Admission = {
  queryKey: TopicQueryKey;
  visit: TopicEntryVisit;
  startedFetch: boolean;
};

export function createTopicEntryPrefetch(queryClient: QueryClient) {
  const pending = new Map<string, Admission>();
  return {
    start({
      routeKey,
      topic,
      sessionEpochs,
      readGateway,
      policyAccount
    }: {
      routeKey: string;
      topic: Topic;
      sessionEpochs: ForumSessionEpochs;
      readGateway: Pick<ReadGateway, 'getReadPlan' | 'getTopic'>;
      policyAccount?: PolicyAccount;
    }) {
      if (pending.has(routeKey)) return;
      const topicReadPlan = readGateway.getReadPlan(topic.source, 'topic');
      if (topicReadPlan.state === 'blocked') return;
      const queryKey = forumQueryKeys.topic({
        source: topic.source,
        topicId: topic.id,
        scope: sessionEpochs,
        readPlanScope: topicReadPlan.cacheScope
      });
      const state = queryClient.getQueryState<TopicDetail>(queryKey);
      if (state?.data && !state.isInvalidated) return;
      const visit = createTopicEntryVisit(hashKey(queryKey), Boolean(state?.data));
      const startedFetch =
        state?.fetchStatus !== 'fetching' ||
        [...pending.values()].some((entry) => entry.startedFetch && entry.visit.key === visit.key);
      pending.set(routeKey, { queryKey, visit, startedFetch });
      void queryClient.prefetchQuery({
        queryKey,
        queryFn: createTopicEntryRead({
          entryVisit: visit,
          ordinaryLinuxDoTopic: topic.source === 'linuxdo' && !topic.isPrivateMessage && !state?.data?.isPrivateMessage,
          policyAccount,
          queryClient,
          readGateway,
          topic,
          topicReadPlan
        })
      });
    },
    getVisit(routeKey: string, queryHash: string) {
      const entry = pending.get(routeKey);
      return entry?.visit.key === queryHash ? entry.visit : undefined;
    },
    discardRemoved(hasRoute: (routeKey: string) => boolean) {
      for (const [routeKey, entry] of pending) {
        if (hasRoute(routeKey)) continue;
        pending.delete(routeKey);
        if (
          entry.startedFetch &&
          ![...pending.values()].some(({ visit }) => visit.key === entry.visit.key) &&
          !queryClient.getQueryCache().find({ queryKey: entry.queryKey, exact: true })?.getObserversCount()
        )
          void queryClient.cancelQueries({ queryKey: entry.queryKey, exact: true });
      }
    }
  };
}

export type TopicEntryPrefetch = ReturnType<typeof createTopicEntryPrefetch>;
