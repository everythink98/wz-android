import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { type DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import type { ReadGateway } from '@/sources/readGateway';
import type { RepliesResponse, Reply, ReplyLocationTarget, Source, Topic, TopicDetail } from '@/domain/forum/models';
import { resolveForumReadPlan } from '@/domain/forum/readPlan';
import { isSessionSource, type SessionSource } from '@/domain/forum/sourceCatalog';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { prepareReplyContent } from '@/domain/forum/topicContentSplit';

const firstTopic: Topic = {
  source: 'nodeseek',
  id: '1',
  title: 'First',
  author: 'alice',
  url: 'https://www.nodeseek.com/post-1-1',
  createdAt: '2026-07-20T00:00:00.000Z',
  replyCount: 1
};
const firstReply: Reply = {
  author: 'bob',
  floor: 1,
  commentId: 10,
  contentHtml: '<p>first</p>',
  createdAt: '2026-07-20T00:01:00.000Z'
};
const firstDetail: TopicDetail = {
  ...firstTopic,
  contentHtml: '<p>body</p>',
  replies: [firstReply]
};

type TestGetTopic = (...args: Parameters<ReadGateway['getTopic']>) => Promise<TopicDetail>;
type TestGetReplies = (...args: Parameters<ReadGateway['getReplies']>) => Promise<RepliesResponse>;
type TestGetReply = (...args: Parameters<ReadGateway['getReply']>) => Promise<Reply>;
type TestReadGateway = Omit<Partial<ReadGateway>, 'getTopic' | 'getReplies' | 'getReply'> & {
  getTopic?: TestGetTopic;
  getReplies?: TestGetReplies;
  getReply?: TestGetReply;
};

type ReplyRequest = Parameters<TestGetReplies>[0];

function replyRequestPage(request: ReplyRequest) {
  return request.position.kind === 'cursor' ? request.position.page : undefined;
}

function replyRequestTarget(request: ReplyRequest) {
  return request.position.kind === 'target' ? request.position.target : undefined;
}

describe('topic route sessions', () => {
  it('keeps route-local draft and filter state across rerenders', async () => {
    const hook = await renderNativeHook(() => useTopicSessionController({ notify: jest.fn(), topic: firstTopic }));
    await act(async () => {
      hook.result.current.commands.composer.changeContent('current draft');
      hook.result.current.commands.view.changeReplyFilter('author');
      hook.result.current.commands.view.changeReplyOrder('newest');
    });
    hook.rerender(undefined);
    expect(hook.result.current.state.replyContent).toBe('current draft');
    expect(hook.result.current.state.replyFilter).toBe('author');
    expect(hook.result.current.state.replyOrder).toBe('newest');
    expect(hook.result.current.state.selectedTopic).toEqual(firstTopic);
  });

  it('isolates state between native Topic route instances', async () => {
    const secondTopic: Topic = {
      ...firstTopic,
      id: '2',
      title: 'Still loading',
      url: 'https://www.nodeseek.com/post-2-1'
    };
    const first = await renderNativeHook(() => useTopicSessionController({ notify: jest.fn(), topic: firstTopic }));
    const second = await renderNativeHook(() => useTopicSessionController({ notify: jest.fn(), topic: secondTopic }));
    await act(async () => {
      first.result.current.commands.composer.changeContent('first draft');
      first.result.current.commands.view.changeReplyOrder('newest');
      second.result.current.commands.composer.changeContent('second draft');
    });
    expect(first.result.current.state.replyContent).toBe('first draft');
    expect(second.result.current.state.replyContent).toBe('second draft');
    expect(first.result.current.state.replyOrder).toBe('newest');
    expect(second.result.current.state.replyOrder).toBe('oldest');
    expect(first.result.current.state.selectedTopic).toEqual(firstTopic);
    expect(second.result.current.state.selectedTopic).toEqual(secondTopic);
  });
});

function renderTopicController({
  getActive = () => true,
  getIdentityBarriers = () => [],
  getIdentityTrust,
  getSourceEnabled = () => true,
  getSessionEpochs = () => initialForumSessionEpochs,
  notify = jest.fn(),
  onRetryIdentityStatus = jest.fn(),
  onNodeSeekTopicVerificationRequired = jest.fn(),
  onOpenTopic = jest.fn(),
  onReplyLocationResolved = jest.fn(),
  readGateway,
  showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
  showYaohuoLogin = jest.fn<(message?: string) => void>(),
  targetReply,
  getTargetReplyRequestId = () => undefined,
  topic = firstTopic
}: {
  getActive?: () => boolean;
  getIdentityBarriers?: () => SessionSource[];
  getIdentityTrust?: (source: SessionRuntimeSnapshot['source']) => SessionRuntimeSnapshot['identityTrust'];
  getSourceEnabled?: (source: Source) => boolean;
  getSessionEpochs?: () => ForumSessionEpochs;
  notify?: (message: string) => void;
  onRetryIdentityStatus?: (source: Source) => Promise<unknown> | unknown;
  onNodeSeekTopicVerificationRequired?: (message: string, recovery: LinuxDoReadRecovery) => void;
  onOpenTopic?: (topic: Topic) => void;
  onReplyLocationResolved?: (target: ReplyLocationTarget) => void;
  readGateway: TestReadGateway;
  showLinuxDoVerification?: (message?: string, recovery?: LinuxDoReadRecovery) => void;
  showYaohuoLogin?: (message?: string) => void;
  targetReply?: ReplyLocationTarget;
  getTargetReplyRequestId?: () => number | undefined;
  topic?: Topic;
}) {
  const readerData = createEmptyReaderData();
  return renderNativeHook(
    () => {
      const session = useTopicSessionController({ notify, topic });
      const gateway = {
        ...readGateway,
        getReadPlan: (source, operation) => {
          const authSurfaceOpen = isSessionSource(source) && getIdentityBarriers().includes(source);
          const identityTrust = isSessionSource(source) ? getIdentityTrust?.(source) || 'confirmed' : undefined;
          return resolveForumReadPlan(
            source,
            operation,
            getSourceEnabled(source),
            isSessionSource(source)
              ? {
                  source,
                  authenticated: identityTrust === 'confirmed',
                  authSurfaceOpen,
                  identityKey: `${source}:test`,
                  identityTrust: identityTrust!,
                  sessionEpoch: getSessionEpochs()[source],
                  sourceEnabled: getSourceEnabled(source)
                }
              : undefined
          );
        }
      } as ReadGateway;
      const controller = useTopicController({
        active: getActive(),
        commitReaderData: jest.fn(),
        sessionEpochs: getSessionEpochs(),
        notify,
        onRetryIdentityStatus,
        onNodeSeekTopicVerificationRequired,
        onOpenTopic,
        onReplyLocationResolved,
        readerData,
        readerDataRef: { current: readerData },
        showLinuxDoVerification,
        showYaohuoLogin,
        readGateway: gateway,
        targetReply,
        targetReplyRequestId: getTargetReplyRequestId(),
        topic,
        topicSession: session
      });
      return { controller, session };
    },
    { wrapper: QueryTestWrapper }
  );
}

describe('topic query controller', () => {
  beforeEach(() => appQueryClient.clear());
  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    setDiagnosticWriter(null);
  });

  it('reads a public LinuxDo Topic while account identity remains pending', async () => {
    const topic = {
      ...firstTopic,
      source: 'linuxdo' as const,
      url: 'https://linux.do/t/1'
    };
    const detail = { ...firstDetail, ...topic };
    const getTopic = jest.fn<TestGetTopic>(async () => detail);
    const hook = await renderTopicController({
      getIdentityBarriers: () => ['linuxdo'],
      readGateway: { getTopic },
      topic
    });

    await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    expect(getTopic).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'linuxdo' }),
      expect.objectContaining({ readPlanScope: 'public:omit' })
    );
  });

  it('reuses the current Topic from the process RAM cache on re-entry', async () => {
    const getTopic = jest.fn<TestGetTopic>(async () => firstDetail);
    const first = await renderTopicController({ readGateway: { getTopic } });
    await waitFor(() => expect(first.result.current.controller.topicDetail).toEqual(firstDetail));
    await act(async () => first.unmount());

    const second = await renderTopicController({ readGateway: { getTopic } });
    await waitFor(() => expect(second.result.current.controller.topicDetail).toEqual(firstDetail));

    expect(getTopic).toHaveBeenCalledTimes(1);
    await act(async () => second.unmount());
  });

  it('keeps empty quote projections stable across unrelated rerenders', async () => {
    const getTopic = jest.fn<TestGetTopic>(async () => firstDetail);
    const hook = await renderTopicController({ readGateway: { getTopic } });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(firstDetail));
    const loadedQuotedReplies = hook.result.current.controller.loadedQuotedReplies;
    const loadingQuotedFloors = hook.result.current.controller.loadingQuotedFloors;

    await act(async () => hook.rerender(undefined));

    expect(hook.result.current.controller.loadedQuotedReplies).toBe(loadedQuotedReplies);
    expect(hook.result.current.controller.loadingQuotedFloors).toBe(loadingQuotedFloors);
    expect(getTopic).toHaveBeenCalledTimes(1);
  });

  it('settles a pending Yaohuo Topic as a terminal read error instead of permanent loading', async () => {
    const topic = { ...firstTopic, source: 'yaohuo' as const, url: 'https://www.yaohuo.me/bbs-1.html' };
    const getTopic = jest.fn<TestGetTopic>(async () => {
      throw Object.assign(new Error('登录状态暂时无法确认'), {
        kind: 'login-required' as const,
        reason: 'identity-pending',
        retryable: true,
        source: 'yaohuo' as const
      });
    });
    const hook = await renderTopicController({
      getIdentityBarriers: () => ['yaohuo'],
      readGateway: { getTopic },
      topic
    });

    await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.controller.topicError).not.toBeNull());
    expect(hook.result.current.controller.topicBusy).toBe(false);
  });

  it('retries an unknown strict Topic by reconciling identity without replaying transport', async () => {
    const topic = { ...firstTopic, source: 'yaohuo' as const, url: 'https://www.yaohuo.me/bbs-1.html' };
    const onRetryIdentityStatus = jest.fn(async () => undefined);
    const getTopic = jest.fn<TestGetTopic>(async () => {
      throw Object.assign(new Error('登录状态核对失败，请重试'), {
        kind: 'ordinary' as const,
        reason: 'identity-unavailable',
        retryable: true,
        source: 'yaohuo' as const
      });
    });
    const hook = await renderTopicController({
      getIdentityTrust: () => 'unknown',
      onRetryIdentityStatus,
      readGateway: { getTopic },
      topic
    });
    await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(1));

    await act(async () => {
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('stale');
    });

    expect(onRetryIdentityStatus).toHaveBeenCalledTimes(1);
    expect(onRetryIdentityStatus).toHaveBeenCalledWith('yaohuo');
    expect(getTopic).toHaveBeenCalledTimes(1);
  });

  it('opens Yaohuo login for a typed anonymous Topic block', async () => {
    const topic = { ...firstTopic, source: 'yaohuo' as const, url: 'https://www.yaohuo.me/bbs-1.html' };
    const showYaohuoLogin = jest.fn();
    const getTopic = jest.fn<TestGetTopic>(async () => {
      throw Object.assign(new Error('请先登录该内容源'), {
        kind: 'login-required' as const,
        loginRequired: true,
        reason: 'login-required',
        source: 'yaohuo' as const
      });
    });
    await renderTopicController({
      getIdentityTrust: () => 'none',
      readGateway: { getTopic },
      showYaohuoLogin,
      topic
    });

    await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(1));
    expect(showYaohuoLogin).toHaveBeenCalledWith('请先登录该内容源');
  });

  it('never reconciles identity for a disabled Topic', async () => {
    const topic = { ...firstTopic, source: 'yaohuo' as const, url: 'https://www.yaohuo.me/bbs-1.html' };
    const onRetryIdentityStatus = jest.fn(async () => undefined);
    const getTopic = jest.fn<TestGetTopic>(async () => {
      throw Object.assign(new Error('内容源已停用'), { reason: 'source-disabled' });
    });
    const hook = await renderTopicController({
      getIdentityTrust: () => 'unknown',
      getSourceEnabled: () => false,
      onRetryIdentityStatus,
      readGateway: { getTopic },
      topic
    });
    await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(1));

    await act(async () => {
      await hook.result.current.controller.refreshWholeTopic();
    });

    expect(onRetryIdentityStatus).not.toHaveBeenCalled();
    expect(getTopic).toHaveBeenCalledTimes(1);
  });

  it('replaces a partial Yaohuo reply seed with an authoritative start window', async () => {
    const topic: Topic = {
      ...firstTopic,
      source: 'yaohuo',
      url: 'https://www.yaohuo.me/bbs/book_view.aspx?id=1&classid=177'
    };
    const partialDetail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: [],
      replyCompleteness: 'partial',
      replyHasMore: true,
      replyNextPage: null,
      replyNextOffset: null
    };
    const getTopic = jest.fn<TestGetTopic>(async () => partialDetail);
    const getReplies = jest.fn<TestGetReplies>(async () => ({
      items: [firstReply],
      currentPage: 1,
      currentOffset: 0,
      previousPage: null,
      previousOffset: null,
      hasMore: false,
      nextPage: null,
      nextOffset: null,
      totalCount: 1
    }));
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic }, topic });

    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({ position: { kind: 'start' }, source: 'yaohuo' }),
      expect.objectContaining({ readPlanScope: expect.stringContaining('authenticated:') })
    );
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
  });

  it('exposes a non-V2EX partial reply window without disabling server order', async () => {
    const detail: TopicDetail = {
      ...firstDetail,
      replyCount: 2,
      replies: [firstReply],
      replyCompleteness: 'partial',
      replyHasMore: false,
      replyNextPage: null,
      replyNextOffset: null
    };
    const getReplies = jest.fn<TestGetReplies>();
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      }
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
    expect(hook.result.current.controller.replyRowsPartial).toBe(true);
    expect(hook.result.current.controller.replyCollectionComplete).toBe(true);
    expect(getReplies).not.toHaveBeenCalled();
  });

  it('uses one transport for repeated opens of the same key', async () => {
    const pending = Promise.withResolvers<TopicDetail>();
    const getTopic = jest.fn<TestGetTopic>(async () => pending.promise);
    const hook = await renderTopicController({ readGateway: { getTopic } });

    await act(async () => {
      await hook.result.current.controller.openTopic(firstTopic);
      await hook.result.current.controller.openTopic(firstTopic);
    });
    await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(1));
    await act(async () => {
      pending.resolve(firstDetail);
      await pending.promise;
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(firstDetail));
    expect(getTopic).toHaveBeenCalledTimes(1);
  });

  it('converts a linux.do embedded seed offset into the real stream window once', async () => {
    const source = 'linuxdo' as const;
    const topic: Topic = {
      ...firstTopic,
      source,
      url: 'https://linux.do/t/1'
    };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: [firstReply, { ...firstReply, floor: 2, commentId: 11 }],
      replyCount: 5,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 2
    };
    const getReplies = jest.fn<TestGetReplies>(async () => ({
      items: [{ ...firstReply, floor: 3, commentId: 12 }],
      currentPage: 1,
      currentOffset: 2,
      previousPage: null,
      previousOffset: null,
      hasMore: false,
      nextPage: null,
      nextOffset: null,
      totalCount: 5
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      },
      topic
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(2));
    await act(async () => {
      await hook.result.current.controller.loadMoreReplies({ silent: true });
    });

    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        order: 'oldest',
        position: { kind: 'cursor', page: 1, offset: 2 }
      }),
      expect.anything()
    );
  });

  it('keeps ordered caches separate and loads the newest tail before its adjacent older window', async () => {
    const detail: TopicDetail = {
      ...firstDetail,
      replies: [firstReply, { ...firstReply, floor: 2, commentId: 11, author: 'head-2' }],
      replyCount: 45,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 2
    };
    const tailReplies = [
      { ...firstReply, floor: 45, commentId: 145, author: 'tail-45' },
      { ...firstReply, floor: 44, commentId: 144, author: 'tail-44' }
    ];
    const olderReplies = [
      { ...firstReply, floor: 40, commentId: 140, author: 'older-40' },
      { ...firstReply, floor: 39, commentId: 139, author: 'older-39' }
    ];
    const pendingTail = Promise.withResolvers<Awaited<ReturnType<TestGetReplies>>>();
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      if (request.position.kind === 'start') return pendingTail.promise;
      if (request.position.kind === 'cursor' && request.position.page === 4) {
        return {
          items: olderReplies,
          currentPage: 4,
          currentOffset: 30,
          previousPage: 5,
          previousOffset: 40,
          hasMore: false,
          nextPage: null,
          totalCount: 45
        };
      }
      throw new Error(`unexpected reply position ${JSON.stringify(request.position)}`);
    });
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      }
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([1, 2]));
    const oldestKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'oldest', 'authenticated:0');
    const newestKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'newest', 'authenticated:0');

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    expect(hook.result.current.controller.repliesLoading).toBe(true);
    expect(hook.result.current.controller.topicReplies).toEqual([]);
    expect(getReplies.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ order: 'newest', position: { kind: 'start' }, replyCount: 45 })
    );

    await act(async () => {
      pendingTail.resolve({
        items: tailReplies,
        currentPage: 5,
        currentOffset: 40,
        hasMore: true,
        nextPage: 4,
        nextOffset: 30,
        totalCount: 45
      });
      await pendingTail.promise;
    });
    await waitFor(() =>
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([45, 44])
    );

    await act(async () => {
      await hook.result.current.controller.loadMoreReplies({ silent: true });
    });
    expect(getReplies.mock.calls.map(([request]) => replyRequestPage(request))).toEqual([undefined, 4]);
    expect(getReplies.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        order: 'newest',
        position: { kind: 'cursor', page: 4, offset: 30 }
      })
    );
    await waitFor(() =>
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([45, 44, 40, 39])
    );
    expect(appQueryClient.getQueryData(oldestKey)).toBeDefined();
    expect(appQueryClient.getQueryData(newestKey)).toBeDefined();
    expect(lines.map((line) => JSON.parse(line) as DiagnosticEvent)).toContainEqual(
      expect.objectContaining({
        area: 'reply',
        operation: 'refresh',
        outcome: 'success',
        phase: 'finish',
        positionKind: 'start',
        replyOrder: 'newest',
        resolvedPage: 5
      })
    );

    await act(async () => {
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('completed');
    });
    expect(appQueryClient.getQueryData(oldestKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(newestKey)).toBeDefined();

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('oldest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([1, 2]));
    expect(getReplies).toHaveBeenCalledTimes(3);
  });

  it('reorders a complete V2EX collection locally and refreshes only replies', async () => {
    const replies = [
      { ...firstReply, floor: 1, commentId: 101 },
      { ...firstReply, floor: 2, commentId: 102 },
      { ...firstReply, floor: 3, commentId: 103 }
    ];
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 3 };
    const detail = {
      ...firstDetail,
      ...topic,
      replies,
      replyCompleteness: 'complete' as const,
      replyHasMore: false,
      replyNextPage: null
    };
    const getTopic = jest.fn<TestGetTopic>(async () => detail);
    const getReplies = jest.fn<TestGetReplies>(async () => ({
      items: replies,
      completeness: 'complete',
      currentPage: 1,
      currentOffset: 0,
      previousPage: null,
      previousOffset: null,
      hasMore: false,
      nextPage: null,
      nextOffset: null,
      totalCount: 3
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic,
        getReplies
      },
      topic
    });

    await waitFor(() =>
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([1, 2, 3])
    );
    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });

    await waitFor(() =>
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([3, 2, 1])
    );
    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('oldest');
    });
    await waitFor(() =>
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([1, 2, 3])
    );
    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies()).resolves.toBe('completed');
    });

    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getReplies).toHaveBeenCalledTimes(1);
  });

  it('keeps the first 100 V2EX replies without transport until loading the linked next page', async () => {
    jest.useFakeTimers();
    try {
      const prefix = Array.from({ length: 100 }, (_, index) => ({
        ...firstReply,
        floor: index + 1,
        commentId: index + 101
      }));
      const nextReplies = Array.from({ length: 47 }, (_, index) => ({
        ...firstReply,
        floor: index + 101,
        commentId: index + 201
      }));
      const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 147 };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        contentHtml: '<p>V2EX body</p>',
        replies: prefix,
        replyCompleteness: 'complete',
        replyHasMore: true,
        replyNextPage: 2,
        replyNextOffset: null
      };
      const pendingReplies = Promise.withResolvers<RepliesResponse>();
      const getReplies = jest.fn<TestGetReplies>(() => pendingReplies.promise);
      const hook = await renderTopicController({
        readGateway: {
          getTopic: jest.fn<TestGetTopic>(async () => detail),
          getReplies
        },
        topic
      });

      await waitFor(() => expect(hook.result.current.controller.topicDetail?.contentHtml).toContain('V2EX body'));
      expect(hook.result.current.controller.topicDetail?.contentHtml).toContain('V2EX body');
      expect(getReplies).not.toHaveBeenCalled();
      expect(hook.result.current.controller.topicReplies).toHaveLength(100);
      expect(hook.result.current.controller.topicReplies.at(-1)?.floor).toBe(100);
      expect(hook.result.current.controller.replyHasMore).toBe(true);
      expect(hook.result.current.controller.replyRowsPartial).toBe(false);

      let loadMore: ReturnType<typeof hook.result.current.controller.loadMoreReplies>;
      await act(async () => {
        loadMore = hook.result.current.controller.loadMoreReplies({ silent: true });
        await Promise.resolve();
      });
      await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
      expect(getReplies).toHaveBeenCalledWith(
        expect.objectContaining({ position: { kind: 'cursor', page: 2, offset: null } }),
        expect.anything()
      );

      await act(async () => {
        pendingReplies.resolve({
          items: nextReplies,
          completeness: 'complete',
          currentPage: 2,
          currentOffset: null,
          previousPage: 1,
          previousOffset: null,
          hasMore: false,
          nextPage: null,
          nextOffset: null,
          totalCount: 147
        });
        await loadMore;
      });
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(147));
      expect(hook.result.current.controller.topicReplies.at(-1)?.floor).toBe(147);
      expect(hook.result.current.controller.replyCollectionComplete).toBe(true);
      expect(hook.result.current.controller.replyHasMore).toBe(false);
      expect(hook.result.current.controller.replyRowsPartial).toBe(false);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(getReplies).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps all 146 valid V2EX replies when one later-page row is malformed', async () => {
    const prefix = Array.from({ length: 100 }, (_, index) => ({
      ...firstReply,
      floor: index + 1,
      commentId: index + 101
    }));
    const partialReplies = Array.from({ length: 46 }, (_, index) => ({
      ...firstReply,
      floor: index + 101,
      commentId: index + 201
    }));
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 147 };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: prefix,
      replyCompleteness: 'complete',
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: null
    };
    const getReplies = jest.fn<TestGetReplies>(async () => ({
      items: partialReplies,
      completeness: 'partial',
      currentPage: 2,
      currentOffset: null,
      previousPage: 1,
      previousOffset: null,
      hasMore: false,
      nextPage: null,
      nextOffset: null,
      totalCount: 147
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      },
      topic
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(100));
    expect(getReplies).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.controller.loadMoreReplies({ silent: true });
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(146));
    expect(hook.result.current.controller.topicReplies.at(-1)?.floor).toBe(146);
    expect(hook.result.current.controller.replyRowsPartial).toBe(true);
    expect(hook.result.current.controller.replyCollectionComplete).toBe(true);
    expect(hook.result.current.controller.topicDetail?.replyCount).toBe(147);
    expect(getReplies).toHaveBeenCalledTimes(1);
  });

  it('keeps a 100-reply V2EX prefix after an explicit next-page read fails', async () => {
    jest.useFakeTimers();
    try {
      const prefix = Array.from({ length: 100 }, (_, index) => ({
        ...firstReply,
        floor: index + 1,
        commentId: index + 101
      }));
      const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 147 };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        contentHtml: '<p>V2EX body</p>',
        replies: prefix,
        replyCompleteness: 'complete',
        replyHasMore: true,
        replyNextPage: 2,
        replyNextOffset: null
      };
      const getReplies = jest.fn<TestGetReplies>(async () => {
        throw new Error('V2EX 回复总数已变化，无法确认完整集合');
      });
      const hook = await renderTopicController({
        readGateway: {
          getTopic: jest.fn<TestGetTopic>(async () => detail),
          getReplies
        },
        topic
      });

      await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(100));
      expect(getReplies).not.toHaveBeenCalled();
      await act(async () => {
        await expect(hook.result.current.controller.loadMoreReplies({ silent: true })).resolves.toBe('failed');
      });
      await waitFor(() => expect(hook.result.current.controller.replyEndError?.message).toContain('回复总数已变化'));
      expect(hook.result.current.controller.topicDetail?.contentHtml).toContain('V2EX body');
      expect(hook.result.current.controller.topicReplies).toHaveLength(100);
      expect(hook.result.current.controller.topicReplies.at(-1)?.floor).toBe(100);
      expect(hook.result.current.controller.replyRowsPartial).toBe(false);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(getReplies).toHaveBeenCalledTimes(1);
      expect(hook.result.current.controller.topicReplies).toHaveLength(100);
      expect(hook.result.current.controller.replyCollectionComplete).toBe(true);
      expect(hook.result.current.controller.topicError).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads an empty partial V2EX window once and then settles', async () => {
    jest.useFakeTimers();
    try {
      const recovered = { ...firstReply, floor: 2, commentId: 102 };
      const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 2 };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        replies: [],
        replyCompleteness: 'partial',
        replyCount: undefined,
        replyHasMore: true,
        replyNextPage: null
      };
      const getReplies = jest.fn<TestGetReplies>(async () => ({
        items: [recovered],
        completeness: 'partial',
        currentPage: 1,
        currentOffset: 0,
        previousPage: null,
        previousOffset: null,
        hasMore: false,
        nextPage: null,
        nextOffset: null,
        totalCount: undefined
      }));
      const hook = await renderTopicController({
        readGateway: {
          getTopic: jest.fn<TestGetTopic>(async () => detail),
          getReplies
        },
        topic
      });

      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([recovered]));
      expect(getReplies).toHaveBeenCalledTimes(1);
      expect(hook.result.current.controller.repliesLoading).toBe(false);
      expect(hook.result.current.controller.replyCollectionComplete).toBe(true);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(getReplies).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps an explicit full refresh on the refreshed V2EX page window', async () => {
    const prefix = [{ ...firstReply, floor: 1, commentId: 101 }];
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 2 };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: prefix,
      replyCompleteness: 'partial',
      replyHasMore: true,
      replyNextPage: null
    };
    const getTopic = jest.fn<TestGetTopic>(async () => detail);
    const getReplies = jest.fn<TestGetReplies>();
    const hook = await renderTopicController({ readGateway: { getTopic, getReplies }, topic });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual(prefix));
    expect(hook.result.current.controller.replyCollectionComplete).toBe(true);
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getReplies).not.toHaveBeenCalled();

    await act(async () => {
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('completed');
    });

    expect(getTopic).toHaveBeenCalledTimes(2);
    expect(getReplies).not.toHaveBeenCalled();
    expect(hook.result.current.controller.topicReplies).toEqual(prefix);
    expect(hook.result.current.controller.replyCollectionComplete).toBe(true);
  });

  it('rejects an unconfirmed tail without applying it and retries the same order', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 45,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 1
    };
    const tail = { ...firstReply, floor: 45, commentId: 145 };
    const getReplies = jest
      .fn<TestGetReplies>()
      .mockResolvedValueOnce({ items: [tail], hasMore: false, nextPage: null })
      .mockResolvedValueOnce({
        items: [tail],
        currentPage: 5,
        currentOffset: 40,
        hasMore: false,
        nextPage: null,
        totalCount: 45
      });
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      }
    });

    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toContain('未确认回复窗口页码'));
    expect(hook.result.current.controller.topicReplies).toEqual([]);

    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('completed');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([45]));
    expect(getReplies.mock.calls.map(([request]) => [request.order, request.position.kind])).toEqual([
      ['newest', 'start'],
      ['newest', 'start']
    ]);
  });

  it('retries a failed reply read without a hidden topic-count refresh', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 45,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const getTopic = jest.fn<TestGetTopic>(async () => detail);
    const getReplies = jest
      .fn<TestGetReplies>()
      .mockRejectedValueOnce(new Error('NodeSeek 回复窗口暂时无法确认'))
      .mockResolvedValue({
        items: [{ ...firstReply, floor: 45, commentId: 145 }],
        currentPage: 5,
        currentOffset: 40,
        hasMore: true,
        nextPage: 4,
        nextOffset: 30,
        totalCount: 45
      });
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toContain('暂时无法确认'));
    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('completed');
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([45]));
    expect(hook.result.current.controller.repliesLoading).toBe(false);
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getReplies).toHaveBeenCalledTimes(2);
    expect(getReplies.mock.calls.map(([request]) => request.replyCount)).toEqual([45, 45]);
  });

  it('isolates cached detail when the credential scope changes', async () => {
    let scope = initialForumSessionEpochs;
    const replacement = Promise.withResolvers<TopicDetail>();
    const getTopic = jest
      .fn<TestGetTopic>()
      .mockResolvedValueOnce(firstDetail)
      .mockImplementationOnce(async () => replacement.promise);
    const hook = await renderTopicController({ getSessionEpochs: () => scope, readGateway: { getTopic } });

    await act(async () => {
      await hook.result.current.controller.openTopic(firstTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(firstDetail));
    await act(async () => {
      hook.result.current.session.commands.composer.changeContent('保留的本地草稿');
      hook.result.current.session.commands.view.changeReplyFilter('author');
      hook.result.current.session.commands.view.rememberScrollY(280);
    });
    scope = { ...scope, nodeseek: 1 };
    await act(async () => {
      await hook.rerender(undefined);
    });

    await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(2));
    expect(hook.result.current.controller.topicDetail).toBeNull();
    expect(hook.result.current.session.state).toMatchObject({
      selectedTopic: firstTopic,
      replyContent: '保留的本地草稿',
      replyFilter: 'author'
    });
    await act(async () => {
      replacement.resolve({ ...firstDetail, title: 'New account' });
      await replacement.promise;
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail?.title).toBe('New account'));
  });

  it('preserves loaded pages and cursor when the next reply page fails', async () => {
    const detail = { ...firstDetail, replyHasMore: true, replyNextPage: 2, replyNextOffset: 1 };
    const getReplies = jest.fn<TestGetReplies>(async () => {
      throw new Error('offline');
    });
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(firstTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.replyHasMore).toBe(true));
    await act(async () => {
      await hook.result.current.controller.loadMoreReplies();
    });

    expect(hook.result.current.controller.topicReplies).toEqual([firstReply]);
    expect(hook.result.current.controller.replyHasMore).toBe(true);
    await waitFor(() => expect(hook.result.current.controller.replyEndError?.message).toBe('offline'));
    expect(hook.result.current.controller.repliesError).toBeNull();
  });

  it.each(['linuxdo', 'yaohuo'] as const)(
    'retries an ordinary %s edge at the same cursor without refreshing the topic count',
    async (source) => {
      const topic: Topic = {
        ...firstTopic,
        source,
        url: source === 'linuxdo' ? 'https://linux.do/t/1' : 'https://www.yaohuo.me/bbs-1.html'
      };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        replyCount: 20,
        replyHasMore: true,
        replyNextPage: 2,
        replyNextOffset: 10
      };
      const nextReply = { ...firstReply, floor: 11, commentId: 111 };
      const getTopic = jest.fn<TestGetTopic>(async () => detail);
      const getReplies = jest
        .fn<TestGetReplies>()
        .mockRejectedValueOnce(new Error('ordinary edge failure'))
        .mockResolvedValueOnce({
          items: [nextReply],
          currentPage: 2,
          currentOffset: 10,
          hasMore: false,
          nextPage: null,
          nextOffset: null
        });
      const hook = await renderTopicController({ readGateway: { getReplies, getTopic }, topic });

      await waitFor(() => expect(hook.result.current.controller.replyHasMore).toBe(true));
      await act(async () => {
        await hook.result.current.controller.loadMoreReplies();
      });
      await waitFor(() => expect(hook.result.current.controller.replyEndError?.message).toBe('ordinary edge failure'));
      await act(async () => {
        await expect(hook.result.current.controller.retryReplies('end')).resolves.toBe('completed');
      });

      expect(getTopic).toHaveBeenCalledTimes(1);
      const expectedPage = source === 'yaohuo' ? 2 : 1;
      expect(getReplies.mock.calls.map(([request]) => [request.position, request.replyCount])).toEqual([
        [{ kind: 'cursor', page: expectedPage, offset: 10 }, 20],
        [{ kind: 'cursor', page: expectedPage, offset: 10 }, 20]
      ]);
      expect(hook.result.current.controller.topicReplies).toEqual([firstReply, nextReply]);
    }
  );

  it.each(['linuxdo', 'yaohuo'] as const)(
    'retries an ordinary %s previous edge at the same cursor without refreshing the topic count',
    async (source) => {
      const topic: Topic = {
        ...firstTopic,
        source,
        url: source === 'linuxdo' ? 'https://linux.do/t/1' : 'https://www.yaohuo.me/bbs-1.html'
      };
      const detail: TopicDetail = { ...firstDetail, ...topic, replies: [], replyCount: 20 };
      const anchor = { ...firstReply, floor: 20, commentId: 120 };
      const previousReply = { ...firstReply, floor: 10, commentId: 110 };
      const getTopic = jest.fn<TestGetTopic>(async () => detail);
      const getReplies = jest
        .fn<TestGetReplies>()
        .mockResolvedValueOnce({
          items: [anchor],
          currentPage: 2,
          currentOffset: 10,
          previousPage: 1,
          previousOffset: 0,
          hasMore: false,
          nextPage: null
        })
        .mockRejectedValueOnce(new Error('ordinary previous edge failure'))
        .mockResolvedValueOnce({
          items: [previousReply],
          currentPage: 1,
          currentOffset: 0,
          hasMore: true,
          nextPage: 2,
          nextOffset: 10
        });
      const hook = await renderTopicController({
        readGateway: { getReplies, getTopic },
        targetReply: { floor: 20 },
        topic
      });

      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([anchor]));
      await act(async () => {
        await hook.result.current.controller.loadPreviousReplies();
      });
      await waitFor(() =>
        expect(hook.result.current.controller.replyStartError?.message).toBe('ordinary previous edge failure')
      );
      await act(async () => {
        await expect(hook.result.current.controller.retryReplies('start')).resolves.toBe('completed');
      });

      expect(getTopic).toHaveBeenCalledTimes(1);
      expect(getReplies.mock.calls.map(([request]) => [request.position, request.replyCount])).toEqual([
        [{ kind: 'target', target: { floor: 20 } }, 20],
        [{ kind: 'cursor', page: 1, offset: 0 }, 20],
        [{ kind: 'cursor', page: 1, offset: 0 }, 20]
      ]);
      expect(hook.result.current.controller.topicReplies).toEqual([previousReply, anchor]);
    }
  );

  it('keeps the NodeSeek total unavailable after loading a terminal adjacent page', async () => {
    const detail: TopicDetail = {
      ...firstDetail,
      replyCount: undefined,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const terminalReplies = [11, 12, 13, 14].map((floor) => ({
      ...firstReply,
      floor,
      commentId: 100 + floor
    }));
    const getReplies = jest.fn<TestGetReplies>(async () => ({
      items: terminalReplies,
      currentPage: 2,
      currentOffset: 10,
      previousPage: 1,
      previousOffset: 0,
      hasMore: false,
      nextPage: null,
      nextOffset: null
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      }
    });

    await waitFor(() => expect(hook.result.current.controller.replyHasMore).toBe(true));
    await act(async () => {
      await hook.result.current.controller.loadMoreReplies({ silent: true });
    });

    await waitFor(() => expect(hook.result.current.controller.topicDetail?.replyCount).toBeUndefined());
    expect(hook.result.current.controller.topicReplies.map((reply) => reply.floor)).toEqual([1, 11, 12, 13, 14]);
  });

  it('does not let opposite pagination replace a pending edge retry', async () => {
    const anchor = { ...firstReply, floor: 20, commentId: 120 };
    const previous = { ...firstReply, floor: 10, commentId: 110 };
    const next = { ...firstReply, floor: 30, commentId: 130 };
    const pendingPrevious = Promise.withResolvers<RepliesResponse>();
    let previousAttempts = 0;
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      if (request.position.kind === 'target') {
        return {
          items: [anchor],
          currentPage: 2,
          currentOffset: 10,
          previousPage: 1,
          previousOffset: 0,
          hasMore: true,
          nextPage: 3,
          nextOffset: 20
        };
      }
      if (request.position.kind === 'cursor' && request.position.page === 1) {
        previousAttempts += 1;
        if (previousAttempts === 1) throw new Error('previous window failed');
        return pendingPrevious.promise;
      }
      return {
        items: [next],
        currentPage: 3,
        currentOffset: 20,
        previousPage: 2,
        previousOffset: 10,
        hasMore: false,
        nextPage: null
      };
    });
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => ({ ...firstDetail, replyCount: 30 })),
        getReplies
      },
      targetReply: { floor: 20 }
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([anchor]));
    await act(async () => {
      await hook.result.current.controller.loadPreviousReplies();
    });
    await waitFor(() => expect(hook.result.current.controller.replyStartError).not.toBeNull());

    let retryPromise!: Promise<LinuxDoReadResumeOutcome>;
    await act(async () => {
      retryPromise = hook.result.current.controller.retryReplies('start');
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(getReplies.mock.calls.flatMap(([request]) => replyRequestPage(request) ?? [])).toEqual([1, 1])
    );
    await act(async () => {
      await hook.result.current.controller.loadMoreReplies();
    });

    expect(getReplies.mock.calls.flatMap(([request]) => replyRequestPage(request) ?? [])).toEqual([1, 1]);
    expect(hook.result.current.controller.replyStartError).not.toBeNull();

    await act(async () => {
      pendingPrevious.resolve({
        items: [previous],
        currentPage: 1,
        currentOffset: 0,
        hasMore: true,
        nextPage: 2,
        nextOffset: 10
      });
      await retryPromise;
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([previous, anchor]));

    await act(async () => {
      await hook.result.current.controller.loadMoreReplies();
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([previous, anchor, next]));
    expect(getReplies.mock.calls.flatMap(([request]) => replyRequestPage(request) ?? [])).toEqual([1, 1, 3]);
  });

  it('anchors a distant reply once and loads only its adjacent windows', async () => {
    const target: Reply = {
      author: 'target',
      floor: 155,
      commentId: 155,
      contentHtml: '<p>target</p>',
      createdAt: '2026-08-05T00:00:00.000Z'
    };
    const previous: Reply = {
      author: 'previous',
      floor: 145,
      commentId: 145,
      contentHtml: '<p>previous</p>',
      createdAt: '2026-08-04T23:00:00.000Z'
    };
    const next: Reply = {
      author: 'next',
      floor: 165,
      commentId: 165,
      contentHtml: '<p>next</p>',
      createdAt: '2026-08-05T01:00:00.000Z'
    };
    const detail: TopicDetail = {
      ...firstDetail,
      replies: [firstReply],
      replyCount: 500,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      const page = replyRequestPage(request);
      if (replyRequestTarget(request)?.floor === 155) {
        return {
          items: [target],
          currentPage: 16,
          currentOffset: 150,
          previousPage: 15,
          previousOffset: 140,
          hasMore: true,
          nextPage: 17,
          nextOffset: 160
        };
      }
      if (page === 15) {
        return {
          items: [previous],
          currentPage: 15,
          currentOffset: 140,
          previousPage: 16,
          previousOffset: 150,
          hasMore: true,
          nextPage: 16,
          nextOffset: 150
        };
      }
      if (page === 17) {
        return {
          items: [next],
          currentPage: 17,
          currentOffset: 160,
          previousPage: 16,
          previousOffset: 150,
          hasMore: true,
          nextPage: 16,
          nextOffset: 150
        };
      }
      if (page === 16) {
        return {
          items: [target],
          currentPage: 16,
          currentOffset: 150,
          previousPage: 15,
          previousOffset: 140,
          hasMore: true,
          nextPage: 17,
          nextOffset: 160
        };
      }
      throw new Error(`unexpected page ${page}`);
    });
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      },
      targetReply: { floor: 155 }
    });

    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    await act(async () => {
      await hook.result.current.controller.locateReply({ floor: 155 });
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));

    await act(async () => {
      await hook.result.current.controller.loadPreviousReplies({ silent: true });
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([previous, target]));

    await act(async () => {
      await hook.result.current.controller.loadMoreReplies({ silent: true });
    });

    expect(
      getReplies.mock.calls.map(([request]) => replyRequestTarget(request)?.floor ?? replyRequestPage(request))
    ).toEqual([155, 15, 17]);
    expect(getReplies.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        limit: 30,
        order: 'oldest',
        position: { kind: 'target', target: { floor: 155 } }
      })
    );
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([previous, target, next]));
    expect(hook.result.current.controller.replyHasPrevious).toBe(false);
    expect(hook.result.current.controller.replyHasMore).toBe(false);

    await act(async () => {
      await hook.result.current.controller.loadPreviousReplies({ silent: true });
      await hook.result.current.controller.loadMoreReplies({ silent: true });
    });
    expect(
      getReplies.mock.calls.map(([request]) => replyRequestTarget(request)?.floor ?? replyRequestPage(request))
    ).toEqual([155, 15, 17]);

    await act(async () => {
      await expect(
        hook.result.current.controller.refreshTopicReplies({
          kind: 'edited',
          silent: true,
          target: { kind: 'comment-id', commentId: 155 },
          contentMarkdown: 'edited'
        })
      ).resolves.toBe('completed');
    });

    expect(getReplies.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({
        order: 'oldest',
        position: { kind: 'cursor', page: 16, offset: 150 },
        source: 'nodeseek'
      })
    );

    await act(async () => {
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('completed');
      await Promise.resolve();
    });
    expect(getReplies.mock.calls.filter(([request]) => replyRequestTarget(request)?.floor === 155)).toHaveLength(1);
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
  });

  it('keeps a later target authoritative over an earlier whole-topic refresh', async () => {
    const target = { ...firstReply, floor: 50, commentId: 150, author: 'target' };
    const refreshed = { ...firstReply, floor: 1, commentId: 11, author: 'refreshed' };
    const detail: TopicDetail = {
      ...firstDetail,
      replyCount: 50,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const refreshedDetail: TopicDetail = {
      ...detail,
      replies: [refreshed],
      replyCount: 1,
      replyHasMore: false,
      replyNextPage: null,
      replyNextOffset: null
    };
    const pendingDetail = Promise.withResolvers<TopicDetail>();
    const getTopic = jest
      .fn<TestGetTopic>()
      .mockResolvedValueOnce(detail)
      .mockImplementationOnce(async () => pendingDetail.promise);
    const getReplies = jest.fn<TestGetReplies>(async () => ({
      items: [target],
      currentPage: 5,
      currentOffset: 40,
      previousPage: 4,
      previousOffset: 30,
      hasMore: false,
      nextPage: null,
      nextOffset: null
    }));
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
    let refreshRequest!: Promise<LinuxDoReadResumeOutcome>;
    await act(async () => {
      refreshRequest = hook.result.current.controller.refreshWholeTopic();
      await Promise.resolve();
    });
    await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(2));
    await act(async () => {
      await expect(hook.result.current.controller.locateReply({ floor: 50 }, { silent: true })).resolves.toBe(
        'completed'
      );
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));

    await act(async () => {
      pendingDetail.resolve(refreshedDetail);
      await refreshRequest;
    });

    expect(await refreshRequest).toBe('stale');
    expect(hook.result.current.controller.topicReplies).toEqual([target]);
  });

  it('does not apply or locate an old-order write tail after the order changes', async () => {
    const oldest = { ...firstReply, floor: 2, commentId: 12, author: 'oldest-preserved' };
    const newest = { ...firstReply, floor: 20, commentId: 120, author: 'newest-preserved' };
    const submitted = { ...firstReply, floor: 21, commentId: 121, author: 'submitted' };
    const detail: TopicDetail = {
      ...firstDetail,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const pendingTail = Promise.withResolvers<RepliesResponse>();
    const getTopic = jest
      .fn<TestGetTopic>()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({ ...detail, replyCount: 21 });
    const getReplies = jest.fn<TestGetReplies>(async (request) =>
      request.replyCount === 21
        ? pendingTail.promise
        : {
            items: [newest],
            currentPage: 2,
            currentOffset: 10,
            hasMore: true,
            nextPage: 1,
            nextOffset: 0,
            totalCount: 20
          }
    );
    const onReplyLocationResolved = jest.fn();
    const hook = await renderTopicController({ onReplyLocationResolved, readGateway: { getReplies, getTopic } });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    const oldestKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'oldest', 'authenticated:0');
    appQueryClient.setQueryData(oldestKey, {
      pages: [{ items: [oldest], currentPage: 1, currentOffset: 0, hasMore: false, nextPage: null }],
      pageParams: [{ kind: 'start' }]
    });
    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([newest]));
    let refresh!: Promise<LinuxDoReadResumeOutcome>;
    await act(async () => {
      refresh = hook.result.current.controller.refreshTopicReplies({ kind: 'created', silent: true });
      await Promise.resolve();
    });
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(2));
    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('oldest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([oldest]));
    await act(async () => {
      pendingTail.resolve({
        items: [submitted],
        currentPage: 3,
        currentOffset: 20,
        previousPage: null,
        previousOffset: null,
        hasMore: true,
        nextPage: 2,
        nextOffset: 10,
        totalCount: 21
      });
      await refresh;
    });

    expect(await refresh).toBe('stale');
    expect(hook.result.current.controller.topicReplies).toEqual([oldest]);
    expect(onReplyLocationResolved).not.toHaveBeenCalled();
  });

  it('passes a comment-only notification target through the shared reply gateway', async () => {
    const target = { ...firstReply, floor: 25, commentId: 31 };
    const detail = { ...firstDetail, replies: [firstReply], replyCount: 30 };
    const getReplies = jest.fn<TestGetReplies>(async () => ({
      items: [target],
      currentPage: 3,
      currentOffset: 20,
      previousPage: 2,
      previousOffset: 10,
      hasMore: false,
      nextPage: null,
      nextOffset: null
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      },
      targetReply: { commentId: 31 }
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));
    await waitFor(() => expect(hook.result.current.controller.loadingMoreReplies).toBe(false));
    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nodeseek',
        id: '1',
        order: 'oldest',
        position: { kind: 'target', target: { commentId: 31 } },
        replyCount: 30
      }),
      expect.any(Object)
    );
  });

  it('displays an adapter-confirmed target window', async () => {
    const topic: Topic = {
      ...firstTopic,
      source: 'yaohuo',
      url: 'https://www.yaohuo.me/bbs-1.html'
    };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: [firstReply],
      replyCompleteness: 'partial'
    };
    const sourceOwnedTarget: Reply = {
      author: 'source-owned-target',
      contentHtml: '<p>adapter confirmed this row</p>',
      createdAt: '2026-08-10T00:00:00.000Z'
    };
    const getReplies = jest.fn<TestGetReplies>(async () => ({
      items: [sourceOwnedTarget],
      completeness: 'partial',
      currentPage: 16,
      currentOffset: 150,
      previousPage: 15,
      previousOffset: 140,
      hasMore: true,
      nextPage: 17,
      nextOffset: 160
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      },
      topic
    });

    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    await act(async () => {
      await expect(hook.result.current.controller.locateReply({ floor: 90 }, { silent: true })).resolves.toBe(
        'completed'
      );
    });

    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({ position: { kind: 'target', target: { floor: 90 } } }),
      expect.any(Object)
    );
    expect(hook.result.current.controller.topicReplies).toEqual([sourceOwnedTarget]);
  });

  it('reuses a loaded V2EX target and queries an unloaded target window', async () => {
    const reply = { ...firstReply, floor: 12, commentId: 120 };
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1' };
    const detail = {
      ...firstDetail,
      ...topic,
      replies: [reply],
      replyCompleteness: 'complete' as const,
      replyCount: 1,
      replyHasMore: false
    };
    const getReplies = jest.fn<TestGetReplies>(async () => {
      throw new Error('V2EX 目标楼层未找到');
    });
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      },
      targetReply: { floor: 12 },
      topic
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([reply]));
    await expect(hook.result.current.controller.locateReply({ floor: 12 })).resolves.toBe('completed');
    await expect(hook.result.current.controller.locateReply({ floor: 99 }, { silent: true })).resolves.toBe('failed');
    expect(getReplies).toHaveBeenCalledTimes(1);
    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({ position: { kind: 'target', target: { floor: 99 } } }),
      expect.anything()
    );
  });

  it('reads a V2EX route target once without a duplicate start read', async () => {
    const prefixReply = { ...firstReply, floor: 1, commentId: 101 };
    const target = { ...firstReply, floor: 2, commentId: 102 };
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 2 };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: [prefixReply],
      replyCompleteness: 'complete',
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: null
    };
    const pendingReplies = Promise.withResolvers<RepliesResponse>();
    const getReplies = jest.fn<TestGetReplies>(() => pendingReplies.promise);
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      },
      targetReply: { floor: 2 },
      topic
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([prefixReply]));
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({ position: { kind: 'target', target: { floor: 2 } } }),
      expect.anything()
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getReplies).toHaveBeenCalledTimes(1);
    await act(async () => {
      pendingReplies.resolve({
        items: [target],
        completeness: 'complete',
        currentPage: 2,
        currentOffset: null,
        previousPage: 1,
        previousOffset: null,
        hasMore: false,
        nextPage: null,
        nextOffset: null,
        totalCount: 2
      });
      await pendingReplies.promise;
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));
    await waitFor(() => expect(hook.result.current.controller.replyCollectionComplete).toBe(true));
    expect(getReplies).toHaveBeenCalledTimes(1);
  });

  it('preserves the current window when a source cannot confirm the target floor', async () => {
    const getReplies = jest.fn<TestGetReplies>(async () => {
      throw new Error('来源未确认目标楼层');
    });
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => firstDetail),
        getReplies
      }
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
    await act(async () => {
      await expect(hook.result.current.controller.locateReply({ floor: 99 }, { silent: true })).resolves.toBe('failed');
    });
    expect(hook.result.current.controller.topicReplies).toEqual([firstReply]);
  });

  it('retries an unloaded route target when a new request command arrives', async () => {
    let requestId = 1;
    const getReplies = jest.fn<TestGetReplies>(async () => {
      throw new Error('来源未确认目标楼层');
    });
    const hook = await renderTopicController({
      getTargetReplyRequestId: () => requestId,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => firstDetail),
        getReplies
      },
      targetReply: { floor: 99 }
    });

    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    requestId = 2;
    await act(async () => hook.rerender(undefined));
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(2));
    expect(getReplies.mock.calls.map(([request]) => request.position)).toEqual([
      { kind: 'target', target: { floor: 99 } },
      { kind: 'target', target: { floor: 99 } }
    ]);
  });

  it('requires a matching comment id when the target supplies one', async () => {
    const decoy = { ...firstReply, floor: 99, commentId: 998 };
    const detail = { ...firstDetail, replies: [decoy] };
    const getReplies = jest.fn<TestGetReplies>(async () => {
      throw new Error('来源未确认目标评论');
    });
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      },
      targetReply: { floor: 99, commentId: 999 }
    });

    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    await act(async () => Promise.resolve());
    expect(hook.result.current.controller.topicReplies).toEqual([decoy]);
  });

  it('retries the exact NodeSeek target after verification', async () => {
    const target = { ...firstReply, floor: 90, commentId: 900 };
    const verificationError = Object.assign(new Error('NodeSeek 需要验证'), {
      source: 'nodeseek' as const,
      reason: 'cloudflare'
    });
    const getReplies = jest
      .fn<TestGetReplies>()
      .mockRejectedValueOnce(verificationError)
      .mockResolvedValueOnce({
        items: [target],
        currentPage: 9,
        currentOffset: 80,
        hasMore: false,
        nextPage: null
      });
    const onNodeSeekTopicVerificationRequired = jest.fn<(message: string, recovery: LinuxDoReadRecovery) => void>();
    const hook = await renderTopicController({
      onNodeSeekTopicVerificationRequired,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => firstDetail),
        getReplies
      },
      targetReply: { floor: 90, commentId: 900 }
    });

    await waitFor(() => expect(onNodeSeekTopicVerificationRequired).toHaveBeenCalledTimes(1));
    const recovery = onNodeSeekTopicVerificationRequired.mock.calls[0]?.[1];
    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('completed');
    });

    expect(getReplies.mock.calls.map(([request]) => replyRequestTarget(request)?.floor)).toEqual([90, 90]);
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));
  });

  it('retries a route target after its source session epoch advances', async () => {
    const topic = {
      ...firstTopic,
      source: 'yaohuo' as const,
      url: 'https://www.yaohuo.me/bbs/book_view.aspx?id=1'
    };
    const detail = { ...firstDetail, ...topic };
    const target = { ...firstReply, floor: 90, commentId: 900 };
    const loginError = Object.assign(new Error('妖火登录已失效'), {
      source: 'yaohuo' as const,
      loginRequired: true
    });
    const getReplies = jest
      .fn<TestGetReplies>()
      .mockRejectedValueOnce(loginError)
      .mockResolvedValueOnce({
        items: [target],
        currentPage: 16,
        currentOffset: null,
        hasMore: false,
        nextPage: null
      });
    let sessionEpochs = initialForumSessionEpochs;
    const hook = await renderTopicController({
      getSessionEpochs: () => sessionEpochs,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => detail),
        getReplies
      },
      targetReply: { floor: 90, commentId: 900 },
      topic
    });

    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    sessionEpochs = { ...sessionEpochs, yaohuo: sessionEpochs.yaohuo + 1 };
    await act(async () => hook.rerender(undefined));

    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));
  });

  it('resets stale reply pages and cursors after a whole-topic refresh', async () => {
    const oldSecondReply: Reply = {
      author: 'carol',
      floor: 2,
      commentId: 11,
      contentHtml: '<p>old second</p>',
      createdAt: '2026-07-20T00:02:00.000Z'
    };
    const refreshedFirstReply: Reply = {
      author: 'bob',
      floor: 1,
      commentId: 20,
      contentHtml: '<p>refreshed first</p>',
      createdAt: '2026-07-20T01:01:00.000Z'
    };
    const refreshedSecondReply: Reply = {
      author: 'dave',
      floor: 2,
      commentId: 21,
      contentHtml: '<p>refreshed second</p>',
      createdAt: '2026-07-20T01:02:00.000Z'
    };
    const initialDetail = {
      ...firstDetail,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 1
    };
    const refreshedDetail = {
      ...firstDetail,
      replies: [refreshedFirstReply],
      replyHasMore: true,
      replyNextPage: 5,
      replyNextOffset: 1
    };
    const getTopic = jest
      .fn<TestGetTopic>()
      .mockResolvedValueOnce(initialDetail)
      .mockResolvedValueOnce(refreshedDetail);
    const getReplies = jest.fn<TestGetReplies>(async (request) =>
      replyRequestPage(request) === 2
        ? {
            items: [oldSecondReply],
            currentPage: 2,
            currentOffset: 1,
            hasMore: false,
            nextPage: null,
            nextOffset: null
          }
        : {
            items: [refreshedSecondReply],
            currentPage: 5,
            currentOffset: 1,
            hasMore: false,
            nextPage: null,
            nextOffset: null
          }
    );
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });

    await act(async () => {
      await hook.result.current.controller.openTopic(firstTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.replyHasMore).toBe(true));
    await act(async () => {
      await hook.result.current.controller.loadMoreReplies();
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply, oldSecondReply]));

    await act(async () => {
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('completed');
    });
    await waitFor(() => {
      expect(hook.result.current.controller.topicReplies).toEqual([refreshedFirstReply]);
      expect(hook.result.current.controller.replyHasMore).toBe(true);
    });

    await act(async () => {
      await hook.result.current.controller.loadMoreReplies();
    });
    expect(getReplies.mock.calls.map(([request]) => replyRequestPage(request))).toEqual([2, 5]);
    await waitFor(() =>
      expect(hook.result.current.controller.topicReplies).toEqual([refreshedFirstReply, refreshedSecondReply])
    );
  });

  it('retries the exact failed reply page after linux.do verification', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = {
      ...firstDetail,
      ...linuxTopic,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 1
    };
    const secondReply: Reply = {
      author: 'carol',
      floor: 2,
      commentId: 11,
      contentHtml: '<p>second</p>',
      createdAt: '2026-07-20T00:02:00.000Z'
    };
    const getReplies = jest
      .fn<TestGetReplies>()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockResolvedValueOnce({
        items: [secondReply],
        currentPage: 1,
        currentOffset: 1,
        hasMore: false,
        nextPage: null,
        nextOffset: null
      });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderTopicController({
      showLinuxDoVerification,
      topic: linuxTopic,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => linuxDetail),
        getReplies
      }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.replyHasMore).toBe(true));
    await act(async () => {
      await expect(hook.result.current.controller.loadMoreReplies()).resolves.toBe('verification-required');
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('completed');
    });

    expect(getReplies.mock.calls.map(([request]) => replyRequestPage(request))).toEqual([1, 1]);
    await waitFor(() => {
      expect(hook.result.current.controller.topicReplies).toEqual([firstReply, secondReply]);
      expect(hook.result.current.controller.replyHasMore).toBe(false);
    });
  });

  it('discovers the real tail before reanchoring oldest order', async () => {
    const discourseTopic = {
      ...firstTopic,
      source: 'linuxdo' as const,
      url: 'https://linux.do/t/first/1'
    };
    const initialReplies = Array.from({ length: 10 }, (_, index): Reply => ({
      author: `user-${index + 1}`,
      floor: index + 1,
      commentId: 100 + index,
      contentHtml: `<p>${index + 1}</p>`,
      createdAt: `2026-07-20T00:${String(index + 1).padStart(2, '0')}:00.000Z`
    }));
    const detail = {
      ...firstDetail,
      ...discourseTopic,
      replies: initialReplies,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const submittedReply: Reply = {
      author: 'alice',
      floor: 29,
      commentId: 129,
      contentHtml: '<p>new reply</p>',
      createdAt: '2026-07-20T00:21:00.000Z'
    };
    const refreshedDetail = { ...detail, replyCount: 21 };
    const onReplyLocationResolved = jest.fn();
    const getReplies = jest.fn<TestGetReplies>(async (request) => ({
      items: [submittedReply],
      completeness: 'complete',
      currentPage: 3,
      currentOffset: 20,
      previousPage: request.order === 'newest' ? null : 2,
      previousOffset: request.order === 'newest' ? null : 10,
      hasMore: request.order === 'newest',
      nextPage: request.order === 'newest' ? 2 : null,
      nextOffset: request.order === 'newest' ? 10 : null,
      totalCount: 21
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<TestGetTopic>().mockResolvedValueOnce(detail).mockResolvedValue(refreshedDetail),
        getReplies
      },
      onReplyLocationResolved,
      topic: discourseTopic
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(discourseTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(10));
    const newestKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'newest', 'authenticated:0');
    appQueryClient.setQueryData(newestKey, { pages: [], pageParams: [] });
    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies({ kind: 'created' })).resolves.toBe('completed');
    });

    expect(getReplies.mock.calls.map(([request]) => [request.order, request.position, request.replyCount])).toEqual([
      ['newest', { kind: 'start' }, 21],
      ['oldest', { kind: 'target', target: { commentId: 129, floor: 29, pageHint: 3 } }, 21]
    ]);
    await waitFor(() => {
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([29]);
      expect(hook.result.current.controller.topicDetail?.replyCount).toBe(21);
      expect(hook.result.current.controller.replyRowsPartial).toBe(false);
    });
    expect(onReplyLocationResolved).toHaveBeenCalledTimes(1);
    expect(onReplyLocationResolved).toHaveBeenCalledWith({ commentId: 129, floor: 29, pageHint: 3 });
    expect(appQueryClient.getQueryData(newestKey)).toBeDefined();
    expect(appQueryClient.getQueryState(newestKey)?.isInvalidated).toBe(true);
    const repliesQueryKey = forumQueryKeys.replies(
      hook.result.current.controller.topicQueryKey,
      'oldest',
      'authenticated:0'
    );
    expect(appQueryClient.getQueryData(repliesQueryKey)).toBeDefined();

    hook.unmount();
    await waitFor(() => expect(appQueryClient.getQueryData(repliesQueryKey)).toBeUndefined());
  });

  it('rebuilds and locates the confirmed newest tail after a reply submit', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 1
    };
    const refreshedDetail = { ...detail, replyCount: 21 };
    const getTopic = jest.fn<TestGetTopic>().mockResolvedValueOnce(detail).mockResolvedValue(refreshedDetail);
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      const latestFloor = request.replyCount === 21 ? 21 : 20;
      return {
        items: [{ ...firstReply, floor: latestFloor, commentId: 100 + latestFloor }],
        currentPage: latestFloor === 21 ? 3 : 2,
        currentOffset: latestFloor === 21 ? 20 : 10,
        hasMore: true,
        nextPage: latestFloor === 21 ? 2 : 1,
        nextOffset: latestFloor === 21 ? 10 : 0,
        totalCount: latestFloor
      };
    });
    const onReplyLocationResolved = jest.fn();
    const hook = await renderTopicController({ onReplyLocationResolved, readGateway: { getReplies, getTopic } });

    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([20]));

    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies({ kind: 'created' })).resolves.toBe('completed');
    });

    expect(getReplies.mock.calls.map(([request]) => [request.order, request.position, request.replyCount])).toEqual([
      ['newest', { kind: 'start' }, 20],
      ['newest', { kind: 'start' }, 21]
    ]);
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([21]));
    expect(onReplyLocationResolved).toHaveBeenCalledTimes(1);
    expect(onReplyLocationResolved).toHaveBeenCalledWith({ commentId: 121, floor: 21, pageHint: 3 });
  });

  it('reanchors after deleting the only reply in the current tail window', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: [],
      replyCount: 31,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const getTopic = jest
      .fn<TestGetTopic>()
      .mockResolvedValueOnce(detail)
      .mockResolvedValue({ ...detail, replyCount: 30 });
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      if (request.position.kind === 'cursor') throw new Error('Discourse 回复游标已失效');
      const floor = request.replyCount === 31 ? 31 : 30;
      return {
        items: [{ ...firstReply, floor, commentId: 100 + floor }],
        currentPage: floor === 31 ? 2 : 1,
        currentOffset: floor === 31 ? 30 : 0,
        hasMore: floor === 31,
        nextPage: floor === 31 ? 1 : null,
        nextOffset: floor === 31 ? 0 : null,
        totalCount: floor
      };
    });
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic }, topic });

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([31]));
    await act(async () => {
      await expect(
        hook.result.current.controller.refreshTopicReplies({
          kind: 'deleted',
          silent: true,
          target: { kind: 'comment-id', commentId: 131 },
          position: { kind: 'cursor', page: 2, offset: 30 }
        })
      ).resolves.toBe('completed');
    });

    expect(getTopic).toHaveBeenCalledTimes(2);
    expect(getReplies.mock.calls.map(([request]) => [request.position, request.replyCount])).toEqual([
      [{ kind: 'start' }, 31],
      [{ kind: 'start' }, 30]
    ]);
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([30]));
  });

  it('keeps a failed write refresh visible and retries its exact tail window', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const refreshedDetail = { ...detail, replyCount: 21 };
    const getTopic = jest.fn<TestGetTopic>().mockResolvedValueOnce(detail).mockResolvedValue(refreshedDetail);
    let attempts = 0;
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      attempts += 1;
      const latestFloor = request.replyCount === 21 ? 21 : 20;
      return {
        items: [{ ...firstReply, floor: latestFloor, commentId: 100 + latestFloor }],
        ...(attempts === 2 ? {} : { currentPage: latestFloor === 21 ? 3 : 2 }),
        currentOffset: latestFloor === 21 ? 20 : 10,
        hasMore: true,
        nextPage: latestFloor === 21 ? 2 : 1,
        nextOffset: latestFloor === 21 ? 10 : 0,
        totalCount: latestFloor
      };
    });
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([20]));
    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies({ kind: 'created', silent: true })).resolves.toBe(
        'failed'
      );
    });

    expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([20]);
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toContain('未确认回复窗口页码'));
    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('completed');
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([21]));
    expect(hook.result.current.controller.repliesError).toBeNull();
    expect(getReplies.mock.calls.map(([request]) => request.replyCount)).toEqual([20, 21, 21]);
  });

  it('retries the complete write refresh after the authoritative count read fails', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const refreshedDetail = { ...detail, replyCount: 21 };
    const getTopic = jest
      .fn<TestGetTopic>()
      .mockResolvedValueOnce(detail)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(refreshedDetail);
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      const floor = request.replyCount || 0;
      return {
        items: [{ ...firstReply, floor, commentId: 100 + floor }],
        currentPage: floor === 21 ? 3 : 2,
        currentOffset: floor === 21 ? 20 : 10,
        hasMore: true,
        nextPage: floor === 21 ? 2 : 1,
        nextOffset: floor === 21 ? 10 : 0,
        totalCount: floor
      };
    });
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([20]));
    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies({ kind: 'created', silent: true })).resolves.toBe(
        'failed'
      );
    });

    expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([20]);
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toBe('offline'));
    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('completed');
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([21]));
    expect(getTopic).toHaveBeenCalledTimes(3);
    expect(getReplies.mock.calls.map(([request]) => request.replyCount)).toEqual([20, 21]);
  });

  it('retries a failed whole-topic rebuild from a fresh authoritative start', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const getTopic = jest
      .fn<TestGetTopic>()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({ ...detail, replyCount: 21 })
      .mockResolvedValueOnce({ ...detail, replyCount: 22 });
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      if (request.position.kind === 'target') {
        return {
          items: [{ ...firstReply, floor: 50, commentId: 150 }],
          currentPage: 5,
          currentOffset: 40,
          previousPage: 4,
          previousOffset: 30,
          hasMore: false,
          nextPage: null,
          totalCount: 50
        };
      }
      if (request.replyCount === 21) throw new Error('offline');
      const floor = request.replyCount || 0;
      return {
        items: [{ ...firstReply, floor, commentId: 100 + floor }],
        currentPage: floor === 22 ? 3 : 2,
        currentOffset: floor === 22 ? 20 : 10,
        hasMore: true,
        nextPage: floor === 22 ? 2 : 1,
        nextOffset: floor === 22 ? 10 : 0,
        totalCount: floor
      };
    });
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([20]));
    await act(async () => {
      await expect(hook.result.current.controller.locateReply({ floor: 50 }, { silent: true })).resolves.toBe(
        'completed'
      );
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('failed');
    });

    expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([50]);
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toBe('offline'));
    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('completed');
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([22]));
    expect(getTopic).toHaveBeenCalledTimes(3);
    expect(
      getReplies.mock.calls.map(([request]) =>
        request.position.kind === 'target'
          ? `target:${request.position.target.floor}`
          : `${request.position.kind}:${request.replyCount}`
      )
    ).toEqual(['start:20', 'target:50', 'start:21', 'start:22']);
  });

  it('records a failed V2EX comments refresh as failure and keeps the trusted detail', async () => {
    const v2exTopic = {
      ...firstTopic,
      source: 'v2ex' as const,
      url: 'https://www.v2ex.com/t/1'
    };
    const v2exDetail = {
      ...firstDetail,
      ...v2exTopic,
      replyCount: 1,
      replyCompleteness: 'complete' as const,
      replyHasMore: false,
      replyNextPage: null,
      replyNextOffset: null
    };
    const getTopic = jest.fn<TestGetTopic>(async () => v2exDetail);
    const getReplies = jest.fn<TestGetReplies>(async () => {
      throw new Error('V2EX refresh failed');
    });
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const hook = await renderTopicController({ readGateway: { getTopic, getReplies }, topic: v2exTopic });

    await act(async () => {
      await hook.result.current.controller.openTopic(v2exTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(v2exDetail));
    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies()).resolves.toBe('failed');
    });

    expect(hook.result.current.controller.topicDetail).toEqual(v2exDetail);
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getReplies).toHaveBeenCalledTimes(1);
    expect(lines.map((line) => JSON.parse(line) as DiagnosticEvent)).toContainEqual(
      expect.objectContaining({ area: 'reply', operation: 'refresh', phase: 'finish', outcome: 'failure' })
    );
  });

  it('offers an exact Linux recovery and refetches only that detail query', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    let attempts = 0;
    const getTopic = jest.fn<TestGetTopic>(async () => {
      attempts += 1;
      if (attempts === 1) throw new LinuxDoCloudflareError();
      return linuxDetail;
    });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderTopicController({ readGateway: { getTopic }, showLinuxDoVerification, topic: linuxTopic });

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxTopic);
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery?.queryKey).toEqual([
      'forum',
      'linuxdo',
      'topic',
      { readPlanScope: 'authenticated:0', sessionEpoch: 0, topicId: '1' }
    ]);
    await act(async () => {
      await recovery?.resume();
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(linuxDetail));
    expect(getTopic).toHaveBeenCalledTimes(2);
  });

  it('keeps a loaded quoted post stable across an unrelated rerender', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const quoted: Reply = { author: 'carol', floor: 2, contentHtml: '<p>quoted</p>', createdAt: '' };
    const getReply = jest.fn<TestGetReply>(async () => quoted);
    const hook = await renderTopicController({
      topic: linuxTopic,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => linuxDetail),
        getReply
      }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(linuxDetail));
    await act(async () => {
      await hook.result.current.controller.toggleTopicBodyQuote({
        instanceKey: 'topic:1:linuxdo:1:2',
        reference: { source: 'linuxdo', topicId: '1', postNumber: 2 }
      });
    });
    await waitFor(() => expect(hook.result.current.controller.loadedQuotedReplies['linuxdo:1:2']).toEqual(quoted));
    const loadedQuotedReplies = hook.result.current.controller.loadedQuotedReplies;
    const loadingQuotedFloors = hook.result.current.controller.loadingQuotedFloors;

    await act(async () => hook.rerender(undefined));

    expect(hook.result.current.controller.loadedQuotedReplies).toBe(loadedQuotedReplies);
    expect(hook.result.current.controller.loadingQuotedFloors).toBe(loadingQuotedFloors);
    expect(getReply).toHaveBeenCalledTimes(1);
  });

  it('prefetches an accepted answer without expanding a quote or notifying', async () => {
    const solvedTopic: Topic = {
      ...firstTopic,
      source: 'linuxdo',
      id: '206',
      url: 'https://linux.do/t/topic/206'
    };
    const solvedDetail: TopicDetail = {
      ...firstDetail,
      ...solvedTopic,
      acceptedAnswerFloor: 9,
      replies: [],
      solved: true
    };
    const acceptedReply: Reply = {
      acceptedAnswer: true,
      author: 'bob',
      commentId: 99,
      contentHtml: '<p>解决方案</p>',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 9
    };
    const notify = jest.fn();
    const getReply = jest.fn<TestGetReply>(async () => acceptedReply);
    const hook = await renderTopicController({
      notify,
      topic: solvedTopic,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => solvedDetail),
        getReplies: jest.fn<TestGetReplies>(async () => ({
          items: [],
          completeness: 'partial',
          currentPage: 1,
          hasMore: false,
          nextPage: null
        })),
        getReply
      }
    });
    const instanceKey = 'accepted-answer:linuxdo:206:9';

    await act(async () => {
      await hook.result.current.controller.openTopic(solvedTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(solvedDetail));
    notify.mockClear();
    await act(async () => {
      await hook.result.current.controller.toggleTopicBodyQuote({
        instanceKey,
        prefetch: true,
        reference: { source: 'linuxdo', topicId: '206', postNumber: 9 }
      });
    });

    await waitFor(() =>
      expect(hook.result.current.controller.loadedQuotedReplies['linuxdo:206:9']).toEqual(acceptedReply)
    );
    expect(getReply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.session.state.expandedQuotes[instanceKey]).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps a failed accepted-answer prefetch silent', async () => {
    const solvedTopic: Topic = {
      ...firstTopic,
      source: 'linuxdo',
      id: '207',
      url: 'https://linux.do/t/topic/207'
    };
    const solvedDetail: TopicDetail = {
      ...firstDetail,
      ...solvedTopic,
      replies: [],
      replyCompleteness: 'complete',
      replyCount: 0,
      replyHasMore: false,
      solved: true
    };
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const getReply = jest.fn<TestGetReply>(async () => {
      throw new LinuxDoCloudflareError();
    });
    const hook = await renderTopicController({
      notify,
      showLinuxDoVerification,
      topic: solvedTopic,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => solvedDetail),
        getReply
      }
    });
    const instanceKey = 'accepted-answer:linuxdo:207:9';

    await act(async () => {
      await hook.result.current.controller.openTopic(solvedTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(solvedDetail));
    notify.mockClear();
    await act(async () => {
      await hook.result.current.controller.toggleTopicBodyQuote({
        instanceKey,
        prefetch: true,
        reference: { source: 'linuxdo', topicId: '207', postNumber: 9 }
      });
    });
    await waitFor(() => expect(getReply).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    expect(hook.result.current.session.state.expandedQuotes[instanceKey]).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
    expect(showLinuxDoVerification).not.toHaveBeenCalled();
  });

  it.each([
    ['without a local post', false, 2],
    ['with a paged local post', true, 1]
  ] as [string, boolean, number][])(
    'recovers a failed prefetch interactively %s',
    async (_case, withLocalPost, expectedCalls) => {
      const solvedTopic: Topic = {
        ...firstTopic,
        source: 'linuxdo',
        id: '208',
        url: 'https://linux.do/t/topic/208'
      };
      const solvedDetail: TopicDetail = {
        ...firstDetail,
        ...solvedTopic,
        replies: [],
        replyCompleteness: 'complete',
        replyCount: 0,
        replyHasMore: false,
        solved: true
      };
      const acceptedReply: Reply = {
        acceptedAnswer: true,
        author: 'bob',
        commentId: 100,
        contentHtml: '<p>恢复后的解决方案</p>',
        createdAt: '2026-07-20T00:01:00.000Z',
        floor: 9
      };
      const notify = jest.fn();
      let replyAttempt = 0;
      const getReply = jest.fn<TestGetReply>(async () => {
        replyAttempt += 1;
        if (replyAttempt === 1) {
          throw new Error('prefetch failed');
        }
        return prepareReplyContent(acceptedReply, 'linuxdo', 'quoted-reply');
      });
      const hook = await renderTopicController({
        notify,
        topic: solvedTopic,
        readGateway: {
          getTopic: jest.fn<TestGetTopic>(async () => solvedDetail),
          getReply
        }
      });
      const reference = { source: 'linuxdo' as const, topicId: '208', postNumber: 9 };
      const acceptedInstanceKey = 'accepted-answer:linuxdo:208:9';
      const quoteInstanceKey = 'topic:208:linuxdo:208:9';

      await act(async () => {
        await hook.result.current.controller.openTopic(solvedTopic);
      });
      await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(solvedDetail));
      notify.mockClear();
      await act(async () => {
        await hook.result.current.controller.toggleTopicBodyQuote({
          instanceKey: acceptedInstanceKey,
          prefetch: true,
          reference
        });
      });
      await waitFor(() => expect(getReply).toHaveBeenCalledTimes(1));

      await act(async () => {
        await hook.result.current.controller.toggleTopicBodyQuote({
          instanceKey: quoteInstanceKey,
          quotedPost: withLocalPost ? acceptedReply : undefined,
          reference
        });
      });

      await waitFor(() =>
        expect(hook.result.current.controller.loadedQuotedReplies['linuxdo:208:9']).toMatchObject({
          ...acceptedReply,
          preparedContent: { contentHtml: acceptedReply.contentHtml }
        })
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(getReply).toHaveBeenCalledTimes(expectedCalls);
      expect(hook.result.current.session.state.expandedQuotes[quoteInstanceKey]).toBe(true);
      expect(notify).not.toHaveBeenCalled();
    }
  );

  it('cancels only the active Topic detail, replies, and quote queries when leaving the route', async () => {
    let active = true;
    let detailSignal: AbortSignal | undefined;
    let repliesSignal: AbortSignal | undefined;
    let quoteSignal: AbortSignal | undefined;
    let unrelatedSignal: AbortSignal | undefined;
    const getTopic = jest
      .fn<TestGetTopic>()
      .mockResolvedValueOnce(firstDetail)
      .mockImplementationOnce(
        async ({ signal }) =>
          new Promise<TopicDetail>((_resolve, reject) => {
            detailSignal = signal;
            signal?.addEventListener('abort', () => reject(new Error('detail canceled')), { once: true });
          })
      );
    const getReplies = jest.fn<TestGetReplies>(
      async ({ signal }) =>
        new Promise((_resolve, reject) => {
          repliesSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('replies canceled')), { once: true });
        })
    );
    const getReply = jest.fn<TestGetReply>(
      async ({ signal }) =>
        new Promise((_resolve, reject) => {
          quoteSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('quote canceled')), { once: true });
        })
    );
    const hook = await renderTopicController({
      getActive: () => active,
      readGateway: { getReply, getReplies, getTopic }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(firstTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(firstDetail));
    await act(async () => {
      await hook.result.current.controller.toggleTopicBodyQuote({
        instanceKey: 'topic:1:linuxdo:1:2',
        reference: { source: 'linuxdo', topicId: '1', postNumber: 2 }
      });
      void hook.result.current.controller.refreshWholeTopic();
      void hook.result.current.controller.refreshTopicReplies();
    });
    await waitFor(() => {
      expect(detailSignal).toBeDefined();
      expect(repliesSignal).toBeDefined();
      expect(quoteSignal).toBeDefined();
    });

    const unrelatedKey = forumQueryKeys.topic({
      source: 'nodeseek',
      topicId: '99',
      scope: initialForumSessionEpochs
    });
    void appQueryClient
      .fetchQuery({
        queryKey: unrelatedKey,
        queryFn: ({ signal }) =>
          new Promise((_resolve, reject) => {
            unrelatedSignal = signal;
            signal.addEventListener('abort', () => reject(new Error('unrelated cleanup')), { once: true });
          })
      })
      .catch(() => undefined);
    await waitFor(() => expect(unrelatedSignal).toBeDefined());

    await act(async () => {
      active = false;
      hook.rerender(undefined);
      await Promise.resolve();
    });

    expect(detailSignal?.aborted).toBe(true);
    expect(repliesSignal?.aborted).toBe(true);
    expect(quoteSignal?.aborted).toBe(true);
    expect(unrelatedSignal?.aborted).toBe(false);
    await appQueryClient.cancelQueries({ queryKey: unrelatedKey, exact: true });
  });

  it('deduplicates cross-topic reply quotes by their complete reference', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const quoted: Reply = { author: 'carol', floor: 2, contentHtml: '<p>quoted</p>', createdAt: '' };
    const pending = Promise.withResolvers<Reply>();
    const getReply = jest.fn<TestGetReply>(async () => pending.promise);
    const hook = await renderTopicController({
      topic: linuxTopic,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => linuxDetail),
        getReply
      }
    });
    const reference = { source: 'linuxdo' as const, topicId: '2679944', postNumber: 2 };

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(linuxDetail));
    await act(async () => {
      await Promise.all([
        hook.result.current.controller.toggleReplyQuote({ replyKey: 'comment:30', reference }),
        hook.result.current.controller.toggleReplyQuote({ replyKey: 'comment:80', reference })
      ]);
    });
    await waitFor(() => expect(getReply).toHaveBeenCalledTimes(1));
    expect(getReply).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'linuxdo',
        id: '2679944',
        floor: 2
      }),
      expect.any(Object)
    );
    await act(async () => {
      pending.resolve(quoted);
      await pending.promise;
    });

    await waitFor(() =>
      expect(hook.result.current.controller.loadedQuotedReplies['linuxdo:2679944:2']).toEqual(quoted)
    );
    expect(hook.result.current.session.state.expandedQuotes).toMatchObject({
      'reply:comment:30:linuxdo:2679944:2': true,
      'reply:comment:80:linuxdo:2679944:2': true
    });
    expect(getReply).toHaveBeenCalledTimes(1);
  });

  it('reuses a cached target opening post when expanding its quote', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/topic/2685882' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const cachedTarget: TopicDetail = {
      source: 'linuxdo',
      id: '342888',
      title: '盘点 L 站的徽章',
      author: 'Jenhy',
      authorAvatar: 'https://cdn.ldstatic.com/avatar.png',
      url: 'https://linux.do/t/topic/342888',
      createdAt: '2026-02-17T00:00:00.000Z',
      replyCount: 0,
      contentHtml: '<p>已访问主题的完整正文</p>',
      replies: []
    };
    const networkReply: Reply = {
      author: 'network',
      floor: 1,
      contentHtml: '<p>不应重复请求</p>',
      createdAt: ''
    };
    const getReply = jest.fn<TestGetReply>(async () => networkReply);
    const targetTopicKey = forumQueryKeys.topic({
      source: 'linuxdo',
      topicId: cachedTarget.id,
      readPlanScope: 'authenticated:0',
      scope: initialForumSessionEpochs
    });
    appQueryClient.setQueryData(targetTopicKey, cachedTarget);
    const hook = await renderTopicController({
      topic: linuxTopic,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => linuxDetail),
        getReply
      }
    });
    const reference = { source: 'linuxdo' as const, topicId: cachedTarget.id, postNumber: 1 };

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(linuxDetail));
    await act(async () => {
      await hook.result.current.controller.toggleReplyQuote({ replyKey: 'comment:22', reference });
    });

    await waitFor(() =>
      expect(hook.result.current.controller.loadedQuotedReplies['linuxdo:342888:1']).toMatchObject({
        author: 'Jenhy',
        authorAvatar: cachedTarget.authorAvatar,
        contentHtml: cachedTarget.contentHtml,
        floor: 1
      })
    );
    expect(hook.result.current.session.state.expandedQuotes['reply:comment:22:linuxdo:342888:1']).toBe(true);
    expect(getReply).not.toHaveBeenCalled();
  });

  it('keeps the parent quote state while a child Topic route opens', async () => {
    const parentTopic: Topic = {
      ...firstTopic,
      source: 'linuxdo',
      id: '2685882',
      url: 'https://linux.do/t/topic/2685882'
    };
    const reference = { source: 'linuxdo' as const, topicId: '342888', postNumber: 2 };
    const quotingReply: Reply = {
      ...firstReply,
      commentId: 44,
      floor: 2,
      quotedPosts: [{ reference }]
    };
    const parentDetail: TopicDetail = { ...firstDetail, ...parentTopic, replies: [quotingReply] };
    const targetTopic: Topic = {
      ...parentTopic,
      id: reference.topicId,
      title: 'Target',
      url: 'https://linux.do/t/topic/342888'
    };
    const quoted: Reply = {
      author: 'quoted',
      contentHtml: '<p>cached complete quote</p>',
      createdAt: '',
      floor: reference.postNumber
    };
    const getReply = jest.fn<TestGetReply>(async () => quoted);
    const onOpenTopic = jest.fn();
    const hook = await renderTopicController({
      onOpenTopic,
      topic: parentTopic,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => parentDetail),
        getReply
      }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(parentTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(parentDetail));
    await act(async () => {
      await hook.result.current.controller.toggleReplyQuote({
        replyKey: 'comment:44',
        reference
      });
    });
    await waitFor(() => expect(hook.result.current.controller.loadedQuotedReplies['linuxdo:342888:2']).toEqual(quoted));
    await act(async () => {
      await hook.result.current.controller.openTopic(targetTopic);
    });

    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(parentDetail));
    await waitFor(() => expect(hook.result.current.controller.loadedQuotedReplies['linuxdo:342888:2']).toEqual(quoted));
    expect(hook.result.current.session.state.expandedQuotes['reply:comment:44:linuxdo:342888:2']).toBe(true);
    expect(onOpenTopic).toHaveBeenCalledWith(targetTopic);
    expect(getReply).toHaveBeenCalledTimes(1);
  });

  it('reports an ordinary exact-quote recovery failure', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const getReply = jest
      .fn<TestGetReply>()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new Error('引用恢复网络失败'));
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderTopicController({
      showLinuxDoVerification,
      topic: linuxTopic,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => linuxDetail),
        getReply
      }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(linuxDetail));
    await act(async () => {
      await hook.result.current.controller.toggleTopicBodyQuote({
        instanceKey: 'topic:1:linuxdo:1:2',
        reference: { source: 'linuxdo', topicId: '1', postNumber: 2 }
      });
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('verification-required');
    });
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('failed');
    });
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    expect(getReply).toHaveBeenCalledTimes(3);
  });
});
