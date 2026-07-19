import { describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value })
}));

import { replyCountAfterNewReplySubmit } from '../androidFeatureHelpers';
import { LinuxDoCloudflareError } from '../cloudflareChallenge';
import { createEmptyReaderData } from '../readerData';
import type { SourceGateway } from '../sources/sourceGateway';
import type { Topic, TopicDetail } from '../types';
import { useTopicController } from './useTopicController';
import type { LinuxDoReadRecovery } from './useVerificationController';

type ShowLinuxDoVerificationMock = ReturnType<typeof vi.fn<(
  message?: string,
  recovery?: LinuxDoReadRecovery
) => void>>;

function createLinuxDoTopicController({
  detail,
  replyNextOffset = null,
  replyNextPage = null,
  showLinuxDoVerification = vi.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
  sourceGateway,
  topicReplies = detail.replies
}: {
  detail: TopicDetail;
  replyNextOffset?: number | null;
  replyNextPage?: number | null;
  showLinuxDoVerification?: ShowLinuxDoVerificationMock;
  sourceGateway: SourceGateway;
  topicReplies?: TopicDetail['replies'];
}) {
  const currentKey = `${detail.source}:${detail.id}`;
  const expandedQuotes = new Set<string>();
  const loadedQuotes = new Map<string, TopicDetail['replies'][number]>();
  const quoteRequests = new Map<string, AbortController>();
  const topicQuotes = {
    changeExpanded: vi.fn((key: string, expanded: boolean) => {
      if (expanded) expandedQuotes.add(key);
      else expandedQuotes.delete(key);
    }),
    changeLoading: vi.fn(),
    clearRequest: vi.fn((key: string, controller: AbortController) => {
      if (quoteRequests.get(key) === controller) quoteRequests.delete(key);
    }),
    getLoaded: vi.fn((key: string) => loadedQuotes.get(key)),
    isExpanded: vi.fn((key: string) => expandedQuotes.has(key)),
    isRequest: vi.fn((key: string, controller: AbortController) => quoteRequests.get(key) === controller),
    remember: vi.fn((key: string, reply: TopicDetail['replies'][number]) => { loadedQuotes.set(key, reply); }),
    replaceRequest: vi.fn((key: string, controller: AbortController) => { quoteRequests.set(key, controller); })
  };
  const topicReplyCommands = {
    beginLoad: vi.fn(),
    finishLoad: vi.fn(),
    getCurrent: vi.fn(() => topicReplies),
    isLoading: vi.fn(() => false),
    resolve: vi.fn()
  };
  const topicCommands = {
    beginLoad: vi.fn(),
    beginRefresh: vi.fn(),
    failLoad: vi.fn(),
    finishLoad: vi.fn(),
    getCurrentKey: vi.fn(() => currentKey),
    resolveLoad: vi.fn(),
    reuse: vi.fn()
  };
  const readerData = createEmptyReaderData();
  const controller = useTopicController({
    changeScreen: vi.fn(),
    commitReaderData: vi.fn(),
    notify: vi.fn(),
    onNodeSeekTopicVerificationRequired: vi.fn(),
    pushTopicScreen: vi.fn(),
    readerData,
    readerDataRef: { current: readerData },
    reopenExistingTopicScreenRef: { current: false },
    repliesAbortRef: { current: null },
    repliesRequestIdRef: { current: 0 },
    getCurrentScreen: () => 'topic',
    screen: 'topic',
    showLinuxDoVerification,
    showYaohuoLogin: vi.fn(),
    sourceGateway,
    topicAbortRef: { current: null },
    topicRequestIdRef: { current: 0 },
    topicReturnScreenRef: { current: 'feed' },
    topicSession: {
      state: {
        replyNextOffset,
        replyNextPage,
        selectedTopic: detail,
        topicDetail: detail,
        topicReplies
      },
      commands: {
        navigation: { clearBackStack: vi.fn(), pushBackStack: vi.fn() },
        quotes: topicQuotes,
        replies: topicReplyCommands,
        topic: topicCommands
      },
      snapshot: vi.fn()
    } as never
  });
  return { controller, showLinuxDoVerification, topicQuotes, topicReplyCommands };
}

