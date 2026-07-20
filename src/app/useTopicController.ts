import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isCancelledError } from '@tanstack/react-query';
import type { SourceGateway } from '../sources/sourceGateway';
import {
  recordHistory,
  topicKey,
  updateFavoriteTopic,
  type ReaderData
} from '../readerData';
import { isSameReply, mergeReplies, removeReply } from '../feedLogic';
import { isCanceledRequest } from '../appUtils';
import { REPLY_PAGE_SIZE, replyCountAfterNewReplySubmit, replyLoadMoreLimit, replyRefreshTarget } from '../androidFeatureHelpers';
import { shouldReuseCurrentTopicDetail } from '../topicSessionState';
import { topicWithAuthorFallback } from '../userNavigation';
import { applyEditedReplyContent, shouldApplyEditedReplyFallback } from './topicActionControllerHelpers';
import type { TopicSessionController } from './useTopicSessionController';
import { sourceErrorFromUnknown, yaohuoErrorRequiresLoginPanel } from '../sourceErrors';
import type { Reply, Source, Topic } from '../types';
import type { ReplyRefreshTarget, Screen, TopicRepliesRefreshOptions } from '../appTypes';
import type { ReaderDataMutationReason } from './useReaderDataController';
import {
  quotedPostReferenceFromReply,
  quotedPostReferenceKey,
  replyQuotedPostInstanceKey,
  type ToggleReplyQuoteOptions,
  type ToggleTopicBodyQuoteOptions
} from '../quotedPosts';
import {
  beginDiagnosticTrace,
  diagnosticRef,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason
} from '../diagnostics';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from './useVerificationController';
import { isDiscourseSource } from '../sourceCatalog';
import { sourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import { useCommitRefValue } from './useCommittedRef';
import {
  appQueryClient,
  forumQueryKeys,
  subscribeForumSourceResets
} from './serverState';

const NODESEEK_DETAIL_TIMEOUT_MS = 30000;
const LINUXDO_DETAIL_TIMEOUT_MS = 30000;

type MutableRef<T> = { current: T };
type SourceGenerationRef = MutableRef<Partial<Record<Source, number>>>;

function currentSourceGeneration(ref: SourceGenerationRef, source: Source) {
  return ref.current[source] || 0;
}

function nextSourceGeneration(ref: SourceGenerationRef, source: Source) {
  const next = currentSourceGeneration(ref, source) + 1;
  ref.current[source] = next;
  return next;
}

function replyTargetIndex(replies: Reply[], target?: ReplyRefreshTarget | null) {
  const index = target ? replies.findIndex((reply) => isSameReply(reply, target)) : -1;
  return index >= 0 ? index : undefined;
}

function isCanceledTopicQuery(error: unknown) {
  return isCancelledError(error) || isCanceledRequest(error);
}

function topicDataUpdateCount(topic: Topic) {
  return appQueryClient.getQueryState(forumQueryKeys.topic(topic.source, topic.id))?.dataUpdateCount || 0;
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
    hasMore
    && nextPage
    && !(
      nextPage === requestedPage
      && (nextOffset ?? null) === (requestedOffset ?? null)
    )
  );
}

