import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useIsFetching,
  useQueries,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseQueryResult
} from '@tanstack/react-query';
import type { ReadGateway } from '@/sources/readGateway';
import {
  recordHistory,
  topicKey,
  updateFavoriteTopic,
  type ReaderData,
  type ReaderDataMutationReason
} from '@/domain/reader/readerData';
import { replyKey as replyRenderKey } from '@/domain/forum/feed';
import { isCanceledRequest } from '@/platform/network/errors';
import {
  firstReplyData,
  matchesLoadedReplyLocation,
  mergedReplyPages,
  nextReplyPage,
  previousReplyPage,
  REPLY_PAGE_SIZE,
  replyEdgePosition,
  type ReplyCursorPosition,
  type ReplyPage,
  type ReplyPageParam,
  type ReplyWindowEdge
} from './model/replyPagination';
import { topicWithAuthorFallback } from '@/domain/forum/userNavigation';
import {
  applyEditedReplyContent,
  matchesReplyRefreshTarget,
  removeRepliesForRefresh,
  shouldApplyEditedReplyFallback
} from './actions/actionHelpers';
import type { TopicSessionController } from './useTopicSessionController';
import {
  sourceErrorFromUnknown,
  sourceReadRecoveryOutcome,
  yaohuoErrorRequiresLoginPanel
} from '@/sources/sourceErrors';
import type {
  Reply,
  ReplyLocationTarget,
  ReplyOrder,
  ReplyWindowPosition,
  Source,
  SourceErrorInfo,
  Topic,
  TopicDetail
} from '@/domain/forum/models';
import type { ReplyRefreshCommand } from './model/types';
import {
  quotedPostReferenceKey,
  quotedPostsForSource,
  replyQuotedPostInstanceKey,
  topicOpeningPostAsReply,
  type QuotedPostReference,
  type ToggleReplyQuoteOptions,
  type ToggleTopicBodyQuoteOptions
} from '@/domain/forum/quotedPosts';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import {
  diagnosticRef,
  normalizeDiagnosticReason,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import { isDiscourseSource, isSessionSource, type SessionSource } from '@/domain/forum/sourceCatalog';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { prepareReplyContent } from '@/domain/forum/topicContentSplit';

type MutableRef<T> = { current: T };

type QuoteQueryProjection = Pick<
  UseQueryResult<Reply>,
  'data' | 'error' | 'errorUpdatedAt' | 'isFetching' | 'isPending'
>;

function combineQuoteQueryResults(results: QuoteQueryProjection[]): QuoteQueryProjection[] {
  return results.map(({ data, error, errorUpdatedAt, isFetching, isPending }) => ({
    data,
    error,
    errorUpdatedAt,
    isFetching,
    isPending
  }));
}

type ReplyWindowErrorSlot = ReplyWindowEdge | 'refresh';

type ReplyRetryMode = 'query' | 'whole' | 'none' | ReplyRefreshCommand;

type ReplyFailure = {
  error: SourceErrorInfo;
  position: ReplyWindowPosition;
  retryMode: ReplyRetryMode;
};

type ReplyWindowFailures = Record<ReplyWindowErrorSlot, ReplyFailure | null>;

const EMPTY_REPLY_WINDOW_FAILURES: ReplyWindowFailures = { start: null, end: null, refresh: null };

function replyFailure(
  source: Source,
  error: unknown,
  position: ReplyWindowPosition,
  retryMode: ReplyRetryMode
): ReplyFailure {
  const sourceError = sourceErrorFromUnknown(source, error);
  return { error: retryMode === 'none' ? { ...sourceError, retryable: false } : sourceError, position, retryMode };
}

const readOutcome = sourceReadRecoveryOutcome;

export function useTopicController({
  active,
  commitReaderData,
  sessionEpochs = initialForumSessionEpochs,
  notify,
  onRetryIdentityStatus,
  onNodeSeekTopicVerificationRequired,
  onOpenTopic,
  readerData,
  readerDataRef,
  showLinuxDoVerification,
  showYaohuoLogin,
  readGateway,
  targetReply,
  targetReplyRequestId,
  topic,
  topicSession
}: {
  active: boolean;
  commitReaderData: (mutationReason: ReaderDataMutationReason, updater: (current: ReaderData) => ReaderData) => void;
  sessionEpochs?: ForumSessionEpochs;
  notify: (message: string) => void;
  onRetryIdentityStatus?: (source: SessionSource) => Promise<unknown> | unknown;
  onNodeSeekTopicVerificationRequired: (message: string, recovery: LinuxDoReadRecovery) => void;
  onOpenTopic: (topic: Topic) => void;
  readerData: ReaderData;
  readerDataRef: MutableRef<ReaderData>;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  showYaohuoLogin: (message?: string) => void;
  readGateway: ReadGateway;
  targetReply?: ReplyLocationTarget;
  targetReplyRequestId?: number;
  topic: Topic;
  topicSession: TopicSessionController;
}) {
  const queryClient = useQueryClient();
  const {
    state: { expandedQuotes, replyOrder, selectedTopic: sessionTopic },
    commands: { quotes: topicQuotes, topic: topicCommands }
  } = topicSession;
  const selectedTopic = sessionTopic || topic;
  const [quoteRequests, setQuoteRequests] = useState<
    Record<
      string,
      {
        prefetch: boolean;
        reference: QuotedPostReference;
      }
    >
  >({});
  const unreadBaselineRef = useRef<Record<string, number>>({
    [topicKey(topic)]: readerDataRef.current.history[topicKey(topic)]?.topic.replyCount || 0
  });
  const recordedTopicUpdateRef = useRef('');
  const handledTopicErrorRef = useRef(0);
  const handledRepliesErrorRef = useRef(0);
  const handledQuoteErrorsRef = useRef<Record<string, number>>({});
  const targetWindowCacheOwnedRef = useRef(new Map<ReplyOrder, readonly unknown[]>());
  const handledRouteTargetRef = useRef('');
  const replyWindowGenerationRef = useRef(0);
  const selectedSource = selectedTopic?.source || 'v2ex';
  const selectedTopicId = selectedTopic?.id || '';
  const selectedTopicKey = selectedTopic ? topicKey(selectedTopic) : '';
  const topicReadPlan = readGateway.getReadPlan(selectedSource, 'topic');
  const repliesReadPlan = readGateway.getReadPlan(selectedSource, 'replies');
  const topicReadBlocked = topicReadPlan.state === 'blocked';
  const repliesReadBlocked = repliesReadPlan.state === 'blocked';
  const selectedReadBlocked = topicReadBlocked || repliesReadBlocked;
  const enabled = Boolean(active);
  const topicQueryKey = useMemo(
    () =>
      forumQueryKeys.topic({
        source: selectedSource,
        topicId: selectedTopicId,
        readPlanScope: topicReadPlan.cacheScope,
        scope: sessionEpochs
      }),
    [
      sessionEpochs.linuxdo,
      sessionEpochs.nodeseek,
      sessionEpochs.xiaoyinsi,
      sessionEpochs.yaohuo,
      selectedSource,
      selectedTopicId,
      topicReadPlan.cacheScope
    ]
  );
  const repliesQueryKey = useMemo(
    () => forumQueryKeys.replies(topicQueryKey, replyOrder, repliesReadPlan.cacheScope),
    [repliesReadPlan.cacheScope, replyOrder, topicQueryKey]
  );
  const otherRepliesQueryKey = useMemo(
    () =>
      forumQueryKeys.replies(topicQueryKey, replyOrder === 'oldest' ? 'newest' : 'oldest', repliesReadPlan.cacheScope),
    [repliesReadPlan.cacheScope, replyOrder, topicQueryKey]
  );
  const repliesQueryIdentity = JSON.stringify(repliesQueryKey);
  const activeRepliesQueryIdentityRef = useCommittedRef(enabled ? repliesQueryIdentity : '');
  const [replyWindowFailuresByKey, setReplyWindowFailuresByKey] = useState<Record<string, ReplyWindowFailures>>({});
  const replyWindowFailures = replyWindowFailuresByKey[repliesQueryIdentity] || EMPTY_REPLY_WINDOW_FAILURES;
  const setReplyWindowFailure = useCallback(
    (slot: ReplyWindowErrorSlot, failure: ReplyFailure | null) => {
      setReplyWindowFailuresByKey((current) => {
        const existing = current[repliesQueryIdentity] || EMPTY_REPLY_WINDOW_FAILURES;
        return { ...current, [repliesQueryIdentity]: { ...existing, [slot]: failure } };
      });
    },
    [repliesQueryIdentity]
  );
  const clearReplyWindowErrors = useCallback(
    (edgesOnly = false) => {
      setReplyWindowFailuresByKey((current) => {
        const existing = current[repliesQueryIdentity] || EMPTY_REPLY_WINDOW_FAILURES;
        return {
          ...current,
          [repliesQueryIdentity]: edgesOnly ? { ...existing, start: null, end: null } : EMPTY_REPLY_WINDOW_FAILURES
        };
      });
    },
    [repliesQueryIdentity]
  );
  const targetReplyQueryRoot = useMemo(() => [...repliesQueryKey, 'target-floor'] as const, [repliesQueryKey]);
  const loadingTargetReply = useIsFetching({ queryKey: targetReplyQueryRoot }) > 0;
  const topicReadQueryKey = useCallback(
    (candidate: Pick<Topic, 'id' | 'source'>) =>
      forumQueryKeys.topic({
        readPlanScope: readGateway.getReadPlan(candidate.source, 'topic').cacheScope,
        scope: sessionEpochs,
        source: candidate.source,
        topicId: candidate.id
      }),
    [readGateway, sessionEpochs]
  );
  const quotedReplyQueryKey = useCallback(
    (reference: QuotedPostReference) =>
      forumQueryKeys.reply({
        postNumber: reference.postNumber,
        readPlanScope: readGateway.getReadPlan(reference.source, 'reply').cacheScope,
        scope: sessionEpochs,
        source: reference.source,
        topicId: reference.topicId
      }),
    [readGateway, sessionEpochs]
  );

  useEffect(
    () => () => {
      activeRepliesQueryIdentityRef.current = '';
      targetWindowCacheOwnedRef.current.forEach((queryKey) => queryClient.removeQueries({ queryKey, exact: true }));
      targetWindowCacheOwnedRef.current.clear();
    },
    [activeRepliesQueryIdentityRef, queryClient]
  );

  const detailQuery = useQuery({
    queryKey: topicQueryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const topic = selectedTopic!;
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
            signal,
            timeoutMs: topic.source === 'nodeseek' || topic.source === 'linuxdo' ? 30000 : undefined
          },
          { readPlanScope: topicReadPlan.cacheScope, trace }
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
        return detail;
      } catch (error) {
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: topic.source,
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    }
  });

  const topicDetail = detailQuery.data || null;
  const loadReplyPage = useCallback(
    async (
      detail: TopicDetail,
      order: ReplyOrder,
      position: ReplyPageParam,
      signal: AbortSignal | undefined,
      trace: ReturnType<typeof beginDiagnosticTrace>
    ): Promise<ReplyPage> => {
      const loaded = await readGateway.getReplies(
        {
          source: detail.source,
          id: detail.id,
          categoryId: detail.categoryId,
          order,
          position,
          replyCount: detail.replyCount,
          limit: REPLY_PAGE_SIZE,
          signal
        },
        { readPlanScope: repliesReadPlan.cacheScope, trace }
      );
      if (sourceDiagnosticSummary(loaded)?.isParseEmpty) {
        throw new Error(
          position.kind === 'start'
            ? '评论内容解析为空，无法更新，请重试。'
            : '评论内容解析为空，无法加载相邻窗口，请重试。'
        );
      }
      const resolvedPage = loaded.currentPage;
      if (!resolvedPage || !Number.isSafeInteger(resolvedPage) || resolvedPage <= 0) {
        throw new Error('原站未确认回复窗口页码');
      }
      const requestedOffset = loaded.currentOffset ?? (position.kind === 'cursor' ? position.offset : null);
      const page: ReplyPage = {
        ...loaded,
        requestedPage: resolvedPage,
        requestedOffset
      };
      if (loaded.hasMore && !nextReplyPage(page)) {
        throw new Error('原站返回了重复的回复游标');
      }
      if (loaded.previousPage && !previousReplyPage(page)) {
        throw new Error('原站返回了重复的上一回复游标');
      }
      return page;
    },
    [readGateway, repliesReadPlan.cacheScope]
  );
  const initialReplies = useMemo(
    () => (topicDetail ? firstReplyData(topicDetail, replyOrder) : undefined),
    [detailQuery.dataUpdatedAt, replyOrder, topicDetail]
  );
  const repliesQuery = useInfiniteQuery({
    queryKey: repliesQueryKey,
    enabled: enabled && Boolean(topicDetail) && (!targetReply || Boolean(initialReplies)),
    initialPageParam: { kind: 'start' } satisfies ReplyPageParam,
    initialData: initialReplies,
    initialDataUpdatedAt: initialReplies ? detailQuery.dataUpdatedAt || undefined : undefined,
    queryFn: async ({ pageParam, signal }) => {
      const detail = topicDetail!;
      const trace = beginDiagnosticTrace('reply', pageParam.kind === 'start' ? 'refresh' : 'load-more', {
        source: detail.source,
        topicRef: diagnosticRef('topic', `${detail.source}:${detail.id}`),
        replyOrder,
        positionKind: pageParam.kind,
        ...(pageParam.kind === 'cursor' ? { page: pageParam.page } : {})
      });
      try {
        const page = await loadReplyPage(detail, replyOrder, pageParam, signal, trace);
        finishDiagnosticTrace(trace, 'success', {
          itemCount: page.items.length,
          hasMore: Boolean(nextReplyPage(page)),
          replyOrder,
          positionKind: pageParam.kind,
          resolvedPage: page.currentPage!
        });
        return page;
      } catch (error) {
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: detail.source,
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    },
    getNextPageParam: (lastPage, allPages) => nextReplyPage(lastPage, allPages),
    getPreviousPageParam: (firstPage, allPages) => previousReplyPage(firstPage, allPages),
    retry: false
  });

  useEffect(() => {
    if (!topicDetail) return;
    const seed = firstReplyData(topicDetail, replyOrder);
    if (!seed) return;
    queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, (current) => {
      return current || seed;
    });
  }, [detailQuery.dataUpdatedAt, queryClient, repliesQueryKey, replyOrder, topicDetail]);

  const topicReplies = useMemo(
    () => mergedReplyPages(repliesQuery.data as InfiniteData<ReplyPage, ReplyPageParam> | undefined),
    [repliesQuery.data]
  );
  const lastReplyPage = repliesQuery.data?.pages.at(-1);
  const replyHasPrevious = Boolean(repliesQuery.hasPreviousPage);
  const replyHasMore = Boolean(repliesQuery.hasNextPage);
  const nextReplyCursor = lastReplyPage ? nextReplyPage(lastReplyPage) : undefined;
  const replyNextPage = nextReplyCursor?.page ?? null;
  const replyNextOffset = nextReplyCursor?.offset ?? null;

  const authoritativeReplyCount = repliesQuery.data?.pages.reduce<number | undefined>(
    (confirmed, page) => (typeof page.totalCount === 'number' ? page.totalCount : confirmed),
    undefined
  );
  const replyRowsPartial = Boolean(
    repliesQuery.data?.pages.some((page) => page.completeness !== 'complete') ||
    (!repliesQuery.data && topicDetail?.replies.length && topicDetail.replyCompleteness !== 'complete')
  );
  const replyCollectionComplete = true;
  useEffect(() => {
    if (
      selectedTopic?.source !== 'xiaoyinsi' ||
      typeof authoritativeReplyCount !== 'number' ||
      authoritativeReplyCount < 0
    ) {
      return;
    }
    queryClient.setQueryData<TopicDetail>(topicQueryKey, (current) =>
      current && current.replyCount !== authoritativeReplyCount
        ? { ...current, replyCount: authoritativeReplyCount }
        : current
    );
  }, [authoritativeReplyCount, queryClient, selectedTopic?.source, topicQueryKey]);

  const rebuildRepliesFromDetail = useCallback(
    async (detail: TopicDetail, generation: number, clearOtherOrder = false) => {
      const ownsWindow = () =>
        activeRepliesQueryIdentityRef.current === repliesQueryIdentity &&
        replyWindowGenerationRef.current === generation;
      const replyKeys = clearOtherOrder
        ? (['oldest', 'newest'] as const).map((order) =>
            forumQueryKeys.replies(topicQueryKey, order, repliesReadPlan.cacheScope)
          )
        : [repliesQueryKey];
      await Promise.all(replyKeys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
      if (!ownsWindow()) return false;

      let rebuilt = firstReplyData(detail, replyOrder);
      if (!rebuilt) {
        const queryKey = [...repliesQueryKey, 'rebuild-start'] as const;
        const trace = beginDiagnosticTrace('reply', 'refresh', {
          source: detail.source,
          replyOrder,
          positionKind: 'start'
        });
        try {
          const page = await queryClient.fetchQuery({
            queryKey,
            staleTime: 0,
            queryFn: ({ signal }) => loadReplyPage(detail, replyOrder, { kind: 'start' }, signal, trace),
            retry: false
          });
          if (!ownsWindow()) {
            finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
            return false;
          }
          rebuilt = { pages: [page], pageParams: [{ kind: 'start' }] };
          finishDiagnosticTrace(trace, 'success', { resolvedPage: page.currentPage || page.requestedPage });
        } catch (error) {
          if (!ownsWindow()) return false;
          finishDiagnosticTrace(trace, isCanceledRequest(error) ? 'canceled' : 'failure', {
            reason: isCanceledRequest(error) ? 'canceled' : normalizeDiagnosticReason(error)
          });
          throw error;
        } finally {
          queryClient.removeQueries({ queryKey, exact: true });
        }
      }
      if (!ownsWindow()) return false;
      replyKeys.forEach((queryKey) => queryClient.removeQueries({ queryKey }));
      if (clearOtherOrder) targetWindowCacheOwnedRef.current.clear();
      else targetWindowCacheOwnedRef.current.delete(replyOrder);
      queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, rebuilt);
      if (clearOtherOrder) setReplyWindowFailuresByKey({});
      else clearReplyWindowErrors();
      return true;
    },
    [
      activeRepliesQueryIdentityRef,
      clearReplyWindowErrors,
      loadReplyPage,
      queryClient,
      repliesQueryIdentity,
      repliesQueryKey,
      replyOrder,
      topicQueryKey
    ]
  );
  const handleReadError = useCallback(
    (
      source: Source,
      error: unknown,
      recovery: LinuxDoReadRecovery,
      nodeSeekFallback?: (recovery: LinuxDoReadRecovery) => void
    ): SourceErrorInfo => {
      const sourceError = sourceErrorFromUnknown(source, error);
      if (source === 'linuxdo' && sourceError.kind === 'verification-required') {
        void showLinuxDoVerification(sourceError.message, recovery);
      } else if (source === 'nodeseek' && sourceError.kind === 'verification-required') {
        nodeSeekFallback?.(recovery);
      } else if (source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
        showYaohuoLogin(sourceError.kind === 'login-expired' ? '妖火登录已失效，请重新登录。' : sourceError.message);
      } else if (!isCanceledRequest(error)) {
        notify(sourceError.message);
      }
      return sourceError;
    },
    [notify, showLinuxDoVerification, showYaohuoLogin]
  );

  useEffect(() => {
    if (!topicDetail || !detailQuery.dataUpdatedAt) return;
    const recordKey = `${topicKey(topicDetail)}:${detailQuery.dataUpdatedAt}`;
    if (recordedTopicUpdateRef.current === recordKey) return;
    recordedTopicUpdateRef.current = recordKey;
    commitReaderData('history-recorded', (current) =>
      updateFavoriteTopic(recordHistory(current, topicDetail), topicDetail)
    );
  }, [commitReaderData, detailQuery.dataUpdatedAt, topicDetail]);

  useEffect(() => {
    if (!selectedTopic || !detailQuery.error || handledTopicErrorRef.current === detailQuery.errorUpdatedAt) return;
    handledTopicErrorRef.current = detailQuery.errorUpdatedAt;
    const topic = selectedTopic;
    handleReadError(
      topic.source,
      detailQuery.error,
      {
        queryKey: topicQueryKey,
        resume: async () => {
          if (topicCommands.getCurrentKey() !== topicKey(topic)) return 'stale';
          const result = await detailQuery.refetch();
          handledTopicErrorRef.current = result.errorUpdatedAt;
          return result.error ? readOutcome(topic.source, result.error) : 'completed';
        }
      },
      (recovery) =>
        onNodeSeekTopicVerificationRequired(sourceErrorFromUnknown(topic.source, detailQuery.error).message, recovery)
    );
  }, [
    detailQuery.error,
    detailQuery.errorUpdatedAt,
    detailQuery.refetch,
    handleReadError,
    onNodeSeekTopicVerificationRequired,
    selectedTopic,
    queryClient,
    topicQueryKey,
    topicCommands
  ]);

  const activeQuoteRequests = useMemo(() => {
    const active = { ...quoteRequests };
    if (!selectedTopic) return active;
    topicReplies.forEach((reply) => {
      const replyKey = replyRenderKey(reply);
      quotedPostsForSource(reply, selectedTopic.source).forEach(({ reference }) => {
        const instanceKey = replyQuotedPostInstanceKey(replyKey, reference);
        if (expandedQuotes[instanceKey] && !active[instanceKey]) {
          active[instanceKey] = { prefetch: false, reference };
        }
      });
    });
    return active;
  }, [expandedQuotes, quoteRequests, selectedTopic, topicReplies]);
  const quoteReferences = useMemo(() => {
    const unique = new Map<string, QuotedPostReference>();
    Object.values(activeQuoteRequests).forEach(({ reference }) =>
      unique.set(quotedPostReferenceKey(reference), reference)
    );
    return [...unique.values()];
  }, [activeQuoteRequests]);
  const interactiveQuoteReferenceKeys = useMemo(
    () =>
      new Set(
        Object.values(activeQuoteRequests)
          .filter(({ prefetch }) => !prefetch)
          .map(({ reference }) => quotedPostReferenceKey(reference))
      ),
    [activeQuoteRequests]
  );
  const quoteQueries = useQueries({
    queries: quoteReferences.map((reference) => {
      const readPlan = readGateway.getReadPlan(reference.source, 'reply');
      return {
        queryKey: quotedReplyQueryKey(reference),
        enabled: enabled && isDiscourseSource(reference.source),
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          const trace = beginDiagnosticTrace(
            'reply',
            interactiveQuoteReferenceKeys.has(quotedPostReferenceKey(reference)) ? 'toggle-quote' : 'prefetch-post',
            {
              source: reference.source,
              topicRef: diagnosticRef('topic', `${reference.source}:${reference.topicId}`)
            }
          );
          try {
            const loaded = await readGateway.getReply(
              {
                source: reference.source,
                id: reference.topicId,
                floor: reference.postNumber,
                signal
              },
              { readPlanScope: readPlan.cacheScope, trace }
            );
            if (sourceDiagnosticSummary(loaded)?.isParseEmpty) {
              throw new Error('引用内容解析为空，无法展开，请重试。');
            }
            finishDiagnosticTrace(trace, 'success');
            return loaded;
          } catch (error) {
            finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
              source: reference.source,
              reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
            });
            throw error;
          }
        }
      };
    }),
    combine: combineQuoteQueryResults
  });

  const quoteResults = useMemo(
    () => new Map(quoteReferences.map((reference, index) => [quotedPostReferenceKey(reference), quoteQueries[index]])),
    [quoteQueries, quoteReferences]
  );
  const loadedQuotedReplies = useMemo<Record<string, Reply>>(() => {
    const loaded: Record<string, Reply> = {};
    quoteReferences.forEach((reference, index) => {
      const reply = quoteQueries[index]?.data;
      if (reply) loaded[quotedPostReferenceKey(reference)] = reply;
    });
    return loaded;
  }, [quoteQueries, quoteReferences]);
  const loadingQuotedFloors = useMemo<Record<string, boolean>>(() => {
    const loading: Record<string, boolean> = {};
    Object.entries(activeQuoteRequests).forEach(([instanceKey, { reference }]) => {
      const result = quoteResults.get(quotedPostReferenceKey(reference));
      if (result?.isPending || result?.isFetching) loading[instanceKey] = true;
    });
    return loading;
  }, [activeQuoteRequests, quoteResults]);

  useEffect(() => {
    quoteReferences.forEach((reference, index) => {
      const result = quoteQueries[index];
      const referenceKey = quotedPostReferenceKey(reference);
      if (!interactiveQuoteReferenceKeys.has(referenceKey)) return;
      if (!result?.error || handledQuoteErrorsRef.current[referenceKey] === result.errorUpdatedAt) return;
      handledQuoteErrorsRef.current[referenceKey] = result.errorUpdatedAt;
      const queryKey = quotedReplyQueryKey(reference);
      handleReadError(reference.source, result.error, {
        queryKey,
        resume: async () => {
          if (topicCommands.getCurrentKey() !== selectedTopicKey) return 'stale';
          await queryClient.refetchQueries({ queryKey, exact: true });
          const state = queryClient.getQueryState(queryKey);
          handledQuoteErrorsRef.current[referenceKey] = state?.errorUpdatedAt || 0;
          const error = state?.error;
          return error ? sourceReadRecoveryOutcome(reference.source, error) : 'completed';
        }
      });
    });
  }, [
    handleReadError,
    interactiveQuoteReferenceKeys,
    queryClient,
    quoteQueries,
    quoteReferences,
    quotedReplyQueryKey,
    selectedTopicKey,
    topicCommands
  ]);

  const cancelTopicQueries = useCallback(
    (topic: Topic | null = selectedTopic) => {
      if (topic) {
        const key = topicReadQueryKey(topic);
        void queryClient.cancelQueries({ queryKey: key });
      }
      Object.values(activeQuoteRequests).forEach(({ reference }) => {
        void queryClient.cancelQueries({
          queryKey: quotedReplyQueryKey(reference),
          exact: true
        });
      });
    },
    [activeQuoteRequests, queryClient, quotedReplyQueryKey, selectedTopic, topicReadQueryKey]
  );

  const openTopic = useCallback(
    async (topic: Topic, refresh = false): Promise<LinuxDoReadResumeOutcome> => {
      const currentKey = topicCommands.getCurrentKey();
      const nextKey = topicKey(topic);
      const opensDifferentTopic = Boolean(currentKey && currentKey !== nextKey);
      if (opensDifferentTopic) {
        onOpenTopic(topic);
        return 'completed';
      }
      if (refresh) {
        const key = topicReadQueryKey(topic);
        const replyScope = readGateway.getReadPlan(topic.source, 'replies').cacheScope;
        await queryClient.invalidateQueries({ queryKey: key, exact: true });
        await Promise.all(
          (['oldest', 'newest'] as const).map((order) =>
            queryClient.invalidateQueries({ queryKey: forumQueryKeys.replies(key, order, replyScope), exact: true })
          )
        );
      }
      return 'completed';
    },
    [onOpenTopic, queryClient, readGateway, topicCommands, topicReadQueryKey]
  );

  useEffect(() => {
    if (!active) cancelTopicQueries();
  }, [active, cancelTopicQueries]);

  const refreshWholeTopic = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (!selectedTopic) return 'stale';
    if (selectedReadBlocked) {
      const blockedPlan = topicReadBlocked ? topicReadPlan : repliesReadPlan;
      if (
        blockedPlan.state === 'blocked' &&
        (blockedPlan.reason === 'identity-pending' || blockedPlan.reason === 'identity-unavailable') &&
        isSessionSource(selectedTopic.source)
      ) {
        await onRetryIdentityStatus?.(selectedTopic.source);
      } else if (
        blockedPlan.state === 'blocked' &&
        blockedPlan.reason === 'login-required' &&
        selectedTopic.source === 'yaohuo'
      ) {
        showYaohuoLogin('请先登录妖火后再读取。');
      }
      return 'stale';
    }
    const runAttempt = async (notifySuccess: boolean): Promise<LinuxDoReadResumeOutcome> => {
      const generation = ++replyWindowGenerationRef.current;
      const ownsWindow = () =>
        activeRepliesQueryIdentityRef.current === repliesQueryIdentity &&
        replyWindowGenerationRef.current === generation;
      try {
        const detailResult = await detailQuery.refetch();
        if (!ownsWindow()) return 'stale';
        if (detailResult.error) {
          handledTopicErrorRef.current = detailResult.errorUpdatedAt;
          throw detailResult.error;
        }
        if (!detailResult.data) throw new Error('主题刷新未返回数据');
        if (!(await rebuildRepliesFromDetail(detailResult.data, generation, true))) {
          return 'stale';
        }
        if (notifySuccess) notify('主题已更新');
        return 'completed';
      } catch (error) {
        if (!ownsWindow()) return 'stale';
        const recovery: LinuxDoReadRecovery = {
          queryKey: [...repliesQueryKey, 'whole-refresh'],
          resume: () => runAttempt(false)
        };
        const sourceError = sourceErrorFromUnknown(selectedTopic.source, error);
        setReplyWindowFailure('refresh', replyFailure(selectedTopic.source, error, { kind: 'start' }, 'whole'));
        handleReadError(selectedTopic.source, error, recovery, (candidate) =>
          onNodeSeekTopicVerificationRequired(sourceError.message, candidate)
        );
        return readOutcome(selectedTopic.source, error);
      }
    };
    return runAttempt(true);
  }, [
    activeRepliesQueryIdentityRef,
    handleReadError,
    notify,
    onRetryIdentityStatus,
    onNodeSeekTopicVerificationRequired,
    rebuildRepliesFromDetail,
    repliesQueryIdentity,
    repliesQueryKey,
    repliesReadPlan,
    selectedReadBlocked,
    selectedTopic,
    setReplyWindowFailure,
    showYaohuoLogin,
    detailQuery.refetch,
    topicReadBlocked,
    topicReadPlan
  ]);

  const refreshTopicReplies = useCallback(
    async function refreshReplies(
      command: ReplyRefreshCommand = { kind: 'manual' },
      diagnosticTrace?: DiagnosticTrace
    ): Promise<LinuxDoReadResumeOutcome> {
      if (!selectedTopic || !topicDetail || repliesReadBlocked) return 'stale';

      const generation = ++replyWindowGenerationRef.current;
      const ownsWindow = () =>
        activeRepliesQueryIdentityRef.current === repliesQueryIdentity &&
        replyWindowGenerationRef.current === generation;
      if (command.kind === 'manual') {
        const result = await repliesQuery.refetch();
        if (!ownsWindow()) return 'stale';
        if (result.error) {
          setReplyWindowFailure(
            'refresh',
            replyFailure(selectedTopic.source, result.error, { kind: 'start' }, 'query')
          );
          return readOutcome(selectedTopic.source, result.error);
        }
        clearReplyWindowErrors();
        if (!command.silent) notify('评论已更新');
        return 'completed';
      }

      await queryClient.cancelQueries({ queryKey: repliesQueryKey });
      if (!ownsWindow()) return 'stale';
      const target = command.kind === 'edited' || command.kind === 'deleted' ? command.target : undefined;
      const current = queryClient.getQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey);
      const targetPage = target
        ? current?.pages.find((page) => page.items.some((reply) => matchesReplyRefreshTarget(reply, target)))
        : undefined;
      const capturedPosition = command.kind === 'edited' || command.kind === 'deleted' ? command.position : undefined;
      if (target && !capturedPosition && !targetPage) {
        void queryClient.invalidateQueries({ queryKey: otherRepliesQueryKey, exact: true, refetchType: 'none' });
        return refreshReplies({ kind: 'manual', silent: command.silent });
      }

      const pageNumber = capturedPosition?.page || targetPage?.currentPage || targetPage?.requestedPage || 1;
      const pageOffset = capturedPosition?.offset ?? targetPage?.currentOffset ?? targetPage?.requestedOffset ?? null;
      let refreshedDetail = topicDetail;
      try {
        if (command.kind !== 'edited') {
          const result = await detailQuery.refetch();
          if (!ownsWindow()) return 'stale';
          if (result.error) {
            handledTopicErrorRef.current = result.errorUpdatedAt;
            throw result.error;
          }
          if (!result.data) throw new Error('主题刷新未返回数据');
          refreshedDetail = result.data;
          if (
            (refreshedDetail.replyCount !== undefined &&
              (!Number.isSafeInteger(refreshedDetail.replyCount) || refreshedDetail.replyCount < 0)) ||
            (command.kind === 'created' && refreshedDetail.replyCount === 0)
          ) {
            throw new Error('原站未返回可定位的最新楼层');
          }
        }
        if (!ownsWindow()) return 'stale';

        const hasKnownReplies =
          typeof refreshedDetail.replyCount === 'number'
            ? refreshedDetail.replyCount > 0
            : refreshedDetail.source === 'nodeseek';
        const reanchor =
          command.kind === 'created' ||
          (command.kind === 'deleted' &&
            (refreshedDetail.replyCount === 0 ||
              (!capturedPosition && !targetPage) ||
              (typeof refreshedDetail.replyCount === 'number' &&
                typeof pageOffset === 'number' &&
                pageOffset >= refreshedDetail.replyCount)));
        const position: ReplyPageParam = reanchor
          ? { kind: 'start' }
          : { kind: 'cursor', page: pageNumber, offset: pageOffset };
        const refreshKey = [
          ...forumQueryKeys.replyRefresh(repliesQueryKey, pageNumber, pageOffset, REPLY_PAGE_SIZE),
          command.kind
        ] as const;
        const trace =
          diagnosticTrace ||
          beginDiagnosticTrace('reply', 'refresh', {
            source: selectedTopic.source,
            replyOrder,
            positionKind: reanchor && replyOrder === 'oldest' ? 'target' : position.kind
          });
        const ownsTrace = !diagnosticTrace;
        try {
          const page = await queryClient.fetchQuery({
            queryKey: refreshKey,
            staleTime: 0,
            queryFn: async ({ signal }) => {
              if (reanchor && replyOrder === 'oldest' && hasKnownReplies) {
                const tail = await loadReplyPage(refreshedDetail, 'newest', { kind: 'start' }, signal, trace);
                const latest = tail.items[0];
                const latestTarget: ReplyLocationTarget = {
                  ...(latest?.commentId ? { commentId: latest.commentId } : {}),
                  ...(latest?.floor ? { floor: latest.floor } : {}),
                  ...(tail.currentPage ? { pageHint: tail.currentPage } : {})
                };
                if (!latestTarget.commentId && !latestTarget.floor) {
                  throw new Error('原站未返回可定位的最新回复');
                }
                return loadReplyPage(
                  refreshedDetail,
                  'oldest',
                  { kind: 'target', target: latestTarget },
                  signal,
                  trace
                );
              }
              const loaded = await loadReplyPage(refreshedDetail, replyOrder, position, signal, trace);
              if (command.kind === 'created' && !loaded.items.length) {
                throw new Error('原站未返回可确认的最新回复');
              }
              return loaded;
            }
          });
          if (!ownsWindow()) {
            if (ownsTrace) finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
            return 'stale';
          }

          const deleted = command.kind === 'deleted' ? command.target : undefined;
          const edited =
            command.kind === 'edited'
              ? { commentId: command.target.commentId, contentMarkdown: command.contentMarkdown }
              : undefined;
          const refreshedPage = { ...page, items: removeRepliesForRefresh(page.items, deleted) };
          const pageParam: ReplyCursorPosition = {
            kind: 'cursor',
            page: page.requestedPage,
            offset: page.requestedOffset
          };
          queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, (cached) => {
            if (reanchor || !cached) return { pages: [refreshedPage], pageParams: [pageParam] };
            const pages = cached.pages.slice();
            const pageParams = cached.pageParams.slice();
            const index = pages.findIndex(
              (candidate) =>
                candidate.currentPage === pageNumber && (candidate.currentOffset ?? null) === (pageOffset ?? null)
            );
            if (index < 0) {
              pages.push(refreshedPage);
              pageParams.push(pageParam);
            } else {
              pages[index] = refreshedPage;
              pageParams[index] = pageParam;
            }
            const filtered = pages.map((candidate) => ({
              ...candidate,
              items: removeRepliesForRefresh(candidate.items, deleted)
            }));
            return shouldApplyEditedReplyFallback(refreshedPage.items, edited, selectedTopic.source)
              ? {
                  pages: filtered.map((candidate) => ({
                    ...candidate,
                    items: applyEditedReplyContent(candidate.items, edited!, selectedTopic.source)
                  })),
                  pageParams
                }
              : { pages: filtered, pageParams };
          });
          if (reanchor && replyOrder === 'oldest') {
            targetWindowCacheOwnedRef.current.set(replyOrder, repliesQueryKey);
          }
          void queryClient.invalidateQueries({ queryKey: otherRepliesQueryKey, exact: true, refetchType: 'none' });
          const replyCount = page.totalCount ?? refreshedDetail.replyCount;
          queryClient.setQueryData<TopicDetail>(topicQueryKey, (cached) =>
            cached && typeof replyCount === 'number' ? { ...cached, replyCount } : cached
          );
          setReplyWindowFailuresByKey({});
          if (ownsTrace) {
            finishDiagnosticTrace(trace, 'success', { itemCount: page.items.length, hasMore: Boolean(page.hasMore) });
          } else {
            markDiagnosticStage(trace, 'apply', { state: 'refresh-success', itemCount: page.items.length });
          }
          if (!command.silent) notify('评论已更新');
          return 'completed';
        } catch (error) {
          if (!ownsWindow()) {
            if (ownsTrace) finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
            return 'stale';
          }
          if (ownsTrace) finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          const sourceError = sourceErrorFromUnknown(selectedTopic.source, error);
          setReplyWindowFailure('refresh', replyFailure(selectedTopic.source, error, position, command));
          handleReadError(
            selectedTopic.source,
            error,
            {
              queryKey: refreshKey,
              resume: () =>
                activeRepliesQueryIdentityRef.current === repliesQueryIdentity
                  ? refreshReplies(command)
                  : Promise.resolve('stale')
            },
            (recovery) => onNodeSeekTopicVerificationRequired(sourceError.message, recovery)
          );
          return readOutcome(selectedTopic.source, error);
        } finally {
          queryClient.removeQueries({ queryKey: refreshKey, exact: true });
        }
      } catch (error) {
        if (!ownsWindow()) return 'stale';
        const sourceError = sourceErrorFromUnknown(selectedTopic.source, error);
        setReplyWindowFailure(
          'refresh',
          replyFailure(selectedTopic.source, error, capturedPosition || { kind: 'start' }, command)
        );
        handleReadError(
          selectedTopic.source,
          error,
          {
            queryKey: repliesQueryKey,
            resume: () =>
              activeRepliesQueryIdentityRef.current === repliesQueryIdentity
                ? refreshReplies(command)
                : Promise.resolve('stale')
          },
          (recovery) => onNodeSeekTopicVerificationRequired(sourceError.message, recovery)
        );
        return readOutcome(selectedTopic.source, error);
      }
    },
    [
      activeRepliesQueryIdentityRef,
      clearReplyWindowErrors,
      detailQuery.refetch,
      handleReadError,
      loadReplyPage,
      notify,
      onNodeSeekTopicVerificationRequired,
      otherRepliesQueryKey,
      queryClient,
      refreshWholeTopic,
      repliesQuery.refetch,
      repliesQueryIdentity,
      repliesQueryKey,
      replyOrder,
      repliesReadBlocked,
      selectedTopic,
      setReplyWindowFailure,
      topicDetail,
      topicQueryKey
    ]
  );
  const retryFailedReplies = useCallback(
    async function retryReplyWindow(edge?: ReplyWindowEdge): Promise<LinuxDoReadResumeOutcome> {
      if (
        !selectedTopic ||
        repliesReadBlocked ||
        activeRepliesQueryIdentityRef.current !== repliesQueryIdentity ||
        queryClient.isFetching({ queryKey: repliesQueryKey, exact: true }) > 0
      ) {
        return 'stale';
      }
      const slot = edge || 'refresh';
      const failure = replyWindowFailures[slot];
      if (!failure || failure.retryMode === 'none') return failure ? 'failed' : 'completed';
      if (failure.retryMode === 'whole') return refreshWholeTopic();
      if (typeof failure.retryMode === 'object') return refreshTopicReplies(failure.retryMode);
      if (slot !== 'refresh') {
        const result = slot === 'start' ? await repliesQuery.fetchPreviousPage() : await repliesQuery.fetchNextPage();
        setReplyWindowFailure(
          slot,
          result.error ? replyFailure(selectedTopic.source, result.error, failure.position, 'query') : null
        );
        return result.error ? readOutcome(selectedTopic.source, result.error) : 'completed';
      }
      return refreshTopicReplies({ kind: 'manual', silent: true });
    },
    [
      activeRepliesQueryIdentityRef,
      queryClient,
      refreshTopicReplies,
      refreshWholeTopic,
      repliesQuery.fetchNextPage,
      repliesQuery.fetchPreviousPage,
      repliesQueryIdentity,
      repliesQueryKey,
      replyWindowFailures,
      repliesReadBlocked,
      selectedTopic,
      setReplyWindowFailure
    ]
  );

  useEffect(() => {
    if (!selectedTopic || !repliesQuery.error || handledRepliesErrorRef.current === repliesQuery.errorUpdatedAt) return;
    handledRepliesErrorRef.current = repliesQuery.errorUpdatedAt;
    const failedEdge = repliesQuery.isFetchPreviousPageError
      ? ('start' as const)
      : repliesQuery.isFetchNextPageError
        ? ('end' as const)
        : undefined;
    const slot = failedEdge || 'refresh';
    const sourceError = sourceErrorFromUnknown(selectedTopic.source, repliesQuery.error);
    setReplyWindowFailure(
      slot,
      replyFailure(
        selectedTopic.source,
        repliesQuery.error,
        failedEdge ? replyEdgePosition(repliesQuery.data, failedEdge) : { kind: 'start' },
        'query'
      )
    );
    handleReadError(
      selectedTopic.source,
      repliesQuery.error,
      {
        queryKey: repliesQueryKey,
        resume: async () =>
          topicCommands.getCurrentKey() === topicKey(selectedTopic) ? retryFailedReplies(failedEdge) : 'stale'
      },
      (recovery) => onNodeSeekTopicVerificationRequired(sourceError.message, recovery)
    );
  }, [
    handleReadError,
    onNodeSeekTopicVerificationRequired,
    repliesQuery.data,
    repliesQuery.error,
    repliesQuery.errorUpdatedAt,
    repliesQuery.isFetchNextPageError,
    repliesQuery.isFetchPreviousPageError,
    repliesQueryKey,
    retryFailedReplies,
    selectedTopic,
    setReplyWindowFailure,
    topicCommands
  ]);

  const locateReply = useCallback(
    async (target: ReplyLocationTarget, { silent = false }: { silent?: boolean } = {}) => {
      if (!selectedTopic || !topicDetail || repliesReadBlocked) return 'stale';
      const commentId =
        target.commentId && Number.isSafeInteger(target.commentId) && target.commentId > 0
          ? target.commentId
          : undefined;
      const floor = target.floor && Number.isSafeInteger(target.floor) && target.floor > 0 ? target.floor : undefined;
      if ((target.commentId !== undefined && !commentId) || (!commentId && !floor)) {
        if (!silent) notify('目标楼层未找到');
        return 'failed';
      }
      const pageHint =
        target.pageHint && Number.isSafeInteger(target.pageHint) && target.pageHint > 0 ? target.pageHint : undefined;
      const normalizedTarget: ReplyLocationTarget = {
        ...(commentId ? { commentId } : {}),
        ...(floor ? { floor } : {}),
        ...(pageHint ? { pageHint } : {})
      };
      if (topicReplies.some((reply) => matchesLoadedReplyLocation(reply, normalizedTarget))) {
        replyWindowGenerationRef.current += 1;
        return 'completed';
      }
      const targetQueryKey = [...targetReplyQueryRoot, floor ?? null, commentId ?? null, pageHint ?? null] as const;
      const generation = ++replyWindowGenerationRef.current;
      const loadTargetWindow = async () => {
        if (
          activeRepliesQueryIdentityRef.current !== repliesQueryIdentity ||
          replyWindowGenerationRef.current !== generation
        ) {
          return 'stale' as const;
        }
        await queryClient.cancelQueries({ queryKey: repliesQueryKey, exact: true });
        if (
          activeRepliesQueryIdentityRef.current !== repliesQueryIdentity ||
          replyWindowGenerationRef.current !== generation
        ) {
          return 'stale' as const;
        }
        const cachedReplies = mergedReplyPages(
          queryClient.getQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey)
        );
        if (cachedReplies.some((reply) => matchesLoadedReplyLocation(reply, normalizedTarget)))
          return 'completed' as const;
        const currentDetail = queryClient.getQueryData<TopicDetail>(topicQueryKey) || topicDetail;
        const trace = beginDiagnosticTrace('reply', 'load-more', {
          source: selectedTopic.source,
          topicRef: diagnosticRef('topic', `${selectedTopic.source}:${currentDetail.id}`),
          replyOrder,
          positionKind: 'target'
        });
        try {
          const position = { kind: 'target', target: normalizedTarget } satisfies ReplyPageParam;
          const page = await queryClient.fetchQuery({
            queryKey: targetQueryKey,
            queryFn: ({ signal }) => loadReplyPage(currentDetail, replyOrder, position, signal, trace)
          });
          if (
            activeRepliesQueryIdentityRef.current !== repliesQueryIdentity ||
            replyWindowGenerationRef.current !== generation
          ) {
            queryClient.removeQueries({ queryKey: targetQueryKey, exact: true });
            finishDiagnosticTrace(trace, 'stale', {
              source: selectedTopic.source,
              reason: 'stale',
              replyOrder,
              positionKind: 'target'
            });
            return 'stale' as const;
          }
          const resolvedPage = page.currentPage!;
          const resolvedOffset = page.currentOffset ?? null;
          queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, {
            pages: [page],
            pageParams: [{ kind: 'cursor', page: resolvedPage, offset: resolvedOffset }]
          });
          clearReplyWindowErrors(true);
          targetWindowCacheOwnedRef.current.set(replyOrder, repliesQueryKey);
          queryClient.removeQueries({ queryKey: targetQueryKey, exact: true });
          finishDiagnosticTrace(trace, 'success', {
            itemCount: page.items.length,
            hasMore: Boolean(nextReplyPage(page)),
            replyOrder,
            positionKind: 'target',
            resolvedPage
          });
          if (!silent) notify(`已定位到第 ${floor} 楼`);
          return 'completed' as const;
        } catch (error) {
          if (
            activeRepliesQueryIdentityRef.current !== repliesQueryIdentity ||
            replyWindowGenerationRef.current !== generation
          ) {
            queryClient.removeQueries({ queryKey: targetQueryKey, exact: true });
            finishDiagnosticTrace(trace, 'stale', {
              source: selectedTopic.source,
              reason: 'stale',
              replyOrder,
              positionKind: 'target'
            });
            return 'stale' as const;
          }
          finishDiagnosticTrace(trace, isCanceledRequest(error) ? 'canceled' : 'failure', {
            source: selectedTopic.source,
            reason: isCanceledRequest(error) ? 'canceled' : normalizeDiagnosticReason(error)
          });
          throw error;
        }
      };
      try {
        return await loadTargetWindow();
      } catch (error) {
        const recovery: LinuxDoReadRecovery = {
          queryKey: targetQueryKey,
          resume: async () => {
            queryClient.removeQueries({ queryKey: targetQueryKey, exact: true });
            try {
              return await loadTargetWindow();
            } catch (retryError) {
              return readOutcome(selectedTopic.source, retryError);
            }
          }
        };
        const sourceError = sourceErrorFromUnknown(selectedTopic.source, error);
        handleReadError(selectedTopic.source, error, recovery, (candidate) =>
          onNodeSeekTopicVerificationRequired(sourceError.message, candidate)
        );
        return readOutcome(selectedTopic.source, error);
      }
    },
    [
      activeRepliesQueryIdentityRef,
      clearReplyWindowErrors,
      handleReadError,
      loadReplyPage,
      notify,
      onNodeSeekTopicVerificationRequired,
      queryClient,
      repliesQueryKey,
      replyOrder,
      repliesReadBlocked,
      selectedTopic,
      targetReplyQueryRoot,
      topicDetail,
      topicQueryKey,
      topicReplies
    ]
  );

  useEffect(() => {
    if (!targetReply || !topicDetail || !selectedTopic || repliesReadBlocked) return;
    const sessionEpoch = selectedTopic.source === 'v2ex' ? 0 : sessionEpochs[selectedTopic.source];
    const targetKey = `${topicKey(selectedTopic)}:${sessionEpoch}:${targetReply.commentId ?? ''}:${targetReply.floor ?? ''}:${targetReply.pageHint ?? ''}:request:${targetReplyRequestId ?? ''}`;
    if (handledRouteTargetRef.current === targetKey) return;
    handledRouteTargetRef.current = targetKey;
    void locateReply(targetReply, { silent: true });
  }, [
    locateReply,
    repliesReadBlocked,
    selectedTopic,
    sessionEpochs,
    targetReply,
    targetReplyRequestId,
    topicDetail,
    topicReplies
  ]);

  const loadPreviousReplies = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<LinuxDoReadResumeOutcome> => {
      if (!selectedTopic || repliesReadBlocked) return 'stale';
      if (!repliesQuery.hasPreviousPage || queryClient.isFetching({ queryKey: repliesQueryKey, exact: true }) > 0) {
        return 'completed';
      }
      const result = await repliesQuery.fetchPreviousPage();
      if (result.error) {
        setReplyWindowFailure(
          'start',
          replyFailure(selectedTopic.source, result.error, replyEdgePosition(result.data, 'start'), 'query')
        );
        return readOutcome(selectedTopic.source, result.error);
      }
      setReplyWindowFailure('start', null);
      const loaded = result.data?.pages[0]?.items.length || 0;
      if (!silent) notify(`已加载 ${loaded} 条${replyOrder === 'newest' ? '更新' : '更早'}回复`);
      return 'completed';
    },
    [
      notify,
      queryClient,
      repliesQuery.fetchPreviousPage,
      repliesQuery.hasPreviousPage,
      repliesQueryKey,
      replyOrder,
      repliesReadBlocked,
      selectedTopic,
      setReplyWindowFailure
    ]
  );

  const loadMoreReplies = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<LinuxDoReadResumeOutcome> => {
      if (!selectedTopic || repliesReadBlocked) return 'stale';
      if (!repliesQuery.hasNextPage || queryClient.isFetching({ queryKey: repliesQueryKey, exact: true }) > 0) {
        return 'completed';
      }
      const result = await repliesQuery.fetchNextPage();
      if (result.error) {
        setReplyWindowFailure(
          'end',
          replyFailure(selectedTopic.source, result.error, replyEdgePosition(result.data, 'end'), 'query')
        );
        return readOutcome(selectedTopic.source, result.error);
      }
      setReplyWindowFailure('end', null);
      const loaded = result.data?.pages.at(-1)?.items.length || 0;
      if (!silent) notify(`已加载 ${loaded} 条回复`);
      return 'completed';
    },
    [
      notify,
      queryClient,
      repliesQuery.fetchNextPage,
      repliesQuery.hasNextPage,
      repliesQueryKey,
      repliesReadBlocked,
      selectedTopic,
      setReplyWindowFailure
    ]
  );

  const toggleLoadedQuotedPost = useCallback(
    async ({
      instanceKey,
      prefetch = false,
      quotedPost,
      reference
    }: ToggleTopicBodyQuoteOptions): Promise<LinuxDoReadResumeOutcome> => {
      if (readGateway.getReadPlan(reference.source, 'reply').state === 'blocked') return 'stale';
      if (!prefetch && topicQuotes.isExpanded(instanceKey)) {
        topicQuotes.changeExpanded(instanceKey, false);
        return 'completed';
      }
      const cachedTopic =
        reference.postNumber === 1
          ? queryClient.getQueryData<TopicDetail>(
              topicReadQueryKey({ source: reference.source, id: reference.topicId })
            )
          : undefined;
      const reusableCandidate = quotedPost || (cachedTopic ? topicOpeningPostAsReply(cachedTopic) : undefined);
      const reusableQuotedPost = reusableCandidate
        ? prepareReplyContent(reusableCandidate, reference.source, 'quoted-reply')
        : undefined;
      if (!isDiscourseSource(reference.source) && !reusableQuotedPost) {
        if (!prefetch) {
          topicQuotes.changeExpanded(instanceKey, true);
          notify('引用楼层未加载');
        }
        return 'failed';
      }
      const queryKey = quotedReplyQueryKey(reference);
      const queryState = queryClient.getQueryState(queryKey);
      if (!reusableQuotedPost && queryState?.status === 'error') {
        handledQuoteErrorsRef.current[quotedPostReferenceKey(reference)] = queryState.errorUpdatedAt;
        void queryClient.refetchQueries({ queryKey, exact: true });
      }
      if (reusableQuotedPost) queryClient.setQueryData(queryKey, reusableQuotedPost);
      setQuoteRequests((current) => ({ ...current, [instanceKey]: { prefetch, reference } }));
      if (!prefetch) {
        topicQuotes.changeExpanded(instanceKey, true);
      }
      return 'completed';
    },
    [notify, queryClient, quotedReplyQueryKey, readGateway, topicQuotes, topicReadQueryKey]
  );

  const toggleTopicBodyQuote = useCallback(
    (options: ToggleTopicBodyQuoteOptions) => toggleLoadedQuotedPost(options),
    [toggleLoadedQuotedPost]
  );

  const toggleReplyQuote = useCallback(
    ({ replyKey, reference, quotedReply }: ToggleReplyQuoteOptions) => {
      if (!selectedTopic || selectedTopic.source !== reference.source) {
        notify('引用楼层未加载');
        return;
      }
      return toggleLoadedQuotedPost({
        instanceKey: replyQuotedPostInstanceKey(replyKey, reference),
        reference,
        quotedPost: quotedReply
      });
    },
    [notify, selectedTopic, toggleLoadedQuotedPost]
  );

  const currentTopic = topicDetail || selectedTopic;
  const currentTopicKey = currentTopic ? topicKey(currentTopic) : null;
  const topicError =
    !topicDetail && detailQuery.error && selectedTopic
      ? sourceErrorFromUnknown(selectedTopic.source, detailQuery.error)
      : null;
  const topicFavorite = Boolean(currentTopic && readerData.favorites[topicKey(currentTopic)]);
  const unreadReplyCount =
    typeof topicDetail?.replyCount === 'number'
      ? Math.max(
          0,
          topicDetail.replyCount - (unreadBaselineRef.current[topicKey(topicDetail)] || topicDetail.replyCount)
        )
      : 0;

  return {
    cancelTopicQueries,
    currentTopic,
    currentTopicKey,
    loadPreviousReplies,
    loadMoreReplies,
    locateReply,
    loadedQuotedReplies,
    loadingMoreReplies: loadingTargetReply || repliesQuery.isFetchingNextPage,
    loadingPreviousReplies: repliesQuery.isFetchingPreviousPage,
    loadingQuotedFloors,
    openTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    repliesError:
      replyWindowFailures.refresh?.error ||
      (repliesQuery.error &&
      !repliesQuery.isFetchPreviousPageError &&
      !repliesQuery.isFetchNextPageError &&
      selectedTopic
        ? sourceErrorFromUnknown(selectedTopic.source, repliesQuery.error)
        : null),
    replyStartError: replyWindowFailures.start?.error || null,
    replyEndError: replyWindowFailures.end?.error || null,
    repliesLoading:
      enabled &&
      Boolean(topicDetail) &&
      ((repliesQuery.isPending && !repliesQuery.data) ||
        (Boolean(replyWindowFailures.refresh) && detailQuery.isFetching)),
    retryReplies: retryFailedReplies,
    replyRowsPartial,
    replyCollectionComplete,
    replyHasPrevious,
    replyHasMore,
    replyNextOffset,
    replyNextPage,
    toggleReplyQuote,
    toggleTopicBodyQuote,
    topicBusy: enabled && (detailQuery.isPending || (!topicDetail && detailQuery.isFetching)),
    topicDetail,
    topicError,
    topicFavorite,
    topicQueryKey,
    topicReplies,
    unreadReplyCount
  };
}