describe('topic controller helpers', () => {
  it('increments visible reply count after a new reply submit', () => {
    expect(replyCountAfterNewReplySubmit(0, 1)).toBe(1);
    expect(replyCountAfterNewReplySubmit(100, 30)).toBe(101);
    expect(replyCountAfterNewReplySubmit(1, 3)).toBe(3);
  });

  it('[REG-XIAOYINSI-008] uses the authoritative 小隐寺 reply total after submitting instead of guessing old count plus one', async () => {
    const detail: TopicDetail = {
      source: 'xiaoyinsi',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://forum.xiaoyinsi.com/t/topic/42',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 100,
      contentHtml: '<p>body</p>',
      replies: []
    };
    const reply = { author: 'bob', contentHtml: '<p>new</p>', createdAt: '2026-07-18T00:01:00.000Z', floor: 8 };
    const { controller, topicReplyCommands } = createLinuxDoTopicController({
      detail,
      sourceGateway: {
        getReplies: vi.fn(async () => ({ items: [reply], hasMore: false, nextPage: null, totalCount: 7 }))
      } as unknown as SourceGateway
    });

    await controller.refreshTopicReplies({ afterSubmit: true, nocache: true });

    expect(topicReplyCommands.resolve).toHaveBeenCalledWith(expect.objectContaining({ replyCount: 7 }));
  });

  it('REG-LINUXDO-002 resumes a blocked topic in place without a close-and-reopen navigation', async () => {
    const topic: Topic = {
      source: 'linuxdo',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://linux.do/t/42',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 0
    };
    const detail: TopicDetail = { ...topic, contentHtml: '<p>body</p>', replies: [] };
    const getTopic = vi.fn()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockResolvedValueOnce(detail);
    const showLinuxDoVerification = vi.fn();
    let currentScreen: 'feed' | 'topic' = 'feed';
    let currentKey: string | null = null;
    const topicCommands = {
      beginLoad: vi.fn(() => { currentKey = 'linuxdo:42'; }),
      failLoad: vi.fn(),
      finishLoad: vi.fn(),
      getCurrentKey: vi.fn(() => currentKey),
      resolveLoad: vi.fn(),
      reuse: vi.fn()
    };
    const readerData = createEmptyReaderData();
    const controller = useTopicController({
      changeScreen: vi.fn((screen) => { currentScreen = screen as typeof currentScreen; }),
      commitReaderData: vi.fn(),
      notify: vi.fn(),
      onNodeSeekTopicVerificationRequired: vi.fn(),
      pushTopicScreen: vi.fn(),
      readerData,
      readerDataRef: { current: readerData },
      reopenExistingTopicScreenRef: { current: false },
      repliesAbortRef: { current: null },
      repliesRequestIdRef: { current: 0 },
      getCurrentScreen: () => currentScreen,
      screen: 'feed',
      showLinuxDoVerification,
      showYaohuoLogin: vi.fn(),
      sourceGateway: { getTopic } as unknown as SourceGateway,
      topicAbortRef: { current: null },
      topicRequestIdRef: { current: 0 },
      topicReturnScreenRef: { current: 'feed' },
      topicSession: {
        state: {
          replyNextOffset: null,
          replyNextPage: null,
          selectedTopic: null,
          topicDetail: null,
          topicReplies: []
        },
        commands: {
          navigation: { clearBackStack: vi.fn(), pushBackStack: vi.fn() },
          quotes: {},
          replies: {},
          topic: topicCommands
        },
        snapshot: vi.fn()
      } as never
    });

    await expect(controller.openTopic(topic)).resolves.toBe('verification-required');

    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery).toMatchObject({ key: expect.stringContaining('topic:linuxdo:42') });
    await expect(recovery.resume()).resolves.toBe('completed');
    expect(getTopic).toHaveBeenCalledTimes(2);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('REG-LINUXDO-002 reports a resumed reply refresh as completed instead of stale', async () => {
    const detail: TopicDetail = {
      source: 'linuxdo',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://linux.do/t/42',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 0,
      contentHtml: '<p>body</p>',
      replies: []
    };
    const getReplies = vi.fn()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockResolvedValueOnce({ items: [], hasMore: false, nextPage: null, nextOffset: null });
    const { controller, showLinuxDoVerification } = createLinuxDoTopicController({
      detail,
      sourceGateway: { getReplies } as unknown as SourceGateway
    });

    await expect(controller.refreshTopicReplies()).resolves.toBe('verification-required');
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    expect(recovery).toBeDefined();
    await expect(recovery!.resume()).resolves.toBe('completed');
    expect(getReplies).toHaveBeenCalledTimes(2);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a failed authoritative whole-topic refresh from a completed request', async () => {
    const detail: TopicDetail = {
      source: 'xiaoyinsi',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://forum.xiaoyinsi.com/t/topic/42',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 0,
      contentHtml: '<p>body</p>',
      replies: []
    };
    const failed = createLinuxDoTopicController({
      detail,
      sourceGateway: { getTopic: vi.fn(async () => { throw new Error('network failed'); }) } as unknown as SourceGateway
    });
    const completed = createLinuxDoTopicController({
      detail,
      sourceGateway: { getTopic: vi.fn(async () => detail) } as unknown as SourceGateway
    });

    await expect(failed.controller.refreshWholeTopic()).resolves.toBe('failed');
    await expect(completed.controller.refreshWholeTopic()).resolves.toBe('completed');
  });

  it('REG-LINUXDO-002 retries the exact failed Topic reply page without discarding loaded replies', async () => {
    const loadedReply = {
      author: 'alice',
      contentHtml: '<p>loaded</p>',
      createdAt: '2026-07-18T00:01:00.000Z',
      floor: 1,
      commentId: 1
    };
    const nextReply = {
      author: 'bob',
      contentHtml: '<p>next</p>',
      createdAt: '2026-07-18T00:02:00.000Z',
      floor: 2,
      commentId: 2
    };
    const detail: TopicDetail = {
      source: 'linuxdo',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://linux.do/t/42',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 2,
      contentHtml: '<p>body</p>',
      replies: [loadedReply]
    };
    const getReplies = vi.fn()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockResolvedValueOnce({ items: [nextReply], hasMore: false, nextPage: null, nextOffset: null });
    const { controller, showLinuxDoVerification, topicReplyCommands } = createLinuxDoTopicController({
      detail,
      replyNextOffset: 30,
      replyNextPage: 2,
      sourceGateway: { getReplies } as unknown as SourceGateway,
      topicReplies: [loadedReply]
    });

    await expect(controller.loadMoreReplies()).resolves.toBe('verification-required');
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery).toBeDefined();
    await expect(recovery!.resume()).resolves.toBe('completed');

    expect(getReplies).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 2, offset: 30 }), expect.any(Object));
    expect(getReplies).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, offset: 30 }), expect.any(Object));
    expect(topicReplyCommands.resolve).toHaveBeenCalledWith(expect.objectContaining({
      replies: [loadedReply, nextReply]
    }));
  });

  it('REG-LINUXDO-002 resumes the exact quoted linux.do post through the visible verification flow', async () => {
    const detail: TopicDetail = {
      source: 'linuxdo',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://linux.do/t/42',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 0,
      contentHtml: '<p>body</p>',
      replies: []
    };
    const quotedReply = {
      author: 'quoted-author',
      contentHtml: '<p>quoted</p>',
      createdAt: '2026-07-18T00:01:00.000Z',
      floor: 7,
      commentId: 77
    };
    const getReply = vi.fn()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockResolvedValueOnce(quotedReply);
    const { controller, showLinuxDoVerification, topicQuotes } = createLinuxDoTopicController({
      detail,
      sourceGateway: { getReply } as unknown as SourceGateway
    });
    const options = {
      instanceKey: 'quote-instance',
      reference: { source: 'linuxdo' as const, topicId: '99', postNumber: 7 }
    };

    await controller.toggleTopicBodyQuote(options);
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery).toMatchObject({ key: expect.stringContaining('topic-quote:linuxdo:42:linuxdo:99:7') });
    await expect(recovery!.resume()).resolves.toBe('completed');

    expect(getReply).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: 'linuxdo', id: '99', floor: 7
    }), expect.any(Object));
    expect(getReply).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: 'linuxdo', id: '99', floor: 7
    }), expect.any(Object));
    expect(topicQuotes.remember).toHaveBeenCalledWith('linuxdo:99:7', quotedReply);
    expect(topicQuotes.changeExpanded).toHaveBeenCalledWith('quote-instance', true);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('REG-LINUXDO-002 keeps a quoted-post recovery in the same panel when verification still fails', async () => {
    const detail: TopicDetail = {
      source: 'linuxdo',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://linux.do/t/42',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 0,
      contentHtml: '<p>body</p>',
      replies: []
    };
    const getReply = vi.fn()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new LinuxDoCloudflareError());
    const { controller, showLinuxDoVerification, topicQuotes } = createLinuxDoTopicController({
      detail,
      sourceGateway: { getReply } as unknown as SourceGateway
    });

    await controller.toggleTopicBodyQuote({
      instanceKey: 'quote-instance',
      reference: { source: 'linuxdo', topicId: '99', postNumber: 7 }
    });
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    expect(recovery).toBeDefined();
    await expect(recovery!.resume()).resolves.toBe('verification-required');
    expect(getReply).toHaveBeenCalledTimes(2);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    expect(topicQuotes.remember).not.toHaveBeenCalled();
    expect(topicQuotes.changeExpanded).not.toHaveBeenCalled();
  });
});
