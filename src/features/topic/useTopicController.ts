import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { topicKey } from '@/domain/reader/readerData';
import type { ReaderCommand, ReaderView } from '@/domain/reader/readerRecordState';
import { readHistoryReplyBaseline } from '@/platform/storage/readerDataStore';
import { replyKey as replyRenderKey } from '@/domain/forum/feed';
import { findReplyLocation } from '@/domain/forum/replyLocation';
import { resolveTopicLocation, topicLocationForReply } from '@/domain/forum/topicLocation';
import { isCanceledRequest } from '@/platform/network/errors';
import { RequestCanceledError } from '@/platform/network/request';
import {
  firstReplyData,
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
  replaceConfirmedReplyBody,
  shouldApplyEditedReplyFallback,
  updateConfirmedReplyCaches
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
  TopicLocationTarget,
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
import { sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys, forumReplyWindowKeys } from '@/platform/query/serverState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { prepareReplyContent } from '@/domain/forum/topicContentSplit';
import { useTopicReadingEntry } from './useTopicReadingEntry';
import { createTopicEntryVisit } from './model/topicEntryVisit';
import { isTopicAccessNotice } from './model/topicOpeningPresentation';
import {
  useTopicReplyWindow,
  type ReplyWindowRun,
  type ReplyRetryMode,
  type ReplyFailure
} from './useTopicReplyWindow';
import { findReadingResumeReply } from '@/domain/forum/discourseReading';

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

function replyFailure(
  source: Source,
  error: unknown,
  position: ReplyWindowPosition,
  retryMode: ReplyRetryMode
): ReplyFailure {
  const sourceError = sourceErrorFromUnknown(source, error);
  return { error: retryMode === 'none' ? { ...sourceError, retryable: false } : sourceError, position, retryMode };
}

function replyLocationTarget(reply: Reply | undefined, pageHint?: number): ReplyLocationTarget | undefined {
  if (!reply?.commentId && !reply?.floor) return undefined;
  return {
    ...(reply.commentId ? { commentId: reply.commentId } : {}),
    ...(reply.floor ? { floor: reply.floor } : {}),
    ...(pageHint ? { pageHint } : {})
  };
}

const readOutcome = sourceReadRecoveryOutcome;

export function useTopicController({
  focused,
  appActive,
  commitReaderData,
  sessionEpochs = initialForumSessionEpochs,
  notify,
  onRetryIdentityStatus,
  onNodeSeekTopicVerificationRequired,
  onOpenTopic,
  onReplyLocationResolved,
  readerData,
  showLinuxDoVerification,
  showYaohuoLogin,
  readGateway,
  location,
  locationRequestId,
  topic,
  topicSession
}: {
  focused: boolean;
  appActive: boolean;
  commitReaderData: (command: ReaderCommand) => void;
  sessionEpochs?: ForumSessionEpochs;
  notify: (message: string) => void;
  onRetryIdentityStatus?: (source: SessionSource) => Promise<unknown> | unknown;
  onNodeSeekTopicVerificationRequired: (message: string, recovery: LinuxDoReadRecovery) => void;
  onOpenTopic: (topic: Topic) => void;
  onReplyLocationResolved?: (location: TopicLocationTarget) => void;
  readerData: ReaderView;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  showYaohuoLogin: (message?: string) => void;
  readGateway: ReadGateway;
  location?: TopicLocationTarget;
  locationRequestId?: number;
  topic: Topic;
  topicSession: TopicSessionController;
}) {
  const queryClient = useQueryClient();
  const {
    state: { expandedQuotes, replyOrder, selectedTopic: sessionTopic },
    commands: { quotes: topicQuotes, topic: topicCommands }
  } = topicSession;
  const selectedTopic = sessionTopic || topic;
  type QuoteRequest = Pick<ToggleTopicBodyQuoteOptions, 'prefetch' | 'reference'>;
  const [quoteRequests, setQuoteRequests] = useState<Record<string, QuoteRequest>>({});
  const [authorRequests, setAuthorRequests] = useState<{ scope: string; requests: Record<string, QuoteRequest> }>({
    scope: '',
    requests: {}
  });
  const [unreadBaseline, setUnreadBaseline] = useState<
    ({ key: string } & Pick<Topic, 'replyCount' | 'replyWatermark'>) | null
  >(null);
  const baselineKey = topicKey(topic);
  const recordedTopicUpdateRef = useRef<{ topicKey: string; updateKey: string } | null>(null);
  const handledTopicErrorRef = useRef(0);
  const handledRepliesErrorRef = useRef(0);
  const handledQuoteErrorsRef = useRef<Record<string, number>>({});
  const selectedSource = selectedTopic.source;
  const selectedTopicId = selectedTopic.id;
  const selectedTopicKey = topicKey(selectedTopic);
  const lastPromptedYaohuoTopicKeyRef = useRef<string | null>(null);
  const topicReadPlan = readGateway.getReadPlan(selectedSource, 'topic');
  const repliesReadPlan = readGateway.getReadPlan(selectedSource, 'replies');
  const topicReadBlocked = topicReadPlan.state === 'blocked';
  const repliesReadBlocked = repliesReadPlan.state === 'blocked';
  const selectedReadBlocked = topicReadBlocked || repliesReadBlocked;
  const active = focused && appActive;
  const enabled = focused;
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
      sessionEpochs.yaohuo,
      selectedSource,
      selectedTopicId,
      topicReadPlan.cacheScope
    ]
  );
  const replyWindowOwner = useId();
  const [centeredWindowOrders, setCenteredWindowOrders] = useState<{
    scope: string;
    orders: readonly ReplyOrder[];
  }>({ scope: '', orders: [] });
  const sharedRepliesQueryKey = useMemo(
    () => forumQueryKeys.replies(topicQueryKey, replyOrder, repliesReadPlan.cacheScope),
    [repliesReadPlan.cacheScope, replyOrder, topicQueryKey]
  );
  const scopedRepliesQueryKey = useMemo(
    () => forumQueryKeys.replies(topicQueryKey, replyOrder, repliesReadPlan.cacheScope, replyWindowOwner),
    [repliesReadPlan.cacheScope, replyOrder, replyWindowOwner, topicQueryKey]
  );
  const replyWindowScope = JSON.stringify([topicQueryKey, repliesReadPlan.cacheScope]);
  const replyOrderScope = JSON.stringify(sharedRepliesQueryKey);
  const repliesQueryKey =
    centeredWindowOrders.scope === replyWindowScope && centeredWindowOrders.orders.includes(replyOrder)
      ? scopedRepliesQueryKey
      : sharedRepliesQueryKey;
  const entryKey = JSON.stringify(topicQueryKey);
  const [entryVisitRef] = useState(() => ({
    current: createTopicEntryVisit(entryKey, Boolean(queryClient.getQueryData(topicQueryKey)))
  }));
  if (entryVisitRef.current.key !== entryKey)
    entryVisitRef.current = createTopicEntryVisit(entryKey, Boolean(queryClient.getQueryData(topicQueryKey)));
  const entryVisit = entryVisitRef.current;
  const ordinaryLinuxDoTopic =
    selectedSource === 'linuxdo' &&
    !selectedTopic.isPrivateMessage &&
    !queryClient.getQueryData<Topic>(topicQueryKey)?.isPrivateMessage;
  const otherRepliesQueryKey = useMemo(() => {
    const order = replyOrder === 'oldest' ? 'newest' : 'oldest';
    const owner =
      centeredWindowOrders.scope === replyWindowScope && centeredWindowOrders.orders.includes(order)
        ? replyWindowOwner
        : undefined;
    return forumQueryKeys.replies(topicQueryKey, order, repliesReadPlan.cacheScope, owner);
  }, [centeredWindowOrders, repliesReadPlan.cacheScope, replyOrder, replyWindowOwner, replyWindowScope, topicQueryKey]);
  const repliesQueryIdentity = JSON.stringify(repliesQueryKey);
  const activeRepliesQueryIdentityRef = useCommittedRef(enabled && !selectedReadBlocked ? repliesQueryIdentity : '');
  const {
    lifecycle: replyWindows,
    failures: replyWindowFailures,
    recordFailure: recordReplyWindowFailure,
    clearErrors: clearReplyWindowErrors,
    clearAllErrors: clearAllReplyWindowErrors
  } = useTopicReplyWindow(replyOrderScope, () => activeRepliesQueryIdentityRef.current);
  const activateCenteredReplyWindow = useCallback(
    (openingMayBeStale: boolean) => {
      if (openingMayBeStale)
        void queryClient.invalidateQueries({ queryKey: sharedRepliesQueryKey, exact: true, refetchType: 'none' });
      setCenteredWindowOrders((current) => {
        if (current.scope !== replyWindowScope) return { scope: replyWindowScope, orders: [replyOrder] };
        return current.orders.includes(replyOrder) ? current : { ...current, orders: [...current.orders, replyOrder] };
      });
    },
    [queryClient, replyOrder, replyWindowScope, sharedRepliesQueryKey]
  );
  const interactionActiveRef = useCommittedRef(active);
  const isReadRecoveryCurrent = useCallback(
    () => interactionActiveRef.current && activeRepliesQueryIdentityRef.current === repliesQueryIdentity,
    [activeRepliesQueryIdentityRef, interactionActiveRef, repliesQueryIdentity]
  );
  const targetReplyQueryRoot = useMemo(
    () => [...scopedRepliesQueryKey, 'target-floor'] as const,
    [scopedRepliesQueryKey]
  );
  const rebuildRepliesQueryRoot = useMemo(
    () => [...scopedRepliesQueryKey, 'rebuild-start'] as const,
    [scopedRepliesQueryKey]
  );
  const isReplyWindowFetching = useCallback(
    () =>
      queryClient.isFetching({ queryKey: repliesQueryKey, exact: true }) > 0 ||
      queryClient.isFetching({ queryKey: rebuildRepliesQueryRoot }) > 0,
    [queryClient, rebuildRepliesQueryRoot, repliesQueryKey]
  );
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
    (reference: QuotedPostReference, plan = readGateway.getReadPlan(reference.source, 'reply')) =>
      forumQueryKeys.reply({
        postNumber: reference.postNumber,
        readPlanScope: plan.cacheScope,
        scope: sessionEpochs,
        source: reference.source,
        topicId: reference.topicId
      }),
    [readGateway, sessionEpochs]
  );

  useEffect(
    () => () => {
      activeRepliesQueryIdentityRef.current = '';
      replyWindows.releaseRouteQueries((queryKey) => queryClient.removeQueries({ queryKey }));
    },
    [activeRepliesQueryIdentityRef, queryClient, replyWindows]
  );

  const detailQuery = useQuery({
    queryKey: topicQueryKey,
    enabled: enabled && (!ordinaryLinuxDoTopic || !entryVisit.settled),
    subscribed: focused,
    queryFn: async ({ signal }) => {
      const topic = selectedTopic;
      const trackVisit = ordinaryLinuxDoTopic && entryVisit.claimVisit();
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
        if (!signal.aborted) entryVisit.settleRequest();
        return detail;
      } catch (error) {
        if (!signal.aborted && !isCanceledRequest(error)) entryVisit.settleRequest();
        finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', {
          source: topic.source,
          reason: signal.aborted ? 'canceled' : normalizeDiagnosticReason(error)
        });
        throw error;
      }
    }
  });

  const topicDetail = detailQuery.data || null;
  const replyAccessDenied = useMemo(() => Boolean(topicDetail && isTopicAccessNotice(topicDetail)), [topicDetail]);
  const canReadReplyWindow = useCallback(() => {
    if (repliesReadBlocked) return false;
    const detail = queryClient.getQueryData<TopicDetail>(topicQueryKey);
    return !detail || !isTopicAccessNotice(detail);
  }, [queryClient, repliesReadBlocked, topicQueryKey]);
  const commitReplySnapshot = useCallback(
    (totalCount?: number, replyWatermark?: number, replaceEditedBody?: (replies: Reply[]) => Reply[]) => {
      const count = Number.isSafeInteger(totalCount) && totalCount! >= 0 ? totalCount : undefined;
      const watermark = Number.isSafeInteger(replyWatermark) && replyWatermark! >= 0 ? replyWatermark : undefined;
      if (count !== undefined || watermark !== undefined || replaceEditedBody)
        queryClient.setQueryData<TopicDetail>(
          topicQueryKey,
          (cached) => {
            if (!cached) return undefined;
            return {
              ...cached,
              replies: replaceEditedBody?.(cached.replies) ?? cached.replies,
              ...(count !== undefined ? { replyCount: count } : {}),
              ...(watermark !== undefined ? { replyWatermark: watermark } : {})
            };
          },
          { updatedAt: queryClient.getQueryState(topicQueryKey)?.dataUpdatedAt }
        );
      void queryClient.invalidateQueries({ queryKey: topicQueryKey, exact: true, refetchType: 'none' });
      void queryClient.invalidateQueries({ queryKey: otherRepliesQueryKey, exact: true, refetchType: 'none' });
    },
    [otherRepliesQueryKey, queryClient, topicQueryKey]
  );
  const readingEntry = useTopicReadingEntry({
    active,
    focused,
    topic: selectedTopic,
    detail: topicDetail,
    location: replyAccessDenied ? { kind: 'opening' } : location,
    visit: entryVisit,
    gateway: readGateway,
    commit: commitReaderData
  });
  const resolvedLocation = resolveTopicLocation(topicDetail, readingEntry.location);
  const targetReply = resolvedLocation?.kind === 'reply' ? resolvedLocation.target : undefined;
  const targetSessionEpoch = selectedSource === 'v2ex' ? 0 : sessionEpochs[selectedSource];
  const routeTargetKey = targetReply
    ? `${selectedTopicKey}:${targetSessionEpoch}:${targetReply.commentId ?? ''}:${targetReply.floor ?? ''}:${targetReply.pageHint ?? ''}:${targetReply.expectedAuthorUsername ?? ''}:request:${locationRequestId ?? ''}`
    : '';
  const targetBelongsToPreviousWindow = replyWindows.routeQueryChanged(routeTargetKey, replyOrderScope);
  useEffect(() => {
    if (ordinaryLinuxDoTopic || !topicDetail || unreadBaseline?.key === baselineKey) return;
    let active = true;
    void readHistoryReplyBaseline(baselineKey).then(
      (baseline) => {
        if (active) setUnreadBaseline({ key: baselineKey, ...baseline });
      },
      () => {
        if (active) setUnreadBaseline({ key: baselineKey });
      }
    );
    return () => {
      active = false;
    };
  }, [baselineKey, ordinaryLinuxDoTopic, topicDetail, unreadBaseline]);

  const loadReplyPage = useCallback(
    async (
      detail: TopicDetail,
      order: ReplyOrder,
      position: ReplyPageParam,
      signal: AbortSignal | undefined,
      trace: ReturnType<typeof beginDiagnosticTrace>
    ): Promise<ReplyPage> => {
      if (!canReadReplyWindow() || isTopicAccessNotice(detail)) throw new RequestCanceledError();
      const loaded = await readGateway.getReplies(
        {
          source: detail.source,
          id: detail.id,
          categoryId: detail.categoryId,
          ...(detail.isPrivateMessage ? { isPrivateMessage: true } : {}),
          order,
          position,
          replyCount: detail.replyCount,
          limit: REPLY_PAGE_SIZE,
          signal
        },
        { plan: repliesReadPlan, trace }
      );
      if (!canReadReplyWindow()) throw new RequestCanceledError();
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
    [canReadReplyWindow, readGateway, selectedSource, repliesReadPlan.cacheScope]
  );
  const topicCacheInvalidated = queryClient.getQueryState(topicQueryKey)?.isInvalidated;
  const initialReplies = useMemo(
    () =>
      enabled && topicDetail && !topicCacheInvalidated && !replyAccessDenied
        ? firstReplyData(topicDetail, replyOrder)
        : undefined,
    [enabled, replyAccessDenied, replyOrder, topicDetail, topicCacheInvalidated]
  );
  const replyEntry = useRef({ key: repliesQueryIdentity, settled: false });
  if (replyEntry.current.key !== repliesQueryIdentity)
    replyEntry.current = { key: repliesQueryIdentity, settled: false };
  const cachedReplyPages = queryClient.getQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey);
  const needsOpeningWindow = Boolean(
    enabled &&
    !replyAccessDenied &&
    ordinaryLinuxDoTopic &&
    readingEntry.ready &&
    !replyEntry.current.settled &&
    !targetReply &&
    cachedReplyPages?.pages[0] &&
    previousReplyPage(cachedReplyPages.pages[0], cachedReplyPages.pages)
  );
  useEffect(() => {
    if (!needsOpeningWindow) return;
    // Resetting the Query would revive its obsolete initialData from the topic response.
    queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, { pages: [], pageParams: [] });
    void queryClient.invalidateQueries({ queryKey: repliesQueryKey, exact: true, refetchType: 'none' });
  }, [needsOpeningWindow, queryClient, repliesQueryKey]);
  const repliesQuery = useInfiniteQuery({
    queryKey: repliesQueryKey,
    subscribed: focused,
    // InfiniteQuery retains old pages; index-based deep sharing clones them when a page is prepended.
    structuralSharing: false,
    enabled:
      enabled &&
      !replyAccessDenied &&
      readingEntry.ready &&
      !needsOpeningWindow &&
      Boolean(topicDetail) &&
      (!ordinaryLinuxDoTopic || !replyEntry.current.settled) &&
      (!targetReply || (!ordinaryLinuxDoTopic && Boolean(initialReplies)) || targetBelongsToPreviousWindow),
    initialPageParam: { kind: 'start' } satisfies ReplyPageParam,
    initialData: initialReplies,
    initialDataUpdatedAt: initialReplies ? detailQuery.dataUpdatedAt || undefined : undefined,
    refetchOnMount: true,
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
        if (!signal.aborted) commitReplySnapshot(page.totalCount, page.replyWatermark);
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
    if (replyAccessDenied) return;
    if (
      (readingEntry.ready &&
        !needsOpeningWindow &&
        repliesQuery.data &&
        !repliesQuery.isStale &&
        !queryClient.getQueryState(repliesQueryKey)?.isInvalidated) ||
      repliesQuery.isError
    )
      replyEntry.current.settled = true;
  }, [
    readingEntry.ready,
    needsOpeningWindow,
    replyAccessDenied,
    repliesQuery.data,
    repliesQuery.isError,
    repliesQuery.isStale,
    repliesQueryIdentity,
    queryClient,
    repliesQueryKey
  ]);

  useEffect(() => {
    if (!initialReplies || queryClient.getQueryData(repliesQueryKey)) return;
    queryClient.setQueryData(repliesQueryKey, initialReplies, { updatedAt: detailQuery.dataUpdatedAt });
  }, [detailQuery.dataUpdatedAt, initialReplies, queryClient, repliesQueryKey]);

  const replyData = replyAccessDenied
    ? undefined
    : (repliesQuery.data as InfiniteData<ReplyPage, ReplyPageParam> | undefined);
  const topicReplies = useMemo(() => mergedReplyPages(replyData), [replyData]);
  const firstReplyPage = replyData?.pages[0];
  const replyPreviousCursor = firstReplyPage ? previousReplyPage(firstReplyPage, replyData?.pages) : undefined;
  const lastReplyPage = replyData?.pages.at(-1);
  const replyHasPrevious = !replyAccessDenied && Boolean(repliesQuery.hasPreviousPage);
  const replyHasMore = !replyAccessDenied && Boolean(repliesQuery.hasNextPage);
  const nextReplyCursor = lastReplyPage ? nextReplyPage(lastReplyPage) : undefined;
  const replyNextPage = nextReplyCursor?.page ?? null;
  const replyNextOffset = nextReplyCursor?.offset ?? null;

  const replyRowsPartial = Boolean(
    !replyAccessDenied &&
    (replyData?.pages.some((page) => page.completeness !== 'complete') ||
      (!replyData && topicDetail?.replies.length && topicDetail.replyCompleteness !== 'complete'))
  );
  const rebuildReplyWindow = useCallback(
    async (detail: TopicDetail, windowRun: ReplyWindowRun, refresh: 'topic' | 'replies') => {
      const ownsWindow = windowRun.isCurrent;
      if (isTopicAccessNotice(detail)) return ownsWindow();
      const wholeTopic = refresh === 'topic';
      const replyKeys = wholeTopic ? [repliesQueryKey, otherRepliesQueryKey] : [repliesQueryKey];
      await Promise.all(replyKeys.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true })));
      if (!ownsWindow()) return false;

      let rebuilt = wholeTopic ? firstReplyData(detail, replyOrder) : undefined;
      if (!rebuilt) {
        const queryKey = [...rebuildRepliesQueryRoot, refresh] as const;
        replyWindows.trackRouteQueries(scopedRepliesQueryKey);
        const trace = beginDiagnosticTrace('reply', 'refresh', {
          source: detail.source,
          topicRef: diagnosticRef('topic', `${detail.source}:${detail.id}`),
          replyOrder,
          positionKind: 'start'
        });
        try {
          const page = await queryClient.query({
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
          commitReplySnapshot(page.totalCount, page.replyWatermark);
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
      queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, rebuilt);
      if (wholeTopic) {
        queryClient.removeQueries({ queryKey: otherRepliesQueryKey, exact: true });
        clearAllReplyWindowErrors();
      } else clearReplyWindowErrors();
      return true;
    },
    [
      clearReplyWindowErrors,
      commitReplySnapshot,
      loadReplyPage,
      queryClient,
      otherRepliesQueryKey,
      rebuildRepliesQueryRoot,
      repliesQueryKey,
      replyOrder,
      replyWindows,
      scopedRepliesQueryKey,
      clearAllReplyWindowErrors
    ]
  );
  const showYaohuoLoginForRead = useCallback(
    (reason?: SourceErrorInfo) => {
      const lastPromptedTopicKey = lastPromptedYaohuoTopicKeyRef.current;
      if (
        !interactionActiveRef.current ||
        topicCommands.getCurrentKey() !== selectedTopicKey ||
        lastPromptedTopicKey === selectedTopicKey
      )
        return;
      lastPromptedYaohuoTopicKeyRef.current = selectedTopicKey;
      showYaohuoLogin(
        !reason
          ? '请先登录妖火后再读取。'
          : reason.kind === 'login-expired'
            ? '妖火登录已失效，请重新登录。'
            : reason.message
      );
    },
    [interactionActiveRef, selectedTopicKey, showYaohuoLogin, topicCommands]
  );
  const handleReadError = useCallback(
    (
      source: Source,
      error: unknown,
      recovery: LinuxDoReadRecovery,
      nodeSeekFallback?: (recovery: LinuxDoReadRecovery) => void
    ): SourceErrorInfo => {
      const sourceError = sourceErrorFromUnknown(source, error);
      const isCurrent = () => interactionActiveRef.current && (recovery.isCurrent || isReadRecoveryCurrent)();
      const currentRecovery: LinuxDoReadRecovery = {
        ...recovery,
        isCurrent,
        resume: () => (isCurrent() ? recovery.resume() : Promise.resolve('stale'))
      };
      if (source === 'linuxdo' && sourceError.kind === 'verification-required') {
        void showLinuxDoVerification(sourceError.message, currentRecovery);
      } else if (source === 'nodeseek' && sourceError.kind === 'verification-required') {
        nodeSeekFallback?.(currentRecovery);
      } else if (source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
        showYaohuoLoginForRead(sourceError);
      } else if (!isCanceledRequest(error)) {
        notify(sourceError.message);
      }
      return sourceError;
    },
    [interactionActiveRef, isReadRecoveryCurrent, notify, showLinuxDoVerification, showYaohuoLoginForRead]
  );
  const replyRefreshFailure = replyAccessDenied ? null : replyWindowFailures.refresh;
  useEffect(() => {
    if (
      selectedSource === 'yaohuo' &&
      replyRefreshFailure?.retryMode === 'query' &&
      yaohuoErrorRequiresLoginPanel(replyRefreshFailure.error)
    )
      showYaohuoLoginForRead(replyRefreshFailure.error);
  }, [selectedSource, replyRefreshFailure, showYaohuoLoginForRead]);

  useEffect(() => {
    if (!topicDetail || !detailQuery.dataUpdatedAt) return;
    const key = topicKey(topicDetail);
    if (!ordinaryLinuxDoTopic && unreadBaseline?.key !== key) return;
    const updateKey = `${detailQuery.dataUpdatedAt}:${topicDetail.replyCount}:${topicDetail.replyWatermark}`;
    const previous = recordedTopicUpdateRef.current;
    const sameEntry = previous?.topicKey === key;
    if (sameEntry && previous.updateKey === updateKey) return;
    recordedTopicUpdateRef.current = { topicKey: key, updateKey };
    commitReaderData(
      sameEntry || ordinaryLinuxDoTopic || (entryVisit.started && topicDetail.source === 'linuxdo')
        ? { type: 'topic-summary', topic: topicDetail }
        : { type: 'visit', topic: topicDetail, at: new Date().toISOString() }
    );
  }, [
    commitReaderData,
    detailQuery.dataUpdatedAt,
    entryVisit.started,
    ordinaryLinuxDoTopic,
    topicDetail,
    unreadBaseline
  ]);

  useEffect(() => {
    if (!detailQuery.error || handledTopicErrorRef.current === detailQuery.errorUpdatedAt) return;
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

  const showsQuoteAuthors = topicDetail?.source === 'linuxdo' && !replyAccessDenied;
  const authorReadPlan =
    showsQuoteAuthors && !topicReadBlocked ? readGateway.getReadPlan('linuxdo', 'reply') : undefined;
  const authorScope =
    authorReadPlan && authorReadPlan.state !== 'blocked' ? JSON.stringify([entryKey, authorReadPlan.cacheScope]) : '';
  const visibleAuthorScope = useCommittedRef(active ? authorScope : '');
  useEffect(() => {
    setAuthorRequests((current) => (current.scope === authorScope ? current : { scope: authorScope, requests: {} }));
  }, [authorScope]);
  const activeQuoteRequests = useMemo(() => {
    if (replyAccessDenied) return {};
    const active = {
      ...(authorScope && authorScope === authorRequests.scope ? authorRequests.requests : {}),
      ...quoteRequests
    };
    topicReplies.forEach((reply) => {
      const replyKey = replyRenderKey(reply);
      quotedPostsForSource(reply, selectedTopic.source).forEach(({ reference }) => {
        const instanceKey = replyQuotedPostInstanceKey(replyKey, reference);
        if (expandedQuotes[instanceKey] && !active[instanceKey]) {
          active[instanceKey] = { reference };
        }
      });
    });
    return active;
  }, [authorRequests, authorScope, expandedQuotes, quoteRequests, replyAccessDenied, selectedTopic, topicReplies]);
  const { quoteReferences, interactiveQuoteReferenceKeys, authorOnlyQuotedReferences } = useMemo(() => {
    const unique = new Map<string, QuotedPostReference>();
    const interactive = new Set<string>();
    const authors = new Set<string>();
    for (const { reference, prefetch } of Object.values(activeQuoteRequests)) {
      const key = quotedPostReferenceKey(reference);
      if (prefetch === 'author') {
        if (!unique.has(key)) authors.add(key);
      } else {
        authors.delete(key);
        if (!prefetch) interactive.add(key);
      }
      unique.set(key, reference);
    }
    return {
      quoteReferences: [...unique.values()],
      interactiveQuoteReferenceKeys: interactive,
      authorOnlyQuotedReferences: authors.size ? authors : undefined
    };
  }, [activeQuoteRequests]);
  const quoteQueries = useQueries({
    subscribed: focused,
    queries: quoteReferences.map((reference) => {
      const readPlan = readGateway.getReadPlan(reference.source, 'reply');
      return {
        queryKey: quotedReplyQueryKey(reference, readPlan),
        enabled: enabled && isDiscourseSource(reference.source),
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          if (!canReadReplyWindow()) throw new RequestCanceledError();
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
              { plan: readPlan, trace }
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
          if (!canReadReplyWindow() || topicCommands.getCurrentKey() !== selectedTopicKey) return 'stale';
          await queryClient.refetchQueries({ queryKey, exact: true });
          const state = queryClient.getQueryState(queryKey);
          handledQuoteErrorsRef.current[referenceKey] = state?.errorUpdatedAt || 0;
          const error = state?.error;
          return error ? sourceReadRecoveryOutcome(reference.source, error) : 'completed';
        }
      });
    });
  }, [
    canReadReplyWindow,
    handleReadError,
    interactiveQuoteReferenceKeys,
    queryClient,
    quoteQueries,
    quoteReferences,
    quotedReplyQueryKey,
    selectedTopicKey,
    topicCommands
  ]);

  const openTopic = useCallback(
    async (topic: Topic): Promise<LinuxDoReadResumeOutcome> => {
      const currentKey = topicCommands.getCurrentKey();
      const nextKey = topicKey(topic);
      const opensDifferentTopic = Boolean(currentKey && currentKey !== nextKey);
      if (opensDifferentTopic) {
        onOpenTopic(topic);
        return 'completed';
      }
      return 'completed';
    },
    [onOpenTopic, topicCommands]
  );

  useEffect(() => {
    if (focused) return;
    // Keep the route's target, but release an interrupted attempt so focus can resume it.
    replyWindows.abandonPendingRoute();
    for (const order of ['oldest', 'newest'] as const) {
      void queryClient.cancelQueries({
        queryKey: forumQueryKeys.replies(topicQueryKey, order, repliesReadPlan.cacheScope, replyWindowOwner)
      });
    }
  }, [focused, queryClient, repliesReadPlan.cacheScope, replyWindowOwner, replyWindows, topicQueryKey]);

  const refreshWholeTopic = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (!interactionActiveRef.current) return 'stale';
    if (selectedTopic.source === 'yaohuo') lastPromptedYaohuoTopicKeyRef.current = null;
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
        showYaohuoLoginForRead();
      }
      return 'stale';
    }
    const runAttempt = async (notifySuccess: boolean): Promise<LinuxDoReadResumeOutcome> => {
      const windowRun = replyWindows.beginRead(repliesQueryIdentity);
      const ownsWindow = windowRun.isCurrent;
      try {
        const detailResult = await detailQuery.refetch();
        if (!ownsWindow()) return 'stale';
        if (detailResult.error) {
          handledTopicErrorRef.current = detailResult.errorUpdatedAt;
          throw detailResult.error;
        }
        if (!detailResult.data) throw new Error('主题刷新未返回数据');
        if (!(await rebuildReplyWindow(detailResult.data, windowRun, 'topic'))) {
          return 'stale';
        }
        if (notifySuccess) notify('主题已更新');
        return 'completed';
      } catch (error) {
        if (!ownsWindow()) return 'stale';
        const recovery: LinuxDoReadRecovery = {
          queryKey: [...repliesQueryKey, 'whole-refresh'],
          isCurrent: ownsWindow,
          resume: () => runAttempt(false)
        };
        const sourceError = sourceErrorFromUnknown(selectedTopic.source, error);
        recordReplyWindowFailure('refresh', replyFailure(selectedTopic.source, error, { kind: 'start' }, 'whole'));
        handleReadError(selectedTopic.source, error, recovery, (candidate) =>
          onNodeSeekTopicVerificationRequired(sourceError.message, candidate)
        );
        return readOutcome(selectedTopic.source, error);
      } finally {
        // This refresh owns either its new window or the existing content and retry affordance.
        if (ownsWindow() && targetReply?.readingResume && !readingEntry.positionReady) {
          replyEntry.current.settled = true;
          readingEntry.failed();
        }
      }
    };
    return runAttempt(true);
  }, [
    replyWindows,
    handleReadError,
    interactionActiveRef,
    notify,
    onRetryIdentityStatus,
    onNodeSeekTopicVerificationRequired,
    rebuildReplyWindow,
    readingEntry.failed,
    readingEntry.positionReady,
    repliesQueryKey,
    repliesReadPlan,
    selectedReadBlocked,
    selectedTopic,
    recordReplyWindowFailure,
    showYaohuoLoginForRead,
    detailQuery.refetch,
    topicReadBlocked,
    topicReadPlan,
    targetReply?.readingResume,
    repliesQueryIdentity
  ]);

  const refreshTopicReplies = useCallback(
    async function refreshReplies(
      command: ReplyRefreshCommand = { kind: 'manual' },
      diagnosticTrace?: DiagnosticTrace
    ): Promise<LinuxDoReadResumeOutcome> {
      if (!topicDetail || !canReadReplyWindow() || !activeRepliesQueryIdentityRef.current) return 'stale';
      if (selectedTopic.source === 'yaohuo' && command.kind === 'manual' && !command.silent) {
        lastPromptedYaohuoTopicKeyRef.current = null;
        handledRepliesErrorRef.current = 0;
      }

      const windowRun = replyWindows.beginRead(repliesQueryIdentity);
      let createdTarget: ReplyLocationTarget | undefined;
      const targetedCreatedCommand =
        command.kind === 'created' && (selectedTopic.source === 'nodeseek' || isDiscourseSource(selectedTopic.source))
          ? command
          : null;
      const ownsWindow = windowRun.isCurrent;
      const recoveryFor = (queryKey: LinuxDoReadRecovery['queryKey']): LinuxDoReadRecovery => ({
        queryKey,
        isCurrent: ownsWindow,
        resume: () =>
          activeRepliesQueryIdentityRef.current === repliesQueryIdentity
            ? refreshReplies(command)
            : Promise.resolve('stale')
      });
      if (command.kind === 'manual') {
        try {
          if (!(await rebuildReplyWindow(topicDetail, windowRun, 'replies'))) return 'stale';
          if (!command.silent) notify('评论已更新');
          return 'completed';
        } catch (error) {
          if (!ownsWindow()) return 'stale';
          recordReplyWindowFailure('refresh', replyFailure(selectedTopic.source, error, { kind: 'start' }, 'query'));
          const sourceError = sourceErrorFromUnknown(selectedTopic.source, error);
          handleReadError(
            selectedTopic.source,
            error,
            recoveryFor([...rebuildRepliesQueryRoot, 'replies']),
            (recovery) => onNodeSeekTopicVerificationRequired(sourceError.message, recovery)
          );
          return readOutcome(selectedTopic.source, error);
        }
      }

      await queryClient.cancelQueries({ queryKey: repliesQueryKey, exact: true });
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
        if (command.kind !== 'edited' && !targetedCreatedCommand) {
          const result = await detailQuery.refetch();
          if (!ownsWindow()) return 'stale';
          if (result.error) {
            handledTopicErrorRef.current = result.errorUpdatedAt;
            throw result.error;
          }
          if (!result.data) throw new Error('主题刷新未返回数据');
          refreshedDetail = result.data;
          if (isTopicAccessNotice(refreshedDetail)) return 'stale';
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
        const refreshPosition = position;
        const refreshKey = [
          ...forumQueryKeys.replyRefresh(
            scopedRepliesQueryKey,
            refreshPosition.kind === 'cursor' ? refreshPosition.page : pageNumber,
            refreshPosition.kind === 'cursor' ? refreshPosition.offset : pageOffset,
            REPLY_PAGE_SIZE
          ),
          command.kind
        ] as const;
        const trace =
          diagnosticTrace ||
          beginDiagnosticTrace('reply', 'refresh', {
            source: selectedTopic.source,
            replyOrder,
            positionKind:
              targetedCreatedCommand || (reanchor && replyOrder === 'oldest') ? 'target' : refreshPosition.kind
          });
        const ownsTrace = !diagnosticTrace;
        try {
          replyWindows.trackRouteQueries(scopedRepliesQueryKey);
          const page = await queryClient.query({
            queryKey: refreshKey,
            staleTime: 0,
            queryFn: async ({ signal }) => {
              if (targetedCreatedCommand) {
                const target = targetedCreatedCommand.createdTarget;
                markDiagnosticStage(trace, 'apply', {
                  state: 'refresh-unconfirmed',
                  hasTarget: Boolean(target)
                });
                if (!target) throw new Error('回复已提交，但原站未返回可定位的评论');
                const page = await loadReplyPage(
                  refreshedDetail,
                  replyOrder,
                  {
                    kind: 'target',
                    target: { floor: target.floor, ...(target.pageHint ? { pageHint: target.pageHint } : {}) }
                  },
                  signal,
                  trace
                );
                const match = findReplyLocation(page.items, target);
                const matched = Boolean(match && match.floor === target.floor);
                markDiagnosticStage(trace, 'apply', {
                  state: matched ? 'refresh-success' : 'refresh-unconfirmed',
                  hasTarget: true,
                  isTargetMatched: matched,
                  itemCount: page.items.length
                });
                if (!matched) throw new Error('回复已提交，但回读未找到该评论');
                createdTarget = replyLocationTarget(match, page.currentPage);
                return page;
              }
              if (reanchor && replyOrder === 'oldest' && hasKnownReplies) {
                const tail = await loadReplyPage(refreshedDetail, 'newest', { kind: 'start' }, signal, trace);
                const latest = tail.items[0];
                createdTarget = replyLocationTarget(latest, tail.currentPage);
                if (!createdTarget) {
                  throw new Error('原站未返回可定位的最新回复');
                }
                return loadReplyPage(
                  refreshedDetail,
                  'oldest',
                  { kind: 'target', target: createdTarget },
                  signal,
                  trace
                );
              }
              const loaded = await loadReplyPage(refreshedDetail, replyOrder, position, signal, trace);
              if (command.kind === 'created' && !loaded.items.length) {
                throw new Error('原站未返回可确认的最新回复');
              }
              if (command.kind === 'created') {
                createdTarget = replyLocationTarget(
                  replyOrder === 'newest' ? loaded.items[0] : loaded.items.at(-1),
                  loaded.currentPage
                );
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
          if (targetedCreatedCommand) replyEntry.current.settled = true;
          const pageParam: ReplyCursorPosition = {
            kind: 'cursor',
            page: page.requestedPage,
            offset: page.requestedOffset
          };
          const centered = reanchor && replyOrder === 'oldest';
          const destination = centered ? scopedRepliesQueryKey : repliesQueryKey;
          const confirmedEdit =
            edited && isDiscourseSource(selectedTopic.source)
              ? findReplyLocation(refreshedPage.items, { commentId: edited.commentId })
              : undefined;
          const replaceEditedBody =
            edited && confirmedEdit
              ? (items: Reply[]) =>
                  replaceConfirmedReplyBody(items, edited.commentId, confirmedEdit, edited.contentMarkdown)
              : undefined;
          if (!replaceEditedBody)
            queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(destination, (cached) => {
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
          if (replaceEditedBody) {
            const quotePlan = readGateway.getReadPlan(selectedTopic.source, 'reply');
            const quoteKey =
              confirmedEdit?.floor &&
              isDiscourseSource(selectedTopic.source) &&
              quotePlan.state === 'ready' &&
              quotePlan.lane === 'authenticated'
                ? quotedReplyQueryKey(
                    { source: selectedTopic.source, topicId: selectedTopic.id, postNumber: confirmedEdit.floor },
                    quotePlan
                  )
                : undefined;
            updateConfirmedReplyCaches(
              queryClient,
              forumReplyWindowKeys(queryClient, topicQueryKey, repliesReadPlan.cacheScope),
              replaceEditedBody,
              quoteKey
            );
          }
          if (centered) activateCenteredReplyWindow(true);
          const replyCount =
            selectedTopic.source === 'nodeseek' && targetedCreatedCommand
              ? page.totalCount
              : (page.totalCount ?? refreshedDetail.replyCount);
          commitReplySnapshot(replyCount, page.replyWatermark, replaceEditedBody);
          clearAllReplyWindowErrors();
          if (command.kind === 'created' && createdTarget)
            onReplyLocationResolved?.(topicLocationForReply(selectedTopic.source, createdTarget));
          if (ownsTrace) {
            finishDiagnosticTrace(trace, 'success', {
              itemCount: page.items.length,
              hasMore: Boolean(page.hasMore)
            });
          } else {
            markDiagnosticStage(trace, 'apply', {
              state: 'refresh-success',
              itemCount: page.items.length
            });
          }
          if (!command.silent) notify('评论已更新');
          return 'completed';
        } catch (error) {
          if (!ownsWindow()) {
            if (ownsTrace) finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
            return 'stale';
          }
          if (ownsTrace) finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          else
            markDiagnosticStage(trace, 'apply', {
              state: 'refresh-unconfirmed',
              reason: normalizeDiagnosticReason(error)
            });
          const sourceError = sourceErrorFromUnknown(selectedTopic.source, error);
          recordReplyWindowFailure('refresh', replyFailure(selectedTopic.source, error, refreshPosition, command));
          handleReadError(selectedTopic.source, error, recoveryFor(refreshKey), (recovery) =>
            onNodeSeekTopicVerificationRequired(sourceError.message, recovery)
          );
          return readOutcome(selectedTopic.source, error);
        } finally {
          queryClient.removeQueries({ queryKey: refreshKey, exact: true });
        }
      } catch (error) {
        if (!ownsWindow()) return 'stale';
        const sourceError = sourceErrorFromUnknown(selectedTopic.source, error);
        recordReplyWindowFailure(
          'refresh',
          replyFailure(selectedTopic.source, error, capturedPosition || { kind: 'start' }, command)
        );
        handleReadError(selectedTopic.source, error, recoveryFor(repliesQueryKey), (recovery) =>
          onNodeSeekTopicVerificationRequired(sourceError.message, recovery)
        );
        return readOutcome(selectedTopic.source, error);
      }
    },
    [
      activateCenteredReplyWindow,
      replyWindows,
      activeRepliesQueryIdentityRef,
      detailQuery.refetch,
      handleReadError,
      commitReplySnapshot,
      loadReplyPage,
      notify,
      onNodeSeekTopicVerificationRequired,
      onReplyLocationResolved,
      otherRepliesQueryKey,
      queryClient,
      quotedReplyQueryKey,
      readGateway,
      rebuildReplyWindow,
      rebuildRepliesQueryRoot,
      refreshWholeTopic,
      repliesQueryIdentity,
      repliesQueryKey,
      replyOrder,
      scopedRepliesQueryKey,
      canReadReplyWindow,
      selectedTopic,
      recordReplyWindowFailure,
      topicDetail,
      topicQueryKey,
      clearAllReplyWindowErrors
    ]
  );
  const retryFailedReplies = useCallback(
    async function retryReplyWindow(edge?: ReplyWindowEdge): Promise<LinuxDoReadResumeOutcome> {
      if (
        !canReadReplyWindow() ||
        activeRepliesQueryIdentityRef.current !== repliesQueryIdentity ||
        isReplyWindowFetching()
      ) {
        return 'stale';
      }
      const slot = edge || 'refresh';
      const failure = replyWindowFailures[slot];
      if (!failure || failure.retryMode === 'none') return failure ? 'failed' : 'completed';
      if (selectedTopic.source === 'yaohuo' && failure.retryMode !== 'whole') {
        lastPromptedYaohuoTopicKeyRef.current = null;
        handledRepliesErrorRef.current = 0;
      }
      if (failure.retryMode === 'whole') return refreshWholeTopic();
      if (typeof failure.retryMode === 'object') return refreshTopicReplies(failure.retryMode);
      if (slot !== 'refresh') {
        const result = slot === 'start' ? await repliesQuery.fetchPreviousPage() : await repliesQuery.fetchNextPage();
        recordReplyWindowFailure(
          slot,
          result.error ? replyFailure(selectedTopic.source, result.error, failure.position, 'query') : null
        );
        return result.error ? readOutcome(selectedTopic.source, result.error) : 'completed';
      }
      return refreshTopicReplies({ kind: 'manual', silent: true });
    },
    [
      activeRepliesQueryIdentityRef,
      isReplyWindowFetching,
      refreshTopicReplies,
      refreshWholeTopic,
      repliesQuery.fetchNextPage,
      repliesQuery.fetchPreviousPage,
      repliesQueryIdentity,
      repliesQueryKey,
      replyWindowFailures,
      canReadReplyWindow,
      selectedTopic,
      recordReplyWindowFailure
    ]
  );

  useEffect(() => {
    if (replyAccessDenied || !repliesQuery.error || handledRepliesErrorRef.current === repliesQuery.errorUpdatedAt)
      return;
    handledRepliesErrorRef.current = repliesQuery.errorUpdatedAt;
    const failedEdge = repliesQuery.isFetchPreviousPageError
      ? ('start' as const)
      : repliesQuery.isFetchNextPageError
        ? ('end' as const)
        : undefined;
    const slot = failedEdge || 'refresh';
    const sourceError = sourceErrorFromUnknown(selectedTopic.source, repliesQuery.error);
    recordReplyWindowFailure(
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
    replyAccessDenied,
    repliesQuery.data,
    repliesQuery.error,
    repliesQuery.errorUpdatedAt,
    repliesQuery.isFetchNextPageError,
    repliesQuery.isFetchPreviousPageError,
    repliesQueryKey,
    retryFailedReplies,
    selectedTopic,
    recordReplyWindowFailure,
    topicCommands
  ]);

  const cancelReplyLocation = useCallback(() => {
    const queryKey = replyWindows.cancelLocation();
    if (queryKey) void queryClient.cancelQueries({ queryKey });
  }, [queryClient, replyWindows]);

  const locateReply = useCallback(
    async (target: ReplyLocationTarget, { silent = false }: { silent?: boolean } = {}) => {
      if (!active || !topicDetail || !canReadReplyWindow()) return 'stale';
      if (topicLocationForReply(selectedTopic.source, target, topicDetail).kind === 'opening') {
        replyWindows.invalidate();
        return 'completed';
      }
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
      const expectedAuthorUsername = target.expectedAuthorUsername?.trim().toLowerCase();
      if (target.expectedAuthorUsername !== undefined && !expectedAuthorUsername) {
        if (!silent) notify('目标楼层未找到');
        return 'failed';
      }
      const normalizedTarget: ReplyLocationTarget = {
        ...(target.readingResume ? { readingResume: true } : {}),
        ...(commentId ? { commentId } : {}),
        ...(floor ? { floor } : {}),
        ...(pageHint ? { pageHint } : {}),
        ...(expectedAuthorUsername ? { expectedAuthorUsername } : {})
      };
      if (
        findReplyLocation(topicReplies, normalizedTarget) &&
        (!target.readingResume || !queryClient.getQueryState(repliesQueryKey)?.isInvalidated)
      ) {
        replyWindows.invalidate();
        return 'completed';
      }
      const targetQueryKey = [
        ...targetReplyQueryRoot,
        floor ?? null,
        commentId ?? null,
        pageHint ?? null,
        expectedAuthorUsername ?? null
      ] as const;
      const windowRun = replyWindows.beginLocation(repliesQueryIdentity, targetReplyQueryRoot);
      const ownsTargetWindow = windowRun.isCurrent;
      const loadTargetWindow = async () => {
        if (!ownsTargetWindow()) {
          return 'stale' as const;
        }
        await queryClient.cancelQueries({
          queryKey: repliesQueryKey,
          exact: true,
          predicate: (query) => query.getObserversCount() <= 1
        });
        if (!ownsTargetWindow()) {
          return 'stale' as const;
        }
        const cachedReplies = mergedReplyPages(
          queryClient.getQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey)
        );
        if (
          findReplyLocation(cachedReplies, normalizedTarget) &&
          (!target.readingResume || !queryClient.getQueryState(repliesQueryKey)?.isInvalidated)
        )
          return 'completed' as const;
        const currentDetail = queryClient.getQueryData<TopicDetail>(topicQueryKey) || topicDetail;
        const trace = beginDiagnosticTrace('reply', 'load-more', {
          source: selectedTopic.source,
          topicRef: diagnosticRef('topic', `${selectedTopic.source}:${currentDetail.id}`),
          replyOrder,
          positionKind: 'target'
        });
        const discardStaleTarget = () => {
          queryClient.removeQueries({ queryKey: targetQueryKey, exact: true });
          finishDiagnosticTrace(trace, 'stale', {
            source: selectedTopic.source,
            reason: 'stale',
            replyOrder,
            positionKind: 'target'
          });
          return 'stale' as const;
        };
        try {
          const position = { kind: 'target', target: normalizedTarget } satisfies ReplyPageParam;
          replyWindows.trackRouteQueries(scopedRepliesQueryKey);
          const page = await queryClient.query({
            queryKey: targetQueryKey,
            queryFn: ({ signal }) => loadReplyPage(currentDetail, replyOrder, position, signal, trace)
          });
          if (!ownsTargetWindow()) return discardStaleTarget();
          const resolvedPage = page.currentPage!;
          const resolvedReply =
            findReplyLocation(page.items, normalizedTarget) ||
            (target.readingResume ? findReadingResumeReply(page.items, floor || 1) : undefined);
          if (!resolvedReply) throw new Error('目标楼层未找到或引用不匹配');
          const resolvedOffset = page.currentOffset ?? null;
          const centered = !ordinaryLinuxDoTopic || !target.readingResume;
          queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(
            centered ? scopedRepliesQueryKey : repliesQueryKey,
            {
              pages: [page],
              pageParams: [{ kind: 'cursor', page: resolvedPage, offset: resolvedOffset }]
            }
          );
          commitReplySnapshot(page.totalCount, page.replyWatermark);
          clearReplyWindowErrors(true);
          if (centered) {
            const openingMayBeStale =
              (page.totalCount !== undefined && page.totalCount !== currentDetail.replyCount) ||
              (page.replyWatermark !== undefined && page.replyWatermark !== currentDetail.replyWatermark);
            activateCenteredReplyWindow(openingMayBeStale);
          }
          queryClient.removeQueries({ queryKey: targetQueryKey, exact: true });
          finishDiagnosticTrace(trace, 'success', {
            itemCount: page.items.length,
            hasMore: Boolean(nextReplyPage(page)),
            replyOrder,
            positionKind: 'target',
            resolvedPage
          });
          return 'completed' as const;
        } catch (error) {
          if (!ownsTargetWindow()) return discardStaleTarget();
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
          isCurrent: ownsTargetWindow,
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
      active,
      activateCenteredReplyWindow,
      replyWindows,
      clearReplyWindowErrors,
      handleReadError,
      commitReplySnapshot,
      loadReplyPage,
      notify,
      onNodeSeekTopicVerificationRequired,
      ordinaryLinuxDoTopic,
      queryClient,
      repliesQueryKey,
      replyOrder,
      scopedRepliesQueryKey,
      canReadReplyWindow,
      selectedTopic,
      targetReplyQueryRoot,
      topicDetail,
      topicQueryKey,
      topicReplies,
      repliesQueryIdentity
    ]
  );

  useEffect(() => {
    if (resolvedLocation?.kind === 'opening') replyWindows.invalidate();
  }, [resolvedLocation?.kind, locationRequestId, replyWindows]);

  useEffect(() => {
    if (!active || !targetReply || !topicDetail || !canReadReplyWindow()) return;
    if (replyWindows.hasRoute(routeTargetKey)) return;
    const request = replyWindows.beginRoute(routeTargetKey, replyOrderScope);
    void locateReply(targetReply, { silent: true }).then((outcome) => {
      if (!replyWindows.settleRoute(request)) return;
      if (outcome === 'completed') {
        if (!readingEntry.windowReady) readingEntry.windowLoaded();
      } else if (outcome !== 'stale') {
        replyEntry.current.settled = true;
        readingEntry.failed();
      }
    });
  }, [
    locateReply,
    canReadReplyWindow,
    selectedTopic,
    repliesQueryIdentity,
    replyOrderScope,
    routeTargetKey,
    replyWindows,
    targetReply,
    locationRequestId,
    active,
    topicDetail,
    topicReplies
  ]);

  const loadPreviousReplies = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<LinuxDoReadResumeOutcome> => {
      if (!canReadReplyWindow()) return 'stale';
      if (!repliesQuery.hasPreviousPage || isReplyWindowFetching()) {
        return 'completed';
      }
      const result = await repliesQuery.fetchPreviousPage();
      if (result.error) {
        recordReplyWindowFailure(
          'start',
          replyFailure(selectedTopic.source, result.error, replyEdgePosition(result.data, 'start'), 'query')
        );
        return readOutcome(selectedTopic.source, result.error);
      }
      recordReplyWindowFailure('start', null);
      const loaded = result.data?.pages[0]?.items.length || 0;
      if (!silent) notify(`已加载 ${loaded} 条${replyOrder === 'newest' ? '更新' : '更早'}回复`);
      return 'completed';
    },
    [
      notify,
      isReplyWindowFetching,
      repliesQuery.fetchPreviousPage,
      repliesQuery.hasPreviousPage,
      replyOrder,
      canReadReplyWindow,
      selectedTopic,
      recordReplyWindowFailure
    ]
  );

  const loadMoreReplies = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}): Promise<LinuxDoReadResumeOutcome> => {
      if (!canReadReplyWindow()) return 'stale';
      if (!repliesQuery.hasNextPage || isReplyWindowFetching()) {
        return 'completed';
      }
      const result = await repliesQuery.fetchNextPage();
      if (result.error) {
        recordReplyWindowFailure(
          'end',
          replyFailure(selectedTopic.source, result.error, replyEdgePosition(result.data, 'end'), 'query')
        );
        return readOutcome(selectedTopic.source, result.error);
      }
      recordReplyWindowFailure('end', null);
      const loaded = result.data?.pages.at(-1)?.items.length || 0;
      if (!silent) notify(`已加载 ${loaded} 条回复`);
      return 'completed';
    },
    [
      notify,
      isReplyWindowFetching,
      repliesQuery.fetchNextPage,
      repliesQuery.hasNextPage,
      canReadReplyWindow,
      selectedTopic,
      recordReplyWindowFailure
    ]
  );

  const toggleLoadedQuotedPost = useCallback(
    async ({
      instanceKey,
      prefetch,
      quotedPost,
      reference
    }: ToggleTopicBodyQuoteOptions): Promise<LinuxDoReadResumeOutcome> => {
      if (!canReadReplyWindow() || readGateway.getReadPlan(reference.source, 'reply').state === 'blocked')
        return 'stale';
      if (
        prefetch === 'author' &&
        (!authorScope || visibleAuthorScope.current !== authorScope || reference.source !== 'linuxdo')
      )
        return 'stale';
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
      if (prefetch === 'author') {
        setAuthorRequests((current) => ({
          scope: authorScope,
          requests: {
            ...(current.scope === authorScope ? current.requests : {}),
            [instanceKey]: { prefetch, reference }
          }
        }));
      } else setQuoteRequests((current) => ({ ...current, [instanceKey]: { prefetch, reference } }));
      if (!prefetch) {
        topicQuotes.changeExpanded(instanceKey, true);
      }
      return 'completed';
    },
    [
      authorScope,
      canReadReplyWindow,
      visibleAuthorScope,
      notify,
      queryClient,
      quotedReplyQueryKey,
      readGateway,
      topicQuotes,
      topicReadQueryKey
    ]
  );

  const toggleTopicBodyQuote = useCallback(
    (options: ToggleTopicBodyQuoteOptions) => toggleLoadedQuotedPost(options),
    [toggleLoadedQuotedPost]
  );

  const toggleReplyQuote = useCallback(
    ({ replyKey, reference, quotedReply }: ToggleReplyQuoteOptions) => {
      if (selectedTopic.source !== reference.source) {
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
  const currentTopicKey = topicKey(currentTopic);
  const topicError =
    !topicDetail && detailQuery.error ? sourceErrorFromUnknown(selectedTopic.source, detailQuery.error) : null;
  const topicFavorite = Boolean(readerData.favorites[currentTopicKey]);
  const unreadReplyCount =
    !ordinaryLinuxDoTopic && typeof topicDetail?.replyCount === 'number'
      ? Math.max(
          0,
          topicDetail.replyCount -
            (unreadBaseline?.key === topicKey(topicDetail)
              ? (unreadBaseline.replyCount ?? topicDetail.replyCount)
              : topicDetail.replyCount)
        )
      : 0;

  const newReplyFloorStart = ordinaryLinuxDoTopic
    ? readingEntry.baseline === undefined
      ? undefined
      : readingEntry.baseline + 1
    : unreadBaseline?.key === currentTopicKey && unreadBaseline.replyWatermark !== undefined
      ? unreadBaseline.replyWatermark + 1
      : undefined;
  return {
    ...(newReplyFloorStart !== undefined ? { newReplyFloorStart } : {}),
    readingEntry,
    readingRuntime: ordinaryLinuxDoTopic ? readGateway.reading : undefined,
    hasNewReplies:
      ordinaryLinuxDoTopic &&
      Boolean(
        readingEntry.baseline &&
        Math.max(topicDetail?.reading?.highestPostNumber || 0, readingEntry.highest || 0) > readingEntry.baseline
      ),
    currentTopic,
    currentTopicKey,
    loadPreviousReplies,
    loadMoreReplies,
    cancelReplyLocation,
    locateReply,
    loadedQuotedReplies,
    authorOnlyQuotedReferences,
    loadingMoreReplies: !replyAccessDenied && (loadingTargetReply || repliesQuery.isFetchingNextPage),
    loadingPreviousReplies: !replyAccessDenied && repliesQuery.isFetchingPreviousPage,
    loadingQuotedFloors,
    openTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    isReadRecoveryCurrent,
    repliesError: replyAccessDenied
      ? null
      : replyRefreshFailure?.error ||
        (repliesQuery.error && !repliesQuery.isFetchPreviousPageError && !repliesQuery.isFetchNextPageError
          ? sourceErrorFromUnknown(selectedTopic.source, repliesQuery.error)
          : null),
    replyStartError: replyAccessDenied ? null : replyWindowFailures.start?.error || null,
    replyEndError: replyAccessDenied ? null : replyWindowFailures.end?.error || null,
    replyWindowOwner,
    repliesLoading:
      enabled &&
      !replyAccessDenied &&
      Boolean(topicDetail) &&
      ((repliesQuery.isPending &&
        !repliesQuery.data &&
        (!targetReply || loadingTargetReply || repliesQuery.isFetching)) ||
        (Boolean(replyWindowFailures.refresh) && detailQuery.isFetching)),
    retryReplies: retryFailedReplies,
    replyRowsPartial,
    replyHasPrevious,
    replyHasMore,
    replyPreviousCursor,
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
