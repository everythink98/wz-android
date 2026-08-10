import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { appQueryClient, forumQueryKeys, type ForumIdentityBarrierSource } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { type DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import type { ReadGateway } from '@/sources/readGateway';
import type { RepliesResponse, Reply, ReplyLocationTarget, Topic, TopicDetail } from '@/domain/forum/models';
import { QueryTestWrapper } from '../QueryTestWrapper';

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

type ReplyRequest = Parameters<ReadGateway['getReplies']>[0];

function replyRequestPage(request: ReplyRequest) {
  return request.position.kind === 'cursor' ? request.position.page : undefined;
}

function replyRequestTarget(request: ReplyRequest) {
  return request.position.kind === 'target' ? request.position.target : undefined;
}

function v2exSnapshotStaleError() {
  return Object.assign(new Error('V2EX 回复总数已变化，无法确认完整集合'), {
    reason: 'v2ex-reply-snapshot-stale'
  });
}

describe('topic route sessions', () => {
  it('[REG-PERF-002] keeps route-local draft and filter state across rerenders', async () => {
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

  it('[REG-PERF-008] isolates state between native Topic route instances', async () => {
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
  getSessionEpochs = () => initialForumSessionEpochs,
  notify = jest.fn(),
  onNodeSeekTopicVerificationRequired = jest.fn(),
  onOpenTopic = jest.fn(),
  readGateway,
  showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
  targetReply,
  topic = firstTopic
}: {
  getActive?: () => boolean;
  getIdentityBarriers?: () => ForumIdentityBarrierSource[];
  getSessionEpochs?: () => ForumSessionEpochs;
  notify?: (message: string) => void;
  onNodeSeekTopicVerificationRequired?: (message: string, recovery: LinuxDoReadRecovery) => void;
  onOpenTopic?: (topic: Topic) => void;
  readGateway: Partial<ReadGateway>;
  showLinuxDoVerification?: (message?: string, recovery?: LinuxDoReadRecovery) => void;
  targetReply?: ReplyLocationTarget;
  topic?: Topic;
}) {
  const readerData = createEmptyReaderData();
  return renderNativeHook(
    () => {
      const session = useTopicSessionController({ notify, topic });
      const controller = useTopicController({
        active: getActive(),
        commitReaderData: jest.fn(),
        identityBarriers: getIdentityBarriers(),
        sessionEpochs: getSessionEpochs(),
        notify,
        onNodeSeekTopicVerificationRequired,
        onOpenTopic,
        readerData,
        readerDataRef: { current: readerData },
        showLinuxDoVerification,
        showYaohuoLogin: jest.fn(),
        readGateway: readGateway as ReadGateway,
        targetReply,
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

  it('uses one transport for repeated opens of the same key', async () => {
    const pending = Promise.withResolvers<TopicDetail>();
    const getTopic = jest.fn<ReadGateway['getTopic']>(async () => pending.promise);
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

  it.each(['linuxdo', 'xiaoyinsi'] as const)(
    '[REG-TOPIC-067] converts a %s embedded seed offset into the real stream window once',
    async (source) => {
      const topic: Topic = {
        ...firstTopic,
        source,
        url: source === 'linuxdo' ? 'https://linux.do/t/1' : 'https://forum.xiaoyinsi.com/t/1'
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
      const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
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
          getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
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
    }
  );

  it('[REG-TOPIC-067] keeps ordered caches separate and loads the newest tail before its adjacent older window', async () => {
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
    const pendingTail = Promise.withResolvers<Awaited<ReturnType<ReadGateway['getReplies']>>>();
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => {
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
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
        getReplies
      }
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([1, 2]));
    const oldestKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'oldest');
    const newestKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'newest');

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

  it('[REG-TOPIC-067][REG-TOPIC-068][REG-TOPIC-069][REG-TOPIC-076] reorders a complete V2EX collection locally and refreshes only replies', async () => {
    const replies = [
      { ...firstReply, floor: 1, commentId: 101 },
      { ...firstReply, floor: 2, commentId: 102 },
      { ...firstReply, floor: 3, commentId: 103 }
    ];
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 3 };
    const detail = { ...firstDetail, ...topic, replies, replyHasMore: false, replyNextPage: null };
    const getTopic = jest.fn<ReadGateway['getTopic']>(async () => detail);
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
      items: replies,
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

  it('[REG-TOPIC-076] keeps the V2EX body and prefix visible until stale snapshots converge', async () => {
    jest.useFakeTimers();
    try {
      const prefix = [
        { ...firstReply, floor: 1, commentId: 101 },
        { ...firstReply, floor: 2, commentId: 102 }
      ];
      const fullReplies = [...prefix, { ...firstReply, floor: 3, commentId: 103 }];
      const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 3 };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        contentHtml: '<p>V2EX body</p>',
        replies: prefix,
        replyHasMore: true,
        replyNextPage: null
      };
      const getReplies = jest
        .fn<ReadGateway['getReplies']>()
        .mockRejectedValueOnce(v2exSnapshotStaleError())
        .mockRejectedValueOnce(v2exSnapshotStaleError())
        .mockResolvedValueOnce({
          items: fullReplies,
          currentPage: 1,
          currentOffset: 0,
          previousPage: null,
          previousOffset: null,
          hasMore: false,
          nextPage: null,
          nextOffset: null,
          totalCount: 3
        });
      const hook = await renderTopicController({
        readGateway: {
          getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
          getReplies
        },
        topic
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(hook.result.current.controller.topicDetail?.contentHtml).toContain('V2EX body');
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([1, 2]);
      expect(hook.result.current.controller.repliesSyncing).toBe(true);
      expect(hook.result.current.controller.replyCollectionComplete).toBe(false);
      expect(getReplies).toHaveBeenCalledTimes(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
      });
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([1, 2]);
      expect(getReplies).toHaveBeenCalledTimes(2);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(getReplies).toHaveBeenCalledTimes(3);
      expect(
        appQueryClient.getQueryData(forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'oldest'))
      ).toMatchObject({ pages: [{ items: fullReplies }] });
      await act(async () => {
        hook.rerender(undefined);
      });
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([1, 2, 3]);
      expect(hook.result.current.controller.repliesSyncing).toBe(false);
      expect(hook.result.current.controller.replyCollectionComplete).toBe(true);
      expect(appQueryClient.getQueryData(hook.result.current.controller.topicQueryKey)).toMatchObject({
        replyCount: 3,
        replyHasMore: false,
        replyNextPage: null
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-TOPIC-076] keeps the V2EX prefix and exposes a reply-level retry after six stale reads', async () => {
    jest.useFakeTimers();
    try {
      const prefix = [{ ...firstReply, floor: 1, commentId: 101 }];
      const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 2 };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        replies: prefix,
        replyHasMore: true,
        replyNextPage: null
      };
      const getReplies = jest.fn<ReadGateway['getReplies']>(async () => {
        throw v2exSnapshotStaleError();
      });
      const hook = await renderTopicController({
        readGateway: {
          getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
          getReplies
        },
        topic
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(getReplies).toHaveBeenCalledTimes(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(25_000);
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(getReplies).toHaveBeenCalledTimes(6);
      expect(hook.result.current.controller.topicReplies).toEqual(prefix);
      expect(hook.result.current.controller.repliesSyncing).toBe(false);
      expect(hook.result.current.controller.replyCollectionComplete).toBe(false);
      expect(hook.result.current.controller.repliesError?.message).toContain('回复总数已变化');
      expect(hook.result.current.controller.topicError).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-TOPIC-076] does not retry structural V2EX reply failures', async () => {
    jest.useFakeTimers();
    try {
      const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 2 };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        replyHasMore: true,
        replyNextPage: null
      };
      const getReplies = jest.fn<ReadGateway['getReplies']>(async () => {
        throw new Error('V2EX 回复集合未确认完整');
      });
      const hook = await renderTopicController({
        readGateway: {
          getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
          getReplies
        },
        topic
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      expect(getReplies).toHaveBeenCalledTimes(1);
      expect(appQueryClient.getQueryData(hook.result.current.controller.topicQueryKey)).toMatchObject({
        replies: detail.replies,
        replyHasMore: true
      });
      expect(hook.result.current.controller.topicReplies).toEqual(detail.replies);
      expect(hook.result.current.controller.repliesError?.message).toBe('V2EX 回复集合未确认完整');
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-TOPIC-076] cancels delayed V2EX snapshot retries when the route becomes inactive', async () => {
    jest.useFakeTimers();
    try {
      let active = true;
      const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 2 };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        replyHasMore: true,
        replyNextPage: null
      };
      const getReplies = jest.fn<ReadGateway['getReplies']>(async () => {
        throw v2exSnapshotStaleError();
      });
      const hook = await renderTopicController({
        getActive: () => active,
        readGateway: {
          getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
          getReplies
        },
        topic
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(getReplies).toHaveBeenCalledTimes(1);
      active = false;
      await act(async () => {
        hook.rerender(undefined);
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      expect(getReplies).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-TOPIC-076] rebuilds incomplete V2EX replies through the convergence query on a full refresh', async () => {
    const prefix = [{ ...firstReply, floor: 1, commentId: 101 }];
    const fullReplies = [...prefix, { ...firstReply, floor: 2, commentId: 102 }];
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 2 };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: prefix,
      replyHasMore: true,
      replyNextPage: null
    };
    const getTopic = jest.fn<ReadGateway['getTopic']>(async () => detail);
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
      items: fullReplies,
      currentPage: 1,
      currentOffset: 0,
      previousPage: null,
      previousOffset: null,
      hasMore: false,
      nextPage: null,
      nextOffset: null,
      totalCount: 2
    }));
    const hook = await renderTopicController({ readGateway: { getTopic, getReplies }, topic });

    await waitFor(() => expect(hook.result.current.controller.replyCollectionComplete).toBe(true));
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getReplies).toHaveBeenCalledTimes(1);

    await act(async () => {
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('completed');
    });

    expect(getTopic).toHaveBeenCalledTimes(2);
    expect(getReplies).toHaveBeenCalledTimes(2);
    expect(hook.result.current.controller.topicReplies).toEqual(fullReplies);
  });

  it('[REG-TOPIC-067] rejects an unconfirmed tail without applying it and retries the same order', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 45,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 1
    };
    const tail = { ...firstReply, floor: 45, commentId: 145 };
    const getReplies = jest
      .fn<ReadGateway['getReplies']>()
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
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
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

  it('[REG-TOPIC-067] retries a stale tail once with a refreshed authoritative count', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 45,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const refreshedDetail = { ...detail, replyCount: 46 };
    const refreshedTopic = Promise.withResolvers<TopicDetail>();
    const getTopic = jest
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(detail)
      .mockImplementation(async () => refreshedTopic.promise);
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => {
      if (request.replyCount === 45) {
        throw Object.assign(new Error('NodeSeek 回复总数已变化，无法确认最新窗口'), {
          reason: 'reply-count-refresh-required'
        });
      }
      return {
        items: [{ ...firstReply, floor: 46, commentId: 146 }],
        currentPage: 5,
        currentOffset: 40,
        hasMore: true,
        nextPage: 4,
        nextOffset: 30,
        totalCount: 46
      };
    });
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toContain('回复总数已变化'));

    let retry!: Promise<LinuxDoReadResumeOutcome>;
    await act(async () => {
      retry = hook.result.current.controller.retryReplies();
      await Promise.resolve();
    });

    expect(getTopic).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(hook.result.current.controller.repliesLoading).toBe(true));

    await act(async () => {
      refreshedTopic.resolve(refreshedDetail);
      await expect(retry).resolves.toBe('completed');
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([46]));
    expect(hook.result.current.controller.repliesLoading).toBe(false);
    expect(getTopic).toHaveBeenCalledTimes(2);
    expect(getReplies.mock.calls.map(([request]) => request.replyCount)).toEqual([45, 46]);
  });

  it('[REG-TOPIC-067] does not reset the stale-count retry after an intermediate network failure', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 45,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const refreshedDetail = { ...detail, replyCount: 46 };
    const countChanged = () =>
      Object.assign(new Error('NodeSeek 回复总数已变化，无法确认最新窗口'), {
        reason: 'reply-count-refresh-required'
      });
    const getTopic = jest
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(detail)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(refreshedDetail);
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => {
      throw countChanged();
    });
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toContain('回复总数已变化'));
    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('failed');
    });
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toBe('offline'));
    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('failed');
    });
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toContain('回复总数已变化'));
    expect(hook.result.current.controller.repliesError?.retryable).toBe(false);

    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('failed');
    });
    expect(getTopic).toHaveBeenCalledTimes(3);
    expect(getReplies).toHaveBeenCalledTimes(2);
  });

  it('[REG-TOPIC-057] isolates cached detail when the credential scope changes', async () => {
    let scope = initialForumSessionEpochs;
    const replacement = Promise.withResolvers<TopicDetail>();
    const getTopic = jest
      .fn<ReadGateway['getTopic']>()
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
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => {
      throw new Error('offline');
    });
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
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

  it.each(['linuxdo', 'xiaoyinsi', 'yaohuo'] as const)(
    '[REG-TOPIC-068] retries an ordinary %s edge at the same cursor without refreshing the topic count',
    async (source) => {
      const topic: Topic = {
        ...firstTopic,
        source,
        url:
          source === 'linuxdo'
            ? 'https://linux.do/t/1'
            : source === 'xiaoyinsi'
              ? 'https://forum.xiaoyinsi.com/t/1'
              : 'https://www.yaohuo.me/bbs-1.html'
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
      const getTopic = jest.fn<ReadGateway['getTopic']>(async () => detail);
      const getReplies = jest
        .fn<ReadGateway['getReplies']>()
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

  it.each(['linuxdo', 'xiaoyinsi', 'yaohuo'] as const)(
    '[REG-TOPIC-068] retries an ordinary %s previous edge at the same cursor without refreshing the topic count',
    async (source) => {
      const topic: Topic = {
        ...firstTopic,
        source,
        url:
          source === 'linuxdo'
            ? 'https://linux.do/t/1'
            : source === 'xiaoyinsi'
              ? 'https://forum.xiaoyinsi.com/t/1'
              : 'https://www.yaohuo.me/bbs-1.html'
      };
      const detail: TopicDetail = { ...firstDetail, ...topic, replies: [], replyCount: 20 };
      const anchor = { ...firstReply, floor: 20, commentId: 120 };
      const previousReply = { ...firstReply, floor: 10, commentId: 110 };
      const getTopic = jest.fn<ReadGateway['getTopic']>(async () => detail);
      const getReplies = jest
        .fn<ReadGateway['getReplies']>()
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

  it('[REG-TOPIC-068] keeps the NodeSeek total unavailable after loading a terminal adjacent page', async () => {
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
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
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
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
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

  it('[REG-TOPIC-067] does not let opposite pagination replace a pending edge retry', async () => {
    const anchor = { ...firstReply, floor: 20, commentId: 120 };
    const previous = { ...firstReply, floor: 10, commentId: 110 };
    const next = { ...firstReply, floor: 30, commentId: 130 };
    const pendingPrevious = Promise.withResolvers<RepliesResponse>();
    let previousAttempts = 0;
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => {
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
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => ({ ...firstDetail, replyCount: 30 })),
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

  it('[REG-TOPIC-062] anchors a distant reply once and loads only its adjacent windows', async () => {
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
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => {
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
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
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
          target: { commentId: 155, floor: 155 },
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

  it('[REG-TOPIC-025][REG-TOPIC-062] keeps a later target authoritative over an earlier whole-topic refresh', async () => {
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
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(detail)
      .mockImplementationOnce(async () => pendingDetail.promise);
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
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

  it('[REG-TOPIC-067][REG-WRITE-017] does not apply an old-order write tail after the order changes', async () => {
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
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({ ...detail, replyCount: 21 });
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) =>
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
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    const oldestKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'oldest');
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
  });

  it('[REG-NOTIFY-047] passes a comment-only notification target through the shared reply gateway', async () => {
    const target = { ...firstReply, floor: 25, commentId: 31 };
    const detail = { ...firstDetail, replies: [firstReply], replyCount: 30 };
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
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
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
        getReplies
      },
      targetReply: { commentId: 31 }
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));
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

  it('[REG-TOPIC-062][REG-TOPIC-069] locates V2EX only from its already loaded reply collection', async () => {
    const reply = { ...firstReply, floor: 12, commentId: 120 };
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1' };
    const detail = { ...firstDetail, ...topic, replies: [reply], replyCount: 1, replyHasMore: false };
    const getReplies = jest.fn<ReadGateway['getReplies']>();
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
        getReplies
      },
      targetReply: { floor: 12 },
      topic
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([reply]));
    await expect(hook.result.current.controller.locateReply({ floor: 12 })).resolves.toBe('completed');
    await expect(hook.result.current.controller.locateReply({ floor: 99 }, { silent: true })).resolves.toBe('failed');
    expect(getReplies).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-076] locates inside the V2EX prefix and waits for outside floors until convergence', async () => {
    const prefixReply = { ...firstReply, floor: 1, commentId: 101 };
    const target = { ...firstReply, floor: 2, commentId: 102 };
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 2 };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: [prefixReply],
      replyHasMore: true,
      replyNextPage: null
    };
    const pending = Promise.withResolvers<RepliesResponse>();
    const notify = jest.fn();
    const hook = await renderTopicController({
      notify,
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
        getReplies: jest.fn<ReadGateway['getReplies']>(async () => pending.promise)
      },
      topic
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([prefixReply]));
    await expect(hook.result.current.controller.locateReply({ floor: 1 })).resolves.toBe('completed');
    await expect(hook.result.current.controller.locateReply({ floor: 2 })).resolves.toBe('stale');
    expect(notify).not.toHaveBeenCalledWith('目标楼层未找到');

    await act(async () => {
      pending.resolve({
        items: [prefixReply, target],
        currentPage: 1,
        currentOffset: 0,
        previousPage: null,
        previousOffset: null,
        hasMore: false,
        nextPage: null,
        nextOffset: null,
        totalCount: 2
      });
      await pending.promise;
    });
    await waitFor(() => expect(hook.result.current.controller.replyCollectionComplete).toBe(true));
    await expect(hook.result.current.controller.locateReply({ floor: 2 })).resolves.toBe('completed');
    await expect(hook.result.current.controller.locateReply({ floor: 99 })).resolves.toBe('failed');
    expect(notify).toHaveBeenCalledWith('目标楼层未找到');
  });

  it('[REG-TOPIC-062] preserves the current window when a source cannot confirm the target floor', async () => {
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
      items: [{ ...firstReply, floor: 98 }],
      currentPage: 10,
      currentOffset: 90,
      hasMore: false,
      nextPage: null
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => firstDetail),
        getReplies
      }
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
    await act(async () => {
      await expect(hook.result.current.controller.locateReply({ floor: 99 }, { silent: true })).resolves.toBe('failed');
    });
    expect(hook.result.current.controller.topicReplies).toEqual([firstReply]);
  });

  it('[REG-TOPIC-062] requires a matching comment id when the target supplies one', async () => {
    const decoy = { ...firstReply, floor: 99, commentId: 998 };
    const detail = { ...firstDetail, replies: [decoy] };
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
      items: [{ ...decoy, commentId: 997 }],
      currentPage: 10,
      currentOffset: 90,
      hasMore: false,
      nextPage: null
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
        getReplies
      },
      targetReply: { floor: 99, commentId: 999 }
    });

    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    await act(async () => Promise.resolve());
    expect(hook.result.current.controller.topicReplies).toEqual([decoy]);
  });

  it('[REG-TOPIC-062] retries the exact NodeSeek target after verification', async () => {
    const target = { ...firstReply, floor: 90, commentId: 900 };
    const verificationError = Object.assign(new Error('NodeSeek 需要验证'), {
      source: 'nodeseek' as const,
      reason: 'cloudflare'
    });
    const getReplies = jest
      .fn<ReadGateway['getReplies']>()
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
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => firstDetail),
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

  it('[REG-TOPIC-062] retries a route target after its source session epoch advances', async () => {
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
      .fn<ReadGateway['getReplies']>()
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
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
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

  it('[REG-TOPIC-025] resets stale reply pages and cursors after a whole-topic refresh', async () => {
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
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(initialDetail)
      .mockResolvedValueOnce(refreshedDetail);
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) =>
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

  it('[REG-TOPIC-023] retries the exact failed reply page after linux.do verification', async () => {
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
      .fn<ReadGateway['getReplies']>()
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
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => linuxDetail),
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

  it('[REG-XIAOYINSI-008] applies the authoritative reply total from the replies query', async () => {
    const xiaTopic = {
      ...firstTopic,
      source: 'xiaoyinsi' as const,
      url: 'https://xiaoyinsi.com/t/first/1'
    };
    const xiaDetail = { ...firstDetail, ...xiaTopic, replyCount: 100, replies: [] };
    const authoritativeReply = { ...firstReply, floor: 8 };
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
      items: [authoritativeReply],
      currentPage: 1,
      currentOffset: 0,
      hasMore: false,
      nextPage: null,
      totalCount: 7
    }));
    const hook = await renderTopicController({
      topic: xiaTopic,
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => xiaDetail),
        getReplies
      }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(xiaTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail?.replyCount).toBe(100));
    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies()).resolves.toBe('completed');
    });

    await waitFor(() => expect(hook.result.current.controller.topicDetail?.replyCount).toBe(7));
    expect(hook.result.current.controller.topicReplies).toEqual([authoritativeReply]);
  });

  it('[REG-WRITE-017][REG-TOPIC-062][REG-TOPIC-067] discovers the real tail before reanchoring oldest order', async () => {
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
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => ({
      items: [submittedReply],
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
        getTopic: jest.fn<ReadGateway['getTopic']>().mockResolvedValueOnce(detail).mockResolvedValue(refreshedDetail),
        getReplies
      },
      topic: discourseTopic
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(discourseTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(10));
    const newestKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'newest');
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
    });
    expect(appQueryClient.getQueryData(newestKey)).toBeDefined();
    expect(appQueryClient.getQueryState(newestKey)?.isInvalidated).toBe(true);
    const repliesQueryKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey, 'oldest');
    expect(appQueryClient.getQueryData(repliesQueryKey)).toBeDefined();

    hook.unmount();
    await waitFor(() => expect(appQueryClient.getQueryData(repliesQueryKey)).toBeUndefined());
  });

  it('[REG-TOPIC-067][REG-WRITE-017] rebuilds the confirmed newest tail after a reply submit', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 1
    };
    const refreshedDetail = { ...detail, replyCount: 21 };
    const getTopic = jest
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(detail)
      .mockResolvedValue(refreshedDetail);
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => {
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
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic } });

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
  });

  it('[REG-TOPIC-067][REG-WRITE-017] reanchors after deleting the only reply in the current tail window', async () => {
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
    const deletedReply = { ...firstReply, floor: 31, commentId: 131 };
    const getTopic = jest
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(detail)
      .mockResolvedValue({ ...detail, replyCount: 30 });
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => {
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
          target: deletedReply,
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

  it('[REG-TOPIC-067][REG-WRITE-017] keeps a failed write refresh visible and retries its exact tail window', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const refreshedDetail = { ...detail, replyCount: 21 };
    const getTopic = jest
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(detail)
      .mockResolvedValue(refreshedDetail);
    let attempts = 0;
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => {
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

  it('[REG-TOPIC-067][REG-WRITE-017] retries the complete write refresh after the authoritative count read fails', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const refreshedDetail = { ...detail, replyCount: 21 };
    const getTopic = jest
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(detail)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(refreshedDetail);
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => {
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

  it('[REG-TOPIC-067] retries a failed whole-topic rebuild from a fresh authoritative start', async () => {
    const detail = {
      ...firstDetail,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const getTopic = jest
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({ ...detail, replyCount: 21 })
      .mockResolvedValueOnce({ ...detail, replyCount: 22 });
    const getReplies = jest.fn<ReadGateway['getReplies']>(async (request) => {
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

  it('[REG-TOPIC-005] records a failed V2EX comments refresh as failure and keeps the trusted detail', async () => {
    const v2exTopic = {
      ...firstTopic,
      source: 'v2ex' as const,
      url: 'https://www.v2ex.com/t/1'
    };
    const v2exDetail = { ...firstDetail, ...v2exTopic, replyCount: 1, replyHasMore: false };
    const getTopic = jest.fn<ReadGateway['getTopic']>(async () => v2exDetail);
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => {
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
    const getTopic = jest.fn<ReadGateway['getTopic']>(async () => {
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
    expect(recovery?.queryKey).toEqual(['forum', 'linuxdo', 'topic', { sessionEpoch: 0, topicId: '1' }]);
    await act(async () => {
      await recovery?.resume();
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(linuxDetail));
    expect(getTopic).toHaveBeenCalledTimes(2);
  });

  it('loads quoted posts by a reference key without putting server data in route-local state', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const quoted: Reply = { author: 'carol', floor: 2, contentHtml: '<p>quoted</p>', createdAt: '' };
    const getReply = jest.fn<ReadGateway['getReply']>(async () => quoted);
    const hook = await renderTopicController({
      topic: linuxTopic,
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => linuxDetail),
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

    expect(getReply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.session.state).not.toHaveProperty('loadedQuotedReplies');
    expect(hook.result.current.session.state).not.toHaveProperty('topicDetail');
  });

  it('[REG-TOPIC-026] prefetches an accepted answer without expanding a quote or notifying', async () => {
    const solvedTopic: Topic = {
      ...firstTopic,
      source: 'xiaoyinsi',
      id: '206',
      url: 'https://forum.xiaoyinsi.com/t/topic/206'
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
    const getReply = jest.fn<ReadGateway['getReply']>(async () => acceptedReply);
    const hook = await renderTopicController({
      notify,
      topic: solvedTopic,
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => solvedDetail),
        getReply
      }
    });
    const instanceKey = 'accepted-answer:xiaoyinsi:206:9';

    await act(async () => {
      await hook.result.current.controller.openTopic(solvedTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(solvedDetail));
    notify.mockClear();
    await act(async () => {
      await hook.result.current.controller.toggleTopicBodyQuote({
        instanceKey,
        prefetch: true,
        reference: { source: 'xiaoyinsi', topicId: '206', postNumber: 9 }
      });
    });

    await waitFor(() =>
      expect(hook.result.current.controller.loadedQuotedReplies['xiaoyinsi:206:9']).toEqual(acceptedReply)
    );
    expect(getReply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.session.state.expandedQuotes[instanceKey]).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-026] keeps a failed accepted-answer prefetch silent', async () => {
    const solvedTopic: Topic = {
      ...firstTopic,
      source: 'linuxdo',
      id: '207',
      url: 'https://linux.do/t/topic/207'
    };
    const solvedDetail: TopicDetail = { ...firstDetail, ...solvedTopic, replies: [], solved: true };
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const getReply = jest.fn<ReadGateway['getReply']>(async () => {
      throw new LinuxDoCloudflareError();
    });
    const hook = await renderTopicController({
      notify,
      showLinuxDoVerification,
      topic: solvedTopic,
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => solvedDetail),
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
    '[REG-TOPIC-026] recovers a failed prefetch interactively %s',
    async (_case, withLocalPost, expectedCalls) => {
      const solvedTopic: Topic = {
        ...firstTopic,
        source: 'xiaoyinsi',
        id: '208',
        url: 'https://forum.xiaoyinsi.com/t/topic/208'
      };
      const solvedDetail: TopicDetail = { ...firstDetail, ...solvedTopic, replies: [], solved: true };
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
      const getReply = jest.fn<ReadGateway['getReply']>(async () => {
        replyAttempt += 1;
        if (replyAttempt === 1) {
          throw new Error('prefetch failed');
        }
        return acceptedReply;
      });
      const hook = await renderTopicController({
        notify,
        topic: solvedTopic,
        readGateway: {
          getTopic: jest.fn<ReadGateway['getTopic']>(async () => solvedDetail),
          getReply
        }
      });
      const reference = { source: 'xiaoyinsi' as const, topicId: '208', postNumber: 9 };
      const acceptedInstanceKey = 'accepted-answer:xiaoyinsi:208:9';
      const quoteInstanceKey = 'topic:208:xiaoyinsi:208:9';

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
        expect(hook.result.current.controller.loadedQuotedReplies['xiaoyinsi:208:9']).toEqual(acceptedReply)
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
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(firstDetail)
      .mockImplementationOnce(
        async ({ signal }) =>
          new Promise<TopicDetail>((_resolve, reject) => {
            detailSignal = signal;
            signal?.addEventListener('abort', () => reject(new Error('detail canceled')), { once: true });
          })
      );
    const getReplies = jest.fn<ReadGateway['getReplies']>(
      async ({ signal }) =>
        new Promise((_resolve, reject) => {
          repliesSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('replies canceled')), { once: true });
        })
    );
    const getReply = jest.fn<ReadGateway['getReply']>(
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

  it('[REG-TOPIC-007][REG-TOPIC-053] deduplicates cross-topic reply quotes by their complete reference', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const quoted: Reply = { author: 'carol', floor: 2, contentHtml: '<p>quoted</p>', createdAt: '' };
    const pending = Promise.withResolvers<Reply>();
    const getReply = jest.fn<ReadGateway['getReply']>(async () => pending.promise);
    const hook = await renderTopicController({
      topic: linuxTopic,
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => linuxDetail),
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

  it('[REG-TOPIC-054] reuses a cached target opening post when expanding its quote', async () => {
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
    const getReply = jest.fn<ReadGateway['getReply']>(async () => networkReply);
    const targetTopicKey = forumQueryKeys.topic({
      source: 'linuxdo',
      topicId: cachedTarget.id,
      scope: initialForumSessionEpochs
    });
    appQueryClient.setQueryData(targetTopicKey, cachedTarget);
    const hook = await renderTopicController({
      topic: linuxTopic,
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => linuxDetail),
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

  it('[REG-TOPIC-054] keeps the parent quote state while a child Topic route opens', async () => {
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
    const getReply = jest.fn<ReadGateway['getReply']>(async () => quoted);
    const onOpenTopic = jest.fn();
    const hook = await renderTopicController({
      onOpenTopic,
      topic: parentTopic,
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => parentDetail),
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

  it('REG-LINUXDO-003 reports an ordinary exact-quote recovery failure', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const getReply = jest
      .fn<ReadGateway['getReply']>()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new Error('引用恢复网络失败'));
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderTopicController({
      showLinuxDoVerification,
      topic: linuxTopic,
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => linuxDetail),
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
