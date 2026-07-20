import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { SourceGateway } from '../../src/sources/sourceGateway';
import type { Topic, TopicDetail } from '../../src/types';
import { createEmptyReaderData } from '../../src/readerData';
import { appQueryClient, resetForumSourceQueries } from '../../src/app/serverState';
import { useTopicController } from '../../src/app/useTopicController';
import { useTopicSessionController } from '../../src/app/useTopicSessionController';
import type { LinuxDoReadRecovery } from '../../src/app/useVerificationController';
import { LinuxDoCloudflareError } from '../../src/cloudflareChallenge';

const topic: TopicDetail = {
  source: 'yaohuo',
  id: '42',
  title: '妖火主题',
  author: 'alice',
  url: 'https://yaohuo.me/bbs/book_view.aspx?id=42',
  createdAt: '2026-07-15T00:00:00.000Z',
  replyCount: 0,
  contentHtml: '<p>正文</p>',
  replies: [],
  bookmarked: false
};

describe('topic session controller', () => {
  it('keeps an unrelated source topic request in flight when another credential session changes', async () => {
    const v2exTopic: Topic = {
      source: 'v2ex',
      id: '84',
      title: 'V2EX Topic',
      author: 'alice',
      url: 'https://www.v2ex.com/t/84',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const v2exDetail: TopicDetail = { ...v2exTopic, contentHtml: '<p>body</p>', replies: [] };
    const pendingTopic = Promise.withResolvers<TopicDetail>();
    const getTopic = jest.fn(() => pendingTopic.promise);
    const readerData = createEmptyReaderData();
    let currentScreen: 'feed' | 'topic' = 'feed';
    const hook = await renderHook(() => {
      const session = useTopicSessionController({
        invalidateTopicActionRequests: jest.fn(),
        notify: jest.fn()
      });
      const controller = useTopicController({
        changeScreen: (screen) => { currentScreen = screen as typeof currentScreen; },
        commitReaderData: jest.fn(),
        getCurrentScreen: () => currentScreen,
        notify: jest.fn(),
        onNodeSeekTopicVerificationRequired: jest.fn(),
        pushTopicScreen: jest.fn(),
        readerData,
        readerDataRef: { current: readerData },
        reopenExistingTopicScreenRef: { current: false },
        screen: currentScreen,
        showLinuxDoVerification: jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
        showYaohuoLogin: jest.fn(),
        sourceGateway: { getTopic } as unknown as SourceGateway,
        topicReturnScreenRef: { current: 'feed' },
        topicSession: session
      });
      return { controller, session };
    });

    let outcome: string | undefined;
    await act(async () => {
      void hook.result.current.controller.openTopic(v2exTopic).then((value) => { outcome = value; });
    });
    await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(1));
    expect(hook.result.current.session.state.topicBusy).toBe(true);

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient, 'session-updated');
    });
    expect(hook.result.current.session.state.topicBusy).toBe(true);

    await act(async () => {
      pendingTopic.resolve(v2exDetail);
      await pendingTopic.promise;
    });
    await waitFor(() => expect(outcome).toBe('completed'));
    expect(hook.result.current.session.state.topicDetail).toEqual(v2exDetail);
    expect(hook.result.current.session.state.topicBusy).toBe(false);
  });

  it('clears only the active source presentation when that credential session changes', async () => {
    const hook = await renderHook(() => useTopicSessionController({
      invalidateTopicActionRequests: jest.fn(),
      notify: jest.fn()
    }));

    await act(() => {
      hook.result.current.commands.topic.beginLoad(topic, 'yaohuo:42');
      hook.result.current.commands.topic.resolveLoad(topic, 0);
      hook.result.current.commands.topic.finishLoad();
    });
    await act(() => hook.result.current.commands.topic.invalidateSource('nodeseek'));
    expect(hook.result.current.state.topicDetail).toMatchObject({ source: 'yaohuo', id: '42' });

    await act(() => hook.result.current.commands.topic.invalidateSource('yaohuo'));

    expect(hook.result.current.state.selectedTopic).toMatchObject({ source: 'yaohuo', id: '42' });
    expect(hook.result.current.state.topicDetail).toBeNull();
    expect(hook.result.current.state.topicReplies).toEqual([]);
    expect(hook.result.current.state.topicBusy).toBe(false);
    expect(hook.result.current.state.topicError?.message).toContain('会话已变化');
  });

  it('REG-LINUXDO-002 preserves the topic across session reset before resuming reply pagination', async () => {
    const firstReply = {
      author: 'bob',
      contentHtml: '<p>第一页回复</p>',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 1,
      commentId: 11
    };
    const secondReply = {
      ...firstReply,
      author: 'carol',
      contentHtml: '<p>第二页回复</p>',
      floor: 2,
      commentId: 12
    };
    const linuxDoTopic: TopicDetail = {
      source: 'linuxdo',
      id: '42',
      title: 'linux.do 主题',
      author: 'alice',
      url: 'https://linux.do/t/42',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 2,
      contentHtml: '<p>正文</p>',
      replies: [firstReply],
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 1
    };
    let replyPageAttempts = 0;
    const getReplies = jest.fn(async () => {
      replyPageAttempts += 1;
      if (replyPageAttempts === 1) {
        throw new LinuxDoCloudflareError();
      }
      return {
        items: [secondReply],
        hasMore: false,
        nextPage: null,
        nextOffset: null,
        totalCount: 2
      };
    });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const readerData = createEmptyReaderData();
    let currentScreen: 'feed' | 'topic' = 'feed';
    const notify = jest.fn();
    const invalidateTopicActionRequests = jest.fn();
    const hook = await renderHook(() => {
      const session = useTopicSessionController({ invalidateTopicActionRequests, notify });
      const controller = useTopicController({
        changeScreen: (screen) => { currentScreen = screen as typeof currentScreen; },
        commitReaderData: jest.fn(),
        getCurrentScreen: () => currentScreen,
        notify,
        onNodeSeekTopicVerificationRequired: jest.fn(),
        pushTopicScreen: jest.fn(),
        readerData,
        readerDataRef: { current: readerData },
        reopenExistingTopicScreenRef: { current: false },
        screen: currentScreen,
        showLinuxDoVerification,
        showYaohuoLogin: jest.fn(),
        sourceGateway: {
          getTopic: jest.fn(async () => linuxDoTopic),
          getReplies
        } as unknown as SourceGateway,
        topicReturnScreenRef: { current: 'feed' },
        topicSession: session
      });
      return { controller, session };
    });

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxDoTopic);
    });
    await waitFor(() => expect(hook.result.current.session.state.replyNextPage).toBe(2));
    await act(async () => {
      await hook.result.current.controller.loadMoreReplies();
    });
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;
    expect(recovery).toBeDefined();

    await act(async () => {
      resetForumSourceQueries('linuxdo', appQueryClient, 'session-updated', recovery.key);
    });

    expect(hook.result.current.session.state.topicDetail).toMatchObject({ source: 'linuxdo', id: '42' });
    expect(hook.result.current.session.state.topicReplies).toEqual([firstReply]);
    expect(hook.result.current.session.state.replyHasMore).toBe(true);
    expect(hook.result.current.session.state.replyNextPage).toBe(2);

    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(getReplies).toHaveBeenCalledTimes(2);
    expect(hook.result.current.session.state.topicReplies).toEqual([firstReply, secondReply]);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('REG-LINUXDO-002 preserves the topic across session reset before resuming a quoted post', async () => {
    const linuxDoTopic: TopicDetail = {
      source: 'linuxdo',
      id: '42',
      title: 'linux.do 主题',
      author: 'alice',
      url: 'https://linux.do/t/42',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0,
      contentHtml: '<p>正文</p>',
      replies: []
    };
    const quotedReply = {
      author: 'quoted-author',
      contentHtml: '<p>引用正文</p>',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 7,
      commentId: 77
    };
    let quotedReplyAttempts = 0;
    const getReply = jest.fn(async () => {
      quotedReplyAttempts += 1;
      if (quotedReplyAttempts === 1) {
        throw new LinuxDoCloudflareError();
      }
      return quotedReply;
    });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const readerData = createEmptyReaderData();
    let currentScreen: 'feed' | 'topic' = 'feed';
    const notify = jest.fn();
    const invalidateTopicActionRequests = jest.fn();
    const hook = await renderHook(() => {
      const session = useTopicSessionController({ invalidateTopicActionRequests, notify });
      const controller = useTopicController({
        changeScreen: (screen) => { currentScreen = screen as typeof currentScreen; },
        commitReaderData: jest.fn(),
        getCurrentScreen: () => currentScreen,
        notify,
        onNodeSeekTopicVerificationRequired: jest.fn(),
        pushTopicScreen: jest.fn(),
        readerData,
        readerDataRef: { current: readerData },
        reopenExistingTopicScreenRef: { current: false },
        screen: currentScreen,
        showLinuxDoVerification,
        showYaohuoLogin: jest.fn(),
        sourceGateway: {
          getTopic: jest.fn(async () => linuxDoTopic),
          getReply
        } as unknown as SourceGateway,
        topicReturnScreenRef: { current: 'feed' },
        topicSession: session
      });
      return { controller, session };
    });
    const options = {
      instanceKey: 'quote-instance',
      reference: { source: 'linuxdo' as const, topicId: '99', postNumber: 7 }
    };

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxDoTopic);
    });
    await waitFor(() => expect(hook.result.current.session.state.topicDetail).toMatchObject({ id: '42' }));
    await act(async () => {
      await hook.result.current.controller.toggleTopicBodyQuote(options);
    });
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;
    expect(recovery).toBeDefined();

    await act(async () => {
      resetForumSourceQueries('linuxdo', appQueryClient, 'session-updated', recovery.key);
    });

    expect(hook.result.current.session.state.topicDetail).toMatchObject({ source: 'linuxdo', id: '42' });

    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(getReply).toHaveBeenCalledTimes(2);
    expect(hook.result.current.session.state.loadedQuotedReplies['linuxdo:99:7']).toEqual(quotedReply);
    expect(hook.result.current.session.state.expandedQuotes['quote-instance']).toBe(true);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-008] applies a lower authoritative reply total after submission', async () => {
    const detail: TopicDetail = {
      ...topic,
      source: 'xiaoyinsi',
      id: '84',
      url: 'https://forum.xiaoyinsi.com/t/topic/84',
      replyCount: 100
    };
    const hook = await renderHook(() => useTopicSessionController({
      invalidateTopicActionRequests: jest.fn(),
      notify: jest.fn()
    }));

    await act(() => {
      hook.result.current.commands.topic.beginLoad(detail, 'xiaoyinsi:84');
      hook.result.current.commands.topic.resolveLoad(detail, 0);
      hook.result.current.commands.topic.finishLoad();
    });
    await act(() => hook.result.current.commands.replies.resolve({
      replies: [],
      replyCount: 7,
      requestTopicKey: 'xiaoyinsi:84'
    }));

    expect(hook.result.current.state.topicDetail?.replyCount).toBe(7);
    expect(hook.result.current.state.selectedTopic?.replyCount).toBe(7);
  });

  it('[REG-WRITE-006] keeps an action completed while reading settings is open when restoring the Topic route', async () => {
    const hook = await renderHook(() => useTopicSessionController({
      invalidateTopicActionRequests: jest.fn(),
      notify: jest.fn()
    }));

    await act(() => {
      hook.result.current.commands.navigation.activateRoute('Topic-route');
      hook.result.current.commands.topic.beginLoad(topic, 'yaohuo:42');
      hook.result.current.commands.topic.resolveLoad(topic, 0);
      hook.result.current.commands.topic.finishLoad();
    });
    await act(() => hook.result.current.commands.navigation.saveRoute('Topic-route'));
    await act(() => hook.result.current.commands.actions.applyUpdate({
      type: 'bookmark',
      bookmarked: true,
      bookmarkId: 99
    }));

    expect(hook.result.current.state.topicDetail).toMatchObject({ bookmarked: true, bookmarkId: 99 });

    await act(() => hook.result.current.commands.navigation.restoreRoute('Topic-route'));

    expect(hook.result.current.state.topicDetail).toMatchObject({ bookmarked: true, bookmarkId: 99 });
  });

  it('[REG-WRITE-007] keeps the authoritative NodeSeek poll snapshot when restoring the Topic route', async () => {
    const nodeSeekTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      id: '759903',
      url: 'https://www.nodeseek.com/post-759903-1',
      polls: [{
        id: '2443',
        voted: false,
        options: [
          { id: '71', label: '选项 A' },
          { id: '72', label: '选项 B' }
        ]
      }]
    };
    const confirmedPoll = {
      id: '2443',
      voted: true,
      options: [
        { id: '71', label: '选项 A', count: 2, selected: false },
        { id: '72', label: '选项 B', count: 6, selected: true }
      ]
    };
    const hook = await renderHook(() => useTopicSessionController({
      invalidateTopicActionRequests: jest.fn(),
      notify: jest.fn()
    }));

    await act(() => {
      hook.result.current.commands.navigation.activateRoute('NodeSeek-route');
      hook.result.current.commands.topic.beginLoad(nodeSeekTopic, 'nodeseek:759903');
      hook.result.current.commands.topic.resolveLoad(nodeSeekTopic, 0);
      hook.result.current.commands.topic.finishLoad();
    });
    await act(() => hook.result.current.commands.navigation.saveRoute('NodeSeek-route'));
    await act(() => hook.result.current.commands.actions.applyUpdate({
      type: 'poll-vote',
      patch: {
        pollId: '2443',
        optionIds: ['72'],
        confirmedPoll
      }
    }));

    expect(hook.result.current.state.topicDetail?.polls?.[0]).toEqual(confirmedPoll);

    await act(() => hook.result.current.commands.navigation.restoreRoute('NodeSeek-route'));

    expect(hook.result.current.state.topicDetail?.polls?.[0]).toEqual(confirmedPoll);
  });
});
