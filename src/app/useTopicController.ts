import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { ReadGateway } from '@/sources/readGateway';
import { recordHistory, topicKey, updateFavoriteTopic, type ReaderData } from '@/domain/reader/readerData';
import { isSameReply, mergeReplies, removeReply, replyKey as replyIdentityKey } from '@/feedLogic';
import { isCanceledRequest } from '@/platform/network/errors';
import {
  replyCountAfterNewReplySubmit,
  replyLoadMoreLimit,
  replyRefreshTarget
} from '@/features/topic/model/replyPagination';
import { topicWithAuthorFallback } from '@/domain/forum/userNavigation';
import { applyEditedReplyContent, shouldApplyEditedReplyFallback } from './topicActionControllerHelpers';
import type { TopicSessionController } from './useTopicSessionController';
import {
  sourceErrorFromUnknown,
  sourceReadRecoveryOutcome,
  yaohuoErrorRequiresLoginPanel
} from '@/sources/sourceErrors';
import type { RepliesResponse, Reply, Source, SourceErrorInfo, Topic, TopicDetail } from '@/domain/forum/models';
import type { Screen } from '@/ui/navigation/types';
import type { TopicRepliesRefreshOptions } from '@/features/topic/model/types';
import type { ReaderDataMutationReason } from './useReaderDataController';
import {
  quotedPostReferenceKey,
  quotedPostsForSource,
  replyQuotedPostInstanceKey,
  topicOpeningPostAsReply,
  type QuotedPostReference,
  type ToggleReplyQuoteOptions,
  type ToggleTopicBodyQuoteOptions
} from '@/domain/forum/quotedPosts';
import {
  beginDiagnosticTrace,
  diagnosticRef,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason
} from '@/platform/diagnostics/diagnostics';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/features/account/model/sessionContracts';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys, type ForumIdentityBarrierSource } from './serverState';

const NODESEEK_DETAIL_TIMEOUT_MS = 30000;
const LINUXDO_DETAIL_TIMEOUT_MS = 30000;

type MutableRef<T> = { current: T };

type ReplyPageParam = {
  offset: number | null;
  page: number;
};

type ReplyPage = RepliesResponse & {
  requestedOffset: number | null;
  requestedPage: number;
};

function topicReplyPage(detail: TopicDetail): ReplyPage {
  return {
    items: detail.replies || [],
    hasMore: Boolean(detail.replyHasMore),
    nextPage: detail.replyNextPage ?? null,
    nextOffset: detail.replyNextOffset ?? null,
    totalCount: detail.replyCount,
    requestedPage: 1,
    requestedOffset: 0
  };
}

function firstReplyData(detail: TopicDetail): InfiniteData<ReplyPage, ReplyPageParam> {
  return {
    pages: [topicReplyPage(detail)],
    pageParams: [{ page: 1, offset: 0 }]
  };
}

function mergedReplyPages(data: InfiniteData<ReplyPage, ReplyPageParam> | undefined) {
  return (data?.pages || []).reduce<Reply[]>((items, page) => mergeReplies(items, page.items), []);
}

function nextReplyPage(lastPage: ReplyPage): ReplyPageParam | undefined {
  return hasNextReplyPage({
    hasMore: lastPage.hasMore,
    nextOffset: lastPage.nextOffset,
    nextPage: lastPage.nextPage,
    requestedOffset: lastPage.requestedOffset,
    requestedPage: lastPage.requestedPage
  })
    ? { page: lastPage.nextPage!, offset: lastPage.nextOffset ?? null }
    : undefined;
}

function readOutcome(source: Source, error: unknown): LinuxDoReadResumeOutcome {
  return sourceReadRecoveryOutcome(source, error);
}

