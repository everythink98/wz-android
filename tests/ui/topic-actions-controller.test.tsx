import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn()
}));

jest.mock('../../src/nodeseekActionClient', () => ({
  fetchNodeSeekVoteInfo: jest.fn(),
  runNodeSeekAction: jest.fn()
}));

jest.mock('../../src/yaohuoActionClient', () => ({
  runYaohuoAction: jest.fn()
}));

jest.mock('../../src/app/discourseActionRuntime', () => ({
  prepareDiscourseActionRuntime: jest.fn()
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn()
}));

jest.mock('../../src/replyImageUpload', () => ({
  ...jest.requireActual<typeof import('../../src/replyImageUpload')>('../../src/replyImageUpload'),
  uploadNodeSeekReplyImageWithApiKey: jest.fn()
}));

jest.mock('../../src/nodeimageCredentials', () => ({
  currentNodeImageApiKeyGeneration: jest.fn()
}));

jest.mock('../../src/managedCookies', () => ({
  readManagedCookieHeader: jest.fn(async () => ({
    status: 'ok',
    header: 'sidyaohuo=test'
  }))
}));

import { fetchNodeSeekVoteInfo, runNodeSeekAction } from '../../src/nodeseekActionClient';
import { runYaohuoAction } from '../../src/yaohuoActionClient';
import {
  prepareDiscourseActionRuntime,
  type DiscourseActionRuntimeRecovery
} from '../../src/app/discourseActionRuntime';
import type { DiscourseActionRequest } from '../../src/discourseActions';
import { useTopicActionsController } from '../../src/app/useTopicActionsController';
import { useTopicSessionController } from '../../src/app/useTopicSessionController';
import {
  appQueryClient,
  initialForumSessionEpochs,
  forumQueryKeys,
  type ForumSessionEpochs
} from '../../src/app/serverState';
import { currentNodeImageApiKeyGeneration } from '../../src/nodeimageCredentials';
import { uploadNodeSeekReplyImageWithApiKey } from '../../src/replyImageUpload';
import { setDiagnosticWriter, type DiagnosticEvent } from '../../src/diagnostics';
import {
  createSiteSessionStates,
  createSiteSessionViewModels,
  type ScopedSiteSessionEvent,
  type SiteSessionStates,
  type SiteSessionViewModels
} from '../../src/siteSessionState';
import type { Reply, Source, TopicDetail, TopicPoll } from '../../src/types';
import {
  WritableSessionBlockedError,
  type WritableSessionTicket
} from '../../src/writableSessionGate';
import { QueryTestWrapper } from './QueryTestWrapper';

const mockGetItem = jest.mocked(SecureStore.getItemAsync);
const mockRunNodeSeekAction = jest.mocked(runNodeSeekAction);
const mockFetchNodeSeekVoteInfo = jest.mocked(fetchNodeSeekVoteInfo);
const mockRunYaohuoAction = jest.mocked(runYaohuoAction);
const mockPrepareDiscourseActionRuntime = jest.mocked(prepareDiscourseActionRuntime);
const mockGetDocument = jest.mocked(DocumentPicker.getDocumentAsync);
const mockUploadNodeSeekReplyImage = jest.mocked(uploadNodeSeekReplyImageWithApiKey);
const mockCurrentNodeImageGeneration = jest.mocked(currentNodeImageApiKeyGeneration);
const mockDiscourseExecute = jest.fn<(request: DiscourseActionRequest) => Promise<unknown>>();
const mockDiscourseRecover = jest.fn<(error: unknown) => Promise<DiscourseActionRuntimeRecovery>>();

const poll: TopicPoll = {
  id: '81',
  title: 'Choose',
  options: [
    { id: '1', label: 'One', count: 2 },
    { id: '2', label: 'Two', count: 3 }
  ]
};

const detail: TopicDetail = {
  source: 'nodeseek',
  id: '42',
  title: 'Query mutation',
  author: 'alice',
  url: 'https://www.nodeseek.com/post-42-1',
  createdAt: '2026-07-20T00:00:00.000Z',
  replyCount: 0,
  canCreatePost: true,
  commentId: 420,
  upvoted: false,
  collected: false,
  contentHtml: '<p>body</p>',
  replies: [],
  polls: [poll]
};

type ActionSource = Exclude<Source, 'v2ex'>;

function loggedInStates(source: ActionSource = 'nodeseek') {
  const states = createSiteSessionStates();
  return createSiteSessionStates({
    [source]: { ...states[source], status: 'logged-in' as const }
  } as Partial<SiteSessionStates>);
}

function detailFor(source: ActionSource, patch: Partial<TopicDetail> = {}): TopicDetail {
  return {
    ...detail,
    source,
    url: source === 'linuxdo'
      ? 'https://linux.do/t/query-mutation/42'
      : source === 'xiaoyinsi'
        ? 'https://xiaoyinsi.com/t/query-mutation/42'
        : source === 'yaohuo'
          ? 'https://www.yaohuo.me/bbs/book_view.aspx?id=42&classid=177'
          : detail.url,
    ...patch
  };
}