export function useTopicController({
  changeScreen,
  commitReaderData,
  notify,
  onNodeSeekTopicVerificationRequired,
  pushTopicScreen,
  readerData,
  readerDataRef,
  reopenExistingTopicScreenRef,
  getCurrentScreen,
  screen,
  showLinuxDoVerification,
  showYaohuoLogin,
  sourceGateway,
  topicReturnScreenRef,
  topicSession
}: {
  changeScreen: (nextScreen: Screen) => void;
  commitReaderData: (
    mutationReason: ReaderDataMutationReason,
    updater: (current: ReaderData) => ReaderData
  ) => void;
  notify: (message: string) => void;
  onNodeSeekTopicVerificationRequired: (message: string) => void;
  pushTopicScreen: () => void;
  readerData: ReaderData;
  readerDataRef: MutableRef<ReaderData>;
  reopenExistingTopicScreenRef: MutableRef<boolean>;
  getCurrentScreen: () => Screen;
  screen: Screen;
  showLinuxDoVerification: (message?: string, recovery?: LinuxDoReadRecovery) => void | Promise<void>;
  showYaohuoLogin: (message?: string) => void;
  sourceGateway: SourceGateway;
  topicReturnScreenRef: MutableRef<Exclude<Screen, 'topic'>>;
  topicSession: TopicSessionController;
}) {
  const {
    state: { replyNextOffset, replyNextPage, selectedTopic, topicDetail, topicReplies },
    commands: {
      navigation: topicNavigation,
      quotes: topicQuotes,
      replies: topicReplyCommands,
      topic: topicCommands
    },
    snapshot: topicSnapshot
  } = topicSession;
  const topicRecoveryGenerationRef = useRef<Partial<Record<Source, number>>>({});
  const repliesRecoveryGenerationRef = useRef<Partial<Record<Source, number>>>({});
  const openTopicRef = useRef<((topic: Topic, nocache?: boolean, suppressLinuxDoVerification?: boolean) => Promise<LinuxDoReadResumeOutcome>) | null>(null);
  const loadMoreRepliesRef = useRef<((suppressLinuxDoVerification?: boolean) => Promise<LinuxDoReadResumeOutcome>) | null>(null);
  const refreshTopicRepliesRef = useRef<((
    options?: TopicRepliesRefreshOptions,
    suppressLinuxDoVerification?: boolean
  ) => Promise<LinuxDoReadResumeOutcome>) | null>(null);
  const toggleLoadedQuotedPostRef = useRef<((
    options: ToggleTopicBodyQuoteOptions,
    suppressLinuxDoVerification?: boolean,
    recoveryGeneration?: number
  ) => Promise<LinuxDoReadResumeOutcome>) | null>(null);
  const quotedPostRequestGenerationsRef = useRef<Record<string, number>>({});
  const activeTopicRecoveryRef = useRef<{
    key: string;
    lane: 'root' | 'replies' | 'quote';
    quoteInstanceKey?: string;
    source: Source;
  } | null>(null);
  const currentTopic = topicDetail || selectedTopic;
  const currentTopicKey = screen === 'topic' && currentTopic ? topicKey(currentTopic) : null;
  const topicFavorite = useMemo(() => (
    Boolean(currentTopic && readerData.favorites[topicKey(currentTopic)])
  ), [currentTopic, readerData.favorites]);

  useEffect(() => subscribeForumSourceResets(({ source, preserveRecoveryKey }) => {
    const activeRecovery = activeTopicRecoveryRef.current;
    const preservedRecovery = activeRecovery
      && activeRecovery.key === preserveRecoveryKey
      && activeRecovery.source === source
      ? activeRecovery
      : null;
    if (preservedRecovery?.lane !== 'root') {
      nextSourceGeneration(topicRecoveryGenerationRef, source);
    }
    if (preservedRecovery?.lane !== 'replies') {
      nextSourceGeneration(repliesRecoveryGenerationRef, source);
    }
    if (currentTopic?.source === source) {
      if (preservedRecovery?.lane === 'quote' && preservedRecovery.quoteInstanceKey) {
        const generation = quotedPostRequestGenerationsRef.current[preservedRecovery.quoteInstanceKey];
        quotedPostRequestGenerationsRef.current = generation
          ? { [preservedRecovery.quoteInstanceKey]: generation }
          : {};
      } else {
        quotedPostRequestGenerationsRef.current = {};
      }
    }
    if (!preservedRecovery) {
      activeTopicRecoveryRef.current = null;
    }
    topicCommands.invalidateSource(source, {
      preserveCurrent: Boolean(preservedRecovery && preservedRecovery.lane !== 'root')
    });
  }), [currentTopic?.source, topicCommands.invalidateSource]);

  const openTopic = useCallback(async (
    topic: Topic,
    nocache = false,
    suppressLinuxDoVerification = false
  ): Promise<LinuxDoReadResumeOutcome> => {
    const trace = beginDiagnosticTrace('topic', 'open', {
      source: topic.source,
      topicRef: diagnosticRef('topic', `${topic.source}:${topic.id}`),
      mode: nocache ? 'refresh' : 'open'
    });
    const reopenExistingTopicScreen = reopenExistingTopicScreenRef.current;
    const currentScreen = getCurrentScreen();
    reopenExistingTopicScreenRef.current = false;
    const nextTopicKey = topicKey(topic);
    const activeTopicKey = topicCommands.getCurrentKey() || (reopenExistingTopicScreen && selectedTopic ? topicKey(selectedTopic) : null);
    const opensDifferentTopic = nextTopicKey !== activeTopicKey;
    if (currentScreen !== 'topic' && !reopenExistingTopicScreen) {
      topicReturnScreenRef.current = currentScreen;
      topicNavigation.clearBackStack();
    } else if (opensDifferentTopic) {
      topicNavigation.pushBackStack(topicSnapshot(), topic);
      pushTopicScreen();
    }
    if (currentScreen !== 'topic' && shouldReuseCurrentTopicDetail({
      currentDetail: topicDetail,
      nextTopic: topic,
      nocache,
      reopenExistingTopicScreen
    })) {
      topicCommands.reuse(topic, nextTopicKey);
      if (!reopenExistingTopicScreen) {
        changeScreen('topic');
      }
      markDiagnosticStage(trace, 'apply', { state: 'cached-detail-reused' });
      finishDiagnosticTrace(trace, 'success', { state: 'cached-detail-reused' });
      return 'completed';
    }
    if (currentScreen === 'topic' && !reopenExistingTopicScreen && !opensDifferentTopic && !nocache) {
      markDiagnosticStage(trace, 'guard', { state: 'same-topic' });
      finishDiagnosticTrace(trace, 'noop', { reason: 'duplicate' });
      return 'completed';
    }
    const requestGeneration = nextSourceGeneration(topicRecoveryGenerationRef, topic.source);
    let recoveryGeneration = requestGeneration;
    const isCurrentTopicRecovery = () => (
      topicCommands.getCurrentKey() === nextTopicKey
      && currentSourceGeneration(topicRecoveryGenerationRef, topic.source) === recoveryGeneration
    );
    const linuxDoRecovery: LinuxDoReadRecovery = {
      key: `topic:${nextTopicKey}`,
      isCurrent: isCurrentTopicRecovery,
      resume: async () => {
        if (!isCurrentTopicRecovery()) {
          return 'stale';
        }
        const resumedRequest = openTopicRef.current?.(topic, true, true);
        if (!resumedRequest) {
          return 'stale';
        }
        const outcome = await resumedRequest;
        recoveryGeneration = currentSourceGeneration(topicRecoveryGenerationRef, topic.source);
        return outcome;
      }
    };
    const preserveCurrentDetail = Boolean(
      nocache
      && currentScreen === 'topic'
      && !opensDifferentTopic
      && topicDetail
      && topicKey(topicDetail) === nextTopicKey
    );
    if (preserveCurrentDetail) {
      topicCommands.beginRefresh(topic, nextTopicKey);
    } else {
      topicCommands.beginLoad(topic, nextTopicKey);
    }
    if (!reopenExistingTopicScreen) {
      changeScreen('topic');
    }
    const queryKey = forumQueryKeys.topic(topic.source, topic.id);
    if (nocache) {
      await appQueryClient.cancelQueries({ queryKey, exact: true });
      await appQueryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
    }
    let querySignal: AbortSignal | undefined;
    const isLatestTopicRequest = () => (
      topicCommands.getCurrentKey() === nextTopicKey
      && currentSourceGeneration(topicRecoveryGenerationRef, topic.source) === requestGeneration
    );
    const isCurrentTopicRequest = () => isLatestTopicRequest() && !querySignal?.aborted;
    try {
      const detail = await appQueryClient.fetchQuery({
        queryKey,
        queryFn: async ({ signal }) => {
          querySignal = signal;
          const loaded = await sourceGateway.getTopic({
            source: topic.source,
            id: topic.id,
            topic,
            nocache: true,
            signal,
            timeoutMs: topic.source === 'nodeseek' ? NODESEEK_DETAIL_TIMEOUT_MS : topic.source === 'linuxdo' ? LINUXDO_DETAIL_TIMEOUT_MS : undefined
          }, { isCurrent: () => !signal.aborted, trace });
          if (sourceDiagnosticSummary(loaded)?.isParseEmpty) {
            throw new Error('主题内容解析为空，无法显示，请重试。');
          }
          return topicWithAuthorFallback(loaded, topic) || loaded;
        }
      });
      if (!isCurrentTopicRequest()) {
        finishDiagnosticTrace(trace, 'stale', { source: topic.source, reason: 'stale' });
        return 'stale';
      }
      const previousReplyCount = readerDataRef.current.history[topicKey(detail)]?.topic.replyCount;
      topicCommands.resolveLoad(
        detail,
        typeof previousReplyCount === 'number' && detail.replyCount > previousReplyCount ? detail.replyCount - previousReplyCount : 0
      );
      markDiagnosticStage(trace, 'apply', {
        itemCount: detail.replies?.length || 0,
        hasContent: Boolean(detail.contentHtml?.trim())
      });
      commitReaderData('history-recorded', (current) => (
        updateFavoriteTopic(recordHistory(current, detail), detail)
      ));
      if (nocache) {
        notify('主题已更新');
      }
      finishDiagnosticTrace(trace, 'success', {
        itemCount: detail.replies?.length || 0,
        hasContent: Boolean(detail.contentHtml?.trim())
      });
      return 'completed';
    } catch (error) {
      if (isCurrentTopicRequest()) {
        const sourceError = sourceErrorFromUnknown(topic.source, error);
        const message = sourceError.message;
        topicCommands.failLoad(sourceError);
        if (topic.source === 'linuxdo' && sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          if (!suppressLinuxDoVerification) {
            activeTopicRecoveryRef.current = {
              key: linuxDoRecovery.key,
              lane: 'root',
              source: topic.source
            };
            await showLinuxDoVerification(message, linuxDoRecovery);
          }
          return 'verification-required';
        }
        if (topic.source === 'nodeseek' && sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          onNodeSeekTopicVerificationRequired(message);
          return 'completed';
        }
        if (topic.source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'login_required' });
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(message);
          }
          return 'completed';
        }
        if (isCanceledTopicQuery(error)) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
        } else {
          finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          notify(message);
        }
        return isCanceledTopicQuery(error) ? 'stale' : 'failed';
      } else {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return 'stale';
      }
    } finally {
      if (isLatestTopicRequest()) {
        topicCommands.finishLoad();
      }
    }
  }, [
    topicCommands.beginLoad,
    topicCommands.beginRefresh,
    changeScreen,
    commitReaderData,
    topicNavigation.clearBackStack,
    topicCommands.getCurrentKey,
    getCurrentScreen,
    notify,
    topicCommands.failLoad,
    topicCommands.finishLoad,
    pushTopicScreen,
    topicNavigation.pushBackStack,
    readerDataRef,
    reopenExistingTopicScreenRef,
    topicCommands.resolveLoad,
    topicCommands.reuse,
    selectedTopic,
    sourceGateway,
    onNodeSeekTopicVerificationRequired,
    showYaohuoLogin,
    showLinuxDoVerification,
    topicDetail,
    topicReturnScreenRef,
    topicSnapshot
  ]);

  useCommitRefValue(openTopicRef, openTopic);

  const refreshTopicReplies = useCallback(async (
    options: TopicRepliesRefreshOptions = {},
    suppressLinuxDoVerification = false
  ): Promise<LinuxDoReadResumeOutcome> => {
    const {
      silent = false,
      afterSubmit = false,
      nocache = !silent || afterSubmit,
      editedReplyContent,
      targetReply,
      excludeReply,
      diagnosticTrace
    } = options;
    const detail = topicDetail || selectedTopic;
    const ownsTrace = !diagnosticTrace;
    const trace = diagnosticTrace || beginDiagnosticTrace('reply', 'refresh', {
      source: detail?.source || 'unknown',
      ...(detail ? { topicRef: diagnosticRef('topic', `${detail.source}:${detail.id}`) } : {}),
      mode: afterSubmit ? 'after-submit' : silent ? 'silent' : 'manual'
    });
    const finishRefreshTrace = (outcome: Parameters<typeof finishDiagnosticTrace>[1], fields: Parameters<typeof finishDiagnosticTrace>[2] = {}) => {
      if (ownsTrace) {
        finishDiagnosticTrace(trace, outcome, fields);
        return;
      }
      markDiagnosticStage(trace, 'apply', {
        ...fields,
        state: `refresh-${outcome}`
      });
    };
    if (!detail) {
      markDiagnosticStage(trace, 'guard', { state: 'missing-topic' });
      finishRefreshTrace('blocked', { reason: 'not_ready' });
      return 'completed';
    }
    if (detail.source === 'v2ex') {
      markDiagnosticStage(trace, 'guard', { state: 'topic-refresh-delegated' });
      const previousUpdateCount = topicDataUpdateCount(detail);
      const outcome = await openTopic(detail, true);
      const refreshed = outcome === 'completed'
        && topicDataUpdateCount(detail) > previousUpdateCount;
      finishRefreshTrace(
        outcome === 'stale' ? 'stale' : outcome === 'verification-required' ? 'blocked' : refreshed ? 'success' : 'failure',
        {
          state: 'topic-refresh-delegated',
          ...(outcome === 'stale'
            ? { reason: 'stale' as const }
            : outcome === 'verification-required'
              ? { reason: 'verification_required' as const }
              : refreshed ? {} : { reason: 'unknown' as const })
        }
      );
      return outcome;
    }
    const requestTopicKey = topicKey(detail);
    const requestGeneration = nextSourceGeneration(repliesRecoveryGenerationRef, detail.source);
    let recoveryGeneration = requestGeneration;
    const isCurrentRepliesRecovery = () => (
      topicCommands.getCurrentKey() === requestTopicKey
      && currentSourceGeneration(repliesRecoveryGenerationRef, detail.source) === recoveryGeneration
    );
    const recoveryOptions: TopicRepliesRefreshOptions = {
      silent,
      afterSubmit,
      nocache,
      editedReplyContent,
      targetReply,
      excludeReply
    };
    const linuxDoRecovery: LinuxDoReadRecovery = {
      key: `topic-replies:${requestTopicKey}:refresh`,
      isCurrent: isCurrentRepliesRecovery,
      resume: async () => {
        if (!isCurrentRepliesRecovery()) {
          return 'stale';
        }
        const resumedRequest = refreshTopicRepliesRef.current?.(recoveryOptions, true);
        if (!resumedRequest) {
          return 'stale';
        }
        const outcome = await resumedRequest;
        recoveryGeneration = currentSourceGeneration(repliesRecoveryGenerationRef, detail.source);
        return outcome;
      }
    };
    topicReplyCommands.beginLoad();
    let querySignal: AbortSignal | undefined;
    const isLatestRepliesRequest = () => (
      topicCommands.getCurrentKey() === requestTopicKey
      && currentSourceGeneration(repliesRecoveryGenerationRef, detail.source) === requestGeneration
    );
    const isCurrentRepliesRequest = () => isLatestRepliesRequest() && !querySignal?.aborted;
    try {
      const expectedReplyCount = Math.max(detail.replyCount || 0, topicReplies.length) + 1;
      const { page: targetPage, offset: targetOffset, limit: targetLimit } = replyRefreshTarget({
        source: detail.source,
        afterSubmit,
        expectedReplyCount,
        replyNextPage,
        replyNextOffset,
        loadedReplyCount: topicReplies.length,
        targetReplyIndex: replyTargetIndex(topicReplies, targetReply)
      });
      const repliesKey = forumQueryKeys.replies(detail.source, detail.id);
      const queryKey = forumQueryKeys.replyPage(detail.source, detail.id, targetPage, targetOffset);
      await appQueryClient.cancelQueries({ queryKey: repliesKey });
      await appQueryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
      const data = await appQueryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => {
          querySignal = signal;
          return sourceGateway.getReplies({
            source: detail.source,
            id: detail.id,
            categoryId: detail.categoryId,
            page: targetPage,
            limit: targetLimit ?? REPLY_PAGE_SIZE,
            offset: targetOffset,
            nocache: true,
            fillPages: !afterSubmit && detail.source === 'nodeseek',
            signal
          }, { isCurrent: () => !signal.aborted, trace });
        }
      });
      if (!isCurrentRepliesRequest()) {
        finishRefreshTrace('stale', { reason: 'stale' });
        return 'stale';
      }
      if (sourceDiagnosticSummary(data)?.isParseEmpty) {
        throw new Error('评论内容解析为空，无法更新，请重试。');
      }
      const refreshedItems = removeReply(data.items, excludeReply);
      const mergedReplies = mergeReplies(topicReplyCommands.getCurrent(), refreshedItems);
      const displayedReplies = shouldApplyEditedReplyFallback(refreshedItems, editedReplyContent, detail.source)
        ? applyEditedReplyContent(mergedReplies, editedReplyContent, detail.source)
        : mergedReplies;
      const replyCount = afterSubmit && !targetReply && !excludeReply
        ? data.totalCount ?? replyCountAfterNewReplySubmit(detail.replyCount || 0, displayedReplies.length)
        : data.totalCount;
      const replyCountUpdate = typeof replyCount === 'number'
        ? { replyCount, requestTopicKey }
        : {};
      if (afterSubmit && !targetReply && !excludeReply) {
        topicReplyCommands.resolve({ replies: displayedReplies, ...replyCountUpdate });
      }
      if (!afterSubmit) {
        const canLoadNext = hasNextReplyPage({
          hasMore: data.hasMore,
          nextOffset: data.nextOffset,
          nextPage: data.nextPage,
          requestedOffset: targetOffset,
          requestedPage: targetPage
        });
        topicReplyCommands.resolve({
          replies: displayedReplies,
          hasMore: canLoadNext,
          nextPage: data.nextPage ?? null,
          nextOffset: data.nextOffset ?? null,
          ...replyCountUpdate
        });
      } else if (targetReply || excludeReply) {
        topicReplyCommands.resolve({ replies: displayedReplies, ...replyCountUpdate });
      }
      if (!silent) {
        notify(`评论已更新${refreshedItems.length ? `，读取 ${refreshedItems.length} 条` : ''}`);
      }
      markDiagnosticStage(trace, 'apply', {
        beforeCount: topicReplies.length,
        afterCount: displayedReplies.length,
        itemCount: refreshedItems.length
      });
      finishRefreshTrace('success', {
        itemCount: refreshedItems.length,
        hasMore: Boolean(data.hasMore)
      });
      return 'completed';
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        const sourceError = sourceErrorFromUnknown(detail.source, error);
        if (detail.source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          finishRefreshTrace('blocked', { reason: 'login_required' });
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(sourceError.message);
          }
          return 'completed';
        }
        if (detail.source === 'linuxdo' && sourceError.kind === 'verification-required') {
          finishRefreshTrace('blocked', { reason: 'verification_required' });
          if (!suppressLinuxDoVerification) {
            activeTopicRecoveryRef.current = {
              key: linuxDoRecovery.key,
              lane: 'replies',
              source: detail.source
            };
            await showLinuxDoVerification(sourceError.message, linuxDoRecovery);
          }
          return 'verification-required';
        }
        if (detail.source === 'nodeseek' && sourceError.kind === 'verification-required') {
          finishRefreshTrace('blocked', { reason: 'verification_required' });
          topicCommands.failLoad(sourceError);
          onNodeSeekTopicVerificationRequired(sourceError.message);
          return 'completed';
        }
        if (isCanceledTopicQuery(error)) {
          finishRefreshTrace('canceled', { reason: 'canceled' });
        } else {
          finishRefreshTrace('failure', { reason: normalizeDiagnosticReason(error) });
          notify(sourceError.message);
        }
      } else {
        finishRefreshTrace('stale', { reason: 'stale' });
      }
      return isCanceledTopicQuery(error) || !isCurrentRepliesRequest() ? 'stale' : 'failed';
    } finally {
      if (isLatestRepliesRequest()) {
        topicReplyCommands.finishLoad();
      }
    }
  }, [
    topicReplyCommands.beginLoad,
    topicCommands.failLoad,
    topicReplyCommands.finishLoad,
    topicCommands.getCurrentKey,
    topicReplyCommands.getCurrent,
    notify,
    openTopic,
    replyNextOffset,
    replyNextPage,
    selectedTopic,
    sourceGateway,
    topicReplyCommands.resolve,
    onNodeSeekTopicVerificationRequired,
    showLinuxDoVerification,
    showYaohuoLogin,
    topicDetail,
    topicReplies,
  ]);

  useCommitRefValue(refreshTopicRepliesRef, refreshTopicReplies);

  const loadMoreReplies = useCallback(async (
    suppressLinuxDoVerification = false
  ): Promise<LinuxDoReadResumeOutcome> => {
    const detail = topicDetail || selectedTopic;
    const trace = beginDiagnosticTrace('reply', 'load-more', {
      source: detail?.source || 'unknown',
      ...(detail ? { topicRef: diagnosticRef('topic', `${detail.source}:${detail.id}`) } : {}),
      page: replyNextPage || 0
    });
    if (!detail || !replyNextPage || topicReplyCommands.isLoading()) {
      const state = !detail ? 'missing-topic' : !replyNextPage ? 'no-next-page' : 'busy';
      markDiagnosticStage(trace, 'guard', { state });
      finishDiagnosticTrace(
        trace,
        state === 'no-next-page' ? 'noop' : 'blocked',
        { reason: state === 'busy' ? 'busy' : 'not_ready' }
      );
      return 'completed';
    }
    const requestTopicKey = topicKey(detail);
    const requestGeneration = nextSourceGeneration(repliesRecoveryGenerationRef, detail.source);
    let recoveryGeneration = requestGeneration;
    const isCurrentRepliesRecovery = () => (
      topicCommands.getCurrentKey() === requestTopicKey
      && currentSourceGeneration(repliesRecoveryGenerationRef, detail.source) === recoveryGeneration
    );
    const linuxDoRecovery: LinuxDoReadRecovery = {
      key: `topic-replies:${requestTopicKey}:more:${replyNextPage}:${replyNextOffset || ''}`,
      isCurrent: isCurrentRepliesRecovery,
      resume: async () => {
        if (!isCurrentRepliesRecovery()) {
          return 'stale';
        }
        const resumedRequest = loadMoreRepliesRef.current?.(true);
        if (!resumedRequest) {
          return 'stale';
        }
        const outcome = await resumedRequest;
        recoveryGeneration = currentSourceGeneration(repliesRecoveryGenerationRef, detail.source);
        return outcome;
      }
    };
    topicReplyCommands.beginLoad();
    let querySignal: AbortSignal | undefined;
    const isLatestRepliesRequest = () => (
      topicCommands.getCurrentKey() === requestTopicKey
      && currentSourceGeneration(repliesRecoveryGenerationRef, detail.source) === requestGeneration
    );
    const isCurrentRepliesRequest = () => isLatestRepliesRequest() && !querySignal?.aborted;
    try {
      const limit = replyLoadMoreLimit({
        source: detail.source,
        replyNextPage,
        replyNextOffset
      });
      const queryKey = forumQueryKeys.replyPage(detail.source, detail.id, replyNextPage, replyNextOffset);
      const data = await appQueryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => {
          querySignal = signal;
          return sourceGateway.getReplies({
            source: detail.source,
            id: detail.id,
            categoryId: detail.categoryId,
            page: replyNextPage,
            limit,
            offset: replyNextOffset,
            nocache: true,
            signal
          }, { isCurrent: () => !signal.aborted, trace });
        }
      });
      if (!isCurrentRepliesRequest()) {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return 'stale';
      }
      if (sourceDiagnosticSummary(data)?.isParseEmpty) {
        throw new Error('评论内容解析为空，无法加载下一页，请重试。');
      }
      const currentReplies = topicReplyCommands.getCurrent();
      const mergedReplies = mergeReplies(currentReplies, data.items);
      const canLoadNext = hasNextReplyPage({
        hasMore: data.hasMore,
        nextOffset: data.nextOffset,
        nextPage: data.nextPage,
        requestedOffset: replyNextOffset,
        requestedPage: replyNextPage
      });
      const repeatedCursor = Boolean(data.hasMore && data.nextPage && !canLoadNext);
      topicReplyCommands.resolve({
        replies: mergedReplies,
        hasMore: canLoadNext,
        nextPage: data.nextPage ?? null,
        nextOffset: data.nextOffset ?? null,
        ...(typeof data.totalCount === 'number' ? { replyCount: data.totalCount, requestTopicKey } : {})
      });
      markDiagnosticStage(trace, 'apply', {
        beforeCount: currentReplies.length,
        afterCount: mergedReplies.length,
        itemCount: data.items.length,
        hasMore: canLoadNext
      });
      finishDiagnosticTrace(
        trace,
        repeatedCursor ? 'partial' : 'success',
        repeatedCursor ? { reason: 'duplicate' } : { itemCount: data.items.length }
      );
      notify(`已加载 ${data.items.length} 条回复`);
      return 'completed';
    } catch (error) {
      if (isCurrentRepliesRequest()) {
        const sourceError = sourceErrorFromUnknown(detail.source, error);
        if (detail.source === 'yaohuo' && yaohuoErrorRequiresLoginPanel(sourceError)) {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'login_required' });
          if (sourceError.kind === 'login-expired') {
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(sourceError.message);
          }
          return 'completed';
        }
        if (detail.source === 'linuxdo' && sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          if (!suppressLinuxDoVerification) {
            activeTopicRecoveryRef.current = {
              key: linuxDoRecovery.key,
              lane: 'replies',
              source: detail.source
            };
            await showLinuxDoVerification(sourceError.message, linuxDoRecovery);
          }
          return 'verification-required';
        }
        if (detail.source === 'nodeseek' && sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          topicCommands.failLoad(sourceError);
          onNodeSeekTopicVerificationRequired(sourceError.message);
          return 'completed';
        }
        if (isCanceledTopicQuery(error)) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
        } else {
          finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          notify(sourceError.message);
        }
        return isCanceledTopicQuery(error) ? 'stale' : 'failed';
      } else {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return 'stale';
      }
    } finally {
      if (isLatestRepliesRequest()) {
        topicReplyCommands.finishLoad();
      }
    }
  }, [
    topicReplyCommands.beginLoad,
    topicCommands.failLoad,
    topicReplyCommands.finishLoad,
    topicCommands.getCurrentKey,
    topicReplyCommands.getCurrent,
    topicReplyCommands.isLoading,
    notify,
    replyNextOffset,
    replyNextPage,
    selectedTopic,
    sourceGateway,
    topicReplyCommands.resolve,
    onNodeSeekTopicVerificationRequired,
    showYaohuoLogin,
    showLinuxDoVerification,
    topicDetail
  ]);

  useCommitRefValue(loadMoreRepliesRef, loadMoreReplies);

  const refreshWholeTopic = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (detail) {
      const previousUpdateCount = topicDataUpdateCount(detail);
      const outcome = await openTopic(detail, true);
      return outcome === 'completed' && topicDataUpdateCount(detail) > previousUpdateCount
        ? 'completed' as const
        : outcome === 'completed' ? 'failed' as const : outcome;
    }
    return 'stale' as const;
  }, [openTopic, selectedTopic, topicDetail]);

  const toggleLoadedQuotedPost = useCallback(async (
    options: ToggleTopicBodyQuoteOptions,
    suppressLinuxDoVerification = false,
    recoveryGeneration?: number
  ): Promise<LinuxDoReadResumeOutcome> => {
    const { instanceKey, reference, quotedPost } = options;
    const detail = topicDetail || selectedTopic;
    const trace = beginDiagnosticTrace('reply', 'toggle-quote', {
      source: detail?.source || 'unknown',
      ...(detail ? { topicRef: diagnosticRef('topic', `${detail.source}:${detail.id}`) } : {})
    });
    const referenceKey = quotedPostReferenceKey(reference);
    const key = instanceKey;
    const requestGeneration = recoveryGeneration
      ?? (quotedPostRequestGenerationsRef.current[key] || 0) + 1;
    if (recoveryGeneration === undefined) {
      quotedPostRequestGenerationsRef.current[key] = requestGeneration;
    }
    if (topicQuotes.isExpanded(key)) {
      topicQuotes.changeExpanded(key, false);
      markDiagnosticStage(trace, 'apply', { state: 'collapsed' });
      finishDiagnosticTrace(trace, 'success', { state: 'collapsed' });
      return 'completed';
    }

    const queryKey = forumQueryKeys.reply(reference.source, reference.topicId, String(reference.postNumber));
    const cachedReply = appQueryClient.getQueryData<Reply>(queryKey);
    if (quotedPost || topicQuotes.getLoaded(referenceKey) || cachedReply) {
      if (cachedReply) {
        topicQuotes.remember(referenceKey, cachedReply);
      }
      topicQuotes.changeExpanded(key, true);
      markDiagnosticStage(trace, 'apply', { state: 'cached-quote' });
      finishDiagnosticTrace(trace, 'success', { state: 'cached-quote' });
      return 'completed';
    }

    if (!detail || !isDiscourseSource(reference.source)) {
      markDiagnosticStage(trace, 'guard', { state: detail ? 'unsupported-source' : 'missing-topic' });
      finishDiagnosticTrace(trace, 'blocked', { reason: detail ? 'unsupported' : 'not_ready' });
      notify('引用楼层未加载');
      topicQuotes.changeExpanded(key, true);
      return 'failed';
    }
    const requestTopicKey = topicKey(detail);
    const isCurrentQuotedPostFlow = () => (
      topicCommands.getCurrentKey() === requestTopicKey
      && quotedPostRequestGenerationsRef.current[key] === requestGeneration
    );
    const linuxDoRecovery: LinuxDoReadRecovery = {
      key: `topic-quote:${requestTopicKey}:${referenceKey}`,
      isCurrent: isCurrentQuotedPostFlow,
      resume: async () => {
        if (!isCurrentQuotedPostFlow()) {
          return 'stale';
        }
        return await toggleLoadedQuotedPostRef.current?.(options, true, requestGeneration) ?? 'stale';
      }
    };

    topicQuotes.changeLoading(key, true);
    let querySignal: AbortSignal | undefined;
    const isCurrentQuotedPostRequest = () => (
      isCurrentQuotedPostFlow()
      && !querySignal?.aborted
    );
    try {
      const loaded = await appQueryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => {
          querySignal = signal;
          return sourceGateway.getReply({
            source: reference.source,
            id: reference.topicId,
            floor: reference.postNumber,
            signal
          }, { isCurrent: () => !signal.aborted, trace });
        }
      });
      if (!isCurrentQuotedPostRequest()) {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return 'stale';
      }
      if (sourceDiagnosticSummary(loaded)?.isParseEmpty) {
        throw new Error('引用内容解析为空，无法展开，请重试。');
      }
      topicQuotes.remember(referenceKey, loaded);
      topicQuotes.changeExpanded(key, true);
      markDiagnosticStage(trace, 'apply', { state: 'quote-expanded' });
      finishDiagnosticTrace(trace, 'success');
      notify(`引用已展开 #${reference.postNumber}`);
      return 'completed';
    } catch (error) {
      if (isCurrentQuotedPostRequest()) {
        const sourceError = sourceErrorFromUnknown(reference.source, error);
        if (sourceError.kind === 'verification-required') {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'verification_required' });
          if (!suppressLinuxDoVerification) {
            activeTopicRecoveryRef.current = {
              key: linuxDoRecovery.key,
              lane: 'quote',
              quoteInstanceKey: key,
              source: reference.source
            };
            await showLinuxDoVerification(sourceError.message, linuxDoRecovery);
          }
          return 'verification-required';
        }
        if (isCanceledTopicQuery(error)) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          return 'stale';
        } else {
          finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          notify(sourceError.message);
          return 'failed';
        }
      } else {
        finishDiagnosticTrace(trace, 'stale', { reason: 'stale' });
        return 'stale';
      }
    } finally {
      if (isCurrentQuotedPostFlow()) {
        topicQuotes.changeLoading(key, false);
      }
    }
  }, [
    topicCommands.getCurrentKey,
    topicQuotes.getLoaded,
    topicQuotes.isExpanded,
    notify,
    topicQuotes.remember,
    selectedTopic,
    sourceGateway,
    showLinuxDoVerification,
    topicQuotes.changeExpanded,
    topicQuotes.changeLoading,
    topicDetail,
  ]);

  useCommitRefValue(toggleLoadedQuotedPostRef, toggleLoadedQuotedPost);

  const toggleTopicBodyQuote = useCallback((options: ToggleTopicBodyQuoteOptions) => (
    toggleLoadedQuotedPost(options)
  ), [toggleLoadedQuotedPost]);

  const toggleReplyQuote = useCallback(({
    replyFloor,
    quotedFloor,
    quotedReply
  }: ToggleReplyQuoteOptions) => {
    const detail = topicDetail || selectedTopic;
    const reference = quotedPostReferenceFromReply(detail?.source, detail?.id, quotedFloor);
    if (!reference) {
      notify('引用楼层未加载');
      return;
    }
    return toggleLoadedQuotedPost({
      instanceKey: replyQuotedPostInstanceKey(replyFloor, reference),
      reference,
      quotedPost: quotedReply
    });
  }, [notify, selectedTopic, toggleLoadedQuotedPost, topicDetail]);

  return {
    currentTopic,
    currentTopicKey,
    loadMoreReplies,
    openTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    toggleReplyQuote,
    toggleTopicBodyQuote,
    topicFavorite
  };
}
