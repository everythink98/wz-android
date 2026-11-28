jest.mock('@/platform/storage/readerDataStore', () => ({
  readHistoryReplyBaseline: jest.fn(async () => undefined)
}));
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type ComponentProps, useMemo } from 'react';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import type { LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { beginDiagnosticTrace, setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { type DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import type { ReadGateway } from '@/sources/readGateway';
import { resolveForumReadPlan } from '@/domain/forum/readPlan';
import type { RepliesResponse, Reply, TopicLocationTarget, Source, Topic, TopicDetail } from '@/domain/forum/models';
import { createSessionReadPlan } from '../sessionReadPlan';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { prepareReplyContent, requirePreparedForumContent } from '@/domain/forum/topicContentSplit';
import { createDiscourseReadingRuntime } from '@/platform/query/discourseReadingRuntime';
import { getNodeSeekReplies } from '@/sources/nodeseek/reader';
import { readHistoryReplyBaseline } from '@/platform/storage/readerDataStore';
import { withAbortableTimeout } from '@/platform/network/request';
import { MemoizedReplyItem } from '@/features/topic/components/ReplyItem';
import { createTopicStyles } from '@/features/topic/styles';
import { resolveReaderStyleSettings, createTheme } from '@/ui/theme/tokens';
import { render } from '../render';

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
type NodeSeekHandoff = 'closed' | 'open' | 'resuming';

function nodeSeekHandoffPlan(handoff: () => NodeSeekHandoff): ReadGateway['getReadPlan'] {
  return (source, operation) =>
    resolveForumReadPlan(source, operation, true, {
      source: 'nodeseek',
      authenticated: true,
      authSurfaceOpen: handoff() !== 'closed',
      identityKey: 'nodeseek:fixture',
      identityTrust: 'confirmed',
      sessionEpoch: 0,
      sourceEnabled: true,
      ...(handoff() === 'resuming' ? { foregroundReadDuringHandoff: true } : {})
    });
}

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

  it.each(['close', 'stale', 'save'] as const)(
    'keeps a new reply draft separate when an edit ends by %s',
    async (end) => {
      const hook = await renderNativeHook(() => useTopicSessionController({ notify: jest.fn(), topic: firstTopic }));
      await act(() => hook.result.current.commands.composer.changeContent('unfinished new reply'));
      await act(() =>
        hook.result.current.commands.composer.editReply({
          commentId: 10,
          contentMarkdown: 'published reply',
          topicId: firstTopic.id,
          ticket: { source: 'nodeseek', identityKey: 'nodeseek:alice', sessionEpoch: 0 }
        })
      );
      expect(hook.result.current.state.replyContent).toBe('published reply');
      await act(() => hook.result.current.commands.composer.changeContent('edited text'));
      await act(() => {
        const composer = hook.result.current.commands.composer;
        if (end === 'close') composer.toggle(false);
        else if (end === 'stale') composer.detachEdit();
        else composer.completeSubmission(composer.getDraftRevision());
      });
      expect(hook.result.current.state.replyEditRecovery).toBe(end === 'stale' ? 'edited text' : null);
      await act(() => hook.result.current.commands.composer.toggle(true));
      expect(hook.result.current.state.replyContent).toBe('unfinished new reply');
      await hook.unmount();
    }
  );

  it.each(['same account', 'new account', 'new edit', 'timeout'] as const)(
    'keeps pending edit recovery with its original document (%s)',
    async (end) => {
      const notify = jest.fn();
      const hook = await renderNativeHook(
        ({ accountScope }: { accountScope: string }) =>
          useTopicSessionController({ accountScope, notify, topic: firstTopic }),
        { initialProps: { accountScope: 'alice:1' } }
      );
      const target = {
        commentId: 10,
        contentMarkdown: 'published',
        topicId: firstTopic.id,
        ticket: { source: 'nodeseek' as const, identityKey: 'alice', sessionEpoch: 1 }
      };
      await act(() => hook.result.current.commands.composer.editReply(target));
      const composer = hook.result.current.commands.composer;
      let finish!: (text: string) => void;
      let fail!: () => void;
      composer.editRecoveryRef.current = () =>
        new Promise<string>((resolve, reject) => {
          finish = resolve;
          fail = () => reject(new Error('timeout'));
        });
      await act(() => composer.detachEdit(target));
      if (end === 'new account') await hook.rerender({ accountScope: 'bob:2' });
      if (end === 'new edit') await act(() => composer.editReply({ ...target, commentId: 11 }));
      await act(() => (end === 'timeout' ? fail() : finish('last keystrokes')));
      expect(hook.result.current.state.replyEditRecovery).toBe(end === 'same account' ? 'last keystrokes' : null);
      if (end === 'timeout') {
        expect(hook.result.current.state.replyComposerIntent).toEqual({ kind: 'edit', target });
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('复制正文'));
      }
      await hook.unmount();
    }
  );

  it('drops the previous account draft and ignores its late editor updates on the same route', async () => {
    const notify = jest.fn();
    const hook = await renderNativeHook(
      ({ accountScope }: { accountScope: string }) =>
        useTopicSessionController({ accountScope, notify, topic: firstTopic }),
      { initialProps: { accountScope: 'alice:1' } }
    );
    const oldEditor = hook.result.current.commands.composer;
    await act(() => oldEditor.changeContent('first account draft'));
    await hook.rerender({ accountScope: 'bob:2' });
    await act(() => {
      hook.result.current.commands.composer.changeContent('second account draft');
      oldEditor.changeContent('late snapshot');
    });
    expect(hook.result.current.state.replyContent).toBe('second account draft');
    await hook.unmount();
  });

  it('keeps draft revision checks and uses the latest notification callback', async () => {
    const notify = jest.fn<(message: string) => void>();
    const nextNotify = jest.fn<(message: string) => void>();
    const hook = await renderNativeHook(
      ({ notify }: { notify: (message: string) => void }) => useTopicSessionController({ notify, topic: firstTopic }),
      { initialProps: { notify } }
    );
    const commands = hook.result.current.commands.composer;
    try {
      await act(async () => commands.changeContent('first draft'));
      const submittedRevision = commands.getDraftRevision();
      await act(async () => commands.changeContent('newer draft'));
      await act(async () => {
        expect(commands.completeSubmission(submittedRevision)).toBe(false);
      });
      expect(hook.result.current.state.replyContent).toBe('newer draft');
      expect(commands.getDraftRevision()).toBe(2);

      await hook.rerender({ notify: nextNotify });
      await act(async () => hook.result.current.commands.composer.replyToFloor({ ...firstReply, floor: undefined }));
      expect(nextNotify).toHaveBeenCalledWith('当前楼层信息不完整，刷新主题后再试。');
      expect(notify).not.toHaveBeenCalled();
      await act(async () => {
        expect(commands.completeSubmission(2)).toBe(true);
      });
      expect(hook.result.current.state.replyContent).toBe('');
      expect(commands.getDraftRevision()).toBe(3);
    } finally {
      await hook.unmount();
    }
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
  commitReaderData = jest.fn(),
  getActive = () => true,
  getAppActive = () => true,
  getIdentityBarriers = () => [],
  getIdentityTrust,
  getSourceEnabled = () => true,
  isSoleTopicRoute,
  getSessionEpochs = () => initialForumSessionEpochs,
  notify = jest.fn(),
  onRetryIdentityStatus = jest.fn(),
  onNodeSeekTopicVerificationRequired = jest.fn(),
  onOpenTopic = jest.fn(),
  onReplyLocationResolved = jest.fn(),
  readGateway,
  showLinuxDoVerification = jest.fn<(message?: string, recovery?: ReadRecovery) => void>(),
  showYaohuoLogin = jest.fn<(message?: string) => void>(),
  location,
  getLocation = () => location,
  getLocationRequestId = () => undefined,
  topic = firstTopic,
  getTopicInput = () => topic
}: {
  commitReaderData?: Parameters<typeof useTopicController>[0]['commitReaderData'];
  getActive?: () => boolean;
  getAppActive?: () => boolean;
  getIdentityBarriers?: () => SessionSource[];
  getIdentityTrust?: (source: SessionRuntimeSnapshot['source']) => SessionRuntimeSnapshot['identityTrust'];
  getSourceEnabled?: (source: Source) => boolean;
  isSoleTopicRoute?: () => boolean;
  getSessionEpochs?: () => ForumSessionEpochs;
  notify?: (message: string) => void;
  onRetryIdentityStatus?: (source: Source) => Promise<unknown> | unknown;
  onNodeSeekTopicVerificationRequired?: (message: string, recovery: ReadRecovery) => void;
  onOpenTopic?: (topic: Topic) => void;
  onReplyLocationResolved?: (location: TopicLocationTarget) => void;
  readGateway: TestReadGateway;
  showLinuxDoVerification?: (message?: string, recovery?: ReadRecovery) => void;
  showYaohuoLogin?: (message?: string) => void;
  location?: TopicLocationTarget;
  getLocation?: () => TopicLocationTarget | undefined;
  getLocationRequestId?: () => number | undefined;
  topic?: Topic;
  getTopicInput?: () => Topic;
}) {
  const readerData = createEmptyReaderData();
  return renderNativeHook(
    () => {
      const currentTopic = getTopicInput();
      const session = useTopicSessionController({ notify, topic: currentTopic });
      const gateway = useMemo(
        () =>
          ({
            ...readGateway,
            getReadPlan:
              readGateway.getReadPlan ??
              createSessionReadPlan({
                getIdentityBarriers,
                getIdentityTrust,
                getSessionEpochs,
                getSourceEnabled
              })
          }) as ReadGateway,
        [readGateway, getIdentityBarriers, getIdentityTrust, getSourceEnabled, getSessionEpochs]
      );
      const controller = useTopicController({
        focused: getActive(),
        isSoleTopicRoute,
        appActive: getAppActive(),
        commitReaderData,
        sessionEpochs: getSessionEpochs(),
        notify,
        onRetryIdentityStatus,
        onNodeSeekTopicVerificationRequired,
        onOpenTopic,
        onReplyLocationResolved,
        readerData,

        showLinuxDoVerification,
        showYaohuoLogin,
        readGateway: gateway,
        location: getLocation(),
        locationRequestId: getLocationRequestId(),
        topic: currentTopic,
        topicSession: session
      });
      return { controller, session };
    },
    { wrapper: QueryTestWrapper }
  );
}

describe('topic query controller', () => {
  it.each(['opening', 'whole-refresh', 'comments-refresh', 'next-page', 'previous-page', 'floor'] as const)(
    'restores the exact NodeSeek %s read after same-account verification',
    async (entry) => {
      let handoff: NodeSeekHandoff = 'closed';
      let challenged = entry === 'opening';
      const challenge = Object.assign(new Error('NodeSeek 需要完成 Cloudflare 验证'), {
        source: 'nodeseek',
        reason: 'cloudflare',
        verificationRequired: true
      });
      const detail: TopicDetail = { ...firstDetail, replyCount: 50, replyHasMore: true, replyNextPage: 2 };
      const exactReply = { ...firstReply, floor: 25, commentId: 125 };
      const anchorReply = { ...firstReply, floor: 35, commentId: 135 };
      const laterReply = { ...firstReply, floor: 45, commentId: 145 };
      const requests: [scope: string | undefined, resource: 'topic' | ReplyRequest['position']][] = [];
      const getTopic = jest.fn<TestGetTopic>(async (_request, options) => {
        requests.push([options?.plan?.cacheScope, 'topic']);
        if (challenged && handoff === 'closed') throw challenge;
        return detail;
      });
      const getReplies = jest.fn<TestGetReplies>(async (request, options) => {
        requests.push([options?.plan?.cacheScope, request.position]);
        if (challenged && handoff === 'closed') throw challenge;
        if (entry === 'previous-page' && request.position.kind === 'target') {
          return {
            items: [anchorReply],
            currentPage: 3,
            previousPage: 2,
            completeness: 'complete',
            hasMore: true,
            nextPage: 4
          };
        }
        if (request.position.kind === 'cursor' && request.position.page === 4) {
          return { items: [laterReply], currentPage: 4, completeness: 'complete', hasMore: false, nextPage: null };
        }
        return {
          items: request.position.kind === 'start' ? [firstReply] : [exactReply],
          currentPage: request.position.kind === 'start' ? 1 : 2,
          completeness: 'complete',
          hasMore: false,
          nextPage: null
        };
      });
      const verify = jest.fn<(message: string, recovery: ReadRecovery) => void>();
      const hook = await renderTopicController({
        onNodeSeekTopicVerificationRequired: verify,
        readGateway: { getTopic, getReplies, getReadPlan: nodeSeekHandoffPlan(() => handoff) }
      });
      if (entry !== 'opening') {
        await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
        if (entry === 'previous-page') {
          await act(async () => {
            await expect(hook.result.current.controller.locateReply({ commentId: 135, floor: 35 })).resolves.toBe(
              'completed'
            );
          });
          await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([anchorReply]));
          await act(async () => {
            await expect(hook.result.current.controller.loadMoreReplies({ silent: true })).resolves.toBe('completed');
          });
          await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([anchorReply, laterReply]));
        }
        challenged = true;
        const controller = hook.result.current.controller;
        await act(async () => {
          const outcome =
            entry === 'whole-refresh'
              ? controller.refreshWholeTopic()
              : entry === 'comments-refresh'
                ? controller.refreshTopicReplies()
                : entry === 'next-page'
                  ? controller.loadMoreReplies()
                  : entry === 'previous-page'
                    ? controller.loadPreviousReplies()
                    : controller.locateReply({ floor: 25, commentId: 125 });
          await expect(outcome).resolves.toBe('verification-required');
        });
      }
      await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
      const ticket = verify.mock.calls[0][1];
      expect(ticket.isCurrent?.()).toBe(true);
      handoff = 'open';
      await act(() => hook.rerender(undefined));
      expect(JSON.stringify(hook.result.current.controller.topicQueryKey)).toContain('public:omit');
      expect(ticket.isCurrent?.()).toBe(true);

      const beforeResume = requests.length;
      handoff = 'resuming';
      const expectedResource =
        entry === 'next-page' || entry === 'previous-page'
          ? { kind: 'cursor', page: 2, offset: null }
          : entry === 'floor'
            ? { kind: 'target', target: { commentId: 125, floor: 25 } }
            : entry === 'comments-refresh'
              ? { kind: 'start' }
              : 'topic';
      await act(async () => {
        await expect(ticket.resume(new AbortController().signal)).resolves.toBe('completed');
        expect(requests.slice(beforeResume)).toEqual([['authenticated:0', expectedResource]]);
      });

      handoff = 'closed';
      challenged = false;
      await act(() => hook.rerender(undefined));
      await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
      const replies =
        entry === 'next-page'
          ? [firstReply, exactReply]
          : entry === 'previous-page'
            ? [exactReply, anchorReply, laterReply]
            : entry === 'floor'
              ? [exactReply]
              : [firstReply];
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual(replies));
      if (entry === 'previous-page') expect(hook.result.current.controller.topicReplies[1]).toBe(anchorReply);
    }
  );

  it('keeps the original window when a resumed NodeSeek floor read is canceled before the server response', async () => {
    let handoff: NodeSeekHandoff = 'closed';
    const reply = { ...firstReply, floor: 25, commentId: 125 };
    const latePage = Promise.withResolvers<RepliesResponse>();
    const started = Promise.withResolvers<AbortSignal | undefined>();
    const verify = jest.fn<(message: string, recovery: ReadRecovery) => void>();
    const getReplies = jest.fn<TestGetReplies>(async ({ position, signal }) => {
      if (position.kind !== 'target') throw new Error('Unexpected read');
      if (handoff === 'closed')
        throw Object.assign(new Error('NodeSeek 需要完成 Cloudflare 验证'), { verificationRequired: true });
      started.resolve(signal);
      return latePage.promise;
    });
    const hook = await renderTopicController({
      onNodeSeekTopicVerificationRequired: verify,
      readGateway: { getTopic: async () => firstDetail, getReplies, getReadPlan: nodeSeekHandoffPlan(() => handoff) }
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
    await act(async () => {
      await expect(hook.result.current.controller.locateReply({ commentId: 125, floor: 25 })).resolves.toBe(
        'verification-required'
      );
    });
    const ticket = verify.mock.calls[0]![1];
    handoff = 'open';
    await act(() => hook.rerender(undefined));
    const cancellation = new AbortController();
    handoff = 'resuming';
    await act(async () => {
      const recovery = ticket.resume(cancellation.signal);
      const requestSignal = await started.promise;
      cancellation.abort();
      await expect(recovery).resolves.toBe('stale');
      expect(requestSignal?.aborted).toBe(true);
      latePage.resolve({ items: [reply], completeness: 'complete', currentPage: 2, hasMore: false, nextPage: null });
      await latePage.promise;
    });
    handoff = 'closed';
    await act(() => hook.rerender(undefined));
    expect(hook.result.current.controller.topicReplies).toEqual([firstReply]);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('reloads an evicted detail when returning to the retained topic without registering the visit twice', async () => {
    let focused = true;
    let appActive = true;
    const topic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const detail = { ...firstDetail, ...topic };
    const getTopic = jest.fn<TestGetTopic>().mockResolvedValue(detail);
    const hook = await renderTopicController({
      topic,
      getActive: () => focused,
      getAppActive: () => appActive,
      readGateway: { getTopic }
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    const topicQueryKey = hook.result.current.controller.topicQueryKey;

    focused = false;
    appActive = false;
    await hook.rerender(undefined);
    expect(appQueryClient.getQueryCache().find({ queryKey: topicQueryKey })?.getObserversCount()).toBe(0);
    appQueryClient.removeQueries({ queryKey: topicQueryKey, exact: true });
    expect(appQueryClient.getQueryState(topicQueryKey)).toBeUndefined();

    appActive = true;
    await hook.rerender(undefined);
    expect(getTopic).toHaveBeenCalledTimes(1);
    focused = true;
    await hook.rerender(undefined);
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    expect(getTopic.mock.calls.map(([request]) => request.trackVisit)).toEqual([true, false]);
  });

  it.each(['newest', 'target'] as const)(
    'reloads an evicted %s LinuxDo reply window when the retained topic returns',
    async (entry) => {
      let focused = true;
      const topic = { ...firstTopic, source: 'linuxdo' as const, replyCount: 99 };
      const target = { floor: 80 };
      const reply = { ...firstReply, ...target, commentId: 80 };
      const getTopic = jest.fn<TestGetTopic>(async () => ({ ...firstDetail, ...topic, replyHasMore: true }));
      const getReplies = jest.fn<TestGetReplies>(async () => ({
        currentPage: 3,
        items: [reply],
        hasMore: false,
        nextPage: null
      }));
      const hook = await renderTopicController({
        getActive: () => focused,
        location: entry === 'target' ? { kind: 'reply', target } : undefined,
        topic,
        readGateway: { getTopic, getReplies }
      });
      if (entry === 'newest') {
        await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
        await act(async () => hook.result.current.session.commands.view.changeReplyOrder('newest'));
      }
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([reply]));
      const { topicQueryKey, replyWindowOwner } = hook.result.current.controller;
      const repliesKey = forumQueryKeys.replies(
        topicQueryKey,
        entry === 'target' ? 'oldest' : 'newest',
        'authenticated:0',
        entry === 'target' ? replyWindowOwner : undefined
      );
      expect(appQueryClient.getQueryData(repliesKey)).toBeDefined();
      focused = false;
      await hook.rerender(undefined);
      expect(appQueryClient.getQueryCache().find({ queryKey: repliesKey })?.getObserversCount()).toBe(0);
      appQueryClient.removeQueries({ queryKey: repliesKey, exact: true });
      expect(appQueryClient.getQueryState(repliesKey)).toBeUndefined();
      focused = true;
      await hook.rerender(undefined);
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([reply]));
      const expectedPosition = entry === 'target' ? { kind: 'target', target } : { kind: 'start' };
      expect(getReplies.mock.calls.map(([request]) => request.position)).toEqual([expectedPosition, expectedPosition]);
      expect(getTopic).toHaveBeenCalledTimes(1);
    }
  );

  it('does not render an unchanged production reply while the reply draft changes', async () => {
    const getTopic = jest.fn<TestGetTopic>(async () => firstDetail);
    const hook = await renderTopicController({ readGateway: { getTopic } });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
    const commands = hook.result.current.session.commands;
    const settings = createEmptyReaderData().settings;
    const theme = createTheme(settings);
    const reply = prepareReplyContent(
      { ...firstReply, contentHtml: '<pre><code>original reply</code></pre>' },
      'nodeseek'
    );
    const bodyContent = reply.preparedContent.contentPlan.rows[0];
    if (bodyContent?.type !== 'codeBlock') throw new Error('Expected one production code block');
    const decisionFor = jest.fn(() => ({ allowed: false, reason: 'login-required' }) as const);
    const props: ComponentProps<typeof MemoizedReplyItem> = {
      actionBusy: false,
      bodyContent,
      decisionFor,
      contentWidth: 360,
      expandedQuotes: {},
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      onTogglePollSelection: jest.fn(),
      pollSelections: {},
      query: '',
      reply,
      replyFloor: 1,
      repliesByFloor: new Map([[1, reply]]),
      source: 'nodeseek',
      styles: createTopicStyles(theme, resolveReaderStyleSettings(settings)),
      theme,
      topicId: firstTopic.id,
      topicStateKey: 'nodeseek:1',
      onInteract: jest.fn(),
      onDeleteReply: jest.fn(),
      onEditReply: jest.fn(),
      onLocateReply: hook.result.current.controller.locateReply,
      onOpenTopic: jest.fn(),
      onOpenUser: jest.fn(),
      onReplyToFloor: commands.composer.replyToFloor,
      onVotePoll: jest.fn(),
      onToggleReplyQuote: hook.result.current.controller.toggleReplyQuote
    };
    // The reply row checks its available actions during render.
    const control = await render(<MemoizedReplyItem {...props} />);
    try {
      expect(control.getByText('original reply')).toBeTruthy();
      expect(decisionFor).toHaveBeenCalled();
      decisionFor.mockClear();
      for (const draft of ['first draft', 'second draft', 'third draft']) {
        await act(async () => hook.result.current.session.commands.composer.changeContent(draft));
        await control.rerender(
          <MemoizedReplyItem
            {...props}
            onLocateReply={hook.result.current.controller.locateReply}
            onReplyToFloor={hook.result.current.session.commands.composer.replyToFloor}
            onToggleReplyQuote={hook.result.current.controller.toggleReplyQuote}
          />
        );
        expect(decisionFor).not.toHaveBeenCalled();
      }
      expect(control.getByText('original reply')).toBeTruthy();
      expect(hook.result.current.session.state.replyContent).toBe('third draft');
      for (const group of ['topic', 'view', 'composer'] as const)
        expect(hook.result.current.session.commands[group]).toBe(commands[group]);
      expect(commands.composer.getDraftRevision()).toBe(3);
      expect(getTopic).toHaveBeenCalledTimes(1);

      const quote = {
        replyKey: 'reply:1',
        reference: { source: 'nodeseek', topicId: '1', postNumber: 2 },
        quotedReply: firstReply
      } satisfies Parameters<ReturnType<typeof useTopicController>['toggleReplyQuote']>[0];
      await act(async () => hook.result.current.controller.toggleReplyQuote(quote));
      expect(Object.values(hook.result.current.session.state.expandedQuotes)).toEqual([true]);
      await act(async () => hook.result.current.controller.toggleReplyQuote(quote));
      expect(Object.values(hook.result.current.session.state.expandedQuotes)).toEqual([false]);

      const changed = prepareReplyContent(
        { ...reply, contentHtml: '<pre><code>changed reply</code></pre>' },
        'nodeseek'
      );
      const changedBody = changed.preparedContent.contentPlan.rows[0];
      if (changedBody?.type !== 'codeBlock') throw new Error('Expected one changed code block');
      await control.rerender(<MemoizedReplyItem {...props} reply={changed} bodyContent={changedBody} />);
      expect(control.getByText('changed reply')).toBeTruthy();
      expect(decisionFor).toHaveBeenCalled();
    } finally {
      await control.unmount();
      await hook.unmount();
    }
  });

  it.each(['linuxdo', 'nodeseek', 'v2ex', 'yaohuo'] as const)(
    'keeps the original %s deadline and does not restart its timed-out read on foreground',
    async (source) => {
      jest.useFakeTimers();
      let appActive = true;
      const topic = { ...firstTopic, source };
      const getTopic = jest.fn<TestGetTopic>(async ({ signal }) =>
        withAbortableTimeout(() => new Promise<TopicDetail>(() => undefined), { signal, timeoutMs: 1_000 })
      );
      const hook = await renderTopicController({ topic, getAppActive: () => appActive, readGateway: { getTopic } });
      try {
        await act(async () => {
          appActive = false;
          hook.rerender(undefined);
        });
        await act(async () => {
          jest.advanceTimersByTime(1_000);
        });
        await waitFor(() => expect(hook.result.current.controller.topicError).not.toBeNull());
        await act(async () => {
          appActive = true;
          hook.rerender(undefined);
        });
        expect(hook.result.current.controller.topicBusy).toBe(false);
        expect(getTopic).toHaveBeenCalledTimes(1);
      } finally {
        await hook.unmount();
        jest.useRealTimers();
      }
    }
  );
  it.each([
    { baseline: { replyCount: 0, replyWatermark: 0 }, count: 100, floor: 1 },
    { baseline: { replyCount: 95, replyWatermark: 98 }, count: 5, floor: 99 },
    { baseline: { replyCount: 95 }, count: 5, floor: undefined },
    { baseline: undefined, count: 0, floor: undefined }
  ])(
    'freezes the entry baseline $baseline independently from the visible window',
    async ({ baseline, count, floor }) => {
      jest.mocked(readHistoryReplyBaseline).mockResolvedValueOnce(baseline);
      const detail = { ...firstDetail, replyCount: 100, replies: [firstReply] };
      const getTopic = jest.fn<TestGetTopic>(async () => detail);
      const commitReaderData = jest.fn();
      const hook = await renderTopicController({ commitReaderData, readGateway: { getTopic } });
      await waitFor(() => expect(commitReaderData).toHaveBeenCalled());
      expect(hook.result.current.controller.unreadReplyCount).toBe(count);
      expect(hook.result.current.controller.newReplyFloorStart).toBe(floor);
      await act(async () =>
        appQueryClient.setQueryData(hook.result.current.controller.topicQueryKey, {
          ...detail,
          replies: [{ ...firstReply, floor: 99 }]
        })
      );
      expect(hook.result.current.controller.newReplyFloorStart).toBe(floor);
      expect(jest.mocked(readHistoryReplyBaseline)).toHaveBeenCalledTimes(1);
    }
  );
  it.each(['linuxdo', 'nodeseek', 'v2ex', 'yaohuo'] as const)(
    'keeps the original %s detail request through background and foreground',
    async (source) => {
      let appActive = true;
      let resolveDetail!: (detail: TopicDetail) => void;
      let requestSignal: AbortSignal | undefined;
      const topic = { ...firstTopic, source };
      const detail = { ...firstDetail, ...topic };
      const getTopic = jest.fn<TestGetTopic>(async ({ signal }) => {
        requestSignal = signal;
        return new Promise((resolve, reject) => {
          resolveDetail = resolve;
          signal?.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { name: 'AbortError' })));
        });
      });
      const hook = await renderTopicController({ topic, getAppActive: () => appActive, readGateway: { getTopic } });
      await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(1));
      await act(async () => {
        appActive = false;
        hook.rerender(undefined);
      });
      expect(requestSignal?.aborted).toBe(false);
      await act(async () => resolveDetail(detail));
      await act(async () => {
        appActive = true;
        hook.rerender(undefined);
      });
      await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
      expect(getTopic).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['oldest', 'newest'] as const)(
    'locates the confirmed linux.do reply with one %s window read',
    async (order) => {
      const topic = { ...firstTopic, source: 'linuxdo' as const };
      const detail = { ...firstDetail, ...topic, replyCompleteness: 'complete' as const };
      const submitted = { ...firstReply, floor: 21, commentId: 121 };
      const concurrent = { ...firstReply, floor: 22, commentId: 122 };
      const items = order === 'oldest' ? [submitted, concurrent] : [concurrent, submitted];
      const getTopic = jest.fn<TestGetTopic>(async () => detail);
      const getReplies = jest.fn<TestGetReplies>(async () => ({
        items,
        currentPage: 1,
        currentOffset: 19,
        previousPage: order === 'oldest' ? 1 : null,
        previousOffset: order === 'oldest' ? 0 : null,
        hasMore: order === 'newest',
        nextPage: order === 'newest' ? 1 : null,
        nextOffset: order === 'newest' ? 0 : null,
        totalCount: 21
      }));
      let location: TopicLocationTarget | undefined;
      const onReplyLocationResolved = jest.fn((target: TopicLocationTarget) => {
        location = target;
      });
      const hook = await renderTopicController({
        topic,
        getLocation: () => location,
        readGateway: { getTopic, getReplies },
        onReplyLocationResolved
      });
      await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
      await act(async () => {
        hook.result.current.session.commands.view.changeReplyOrder(order);
      });
      const otherKey = forumQueryKeys.replies(
        hook.result.current.controller.topicQueryKey,
        order === 'oldest' ? 'newest' : 'oldest',
        'authenticated:0'
      );
      appQueryClient.setQueryData(otherKey, { pages: [], pageParams: [] });
      getTopic.mockClear();
      getReplies.mockClear();
      await act(async () => {
        await expect(
          hook.result.current.controller.refreshTopicReplies({
            kind: 'created',
            createdTarget: { commentId: 121, floor: 21 },
            silent: true
          })
        ).resolves.toBe('completed');
      });
      await act(async () => {
        hook.rerender(undefined);
      });
      expect(getTopic).not.toHaveBeenCalled();
      expect(getReplies).toHaveBeenCalledTimes(1);
      expect(getReplies).toHaveBeenCalledWith(
        expect.objectContaining({
          order,
          position: { kind: 'target', target: { floor: 21 } }
        }),
        expect.anything()
      );
      expect(hook.result.current.controller.topicReplies).toEqual(items);
      expect(hook.result.current.controller.topicDetail?.replyCount).toBe(21);
      expect(appQueryClient.getQueryState(otherKey)?.isInvalidated).toBe(true);
      expect(onReplyLocationResolved).toHaveBeenCalledTimes(1);
      expect(onReplyLocationResolved).toHaveBeenCalledWith({
        kind: 'reply',
        target: expect.objectContaining({ commentId: 121, floor: 21 })
      });
      const repliesKey = forumQueryKeys.replies(
        hook.result.current.controller.topicQueryKey,
        order,
        'authenticated:0',
        order === 'oldest' ? hook.result.current.controller.replyWindowOwner : undefined
      );
      expect(appQueryClient.getQueryData(repliesKey)).toBeDefined();
      hook.unmount();
      if (order === 'oldest') await waitFor(() => expect(appQueryClient.getQueryData(repliesKey)).toBeUndefined());
    }
  );
  it.each(
    (['linuxdo', 'nodeseek'] as const).flatMap((source) =>
      (['missing', 'unmatched', 'offline'] as const).map((failure) => ({ source, failure }))
    )
  )('preserves the $source window after a $failure created-reply result', async ({ source, failure }) => {
    const events: DiagnosticEvent[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const trace = beginDiagnosticTrace('reply', 'submit');
    const topic = { ...firstTopic, source };
    const detail = { ...firstDetail, ...topic, replyCompleteness: 'complete' as const };
    const getTopic = jest.fn<TestGetTopic>(async () => detail);
    const getReplies = jest.fn<TestGetReplies>(async () => {
      if (failure === 'offline') throw new Error('offline');
      return {
        items: [{ ...firstReply, floor: source === 'nodeseek' ? 19 : 21, commentId: 999 }],
        currentPage: 1,
        currentOffset: 0,
        hasMore: false,
        nextPage: null
      };
    });
    const onReplyLocationResolved = jest.fn();
    const hook = await renderTopicController({
      topic,
      readGateway: { getTopic, getReplies },
      onReplyLocationResolved
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual(detail.replies));
    getTopic.mockClear();
    getReplies.mockClear();
    await act(async () => {
      await expect(
        hook.result.current.controller.refreshTopicReplies(
          {
            kind: 'created',
            createdTarget:
              failure === 'missing'
                ? undefined
                : source === 'nodeseek'
                  ? { floor: 21, pageHint: 3 }
                  : { commentId: 121, floor: 21 },
            silent: true
          },
          trace
        )
      ).resolves.toBe('failed');
    });
    expect(getTopic).not.toHaveBeenCalled();
    expect(getReplies).toHaveBeenCalledTimes(failure === 'missing' ? 0 : 1);
    expect(hook.result.current.controller.topicReplies).toEqual(detail.replies);
    expect(onReplyLocationResolved).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        traceId: trace.traceId,
        phase: 'apply',
        state: 'refresh-unconfirmed',
        hasTarget: failure !== 'missing'
      })
    );
    if (failure === 'unmatched')
      expect(events).toContainEqual(
        expect.objectContaining({
          traceId: trace.traceId,
          isTargetMatched: false,
          itemCount: 1
        })
      );
    expect(events).toContainEqual(
      expect.objectContaining({
        traceId: trace.traceId,
        phase: 'apply',
        state: 'refresh-unconfirmed',
        reason: expect.any(String)
      })
    );
  });
  beforeEach(() => {
    appQueryClient.clear();
    jest.mocked(readHistoryReplyBaseline).mockReset().mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await act(async () => {
      await appQueryClient.cancelQueries();
      await Promise.resolve();
    });
    setDiagnosticWriter(null);
  });

  it.each([true, false])(
    'keeps private conversations outside new reading and resume behavior (known before entry: %s)',
    async (known) => {
      const privateTopic = { ...firstTopic, source: 'linuxdo' as const, isPrivateMessage: true };
      const topic = known ? privateTopic : { ...firstTopic, source: 'linuxdo' as const };
      const commit = jest.fn<Parameters<typeof useTopicController>[0]['commitReaderData']>();
      const reading = createDiscourseReadingRuntime({
        queryClient: appQueryClient,
        scope: () => 'alice',
        send: async () => undefined
      });
      reading.observe([{ topicId: '1', lastReadPostNumber: 100, highestPostNumber: 200 }], reading.startRequest());
      let finish!: (detail: TopicDetail) => void;
      const getTopic = jest.fn<TestGetTopic>(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const getTopicReading = jest.fn<ReadGateway['getTopicReading']>();
      const getReplies = jest.fn<TestGetReplies>(async () => ({
        items: [{ ...firstReply, floor: 2 }],
        currentPage: 1,
        hasMore: false,
        nextPage: null
      }));
      const hook = await renderTopicController({
        topic,
        commitReaderData: commit,
        readGateway: { reading, getTopic, getTopicReading, getReplies }
      });
      if (known) {
        expect(commit).not.toHaveBeenCalled();
        expect(getTopic.mock.calls[0][0].trackVisit).toBe(false);
      }
      await act(async () => finish({ ...firstDetail, ...privateTopic, replies: [], replyCount: 199 }));
      await waitFor(() => expect(hook.result.current.controller.topicReplies[0]?.floor).toBe(2));
      expect(hook.result.current.controller.readingRuntime).toBeUndefined();
      expect(hook.result.current.controller.readingEntry.location).toBeUndefined();
      expect(hook.result.current.controller.readingEntry.positionReady).toBe(true);
      expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual(['start']);
      expect(getTopicReading).not.toHaveBeenCalled();
      if (known) {
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'visit', topic: expect.objectContaining({ isPrivateMessage: true }) })
        );
      }
      await act(async () => hook.unmount());
      const cached = await renderTopicController({
        topic: privateTopic,
        readGateway: { reading, getTopic, getTopicReading, getReplies }
      });
      await waitFor(() => expect(cached.result.current.controller.topicDetail).not.toBeNull());
      expect(cached.result.current.controller.readingRuntime).toBeUndefined();
      expect(cached.result.current.controller.readingEntry.location).toBeUndefined();
      expect(getTopicReading).not.toHaveBeenCalled();
      await act(async () => cached.unmount());
      reading.dispose();
    }
  );

  it('records a LinuxDo entry immediately even when content fails, and does not refetch when the retained route returns', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const };
    const commit = jest.fn<Parameters<typeof useTopicController>[0]['commitReaderData']>();
    let reject!: (error: Error) => void;
    let active = true;
    const getTopic = jest.fn<TestGetTopic>(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    const send = jest.fn(async () => undefined);
    const reading = createDiscourseReadingRuntime({ queryClient: appQueryClient, scope: () => 'alice', send });
    const hook = await renderTopicController({
      topic,
      commitReaderData: commit,
      getActive: () => active,
      readGateway: { getTopic, reading }
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ type: 'visit', topic }));
    await act(async () => reject(new Error('offline')));
    await waitFor(() => expect(hook.result.current.controller.topicError).toBeTruthy());
    active = false;
    await act(async () => hook.rerender(undefined));
    active = true;
    await act(async () => hook.rerender(undefined));
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    reading.dispose();
  });

  it.each(['implicit', 'explicit'] as const)(
    'resumes only an unfinished %s reading target after the retained route becomes active',
    async (entry) => {
      const topic = { ...firstTopic, source: 'linuxdo' as const };
      const reading = createDiscourseReadingRuntime({
        queryClient: appQueryClient,
        scope: () => 'alice',
        send: async () => undefined
      });
      const getTopic = jest.fn<TestGetTopic>(async () => {
        reading.observe([{ topicId: '1', lastReadPostNumber: 180, highestPostNumber: 200 }], reading.startRequest());
        return { ...firstDetail, ...topic, replies: [], replyCount: 199 };
      });
      const getTopicReading = jest.fn<ReadGateway['getTopicReading']>();
      const requests: { signal?: AbortSignal; finish: (page: RepliesResponse) => void }[] = [];
      const getReplies = jest.fn<TestGetReplies>(
        ({ signal }) => new Promise((finish) => requests.push({ signal, finish }))
      );
      let active = true;
      const hook = await renderTopicController({
        topic,
        getActive: () => active,
        ...(entry === 'explicit' ? { location: { kind: 'reply', target: { floor: 181 } } as TopicLocationTarget } : {}),
        readGateway: { reading, getTopic, getTopicReading, getReplies }
      });
      const target = { floor: 181, ...(entry === 'implicit' ? { readingResume: true } : {}) };
      const page: RepliesResponse = {
        items: [{ ...firstReply, floor: 181 }],
        currentPage: 10,
        hasMore: false,
        nextPage: null
      };
      await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
      expect(hook.result.current.controller.readingEntry.location).toEqual({ kind: 'reply', target });
      expect(hook.result.current.controller.readingEntry.windowReady).toBe(entry === 'explicit');
      active = false;
      await act(async () => hook.rerender(undefined));
      expect(requests[0].signal?.aborted).toBe(true);
      await act(async () => requests[0].finish(page));
      expect(hook.result.current.controller.readingEntry.location).toEqual({ kind: 'reply', target });
      expect(hook.result.current.controller.readingEntry.positionReady).toBe(false);
      active = true;
      await act(async () => hook.rerender(undefined));
      await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(2));
      expect(getReplies.mock.calls.map(([request]) => request.position)).toEqual([
        { kind: 'target', target },
        { kind: 'target', target }
      ]);
      await act(async () => requests[1].finish(page));
      await waitFor(() => expect(hook.result.current.controller.topicReplies[0]?.floor).toBe(181));
      expect(hook.result.current.controller.readingEntry.windowReady).toBe(true);
      expect(hook.result.current.controller.readingEntry.positionReady).toBe(false);
      active = false;
      await act(async () => hook.rerender(undefined));
      active = true;
      await act(async () => hook.rerender(undefined));
      expect(getReplies).toHaveBeenCalledTimes(2);
      expect(getTopic).toHaveBeenCalledTimes(1);
      expect(getTopicReading).not.toHaveBeenCalled();
      await act(async () => hook.unmount());
      reading.dispose();
    }
  );

  it('keeps a replacement reading target pending when the obsolete window finishes', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const };
    const reading = createDiscourseReadingRuntime({
      queryClient: appQueryClient,
      scope: () => 'alice',
      send: async () => undefined
    });
    const requests: ((page: RepliesResponse) => void)[] = [];
    const getReplies = jest.fn<TestGetReplies>(() => new Promise((finish) => requests.push(finish)));
    let location: TopicLocationTarget | undefined;
    const hook = await renderTopicController({
      topic,
      getLocation: () => location,
      readGateway: {
        reading,
        getTopic: async () => {
          reading.observe([{ topicId: '1', lastReadPostNumber: 180, highestPostNumber: 200 }], reading.startRequest());
          return { ...firstDetail, ...topic, replies: [], replyCount: 199 };
        },
        getReplies
      }
    });
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    location = { kind: 'reply', target: { floor: 195 } };
    await act(async () => hook.rerender(undefined));
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(2));
    const page = (floor: number): RepliesResponse => ({
      items: [{ ...firstReply, floor }],
      currentPage: 10,
      hasMore: false,
      nextPage: null
    });
    await act(async () => requests[0](page(181)));
    expect(hook.result.current.controller.readingEntry.location).toEqual(location);
    expect(hook.result.current.controller.readingEntry.positionReady).toBe(false);
    expect(hook.result.current.controller.readingEntry.windowReady).toBe(false);
    expect(hook.result.current.controller.topicReplies).toEqual([]);
    await act(async () => requests[1](page(195)));
    await waitFor(() => expect(hook.result.current.controller.topicReplies[0]?.floor).toBe(195));
    expect(hook.result.current.controller.readingEntry.windowReady).toBe(true);
    expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual(['target', 'target']);
    await act(async () => hook.unmount());
    reading.dispose();
  });

  it.each(['completed', 'failed'] as const)(
    'releases initial reading positioning after a current whole-topic refresh is %s',
    async (outcome) => {
      const topic = { ...firstTopic, source: 'linuxdo' as const };
      const reading = createDiscourseReadingRuntime({
        queryClient: appQueryClient,
        scope: () => 'alice',
        send: async () => undefined
      });
      const pending = Promise.withResolvers<RepliesResponse>();
      const getReplies = jest.fn<TestGetReplies>(() => pending.promise);
      const getTopic: jest.Mock<TestGetTopic> = jest.fn<TestGetTopic>(async () => {
        if (outcome === 'failed' && getTopic.mock.calls.length === 2) throw new Error('offline');
        reading.observe([{ topicId: '1', lastReadPostNumber: 180, highestPostNumber: 200 }], reading.startRequest());
        return {
          ...firstDetail,
          ...topic,
          replies: getTopic.mock.calls.length === 1 ? [] : [{ ...firstReply, floor: 2 }],
          replyCount: 199,
          replyCompleteness: 'complete'
        };
      });
      const hook = await renderTopicController({ topic, readGateway: { reading, getTopic, getReplies } });
      await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
      await act(async () => {
        await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe(outcome);
      });
      await act(async () =>
        pending.resolve({ items: [{ ...firstReply, floor: 181 }], currentPage: 10, hasMore: false, nextPage: null })
      );
      expect(hook.result.current.controller.topicReplies[0]?.floor).toBe(outcome === 'failed' ? undefined : 2);
      expect(hook.result.current.controller.readingEntry.positionReady).toBe(true);
      expect(hook.result.current.controller.readingEntry.location).toBeUndefined();
      expect(hook.result.current.controller.topicDetail?.contentHtml).toBe(firstDetail.contentHtml);
      expect(getReplies).toHaveBeenCalledTimes(1);
      if (outcome === 'failed') {
        expect(hook.result.current.controller.repliesError).toBeTruthy();
        expect(hook.result.current.controller.repliesError?.retryable).not.toBe(false);
        await act(async () => {
          await expect(hook.result.current.controller.retryReplies()).resolves.toBe('completed');
        });
        expect(hook.result.current.controller.topicReplies[0]?.floor).toBe(2);
        expect(hook.result.current.controller.repliesError).toBeNull();
        expect(getTopic).toHaveBeenCalledTimes(3);
        expect(getReplies).toHaveBeenCalledTimes(1);
      }
      await act(async () => hook.unmount());
      reading.dispose();
    }
  );

  it.each(['completed', 'failed'] as const)(
    'releases pending reading positioning when a manual reply refresh is %s',
    async (outcome) => {
      const topic = { ...firstTopic, source: 'linuxdo' as const };
      const reading = createDiscourseReadingRuntime({
        queryClient: appQueryClient,
        scope: () => 'alice',
        send: async () => undefined
      });
      const pending = Promise.withResolvers<RepliesResponse>();
      const page = { items: [{ ...firstReply, floor: 2 }], currentPage: 1, hasMore: false, nextPage: null };
      const getReplies = jest.fn<TestGetReplies>(async ({ position }) => {
        if (position.kind === 'target') return pending.promise;
        if (outcome === 'failed') throw new Error('offline');
        return page;
      });
      const getTopic = jest.fn<TestGetTopic>(async () => {
        reading.observe([{ topicId: '1', lastReadPostNumber: 180, highestPostNumber: 200 }], reading.startRequest());
        return { ...firstDetail, ...topic, replies: [], replyCount: 199 };
      });
      const hook = await renderTopicController({ topic, readGateway: { reading, getTopic, getReplies } });
      try {
        await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
        expect(hook.result.current.controller.readingEntry.positionReady).toBe(false);
        await act(async () => {
          await expect(hook.result.current.controller.refreshTopicReplies()).resolves.toBe(outcome);
        });
        expect(hook.result.current.controller.readingEntry.positionReady).toBe(true);
        await act(async () => pending.resolve({ ...page, items: [{ ...firstReply, floor: 181 }] }));
        expect(hook.result.current.controller.readingEntry.location).toBeUndefined();
        expect(hook.result.current.controller.topicReplies[0]?.floor).toBe(outcome === 'completed' ? 2 : undefined);
      } finally {
        await act(async () => hook.unmount());
        reading.dispose();
      }
    }
  );

  it('opens a confirmed local floor from its cached window while visit registration is pending', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const };
    let now = 0;
    const reading = createDiscourseReadingRuntime({
      queryClient: appQueryClient,
      scope: () => 'alice',
      send: async () => undefined,
      now: () => now
    });
    const registration = Promise.withResolvers<void>();
    const getTopic = jest.fn<TestGetTopic>(async () => ({
      ...firstDetail,
      ...topic,
      replies: [{ ...firstReply, floor: 12 }],
      replyCompleteness: 'complete'
    }));
    const getTopicReading = jest.fn<ReadGateway['getTopicReading']>(async () => {
      const request = reading.startRequest();
      await registration.promise;
      const snapshot = { topicId: topic.id, lastReadPostNumber: 30, highestPostNumber: 40 };
      reading.observe([snapshot], request);
      return snapshot;
    });
    const getReplies = jest.fn<TestGetReplies>();
    const gateway = { reading, getTopic, getTopicReading, getReplies };
    const first = await renderTopicController({ topic, readGateway: gateway });
    await waitFor(() => expect(first.result.current.controller.topicReplies[0]?.floor).toBe(12));
    const session = reading.begin(topic.id);
    session.active(true);
    const anchor = { floor: 12, rowKey: 'seen-row', revision: 'v1', offset: 23 };
    session.visible([12], anchor);
    now = 1200;
    session.end();
    expect(reading.state()[topic.id].anchor).toEqual(anchor);
    await act(async () => first.unmount());
    const second = await renderTopicController({ topic, readGateway: gateway });
    try {
      expect(getTopicReading).toHaveBeenCalledTimes(1);
      expect(second.result.current.controller.readingEntry).toMatchObject({
        ready: true,
        windowReady: true,
        positionReady: false,
        anchor
      });
      await act(async () => registration.resolve());
      expect(second.result.current.controller.readingEntry.anchor).toEqual(anchor);
      expect(reading.state()[topic.id].server.lastReadPostNumber).toBe(30);
      expect(getTopic).toHaveBeenCalledTimes(1);
      expect(getReplies).not.toHaveBeenCalled();
    } finally {
      registration.resolve();
      await act(async () => second.unmount());
      reading.dispose();
    }
  });

  it.each([true, false])(
    'preserves the right reading window after a manual jump with a sole topic route=%s',
    async (sole) => {
      let now = 0;
      const topic = { ...firstTopic, source: 'linuxdo' as const, replyCount: 100 };
      const reading = createDiscourseReadingRuntime({
        queryClient: appQueryClient,
        scope: () => 'alice',
        send: async () => undefined,
        now: () => now
      });
      const getTopic = jest.fn<TestGetTopic>(async () => ({
        ...firstDetail,
        ...topic,
        replies: [{ ...firstReply, floor: 2 }],
        replyCompleteness: 'complete'
      }));
      const getReplies = jest.fn<TestGetReplies>(async () => ({
        items: [{ ...firstReply, floor: 58 }],
        currentPage: 3,
        previousPage: 2,
        previousOffset: 30,
        currentOffset: 50,
        nextPage: null,
        hasMore: false
      }));
      const registration = Promise.withResolvers<undefined>();
      const gateway = {
        reading,
        getTopic,
        getReplies,
        getTopicReading: jest.fn<ReadGateway['getTopicReading']>().mockReturnValue(registration.promise)
      };
      const first = await renderTopicController({ topic, readGateway: gateway, isSoleTopicRoute: () => sole });
      await waitFor(() => expect(first.result.current.controller.topicReplies[0]?.floor).toBe(2));
      const key = forumQueryKeys.replies(first.result.current.controller.topicQueryKey, 'oldest', 'authenticated:0');
      await act(async () => {
        await expect(first.result.current.controller.locateReply({ floor: 58 })).resolves.toBe('completed');
      });
      const session = reading.begin(topic.id);
      session.active(true);
      session.visible([58], { floor: 58 });
      now = 1200;
      session.end();
      await act(async () => first.unmount());
      try {
        expect(appQueryClient.getQueryData(key)).toMatchObject({
          pages: [{ items: [{ floor: sole ? 58 : 2 }] }]
        });
        if (sole) {
          const second = await renderTopicController({ topic, readGateway: gateway, isSoleTopicRoute: () => true });
          try {
            expect(second.result.current.controller.readingEntry).toMatchObject({
              ready: true,
              windowReady: true,
              anchor: { floor: 58 }
            });
            expect(second.result.current.controller.topicReplies[0]?.floor).toBe(58);
            expect(getReplies).toHaveBeenCalledTimes(1);
          } finally {
            await act(async () => second.unmount());
          }
        }
      } finally {
        registration.resolve(undefined);
        reading.dispose();
      }
    }
  );

  it('shows the cached opening immediately when there is no signed-in reading identity', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const };
    const reading = createDiscourseReadingRuntime({
      queryClient: appQueryClient,
      scope: () => null,
      send: async () => undefined
    });
    const registration = Promise.withResolvers<undefined>();
    const gateway = {
      reading,
      getTopic: jest.fn<TestGetTopic>(async () => ({ ...firstDetail, ...topic, replyCompleteness: 'complete' })),
      getTopicReading: jest.fn<ReadGateway['getTopicReading']>().mockReturnValue(registration.promise)
    };
    const first = await renderTopicController({ topic, readGateway: gateway });
    await waitFor(() => expect(first.result.current.controller.topicDetail).toBeTruthy());
    await act(async () => first.unmount());
    const second = await renderTopicController({ topic, readGateway: gateway });
    try {
      expect(second.result.current.controller.readingEntry).toMatchObject({ ready: true, positionReady: true });
      expect(gateway.getTopicReading).toHaveBeenCalledTimes(1);
      expect(gateway.getTopic).toHaveBeenCalledTimes(1);
    } finally {
      registration.resolve(undefined);
      await act(async () => second.unmount());
      reading.dispose();
    }
  });

  it('retries an interrupted cached visit on focus without reloading the topic', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const };
    let focused = true;
    const reading = createDiscourseReadingRuntime({
      queryClient: appQueryClient,
      scope: () => 'alice',
      send: async () => undefined
    });
    const getTopic = jest.fn<TestGetTopic>(async () => ({ ...firstDetail, ...topic, replyCompleteness: 'complete' }));
    const registration = Promise.withResolvers<Awaited<ReturnType<ReadGateway['getTopicReading']>>>();
    const getTopicReading = jest.fn<ReadGateway['getTopicReading']>().mockReturnValue(registration.promise);
    const gateway = { reading, getTopic, getTopicReading };
    const first = await renderTopicController({ topic, readGateway: gateway });
    await waitFor(() => expect(first.result.current.controller.readingEntry.ready).toBe(true));
    await act(async () => first.unmount());
    const second = await renderTopicController({ topic, readGateway: gateway, getActive: () => focused });
    try {
      expect(getTopicReading).toHaveBeenCalledTimes(1);
      focused = false;
      await second.rerender(undefined);
      expect(getTopicReading.mock.calls[0][1]?.signal?.aborted).toBe(true);
      focused = true;
      await second.rerender(undefined);
      expect(getTopicReading).toHaveBeenCalledTimes(2);
      await act(async () => registration.resolve(undefined));
      expect(second.result.current.controller.readingEntry.ready).toBe(true);
      focused = false;
      await second.rerender(undefined);
      focused = true;
      await second.rerender(undefined);
      expect(getTopicReading).toHaveBeenCalledTimes(2);
      expect(getTopic).toHaveBeenCalledTimes(1);
    } finally {
      registration.resolve(undefined);
      await act(async () => second.unmount());
      reading.dispose();
    }
  });

  it.each(['topic', 'replies'] as const)(
    'keeps a manual %s refresh in control when the initial server decision arrives',
    async (section) => {
      const topic = { ...firstTopic, source: 'linuxdo' as const };
      const detail = {
        ...firstDetail,
        ...topic,
        replies: [{ ...firstReply, floor: 2 }],
        replyCompleteness: 'complete' as const
      };
      const reading = createDiscourseReadingRuntime({
        queryClient: appQueryClient,
        scope: () => 'alice',
        send: async () => undefined
      });
      const registration = Promise.withResolvers<void>();
      const refreshed = Promise.withResolvers<void>();
      const getTopic = jest
        .fn<TestGetTopic>()
        .mockResolvedValueOnce(detail)
        .mockImplementation(async () => {
          await refreshed.promise;
          return detail;
        });
      const getTopicReading = jest.fn<ReadGateway['getTopicReading']>(async () => {
        const request = reading.startRequest();
        await registration.promise;
        const snapshot = { topicId: topic.id, lastReadPostNumber: 19, highestPostNumber: 25 };
        reading.observe([snapshot], request);
        return snapshot;
      });
      const getReplies = jest.fn<TestGetReplies>(async ({ position }) => {
        if (position.kind !== 'target') await refreshed.promise;
        return {
          items: [{ ...firstReply, floor: position.kind === 'target' ? 20 : 2 }],
          currentPage: 1,
          nextPage: null,
          hasMore: false
        };
      });
      const gateway = { reading, getTopic, getTopicReading, getReplies };
      const first = await renderTopicController({ topic, readGateway: gateway });
      await waitFor(() => expect(first.result.current.controller.readingEntry.ready).toBe(true));
      await act(async () => first.unmount());
      const second = await renderTopicController({ topic, readGateway: gateway });
      try {
        expect(second.result.current.controller.readingEntry.ready).toBe(false);
        const controller = second.result.current.controller;
        let refresh!: ReturnType<typeof controller.refreshWholeTopic>;
        await act(async () => {
          refresh = section === 'topic' ? controller.refreshWholeTopic() : controller.refreshTopicReplies();
        });
        await act(async () => registration.resolve());
        expect(getReplies.mock.calls.map(([request]) => request.position.kind)).not.toContain('target');
        await act(async () => {
          refreshed.resolve();
          await expect(refresh).resolves.toBe('completed');
        });
        expect(second.result.current.controller.readingEntry.location).toBeUndefined();
        expect(second.result.current.controller.topicReplies[0]?.floor).toBe(2);
        expect(reading.state()[topic.id].server.lastReadPostNumber).toBe(19);
      } finally {
        refreshed.resolve();
        registration.resolve();
        await act(async () => second.unmount());
        reading.dispose();
      }
    }
  );

  it('reuses a cached reading window and loads only a new cross-device target on re-entry', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const };
    const reading = createDiscourseReadingRuntime({
      queryClient: appQueryClient,
      scope: () => 'alice',
      send: async () => undefined
    });
    const getTopic = jest.fn<TestGetTopic>(async () => {
      reading.observe([{ topicId: '1', lastReadPostNumber: 20, highestPostNumber: 200 }], reading.startRequest());
      return { ...firstDetail, ...topic, replies: [], replyCount: 199 };
    });
    let lastReadPostNumber = 20;
    const getTopicReading = jest.fn<ReadGateway['getTopicReading']>(async () => {
      const snapshot = { topicId: '1', lastReadPostNumber, highestPostNumber: 200 };
      reading.observe([snapshot], reading.startRequest());
      return snapshot;
    });
    const getReplies = jest.fn<TestGetReplies>(async ({ position }) => ({
      items: [{ ...firstReply, floor: position.kind === 'target' ? position.target.floor : 2 }],
      currentPage: 1,
      hasMore: false,
      nextPage: null
    }));
    const gateway = { reading, getTopic, getTopicReading, getReplies };
    const first = await renderTopicController({ topic, readGateway: gateway });
    await waitFor(() => expect(first.result.current.controller.topicReplies[0]?.floor).toBe(21));
    await act(async () => first.unmount());
    const second = await renderTopicController({ topic, readGateway: gateway });
    await waitFor(() => expect(second.result.current.controller.readingEntry.ready).toBe(true));
    expect(second.result.current.controller.topicReplies[0]?.floor).toBe(21);
    expect(getReplies).toHaveBeenCalledTimes(1);
    expect(getTopicReading).toHaveBeenCalledTimes(1);
    await act(async () => second.unmount());

    lastReadPostNumber = 180;
    const third = await renderTopicController({ topic, readGateway: gateway });
    await waitFor(() => expect(third.result.current.controller.topicReplies[0]?.floor).toBe(181));
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getTopic.mock.calls[0][0].trackVisit).toBe(true);
    expect(getTopicReading).toHaveBeenCalledTimes(2);
    expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual(['target', 'target']);
    await act(async () => third.unmount());
    reading.dispose();
  });

  it('registers an entry that joins an untracked in-flight topic query before choosing its reply window', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const };
    const reading = createDiscourseReadingRuntime({
      queryClient: appQueryClient,
      scope: () => 'alice',
      send: async () => undefined
    });
    let finishDetail!: (detail: TopicDetail) => void;
    let finishRegistration!: () => void;
    const getTopic = jest.fn<TestGetTopic>(
      () =>
        new Promise((resolve) => {
          finishDetail = resolve;
        })
    );
    const getTopicReading = jest.fn<ReadGateway['getTopicReading']>(
      () =>
        new Promise((resolve) => {
          const request = reading.startRequest();
          finishRegistration = () => {
            const snapshot = { topicId: '1', lastReadPostNumber: 180, highestPostNumber: 200 };
            reading.observe([snapshot], request);
            resolve(snapshot);
          };
        })
    );
    const getReplies = jest.fn<TestGetReplies>(async ({ position }) => ({
      items: [{ ...firstReply, floor: position.kind === 'target' ? position.target.floor : 2 }],
      currentPage: 1,
      hasMore: false,
      nextPage: null
    }));
    const pendingDetail = appQueryClient.query({
      queryKey: forumQueryKeys.topic({
        source: topic.source,
        topicId: topic.id,
        readPlanScope: 'authenticated:0',
        scope: initialForumSessionEpochs
      }),
      queryFn: ({ signal }) => getTopic({ source: topic.source, id: topic.id, signal })
    });
    const hook = await renderTopicController({
      topic,
      readGateway: { reading, getTopic, getTopicReading, getReplies }
    });
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getTopic.mock.calls[0][0].trackVisit).toBeUndefined();
    expect(getTopicReading).not.toHaveBeenCalled();
    expect(getReplies).not.toHaveBeenCalled();

    await act(async () => {
      finishDetail({ ...firstDetail, ...topic, replies: [], replyCount: 199 });
      await pendingDetail;
    });
    await waitFor(() => expect(getTopicReading).toHaveBeenCalledTimes(1));
    expect(getTopicReading.mock.calls[0]).toEqual([topic.id, { signal: expect.any(AbortSignal), trackVisit: true }]);
    expect(hook.result.current.controller.readingEntry.ready).toBe(false);
    expect(getReplies).not.toHaveBeenCalled();
    await act(async () => finishRegistration());
    await waitFor(() => expect(hook.result.current.controller.topicReplies[0]?.floor).toBe(181));
    expect(getReplies.mock.calls.map(([request]) => request.position)).toEqual([
      { kind: 'target', target: { floor: 181, readingResume: true } }
    ]);
    expect(getTopicReading).toHaveBeenCalledTimes(1);
    expect(getTopic).toHaveBeenCalledTimes(1);
    await act(async () => hook.unmount());
    reading.dispose();
  });

  it.each(['opening', 'server-reset', 'invalidated', 'failed-target'] as const)(
    'rebuilds an unsuitable retained reading window on %s re-entry',
    async (entry) => {
      const topic = { ...firstTopic, source: 'linuxdo' as const };
      const reading = createDiscourseReadingRuntime({
        queryClient: appQueryClient,
        scope: () => 'alice',
        send: async () => undefined
      });
      const getTopic = jest.fn<TestGetTopic>(async () => {
        reading.observe([{ topicId: '1', lastReadPostNumber: 80, highestPostNumber: 100 }], reading.startRequest());
        return {
          ...firstDetail,
          ...topic,
          replies: [{ ...firstReply, floor: 2, contentHtml: '<p>old embedded reply</p>' }],
          replyCount: 99,
          replyCompleteness: 'complete',
          replyHasMore: true,
          replyNextOffset: 1
        };
      });
      const getTopicReading = jest.fn<ReadGateway['getTopicReading']>(async () => {
        const snapshot = {
          topicId: '1',
          lastReadPostNumber: entry === 'server-reset' ? 0 : 80,
          highestPostNumber: 100
        };
        reading.observe([snapshot], reading.startRequest());
        return snapshot;
      });
      const getReplies: jest.Mock<TestGetReplies> = jest.fn<TestGetReplies>(async ({ position }) => {
        if (entry === 'failed-target' && getReplies.mock.calls.length > 1) throw new Error('offline');
        return {
          items: [
            {
              ...firstReply,
              floor: position.kind === 'target' ? position.target.floor : 2,
              contentHtml: `<p>response ${getReplies.mock.calls.length}</p>`
            }
          ],
          currentPage: position.kind === 'target' ? 5 : 1,
          currentOffset: position.kind === 'target' ? 80 : 0,
          previousPage: position.kind === 'target' ? 4 : null,
          previousOffset: position.kind === 'target' ? 60 : null,
          hasMore: false,
          nextPage: null,
          completeness: 'complete',
          totalCount: 99
        };
      });
      const gateway = { reading, getTopic, getTopicReading, getReplies };
      const first = await renderTopicController({ topic, readGateway: gateway });
      await waitFor(() => expect(first.result.current.controller.topicReplies[0]?.floor).toBe(81));
      await act(async () => first.unmount());
      if (entry === 'invalidated' || entry === 'failed-target') {
        await appQueryClient.invalidateQueries({ queryKey: ['forum', 'linuxdo', 'topic'], refetchType: 'none' });
      }
      const second = await renderTopicController({
        topic,
        readGateway: gateway,
        ...(entry === 'opening' ? { location: { kind: 'opening' } as TopicLocationTarget } : {})
      });
      if (entry === 'failed-target') {
        await waitFor(() => expect(second.result.current.controller.readingEntry.positionReady).toBe(true));
        expect(second.result.current.controller.topicReplies[0]?.contentHtml).toBe('<p>response 1</p>');
        expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual(['target', 'target']);
        await act(async () => second.unmount());
        reading.dispose();
        return;
      }
      await waitFor(() =>
        expect(second.result.current.controller.topicReplies[0]?.contentHtml).toBe('<p>response 2</p>')
      );
      expect(second.result.current.controller.topicReplies[0]?.floor).toBe(entry === 'invalidated' ? 81 : 2);
      expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual([
        'target',
        entry === 'invalidated' ? 'target' : 'start'
      ]);
      expect(getTopic).toHaveBeenCalledTimes(1);
      expect(getTopicReading).toHaveBeenCalledTimes(1);
      await act(async () => second.unmount());
      reading.dispose();
    }
  );

  it('opens cached content after the decision window and ignores a late resume target', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const };
    const reading = createDiscourseReadingRuntime({
      queryClient: appQueryClient,
      scope: () => 'alice',
      send: async () => undefined
    });
    let finish!: () => void;
    const gateway = {
      reading,
      getTopic: jest.fn<TestGetTopic>(async () => ({ ...firstDetail, ...topic, replyCompleteness: 'complete' })),
      getTopicReading: jest.fn<ReadGateway['getTopicReading']>(
        () =>
          new Promise((resolve) => {
            finish = () => {
              const snapshot = { topicId: '1', lastReadPostNumber: 100, highestPostNumber: 200 };
              reading.observe([snapshot], reading.startRequest());
              resolve(snapshot);
            };
          })
      )
    };
    const first = await renderTopicController({ topic, readGateway: gateway });
    await waitFor(() => expect(first.result.current.controller.readingEntry.ready).toBe(true));
    await act(async () => first.unmount());
    const second = await renderTopicController({ topic, readGateway: gateway });
    expect(second.result.current.controller.readingEntry.ready).toBe(false);
    await waitFor(() => expect(second.result.current.controller.readingEntry.ready).toBe(true), { timeout: 1800 });
    await act(async () => finish());
    expect(second.result.current.controller.readingEntry.location).toBeUndefined();
    expect(reading.state()['1'].server.lastReadPostNumber).toBe(100);
    expect(gateway.getTopicReading).toHaveBeenCalledTimes(1);
    await act(async () => second.unmount());
    reading.dispose();
  });

  it('loads the new order normally after consuming a route reply location', async () => {
    const target = { ...firstReply, floor: 9, commentId: 109 };
    const tail = { ...firstReply, floor: 40, commentId: 140 };
    const detail = { ...firstDetail, replies: [], replyCount: 40 };
    const getReplies = jest.fn<TestGetReplies>(async (request) => ({
      items: [request.position.kind === 'target' ? target : tail],
      currentPage: request.position.kind === 'target' ? 1 : 4,
      hasMore: false,
      nextPage: null
    }));
    const hook = await renderTopicController({
      location: { kind: 'reply', target: { floor: 9 } },
      readGateway: { getTopic: async () => detail, getReplies }
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));
    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([tail]));
    expect(getReplies.mock.calls.map(([request]) => [request.order, request.position.kind])).toEqual([
      ['oldest', 'target'],
      ['newest', 'start']
    ]);
  });

  it('settles the loading indicator when an explicit missing reply has no seeded window', async () => {
    const notify = jest.fn();
    const getReplies = jest.fn<TestGetReplies>(async () => {
      throw new Error('目标楼层未找到');
    });
    const hook = await renderTopicController({
      location: { kind: 'reply', target: { floor: 90 } },
      notify,
      readGateway: { getTopic: async () => ({ ...firstDetail, replies: [] }), getReplies }
    });
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    await waitFor(() => expect(hook.result.current.controller.repliesLoading).toBe(false));
    expect(hook.result.current.controller.topicDetail).not.toBeNull();
    expect(hook.result.current.controller.topicReplies).toEqual([]);
  });

  it.each<TopicLocationTarget>([{ kind: 'opening' }, { kind: 'reply', target: { commentId: 100 } }])(
    'keeps the opening authoritative when a previous reply location finishes late: %j',
    async (opening) => {
      let location: TopicLocationTarget = { kind: 'reply', target: { floor: 90 } };
      let finish!: (value: RepliesResponse) => void;
      const getReplies = jest.fn<TestGetReplies>(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const hook = await renderTopicController({
        getLocation: () => location,
        readGateway: { getTopic: async () => ({ ...firstDetail, commentId: 100 }), getReplies }
      });
      await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
      location = opening;
      await act(async () => hook.rerender(undefined));
      await act(async () =>
        finish({
          items: [{ ...firstReply, floor: 90, commentId: 900 }],
          currentPage: 9,
          hasMore: false,
          nextPage: null,
          completeness: 'complete'
        })
      );
      expect(hook.result.current.controller.topicReplies).toEqual([firstReply]);
    }
  );

  it.each<TopicLocationTarget>([{ kind: 'opening' }, { kind: 'reply', target: { commentId: 100 } }])(
    'opens a quoted Discourse opening post without looking for it in replies and still loads comments: %j',
    async (location) => {
      const topic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
      const detail = { ...firstDetail, ...topic, commentId: 100, replies: [] };
      const reply = { ...firstReply, floor: 2 };
      const notify = jest.fn();
      const getReplies = jest.fn<TestGetReplies>(async (request) => {
        if (request.position.kind === 'target') throw new Error('linux.do 目标楼层未找到');
        return { items: [reply], currentPage: 1, hasMore: false, nextPage: null, completeness: 'complete' };
      });
      const hook = await renderTopicController({
        topic,
        location,
        notify,
        readGateway: { getTopic: async () => detail, getReplies }
      });
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([reply]));
      expect(getReplies.mock.calls.map(([request]) => request.position)).toEqual([{ kind: 'start' }]);
      expect(notify).not.toHaveBeenCalled();
    }
  );

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
      expect.objectContaining({ plan: expect.objectContaining({ cacheScope: 'public:omit' }) })
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

  it.each<Source>(['linuxdo', 'nodeseek', 'v2ex', 'yaohuo'])(
    'does not restore older replies when reopening %s after refreshing the other order',
    async (source) => {
      const topic = { ...firstTopic, source };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        replyCompleteness: 'complete',
        replyHasMore: false
      };
      const updatedReply = { ...firstReply, contentHtml: '<p>updated reply</p>' };
      const getTopic = jest.fn<TestGetTopic>(async () => detail);
      const getReplies = jest.fn<TestGetReplies>(async () => ({
        items: [updatedReply],
        completeness: 'complete',
        currentPage: 1,
        currentOffset: 0,
        hasMore: false,
        nextPage: null,
        totalCount: 1
      }));
      const readGateway = { getTopic, getReplies };
      const first = await renderTopicController({ topic, readGateway });
      await waitFor(() => expect(first.result.current.controller.topicReplies).toEqual([firstReply]));
      await act(async () => first.result.current.session.commands.view.changeReplyOrder('newest'));
      await act(async () => {
        await expect(first.result.current.controller.refreshTopicReplies()).resolves.toBe('completed');
      });
      await waitFor(() => expect(first.result.current.controller.topicReplies).toEqual([updatedReply]));
      await act(async () => first.unmount());

      const second = await renderTopicController({ topic, readGateway });
      await waitFor(() => expect(second.result.current.controller.topicReplies).toEqual([updatedReply]));
      expect(getTopic).toHaveBeenCalledTimes(1);
      await act(async () => second.unmount());
    }
  );

  it.each([
    { focusOrder: 'before', parentFloor: 20 },
    { focusOrder: 'after', parentFloor: 20 },
    { focusOrder: 'before', parentFloor: 1 },
    { focusOrder: 'after', parentFloor: 1 }
  ])(
    'preserves the parent reply window at floor $parentFloor when focus returns $focusOrder a same-topic child unmounts',
    async ({ focusOrder, parentFloor }) => {
      let focused = true;
      const parentReply =
        parentFloor === 1 ? firstReply : { ...firstReply, floor: parentFloor, commentId: parentFloor };
      const childReply = { ...firstReply, floor: 80, commentId: 80 };
      const getTopic = jest.fn<TestGetTopic>(async () => ({
        ...firstDetail,
        replyCount: 100,
        replyHasMore: false,
        replyCompleteness: 'complete'
      }));
      const getReplies = jest.fn<TestGetReplies>(async ({ position }) => {
        const floor = position.kind === 'target' ? position.target.floor : undefined;
        return {
          items: [floor === 20 ? parentReply : floor === 80 ? childReply : firstReply],
          completeness: 'complete',
          currentPage: floor === 20 ? 2 : floor === 80 ? 8 : 1,
          currentOffset: null,
          hasMore: false,
          nextPage: null,
          totalCount: 100
        };
      });
      const readGateway = { getTopic, getReplies };
      const parent = await renderTopicController({
        getActive: () => focused,
        location:
          parentFloor === 1 ? undefined : { kind: 'reply', target: { floor: parentFloor, commentId: parentFloor } },
        readGateway
      });
      let child: Awaited<ReturnType<typeof renderTopicController>> | undefined;
      try {
        await waitFor(() => expect(parent.result.current.controller.topicReplies).toEqual([parentReply]));
        focused = false;
        await parent.rerender(undefined);
        child = await renderTopicController({
          location: { kind: 'reply', target: { floor: 80, commentId: 80 } },
          readGateway
        });
        await waitFor(() => expect(child?.result.current.controller.topicReplies).toEqual([childReply]));
        expect(child.result.current.controller.topicQueryKey).toEqual(parent.result.current.controller.topicQueryKey);
        const returnFocus = async () => {
          focused = true;
          await parent.rerender(undefined);
        };
        if (focusOrder === 'before') {
          await returnFocus();
          expect(parent.result.current.controller.topicReplies).toEqual([parentReply]);
        }
        await child.unmount();
        child = undefined;
        if (focusOrder === 'after') await returnFocus();
        expect(parent.result.current.controller.topicReplies).toEqual([parentReply]);
        expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual(
          parentFloor === 1 ? ['target'] : ['target', 'target']
        );
      } finally {
        await child?.unmount();
        await parent.unmount();
      }
    }
  );

  it.each([
    { timing: 'before the child closes', childReadIsLate: false },
    { timing: 'after a newer edit in the parent', childReadIsLate: true }
  ])('keeps same-topic windows current when an edit is read back $timing', async ({ childReadIsLate }) => {
    const topic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/topic/1' };
    const parentReply = { ...firstReply, floor: 20, commentId: 20 };
    const childReply = { ...firstReply, floor: 22, commentId: 22 };
    const sharedReply = { ...firstReply, floor: 21, commentId: 21, contentHtml: '<p>old body</p>' };
    const editedReply = {
      ...sharedReply,
      contentHtml: '<p>server edited <strong>body</strong></p>',
      contentMarkdown: 'server edited **body**'
    };
    const newerReply = { ...sharedReply, contentHtml: '<p>latest body</p>', contentMarkdown: 'latest body' };
    const releaseChildRead = Promise.withResolvers<void>();
    const getTopic = jest.fn<TestGetTopic>(async () => ({
      ...firstDetail,
      ...topic,
      replyCount: 100,
      replies: [{ ...sharedReply, likeCount: 2 }]
    }));
    const getReplies = jest.fn<TestGetReplies>(async ({ position }) => {
      const openingWindow =
        position.kind === 'target' ? position.target.floor === 20 : position.kind === 'cursor' && position.page === 2;
      const currentPage = openingWindow ? 2 : 3;
      if (childReadIsLate && position.kind === 'cursor' && !openingWindow) await releaseChildRead.promise;
      return {
        items: openingWindow
          ? [parentReply, position.kind === 'cursor' ? newerReply : { ...sharedReply, liked: true, likeCount: 7 }]
          : [position.kind === 'cursor' ? editedReply : { ...sharedReply, likeCount: 3 }, childReply],
        completeness: 'complete',
        currentPage,
        currentOffset: (currentPage - 1) * 10,
        previousPage: currentPage - 1,
        previousOffset: (currentPage - 2) * 10,
        hasMore: true,
        nextPage: currentPage + 1,
        nextOffset: currentPage * 10,
        totalCount: 100
      };
    });
    const readGateway = { getTopic, getReplies };
    let parentFocused = true;
    const parent = await renderTopicController({
      topic,
      readGateway,
      getActive: () => parentFocused,
      location: { kind: 'reply', target: { floor: 20 } }
    });
    let child: Awaited<ReturnType<typeof renderTopicController>> | undefined;
    try {
      await waitFor(() =>
        expect(parent.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([20, 21])
      );
      const before = parent.result.current.controller.replyPreviousCursor;
      parentFocused = false;
      await parent.rerender(undefined);
      child = await renderTopicController({ topic, readGateway, location: { kind: 'reply', target: { floor: 22 } } });
      await waitFor(() =>
        expect(child?.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([21, 22])
      );
      const detailKey = child.result.current.controller.topicQueryKey;
      const previousDetailReadAt = 123_456;
      const quotePlan = createSessionReadPlan({
        getIdentityBarriers: () => [],
        getSessionEpochs: () => initialForumSessionEpochs,
        getSourceEnabled: () => true
      })('linuxdo', 'reply');
      const quoteKey = forumQueryKeys.reply({
        source: 'linuxdo',
        topicId: topic.id,
        postNumber: 21,
        scope: initialForumSessionEpochs,
        readPlanScope: quotePlan.cacheScope
      });
      await act(async () => {
        appQueryClient.setQueryData(detailKey, appQueryClient.getQueryData(detailKey), {
          updatedAt: previousDetailReadAt
        });
        appQueryClient.setQueryData(quoteKey, { ...sharedReply, likeCount: 5 }, { updatedAt: previousDetailReadAt });
        await appQueryClient.invalidateQueries({ queryKey: detailKey, exact: true, refetchType: 'none' });
      });
      const refreshEdit = (controller: ReturnType<typeof useTopicController>, contentMarkdown: string) =>
        controller.refreshTopicReplies({
          kind: 'edited',
          silent: true,
          target: { kind: 'comment-id', commentId: 21 },
          contentMarkdown
        });
      let pendingChildRefresh: ReturnType<typeof refreshEdit> | undefined;
      if (childReadIsLate) {
        await act(async () => {
          pendingChildRefresh = refreshEdit(child!.result.current.controller, 'server edited __body__');
        });
        await waitFor(() =>
          expect(getReplies).toHaveBeenCalledWith(
            expect.objectContaining({ position: { kind: 'cursor', page: 3, offset: 20 } }),
            expect.anything()
          )
        );
      } else {
        await act(async () => {
          await expect(refreshEdit(child!.result.current.controller, 'server edited __body__')).resolves.toBe(
            'completed'
          );
        });
        expect(child.result.current.controller.topicReplies[0]).toMatchObject({ ...editedReply, likeCount: 3 });
      }
      await child.unmount();
      child = undefined;
      parentFocused = true;
      await parent.rerender(undefined);
      if (childReadIsLate) {
        await act(async () => {
          await expect(refreshEdit(parent.result.current.controller, 'latest body')).resolves.toBe('completed');
          releaseChildRead.resolve();
          await expect(pendingChildRefresh).resolves.toBe('stale');
        });
      }
      await waitFor(() =>
        expect(parent.result.current.controller.topicReplies).toEqual([
          parentReply,
          { ...(childReadIsLate ? newerReply : editedReply), liked: true, likeCount: 7 }
        ])
      );
      expect(parent.result.current.controller.replyPreviousCursor).toEqual(before);
      expect(appQueryClient.getQueryState<TopicDetail>(detailKey)).toMatchObject({
        data: { replies: [{ ...(childReadIsLate ? newerReply : editedReply), likeCount: 2 }] },
        dataUpdatedAt: previousDetailReadAt,
        isInvalidated: true
      });
      expect(appQueryClient.getQueryState(quoteKey)).toMatchObject({
        data: { ...(childReadIsLate ? newerReply : editedReply), likeCount: 5 },
        dataUpdatedAt: previousDetailReadAt
      });
      expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual(
        childReadIsLate ? ['target', 'target', 'cursor', 'cursor'] : ['target', 'target', 'cursor']
      );
    } finally {
      releaseChildRead.resolve();
      await child?.unmount();
      await parent.unmount();
    }
  });

  it('does not reseed old embedded replies after closing a located reply window', async () => {
    const updatedReply = { ...firstReply, contentHtml: '<p>updated first reply</p>' };
    const latestReply = { ...firstReply, floor: 2, commentId: 11, contentHtml: '<p>latest reply</p>' };
    const getTopic = jest.fn<TestGetTopic>(async () => firstDetail);
    const getReplies = jest.fn<TestGetReplies>(async () => ({
      items: [updatedReply, latestReply],
      completeness: 'complete',
      currentPage: 1,
      currentOffset: 0,
      hasMore: false,
      nextPage: null,
      totalCount: 2
    }));
    const readGateway = { getTopic, getReplies };
    const first = await renderTopicController({
      location: { kind: 'reply', target: { commentId: 11 } },
      readGateway
    });
    await waitFor(() => expect(first.result.current.controller.topicReplies).toEqual([updatedReply, latestReply]));
    expect(first.result.current.controller.topicDetail?.replyCount).toBe(2);
    await act(async () => first.unmount());

    const second = await renderTopicController({ readGateway });
    await waitFor(() => expect(second.result.current.controller.topicReplies).toEqual([updatedReply, latestReply]));
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual(['target', 'start']);
    await act(async () => second.unmount());
  });

  it('preserves both cached orders when a reply refresh fails', async () => {
    const detail: TopicDetail = { ...firstDetail, replyCompleteness: 'complete', replyHasMore: false };
    const getTopic = jest.fn<TestGetTopic>(async () => detail);
    const getReplies = jest.fn<TestGetReplies>(async () => {
      throw new Error('offline');
    });
    const readGateway = { getTopic, getReplies };
    const first = await renderTopicController({ readGateway });
    await waitFor(() => expect(first.result.current.controller.topicReplies).toEqual([firstReply]));
    await act(async () => first.result.current.session.commands.view.changeReplyOrder('newest'));
    await act(async () => {
      await expect(first.result.current.controller.refreshTopicReplies()).resolves.toBe('failed');
    });
    expect(first.result.current.controller.topicReplies).toEqual([firstReply]);
    await act(async () => first.unmount());

    const second = await renderTopicController({ readGateway });
    await waitFor(() => expect(second.result.current.controller.topicReplies).toEqual([firstReply]));
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getReplies).toHaveBeenCalledTimes(1);
    await act(async () => second.unmount());
  });

  it('updates the displayed and history totals after a confirmed reply-only refresh', async () => {
    const commitReaderData = jest.fn<Parameters<typeof useTopicController>[0]['commitReaderData']>();
    const topic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const first = { ...firstReply, floor: 2 };
    const latest = { ...firstReply, floor: 3, commentId: 11 };
    const hook = await renderTopicController({
      commitReaderData,
      topic,
      readGateway: {
        getTopic: async () => ({ ...firstDetail, ...topic, replies: [first] }),
        getReplies: async () => ({
          items: [first, latest],
          completeness: 'complete',
          currentPage: 1,
          hasMore: false,
          nextPage: null,
          totalCount: 2
        })
      }
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([first]));
    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies()).resolves.toBe('completed');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([first, latest]));
    expect(hook.result.current.controller.topicDetail?.replyCount).toBe(2);
    await waitFor(() =>
      expect(commitReaderData).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'topic-summary', topic: expect.objectContaining({ replyCount: 2 }) })
      )
    );
  });

  it.each([0, 2, undefined, -1, NaN])(
    'uses only a confirmed total %s from an adjacent reply window',
    async (totalCount) => {
      const detail = { ...firstDetail, replyCount: 5, replyHasMore: true, replyNextPage: 2 };
      const hook = await renderTopicController({
        readGateway: {
          getTopic: async () => detail,
          getReplies: async () => ({
            items: totalCount === 0 ? [] : [{ ...firstReply, floor: 50 }],
            completeness: 'partial',
            currentPage: 2,
            hasMore: false,
            nextPage: null,
            totalCount
          })
        }
      });
      await waitFor(() => expect(hook.result.current.controller.replyHasMore).toBe(true));
      await act(async () => hook.result.current.controller.loadMoreReplies({ silent: true }));
      expect(hook.result.current.controller.topicDetail?.replyCount).toBe(
        totalCount === 0 || totalCount === 2 ? totalCount : 5
      );
    }
  );

  it('does not publish the total from a canceled reply read', async () => {
    const pending = Promise.withResolvers<RepliesResponse>();
    const getReplies = jest.fn<TestGetReplies>(() => pending.promise);
    const hook = await renderTopicController({ readGateway: { getTopic: async () => firstDetail, getReplies } });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(firstDetail));
    await act(async () => hook.result.current.session.commands.view.changeReplyOrder('newest'));
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    const key = hook.result.current.controller.topicQueryKey;
    await act(async () => appQueryClient.cancelQueries({ queryKey: key }));
    await act(async () =>
      pending.resolve({ items: [], currentPage: 1, hasMore: false, nextPage: null, totalCount: 99 })
    );
    expect(appQueryClient.getQueryData<TopicDetail>(key)?.replyCount).toBe(1);
  });

  it('keeps empty quote projections stable across unrelated rerenders', async () => {
    const getTopic = jest.fn<TestGetTopic>(async () => firstDetail);
    const hook = await renderTopicController({ readGateway: { getTopic } });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(firstDetail));
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
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

  it('keeps dismissed Yaohuo Topic login closed through identity reconciliation until explicit retry', async () => {
    const topic = { ...firstTopic, source: 'yaohuo' as const, url: 'https://www.yaohuo.me/bbs-1.html' };
    let identityBarriers: SessionSource[] = [];
    let identityTrust: SessionRuntimeSnapshot['identityTrust'] = 'none';
    let active = true;
    let sessionEpochs = initialForumSessionEpochs;
    const showYaohuoLogin = jest.fn<(message?: string) => void>();
    const getTopic = jest.fn<TestGetTopic>(async () => {
      const reason = identityBarriers.length
        ? 'identity-pending'
        : identityTrust === 'unknown'
          ? 'identity-unavailable'
          : 'login-required';
      throw Object.assign(new Error(reason), {
        kind: reason === 'login-required' ? 'login-required' : 'ordinary',
        reason,
        source: 'yaohuo'
      });
    });
    const hook = await renderTopicController({
      getActive: () => active,
      getIdentityBarriers: () => identityBarriers,
      getIdentityTrust: () => identityTrust,
      getSessionEpochs: () => sessionEpochs,
      readGateway: { getTopic },
      showYaohuoLogin,
      topic
    });
    await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(1));

    for (const phase of ['open', 'unknown', 'anonymous', 'open', 'anonymous'] as const) {
      const before = getTopic.mock.calls.length;
      identityBarriers = phase === 'open' ? ['yaohuo'] : [];
      identityTrust = phase === 'unknown' ? 'unknown' : 'none';
      if (phase === 'anonymous') sessionEpochs = { ...sessionEpochs, yaohuo: sessionEpochs.yaohuo + 1 };
      await act(async () => hook.rerender(undefined));
      await waitFor(() => expect(getTopic.mock.calls.length).toBeGreaterThan(before));
      await waitFor(() => expect(hook.result.current.controller.topicBusy).toBe(false));
      expect(showYaohuoLogin).toHaveBeenCalledTimes(1);
    }

    await act(async () => hook.rerender(undefined));
    active = false;
    await act(async () => hook.rerender(undefined));
    const beforeBackgroundRead = getTopic.mock.calls.length;
    await act(async () => {
      await appQueryClient
        .fetchQuery({
          queryKey: hook.result.current.controller.topicQueryKey,
          queryFn: ({ signal }) => getTopic({ source: topic.source, id: topic.id, topic, signal }),
          staleTime: 0
        })
        .catch(() => undefined);
    });
    expect(getTopic.mock.calls.length).toBeGreaterThan(beforeBackgroundRead);
    active = true;
    await act(async () => hook.rerender(undefined));
    await waitFor(() => expect(hook.result.current.controller.topicBusy).toBe(false));
    expect(showYaohuoLogin).toHaveBeenCalledTimes(1);

    await act(async () => {
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('stale');
    });
    expect(showYaohuoLogin).toHaveBeenCalledTimes(2);
    identityBarriers = ['yaohuo'];
    await act(async () => hook.rerender(undefined));
    identityBarriers = [];
    await act(async () => hook.rerender(undefined));
    await waitFor(() => expect(hook.result.current.controller.topicBusy).toBe(false));
    expect(showYaohuoLogin).toHaveBeenCalledTimes(2);
  });

  it('rearms Yaohuo reply login for explicit retry, reentrant refresh and changed topic keys', async () => {
    let topic: Topic = { ...firstTopic, source: 'yaohuo', url: 'https://www.yaohuo.me/bbs-1.html' };
    let reenter = false;
    const reentries: Promise<LinuxDoReadResumeOutcome>[] = [];
    const showYaohuoLogin = jest.fn<(message?: string) => void>(() => {
      if (reenter) {
        reenter = false;
        reentries.push(hook.result.current.controller.refreshTopicReplies());
      }
    });
    const hook = await renderTopicController({
      getTopicInput: () => topic,
      readGateway: {
        getTopic: async ({ source, id }) => ({ ...firstDetail, source, id }),
        getReplies: async () => {
          throw Object.assign(new Error('妖火登录已失效'), { kind: 'login-expired', source: 'yaohuo' });
        }
      },
      showYaohuoLogin
    });
    try {
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
      expect(showYaohuoLogin).not.toHaveBeenCalled();
      await act(async () => {
        await hook.result.current.controller.refreshTopicReplies();
      });
      await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(1));
      await act(async () => {
        await hook.result.current.controller.refreshTopicReplies({ kind: 'manual', silent: true });
      });
      expect(showYaohuoLogin).toHaveBeenCalledTimes(1);

      reenter = true;
      await act(async () => {
        await hook.result.current.controller.retryReplies();
      });
      await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(3));
      await Promise.allSettled(reentries);

      topic = { ...topic, id: '2', url: 'https://www.yaohuo.me/bbs-2.html' };
      await act(async () => hook.rerender(undefined));
      await waitFor(() => expect(hook.result.current.controller.topicDetail?.id).toBe('2'));
      await act(async () => {
        await hook.result.current.controller.refreshTopicReplies();
      });
      await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(4));
      topic = { ...topic, id: '1', url: 'https://www.yaohuo.me/bbs-1.html' };
      await act(async () => hook.rerender(undefined));
      await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(5));
      expect(hook.result.current.controller.currentTopicKey).toBe('yaohuo:1');
      await act(async () => hook.rerender(undefined));
      expect(showYaohuoLogin).toHaveBeenCalledTimes(5);
    } finally {
      await hook.unmount();
      await Promise.allSettled(reentries);
    }
  });

  it('does not let an inactive Yaohuo Topic error reopen login over the current source', async () => {
    let active = true;
    let fail = false;
    const topic = { ...firstTopic, source: 'yaohuo' as const, url: 'https://www.yaohuo.me/bbs-1.html' };
    const detail = { ...firstDetail, ...topic };
    const showYaohuoLogin = jest.fn<(message?: string) => void>();
    const getTopic = jest.fn<TestGetTopic>(async () => {
      if (fail) throw Object.assign(new Error('妖火登录已失效'), { kind: 'login-expired', source: 'yaohuo' });
      return detail;
    });
    const previous = await renderTopicController({
      getActive: () => active,
      readGateway: { getTopic },
      showYaohuoLogin,
      topic
    });
    await waitFor(() => expect(previous.result.current.controller.topicDetail).toEqual(detail));
    active = false;
    await act(async () => previous.rerender(undefined));
    const current = await renderTopicController({ readGateway: { getTopic: async () => firstDetail } });
    await waitFor(() => expect(current.result.current.controller.topicDetail).toEqual(firstDetail));
    fail = true;
    await act(async () => {
      await appQueryClient
        .fetchQuery({
          queryKey: previous.result.current.controller.topicQueryKey,
          queryFn: ({ signal }) => getTopic({ source: topic.source, id: topic.id, topic, signal }),
          staleTime: 0
        })
        .catch(() => undefined);
    });
    expect(appQueryClient.getQueryState(previous.result.current.controller.topicQueryKey)?.error).toEqual(
      expect.objectContaining({ kind: 'login-expired' })
    );
    expect(getTopic).toHaveBeenCalledTimes(2);
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(current.result.current.controller.topicDetail?.source).toBe('nodeseek');
    expect(showYaohuoLogin).not.toHaveBeenCalled();
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
      expect.objectContaining({
        plan: expect.objectContaining({ cacheScope: expect.stringContaining('authenticated:') })
      })
    );
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
  });

  it('exposes a non-V2EX partial reply window without another request', async () => {
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
      if (request.position.kind === 'start') {
        if (request.order === 'newest') return pendingTail.promise;
        return { items: detail.replies, currentPage: 1, hasMore: true, nextPage: 2, totalCount: 45 };
      }
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
    expect(getReplies).toHaveBeenCalledTimes(4);
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

      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(getReplies).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('refreshes only the V2EX start window after loading a later page and keeps both on failure', async () => {
    const replies = Array.from({ length: 147 }, (_, index) => ({
      ...firstReply,
      floor: index + 1,
      commentId: index + 101
    }));
    const topic = { ...firstTopic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/1', replyCount: 147 };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replies: replies.slice(0, 100),
      replyCompleteness: 'complete',
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: null
    };
    const getTopic = jest.fn<TestGetTopic>(async () => detail);
    const getReplies = jest.fn<TestGetReplies>(async ({ position }) => {
      const second = position.kind === 'cursor' && position.page === 2;
      return {
        items: second ? replies.slice(100) : detail.replies.map((reply) => ({ ...reply, contentHtml: '<p>fresh</p>' })),
        completeness: 'complete',
        currentPage: second ? 2 : 1,
        previousPage: second ? 1 : null,
        hasMore: !second,
        nextPage: second ? null : 2,
        totalCount: 147
      };
    });
    const hook = await renderTopicController({ readGateway: { getTopic, getReplies }, topic });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(100));
    await act(async () => {
      await expect(hook.result.current.controller.loadMoreReplies({ silent: true })).resolves.toBe('completed');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual(replies));
    getReplies.mockClear();
    getReplies.mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      await expect(hook.result.current.controller.refreshTopicReplies()).resolves.toBe('failed');
    });
    expect(hook.result.current.controller.topicReplies).toEqual(replies);
    expect(hook.result.current.controller.repliesError?.message).toBe('offline');
    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('completed');
    });
    expect(getReplies.mock.calls.map(([request]) => request.position)).toEqual([{ kind: 'start' }, { kind: 'start' }]);
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toHaveLength(100));
    expect(hook.result.current.controller.topicDetail?.contentHtml).toBe(detail.contentHtml);
    expect(hook.result.current.controller.topicReplies[0].contentHtml).toBe('<p>fresh</p>');
    expect(hook.result.current.controller.repliesError).toBeNull();
    expect(hook.result.current.controller.replyHasMore).toBe(true);
    expect(getTopic).toHaveBeenCalledTimes(1);
  });

  it('restarts a centered newest window and discards the outgoing adjacent read', async () => {
    const opening = { ...firstReply, floor: 1 };
    const target = { ...firstReply, floor: 35, commentId: 35 };
    const tail = { ...firstReply, floor: 80, commentId: 80 };
    const updatedTail = { ...tail, floor: 81, commentId: 81 };
    const getTopic = jest.fn<TestGetTopic>(async () => ({
      ...firstDetail,
      replies: [opening],
      replyCount: 80,
      replyCompleteness: 'complete',
      replyHasMore: true,
      replyNextPage: 2
    }));
    const adjacent = Promise.withResolvers<RepliesResponse>();
    const refresh = Promise.withResolvers<RepliesResponse>();
    const getReplies = jest
      .fn<TestGetReplies>()
      .mockResolvedValueOnce({ items: [tail], currentPage: 8, hasMore: true, nextPage: 7 })
      .mockResolvedValueOnce({ items: [target], currentPage: 4, previousPage: 5, hasMore: true, nextPage: 3 })
      .mockImplementationOnce(() => adjacent.promise)
      .mockImplementationOnce(() => refresh.promise);
    const notify = jest.fn();
    const hook = await renderTopicController({ notify, readGateway: { getTopic, getReplies } });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([opening]));
    await act(async () => hook.result.current.session.commands.view.changeReplyOrder('newest'));
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([tail]));
    await act(async () => {
      await expect(hook.result.current.controller.locateReply({ floor: 35 }, { silent: true })).resolves.toBe(
        'completed'
      );
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));

    let loadMore: Promise<LinuxDoReadResumeOutcome>;
    await act(async () => {
      loadMore = hook.result.current.controller.loadMoreReplies();
    });
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(3));
    const adjacentSignal = getReplies.mock.calls[2][0].signal;
    let refreshWindow: Promise<LinuxDoReadResumeOutcome>;
    await act(async () => {
      refreshWindow = hook.result.current.controller.refreshTopicReplies();
    });
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(4));
    expect(adjacentSignal?.aborted).toBe(true);
    expect(hook.result.current.controller.topicReplies).toEqual([target]);
    await act(async () => {
      await hook.result.current.controller.loadPreviousReplies({ silent: true });
      await hook.result.current.controller.loadMoreReplies({ silent: true });
    });
    expect(getReplies.mock.calls.map(([request]) => [request.order, request.position.kind])).toEqual([
      ['newest', 'start'],
      ['newest', 'target'],
      ['newest', 'cursor'],
      ['newest', 'start']
    ]);
    await act(async () => {
      refresh.resolve({ items: [updatedTail], currentPage: 9, hasMore: true, nextPage: 8 });
      await expect(refreshWindow).resolves.toBe('completed');
      adjacent.resolve({ items: [{ ...target, floor: 25 }], currentPage: 3, hasMore: true, nextPage: 2 });
      await expect(loadMore).resolves.toBe('stale');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([updatedTail]));
    expect(notify).not.toHaveBeenCalledWith('已加载 1 条回复');
    expect(hook.result.current.controller.replyNextPage).toBe(8);
    expect(hook.result.current.controller.replyHasPrevious).toBe(false);
    expect(getTopic).toHaveBeenCalledTimes(1);
  });

  it.each(['v2ex', 'nodeseek', 'yaohuo'] as const)(
    'counts one local visit per %s entry while updating the history summary on refresh',
    async (source) => {
      const topic = { ...firstTopic, source };
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        replyCompleteness: 'complete',
        replyHasMore: false
      };
      const latest = { ...firstReply, floor: 2, commentId: 11 };
      const commitReaderData = jest.fn<Parameters<typeof useTopicController>[0]['commitReaderData']>();
      const getTopic = jest.fn<TestGetTopic>(async () => detail);
      const getReplies = jest.fn<TestGetReplies>(async () => ({
        items: [firstReply, latest],
        completeness: 'complete',
        currentPage: 1,
        hasMore: false,
        nextPage: null,
        totalCount: 2
      }));
      const options = { readGateway: { getTopic, getReplies }, topic, commitReaderData };
      const recordedCommands = () => commitReaderData.mock.calls.map(([command]) => command);
      const hook = await renderTopicController(options);
      await waitFor(() => expect(recordedCommands().map(({ type }) => type)).toEqual(['visit']));
      await act(async () => {
        await expect(hook.result.current.controller.refreshTopicReplies()).resolves.toBe('completed');
      });
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply, latest]));
      expect(getTopic).toHaveBeenCalledTimes(1);
      expect(recordedCommands().map(({ type }) => type)).toEqual(['visit', 'topic-summary']);
      expect(recordedCommands()[1]).toMatchObject({ type: 'topic-summary', topic: { replyCount: 2 } });

      getTopic.mockResolvedValue({ ...detail, title: 'Updated title', replyCount: 2, replies: [firstReply, latest] });
      await act(async () => {
        await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('completed');
      });
      await waitFor(() => expect(hook.result.current.controller.topicDetail?.title).toBe('Updated title'));
      expect(recordedCommands().map(({ type }) => type)).toEqual(['visit', 'topic-summary', 'topic-summary']);
      await hook.unmount();

      const reentered = await renderTopicController(options);
      await waitFor(() => expect(recordedCommands().filter(({ type }) => type === 'visit')).toHaveLength(2));
      await reentered.unmount();
    }
  );

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
    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getReplies).not.toHaveBeenCalled();

    await act(async () => {
      await expect(hook.result.current.controller.refreshWholeTopic()).resolves.toBe('completed');
    });

    expect(getTopic).toHaveBeenCalledTimes(2);
    expect(getReplies).not.toHaveBeenCalled();
    expect(hook.result.current.controller.topicReplies).toEqual(prefix);
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
        location: { kind: 'reply', target: { floor: 20 } },
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
      location: { kind: 'reply', target: { floor: 20 } }
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
      location: { kind: 'reply', target: { floor: 155 } }
    });

    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    await act(async () => {
      await hook.result.current.controller.locateReply({ floor: 155 });
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));

    expect(hook.result.current.controller.replyPreviousCursor).toEqual({ kind: 'cursor', page: 15, offset: 140 });
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
    expect(hook.result.current.controller.replyPreviousCursor).toBeUndefined();
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

  it.each([false, true])('keeps a late target window subordinate to reader cancellation=%s', async (cancelled) => {
    const target = { ...firstReply, floor: 50, commentId: 150, author: 'late-target' };
    const detail: TopicDetail = {
      ...firstDetail,
      replyCount: 50,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const targetPage: RepliesResponse = {
      items: [target],
      currentPage: 5,
      currentOffset: 40,
      previousPage: 4,
      previousOffset: 30,
      hasMore: false,
      nextPage: null,
      nextOffset: null
    };
    const pending = Promise.withResolvers<RepliesResponse>();
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      if (replyRequestTarget(request)?.floor === 50) return pending.promise;
      return { items: [firstReply], currentPage: 1, hasMore: true, nextPage: 2, nextOffset: 10 };
    });
    const hook = await renderTopicController({
      readGateway: { getTopic: jest.fn<TestGetTopic>(async () => detail), getReplies }
    });
    let request: Promise<LinuxDoReadResumeOutcome> | undefined;
    try {
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
      const originalReplies = hook.result.current.controller.topicReplies;
      await act(async () => {
        request = hook.result.current.controller.locateReply({ floor: 50 }, { silent: true });
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(getReplies.mock.calls.some(([value]) => replyRequestTarget(value)?.floor === 50)).toBe(true)
      );
      await waitFor(() => expect(hook.result.current.controller.loadingMoreReplies).toBe(true));
      if (cancelled) hook.result.current.controller.cancelReplyLocation();
      if (cancelled) await waitFor(() => expect(hook.result.current.controller.loadingMoreReplies).toBe(false));
      await act(async () => {
        pending.resolve(targetPage);
        await request;
      });
      if (cancelled) expect(hook.result.current.controller.topicReplies).toBe(originalReplies);
      else await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([target]));
      await expect(request).resolves.toBe(cancelled ? 'stale' : 'completed');
    } finally {
      await act(async () => {
        pending.resolve(targetPage);
        await request;
      });
      await hook.unmount();
    }
  });

  it('preserves a newer ordinary refresh when the reader cancels an older location', async () => {
    const target = { ...firstReply, floor: 50, commentId: 150, author: 'old-target' };
    const refreshed = { ...firstReply, author: 'current-refresh' };
    const detail: TopicDetail = {
      ...firstDetail,
      replyCount: 50,
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 10
    };
    const refreshedDetail: TopicDetail = {
      ...firstDetail,
      replies: [refreshed],
      replyCount: 1,
      replyHasMore: false,
      replyNextPage: null,
      replyNextOffset: null
    };
    const pendingTarget = Promise.withResolvers<RepliesResponse>();
    const pendingDetail = Promise.withResolvers<TopicDetail>();
    const getTopic = jest
      .fn<TestGetTopic>()
      .mockResolvedValueOnce(detail)
      .mockImplementationOnce(async () => pendingDetail.promise);
    const getReplies = jest.fn<TestGetReplies>(async (request) => {
      if (replyRequestTarget(request)?.floor === 50) return pendingTarget.promise;
      return { items: [refreshed], currentPage: 1, hasMore: false, nextPage: null };
    });
    const targetPage: RepliesResponse = { items: [target], currentPage: 5, hasMore: false, nextPage: null };
    const hook = await renderTopicController({ readGateway: { getTopic, getReplies } });
    let locationRequest: Promise<LinuxDoReadResumeOutcome> | undefined;
    let refreshRequest: Promise<LinuxDoReadResumeOutcome> | undefined;
    try {
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
      await act(async () => {
        locationRequest = hook.result.current.controller.locateReply({ floor: 50 });
        await Promise.resolve();
      });
      await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
      await act(async () => {
        refreshRequest = hook.result.current.controller.refreshWholeTopic();
        await Promise.resolve();
      });
      await waitFor(() => expect(getTopic).toHaveBeenCalledTimes(2));
      hook.result.current.controller.cancelReplyLocation();
      await waitFor(() => expect(hook.result.current.controller.loadingMoreReplies).toBe(false));
      await act(async () => {
        pendingTarget.resolve(targetPage);
        pendingDetail.resolve(refreshedDetail);
        await Promise.all([locationRequest, refreshRequest]);
      });
      await expect(locationRequest).resolves.toBe('stale');
      await expect(refreshRequest).resolves.toBe('completed');
      expect(hook.result.current.controller.topicReplies).toEqual([refreshed]);
    } finally {
      await act(async () => {
        pendingTarget.resolve(targetPage);
        pendingDetail.resolve(refreshedDetail);
        await Promise.all([locationRequest, refreshRequest]);
      });
      await hook.unmount();
    }
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
    const topic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const oldest = { ...firstReply, floor: 2, commentId: 12, author: 'oldest-preserved' };
    const newest = { ...firstReply, floor: 20, commentId: 120, author: 'newest-preserved' };
    const submitted = { ...firstReply, floor: 21, commentId: 121, author: 'submitted' };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
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
      request.order === 'oldest'
        ? {
            items: [oldest],
            currentPage: 1,
            currentOffset: 0,
            hasMore: false,
            nextPage: null,
            totalCount: 21
          }
        : request.position.kind === 'target'
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
    const hook = await renderTopicController({ onReplyLocationResolved, readGateway: { getReplies, getTopic }, topic });
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
      refresh = hook.result.current.controller.refreshTopicReplies({
        kind: 'created',
        createdTarget: { commentId: 121, floor: 21 },
        silent: true
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(2));
    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('oldest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([oldest]));
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(3));
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
      location: { kind: 'reply', target: { commentId: 31 } }
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

  it('rejects an explicit target window without a matching identity and retains the readable replies', async () => {
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
      await expect(hook.result.current.controller.locateReply({ floor: 90 }, { silent: true })).resolves.toBe('failed');
    });

    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({ position: { kind: 'target', target: { floor: 90 } } }),
      expect.any(Object)
    );
    expect(hook.result.current.controller.topicReplies).toEqual([firstReply]);
  });

  it.each(['wrong-author', 'duplicate-floor', 'missing'] as const)(
    'does not commit a V2EX %s window for an explicit reference',
    async (failure) => {
      const topic: Topic = { ...firstTopic, source: 'v2ex', url: 'https://www.v2ex.com/t/1' };
      const detail: TopicDetail = { ...firstDetail, ...topic, replyHasMore: true, replyNextPage: 2 };
      const target = { ...firstReply, floor: 101, author: 'alice', commentId: 1101 };
      const wrong = { ...target, author: 'bob', commentId: 1102 };
      const getReplies = jest.fn<TestGetReplies>(async () => ({
        items: failure === 'missing' ? [] : failure === 'duplicate-floor' ? [target, wrong] : [wrong],
        currentPage: 2,
        previousPage: 1,
        hasMore: false,
        nextPage: null,
        nextOffset: null
      }));
      const hook = await renderTopicController({ topic, readGateway: { getTopic: async () => detail, getReplies } });
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
      await act(async () => {
        await expect(
          hook.result.current.controller.locateReply({ floor: 101, expectedAuthorUsername: 'alice' }, { silent: true })
        ).resolves.toBe('failed');
      });
      expect(hook.result.current.controller.topicReplies).toEqual([firstReply]);
      expect(getReplies).toHaveBeenCalledTimes(1);
    }
  );

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
      location: { kind: 'reply', target: { floor: 12 } },
      topic
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([reply]));
    await expect(hook.result.current.controller.locateReply({ floor: 12 })).resolves.toBe('completed');
    await expect(
      hook.result.current.controller.locateReply({ floor: 12, expectedAuthorUsername: 'BOB' })
    ).resolves.toBe('completed');
    expect(getReplies).not.toHaveBeenCalled();
    await expect(hook.result.current.controller.locateReply({ floor: 99 }, { silent: true })).resolves.toBe('failed');
    expect(getReplies).toHaveBeenCalledTimes(1);
    expect(getReplies).toHaveBeenCalledWith(
      expect.objectContaining({ position: { kind: 'target', target: { floor: 99 } } }),
      expect.anything()
    );
  });

  it('consumes a failed route target even if ordinary pagination finds it later', async () => {
    const topic: Topic = { ...firstTopic, source: 'v2ex', url: 'https://www.v2ex.com/t/1', replyCount: 101 };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replyCompleteness: 'partial',
      replyHasMore: true,
      replyNextPage: 2
    };
    const target = { ...firstReply, floor: 101, commentId: 1101 };
    const getReplies = jest.fn<TestGetReplies>(async ({ position }) => {
      if (position?.kind === 'target') throw new Error('目标楼层读取失败');
      return { items: [target], currentPage: 2, hasMore: false, nextPage: null, nextOffset: null };
    });
    const hook = await renderTopicController({
      topic,
      location: { kind: 'reply', target: { floor: 101 } },
      readGateway: { getTopic: async () => detail, getReplies }
    });
    await waitFor(() => expect(getReplies).toHaveBeenCalled());
    await act(async () => {});
    expect(hook.result.current.controller.readingEntry.location).toBeUndefined();
    await act(async () => {
      await hook.result.current.controller.loadMoreReplies();
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toContainEqual(target));
    expect(hook.result.current.controller.readingEntry.location).toBeUndefined();
  });

  it('consumes a dragged-away route target before ordinary pagination arrives, scoped to the current request id', async () => {
    const topic: Topic = { ...firstTopic, source: 'v2ex', url: 'https://www.v2ex.com/t/1', replyCount: 101 };
    const detail: TopicDetail = {
      ...firstDetail,
      ...topic,
      replyCompleteness: 'partial',
      replyHasMore: true,
      replyNextPage: 2
    };
    const target = { ...firstReply, floor: 101, commentId: 1101 };
    const page = { items: [target], currentPage: 2, hasMore: false, nextPage: null, nextOffset: null };
    const pendingTarget = Promise.withResolvers<RepliesResponse>();
    const location: TopicLocationTarget = { kind: 'reply', target: { floor: target.floor } };
    let focused = true;
    let requestId = 1;
    const getReplies = jest.fn<TestGetReplies>(async ({ position }) =>
      position.kind === 'target' ? pendingTarget.promise : page
    );
    const hook = await renderTopicController({
      topic,
      location,
      getActive: () => focused,
      getLocationRequestId: () => requestId,
      readGateway: { getTopic: async () => detail, getReplies }
    });
    await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(1));
    await act(async () => hook.result.current.controller.cancelReplyLocation());
    await act(async () => {
      pendingTarget.resolve(page);
      await hook.result.current.controller.loadMoreReplies();
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies).toContainEqual(target));
    expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual(['target', 'cursor']);
    expect(hook.result.current.controller.readingEntry.location).toBeUndefined();

    const { topicQueryKey } = hook.result.current.controller;
    const repliesKey = forumQueryKeys.replies(topicQueryKey, 'oldest', 'public:omit');
    expect(appQueryClient.getQueryData(repliesKey)).toBeDefined();
    focused = false;
    await hook.rerender(undefined);
    appQueryClient.removeQueries({ queryKey: repliesKey, exact: true });
    focused = true;
    await hook.rerender(undefined);
    await act(async () => {});
    expect(getReplies.mock.calls.filter(([request]) => request.position.kind === 'target')).toHaveLength(1);

    requestId++;
    await hook.rerender(undefined);
    expect(hook.result.current.controller.readingEntry.location).toEqual(location);
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
      location: { kind: 'reply', target: { floor: 2 } },
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
      getLocationRequestId: () => requestId,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => firstDetail),
        getReplies
      },
      location: { kind: 'reply', target: { floor: 99 } }
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
      location: { kind: 'reply', target: { floor: 99, commentId: 999 } }
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
    const onNodeSeekTopicVerificationRequired = jest.fn<(message: string, recovery: ReadRecovery) => void>();
    const hook = await renderTopicController({
      onNodeSeekTopicVerificationRequired,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => firstDetail),
        getReplies
      },
      location: { kind: 'reply', target: { floor: 90, commentId: 900 } }
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
      location: { kind: 'reply', target: { floor: 90, commentId: 900 } },
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
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: ReadRecovery) => void>();
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

  it('keeps the current reply window when a linux.do comments refresh is canceled during verification', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const pending = Promise.withResolvers<RepliesResponse>();
    const oldReply = { ...firstReply, floor: 2, commentId: 11, contentHtml: '<p>canceled refresh</p>' };
    const freshReply = { ...firstReply, floor: 3, commentId: 12, contentHtml: '<p>fresh refresh</p>' };
    const page = (reply: Reply): RepliesResponse => ({
      items: [reply],
      currentPage: 1,
      hasMore: false,
      nextPage: null
    });
    const getReplies = jest
      .fn<TestGetReplies>()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockResolvedValueOnce(page(freshReply));
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: ReadRecovery) => void>();
    const hook = await renderTopicController({
      topic: linuxTopic,
      showLinuxDoVerification,
      readGateway: { getTopic: async () => ({ ...firstDetail, ...linuxTopic }), getReplies }
    });
    try {
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([firstReply]));
      const refresh = async () => {
        await act(async () => {
          await expect(hook.result.current.controller.refreshTopicReplies()).resolves.toBe('verification-required');
        });
      };
      await refresh();
      const verification = new AbortController();
      let recovering: ReturnType<ReadRecovery['resume']> | undefined;
      await act(async () => {
        recovering = showLinuxDoVerification.mock.lastCall?.[1]?.resume(verification.signal);
      });
      await waitFor(() => expect(getReplies).toHaveBeenCalledTimes(2));
      const resumedSignal = getReplies.mock.lastCall?.[0].signal;
      await act(async () => {
        verification.abort();
        pending.resolve(page(oldReply));
        await expect(recovering).resolves.toBe('stale');
      });
      expect(resumedSignal?.aborted).toBe(true);
      expect(hook.result.current.controller.topicReplies).toEqual([firstReply]);

      await refresh();
      await act(async () => {
        await expect(showLinuxDoVerification.mock.lastCall?.[1]?.resume(new AbortController().signal)).resolves.toBe(
          'completed'
        );
      });
      await waitFor(() => expect(hook.result.current.controller.topicReplies).toEqual([freshReply]));
      expect(getReplies.mock.calls.map(([request]) => request.position.kind)).toEqual([
        'start',
        'start',
        'start',
        'start'
      ]);
    } finally {
      pending.resolve(page(oldReply));
      await act(() => hook.unmount());
    }
  });

  it.each(['oldest', 'newest'] as const)(
    'anchors the created NodeSeek reply and retains loaded content through adjacent pages in %s order',
    async (order) => {
      const topic = { ...firstTopic, replyCount: undefined };
      const initial = Array.from({ length: 10 }, (_, i) => ({ ...firstReply, floor: i + 1, commentId: 100 + i + 1 }));
      const detail: TopicDetail = {
        ...firstDetail,
        ...topic,
        replies: initial,
        replyHasMore: true,
        replyNextPage: 2,
        replyNextOffset: 10
      };
      const getTopic = jest.fn<TestGetTopic>(async () => detail);
      const requestedPages: number[] = [];
      const fetcher = jest.fn(async (input: string) => {
        const page = Number(input.match(/post-1-(\d+)/)?.[1]);
        requestedPages.push(page);
        const floors = page === 4 ? [31, 32, 33] : Array.from({ length: 10 }, (_, i) => (page - 1) * 10 + i + 1);
        const payload = Buffer.from(
          JSON.stringify({
            postData: {
              postId: 1,
              postPage: page,
              postPageCount: 4,
              title: 'First',
              comments: [...(page === 1 ? [0] : []), ...floors].map((floor) => ({
                commentId: 100 + floor,
                floorIndex: floor,
                poster: { name: floor === 33 ? 'other' : 'alice', uid: floor === 33 ? 8 : 7 },
                markdown: `测试 ${floor}`,
                time: { createdDate: '2026-09-18T10:00:00Z' }
              }))
            }
          })
        ).toString('base64');
        return new Response(`<script>window.payload="${payload}"</script>`);
      });
      const getReplies = jest.fn<TestGetReplies>((request) => getNodeSeekReplies(request.id, { ...request, fetcher }));
      let location: TopicLocationTarget | undefined;
      const onReplyLocationResolved = jest.fn((target: TopicLocationTarget) => {
        location = target;
      });
      const hook = await renderTopicController({
        topic,
        getLocation: () => location,
        onReplyLocationResolved,
        readGateway: { getReplies, getTopic }
      });
      await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
      await act(async () => {
        hook.result.current.session.commands.view.changeReplyOrder(order);
      });
      await waitFor(() =>
        expect(hook.result.current.controller.topicReplies[0]?.floor).toBe(order === 'newest' ? 33 : 1)
      );
      requestedPages.length = 0;
      getReplies.mockClear();
      getTopic.mockClear();
      await act(async () => {
        await expect(
          hook.result.current.controller.refreshTopicReplies({
            kind: 'created',
            silent: true,
            createdTarget: { floor: 32, pageHint: 4 }
          })
        ).resolves.toBe('completed');
      });
      await act(async () => {
        hook.rerender(undefined);
      });
      expect(requestedPages).toEqual([4]);
      expect(getTopic).not.toHaveBeenCalled();
      expect(onReplyLocationResolved).toHaveBeenCalledTimes(1);
      expect(onReplyLocationResolved).toHaveBeenCalledWith({
        kind: 'reply',
        target: { commentId: 132, floor: 32, pageHint: 4 }
      });
      expect(hook.result.current.controller.topicReplies.map((r) => r.floor)).toEqual(
        order === 'oldest' ? [31, 32, 33] : [33, 32, 31]
      );
      expect(hook.result.current.session.state.replyOrder).toBe(order);
      for (const page of [3, 2, 1]) {
        const retainedReplies = hook.result.current.controller.topicReplies;
        const retainedContent = retainedReplies.map((reply) =>
          requirePreparedForumContent(reply.preparedContent, reply.contentHtml)
        );
        await act(async () => {
          await (order === 'oldest'
            ? hook.result.current.controller.loadPreviousReplies()
            : hook.result.current.controller.loadMoreReplies());
        });
        const expected = Array.from({ length: 34 - ((page - 1) * 10 + 1) }, (_, i) => (page - 1) * 10 + 1 + i);
        expect(hook.result.current.controller.topicReplies.map((r) => r.floor)).toEqual(
          order === 'oldest' ? expected : expected.reverse()
        );
        const currentReplies = new Map(
          hook.result.current.controller.topicReplies.map((reply) => [reply.commentId, reply])
        );
        retainedReplies.forEach((reply, index) => {
          const current = currentReplies.get(reply.commentId);
          expect(current).toBe(reply);
          expect(current?.preparedContent).toBe(reply.preparedContent);
          expect(requirePreparedForumContent(current?.preparedContent, current?.contentHtml).rows).toBe(
            retainedContent[index]?.rows
          );
        });
      }
      expect(requestedPages).toEqual([4, 3, 2, 1]);
      expect(onReplyLocationResolved).toHaveBeenCalledTimes(1);
      expect(
        order === 'oldest'
          ? hook.result.current.controller.replyHasPrevious
          : hook.result.current.controller.replyHasMore
      ).toBe(false);
    }
  );

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

    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([31]));
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
    expect(getReplies.mock.calls.map(([request]) => [request.order, request.position, request.replyCount])).toEqual([
      ['oldest', { kind: 'start' }, 31],
      ['newest', { kind: 'start' }, 31],
      ['newest', { kind: 'start' }, 30]
    ]);
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([30]));
  });

  it('keeps a failed write refresh visible and retries its exact tail window', async () => {
    const topic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const detail = {
      ...firstDetail,
      ...topic,
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
      const latestFloor = request.position.kind === 'target' ? 21 : 20;
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
    const hook = await renderTopicController({ readGateway: { getReplies, getTopic }, topic });

    await act(async () => {
      hook.result.current.session.commands.view.changeReplyOrder('newest');
    });
    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([20]));
    await act(async () => {
      await expect(
        hook.result.current.controller.refreshTopicReplies({
          kind: 'created',
          createdTarget: { commentId: 121, floor: 21 },
          silent: true
        })
      ).resolves.toBe('failed');
    });

    expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([20]);
    await waitFor(() => expect(hook.result.current.controller.repliesError?.message).toContain('未确认回复窗口页码'));
    await act(async () => {
      await expect(hook.result.current.controller.retryReplies()).resolves.toBe('completed');
    });

    await waitFor(() => expect(hook.result.current.controller.topicReplies.map(({ floor }) => floor)).toEqual([21]));
    expect(hook.result.current.controller.repliesError).toBeNull();
    expect(getReplies.mock.calls.map(([request]) => request.replyCount)).toEqual([20, 20, 20]);
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
    });
    await act(async () => {
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
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: ReadRecovery) => void>();
    const hook = await renderTopicController({ readGateway: { getTopic }, showLinuxDoVerification, topic: linuxTopic });

    await act(async () => {
      await hook.result.current.controller.openTopic(linuxTopic);
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery?.isCurrent?.()).toBe(true);
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

  it.each(['leave', 'epoch', 'disabled'])('rejects a captured detail recovery after %s', async (change) => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    let active = true;
    let enabled = true;
    let epochs = initialForumSessionEpochs;
    const getTopic = jest.fn<TestGetTopic>(async () => {
      throw new LinuxDoCloudflareError();
    });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: ReadRecovery) => void>();
    const hook = await renderTopicController({
      topic: linuxTopic,
      readGateway: { getTopic },
      showLinuxDoVerification,
      getActive: () => active,
      getSourceEnabled: () => enabled,
      getSessionEpochs: () => epochs
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalled());
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    if (change === 'leave') active = false;
    if (change === 'disabled') enabled = false;
    if (change === 'epoch') epochs = { ...epochs, linuxdo: epochs.linuxdo + 1 };
    await act(async () => hook.rerender(undefined));
    const attempts = getTopic.mock.calls.length;
    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('stale');
    });
    expect(getTopic).toHaveBeenCalledTimes(attempts);
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

  it('only prefetches currently visible quote authors after an account change', async () => {
    let epochs = initialForumSessionEpochs;
    let active = true;
    const topic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const detail = { ...firstDetail, ...topic };
    const getReply = jest.fn<TestGetReply>(async ({ floor }) => ({
      author: '昵称',
      floor,
      contentHtml: '<p>正文</p>',
      createdAt: ''
    }));
    const hook = await renderTopicController({
      topic,
      getActive: () => active,
      getSessionEpochs: () => epochs,
      readGateway: {
        getTopic: jest.fn<TestGetTopic>(async () => {
          if (epochs.linuxdo === 1) throw new Error('主题不可见');
          return detail;
        }),
        getReply
      }
    });
    const readAuthor = (postNumber: number) =>
      hook.result.current.controller.toggleTopicBodyQuote({
        instanceKey: 'author:linuxdo:200:' + postNumber,
        prefetch: 'author',
        reference: { source: 'linuxdo', topicId: '200', postNumber }
      });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    const earlierViewport = hook.result.current.controller.toggleTopicBodyQuote;
    await act(async () => {
      for (const floor of [2, 3, 4]) await readAuthor(floor);
    });
    await waitFor(() => expect(Object.keys(hook.result.current.controller.loadedQuotedReplies)).toHaveLength(3));
    active = false;
    await hook.rerender(undefined);
    epochs = { ...epochs, linuxdo: epochs.linuxdo + 1 };
    await hook.rerender(undefined);
    active = true;
    await hook.rerender(undefined);
    await waitFor(() => expect(hook.result.current.controller.topicError).toBeTruthy());
    expect(getReply).toHaveBeenCalledTimes(3);
    expect(hook.result.current.controller.loadedQuotedReplies).toEqual({});
    epochs = { ...epochs, linuxdo: epochs.linuxdo + 1 };
    await hook.rerender(undefined);
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(detail));
    await act(() => readAuthor(4));
    await waitFor(() =>
      expect(Object.keys(hook.result.current.controller.loadedQuotedReplies)).toEqual(['linuxdo:200:4'])
    );
    await act(async () => {
      await earlierViewport({
        instanceKey: 'author:linuxdo:200:5',
        prefetch: 'author',
        reference: { source: 'linuxdo', topicId: '200', postNumber: 5 }
      });
    });
    expect(Object.keys(hook.result.current.controller.loadedQuotedReplies)).toEqual(['linuxdo:200:4']);
    expect(getReply).toHaveBeenCalledTimes(4);
  });

  it('keeps a nickname-only floor out of image previews until the reader opens its quote', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const reference = { source: 'linuxdo' as const, topicId: '200', postNumber: 7 };
    const referenceKey = 'linuxdo:200:7';
    const quoted: Reply = {
      author: '昵称',
      floor: 7,
      contentHtml: '<img src="https://img.example/foreign.png">',
      createdAt: ''
    };
    const getReply = jest.fn<TestGetReply>(async () => quoted);
    const hook = await renderTopicController({
      topic: linuxTopic,
      readGateway: { getTopic: jest.fn<TestGetTopic>(async () => linuxDetail), getReply }
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(linuxDetail));
    await act(() =>
      hook.result.current.controller.toggleTopicBodyQuote({
        instanceKey: 'author:' + referenceKey,
        prefetch: 'author',
        reference
      })
    );
    await waitFor(() => expect(hook.result.current.controller.loadedQuotedReplies[referenceKey]).toEqual(quoted));
    expect(hook.result.current.controller.authorOnlyQuotedReferences?.has(referenceKey)).toBe(true);
    const openQuote = () =>
      hook.result.current.controller.toggleTopicBodyQuote({ instanceKey: 'reply:1:' + referenceKey, reference });
    await act(openQuote);
    expect(hook.result.current.controller.authorOnlyQuotedReferences?.has(referenceKey)).toBeFalsy();
    await act(openQuote);
    expect(hook.result.current.controller.authorOnlyQuotedReferences?.has(referenceKey)).toBeFalsy();
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
        prefetch: 'accepted-answer',
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
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: ReadRecovery) => void>();
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
        prefetch: 'accepted-answer',
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
          prefetch: 'accepted-answer',
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

  it('preserves background reads and cancels only its Topic detail, replies, and quotes when leaving the route', async () => {
    let active = true;
    let appActive = true;
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
      getAppActive: () => appActive,
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
      .query({
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
      appActive = false;
      hook.rerender(undefined);
    });
    expect(detailSignal?.aborted).toBe(false);
    expect(repliesSignal?.aborted).toBe(false);
    expect(quoteSignal?.aborted).toBe(false);

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

  it('keeps an explicit refresh running when another route for the same topic loses focus', async () => {
    let focused = true;
    const topic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const detail = { ...firstDetail, ...topic };
    const updated = { ...detail, contentHtml: '<p>Updated opening</p>' };
    const pending = Promise.withResolvers<TopicDetail>();
    const reading = createDiscourseReadingRuntime({
      queryClient: appQueryClient,
      scope: () => 'alice',
      send: async () => undefined
    });
    const getTopic = jest.fn<TestGetTopic>().mockResolvedValue(detail);
    const getTopicReading = jest.fn<ReadGateway['getTopicReading']>().mockResolvedValue({
      topicId: topic.id,
      lastReadPostNumber: 0,
      highestPostNumber: 0
    });
    const getReplies = jest.fn<TestGetReplies>().mockResolvedValue({
      items: [],
      currentPage: 1,
      hasMore: false,
      nextPage: null
    });
    const readGateway = { reading, getTopic, getTopicReading, getReplies };
    const first = await renderTopicController({ topic, getActive: () => focused, readGateway });
    await waitFor(() => expect(first.result.current.controller.readingEntry.ready).toBe(true));
    const second = await renderTopicController({ topic, readGateway });
    try {
      await waitFor(() => expect(second.result.current.controller.readingEntry.ready).toBe(true));
      let signal: AbortSignal | undefined;
      getTopic.mockImplementationOnce((request) => {
        signal = request.signal;
        return pending.promise;
      });
      await act(() => {
        void second.result.current.controller.refreshWholeTopic();
      });
      await waitFor(() => expect(signal).toBeDefined());

      focused = false;
      await first.rerender(undefined);
      expect(signal?.aborted).toBe(false);
      await act(() => pending.resolve(updated));
      await waitFor(() => expect(second.result.current.controller.topicDetail?.contentHtml).toBe(updated.contentHtml));
    } finally {
      await act(() => pending.resolve(updated));
      await second.unmount();
      await first.unmount();
      reading.dispose();
    }
  });

  it('preserves a shared quote read when another topic loses focus', async () => {
    let focused = true;
    const reference = { source: 'linuxdo' as const, topicId: '2679944', postNumber: 2 };
    const quoted: Reply = { author: 'carol', floor: 2, contentHtml: '<p>quoted</p>', createdAt: '' };
    const pending = Promise.withResolvers<Reply>();
    const getReply = jest.fn<TestGetReply>(() => pending.promise);
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const child = { ...linuxTopic, id: '2', url: 'https://linux.do/t/2' };
    const getTopic = jest.fn<TestGetTopic>(async ({ id }) => ({
      ...firstDetail,
      ...(id === child.id ? child : linuxTopic)
    }));
    const first = await renderTopicController({
      getActive: () => focused,
      topic: linuxTopic,
      readGateway: { getTopic, getReply }
    });
    const second = await renderTopicController({ topic: child, readGateway: { getTopic, getReply } });
    try {
      await act(async () => {
        await first.result.current.controller.toggleTopicBodyQuote({ instanceKey: 'first', reference });
      });
      await waitFor(() => expect(getReply).toHaveBeenCalledTimes(1));
      await act(async () => {
        await second.result.current.controller.toggleTopicBodyQuote({ instanceKey: 'second', reference });
      });
      expect(getReply).toHaveBeenCalledTimes(1);
      const signal = getReply.mock.calls[0][0].signal;
      focused = false;
      await first.rerender(undefined);
      expect(signal?.aborted).toBe(false);
      await act(() => pending.resolve(quoted));
      await waitFor(() =>
        expect(second.result.current.controller.loadedQuotedReplies['linuxdo:2679944:2']?.author).toBe('carol')
      );
    } finally {
      await act(() => pending.resolve(quoted));
      await second.unmount();
      await first.unmount();
    }
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

  it('only retries and prompts for a failed manual quote while a reference is expanded', async () => {
    let focused = true;
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const quote = {
      instanceKey: 'topic:1:linuxdo:2:9',
      reference: { source: 'linuxdo' as const, topicId: '2', postNumber: 9 }
    };
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: ReadRecovery) => void>();
    const getReply = jest
      .fn<TestGetReply>()
      .mockRejectedValueOnce(new Error('引用读取失败'))
      .mockRejectedValue(new LinuxDoCloudflareError());
    const hook = await renderTopicController({
      getActive: () => focused,
      notify,
      showLinuxDoVerification,
      topic: linuxTopic,
      readGateway: { getTopic: async () => linuxDetail, getReply }
    });
    await waitFor(() => expect(hook.result.current.controller.topicDetail).toEqual(linuxDetail));
    const toggle = async () => {
      await act(async () => {
        await hook.result.current.controller.toggleTopicBodyQuote(quote);
      });
    };
    await toggle();
    await waitFor(() => expect(notify).toHaveBeenCalledWith('引用读取失败'));
    await toggle();
    expect(hook.result.current.session.state.expandedQuotes[quote.instanceKey]).toBeFalsy();

    focused = false;
    await act(() => hook.rerender(undefined));
    focused = true;
    await act(() => hook.rerender(undefined));
    expect(getReply).toHaveBeenCalledTimes(1);
    expect(showLinuxDoVerification).not.toHaveBeenCalled();

    await toggle();
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery?.isCurrent?.()).toBe(true);
    await toggle();
    expect(recovery?.isCurrent?.()).toBe(false);
    await expect(recovery?.resume()).resolves.toBe('stale');
    expect(getReply).toHaveBeenCalledTimes(2);
  });

  it('reports an ordinary exact-quote recovery failure', async () => {
    const linuxTopic = { ...firstTopic, source: 'linuxdo' as const, url: 'https://linux.do/t/1' };
    const linuxDetail = { ...firstDetail, ...linuxTopic };
    const getReply = jest
      .fn<TestGetReply>()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new Error('引用恢复网络失败'));
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: ReadRecovery) => void>();
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