async function renderActions({
  sessionEpochs = initialForumSessionEpochs,
  discourseLoginPrompts = { linuxdo: jest.fn(), xiaoyinsi: jest.fn() },
  ensureNodeImageApiKey = jest.fn(async () => null),
  ensureWritableSession,
  isWritableSessionTicketCurrent,
  notify = jest.fn(),
  reconcileWritableSession = jest.fn(async () => ({ status: 'same' as const })),
  refreshTopicReplies = jest.fn(async () => 'completed'),
  siteSessionViewModels,
  siteSessionStates,
  topicDetail = detail,
  topicReplies = []
}: {
  sessionEpochs?: ForumSessionEpochs;
  dispatchSiteSessionEvent?: (event: ScopedSiteSessionEvent) => void;
  discourseLoginPrompts?: { linuxdo: (message?: string) => void; xiaoyinsi: (message?: string) => void };
  ensureNodeImageApiKey?: (options?: { forceRefresh?: boolean; clearOnCancel?: boolean }) => Promise<string | null>;
  ensureWritableSession?: (source: ActionSource) => Promise<WritableSessionTicket>;
  isWritableSessionTicketCurrent?: (ticket: WritableSessionTicket) => boolean;
  notify?: (message: string) => void;
  reconcileWritableSession?: (source: ActionSource) => Promise<{
    status: 'anonymous' | 'changed' | 'same' | 'stale' | 'unknown';
  }>;
  refreshTopicReplies?: () => Promise<unknown>;
  showYaohuoLogin?: (message?: string) => void;
  siteSessionViewModels?: SiteSessionViewModels;
  siteSessionStates?: SiteSessionStates;
  topicDetail?: TopicDetail;
  topicReplies?: Reply[];
} = {}) {
  const hook = await renderNativeHook((props: { sessionEpochs: ForumSessionEpochs }) => {
    const topicSession = useTopicSessionController({ notify });
    const actions = useTopicActionsController({
      sessionEpochs: props.sessionEpochs,
      discourseActionRuntimeDependencies: {
        linuxDoUserAgent: () => 'safe-agent',
        refreshXiaoyinsiAuthorization: async () => true,
        resetLinuxDoLevelState: jest.fn(),
        updateLinuxDoSession: jest.fn()
      },
      discourseLoginPrompts,
      ensureNodeImageApiKey,
      ensureWritableSession: ensureWritableSession || (async (source) => ({
        source,
        identityKey: `${source}:test-user`,
        sessionEpoch: props.sessionEpochs[source]
      })),
      fetcher: jest.fn(async () => new Response('{}')),
      isWritableSessionTicketCurrent: isWritableSessionTicketCurrent || ((ticket) => (
        ticket.sessionEpoch === props.sessionEpochs[ticket.source]
      )),
      nodeSeekWebViewUserAgentRef: { current: 'safe-agent' },
      notify,
      reconcileWritableSession,
      refreshTopicReplies,
      siteSessionViewModels: siteSessionViewModels || createSiteSessionViewModels(
        siteSessionStates || loggedInStates(topicDetail.source as ActionSource)
      ),
      topicDetail,
      topicReplies,
      topicSession
    });
    return { actions, topicSession };
  }, {
    initialProps: { sessionEpochs },
    wrapper: QueryTestWrapper
  });
  await act(async () => {
    hook.result.current.topicSession.commands.topic.select(topicDetail);
  });
  return hook;
}

function seedTopicCache(
  topicDetail: TopicDetail = detail,
  topicReplies: Reply[] = [],
  scope = initialForumSessionEpochs
) {
  const detailKey = forumQueryKeys.topic({ source: topicDetail.source, topicId: topicDetail.id, scope });
  const repliesKey = forumQueryKeys.replies(detailKey);
  appQueryClient.setQueryData(detailKey, topicDetail);
  appQueryClient.setQueryData(repliesKey, {
    pages: [{ items: topicReplies, hasMore: false, nextPage: null }],
    pageParams: [null]
  });
  return { detailKey, repliesKey };
}

