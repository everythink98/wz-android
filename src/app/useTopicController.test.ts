import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useLayoutEffect: (effect: () => void) => effect(),
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value })
}));

import { replyCountAfterNewReplySubmit } from '../androidFeatureHelpers';
import { LinuxDoCloudflareError } from '../cloudflareChallenge';
import { setDiagnosticWriter } from '../diagnostics';
import { createEmptyReaderData } from '../readerData';
import { annotateSourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import type { SourceGateway } from '../sources/sourceGateway';
import type { Topic, TopicDetail } from '../types';
import { siteSessionEventInvalidatesForumQueries } from './sessionControllerHelpers';
import { useTopicController } from './useTopicController';
import type { LinuxDoReadRecovery } from './useVerificationController';
import { appQueryClient, forumQueryKeys, resetForumSourceQueries } from './serverState';
import { REQUEST_CANCELED_MESSAGE } from '../request';

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
  const topicQuotes = {
    changeExpanded: vi.fn((key: string, expanded: boolean) => {
      if (expanded) expandedQuotes.add(key);
      else expandedQuotes.delete(key);
    }),
    changeLoading: vi.fn(),
    getLoaded: vi.fn((key: string) => loadedQuotes.get(key)),
    isExpanded: vi.fn((key: string) => expandedQuotes.has(key)),
    remember: vi.fn((key: string, reply: TopicDetail['replies'][number]) => { loadedQuotes.set(key, reply); })
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
    getCurrentScreen: () => 'topic',
    screen: 'topic',
    showLinuxDoVerification,
    showYaohuoLogin: vi.fn(),
    sourceGateway,
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
  return { controller, showLinuxDoVerification, topicCommands, topicQuotes, topicReplyCommands };
}

describe('topic controller helpers', () => {
  afterEach(() => {
    appQueryClient.clear();
    setDiagnosticWriter(null);
  });

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

  it('[REG-XIAOYINSI-008] applies the authoritative 小隐寺 reply total during a manual reply refresh', async () => {
    const detail: TopicDetail = {
      source: 'xiaoyinsi',
      id: '43',
      title: 'Topic',
      author: 'alice',
      url: 'https://forum.xiaoyinsi.com/t/topic/43',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 100,
      contentHtml: '<p>body</p>',
      replies: []
    };
    const { controller, topicReplyCommands } = createLinuxDoTopicController({
      detail,
      sourceGateway: {
        getReplies: vi.fn(async () => ({ items: [], hasMore: false, nextPage: null, totalCount: 7 }))
      } as unknown as SourceGateway
    });

    await controller.refreshTopicReplies({ nocache: true });

    expect(topicReplyCommands.resolve).toHaveBeenCalledWith(expect.objectContaining({
      replyCount: 7,
      requestTopicKey: 'xiaoyinsi:43'
    }));
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
      getCurrentScreen: () => currentScreen,
      screen: 'feed',
      showLinuxDoVerification,
      showYaohuoLogin: vi.fn(),
      sourceGateway: { getTopic } as unknown as SourceGateway,
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
    await expect(recovery.resume()).resolves.toBe('verification-required');
    expect(recovery.isCurrent()).toBe(true);
    await expect(recovery.resume()).resolves.toBe('completed');
    expect(getTopic).toHaveBeenCalledTimes(3);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('REG-TOPIC-022 keeps a topic request alive when credential loading only observes the stored cookie', async () => {
    const topic: Topic = {
      source: 'nodeseek',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://www.nodeseek.com/post-42-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const detail: TopicDetail = { ...topic, contentHtml: '<p>body</p>', replies: [] };
    let currentScreen: 'feed' | 'topic' = 'feed';
    let currentKey: string | null = null;
    const topicCommands = {
      beginLoad: vi.fn(() => { currentKey = 'nodeseek:42'; }),
      beginRefresh: vi.fn(),
      failLoad: vi.fn(),
      finishLoad: vi.fn(),
      getCurrentKey: vi.fn(() => currentKey),
      resolveLoad: vi.fn(),
      reuse: vi.fn()
    };
    const readerData = createEmptyReaderData();
    const getTopic = vi.fn(async () => {
      const credentialObservation = {
        type: 'cookie-loaded' as const,
        cookieSummary: ['session'],
        hasVerification: true,
        loggedIn: true
      };
      if (siteSessionEventInvalidatesForumQueries(credentialObservation)) {
        resetForumSourceQueries('nodeseek');
        await Promise.resolve();
      }
      return detail;
    });
    const controller = useTopicController({
      changeScreen: vi.fn((screen) => { currentScreen = screen as typeof currentScreen; }),
      commitReaderData: vi.fn(),
      notify: vi.fn(),
      onNodeSeekTopicVerificationRequired: vi.fn(),
      pushTopicScreen: vi.fn(),
      readerData,
      readerDataRef: { current: readerData },
      reopenExistingTopicScreenRef: { current: false },
      getCurrentScreen: () => currentScreen,
      screen: 'feed',
      showLinuxDoVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway: { getTopic } as unknown as SourceGateway,
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

    await expect(controller.openTopic(topic)).resolves.toBe('completed');
    expect(topicCommands.resolveLoad).toHaveBeenCalledWith(detail, 0);
  });

  it('REG-TOPIC-022 settles the active loading state when a real session transition cancels its query', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://yaohuo.me/bbs/book_view.aspx?id=42',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    let currentKey: string | null = null;
    const topicCommands = {
      beginLoad: vi.fn(() => { currentKey = 'yaohuo:42'; }),
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
      getCurrentScreen: () => 'feed',
      screen: 'feed',
      showLinuxDoVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway: {
        getTopic: vi.fn(async () => {
          resetForumSourceQueries('yaohuo', appQueryClient, 'login-expired');
          await Promise.resolve();
          throw Object.assign(new Error('登录已失效'), { kind: 'login-expired' });
        })
      } as unknown as SourceGateway,
      topicReturnScreenRef: { current: 'feed' },
      topicSession: {
        state: { replyNextOffset: null, replyNextPage: null, selectedTopic: null, topicDetail: null, topicReplies: [] },
        commands: {
          navigation: { clearBackStack: vi.fn(), pushBackStack: vi.fn() },
          quotes: {},
          replies: {},
          topic: topicCommands
        },
        snapshot: vi.fn()
      } as never
    });

    await expect(controller.openTopic(topic)).resolves.toBe('stale');

    expect(topicCommands.finishLoad).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent opens for the same topic while only the latest caller applies the result', async () => {
    const topic: Topic = {
      source: 'nodeseek',
      id: '84',
      title: 'Topic',
      author: 'alice',
      url: 'https://www.nodeseek.com/post-84-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const detail: TopicDetail = { ...topic, contentHtml: '<p>body</p>', replies: [] };
    const pending = Promise.withResolvers<void>();
    const getTopic = vi.fn(async (_options, context) => {
      await pending.promise;
      if (context?.isCurrent?.() === false) {
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      return detail;
    });
    let currentKey: string | null = null;
    const topicCommands = {
      beginLoad: vi.fn(() => { currentKey = 'nodeseek:84'; }),
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
      getCurrentScreen: () => 'feed',
      screen: 'feed',
      showLinuxDoVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway: { getTopic } as unknown as SourceGateway,
      topicReturnScreenRef: { current: 'feed' },
      topicSession: {
        state: { replyNextOffset: null, replyNextPage: null, selectedTopic: null, topicDetail: null, topicReplies: [] },
        commands: {
          navigation: { clearBackStack: vi.fn(), pushBackStack: vi.fn() },
          quotes: {},
          replies: {},
          topic: topicCommands
        },
        snapshot: vi.fn()
      } as never
    });

    const first = controller.openTopic(topic);
    await vi.waitFor(() => expect(getTopic).toHaveBeenCalledTimes(1));
    const second = controller.openTopic(topic);
    pending.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual(['stale', 'completed']);
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(topicCommands.resolveLoad).toHaveBeenCalledTimes(1);
  });

  it('keeps a valid next reply page reachable when that page is already cached but not displayed', async () => {
    const detail: TopicDetail = {
      source: 'linuxdo',
      id: 'cached-page',
      title: 'Topic',
      author: 'alice',
      url: 'https://linux.do/t/cached-page',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 1,
      contentHtml: '<p>body</p>',
      replies: []
    };
    appQueryClient.setQueryData(
      forumQueryKeys.replyPage('linuxdo', detail.id, 2, null),
      { items: [{ author: 'cached', contentHtml: '<p>cached</p>', createdAt: '', floor: 2 }], hasMore: false, nextPage: null }
    );
    const { controller, topicReplyCommands } = createLinuxDoTopicController({
      detail,
      sourceGateway: {
        getReplies: vi.fn(async () => ({ items: [], hasMore: true, nextPage: 2, nextOffset: null }))
      } as unknown as SourceGateway
    });

    await controller.refreshTopicReplies();

    expect(topicReplyCommands.resolve).toHaveBeenCalledWith(expect.objectContaining({
      hasMore: true,
      nextPage: 2
    }));
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
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockResolvedValueOnce({ items: [], hasMore: false, nextPage: null, nextOffset: null });
    const { controller, showLinuxDoVerification } = createLinuxDoTopicController({
      detail,
      sourceGateway: { getReplies } as unknown as SourceGateway
    });

    await expect(controller.refreshTopicReplies()).resolves.toBe('verification-required');
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    expect(recovery).toBeDefined();
    await expect(recovery!.resume()).resolves.toBe('verification-required');
    expect(recovery!.isCurrent()).toBe(true);
    await expect(recovery!.resume()).resolves.toBe('completed');
    expect(getReplies).toHaveBeenCalledTimes(3);
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

  it('[REG-TOPIC-005] does not report a failed V2EX comment refresh as successful', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const detail: TopicDetail = {
      source: 'v2ex',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://www.v2ex.com/t/42',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 1,
      contentHtml: '<p>body</p>',
      replies: []
    };
    const { controller } = createLinuxDoTopicController({
      detail,
      sourceGateway: {
        getTopic: vi.fn(async () => { throw new Error('V2EX refresh failed'); })
      } as unknown as SourceGateway
    });

    await controller.refreshTopicReplies();

    const terminal = lines
      .map((line) => JSON.parse(line))
      .find((event) => event.area === 'reply' && event.operation === 'refresh' && event.phase === 'finish');
    expect(terminal).toMatchObject({ outcome: 'failure' });
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
    await expect(recovery!.resume()).resolves.toBe('verification-required');
    expect(recovery!.isCurrent()).toBe(true);
    await expect(recovery!.resume()).resolves.toBe('completed');

    expect(getReplies).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 2, offset: 30 }), expect.any(Object));
    expect(getReplies).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, offset: 30 }), expect.any(Object));
    expect(getReplies).toHaveBeenNthCalledWith(3, expect.objectContaining({ page: 2, offset: 30 }), expect.any(Object));
    expect(topicReplyCommands.resolve).toHaveBeenCalledWith(expect.objectContaining({
      replies: [loadedReply, nextReply]
    }));
  });

  it('REG-TOPIC-007 deduplicates the same quoted-post transport while only the latest caller applies it', async () => {
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
    const currentReply: TopicDetail['replies'][number] = {
      author: 'current-author',
      contentHtml: '<p>current</p>',
      createdAt: '2026-07-18T00:01:00.000Z',
      floor: 7,
      commentId: 71
    };
    const request = Promise.withResolvers<TopicDetail['replies'][number]>();
    const getReply = vi.fn(() => request.promise);
    const { controller, topicQuotes } = createLinuxDoTopicController({
      detail,
      sourceGateway: { getReply } as unknown as SourceGateway
    });
    const options = {
      instanceKey: 'quote-instance',
      reference: { source: 'linuxdo' as const, topicId: '99', postNumber: 7 }
    };

    const staleOutcome = controller.toggleTopicBodyQuote(options);
    const currentOutcome = controller.toggleTopicBodyQuote(options);
    request.resolve(currentReply);

    await expect(staleOutcome).resolves.toBe('stale');
    await expect(currentOutcome).resolves.toBe('completed');
    expect(getReply).toHaveBeenCalledTimes(1);
    expect(topicQuotes.remember).toHaveBeenCalledTimes(1);
    expect(topicQuotes.remember).toHaveBeenCalledWith('linuxdo:99:7', currentReply);
    expect(topicQuotes.changeExpanded).toHaveBeenCalledWith('quote-instance', true);
  });

  it('REG-TOPIC-007 invalidates an old quoted-post verification recovery when a newer request takes ownership', async () => {
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
    const currentReply: TopicDetail['replies'][number] = {
      author: 'current-author',
      contentHtml: '<p>current</p>',
      createdAt: '2026-07-18T00:01:00.000Z',
      floor: 7,
      commentId: 71
    };
    let resolveCurrent!: (reply: TopicDetail['replies'][number]) => void;
    const currentRequest = new Promise<TopicDetail['replies'][number]>((resolve) => { resolveCurrent = resolve; });
    const getReply = vi.fn()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockReturnValueOnce(currentRequest);
    const { controller, showLinuxDoVerification } = createLinuxDoTopicController({
      detail,
      sourceGateway: { getReply } as unknown as SourceGateway
    });
    const options = {
      instanceKey: 'quote-instance',
      reference: { source: 'linuxdo' as const, topicId: '99', postNumber: 7 }
    };

    await expect(controller.toggleTopicBodyQuote(options)).resolves.toBe('verification-required');
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery?.isCurrent()).toBe(true);

    const currentOutcome = controller.toggleTopicBodyQuote(options);
    expect(recovery?.isCurrent()).toBe(false);

    resolveCurrent(currentReply);
    await expect(currentOutcome).resolves.toBe('completed');
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

  it('REG-LINUXDO-003 reports an ordinary quoted-post recovery failure instead of guessing success', async () => {
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
      .mockRejectedValueOnce(new Error('引用恢复网络失败'));
    const { controller, showLinuxDoVerification } = createLinuxDoTopicController({
      detail,
      sourceGateway: { getReply } as unknown as SourceGateway
    });

    await controller.toggleTopicBodyQuote({
      instanceKey: 'quote-instance',
      reference: { source: 'linuxdo', topicId: '99', postNumber: 7 }
    });
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    await expect(recovery!.resume()).resolves.toBe('failed');
  });

  it('REG-SOURCE-002 does not apply a topic detail whose candidates all failed to parse', async () => {
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
    const parsedEmpty = annotateSourceDiagnosticSummary({
      ...detail,
      title: '',
      author: '',
      contentHtml: '',
      replies: []
    }, {
      parserVariant: 'html-topic',
      candidateCount: 1,
      validCount: 0,
      droppedCount: 1,
      isExpectedEmpty: false
    });
    const { controller, topicCommands } = createLinuxDoTopicController({
      detail,
      sourceGateway: { getTopic: vi.fn(async () => parsedEmpty) } as unknown as SourceGateway
    });

    await expect(controller.openTopic(detail, true)).resolves.toBe('failed');
    expect(topicCommands.resolveLoad).not.toHaveBeenCalled();
    expect(topicCommands.failLoad).toHaveBeenCalled();
  });
});
