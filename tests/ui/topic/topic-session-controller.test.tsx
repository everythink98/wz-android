import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { appQueryClient, forumQueryKeys, type ForumIdentityBarrierSource } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { type DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import type { ReadGateway } from '@/sources/readGateway';
import type { Reply, ReplyLocationTarget, Topic, TopicDetail } from '@/domain/forum/models';
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

describe('topic route sessions', () => {
  it('[REG-PERF-002] keeps route-local draft and filter state across rerenders', async () => {
    const hook = await renderNativeHook(() => useTopicSessionController({ notify: jest.fn(), topic: firstTopic }));
    await act(async () => {
      hook.result.current.commands.composer.changeContent('current draft');
      hook.result.current.commands.view.changeReplyFilter('author');
    });
    hook.rerender(undefined);
    expect(hook.result.current.state.replyContent).toBe('current draft');
    expect(hook.result.current.state.replyFilter).toBe('author');
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
      second.result.current.commands.composer.changeContent('second draft');
    });
    expect(first.result.current.state.replyContent).toBe('first draft');
    expect(second.result.current.state.replyContent).toBe('second draft');
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

  it('[REG-PERF-008] opens a different Topic as a new route without mutating the current session', async () => {
    const secondTopic = { ...firstTopic, id: '2', title: 'Second', url: 'https://www.nodeseek.com/post-2-1' };
    const getTopic = jest.fn<ReadGateway['getTopic']>(async () => firstDetail);
    const onOpenTopic = jest.fn();
    const hook = await renderTopicController({ onOpenTopic, readGateway: { getTopic } });

    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(firstDetail));
    await act(async () => {
      hook.result.current.session.commands.composer.changeContent('A draft');
      await hook.result.current.controller.openTopic(secondTopic);
    });

    expect(onOpenTopic).toHaveBeenCalledWith(secondTopic);
    expect(hook.result.current.session.state.selectedTopic).toEqual(firstTopic);
    expect(hook.result.current.session.state.replyContent).toBe('A draft');
    expect(getTopic).toHaveBeenCalledTimes(1);
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

  it('[REG-ACCOUNT-031] keeps a loaded topic read-only while its identity is pending', async () => {
    let identityBarriers: ForumIdentityBarrierSource[] = [];
    const getTopic = jest.fn<ReadGateway['getTopic']>(async () => firstDetail);
    const hook = await renderTopicController({
      getIdentityBarriers: () => identityBarriers,
      readGateway: { getTopic }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(firstTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(firstDetail));

    identityBarriers = ['nodeseek'];
    await act(async () => {
      hook.rerender(undefined);
      await Promise.resolve();
    });

    await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('stale');
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(hook.result.current.controller.topicDetail).toEqual(firstDetail);
  });

  it('[REG-LINUXDO-007] starts a blocked linux.do Topic exactly once when identity settles', async () => {
    const linuxTopic: Topic = {
      ...firstTopic,
      source: 'linuxdo',
      url: 'https://linux.do/t/first/1'
    };
    const linuxDetail: TopicDetail = {
      ...firstDetail,
      ...linuxTopic
    };
    let identityBarriers: ForumIdentityBarrierSource[] = ['linuxdo'];
    const getTopic = jest.fn<ReadGateway['getTopic']>(async () => linuxDetail);
    const showLinuxDoVerification = jest.fn();
    const hook = await renderTopicController({
      getIdentityBarriers: () => identityBarriers,
      showLinuxDoVerification,
      topic: linuxTopic,
      readGateway: { getTopic }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxTopic);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getTopic).not.toHaveBeenCalled();
    expect(showLinuxDoVerification).not.toHaveBeenCalled();
    expect(hook.result.current.controller.topicBusy).toBe(false);

    identityBarriers = [];
    await act(async () => {
      hook.rerender(undefined);
    });

    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(linuxDetail));
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(showLinuxDoVerification).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-002] does not cache parse-empty topic data', async () => {
    const parsedEmpty = annotateSourceDiagnosticSummary(
      { ...firstDetail, contentHtml: '', replies: [] },
      {
        parserVariant: 'test',
        candidateCount: 1,
        validCount: 0,
        isParseEmpty: true
      }
    );
    const hook = await renderTopicController({
      readGateway: { getTopic: jest.fn<ReadGateway['getTopic']>(async () => parsedEmpty) }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(firstTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicError?.message).toContain('解析为空'));
    const key = forumQueryKeys.topic({ source: 'nodeseek', topicId: '1', scope: initialForumSessionEpochs });
    expect(appQueryClient.getQueryData(key)).toBeUndefined();
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
  });

  it('[REG-NOTIFY-046] resolves a Yaohuo target floor without walking the intervening pages', async () => {
    const topic: Topic = {
      ...firstTopic,
      source: 'yaohuo',
      id: '1560939',
      categoryId: '177',
      url: 'https://www.yaohuo.me/bbs-1560939.html'
    };
    const latestReply = { ...firstReply, floor: 558 };
    const target: Reply = {
      author: 'alice',
      floor: 90,
      contentHtml: '<p>target</p>',
      createdAt: '2026-07-03T05:45:52.000Z'
    };
    const older: Reply = {
      author: 'bob',
      floor: 60,
      contentHtml: '<p>older</p>',
      createdAt: '2026-07-03T05:30:00.000Z'
    };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: [latestReply],
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 30
    };
    const getReplies = jest.fn<ReadGateway['getReplies']>(async ({ targetFloor }) =>
      targetFloor
        ? {
            items: [target],
            currentPage: 16,
            hasMore: true,
            nextPage: 17
          }
        : {
            items: [older],
            currentPage: 17,
            hasMore: false,
            nextPage: null
          }
    );
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>(async () => detail),
        getReplies
      },
      targetReply: { floor: 90 },
      topic
    });

    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));
    expect(getReplies).toHaveBeenCalledTimes(1);
    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1560939', page: 1, source: 'yaohuo', targetFloor: 90 }),
      expect.any(Object)
    );
    await act(async () => {
      await hook.result.current.controller.loadMoreReplies({ silent: true });
    });

    expect(getReplies).toHaveBeenCalledTimes(2);
    expect(getReplies.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ page: 17, source: 'yaohuo' }));
    expect(getReplies.mock.calls[1]?.[0]).not.toHaveProperty('targetFloor');
    expect(getReplies.mock.calls.map(([request]) => request.page)).toEqual([1, 17]);
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target, older]));
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
    const getReplies = jest.fn<ReadGateway['getReplies']>(async ({ page, targetFloor }) => {
      if (targetFloor === 155) {
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

    expect(getReplies.mock.calls.map(([request]) => request.targetFloor ?? request.page)).toEqual([155, 15, 17]);
    expect(getReplies.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ limit: 30, targetFloor: 155 }));
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([previous, target, next]));
    expect(hook.result.current.controller.replyHasPrevious).toBe(false);
    expect(hook.result.current.controller.replyHasMore).toBe(false);

    await act(async () => {
      await hook.result.current.controller.loadPreviousReplies({ silent: true });
      await hook.result.current.controller.loadMoreReplies({ silent: true });
    });
    expect(getReplies.mock.calls.map(([request]) => request.targetFloor ?? request.page)).toEqual([155, 15, 17]);

    await act(async () => {
      await expect(
        hook.result.current.controller.refreshTopicReplies({
          afterSubmit: true,
          silent: true,
          targetReply: { commentId: 155, floor: 155 },
          editedReplyContent: { commentId: 155, contentMarkdown: 'edited' }
        })
      ).resolves.toBe('completed');
    });

    expect(getReplies.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({ page: 16, offset: 150, source: 'nodeseek' })
    );
    expect(getReplies.mock.calls[3]?.[0]).not.toHaveProperty('targetFloor');

    await act(async () => {
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('completed');
      await Promise.resolve();
    });
    expect(getReplies.mock.calls.filter(([request]) => request.targetFloor === 155)).toHaveLength(1);
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
  });

  it('[REG-TOPIC-062] locates V2EX only from its already loaded reply collection', async () => {
    const reply = { ...firstReply, floor: 12, commentId: 120 };
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1' };
    const detail = { ...firstDetail, ...topic, replies: [reply] };
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

    expect(getReplies.mock.calls.map(([request]) => request.targetFloor)).toEqual([90, 90]);
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
    const getReplies = jest.fn<ReadGateway['getReplies']>(async ({ page }) =>
      page === 2
        ? { items: [oldSecondReply], hasMore: false, nextPage: null, nextOffset: null }
        : { items: [refreshedSecondReply], hasMore: false, nextPage: null, nextOffset: null }
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
    expect(getReplies.mock.calls.map(([request]) => request.page)).toEqual([2, 5]);
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

    expect(getReplies.mock.calls.map(([request]) => request.page)).toEqual([2, 2]);
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

  it('[REG-WRITE-017][REG-TOPIC-062] reanchors the authoritative tail after a reply submit', async () => {
    const initialReplies = Array.from({ length: 10 }, (_, index): Reply => ({
      author: `user-${index + 1}`,
      floor: index + 1,
      commentId: 100 + index,
      contentHtml: `<p>${index + 1}</p>`,
      createdAt: `2026-07-20T00:${String(index + 1).padStart(2, '0')}:00.000Z`
    }));
    const detail = {
      ...firstDetail,
      replies: initialReplies,
      replyCount: 20,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const submittedReply: Reply = {
      author: 'alice',
      floor: 21,
      commentId: 121,
      contentHtml: '<p>new reply</p>',
      createdAt: '2026-07-20T00:21:00.000Z'
    };
    const refreshedDetail = { ...detail, replyCount: 21 };
    const getReplies = jest.fn<ReadGateway['getReplies']>(async () => ({
      items: [submittedReply],
      currentPage: 3,
      currentOffset: 20,
      previousPage: 2,
      previousOffset: 10,
      hasMore: false,
      nextPage: null,
      nextOffset: null,
      totalCount: 21
    }));
    const hook = await renderTopicController({
      readGateway: {
        getTopic: jest.fn<ReadGateway['getTopic']>().mockResolvedValueOnce(detail).mockResolvedValue(refreshedDetail),
        getReplies
      }
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(firstTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(10));
    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies({ afterSubmit: true })).resolves.toBe(
        'completed'
      );
    });

    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nodeseek',
        id: '1',
        page: 1,
        offset: null,
        targetFloor: 21,
        limit: 30,
        signal: expect.any(Object)
      }),
      expect.any(Object)
    );
    await waitFor(() => {
      expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([21]);
      expect(hook.result.current.controller.topicDetail?.replyCount).toBe(21);
    });
    const repliesQueryKey = forumQueryKeys.replies(hook.result.current.controller.topicQueryKey);
    expect(appQueryClient.getQueryData(repliesQueryKey)).toBeDefined();

    hook.unmount();
    await waitFor(() => expect(appQueryClient.getQueryData(repliesQueryKey)).toBeUndefined());
  });

  it('[REG-TOPIC-005] records a failed V2EX comments refresh as failure and keeps the trusted detail', async () => {
    const v2exTopic = {
      ...firstTopic,
      source: 'v2ex' as const,
      url: 'https://www.v2ex.com/t/1'
    };
    const v2exDetail = { ...firstDetail, ...v2exTopic };
    const getTopic = jest
      .fn<ReadGateway['getTopic']>()
      .mockResolvedValueOnce(v2exDetail)
      .mockRejectedValueOnce(new Error('V2EX refresh failed'));
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const hook = await renderTopicController({ readGateway: { getTopic }, topic: v2exTopic });

    await act(async () => {
      await hook.result.current.controller.openTopic(v2exTopic);
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(v2exDetail));
    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies()).resolves.toBe('failed');
    });

    expect(hook.result.current.controller.topicDetail).toEqual(v2exDetail);
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