describe('topic action query mutations', () => {
  beforeEach(() => {
    appQueryClient.clear();
    jest.clearAllMocks();
    mockRunNodeSeekAction.mockReset();
    mockFetchNodeSeekVoteInfo.mockReset();
    mockRunYaohuoAction.mockReset().mockResolvedValue({ ok: true, message: '操作已提交' });
    mockDiscourseExecute.mockReset().mockResolvedValue({ success: true });
    mockDiscourseRecover.mockReset().mockResolvedValue({
      loginRequired: false,
      phase: 'transport'
    });
    mockPrepareDiscourseActionRuntime.mockReset().mockImplementation(async () => ({
      credentialReady: true,
      credentialSource: 'secure-store',
      csrfSource: 'none',
      execute: mockDiscourseExecute,
      isCredentialCurrent: () => true,
      recover: mockDiscourseRecover
    }));
    mockGetDocument.mockReset().mockResolvedValue({ canceled: true, assets: null });
    mockUploadNodeSeekReplyImage.mockReset().mockResolvedValue('https://nodeimage.com/test.png');
    mockCurrentNodeImageGeneration.mockReset().mockReturnValue(0);
    mockGetItem.mockResolvedValue(null);
  });

  afterEach(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    setDiagnosticWriter(null);
    jest.restoreAllMocks();
  });

  it('[REG-WRITE-016] uses refreshed account status for Discourse action availability', async () => {
    const workflowStates = loggedInStates('linuxdo');
    const accountStates = createSiteSessionStates({
      linuxdo: { ...workflowStates.linuxdo, status: 'verifying', isVerifying: true },
      xiaoyinsi: {
        ...workflowStates.xiaoyinsi,
        status: 'logged-in'
      }
    });
    const hook = await renderActions({
      siteSessionStates: workflowStates,
      siteSessionViewModels: createSiteSessionViewModels(accountStates),
      topicDetail: detailFor('linuxdo')
    });

    expect(hook.result.current.actions.sourceActionAvailability.linuxdo).toBe(false);
    expect(hook.result.current.actions.sourceActionAvailability.xiaoyinsi).toBe(true);
  });

  it('[REG-WRITE-023] blocks before optimistic state and transport when identity is unknown', async () => {
    const { detailKey } = seedTopicCache();
    const ensureWritableSession = jest.fn(async () => {
      throw new WritableSessionBlockedError('登录状态暂时无法确认，请重试', 'identity_pending');
    });
    const hook = await renderActions({ ensureWritableSession });

    await act(async () => {
      await hook.result.current.actions.collectOnNodeSeekSite();
    });

    expect(ensureWritableSession).toHaveBeenCalledWith('nodeseek');
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.collected).toBe(false);
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
  });

  it('[REG-WRITE-023] blocks before optimistic state when identity changes during query cancellation', async () => {
    const { detailKey } = seedTopicCache();
    let ticketCurrent = true;
    const cancellation = Promise.withResolvers<void>();
    const cancelQueries = jest
      .spyOn(appQueryClient, 'cancelQueries')
      .mockImplementation(async () => cancellation.promise);
    const hook = await renderActions({
      isWritableSessionTicketCurrent: () => ticketCurrent
    });
    let collection!: Promise<void>;

    await act(async () => {
      collection = hook.result.current.actions.collectOnNodeSeekSite();
      await Promise.resolve();
    });
    await waitFor(() => expect(cancelQueries).toHaveBeenCalledTimes(2));

    ticketCurrent = false;
    await act(async () => {
      cancellation.resolve();
      await collection;
    });

    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.collected).toBe(false);
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
  });

  it('[REG-WRITE-023] blocks before file selection and upload when identity is dirty', async () => {
    const ensureWritableSession = jest.fn(async () => {
      throw new WritableSessionBlockedError('登录状态暂时无法确认，请重试', 'identity_pending');
    });
    const hook = await renderActions({ ensureWritableSession });

    await act(async () => {
      await hook.result.current.actions.uploadReplyImage();
    });

    expect(mockGetDocument).not.toHaveBeenCalled();
    expect(mockUploadNodeSeekReplyImage).not.toHaveBeenCalled();
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
  });

  it('serializes mutations for the same topic without a handwritten queue', async () => {
    const firstTransport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction
      .mockImplementationOnce(async () => firstTransport.promise)
      .mockResolvedValueOnce({ success: true });
    const hook = await renderActions();
    let first!: Promise<void>;
    let second!: Promise<void>;

    await act(async () => {
      first = hook.result.current.actions.checkIn();
      second = hook.result.current.actions.checkIn();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));

    await act(async () => {
      firstTransport.resolve({ success: true });
      await first;
      await second;
    });
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(2);
    expect(mockRunNodeSeekAction.mock.calls.every(([options]) => options.signal === undefined)).toBe(true);
  });

  it('[REG-WRITE-019] rejects a duplicate reply submit before a second scoped transport is queued', async () => {
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    seedTopicCache();
    const hook = await renderActions();
    let first!: Promise<void>;
    let duplicate!: Promise<void>;

    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('one reply');
    });
    await act(async () => {
      first = hook.result.current.actions.submitReply();
      duplicate = hook.result.current.actions.submitReply();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));

    await act(async () => {
      transport.resolve({ success: true });
      await Promise.all([first, duplicate]);
    });

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
  });

  it('[REG-WRITE-020] reports an unexpected credential preparation failure to the user', async () => {
    const notify = jest.fn();
    seedTopicCache();
    const hook = await renderActions({
      ensureWritableSession: jest.fn(async () => {
        throw new Error('身份复核失败');
      }),
      notify
    });

    await act(async () => {
      await hook.result.current.actions.collectOnNodeSeekSite();
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('身份复核失败');
    expect(notify).not.toHaveBeenCalledWith('原站收藏已提交');
  });

  it('[REG-WRITE-021] removes an old topic cache when a confirmed reply settles after navigation', async () => {
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    const refreshTopicReplies = jest.fn(async () => 'completed');
    const { detailKey, repliesKey } = seedTopicCache();
    const hook = await renderActions({ refreshTopicReplies });
    let submission!: Promise<void>;

    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply after navigation');
    });
    await act(async () => {
      submission = hook.result.current.actions.submitReply();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));

    await act(async () => {
      hook.result.current.topicSession.commands.topic.select({ ...detail, id: '99', url: 'https://www.nodeseek.com/post-99-1' });
      transport.resolve({ success: true });
      await submission;
    });

    expect(refreshTopicReplies).not.toHaveBeenCalled();
    expect(appQueryClient.getQueryData(detailKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(repliesKey)).toBeUndefined();
  });

  it('REG-LINUXDO-003 records a confirmed reply with a failed follow-up refresh as partial', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const refreshTopicReplies = jest.fn(async (_options?: unknown) => 'failed');
    const notify = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDetail);
    const hook = await renderActions({ notify, refreshTopicReplies, topicDetail: linuxDetail });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('confirmed reply');
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockDiscourseExecute).toHaveBeenCalledTimes(1);
    expect(refreshTopicReplies).toHaveBeenCalledWith(expect.objectContaining({
      afterSubmit: true,
      diagnosticTrace: expect.any(Object),
      silent: true
    }));
    expect(notify).toHaveBeenCalledWith('回复已提交');
    expect(lines.map((line) => JSON.parse(line) as DiagnosticEvent)).toContainEqual(expect.objectContaining({
      area: 'reply',
      operation: 'submit',
      phase: 'finish',
      outcome: 'partial',
      reason: 'refresh_failed'
    }));
  });

  it('[REG-WRITE-015] uses the fixed NodeSeek global mutation identity for attendance after leaving another source', async () => {
    const linuxDetail = detailFor('linuxdo');
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    const hook = await renderActions({
      siteSessionStates: loggedInStates('nodeseek'),
      topicDetail: linuxDetail
    });

    await act(async () => { await hook.result.current.actions.checkIn(); });

    const attendance = appQueryClient.getMutationCache().getAll().at(-1);
    expect(attendance?.options.mutationKey).toEqual([
      'forum', 'nodeseek', 'mutation', 'topic', 'global'
    ]);
    expect(attendance?.options.scope).toEqual({ id: 'forum:nodeseek:topic:global' });
  });

  it('rolls an optimistic interaction back when its transport fails', async () => {
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    const { detailKey } = seedTopicCache();
    const hook = await renderActions();
    let interaction!: Promise<void>;

    await act(async () => {
      interaction = hook.result.current.actions.interact('upvote', detail.commentId);
      await Promise.resolve();
    });
    await waitFor(() => expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.upvoted).toBe(true));

    await act(async () => {
      transport.reject(new Error('network failed'));
      await interaction;
    });
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.upvoted).toBe(false);
  });

  it('[REG-WRITE-018] snapshots optimistic mutations only when their scoped transport starts', async () => {
    const firstTransport = Promise.withResolvers<unknown>();
    const secondTransport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction
      .mockImplementationOnce(async () => firstTransport.promise)
      .mockImplementationOnce(async () => secondTransport.promise);
    const { detailKey } = seedTopicCache();
    const hook = await renderActions();
    let interaction!: Promise<void>;
    let collection!: Promise<void>;

    await act(async () => {
      interaction = hook.result.current.actions.interact('upvote', detail.commentId);
      collection = hook.result.current.actions.collectOnNodeSeekSite();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      upvoted: true,
      collected: false
    });

    await act(async () => {
      firstTransport.reject(new Error('first failed'));
      await interaction;
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(2));
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      upvoted: false,
      collected: true
    });

    await act(async () => {
      secondTransport.reject(new Error('second failed'));
      await collection;
    });
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      upvoted: false,
      collected: false
    });
  });

  it('does not repopulate a cleared cache with a late result from an old credential scope', async () => {
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    const notify = jest.fn();
    const { detailKey } = seedTopicCache();
    const hook = await renderActions({ notify });
    let collection!: Promise<void>;

    await act(async () => {
      collection = hook.result.current.actions.collectOnNodeSeekSite();
      await Promise.resolve();
    });
    await waitFor(() => expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.collected).toBe(true));

    const nextScope = { ...initialForumSessionEpochs, nodeseek: 1 };
    await act(async () => { await hook.rerender({ sessionEpochs: nextScope }); });
    appQueryClient.removeQueries({ queryKey: detailKey, exact: true });
    await act(async () => {
      transport.resolve({ success: true });
      await collection;
    });

    expect(appQueryClient.getQueryData(detailKey)).toBeUndefined();
    expect(notify).not.toHaveBeenCalledWith('原站收藏已提交');
  });

  it('[REG-XIAOYINSI-009] cancels an existing like even when canLike is false', async () => {
    const xiaDetail = detailFor('xiaoyinsi', {
      canLike: false,
      commentId: 987654,
      liked: true,
      likeCount: 4,
      polls: []
    });
    const notify = jest.fn();
    const { detailKey } = seedTopicCache(xiaDetail);
    const hook = await renderActions({ notify, topicDetail: xiaDetail });

    await act(async () => {
      await hook.result.current.actions.interact('like', 987654);
    });

    expect(mockDiscourseExecute).toHaveBeenCalledWith({
      path: '/post_actions/987654?post_action_type_id=2',
      method: 'DELETE',
      headers: {},
      body: undefined
    });
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      liked: false,
      likeCount: 3
    });
    expect(hook.result.current.actions.actionBusy).toBe(false);
    expect(notify).not.toHaveBeenCalledWith('当前帖子不能点赞');
  });

  it('[REG-XIAOYINSI-009] restores an existing like when cancellation fails', async () => {
    mockDiscourseExecute.mockRejectedValueOnce(new Error('temporary failure'));
    const xiaDetail = detailFor('xiaoyinsi', {
      canLike: false,
      commentId: 987654,
      liked: true,
      likeCount: 4,
      polls: []
    });
    const { detailKey } = seedTopicCache(xiaDetail);
    const hook = await renderActions({ topicDetail: xiaDetail });

    await act(async () => {
      await hook.result.current.actions.interact('like', 987654);
    });

    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      liked: true,
      likeCount: 4
    });
  });

  it('[REG-XIAOYINSI-012] applies a confirmed like only to the exact topic cache', async () => {
    const xiaDetail = detailFor('xiaoyinsi', {
      canLike: true,
      commentId: 987654,
      liked: false,
      likeCount: 3,
      polls: []
    });
    const { detailKey } = seedTopicCache(xiaDetail);
    const hook = await renderActions({ topicDetail: xiaDetail });

    await act(async () => {
      await hook.result.current.actions.interact('like', 987654);
    });

    expect(mockDiscourseExecute).toHaveBeenCalledWith({
      path: '/post_actions',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'id=987654&post_action_type_id=2'
    });
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      liked: true,
      likeCount: 4
    });
    expect(appQueryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
    expect(hook.result.current.actions.actionBusy).toBe(false);
  });

  it('[REG-XIAOYINSI-003] cancels a topic bookmark without a bookmark id', async () => {
    const xiaDetail = detailFor('xiaoyinsi', {
      bookmarked: true,
      bookmarkId: undefined,
      polls: []
    });
    const { detailKey } = seedTopicCache(xiaDetail);
    const hook = await renderActions({ topicDetail: xiaDetail });

    await act(async () => {
      await hook.result.current.actions.bookmarkOnDiscourseSite();
    });

    expect(mockDiscourseExecute).toHaveBeenCalledWith({
      path: '/t/42/remove_bookmarks',
      method: 'PUT',
      headers: {},
      body: undefined
    });
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({ bookmarked: false });
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.bookmarkId).toBeUndefined();
  });

  it('[REG-XIAOYINSI-003] restores a topic bookmark without an id when cancellation fails', async () => {
    mockDiscourseExecute.mockRejectedValueOnce(new Error('temporary failure'));
    const xiaDetail = detailFor('xiaoyinsi', {
      bookmarked: true,
      bookmarkId: undefined,
      polls: []
    });
    const { detailKey } = seedTopicCache(xiaDetail);
    const hook = await renderActions({ topicDetail: xiaDetail });

    await act(async () => {
      await hook.result.current.actions.bookmarkOnDiscourseSite();
    });

    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({ bookmarked: true });
  });

  it('[REG-XIAOYINSI-007] closes an edit composer, keeps unconfirmed content out of cache, and refreshes only replies', async () => {
    const reply: Reply = {
      author: 'alice',
      canEdit: true,
      commentId: 101,
      contentHtml: '<p>old</p>',
      contentMarkdown: 'old',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const xiaDetail = detailFor('xiaoyinsi', { canCreatePost: false, polls: [], replies: [reply] });
    const { detailKey, repliesKey } = seedTopicCache(xiaDetail, [reply]);
    const hook = await renderActions({ topicDetail: xiaDetail, topicReplies: [reply] });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.editReply(reply);
      hook.result.current.topicSession.commands.composer.changeContent('server must confirm this body');
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockDiscourseExecute).toHaveBeenCalledWith(expect.objectContaining({
      path: '/posts/101.json',
      method: 'PUT'
    }));
    expect(hook.result.current.topicSession.state.replyComposerOpen).toBe(false);
    expect(hook.result.current.topicSession.state.replyContent).toBe('');
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.replies[0]?.contentHtml).toBe('<p>old</p>');
    expect(appQueryClient.getQueryState(repliesKey)?.isInvalidated).toBe(true);
    expect(appQueryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
  });

  it('[REG-XIAOYINSI-012] removes a confirmed reply locally and refreshes only the reply query', async () => {
    const reply: Reply = {
      author: 'alice',
      canDelete: true,
      commentId: 101,
      contentHtml: '<p>reply</p>',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const xiaDetail = detailFor('xiaoyinsi', { polls: [], replies: [reply], replyCount: 1 });
    const { detailKey, repliesKey } = seedTopicCache(xiaDetail, [reply]);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '删除')?.onPress?.();
    });
    const hook = await renderActions({ topicDetail: xiaDetail, topicReplies: [reply] });

    await act(async () => {
      hook.result.current.actions.deleteReply(reply);
    });
    await waitFor(() => expect(mockDiscourseExecute).toHaveBeenCalledTimes(1));

    const replyCache = appQueryClient.getQueryData<{ pages: Array<{ items: Reply[] }> }>(repliesKey);
    expect(replyCache?.pages[0]?.items).toEqual([]);
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({ replyCount: 0, replies: [] });
    expect(appQueryClient.getQueryState(repliesKey)?.isInvalidated).toBe(true);
    expect(appQueryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
    alert.mockRestore();
  });

  it('REG-WRITE-003 REG-WRITE-004 applies a Yaohuo favorite without global busy state', async () => {
    const transport = Promise.withResolvers<{ ok: true; message: string; favoriteId?: number }>();
    mockRunYaohuoAction.mockImplementationOnce(async () => transport.promise);
    const yaohuoDetail = detailFor('yaohuo', {
      bookmarked: false,
      categoryId: '177',
      polls: []
    });
    const { detailKey } = seedTopicCache(yaohuoDetail);
    const hook = await renderActions({ topicDetail: yaohuoDetail });
    let favorite!: Promise<void>;

    await act(async () => {
      favorite = hook.result.current.actions.favoriteOnYaohuoSite();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunYaohuoAction).toHaveBeenCalledTimes(1));
    expect(hook.result.current.actions.actionBusy).toBe(false);
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.bookmarked).toBe(true);

    await act(async () => {
      transport.resolve({ ok: true, message: '收藏成功', favoriteId: 987 });
      await favorite;
    });
    expect(mockRunYaohuoAction).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        method: 'GET',
        path: '/bbs/Share.aspx?action=fav&siteid=1000&classid=177&id=42'
      })
    }));
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      bookmarked: true,
      bookmarkId: 987
    });
  });

  it('REG-WRITE-003 cancels a Yaohuo favorite and clears the visible state', async () => {
    mockRunYaohuoAction.mockResolvedValueOnce({ ok: true, message: '已取消原站收藏' });
    const yaohuoDetail = detailFor('yaohuo', {
      bookmarked: true,
      bookmarkId: 987,
      categoryId: '177',
      polls: []
    });
    const { detailKey } = seedTopicCache(yaohuoDetail);
    const hook = await renderActions({ topicDetail: yaohuoDetail });

    await act(async () => {
      await hook.result.current.actions.favoriteOnYaohuoSite();
    });

    expect(mockRunYaohuoAction).toHaveBeenCalledWith(expect.objectContaining({
      request: {
        method: 'POST',
        path: '/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=987',
        headers: { accept: '*/*' }
      }
    }));
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({ bookmarked: false });
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.bookmarkId).toBeUndefined();
  });

  it('REG-XIAOYINSI-021 preserves the action error when authorization recovery fails', async () => {
    mockDiscourseExecute.mockRejectedValueOnce(Object.assign(new Error('没有权限执行该操作'), {
      authorizationCheckRequired: true,
      source: 'xiaoyinsi',
      status: 403
    }));
    mockDiscourseRecover.mockRejectedValueOnce(new Error('authorization refresh failed'));
    const xiaDetail = detailFor('xiaoyinsi', {
      canLike: true,
      commentId: 987654,
      liked: false,
      polls: []
    });
    const notify = jest.fn();
    const { detailKey } = seedTopicCache(xiaDetail);
    const hook = await renderActions({ notify, topicDetail: xiaDetail });

    await act(async () => {
      await hook.result.current.actions.interact('like', 987654);
    });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('没有权限执行该操作'));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('复核未完成'));
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.liked).toBe(false);
  });

  it('[REG-XIAOYINSI-022] opens authorization only when recovery confirms expiry', async () => {
    mockDiscourseExecute.mockRejectedValueOnce(Object.assign(new Error('无效的 API key'), {
      authorizationCheckRequired: true,
      source: 'xiaoyinsi',
      status: 401
    }));
    mockDiscourseRecover.mockResolvedValueOnce({ loginRequired: true, phase: 'credential' });
    const showXiaoyinsiLogin = jest.fn();
    const xiaDetail = detailFor('xiaoyinsi', {
      canLike: true,
      commentId: 987654,
      liked: false,
      polls: []
    });
    const { detailKey } = seedTopicCache(xiaDetail);
    const hook = await renderActions({
      discourseLoginPrompts: { linuxdo: jest.fn(), xiaoyinsi: showXiaoyinsiLogin },
      topicDetail: xiaDetail
    });

    await act(async () => {
      await hook.result.current.actions.interact('like', 987654);
    });

    expect(showXiaoyinsiLogin).toHaveBeenCalledWith(expect.stringContaining('无效的 API key'));
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.liked).toBe(false);
  });

  it('[REG-XIAOYINSI-022] keeps authorization closed when recovery says the grant is still valid', async () => {
    mockDiscourseExecute.mockRejectedValueOnce(Object.assign(new Error('没有权限执行该操作'), {
      authorizationCheckRequired: true,
      source: 'xiaoyinsi',
      status: 403
    }));
    mockDiscourseRecover.mockResolvedValueOnce({ loginRequired: false, phase: 'credential' });
    const showXiaoyinsiLogin = jest.fn();
    const notify = jest.fn();
    const xiaDetail = detailFor('xiaoyinsi', {
      canLike: true,
      commentId: 987654,
      liked: false,
      polls: []
    });
    seedTopicCache(xiaDetail);
    const hook = await renderActions({
      discourseLoginPrompts: { linuxdo: jest.fn(), xiaoyinsi: showXiaoyinsiLogin },
      notify,
      topicDetail: xiaDetail
    });

    await act(async () => {
      await hook.result.current.actions.interact('like', 987654);
    });

    expect(showXiaoyinsiLogin).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('没有权限执行该操作');
  });

  it('[REG-ACCOUNT-026][REG-WRITE-022][REG-WRITE-023] reconciles Yaohuo expiry without clearing Cookie or reopening login', async () => {
    mockRunYaohuoAction.mockRejectedValueOnce(Object.assign(new Error('妖火登录已失效'), {
      loginRequired: true,
      reason: 'expired',
      source: 'yaohuo'
    }));
    const reconcileWritableSession = jest.fn(async () => ({ status: 'anonymous' as const }));
    const showYaohuoLogin = jest.fn();
    const yaohuoDetail = detailFor('yaohuo', { bookmarked: false, categoryId: '177', polls: [] });
    seedTopicCache(yaohuoDetail);
    const hook = await renderActions({ reconcileWritableSession, showYaohuoLogin, topicDetail: yaohuoDetail });

    await act(async () => {
      await expect(hook.result.current.actions.favoriteOnYaohuoSite()).resolves.toBeUndefined();
    });

    expect(reconcileWritableSession).toHaveBeenCalledTimes(1);
    expect(reconcileWritableSession).toHaveBeenCalledWith('yaohuo');
    expect(showYaohuoLogin).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-026][REG-WRITE-022][REG-WRITE-023] reconciles NodeSeek expiry once without deleting original-site login', async () => {
    mockRunNodeSeekAction.mockRejectedValueOnce(Object.assign(new Error('NodeSeek 登录已失效'), {
      loginRequired: true,
      source: 'nodeseek'
    }));
    const reconcileWritableSession = jest.fn(async () => ({ status: 'anonymous' as const }));
    const notify = jest.fn();
    seedTopicCache();
    const hook = await renderActions({ notify, reconcileWritableSession });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });

    await act(async () => {
      await expect(hook.result.current.actions.submitReply()).resolves.toBeUndefined();
    });

    expect(reconcileWritableSession).toHaveBeenCalledTimes(1);
    expect(reconcileWritableSession).toHaveBeenCalledWith('nodeseek');
    expect(notify).toHaveBeenCalledWith('NodeSeek 登录已失效');
  });

  it('[REG-WRITE-022][REG-WRITE-023] keeps Yaohuo verification failures pending without reopening login', async () => {
    mockRunYaohuoAction.mockRejectedValueOnce(Object.assign(new Error('请回到妖火原站完成登录确认'), {
      loginRequired: true,
      reason: 'verification',
      source: 'yaohuo'
    }));
    const reconcileWritableSession = jest.fn(async () => ({ status: 'unknown' as const }));
    const showYaohuoLogin = jest.fn();
    const yaohuoDetail = detailFor('yaohuo', { bookmarked: false, categoryId: '177', polls: [] });
    seedTopicCache(yaohuoDetail);
    const hook = await renderActions({ reconcileWritableSession, showYaohuoLogin, topicDetail: yaohuoDetail });

    await act(async () => {
      await expect(hook.result.current.actions.favoriteOnYaohuoSite()).resolves.toBeUndefined();
    });

    expect(reconcileWritableSession).toHaveBeenCalledTimes(1);
    expect(reconcileWritableSession).toHaveBeenCalledWith('yaohuo');
    expect(showYaohuoLogin).not.toHaveBeenCalled();
  });

  it('[REG-WRITE-022] leaves identity unchanged for an ordinary NodeSeek action failure', async () => {
    mockRunNodeSeekAction.mockRejectedValueOnce(new Error('没有权限执行该操作'));
    const dispatchSiteSessionEvent = jest.fn();
    const reconcileWritableSession = jest.fn(async () => ({ status: 'same' as const }));
    const notify = jest.fn();
    seedTopicCache();
    const hook = await renderActions({ dispatchSiteSessionEvent, notify, reconcileWritableSession });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });

    await act(async () => {
      await expect(hook.result.current.actions.submitReply()).resolves.toBeUndefined();
    });

    expect(dispatchSiteSessionEvent).not.toHaveBeenCalled();
    expect(reconcileWritableSession).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('没有权限执行该操作');
  });

  it('[REG-WRITE-023] reconciles linux.do action failure once without automatic login replay', async () => {
    mockDiscourseExecute.mockRejectedValueOnce(Object.assign(new Error('linux.do 登录已失效'), {
      loginRequired: true,
      source: 'linuxdo'
    }));
    const reconcileWritableSession = jest.fn(async () => ({ status: 'anonymous' as const }));
    const showLinuxDoLogin = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDetail);
    const hook = await renderActions({
      discourseLoginPrompts: { linuxdo: showLinuxDoLogin, xiaoyinsi: jest.fn() },
      reconcileWritableSession,
      topicDetail: linuxDetail
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });

    await act(async () => {
      await expect(hook.result.current.actions.submitReply()).resolves.toBeUndefined();
    });

    expect(reconcileWritableSession).toHaveBeenCalledTimes(1);
    expect(reconcileWritableSession).toHaveBeenCalledWith('linuxdo');
    expect(mockDiscourseRecover).not.toHaveBeenCalled();
    expect(showLinuxDoLogin).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-009][REG-WRITE-022] suppresses a NodeSeek failure after a newer login takes ownership', async () => {
    let ticketCurrent = true;
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise as never);
    const dispatchSiteSessionEvent = jest.fn();
    const notify = jest.fn();
    seedTopicCache();
    const hook = await renderActions({
      dispatchSiteSessionEvent,
      isWritableSessionTicketCurrent: () => ticketCurrent,
      notify
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });
    let action!: Promise<void>;

    await act(async () => {
      action = hook.result.current.actions.submitReply();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));
    ticketCurrent = false;
    await act(async () => {
      transport.reject(Object.assign(new Error('旧 NodeSeek 登录已失效'), {
        loginRequired: true,
        source: 'nodeseek'
      }));
      await action;
    });

    expect(dispatchSiteSessionEvent).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-009][REG-WRITE-022] suppresses a Yaohuo failure after a newer login takes ownership', async () => {
    let ticketCurrent = true;
    const transport = Promise.withResolvers<unknown>();
    mockRunYaohuoAction.mockImplementationOnce(async () => transport.promise as never);
    const dispatchSiteSessionEvent = jest.fn();
    const showYaohuoLogin = jest.fn();
    const yaohuoDetail = detailFor('yaohuo', { bookmarked: false, categoryId: '177', polls: [] });
    seedTopicCache(yaohuoDetail);
    const hook = await renderActions({
      dispatchSiteSessionEvent,
      isWritableSessionTicketCurrent: () => ticketCurrent,
      topicDetail: yaohuoDetail
    });
    let action!: Promise<void>;

    await act(async () => {
      action = hook.result.current.actions.favoriteOnYaohuoSite();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunYaohuoAction).toHaveBeenCalledTimes(1));
    ticketCurrent = false;
    await act(async () => {
      transport.reject(Object.assign(new Error('旧妖火登录已失效'), {
        loginRequired: true,
        reason: 'expired',
        source: 'yaohuo'
      }));
      await action;
    });

    expect(dispatchSiteSessionEvent).not.toHaveBeenCalled();
    expect(showYaohuoLogin).not.toHaveBeenCalled();
  });

  it('REG-ACCOUNT-009 suppresses a linux.do failure after newer credentials take ownership', async () => {
    let credentialIsCurrent = true;
    const transport = Promise.withResolvers<unknown>();
    const execute = jest.fn(async () => transport.promise);
    const recover = jest.fn(async () => ({ loginRequired: true, phase: 'credential' as const }));
    mockPrepareDiscourseActionRuntime.mockResolvedValueOnce({
      credentialReady: true,
      credentialSource: 'secure-store',
      csrfSource: 'session-endpoint',
      execute,
      isCredentialCurrent: () => credentialIsCurrent,
      recover
    });
    const showLinuxDoLogin = jest.fn();
    const notify = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDetail);
    const hook = await renderActions({
      discourseLoginPrompts: { linuxdo: showLinuxDoLogin, xiaoyinsi: jest.fn() },
      notify,
      topicDetail: linuxDetail
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });
    let action!: Promise<void>;

    await act(async () => {
      action = hook.result.current.actions.submitReply();
      await Promise.resolve();
    });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    credentialIsCurrent = false;
    await act(async () => {
      transport.reject(Object.assign(new Error('旧 linux.do 登录已失效'), {
        loginRequired: true,
        source: 'linuxdo'
      }));
      await action;
    });

    expect(recover).not.toHaveBeenCalled();
    expect(showLinuxDoLogin).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('REG-ACCOUNT-010 does not insert a NodeImage upload completed by a cleared API key', async () => {
    let generation = 5;
    const upload = Promise.withResolvers<string>();
    mockCurrentNodeImageGeneration.mockImplementation(() => generation);
    mockUploadNodeSeekReplyImage.mockImplementationOnce(async () => upload.promise);
    mockGetDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/test.png', name: 'test.png', mimeType: 'image/png', lastModified: 0 }]
    });
    const notify = jest.fn();
    seedTopicCache();
    const hook = await renderActions({
      ensureNodeImageApiKey: jest.fn(async () => 'old-key'),
      notify
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('existing draft');
    });
    let pending!: Promise<void>;

    await act(async () => {
      pending = hook.result.current.actions.uploadReplyImage();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockUploadNodeSeekReplyImage).toHaveBeenCalledTimes(1));
    generation += 1;
    await act(async () => {
      upload.resolve('https://nodeimage.com/late.png');
      await pending;
    });

    expect(hook.result.current.topicSession.state.replyContent).toBe('existing draft');
    expect(notify).not.toHaveBeenCalledWith('图片已插入');
  });

  it('[REG-WRITE-023] refreshes rejected NodeImage authorization without replaying the selected upload', async () => {
    mockCurrentNodeImageGeneration.mockReturnValue(5);
    mockUploadNodeSeekReplyImage.mockRejectedValueOnce(Object.assign(
      new Error('API Key 无效'),
      { nodeImageApiKeyExpired: true }
    ));
    mockGetDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/test.png', name: 'test.png', mimeType: 'image/png', lastModified: 0 }]
    });
    const ensureNodeImageApiKey = jest.fn(async (
      options?: { forceRefresh?: boolean; clearOnCancel?: boolean }
    ) => options?.forceRefresh ? 'new-key' : 'old-key');
    const notify = jest.fn();
    seedTopicCache();
    const hook = await renderActions({ ensureNodeImageApiKey, notify });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('existing draft');
    });

    await act(async () => {
      await hook.result.current.actions.uploadReplyImage();
    });

    expect(mockUploadNodeSeekReplyImage).toHaveBeenCalledTimes(1);
    expect(ensureNodeImageApiKey).toHaveBeenNthCalledWith(1);
    expect(ensureNodeImageApiKey).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
      clearOnCancel: true
    });
    expect(hook.result.current.topicSession.state.replyContent).toBe('existing draft');
    expect(notify).toHaveBeenCalledWith('NodeImage 授权已更新，请重新选择图片上传');
    expect(notify).not.toHaveBeenCalledWith('图片已插入');
  });

  it('releases image-upload busy state after inserting Markdown', async () => {
    const upload = Promise.withResolvers<unknown>();
    mockDiscourseExecute.mockImplementationOnce(async () => upload.promise);
    mockGetDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/test.png', name: 'test.png', mimeType: 'image/png', lastModified: 0 }]
    });
    const xiaDetail = detailFor('xiaoyinsi', { canCreatePost: true, polls: [] });
    seedTopicCache(xiaDetail);
    const hook = await renderActions({ topicDetail: xiaDetail });
    let pending!: Promise<void>;

    await act(async () => {
      pending = hook.result.current.actions.uploadReplyImage();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockDiscourseExecute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.actions.actionBusy).toBe(true));
    await act(async () => {
      upload.resolve({ short_url: 'upload://test.jpeg' });
      await pending;
    });

    expect(hook.result.current.topicSession.state.replyContent).toContain('upload://test.jpeg');
    expect(hook.result.current.actions.actionBusy).toBe(false);
  });

  it('[REG-WRITE-008] sends no NodeSeek request when vote confirmation is canceled', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { detailKey } = seedTopicCache();
    const hook = await renderActions();

    await act(async () => {
      await hook.result.current.actions.votePoll(poll, ['1']);
    });
    const buttons = alert.mock.calls[0]?.[2] || [];
    await act(async () => {
      buttons.find((button) => button.text === '取消')?.onPress?.();
    });

    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(mockFetchNodeSeekVoteInfo).not.toHaveBeenCalled();
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.polls?.[0]?.voted).not.toBe(true);
  });

  it('[REG-WRITE-008] keeps NodeSeek voting at exactly one POST followed by one result GET', async () => {
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    mockFetchNodeSeekVoteInfo.mockResolvedValueOnce({
      ...poll,
      voted: true,
      options: poll.options.map((option) => ({ ...option, selected: option.id === '1' }))
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const submit = buttons?.find((button) => button.text === '提交');
      submit?.onPress?.();
      submit?.onPress?.();
    });
    seedTopicCache();
    const hook = await renderActions();

    await act(async () => {
      await hook.result.current.actions.votePoll(poll, ['1']);
    });
    await waitFor(() => expect(mockFetchNodeSeekVoteInfo).toHaveBeenCalledTimes(1));

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(mockRunNodeSeekAction.mock.calls[0]?.[0].request.method).toBe('POST');
    expect(mockFetchNodeSeekVoteInfo).toHaveBeenCalledTimes(1);
    expect(mockRunNodeSeekAction.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetchNodeSeekVoteInfo.mock.invocationCallOrder[0] || 0
    );
    alert.mockRestore();
  });

  it('[REG-WRITE-007] keeps a submitted NodeSeek selection without inventing unknown counts when result GET fails', async () => {
    const unknownPoll: TopicPoll = {
      id: '2443',
      title: 'NodeSeek poll',
      options: [
        { id: '71', label: 'A', count: 2 },
        { id: '72', label: 'B' }
      ]
    };
    const topic = detailFor('nodeseek', { polls: [unknownPoll] });
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    mockFetchNodeSeekVoteInfo.mockRejectedValueOnce(new Error('result refresh failed'));
    const notify = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '提交')?.onPress?.();
    });
    const { detailKey } = seedTopicCache(topic);
    const hook = await renderActions({ notify, topicDetail: topic });

    await act(async () => {
      await hook.result.current.actions.votePoll(unknownPoll, ['72']);
    });
    await waitFor(() => expect(notify).toHaveBeenCalledWith('提交成功但结果刷新失败，请手动刷新。'));

    const updatedPoll = appQueryClient.getQueryData<TopicDetail>(detailKey)?.polls?.[0];
    expect(updatedPoll).toMatchObject({
      id: '2443',
      voted: true,
      options: [
        { id: '71', count: 2, selected: false },
        { id: '72', selected: true }
      ]
    });
    expect(updatedPoll?.options[1]).not.toHaveProperty('count');
    expect(lines.map((line) => JSON.parse(line) as DiagnosticEvent)).toContainEqual(
      expect.objectContaining({ phase: 'finish', outcome: 'partial', reason: 'refresh_failed' })
    );
    alert.mockRestore();
  });

  it('[REG-WRITE-008] does not add NodeSeek confirmation to LinuxDo or Yaohuo polls', async () => {
    const discoursePoll: TopicPoll = {
      id: 'linuxdo-poll',
      name: 'poll_name',
      postId: '42',
      options: [{ id: '1', label: 'A' }]
    };
    const yaohuoPoll: TopicPoll = {
      id: 'yaohuo-poll',
      options: [{ id: '1', label: 'A' }]
    };
    const linuxDetail = detailFor('linuxdo', { polls: [discoursePoll] });
    const yaohuoDetail = detailFor('yaohuo', { categoryId: '177', polls: [yaohuoPoll] });
    seedTopicCache(linuxDetail);
    seedTopicCache(yaohuoDetail);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const linuxHook = await renderActions({ topicDetail: linuxDetail });
    const yaohuoHook = await renderActions({ topicDetail: yaohuoDetail });

    await act(async () => {
      await linuxHook.result.current.actions.votePoll(discoursePoll, ['1']);
      await yaohuoHook.result.current.actions.votePoll(yaohuoPoll, ['1']);
    });

    expect(alert).not.toHaveBeenCalled();
    expect(mockDiscourseExecute).toHaveBeenCalledTimes(1);
    expect(mockRunYaohuoAction).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-012] applies a confirmed Xiaoyinsi vote only to the exact topic cache', async () => {
    const xiaPoll: TopicPoll = {
      id: 'xiaoyinsi-poll',
      name: 'poll_name',
      postId: '42',
      options: [{ id: '1', label: 'A' }]
    };
    const xiaDetail = detailFor('xiaoyinsi', { polls: [xiaPoll] });
    const { detailKey } = seedTopicCache(xiaDetail);
    const hook = await renderActions({ topicDetail: xiaDetail });

    await act(async () => {
      await hook.result.current.actions.votePoll(xiaPoll, ['1']);
    });

    expect(mockDiscourseExecute).toHaveBeenCalledTimes(1);
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.polls?.[0]).toMatchObject({
      id: 'xiaoyinsi-poll',
      voted: true,
      options: [{ id: '1', selected: true }]
    });
  });
});