export function hasNextReplyPage({
  hasMore,
  nextOffset,
  nextPage,
  requestedOffset,
  requestedPage
}: {
  hasMore?: boolean;
  nextOffset?: number | null;
  nextPage?: number | null;
  requestedOffset?: number | null;
  requestedPage?: number | null;
}) {
  return Boolean(
    hasMore && nextPage && !(nextPage === requestedPage && (nextOffset ?? null) === (requestedOffset ?? null))
  );
}

export function useTopicController({
  changeScreen,
  commitReaderData,
  identityBarriers = [],
  sessionEpochs = initialForumSessionEpochs,
  getCurrentScreen,
  notify,
  onNodeSeekTopicVerificationRequired,
  pushTopicScreen,
  readerData,
  readerDataRef,
  reopenExistingTopicScreenRef,
  screen,
  showLinuxDoVerification,
  showYaohuoLogin,
  readGateway,
  topicReturnScreenRef,
  topicSession
}: {
  changeScreen: (nextScreen: Screen) => void;
  commitReaderData: (mutationReason: ReaderDataMutationReason, updater: (current: ReaderData) => ReaderData) => void;
  identityBarriers?: readonly ForumIdentityBarrierSource[];
  sessionEpochs?: ForumSessionEpochs;
  getCurrentScreen: () => Screen;
  notify: (message: string) => void;
  onNodeSeekTopicVerificationRequired: (message: string, recovery: LinuxDoReadRecovery) => void;
  pushTopicScreen: (topic: Topic) => boolean;
  readerData: ReaderData;
  readerDataRef: MutableRef<ReaderData>;
  reopenExistingTopicScreenRef: MutableRef<boolean>;
  screen: Screen;
  showLinuxDoVerification: (
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>;
  showYaohuoLogin: (message?: string) => void;
  readGateway: ReadGateway;
  topicReturnScreenRef: MutableRef<Exclude<Screen, 'topic'>>;
  topicSession: TopicSessionController;
}) {
  const queryClient = useQueryClient();
  const {
    state: { expandedQuotes, selectedTopic },
    commands: { navigation: topicNavigation, quotes: topicQuotes, topic: topicCommands },
    snapshot: topicSnapshot
  } = topicSession;
  const [quoteRequests, setQuoteRequests] = useState<
    Record<
      string,
      {
        prefetch: boolean;
        reference: QuotedPostReference;
      }
    >
  >({});
  const unreadBaselineRef = useRef<Record<string, number>>({});
  const recordedTopicUpdateRef = useRef('');
  const handledTopicErrorRef = useRef(0);
  const handledRepliesErrorRef = useRef(0);
  const handledQuoteErrorsRef = useRef<Record<string, number>>({});
  const selectedSource = selectedTopic?.source || 'v2ex';
  const selectedTopicId = selectedTopic?.id || '';
  const selectedTopicKey = selectedTopic ? topicKey(selectedTopic) : '';
  const selectedIdentityPending = Boolean(
    selectedTopic && selectedTopic.source !== 'v2ex' && identityBarriers.includes(selectedTopic.source)
  );
  const enabled = Boolean(selectedTopic && screen === 'topic' && !selectedIdentityPending);
  const topicQueryKey = useMemo(
    () =>
      forumQueryKeys.topic({
        source: selectedSource,
        topicId: selectedTopicId,
        scope: sessionEpochs
      }),
    [
      sessionEpochs.linuxdo,
      sessionEpochs.nodeseek,
      sessionEpochs.xiaoyinsi,
      sessionEpochs.yaohuo,
      selectedSource,
      selectedTopicId
    ]
  );
  const repliesQueryKey = useMemo(() => forumQueryKeys.replies(topicQueryKey), [topicQueryKey]);

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
            timeoutMs:
              topic.source === 'nodeseek'
                ? NODESEEK_DETAIL_TIMEOUT_MS
                : topic.source === 'linuxdo'
                  ? LINUXDO_DETAIL_TIMEOUT_MS
                  : undefined
          },
          { trace }
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
  const initialReplies = useMemo(
    () => (topicDetail ? firstReplyData(topicDetail) : undefined),
    [detailQuery.dataUpdatedAt, topicDetail]
  );
  const repliesQuery = useInfiniteQuery({
    queryKey: repliesQueryKey,
    enabled: enabled && Boolean(topicDetail),
    initialPageParam: { page: 1, offset: 0 } satisfies ReplyPageParam,
    initialData: initialReplies,
    initialDataUpdatedAt: detailQuery.dataUpdatedAt || undefined,
    queryFn: async ({ pageParam, signal }) => {
      const detail = topicDetail!;
      const trace = beginDiagnosticTrace('reply', pageParam.page === 1 ? 'refresh' : 'load-more', {
        source: detail.source,
        topicRef: diagnosticRef('topic', `${detail.source}:${detail.id}`),
        page: pageParam.page
      });
      try {
        const loaded = await readGateway.getReplies(
          {
            source: detail.source,
            id: detail.id,
            categoryId: detail.categoryId,
            page: pageParam.page,
            limit: replyLoadMoreLimit({
              source: detail.source,
              replyNextPage: pageParam.page,
              replyNextOffset: pageParam.offset
            }),
            offset: pageParam.offset,
            signal
          },
          { trace }
        );
        if (sourceDiagnosticSummary(loaded)?.isParseEmpty) {
          throw new Error(
            pageParam.page === 1 ? '评论内容解析为空，无法更新，请重试。' : '评论内容解析为空，无法加载下一页，请重试。'
          );
        }
        const page: ReplyPage = {
          ...loaded,
          requestedPage: pageParam.page,
          requestedOffset: pageParam.offset
        };
        finishDiagnosticTrace(trace, nextReplyPage(page) || !loaded.hasMore ? 'success' : 'partial', {
          itemCount: loaded.items.length,
          hasMore: Boolean(nextReplyPage(page))
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
    getNextPageParam: nextReplyPage
  });

  useEffect(() => {
    if (!topicDetail) return;
    queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, (current) => {
      return current || firstReplyData(topicDetail);
    });
  }, [detailQuery.dataUpdatedAt, queryClient, repliesQueryKey, topicDetail]);

  const topicReplies = useMemo(
    () => mergedReplyPages(repliesQuery.data as InfiniteData<ReplyPage, ReplyPageParam> | undefined),
    [repliesQuery.data]
  );
  const lastReplyPage = repliesQuery.data?.pages.at(-1);
  const replyHasMore = Boolean(repliesQuery.hasNextPage);
  const replyNextPage =
    nextReplyPage(
      lastReplyPage ||
        ({
          items: [],
          hasMore: false,
          nextPage: null,
          requestedPage: 1,
          requestedOffset: 0
        } as ReplyPage)
    )?.page ?? null;
  const replyNextOffset =
    nextReplyPage(
      lastReplyPage ||
        ({
          items: [],
          hasMore: false,
          nextPage: null,
          requestedPage: 1,
          requestedOffset: 0
        } as ReplyPage)
    )?.offset ?? null;

  const authoritativeReplyCount = repliesQuery.data?.pages[0]?.totalCount;
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

  useEffect(() => {
    if (!topicDetail || !detailQuery.dataUpdatedAt) return;
    const recordKey = `${topicKey(topicDetail)}:${detailQuery.dataUpdatedAt}`;
    if (recordedTopicUpdateRef.current === recordKey) return;
    recordedTopicUpdateRef.current = recordKey;
    commitReaderData('history-recorded', (current) =>
      updateFavoriteTopic(recordHistory(current, topicDetail), topicDetail)
    );
  }, [commitReaderData, detailQuery.dataUpdatedAt, topicDetail]);

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

  useEffect(() => {
    if (!selectedTopic || !repliesQuery.error || handledRepliesErrorRef.current === repliesQuery.errorUpdatedAt) return;
    handledRepliesErrorRef.current = repliesQuery.errorUpdatedAt;
    const topic = selectedTopic;
    const retryFailedNextPage = repliesQuery.isFetchNextPageError;
    handleReadError(
      topic.source,
      repliesQuery.error,
      {
        queryKey: repliesQueryKey,
        resume: async () => {
          if (topicCommands.getCurrentKey() !== topicKey(topic)) return 'stale';
          const result = retryFailedNextPage
            ? await repliesQuery.fetchNextPage({ cancelRefetch: false })
            : await repliesQuery.refetch();
          handledRepliesErrorRef.current = result.errorUpdatedAt;
          return result.error ? readOutcome(topic.source, result.error) : 'completed';
        }
      },
      (recovery) =>
        onNodeSeekTopicVerificationRequired(sourceErrorFromUnknown(topic.source, repliesQuery.error).message, recovery)
    );
  }, [
    handleReadError,
    onNodeSeekTopicVerificationRequired,
    repliesQuery.error,
    repliesQuery.errorUpdatedAt,
    repliesQuery.fetchNextPage,
    repliesQuery.isFetchNextPageError,
    repliesQuery.refetch,
    repliesQueryKey,
    selectedTopic,
    queryClient,
    topicCommands
  ]);

  const activeQuoteRequests = useMemo(() => {
    const active = { ...quoteRequests };
    if (!selectedTopic) return active;
    topicReplies.forEach((reply) => {
      const replyKey = replyIdentityKey(reply);
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
    queries: quoteReferences.map((reference) => ({
      queryKey: forumQueryKeys.reply({
        source: reference.source,
        topicId: reference.topicId,
        postNumber: reference.postNumber,
        scope: sessionEpochs
      }),
      enabled: enabled && isDiscourseSource(reference.source) && !identityBarriers.includes(reference.source),
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
            { trace }
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
    }))
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
      const queryKey = forumQueryKeys.reply({
        source: reference.source,
        topicId: reference.topicId,
        postNumber: reference.postNumber,
        scope: sessionEpochs
      });
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
    sessionEpochs,
    handleReadError,
    interactiveQuoteReferenceKeys,
    queryClient,
    quoteQueries,
    quoteReferences,
    selectedTopicKey,
    topicCommands
  ]);

  const cancelTopicQueries = useCallback(
    (topic: Topic | null = selectedTopic) => {
      if (topic) {
        const key = forumQueryKeys.topic({ source: topic.source, topicId: topic.id, scope: sessionEpochs });
        void queryClient.cancelQueries({ queryKey: key });
      }
      Object.values(activeQuoteRequests).forEach(({ reference }) => {
        void queryClient.cancelQueries({
          queryKey: forumQueryKeys.reply({
            source: reference.source,
            topicId: reference.topicId,
            postNumber: reference.postNumber,
            scope: sessionEpochs
          }),
          exact: true
        });
      });
    },
    [activeQuoteRequests, sessionEpochs, queryClient, selectedTopic]
  );

  const openTopic = useCallback(
    async (topic: Topic, refresh = false): Promise<LinuxDoReadResumeOutcome> => {
      const currentScreen = getCurrentScreen();
      const currentKey = topicCommands.getCurrentKey();
      const nextKey = topicKey(topic);
      const opensDifferentTopic = Boolean(currentKey && currentKey !== nextKey);
      const reopenExistingTopicScreen = reopenExistingTopicScreenRef.current;
      reopenExistingTopicScreenRef.current = false;
      if (currentScreen !== 'topic' && !reopenExistingTopicScreen) {
        topicReturnScreenRef.current = currentScreen;
        topicNavigation.clearBackStack();
      } else if (opensDifferentTopic) {
        topicNavigation.pushBackStack(topicSnapshot(), topic);
      }
      if (opensDifferentTopic) cancelTopicQueries(selectedTopic);
      if (opensDifferentTopic) setQuoteRequests({});
      unreadBaselineRef.current[nextKey] = readerDataRef.current.history[nextKey]?.topic.replyCount || 0;
      const shouldPushTopicScreen = currentScreen !== 'topic' || opensDifferentTopic;
      const pushedTopicScreen = shouldPushTopicScreen && pushTopicScreen(topic);
      topicCommands.select(topic);
      if (shouldPushTopicScreen && !pushedTopicScreen) {
        changeScreen('topic');
      }
      if (refresh) {
        const key = forumQueryKeys.topic({ source: topic.source, topicId: topic.id, scope: sessionEpochs });
        await queryClient.invalidateQueries({ queryKey: key, exact: true });
        await queryClient.invalidateQueries({ queryKey: forumQueryKeys.replies(key), exact: true });
      }
      return 'completed';
    },
    [
      cancelTopicQueries,
      changeScreen,
      sessionEpochs,
      getCurrentScreen,
      pushTopicScreen,
      queryClient,
      readerDataRef,
      reopenExistingTopicScreenRef,
      selectedTopic,
      topicCommands,
      topicNavigation,
      topicReturnScreenRef,
      topicSnapshot
    ]
  );

  const refreshWholeTopic = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (!selectedTopic || selectedIdentityPending) return 'stale';
    const result = await detailQuery.refetch();
    if (result.error) return readOutcome(selectedTopic.source, result.error);
    if (result.data) {
      queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, firstReplyData(result.data));
    }
    notify('主题已更新');
    return 'completed';
  }, [detailQuery.refetch, notify, queryClient, repliesQueryKey, selectedIdentityPending, selectedTopic]);

  const refreshTopicReplies = useCallback(
    async (options: TopicRepliesRefreshOptions = {}): Promise<LinuxDoReadResumeOutcome> => {
      if (!selectedTopic || !topicDetail || selectedIdentityPending) return 'stale';
      if (selectedTopic.source === 'v2ex') {
        const trace = beginDiagnosticTrace('reply', 'refresh', { source: 'v2ex' });
        const outcome = await refreshWholeTopic();
        finishDiagnosticTrace(
          trace,
          outcome === 'completed'
            ? 'success'
            : outcome === 'failed'
              ? 'failure'
              : outcome === 'verification-required'
                ? 'blocked'
                : 'stale',
          outcome === 'completed'
            ? { source: 'v2ex' }
            : {
                source: 'v2ex',
                reason:
                  outcome === 'verification-required'
                    ? 'verification_required'
                    : outcome === 'failed'
                      ? 'refresh_failed'
                      : 'stale'
              }
        );
        return outcome;
      }
      if (!options.afterSubmit) {
        const result = await repliesQuery.refetch();
        if (result.error) return readOutcome(selectedTopic.source, result.error);
        if (options.excludeReply || options.editedReplyContent) {
          queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, (current) =>
            current
              ? {
                  ...current,
                  pages: current.pages.map((page) => ({
                    ...page,
                    items: applyEditedReplyContent(
                      removeReply(page.items, options.excludeReply),
                      options.editedReplyContent || { commentId: -1, contentMarkdown: '' },
                      selectedTopic.source
                    )
                  }))
                }
              : current
          );
        }
        if (!options.silent) notify('评论已更新');
        return 'completed';
      }

      const targetIndex = options.targetReply
        ? topicReplies.findIndex((reply) => isSameReply(reply, options.targetReply))
        : -1;
      const expectedReplyCount = Math.max(topicDetail.replyCount || 0, topicReplies.length) + 1;
      const target = replyRefreshTarget({
        source: selectedTopic.source,
        afterSubmit: true,
        expectedReplyCount,
        replyNextPage,
        replyNextOffset,
        loadedReplyCount: topicReplies.length,
        ...(targetIndex >= 0 ? { targetReplyIndex: targetIndex } : {})
      });
      const limit =
        target.limit ??
        replyLoadMoreLimit({
          source: selectedTopic.source,
          replyNextPage: target.page,
          replyNextOffset: target.offset
        });
      const refreshKey = forumQueryKeys.replyRefresh(repliesQueryKey, target.page, target.offset, limit);
      const trace =
        options.diagnosticTrace ||
        beginDiagnosticTrace('reply', 'refresh', {
          source: selectedTopic.source,
          topicRef: diagnosticRef('topic', `${selectedTopic.source}:${selectedTopic.id}`),
          page: target.page,
          mode: 'after-submit'
        });
      const ownsTrace = !options.diagnosticTrace;
      const fetchRefreshPage = async (): Promise<ReplyPage> => {
        const loaded = await queryClient.fetchQuery({
          queryKey: refreshKey,
          staleTime: 0,
          queryFn: ({ signal }) =>
            readGateway.getReplies(
              {
                source: selectedTopic.source,
                id: selectedTopic.id,
                categoryId: topicDetail.categoryId,
                page: target.page,
                limit,
                offset: target.offset,
                signal
              },
              { trace }
            )
        });
        if (sourceDiagnosticSummary(loaded)?.isParseEmpty) {
          throw new Error('评论内容解析为空，无法更新，请重试。');
        }
        return {
          ...loaded,
          requestedPage: target.page,
          requestedOffset: target.offset
        };
      };
      const applyRefreshPage = (page: ReplyPage) => {
        const refreshedItems = removeReply(page.items, options.excludeReply);
        queryClient.setQueryData<InfiniteData<ReplyPage, ReplyPageParam>>(repliesQueryKey, (current) => {
          const pages = current?.pages.slice() || [];
          const pageParams = current?.pageParams.slice() || [];
          const pageIndex = pageParams.findIndex(
            (param) => param.page === target.page && (param.offset ?? null) === (target.offset ?? null)
          );
          const refreshedPage = { ...page, items: refreshedItems };
          if (pageIndex >= 0) {
            pages[pageIndex] = refreshedPage;
            pageParams[pageIndex] = { page: target.page, offset: target.offset };
          } else {
            pages.push(refreshedPage);
            pageParams.push({ page: target.page, offset: target.offset });
          }
          const filteredPages = pages.map((currentPage) => ({
            ...currentPage,
            items: removeReply(currentPage.items, options.excludeReply)
          }));
          if (shouldApplyEditedReplyFallback(refreshedItems, options.editedReplyContent, selectedTopic.source)) {
            return {
              pages: filteredPages.map((currentPage) => ({
                ...currentPage,
                items: applyEditedReplyContent(currentPage.items, options.editedReplyContent!, selectedTopic.source)
              })),
              pageParams
            };
          }
          return { pages: filteredPages, pageParams };
        });
        const replyCount =
          !options.targetReply && !options.excludeReply
            ? (page.totalCount ??
              replyCountAfterNewReplySubmit(topicDetail.replyCount || 0, topicReplies.length + refreshedItems.length))
            : page.totalCount;
        if (typeof replyCount === 'number') {
          queryClient.setQueryData<TopicDetail>(topicQueryKey, (current) =>
            current ? { ...current, replyCount } : current
          );
        }
      };
      try {
        const page = await fetchRefreshPage();
        applyRefreshPage(page);
        queryClient.removeQueries({ queryKey: refreshKey, exact: true });
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'success', { itemCount: page.items.length, hasMore: Boolean(page.hasMore) });
        } else {
          markDiagnosticStage(trace, 'apply', { state: 'refresh-success', itemCount: page.items.length });
        }
        if (!options.silent) notify('评论已更新');
        return 'completed';
      } catch (error) {
        if (ownsTrace) finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
        handleReadError(
          selectedTopic.source,
          error,
          {
            queryKey: refreshKey,
            resume: async () => {
              try {
                const page = await fetchRefreshPage();
                applyRefreshPage(page);
                queryClient.removeQueries({ queryKey: refreshKey, exact: true });
                return 'completed';
              } catch (retryError) {
                return readOutcome(selectedTopic.source, retryError);
              }
            }
          },
          (recovery) =>
            onNodeSeekTopicVerificationRequired(sourceErrorFromUnknown(selectedTopic.source, error).message, recovery)
        );
        return readOutcome(selectedTopic.source, error);
      }
    },
    [
      handleReadError,
      notify,
      onNodeSeekTopicVerificationRequired,
      queryClient,
      refreshWholeTopic,
      repliesQuery.refetch,
      repliesQueryKey,
      replyNextOffset,
      replyNextPage,
      selectedIdentityPending,
      selectedTopic,
      readGateway,
      topicDetail,
      topicQueryKey,
      topicReplies
    ]
  );

  const loadMoreReplies = useCallback(async (): Promise<LinuxDoReadResumeOutcome> => {
    if (!selectedTopic || selectedIdentityPending) return 'stale';
    if (!repliesQuery.hasNextPage || repliesQuery.isFetchingNextPage) return 'completed';
    const result = await repliesQuery.fetchNextPage();
    if (result.error) return readOutcome(selectedTopic.source, result.error);
    const loaded = result.data?.pages.at(-1)?.items.length || 0;
    notify(`已加载 ${loaded} 条回复`);
    return 'completed';
  }, [
    notify,
    repliesQuery.fetchNextPage,
    repliesQuery.hasNextPage,
    repliesQuery.isFetchingNextPage,
    selectedIdentityPending,
    selectedTopic
  ]);

  const toggleLoadedQuotedPost = useCallback(
    async ({
      instanceKey,
      prefetch = false,
      quotedPost,
      reference
    }: ToggleTopicBodyQuoteOptions): Promise<LinuxDoReadResumeOutcome> => {
      if (reference.source !== 'v2ex' && identityBarriers.includes(reference.source)) {
        return 'stale';
      }
      if (!prefetch && topicQuotes.isExpanded(instanceKey)) {
        topicQuotes.changeExpanded(instanceKey, false);
        return 'completed';
      }
      const cachedTopic =
        reference.postNumber === 1
          ? queryClient.getQueryData<TopicDetail>(
              forumQueryKeys.topic({
                source: reference.source,
                topicId: reference.topicId,
                scope: sessionEpochs
              })
            )
          : undefined;
      const reusableQuotedPost = quotedPost || (cachedTopic ? topicOpeningPostAsReply(cachedTopic) : undefined);
      if (!isDiscourseSource(reference.source) && !reusableQuotedPost) {
        if (!prefetch) {
          topicQuotes.changeExpanded(instanceKey, true);
          notify('引用楼层未加载');
        }
        return 'failed';
      }
      const queryKey = forumQueryKeys.reply({
        source: reference.source,
        topicId: reference.topicId,
        postNumber: reference.postNumber,
        scope: sessionEpochs
      });
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
    [identityBarriers, sessionEpochs, notify, queryClient, topicQuotes]
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
  const currentTopicKey = screen === 'topic' && currentTopic ? topicKey(currentTopic) : null;
  const topicError =
    !topicDetail && detailQuery.error && selectedTopic
      ? sourceErrorFromUnknown(selectedTopic.source, detailQuery.error)
      : null;
  const topicFavorite = Boolean(currentTopic && readerData.favorites[topicKey(currentTopic)]);
  const unreadReplyCount = topicDetail
    ? Math.max(0, topicDetail.replyCount - (unreadBaselineRef.current[topicKey(topicDetail)] || topicDetail.replyCount))
    : 0;

  return {
    cancelTopicQueries,
    currentTopic,
    currentTopicKey,
    loadMoreReplies,
    loadedQuotedReplies,
    loadingMoreReplies: repliesQuery.isFetchingNextPage,
    loadingQuotedFloors,
    openTopic,
    refreshTopicReplies,
    refreshWholeTopic,
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
