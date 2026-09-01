import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';

jest.mock('@/sources/nodeseek/actionClient', () => ({
  ...jest.requireActual<typeof import('@/sources/nodeseek/actionClient')>('@/sources/nodeseek/actionClient'),
  fetchNodeSeekVoteInfo: jest.fn(),
  runNodeSeekAction: jest.fn()
}));

jest.mock('@/sources/yaohuo/actionClient', () => ({
  runYaohuoAction: jest.fn()
}));

jest.mock('@/sources/linuxdo/actionClient', () => ({
  runLinuxDoAction: jest.fn()
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn()
}));

jest.mock('@/sources/nodeimage/upload', () => ({
  ...jest.requireActual<typeof import('@/sources/nodeimage/upload')>('@/sources/nodeimage/upload'),
  uploadNodeSeekReplyImageWithApiKey: jest.fn()
}));

jest.mock('@/sources/nodeimage/credentials', () => ({
  currentNodeImageApiKeyGeneration: jest.fn()
}));

jest.mock('@/platform/network/managedCookies', () => ({
  readManagedCookieHeader: jest.fn(async () => ({
    status: 'ok',
    header: 'sidyaohuo=test'
  }))
}));

import { fetchNodeSeekVoteInfo, runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { runYaohuoAction, type YaohuoActionResult } from '@/sources/yaohuo/actionClient';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { useTopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import { uploadNodeSeekReplyImageWithApiKey } from '@/sources/nodeimage/upload';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { type DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import {
  createSiteSessionStates,
  createSiteSessionViewModels,
  type ScopedSiteSessionEvent,
  type SiteSessionStates,
  type SiteSessionViewModels
} from '@/domain/session/siteSessionState';
import type { Reply, Source, TopicDetail, TopicPoll } from '@/domain/forum/models';
import {
  nodeSeekPendingPollToken,
  normalizePendingNodeSeekPoll,
  type ComposerSnapshot
} from '@/domain/forum/structuredComposer';
import { WritableSessionBlockedError, type WritableSessionTicket } from '@/domain/session/writableSessionGate';
import { readNodeSeekPollJournalEntry, saveNodeSeekPollJournalEntry } from '@/platform/persistence/nodeSeekPollJournal';
import { QueryTestWrapper } from '../QueryTestWrapper';

const mockRunNodeSeekAction = jest.mocked(runNodeSeekAction);
const mockFetchNodeSeekVoteInfo = jest.mocked(fetchNodeSeekVoteInfo);
const mockRunYaohuoAction = jest.mocked(runYaohuoAction);
const mockRunLinuxDoAction = jest.mocked(runLinuxDoAction);
const runLinuxDoActionActual = jest.requireActual<typeof import('@/sources/linuxdo/actionClient')>(
  '@/sources/linuxdo/actionClient'
).runLinuxDoAction;
const mockGetDocument = jest.mocked(DocumentPicker.getDocumentAsync);
const mockUploadNodeSeekReplyImage = jest.mocked(uploadNodeSeekReplyImageWithApiKey);
const mockCurrentNodeImageGeneration = jest.mocked(currentNodeImageApiKeyGeneration);

const poll: TopicPoll = {
  id: '81',
  title: 'Choose',
  options: [
    { id: '1', label: 'One', count: 2 },
    { id: '2', label: 'Two', count: 3 }
  ]
};

const ownedNodeSeekPoll: TopicPoll = { ...poll, ownerId: '7' };

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

const editableReply: Reply = {
  author: 'alice',
  canEdit: true,
  commentId: 101,
  contentHtml: '<p>old</p>',
  contentMarkdown: 'old',
  createdAt: '2026-07-20T00:01:00.000Z',
  floor: 2
};

type ActionSource = Exclude<Source, 'v2ex'>;

function loggedInStates(source: ActionSource = 'nodeseek') {
  const states = createSiteSessionStates();
  return createSiteSessionStates({
    [source]: { ...states[source], status: 'logged-in' as const }
  } as Partial<SiteSessionStates>);
}

function nodeSeekLoggedInViewModels() {
  const states = loggedInStates('nodeseek');
  states.nodeseek = {
    ...states.nodeseek,
    currentUser: {
      source: 'nodeseek',
      id: '7',
      username: 'payer',
      url: 'https://www.nodeseek.com/space/7',
      topics: []
    }
  };
  return createSiteSessionViewModels(states);
}

function stardustStatusResponse(records: Record<string, unknown>[] = []) {
  return new Response(JSON.stringify({ success: true, records, exist_more: false }));
}

function snapshotWithNodeSeekPoll(localId: string): ComposerSnapshot {
  const poll = normalizePendingNodeSeekPoll({
    localId,
    title: '测试投票',
    multiple: false,
    isPublic: true,
    options: ['A', 'B']
  });
  return {
    revision: 1,
    markdown: `正文前\n\n${nodeSeekPendingPollToken(localId)}\n\n正文后`,
    mode: 'rich',
    isEmpty: false,
    validationIssues: [],
    pendingNodeSeekPolls: [poll]
  };
}

function snapshotWithNodeSeekPolls(markdownLocalIds: string[], sidecarLocalIds = markdownLocalIds): ComposerSnapshot {
  const polls = sidecarLocalIds.map((localId) =>
    normalizePendingNodeSeekPoll({
      localId,
      title: `测试投票 ${localId}`,
      multiple: false,
      isPublic: true,
      options: ['A', 'B']
    })
  );
  return {
    revision: 1,
    markdown: markdownLocalIds.map((localId) => nodeSeekPendingPollToken(localId)).join('\n\n'),
    mode: 'rich',
    isEmpty: false,
    validationIssues: [],
    pendingNodeSeekPolls: polls
  };
}

function detailFor(source: ActionSource, patch: Partial<TopicDetail> = {}): TopicDetail {
  return {
    ...detail,
    source,
    url:
      source === 'linuxdo'
        ? 'https://linux.do/t/query-mutation/42'
        : source === 'yaohuo'
          ? 'https://www.yaohuo.me/bbs/book_view.aspx?id=42&classid=177'
          : detail.url,
    ...patch
  };
}

async function renderActions({
  active = true,
  sessionEpochs = initialForumSessionEpochs,
  showLinuxDoVerification = jest.fn(),
  ensureNodeImageApiKey = jest.fn(async () => null),
  ensureWritableSession,
  fetcher = jest.fn(async () => new Response('{}')),
  isWritableSessionTicketCurrent,
  notify = jest.fn(),
  onSessionExpired = jest.fn(),
  readPlanScope = '',
  refreshTopicReplies = jest.fn(async () => 'completed'),
  siteSessionViewModels,
  siteSessionStates,
  topicDetail = detail,
  topicReplies = []
}: {
  active?: boolean;
  sessionEpochs?: ForumSessionEpochs;
  dispatchSiteSessionEvent?: (event: ScopedSiteSessionEvent) => void;
  showLinuxDoVerification?: (message?: string) => void;
  ensureNodeImageApiKey?: () => Promise<string | null>;
  ensureWritableSession?: (source: ActionSource) => Promise<WritableSessionTicket>;
  fetcher?: typeof fetch;
  isWritableSessionTicketCurrent?: (ticket: WritableSessionTicket) => boolean;
  notify?: (message: string) => void;
  onSessionExpired?: (source: ActionSource, requestSessionEpoch: number) => void;
  readPlanScope?: string;
  refreshTopicReplies?: () => Promise<unknown>;
  showYaohuoLogin?: (message?: string) => void;
  siteSessionViewModels?: SiteSessionViewModels;
  siteSessionStates?: SiteSessionStates;
  topicDetail?: TopicDetail;
  topicReplies?: Reply[];
} = {}) {
  const hook = await renderNativeHook(
    (props: { active?: boolean; sessionEpochs: ForumSessionEpochs; topicReplies?: Reply[] }) => {
      const topicSession = useTopicSessionController({ notify, topic: topicDetail });
      const actions = useTopicActionsController({
        active: props.active ?? active,
        sessionEpochs: props.sessionEpochs,
        linuxDoUserAgent: () => 'safe-agent',
        showLinuxDoVerification,
        ensureNodeImageApiKey,
        ensureWritableSession:
          ensureWritableSession ||
          (async (source) => ({
            source,
            identityKey: `${source}:test-user`,
            sessionEpoch: props.sessionEpochs[source]
          })),
        fetcher,
        isWritableSessionTicketCurrent:
          isWritableSessionTicketCurrent || ((ticket) => ticket.sessionEpoch === props.sessionEpochs[ticket.source]),
        getNodeSeekUserAgent: () => 'safe-agent',
        notify,
        onSessionExpired,
        readGateway: {
          getReadPlan: () => ({
            state: 'ready',
            lane: 'authenticated',
            authenticated: true,
            transport: 'managed-session',
            cacheScope: readPlanScope
          })
        },
        refreshTopicReplies,
        siteSessionViewModels:
          siteSessionViewModels ||
          createSiteSessionViewModels(siteSessionStates || loggedInStates(topicDetail.source as ActionSource)),
        topicDetail,
        topicReplies: props.topicReplies ?? topicReplies,
        topicSession
      });
      return { actions, topicSession };
    },
    {
      initialProps: { sessionEpochs },
      wrapper: QueryTestWrapper
    }
  );
  await act(async () => {
    hook.result.current.topicSession.commands.composer.toggle(true);
  });
  return hook;
}

function seedTopicCache(
  topicDetail: TopicDetail = detail,
  topicReplies: Reply[] = [],
  scope = initialForumSessionEpochs,
  readPlanScope = ''
) {
  const detailKey = forumQueryKeys.topic({ source: topicDetail.source, topicId: topicDetail.id, scope, readPlanScope });
  const repliesKey = forumQueryKeys.replies(detailKey, 'oldest', readPlanScope);
  appQueryClient.setQueryData(detailKey, topicDetail);
  appQueryClient.setQueryData(repliesKey, {
    pages: [{ items: topicReplies, hasMore: false, nextPage: null }],
    pageParams: [null]
  });
  return { detailKey, repliesKey };
}

describe('topic action query mutations', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    appQueryClient.clear();
    jest.clearAllMocks();
    mockRunNodeSeekAction.mockReset();
    mockFetchNodeSeekVoteInfo.mockReset();
    mockRunYaohuoAction.mockReset().mockResolvedValue({ status: 'confirmed', message: '操作已提交' });
    mockRunLinuxDoAction.mockReset().mockImplementation((options) => {
      const path = options.request.path;
      return path === '/site.json' || path === '/session/current.json' || path.startsWith('/discourse_templates')
        ? runLinuxDoActionActual(options)
        : Promise.resolve({ success: true });
    });
    mockGetDocument.mockReset().mockResolvedValue({ canceled: true, assets: null });
    mockUploadNodeSeekReplyImage.mockReset().mockResolvedValue('https://nodeimage.com/test.png');
    mockCurrentNodeImageGeneration.mockReset().mockReturnValue(0);
  });

  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    setDiagnosticWriter(null);
    jest.restoreAllMocks();
  });

  it('uses refreshed account status for the current Topic action decision', async () => {
    const workflowStates = loggedInStates('linuxdo');
    const accountStates = createSiteSessionStates({
      linuxdo: { ...workflowStates.linuxdo, status: 'verifying', isVerifying: true }
    });
    const hook = await renderActions({
      siteSessionStates: workflowStates,
      siteSessionViewModels: createSiteSessionViewModels(accountStates),
      topicDetail: detailFor('linuxdo')
    });

    expect(hook.result.current.actions.decisionFor({ action: 'reply' })).toEqual({
      allowed: false,
      reason: 'login-required'
    });
  });

  it('loads LinuxDo poll capabilities inside one writable ticket', async () => {
    const fetcher = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.endsWith('/site.json')
            ? {
                groups: [
                  { id: 10, name: 'trust_level_1', display_name: '信任级别 1' },
                  { id: 0, name: 'everyone' }
                ]
              }
            : { current_user: { staff: false } }
        )
      );
    });
    const ensureWritableSession = jest.fn(async () => ({
      source: 'linuxdo' as const,
      identityKey: 'linuxdo:account-a',
      sessionEpoch: 3
    }));
    const isWritableSessionTicketCurrent = jest.fn(() => true);
    const hook = await renderActions({
      ensureWritableSession,
      fetcher,
      isWritableSessionTicketCurrent,
      sessionEpochs: { ...initialForumSessionEpochs, linuxdo: 3 },
      topicDetail: detailFor('linuxdo')
    });

    let capabilities;
    await act(async () => {
      capabilities = await hook.result.current.actions.loadLinuxDoPollCapabilities();
    });

    expect(capabilities).toEqual({
      groups: [{ id: 10, name: 'trust_level_1', displayName: '信任级别 1' }],
      canUseStaffResults: false
    });
    expect(ensureWritableSession).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(isWritableSessionTicketCurrent).toHaveBeenCalledTimes(6);
  });

  it('stops LinuxDo template accounting when the writable ticket changes after CSRF', async () => {
    let ticketCurrent = true;
    const fetcher = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/session/csrf')) ticketCurrent = false;
      return new Response(JSON.stringify(url.endsWith('/session/csrf') ? { csrf: 'token' } : { usage_count: 1 }));
    });
    const hook = await renderActions({
      ensureWritableSession: jest.fn(async () => ({
        source: 'linuxdo' as const,
        identityKey: 'linuxdo:account-a',
        sessionEpoch: 3
      })),
      fetcher,
      isWritableSessionTicketCurrent: jest.fn(() => ticketCurrent),
      sessionEpochs: { ...initialForumSessionEpochs, linuxdo: 3 },
      topicDetail: detailFor('linuxdo')
    });
    let failure: unknown;

    await act(async () => {
      try {
        await hook.result.current.actions.useLinuxDoTemplate('7');
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeInstanceOf(Error);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual(['https://linux.do/session/csrf']);
  });

  it('treats a completed NodeSeek target as the same decision-chain outcome', async () => {
    const completed = { ...detail, upvoted: true };
    const hook = await renderActions({ topicDetail: completed });

    expect(
      hook.result.current.actions.decisionFor({ action: 'like', interaction: 'upvote', target: completed })
    ).toEqual({
      allowed: false,
      reason: 'already-complete'
    });

    await act(async () => {
      await hook.result.current.actions.interact('upvote', completed.commentId);
    });
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
  });

  it('blocks before optimistic state and transport when identity is unknown', async () => {
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

  it('applies optimistic writes only to the current read-plan cache scope', async () => {
    const readPlanScope = 'authenticated:nodeseek:0';
    const { detailKey } = seedTopicCache(detail, [], initialForumSessionEpochs, readPlanScope);
    const legacyKey = forumQueryKeys.topic({
      source: detail.source,
      topicId: detail.id,
      scope: initialForumSessionEpochs
    });
    appQueryClient.setQueryData(legacyKey, detail);
    const hook = await renderActions({ readPlanScope });

    await act(async () => {
      await hook.result.current.actions.collectOnNodeSeekSite();
    });

    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.collected).toBe(true);
    expect(appQueryClient.getQueryData<TopicDetail>(legacyKey)?.collected).toBe(false);
  });

  it('blocks before optimistic state when identity changes during query cancellation', async () => {
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
    await waitFor(() => expect(cancelQueries).toHaveBeenCalledTimes(3));

    ticketCurrent = false;
    await act(async () => {
      cancellation.resolve();
      await collection;
    });

    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.collected).toBe(false);
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
  });

  it('blocks before file selection and upload when identity is dirty', async () => {
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

  it('rejects a duplicate reply submit before a second scoped transport is queued', async () => {
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

  it('reports an unexpected credential preparation failure to the user', async () => {
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
    expect(notify).not.toHaveBeenCalledWith('收藏已提交');
  });

  it('settles a confirmed reply without refreshing an inactive Topic route', async () => {
    let active = true;
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    const refreshTopicReplies = jest.fn(async () => 'completed');
    const { detailKey, repliesKey } = seedTopicCache();
    const newestKey = forumQueryKeys.replies(detailKey, 'newest');
    appQueryClient.setQueryData(newestKey, {
      pages: [{ items: [], hasMore: false, nextPage: null }],
      pageParams: [{ kind: 'start' }]
    });
    const hook = await renderActions({ active, refreshTopicReplies });
    let submission!: Promise<void>;

    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply after navigation');
    });
    await act(async () => {
      submission = hook.result.current.actions.submitReply();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1));

    active = false;
    await act(async () => {
      await hook.rerender({ active, sessionEpochs: initialForumSessionEpochs });
    });
    await act(async () => {
      transport.resolve({ success: true });
      await submission;
    });

    expect(refreshTopicReplies).not.toHaveBeenCalled();
    expect(appQueryClient.getQueryData(detailKey)).toBeDefined();
    expect(appQueryClient.getQueryData(repliesKey)).toBeDefined();
    expect(appQueryClient.getQueryData(newestKey)).toBeDefined();
    expect(appQueryClient.getQueryState(repliesKey)?.isInvalidated).toBe(true);
    expect(appQueryClient.getQueryState(newestKey)?.isInvalidated).toBe(true);
    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
  });

  it('marks write caches stale without a competing refetch', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const refreshTopicReplies = jest.fn(async (_options?: unknown) => 'failed');
    const notify = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    const { detailKey, repliesKey } = seedTopicCache(linuxDetail);
    const invalidateQueries = jest.spyOn(appQueryClient, 'invalidateQueries');
    const hook = await renderActions({ notify, refreshTopicReplies, topicDetail: linuxDetail });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('confirmed reply');
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1);
    expect(refreshTopicReplies).toHaveBeenCalledWith({ kind: 'created', silent: true }, expect.any(Object));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: detailKey, exact: true, refetchType: 'none' });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: repliesKey, exact: true, refetchType: 'none' });
    expect(notify).toHaveBeenCalledWith('回复已提交');
    expect(lines.map((line) => JSON.parse(line) as DiagnosticEvent)).toContainEqual(
      expect.objectContaining({
        area: 'reply',
        operation: 'submit',
        phase: 'finish',
        outcome: 'partial',
        reason: 'refresh_failed'
      })
    );
  });

  it('reports a confirmed NodeSeek reply as submitted but unlocated without resending it', async () => {
    const refreshTopicReplies = jest.fn(async () => 'failed');
    const notify = jest.fn();
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    seedTopicCache();
    const hook = await renderActions({
      notify,
      refreshTopicReplies,
      siteSessionViewModels: nodeSeekLoggedInViewModels()
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('same reply');
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(refreshTopicReplies).toHaveBeenCalledWith(
      {
        kind: 'created',
        silent: true,
        nodeSeekAuthorId: '7',
        nodeSeekContentMarkdown: 'same reply'
      },
      expect.any(Object)
    );
    expect(notify).toHaveBeenCalledWith('回复已提交，但暂未能显示；请手动刷新，勿重复发送');
    expect(notify).not.toHaveBeenCalledWith('回复已提交');
  });

  it('settles a server-confirmed write as stale when its ticket changes during refresh', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const refresh = Promise.withResolvers<'completed'>();
    const refreshTopicReplies = jest.fn(async () => refresh.promise);
    let ticketCurrent = true;
    const notify = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDetail);
    const hook = await renderActions({
      isWritableSessionTicketCurrent: () => ticketCurrent,
      notify,
      refreshTopicReplies,
      topicDetail: linuxDetail
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('confirmed reply');
    });
    let submission!: Promise<void>;

    await act(async () => {
      submission = hook.result.current.actions.submitReply();
      await Promise.resolve();
    });
    await waitFor(() => expect(refreshTopicReplies).toHaveBeenCalledTimes(1));
    const nextScope = { ...initialForumSessionEpochs, linuxdo: 1 };
    const nextDetail = detailFor('linuxdo', { title: 'new epoch canary' });
    const { detailKey: nextDetailKey } = seedTopicCache(nextDetail, [], nextScope);
    await act(async () => {
      await hook.rerender({ sessionEpochs: nextScope });
    });
    ticketCurrent = false;
    await act(async () => {
      refresh.resolve('completed');
      await submission;
    });

    expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(appQueryClient.getQueryData<TopicDetail>(nextDetailKey)).toEqual(nextDetail);
    const finishes = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'reply' && event.operation === 'submit' && event.phase === 'finish');
    expect(finishes).toEqual([
      expect.objectContaining({
        outcome: 'stale',
        reason: 'stale',
        serverConfirmed: true
      })
    ]);
  });

  it('preserves server confirmation without writing a newer epoch cache', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const transport = Promise.withResolvers<{ success: true }>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    let ticketCurrent = true;
    const notify = jest.fn();
    const { detailKey } = seedTopicCache();
    const hook = await renderActions({
      isWritableSessionTicketCurrent: () => ticketCurrent,
      notify
    });
    let collection!: Promise<void>;

    await act(async () => {
      collection = hook.result.current.actions.collectOnNodeSeekSite();
      await Promise.resolve();
    });
    await waitFor(() => expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.collected).toBe(true));

    const nextScope = { ...initialForumSessionEpochs, nodeseek: 1 };
    const nextDetail = detailFor('nodeseek', { collected: false, title: 'new epoch canary' });
    const { detailKey: nextDetailKey } = seedTopicCache(nextDetail, [], nextScope);
    await act(async () => {
      await hook.rerender({ sessionEpochs: nextScope });
    });
    ticketCurrent = false;
    await act(async () => {
      transport.resolve({ success: true });
      await collection;
    });

    expect(notify).not.toHaveBeenCalledWith('收藏已提交');
    expect(appQueryClient.getQueryData<TopicDetail>(nextDetailKey)).toEqual(nextDetail);
    const finishes = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'topic' && event.operation === 'collection' && event.phase === 'finish');
    expect(finishes).toEqual([
      expect.objectContaining({
        outcome: 'stale',
        reason: 'stale',
        serverConfirmed: true
      })
    ]);
  });

  it('preserves a confirmed Yaohuo result when its ticket expires before apply', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    let ticketCurrent = true;
    mockRunYaohuoAction.mockImplementationOnce(async () => {
      ticketCurrent = false;
      return {
        status: 'confirmed',
        message: '收藏成功',
        favoriteId: 987
      };
    });
    const notify = jest.fn();
    const yaohuoDetail = detailFor('yaohuo', {
      bookmarked: false,
      categoryId: '177',
      polls: []
    });
    const { detailKey } = seedTopicCache(yaohuoDetail);
    const hook = await renderActions({
      isWritableSessionTicketCurrent: () => ticketCurrent,
      notify,
      topicDetail: yaohuoDetail
    });

    await act(async () => {
      await hook.result.current.actions.favoriteOnYaohuoSite();
    });

    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      bookmarked: true,
      bookmarkId: undefined
    });
    expect(notify).not.toHaveBeenCalled();
    const finishes = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'topic' && event.operation === 'favorite' && event.phase === 'finish');
    expect(finishes).toEqual([
      expect.objectContaining({
        outcome: 'stale',
        reason: 'stale',
        serverConfirmed: true
      })
    ]);
  });

  it('preserves a confirmed Discourse result when its ticket expires before apply', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    let ticketCurrent = true;
    mockRunLinuxDoAction.mockImplementationOnce(async () => {
      ticketCurrent = false;
      return { success: true };
    });
    const notify = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDetail);
    const hook = await renderActions({
      isWritableSessionTicketCurrent: () => ticketCurrent,
      notify,
      topicDetail: linuxDetail
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('confirmed reply');
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(hook.result.current.topicSession.state.replyContent).toBe('confirmed reply');
    expect(notify).not.toHaveBeenCalled();
    const finishes = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'reply' && event.operation === 'submit' && event.phase === 'finish');
    expect(finishes).toEqual([
      expect.objectContaining({
        outcome: 'stale',
        reason: 'stale',
        serverConfirmed: true
      })
    ]);
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
    await waitFor(() =>
      expect(
        hook.result.current.actions.decisionFor({
          action: 'like',
          interaction: 'upvote',
          target: appQueryClient.getQueryData<TopicDetail>(detailKey)
        })
      ).toEqual({
        allowed: false,
        reason: 'pending'
      })
    );

    await act(async () => {
      transport.reject(new Error('network failed'));
      await interaction;
    });
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.upvoted).toBe(false);
  });

  it('does not roll an old reply snapshot over a newer target window', async () => {
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    const original = { ...editableReply, canLike: true, upvoted: false };
    const target = { ...editableReply, commentId: 150, floor: 50, author: 'target' };
    const { repliesKey } = seedTopicCache({ ...detail, replyCount: 1 }, [original]);
    const hook = await renderActions({ topicDetail: { ...detail, replyCount: 1 }, topicReplies: [original] });
    let interaction!: Promise<void>;

    await act(async () => {
      interaction = hook.result.current.actions.interact('upvote', original.commentId);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        (appQueryClient.getQueryData<{ pages: { items: Reply[] }[] }>(repliesKey)?.pages[0]?.items[0] as Reply).upvoted
      ).toBe(true)
    );
    appQueryClient.setQueryData(repliesKey, {
      pages: [{ items: [target], currentPage: 5, currentOffset: 40, hasMore: false, nextPage: null }],
      pageParams: [{ kind: 'cursor', page: 5, offset: 40 }]
    });

    await act(async () => {
      transport.reject(new Error('network failed'));
      await interaction;
    });

    expect(appQueryClient.getQueryData<{ pages: { items: Reply[] }[] }>(repliesKey)?.pages[0]?.items).toEqual([target]);
  });

  it('projects an interaction into both loaded reply orders', async () => {
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    const reply = { ...editableReply, canLike: true, upvoted: false };
    const actionDetail = { ...detail, replyCount: 1 };
    const { detailKey, repliesKey } = seedTopicCache(actionDetail, [reply]);
    const newestKey = forumQueryKeys.replies(detailKey, 'newest');
    appQueryClient.setQueryData(newestKey, {
      pages: [{ items: [reply], hasMore: false, nextPage: null }],
      pageParams: [{ kind: 'start' }]
    });
    const hook = await renderActions({ topicDetail: actionDetail, topicReplies: [reply] });
    const cancelQueries = jest.spyOn(appQueryClient, 'cancelQueries');
    let interaction!: Promise<void>;

    await act(async () => {
      interaction = hook.result.current.actions.interact('upvote', reply.commentId);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(appQueryClient.getQueryData<{ pages: { items: Reply[] }[] }>(newestKey)?.pages[0]?.items[0]).toMatchObject(
        {
          upvoted: true
        }
      )
    );
    appQueryClient.setQueryData(newestKey, {
      pages: [{ items: [reply], hasMore: false, nextPage: null }],
      pageParams: [{ kind: 'start' }]
    });
    await act(async () => {
      transport.resolve(true);
      await interaction;
    });

    for (const key of [repliesKey, newestKey]) {
      expect(appQueryClient.getQueryData<{ pages: { items: Reply[] }[] }>(key)?.pages[0]?.items[0]).toMatchObject({
        commentId: reply.commentId,
        upvoted: true
      });
    }
    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: newestKey, exact: true });
  });

  it('keeps the current order cache when a pending submit crosses an order change', async () => {
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    const { detailKey, repliesKey } = seedTopicCache();
    const newestKey = forumQueryKeys.replies(detailKey, 'newest');
    appQueryClient.setQueryData(newestKey, {
      pages: [{ items: [{ ...editableReply, floor: 50 }], hasMore: false, nextPage: null }],
      pageParams: [{ kind: 'start' }]
    });
    const refresh = Promise.withResolvers<'completed'>();
    const refreshTopicReplies = jest.fn(async () => refresh.promise);
    const hook = await renderActions({ refreshTopicReplies });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('submitted after order change');
    });
    let submission!: Promise<void>;
    await act(async () => {
      submission = hook.result.current.actions.submitReply();
      await Promise.resolve();
    });

    await act(async () => {
      transport.resolve(true);
      await Promise.resolve();
    });
    await waitFor(() => expect(refreshTopicReplies).toHaveBeenCalledTimes(1));
    await act(async () => {
      hook.result.current.topicSession.commands.view.changeReplyOrder('newest');
      refresh.resolve('completed');
      await submission;
    });

    expect(refreshTopicReplies).toHaveBeenCalledTimes(1);
    expect(appQueryClient.getQueryData(newestKey)).toBeDefined();
    expect(appQueryClient.getQueryData(repliesKey)).toBeDefined();
    expect(appQueryClient.getQueryState(newestKey)?.isInvalidated).toBe(true);
    expect(appQueryClient.getQueryState(repliesKey)?.isInvalidated).toBe(true);
  });

  it('snapshots optimistic mutations only when their scoped transport starts', async () => {
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

  it('does not repopulate a cleared old scope after an unconfirmed stale failure', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const transport = Promise.withResolvers<unknown>();
    mockRunNodeSeekAction.mockImplementationOnce(async () => transport.promise);
    let ticketCurrent = true;
    const notify = jest.fn();
    const { detailKey } = seedTopicCache();
    const hook = await renderActions({
      isWritableSessionTicketCurrent: () => ticketCurrent,
      notify
    });
    let collection!: Promise<void>;

    await act(async () => {
      collection = hook.result.current.actions.collectOnNodeSeekSite();
      await Promise.resolve();
    });
    await waitFor(() => expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.collected).toBe(true));

    const nextScope = { ...initialForumSessionEpochs, nodeseek: 1 };
    const nextDetail = detailFor('nodeseek', { collected: false, title: 'new epoch canary' });
    const { detailKey: nextDetailKey } = seedTopicCache(nextDetail, [], nextScope);
    await act(async () => {
      await hook.rerender({ sessionEpochs: nextScope });
    });
    ticketCurrent = false;
    appQueryClient.removeQueries({ queryKey: detailKey, exact: true });
    await act(async () => {
      transport.reject(new Error('old scope failed'));
      await collection;
    });

    expect(appQueryClient.getQueryData(detailKey)).toBeUndefined();
    expect(appQueryClient.getQueryData<TopicDetail>(nextDetailKey)).toEqual(nextDetail);
    expect(notify).not.toHaveBeenCalled();
    const finishes = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'topic' && event.operation === 'collection' && event.phase === 'finish');
    expect(finishes).toEqual([
      expect.objectContaining({
        outcome: 'stale',
        reason: 'stale'
      })
    ]);
    expect(finishes[0]).not.toHaveProperty('serverConfirmed');
  });

  it('cancels an existing like even when canLike is false', async () => {
    const linuxDoDetail = detailFor('linuxdo', {
      canLike: false,
      commentId: 987654,
      liked: true,
      likeCount: 4,
      polls: []
    });
    const notify = jest.fn();
    const { detailKey } = seedTopicCache(linuxDoDetail);
    const hook = await renderActions({ notify, topicDetail: linuxDoDetail });

    await act(async () => {
      await hook.result.current.actions.interact('like', 987654);
    });

    expect(mockRunLinuxDoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          path: '/post_actions/987654?post_action_type_id=2',
          method: 'DELETE',
          headers: {},
          body: undefined
        }
      })
    );
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      liked: false,
      likeCount: 3
    });
    expect(hook.result.current.actions.actionBusy).toBe(false);
    expect(notify).not.toHaveBeenCalledWith('当前帖子不能点赞');
  });

  it('restores an existing like when cancellation fails', async () => {
    mockRunLinuxDoAction.mockRejectedValueOnce(new Error('temporary failure'));
    const linuxDoDetail = detailFor('linuxdo', {
      canLike: false,
      commentId: 987654,
      liked: true,
      likeCount: 4,
      polls: []
    });
    const { detailKey } = seedTopicCache(linuxDoDetail);
    const hook = await renderActions({ topicDetail: linuxDoDetail });

    await act(async () => {
      await hook.result.current.actions.interact('like', 987654);
    });

    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      liked: true,
      likeCount: 4
    });
  });

  it('applies a confirmed like only to the exact topic cache', async () => {
    const linuxDoDetail = detailFor('linuxdo', {
      canLike: true,
      commentId: 987654,
      liked: false,
      likeCount: 3,
      polls: []
    });
    const { detailKey } = seedTopicCache(linuxDoDetail);
    const hook = await renderActions({ topicDetail: linuxDoDetail });

    await act(async () => {
      await hook.result.current.actions.interact('like', 987654);
    });

    expect(mockRunLinuxDoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          path: '/post_actions',
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'id=987654&post_action_type_id=2'
        }
      })
    );
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      liked: true,
      likeCount: 4
    });
    expect(appQueryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
    expect(hook.result.current.actions.actionBusy).toBe(false);
  });

  it.each([
    {
      caseLabel: 'the account identity and epoch change',
      draft: '保留给新账号的草稿',
      nextIdentityKey: 'nodeseek:account-b'
    },
    {
      caseLabel: 'only the session epoch changes',
      draft: 'epoch 变化后保留的草稿',
      nextIdentityKey: 'nodeseek:account-a'
    }
  ])(
    'detaches an edit after $caseLabel and keeps its text out of every write path',
    async ({ draft, nextIdentityKey }) => {
      const nodeSeekDetail = detailFor('nodeseek', {
        canCreatePost: true,
        polls: [],
        replies: [editableReply]
      });
      const nextEpochs = { ...initialForumSessionEpochs, nodeseek: 1 };
      const ensureNodeImageApiKey = jest.fn(async () => 'must-not-be-read');
      let identityKey = 'nodeseek:account-a';
      let sessionEpoch = 0;
      const ensureWritableSession = jest.fn(async () => ({
        source: 'nodeseek' as const,
        identityKey,
        sessionEpoch
      }));
      const isWritableSessionTicketCurrent = jest.fn(
        (ticket: WritableSessionTicket) => ticket.identityKey === identityKey && ticket.sessionEpoch === sessionEpoch
      );
      seedTopicCache(nodeSeekDetail, [editableReply]);
      const hook = await renderActions({
        ensureNodeImageApiKey,
        ensureWritableSession,
        isWritableSessionTicketCurrent,
        topicDetail: nodeSeekDetail,
        topicReplies: [editableReply]
      });

      await act(async () => {
        await hook.result.current.actions.editReply(editableReply);
        hook.result.current.topicSession.commands.composer.changeContent(draft);
      });
      expect(hook.result.current.topicSession.state.replyComposerIntent).toMatchObject({
        kind: 'edit',
        target: { ticket: { identityKey } }
      });
      const staleSubmitReply = hook.result.current.actions.submitReply;
      const staleUploadReplyImage = hook.result.current.actions.uploadReplyImage;

      identityKey = nextIdentityKey;
      sessionEpoch = 1;
      await act(async () => {
        hook.rerender({ sessionEpochs: nextEpochs });
      });

      expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
      expect(hook.result.current.topicSession.state.replyContent).toBe(draft);

      await act(async () => {
        await staleSubmitReply();
        await staleUploadReplyImage();
        await hook.result.current.actions.submitReply();
        await hook.result.current.actions.uploadReplyImage();
      });

      expect(ensureNodeImageApiKey).not.toHaveBeenCalled();
      expect(mockCurrentNodeImageGeneration).not.toHaveBeenCalled();
      expect(mockGetDocument).not.toHaveBeenCalled();
      expect(mockUploadNodeSeekReplyImage).not.toHaveBeenCalled();
      expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
      expect(ensureWritableSession).toHaveBeenCalledTimes(1);
    }
  );

  it('closes an inactive edit draft when its account epoch changes', async () => {
    let active = true;
    const nodeSeekDetail = detailFor('nodeseek', {
      canCreatePost: true,
      polls: [],
      replies: [editableReply]
    });
    const ensureNodeImageApiKey = jest.fn(async () => 'must-not-be-read');
    const ensureWritableSession = jest.fn(async () => ({
      source: 'nodeseek' as const,
      identityKey: 'nodeseek:account-a',
      sessionEpoch: 0
    }));
    seedTopicCache(nodeSeekDetail, [editableReply]);
    const hook = await renderActions({
      ensureNodeImageApiKey,
      ensureWritableSession,
      active,
      topicDetail: nodeSeekDetail,
      topicReplies: [editableReply]
    });

    await act(async () => {
      await hook.result.current.actions.editReply(editableReply);
      hook.result.current.topicSession.commands.composer.changeContent('同账号返回后保留的草稿');
    });
    const staleSubmitReply = hook.result.current.actions.submitReply;
    const staleUploadReplyImage = hook.result.current.actions.uploadReplyImage;

    await act(async () => {
      active = false;
      hook.rerender({
        active,
        sessionEpochs: { ...initialForumSessionEpochs, nodeseek: 1 },
        topicReplies: [editableReply]
      });
    });
    expect(hook.result.current.topicSession.state.selectedTopic?.id).toBe(nodeSeekDetail.id);
    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('同账号返回后保留的草稿');

    await act(async () => {
      await staleSubmitReply();
      await staleUploadReplyImage();
      await hook.result.current.actions.submitReply();
      await hook.result.current.actions.uploadReplyImage();
    });

    expect(ensureNodeImageApiKey).not.toHaveBeenCalled();
    expect(mockCurrentNodeImageGeneration).not.toHaveBeenCalled();
    expect(mockGetDocument).not.toHaveBeenCalled();
    expect(mockUploadNodeSeekReplyImage).not.toHaveBeenCalled();
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(ensureWritableSession).toHaveBeenCalledTimes(1);
  });

  it('rechecks the exact cached reply permission before editing', async () => {
    const reply: Reply = {
      author: 'alice',
      canEdit: true,
      commentId: 101,
      contentHtml: '<p>old</p>',
      contentMarkdown: 'old',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const linuxDoDetail = detailFor('linuxdo', { canCreatePost: false, polls: [], replies: [reply] });
    seedTopicCache(linuxDoDetail, [reply]);
    const hook = await renderActions({ topicDetail: linuxDoDetail, topicReplies: [reply] });

    await act(async () => {
      await hook.result.current.actions.editReply(reply);
      hook.result.current.topicSession.commands.composer.changeContent('不能以旧权限提交的正文');
    });
    seedTopicCache(linuxDoDetail, [{ ...reply, canEdit: false }]);

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunLinuxDoAction).not.toHaveBeenCalled();
    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('不能以旧权限提交的正文');

    seedTopicCache(linuxDoDetail, [reply]);
    await act(async () => {
      await hook.result.current.actions.editReply(reply);
      hook.result.current.topicSession.commands.composer.changeContent('缓存已不存在的正文');
    });
    seedTopicCache(linuxDoDetail, []);
    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunLinuxDoAction).not.toHaveBeenCalled();
    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('缓存已不存在的正文');
  });

  it('fails closed on conflicting duplicate edit permissions across cached pages', async () => {
    const reply: Reply = {
      author: 'alice',
      canEdit: true,
      commentId: 101,
      contentHtml: '<p>old</p>',
      contentMarkdown: 'old',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const linuxDoDetail = detailFor('linuxdo', { canCreatePost: false, polls: [], replies: [reply] });
    const { repliesKey } = seedTopicCache(linuxDoDetail, [reply]);
    const hook = await renderActions({ topicDetail: linuxDoDetail, topicReplies: [reply] });
    await act(async () => {
      await hook.result.current.actions.editReply(reply);
      hook.result.current.topicSession.commands.composer.changeContent('跨页权限冲突时保留的正文');
    });
    const current = appQueryClient.getQueryData<{
      pages: { items: Reply[]; [key: string]: unknown }[];
      pageParams: unknown[];
    }>(repliesKey);
    appQueryClient.setQueryData(repliesKey, {
      ...current,
      pages: [
        { ...current?.pages[0], items: [reply] },
        { ...current?.pages[0], items: [{ ...reply, canEdit: false }] }
      ],
      pageParams: [null, 2]
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunLinuxDoAction).not.toHaveBeenCalled();
    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('跨页权限冲突时保留的正文');
  });

  it('immediately detaches an edit when refreshed replies revoke or remove it', async () => {
    const reply: Reply = {
      author: 'alice',
      canEdit: true,
      commentId: 101,
      contentHtml: '<p>old</p>',
      contentMarkdown: 'old',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const linuxDoDetail = detailFor('linuxdo', { canCreatePost: true, polls: [], replies: [reply] });
    seedTopicCache(linuxDoDetail, [reply]);
    const hook = await renderActions({ topicDetail: linuxDoDetail, topicReplies: [reply] });

    await act(async () => {
      await hook.result.current.actions.editReply(reply);
      hook.result.current.topicSession.commands.composer.changeContent('权限撤回后保留的草稿');
    });
    await act(async () => {
      hook.rerender({
        sessionEpochs: initialForumSessionEpochs,
        topicReplies: [{ ...reply, canEdit: false }]
      });
    });

    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('权限撤回后保留的草稿');

    await act(async () => {
      hook.rerender({ sessionEpochs: initialForumSessionEpochs, topicReplies: [reply] });
      await hook.result.current.actions.editReply(reply);
      hook.result.current.topicSession.commands.composer.changeContent('回复消失后保留的草稿');
    });
    await act(async () => {
      hook.rerender({ sessionEpochs: initialForumSessionEpochs, topicReplies: [] });
    });

    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('回复消失后保留的草稿');
    expect(mockRunLinuxDoAction).not.toHaveBeenCalled();
    expect(mockGetDocument).not.toHaveBeenCalled();
  });

  it('rechecks edit permission after query cancellation and before transport', async () => {
    const reply: Reply = {
      author: 'alice',
      canEdit: true,
      commentId: 101,
      contentHtml: '<p>old</p>',
      contentMarkdown: 'old',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const linuxDoDetail = detailFor('linuxdo', { canCreatePost: false, polls: [], replies: [reply] });
    const cancellation = Promise.withResolvers<void>();
    const cancelQueries = jest
      .spyOn(appQueryClient, 'cancelQueries')
      .mockImplementation(async () => cancellation.promise);
    seedTopicCache(linuxDoDetail, [reply]);
    const hook = await renderActions({ topicDetail: linuxDoDetail, topicReplies: [reply] });
    await act(async () => {
      await hook.result.current.actions.editReply(reply);
      hook.result.current.topicSession.commands.composer.changeContent('取消查询期间失效的正文');
    });
    let submission!: Promise<void>;

    await act(async () => {
      submission = hook.result.current.actions.submitReply();
      await Promise.resolve();
    });
    await waitFor(() => expect(cancelQueries).toHaveBeenCalledTimes(3));
    seedTopicCache(linuxDoDetail, [{ ...reply, canEdit: false }]);
    await act(async () => {
      cancellation.resolve();
      await submission;
    });

    expect(mockRunLinuxDoAction).not.toHaveBeenCalled();
    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('取消查询期间失效的正文');
  });

  it.each([
    { caseLabel: 'permission revoked', invalidation: 'revoked' as const },
    { caseLabel: 'reply missing', invalidation: 'missing' as const }
  ])('rejects a stale edit before NodeImage credentials and file selection ($caseLabel)', async ({ invalidation }) => {
    const reply: Reply = {
      author: 'alice',
      canEdit: true,
      commentId: 101,
      contentHtml: '<p>old</p>',
      contentMarkdown: 'old',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const nodeSeekDetail = detailFor('nodeseek', { canCreatePost: true, polls: [], replies: [reply] });
    const ensureNodeImageApiKey = jest.fn(async () => 'must-not-be-read');
    seedTopicCache(nodeSeekDetail, [reply]);
    const hook = await renderActions({
      ensureNodeImageApiKey,
      topicDetail: nodeSeekDetail,
      topicReplies: [reply]
    });

    await act(async () => {
      await hook.result.current.actions.editReply(reply);
    });
    seedTopicCache(nodeSeekDetail, invalidation === 'missing' ? [] : [{ ...reply, canEdit: false }]);
    await act(async () => {
      await hook.result.current.actions.uploadReplyImage();
    });

    expect(ensureNodeImageApiKey).not.toHaveBeenCalled();
    expect(mockCurrentNodeImageGeneration).not.toHaveBeenCalled();
    expect(mockGetDocument).not.toHaveBeenCalled();
    expect(mockUploadNodeSeekReplyImage).not.toHaveBeenCalled();
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('old');
  });

  it('rechecks edit permission after NodeImage credentials and before file selection', async () => {
    const reply: Reply = {
      author: 'alice',
      canEdit: true,
      commentId: 101,
      contentHtml: '<p>old</p>',
      contentMarkdown: 'old',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const nodeSeekDetail = detailFor('nodeseek', { canCreatePost: true, polls: [], replies: [reply] });
    const apiKey = Promise.withResolvers<string | null>();
    const ensureNodeImageApiKey = jest.fn(() => apiKey.promise);
    seedTopicCache(nodeSeekDetail, [reply]);
    const hook = await renderActions({
      ensureNodeImageApiKey,
      topicDetail: nodeSeekDetail,
      topicReplies: [reply]
    });

    await act(async () => {
      await hook.result.current.actions.editReply(reply);
    });
    let upload!: Promise<unknown>;
    await act(async () => {
      upload = hook.result.current.actions.uploadReplyImage();
      await Promise.resolve();
    });
    await waitFor(() => expect(ensureNodeImageApiKey).toHaveBeenCalledTimes(1));
    seedTopicCache(nodeSeekDetail, [{ ...reply, canEdit: false }]);
    await act(async () => {
      apiKey.resolve('must-not-authorize-picker');
      await upload;
    });

    expect(mockGetDocument).not.toHaveBeenCalled();
    expect(mockUploadNodeSeekReplyImage).not.toHaveBeenCalled();
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('old');
  });

  it('derives edit cache keys without a competing refetch', async () => {
    const reply: Reply = {
      author: 'alice',
      canEdit: true,
      commentId: 101,
      contentHtml: '<p>old</p>',
      contentMarkdown: 'old',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const linuxDoDetail = detailFor('linuxdo', { canCreatePost: false, polls: [], replies: [reply] });
    const ticketEpochs = { ...initialForumSessionEpochs, linuxdo: 7 };
    const { repliesKey } = seedTopicCache(linuxDoDetail, [reply], ticketEpochs);
    const invalidateQueries = jest.spyOn(appQueryClient, 'invalidateQueries');
    const hook = await renderActions({
      ensureWritableSession: async () => ({
        source: 'linuxdo',
        identityKey: 'linuxdo:account-a',
        sessionEpoch: 7
      }),
      isWritableSessionTicketCurrent: () => true,
      topicDetail: linuxDoDetail,
      topicReplies: [reply]
    });

    await act(async () => {
      await hook.result.current.actions.editReply(reply);
      hook.result.current.topicSession.commands.composer.changeContent('ticket epoch body');
    });
    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunLinuxDoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          path: '/posts/101.json',
          method: 'PUT'
        })
      })
    );
    expect(appQueryClient.getQueryState(repliesKey)?.isInvalidated).toBe(true);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: repliesKey, exact: true, refetchType: 'none' });
  });

  it('closes an edit composer, keeps unconfirmed content out of cache, and refreshes only replies', async () => {
    const reply: Reply = {
      author: 'alice',
      canEdit: true,
      commentId: 101,
      contentHtml: '<p>old</p>',
      contentMarkdown: 'old',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const linuxDoDetail = detailFor('linuxdo', { canCreatePost: false, polls: [], replies: [reply] });
    const { detailKey, repliesKey } = seedTopicCache(linuxDoDetail, [reply]);
    const hook = await renderActions({ topicDetail: linuxDoDetail, topicReplies: [reply] });
    await act(async () => {
      await hook.result.current.actions.editReply(reply);
      hook.result.current.topicSession.commands.composer.changeContent('server must confirm this body');
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunLinuxDoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          path: '/posts/101.json',
          method: 'PUT'
        })
      })
    );
    expect(hook.result.current.topicSession.state.replyComposerIntent.kind).toBe('closed');
    expect(hook.result.current.topicSession.state.replyContent).toBe('');
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.replies[0]?.contentHtml).toBe('<p>old</p>');
    expect(appQueryClient.getQueryState(repliesKey)?.isInvalidated).toBe(true);
    expect(appQueryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
  });

  it('removes a reply without a competing refetch', async () => {
    const reply: Reply = {
      author: 'alice',
      canDelete: true,
      commentId: 101,
      contentHtml: '<p>reply</p>',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const linuxDoDetail = detailFor('linuxdo', { polls: [], replies: [reply], replyCount: 1 });
    const { detailKey, repliesKey } = seedTopicCache(linuxDoDetail, [reply]);
    appQueryClient.setQueryData(repliesKey, {
      pages: [{ items: [reply], currentPage: 2, currentOffset: 30, hasMore: false, nextPage: null }],
      pageParams: [{ kind: 'cursor', page: 2, offset: 30 }]
    });
    const refreshTopicReplies = jest.fn(async () => 'completed');
    const invalidateQueries = jest.spyOn(appQueryClient, 'invalidateQueries');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '删除')?.onPress?.();
    });
    const hook = await renderActions({ refreshTopicReplies, topicDetail: linuxDoDetail, topicReplies: [reply] });

    await act(async () => {
      hook.result.current.actions.deleteReply(reply);
    });
    await waitFor(() => expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1));

    const replyCache = appQueryClient.getQueryData<{ pages: { items: Reply[] }[] }>(repliesKey);
    expect(replyCache?.pages[0]?.items).toEqual([]);
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({ replyCount: 0, replies: [] });
    expect(appQueryClient.getQueryState(repliesKey)?.isInvalidated).toBe(true);
    expect(appQueryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: repliesKey, exact: true, refetchType: 'none' });
    expect(refreshTopicReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'deleted',
        target: { kind: 'comment-id', commentId: 101 },
        position: { kind: 'cursor', page: 2, offset: 30 }
      }),
      expect.any(Object)
    );
    alert.mockRestore();
  });

  it.each([
    ['ordinary', new Error('删除请求失败')],
    ['permission-denied', Object.assign(new Error('没有权限删除回复'), { status: 403 })]
  ])('leaves identity unchanged for %s linux.do delete failure', async (_kind, error) => {
    mockRunLinuxDoAction.mockRejectedValueOnce(error);
    const reply: Reply = {
      author: 'alice',
      canDelete: true,
      commentId: 101,
      contentHtml: '<p>reply</p>',
      createdAt: '2026-07-20T00:01:00.000Z',
      floor: 2
    };
    const linuxDetail = detailFor('linuxdo', {
      polls: [],
      replies: [reply],
      replyCount: 1
    });
    const { detailKey } = seedTopicCache(linuxDetail, [reply]);
    const onSessionExpired = jest.fn();
    const notify = jest.fn();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '删除')?.onPress?.();
    });
    const hook = await renderActions({
      notify,
      onSessionExpired,
      topicDetail: linuxDetail,
      topicReplies: [reply]
    });

    await act(async () => {
      hook.result.current.actions.deleteReply(reply);
    });
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));

    expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(error.message);
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.replies).toEqual([reply]);
  });

  it('applies a Yaohuo favorite without global busy state', async () => {
    const transport = Promise.withResolvers<YaohuoActionResult>();
    mockRunYaohuoAction.mockImplementationOnce(async () => transport.promise);
    const yaohuoDetail = detailFor('yaohuo', {
      bookmarked: false,
      categoryId: '177',
      polls: []
    });
    const { detailKey } = seedTopicCache(yaohuoDetail);
    const notify = jest.fn();
    const hook = await renderActions({ notify, topicDetail: yaohuoDetail });
    let favorite!: Promise<void>;

    await act(async () => {
      favorite = hook.result.current.actions.favoriteOnYaohuoSite();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunYaohuoAction).toHaveBeenCalledTimes(1));
    expect(hook.result.current.actions.actionBusy).toBe(false);
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.bookmarked).toBe(true);

    await act(async () => {
      transport.resolve({ status: 'confirmed', message: '收藏成功', favoriteId: 987 });
      await favorite;
    });
    expect(mockRunYaohuoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          method: 'GET',
          path: '/bbs/Share.aspx?action=fav&siteid=1000&classid=177&id=42'
        })
      })
    );
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({
      bookmarked: true,
      bookmarkId: 987
    });
    expect(notify).toHaveBeenCalledWith('收藏已提交');
  });

  it('cancels a Yaohuo favorite and clears the visible state', async () => {
    mockRunYaohuoAction.mockResolvedValueOnce({ status: 'confirmed', message: '已取消收藏' });
    const yaohuoDetail = detailFor('yaohuo', {
      bookmarked: true,
      bookmarkId: 987,
      categoryId: '177',
      polls: []
    });
    const { detailKey } = seedTopicCache(yaohuoDetail);
    const notify = jest.fn();
    const hook = await renderActions({ notify, topicDetail: yaohuoDetail });

    await act(async () => {
      await hook.result.current.actions.favoriteOnYaohuoSite();
    });

    expect(mockRunYaohuoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          method: 'POST',
          path: '/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=987',
          headers: { accept: '*/*' }
        }
      })
    );
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)).toMatchObject({ bookmarked: false });
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.bookmarkId).toBeUndefined();
    expect(notify).toHaveBeenCalledWith('已取消收藏');
  });

  it('rolls back an unknown Yaohuo result without depending on its message', async () => {
    mockRunYaohuoAction.mockResolvedValueOnce({
      status: 'unknown',
      message: '请刷新原帖确认最新状态'
    });
    const onSessionExpired = jest.fn();
    const notify = jest.fn();
    const yaohuoDetail = detailFor('yaohuo', {
      bookmarked: false,
      categoryId: '177',
      polls: []
    });
    const { detailKey } = seedTopicCache(yaohuoDetail);
    const hook = await renderActions({
      notify,
      onSessionExpired,
      topicDetail: yaohuoDetail
    });

    await act(async () => {
      await hook.result.current.actions.favoriteOnYaohuoSite();
    });

    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('请刷新原帖确认最新状态');
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.bookmarked).toBe(false);
  });

  it('expires a write ticket once on raw HTTP 401 without replaying the write', async () => {
    const fetcher = jest.fn(async () => new Response('<html>login</html>', { status: 401 }));
    mockRunNodeSeekAction.mockImplementationOnce(async ({ fetcher: request }) => {
      await request!('https://www.nodeseek.com/api/attendance');
      return { success: true };
    });
    const onSessionExpired = jest.fn();
    seedTopicCache();
    const hook = await renderActions({ fetcher, onSessionExpired });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledWith('nodeseek', initialForumSessionEpochs.nodeseek);
  });

  it('does not expire a write ticket on raw HTTP 403', async () => {
    const fetcher = jest.fn(async () => new Response('<html>forbidden</html>', { status: 403 }));
    mockRunNodeSeekAction.mockImplementationOnce(async ({ fetcher: request }) => {
      const response = await request!('https://www.nodeseek.com/api/attendance');
      throw Object.assign(new Error('没有权限执行该操作'), { status: response.status });
    });
    const onSessionExpired = jest.fn();
    seedTopicCache();
    const hook = await renderActions({ fetcher, onSessionExpired });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });
    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it.each([
    [
      'expiry hint',
      Object.assign(new Error('妖火登录已失效'), {
        loginRequired: true,
        reason: 'expired',
        source: 'yaohuo'
      })
    ],
    [
      'verification hint',
      Object.assign(new Error('请回到妖火原站完成登录确认'), {
        loginRequired: true,
        reason: 'verification',
        source: 'yaohuo'
      })
    ]
  ])('keeps identity for typed Yaohuo %s', async (_kind, error) => {
    mockRunYaohuoAction.mockRejectedValueOnce(error);
    const onSessionExpired = jest.fn();
    const yaohuoDetail = detailFor('yaohuo', { bookmarked: false, categoryId: '177', polls: [] });
    seedTopicCache(yaohuoDetail);
    const hook = await renderActions({ onSessionExpired, topicDetail: yaohuoDetail });

    await act(async () => {
      await hook.result.current.actions.favoriteOnYaohuoSite();
    });

    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('keeps identity for a typed NodeSeek login hint', async () => {
    mockRunNodeSeekAction.mockRejectedValueOnce(
      Object.assign(new Error('NodeSeek 登录已失效'), {
        loginRequired: true,
        source: 'nodeseek'
      })
    );
    const onSessionExpired = jest.fn();
    const notify = jest.fn();
    seedTopicCache();
    const hook = await renderActions({ notify, onSessionExpired });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });

    await act(async () => {
      await expect(hook.result.current.actions.submitReply()).resolves.toBeUndefined();
    });

    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('NodeSeek 登录已失效');
  });

  it('rolls back an unknown Yaohuo result that arrives after ticket expiry', async () => {
    let ticketCurrent = true;
    mockRunYaohuoAction.mockImplementationOnce(async () => {
      ticketCurrent = false;
      return {
        status: 'unknown',
        message: '请刷新原帖确认最新状态'
      };
    });
    const notify = jest.fn();
    const yaohuoDetail = detailFor('yaohuo', {
      bookmarked: false,
      categoryId: '177',
      polls: []
    });
    const { detailKey } = seedTopicCache(yaohuoDetail);
    const hook = await renderActions({
      isWritableSessionTicketCurrent: () => ticketCurrent,
      notify,
      topicDetail: yaohuoDetail
    });

    await act(async () => {
      await hook.result.current.actions.favoriteOnYaohuoSite();
    });

    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.bookmarked).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ['ordinary', new Error('网络请求失败')],
    ['permission-denied', Object.assign(new Error('没有权限执行该操作'), { status: 403 })]
  ])('leaves identity unchanged for %s NodeSeek failure', async (_kind, error) => {
    mockRunNodeSeekAction.mockRejectedValueOnce(error);
    const onSessionExpired = jest.fn();
    const notify = jest.fn();
    seedTopicCache();
    const hook = await renderActions({ notify, onSessionExpired });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });

    await act(async () => {
      await expect(hook.result.current.actions.submitReply()).resolves.toBeUndefined();
    });

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(error.message);
  });

  it.each([
    ['ordinary', new Error('网络请求失败')],
    ['permission-denied', Object.assign(new Error('没有权限执行该操作'), { status: 403 })]
  ])('leaves identity unchanged for %s Yaohuo failure', async (_kind, error) => {
    mockRunYaohuoAction.mockRejectedValueOnce(error);
    const onSessionExpired = jest.fn();
    const notify = jest.fn();
    const yaohuoDetail = detailFor('yaohuo', { bookmarked: false, categoryId: '177', polls: [] });
    const { detailKey } = seedTopicCache(yaohuoDetail);
    const hook = await renderActions({ notify, onSessionExpired, topicDetail: yaohuoDetail });

    await act(async () => {
      await hook.result.current.actions.favoriteOnYaohuoSite();
    });

    expect(mockRunYaohuoAction).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(error.message);
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.bookmarked).toBe(false);
  });

  it.each([
    ['ordinary', new Error('网络请求失败')],
    ['permission-denied', Object.assign(new Error('没有权限执行该操作'), { status: 403 })]
  ])('leaves identity unchanged for %s linux.do failure', async (_kind, error) => {
    mockRunLinuxDoAction.mockRejectedValueOnce(error);
    const onSessionExpired = jest.fn();
    const notify = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDetail);
    const hook = await renderActions({ notify, onSessionExpired, topicDetail: linuxDetail });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(error.message);
  });

  it('leaves identity unchanged for a typed linux.do login hint', async () => {
    mockRunLinuxDoAction.mockRejectedValueOnce(
      Object.assign(new Error('linux.do 登录已失效'), {
        loginRequired: true,
        source: 'linuxdo'
      })
    );
    const onSessionExpired = jest.fn();
    const showLinuxDoLogin = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDetail);
    const hook = await renderActions({
      showLinuxDoVerification: showLinuxDoLogin,
      onSessionExpired,
      topicDetail: linuxDetail
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });

    await act(async () => {
      await expect(hook.result.current.actions.submitReply()).resolves.toBeUndefined();
    });

    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(showLinuxDoLogin).toHaveBeenCalledWith('linux.do 登录已失效');
  });

  it('leaves identity unchanged for typed linux.do verification', async () => {
    mockRunLinuxDoAction.mockRejectedValueOnce(
      Object.assign(new Error('linux.do 需要完成 Cloudflare 验证'), {
        reason: 'cloudflare',
        source: 'linuxdo'
      })
    );
    const onSessionExpired = jest.fn();
    const showLinuxDoLogin = jest.fn();
    const notify = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDetail);
    const hook = await renderActions({
      showLinuxDoVerification: showLinuxDoLogin,
      notify,
      onSessionExpired,
      topicDetail: linuxDetail
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('reply body');
    });

    await act(async () => {
      await hook.result.current.actions.submitReply();
    });

    expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(showLinuxDoLogin).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('linux.do 需要完成 Cloudflare 验证');
  });

  it('suppresses a NodeSeek failure after a newer login takes ownership', async () => {
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
      transport.reject(
        Object.assign(new Error('旧 NodeSeek 登录已失效'), {
          loginRequired: true,
          source: 'nodeseek'
        })
      );
      await action;
    });

    expect(dispatchSiteSessionEvent).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('suppresses a Yaohuo failure after a newer login takes ownership', async () => {
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
      transport.reject(
        Object.assign(new Error('旧妖火登录已失效'), {
          loginRequired: true,
          reason: 'expired',
          source: 'yaohuo'
        })
      );
      await action;
    });

    expect(dispatchSiteSessionEvent).not.toHaveBeenCalled();
    expect(showYaohuoLogin).not.toHaveBeenCalled();
  });

  it('does not insert a NodeImage upload completed by a cleared API key', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
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
    let pending!: Promise<unknown>;

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
    const finishes = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'reply' && event.operation === 'image-upload' && event.phase === 'finish');
    expect(finishes).toEqual([
      expect.objectContaining({
        outcome: 'stale',
        reason: 'stale',
        serverConfirmed: true
      })
    ]);
  });

  it.each([
    ['ordinary', new Error('图片上传网络失败')],
    ['permission-denied', Object.assign(new Error('当前账号不能上传图片'), { status: 403 })]
  ])('leaves identity unchanged for %s linux.do upload failure', async (_kind, error) => {
    mockRunLinuxDoAction.mockRejectedValueOnce(error);
    mockGetDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/test.png', name: 'test.png', mimeType: 'image/png', lastModified: 0 }]
    });
    const onSessionExpired = jest.fn();
    const notify = jest.fn();
    const linuxDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDetail);
    const hook = await renderActions({
      notify,
      onSessionExpired,
      topicDetail: linuxDetail
    });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('existing draft');
    });

    await act(async () => {
      await hook.result.current.actions.uploadReplyImage();
    });

    expect(mockGetDocument).toHaveBeenCalledTimes(1);
    expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(error.message);
    expect(hook.result.current.topicSession.state.replyContent).toBe('existing draft');
  });

  it('stops before file selection when the saved NodeImage key is unavailable', async () => {
    const ensureNodeImageApiKey = jest.fn(async () => null);
    const notify = jest.fn();
    seedTopicCache();
    const hook = await renderActions({ ensureNodeImageApiKey, notify });
    await act(async () => {
      hook.result.current.topicSession.commands.composer.changeContent('existing draft');
      await hook.result.current.actions.uploadReplyImage();
    });

    expect(ensureNodeImageApiKey).toHaveBeenCalledTimes(1);
    expect(mockGetDocument).not.toHaveBeenCalled();
    expect(mockUploadNodeSeekReplyImage).not.toHaveBeenCalled();
    expect(hook.result.current.topicSession.state.replyContent).toBe('existing draft');
    expect(notify).toHaveBeenCalledWith('NodeImage API Key 不可用，请到账号中心重新获取授权或手动粘贴');
  });

  it('reports a rejected NodeImage key without authorizing or replaying the upload', async () => {
    mockCurrentNodeImageGeneration.mockReturnValue(5);
    mockUploadNodeSeekReplyImage.mockRejectedValueOnce(
      Object.assign(new Error('API Key 无效'), { nodeImageApiKeyExpired: true })
    );
    mockGetDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/test.png', name: 'test.png', mimeType: 'image/png', lastModified: 0 }]
    });
    const ensureNodeImageApiKey = jest.fn(async () => 'old-key');
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
    expect(ensureNodeImageApiKey).toHaveBeenCalledTimes(1);
    expect(hook.result.current.topicSession.state.replyContent).toBe('existing draft');
    expect(notify).toHaveBeenCalledWith('NodeImage API Key 不可用，请到账号中心重新获取授权或手动粘贴');
    expect(notify).not.toHaveBeenCalledWith('图片已插入');
  });

  it('releases image-upload busy state after inserting Markdown', async () => {
    const upload = Promise.withResolvers<Record<string, unknown>>();
    mockRunLinuxDoAction.mockImplementationOnce(async () => upload.promise);
    mockGetDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/test.png', name: 'test.png', mimeType: 'image/png', lastModified: 0 }]
    });
    const linuxDoDetail = detailFor('linuxdo', { canCreatePost: true, polls: [] });
    seedTopicCache(linuxDoDetail);
    const hook = await renderActions({ topicDetail: linuxDoDetail });
    let pending!: Promise<unknown>;

    await act(async () => {
      pending = hook.result.current.actions.uploadReplyImage();
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.actions.actionBusy).toBe(true));
    await act(async () => {
      upload.resolve({ short_url: 'upload://test.jpeg' });
      await pending;
    });

    expect(hook.result.current.topicSession.state.replyContent).toContain('upload://test.jpeg');
    expect(hook.result.current.actions.actionBusy).toBe(false);
  });

  it('sends no NodeSeek request when vote confirmation is canceled', async () => {
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

  it('grants NodeSeek poll management only to the matching owner before lock', async () => {
    const hook = await renderActions({
      siteSessionViewModels: nodeSeekLoggedInViewModels(),
      topicDetail: detailFor('nodeseek', { polls: [ownedNodeSeekPoll] })
    });

    expect(hook.result.current.actions.decisionFor({ action: 'manage-poll', poll: ownedNodeSeekPoll })).toEqual({
      allowed: true,
      reason: 'allowed'
    });
    expect(
      hook.result.current.actions.decisionFor({ action: 'manage-poll', poll: { ...ownedNodeSeekPoll, ownerId: '8' } })
    ).toEqual({ allowed: false, reason: 'object-forbidden' });
    expect(
      hook.result.current.actions.decisionFor({ action: 'manage-poll', poll: { ...ownedNodeSeekPoll, closed: true } })
    ).toEqual({ allowed: false, reason: 'already-complete' });
  });

  it('sends no request when the poll owner cancels locking', async () => {
    const topic = detailFor('nodeseek', { polls: [ownedNodeSeekPoll] });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { detailKey } = seedTopicCache(topic);
    const hook = await renderActions({
      siteSessionViewModels: nodeSeekLoggedInViewModels(),
      topicDetail: topic
    });

    await act(async () => {
      await hook.result.current.actions.lockNodeSeekPoll(ownedNodeSeekPoll);
    });
    await act(async () => {
      alert.mock.calls[0]?.[2]?.find((button) => button.style === 'cancel')?.onPress?.();
    });

    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(mockFetchNodeSeekVoteInfo).not.toHaveBeenCalled();
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.polls?.[0]?.closed).not.toBe(true);
  });

  it('refuses an already locked poll before opening confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const hook = await renderActions({
      siteSessionViewModels: nodeSeekLoggedInViewModels(),
      topicDetail: detailFor('nodeseek', { polls: [{ ...ownedNodeSeekPoll, closed: true }] })
    });

    await act(async () => {
      await hook.result.current.actions.lockNodeSeekPoll({ ...ownedNodeSeekPoll, closed: true });
    });

    expect(alert).not.toHaveBeenCalled();
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
  });

  it('locks once, refreshes once, and projects the authoritative poll to topic and replies', async () => {
    const topic = detailFor('nodeseek', { polls: [ownedNodeSeekPoll] });
    const pollReply: Reply = { ...editableReply, polls: [ownedNodeSeekPoll] };
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    mockFetchNodeSeekVoteInfo.mockResolvedValueOnce({ ...ownedNodeSeekPoll, closed: true });
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const lock = buttons?.find((button) => button.text === '锁定');
      lock?.onPress?.();
      lock?.onPress?.();
    });
    const { detailKey, repliesKey } = seedTopicCache(topic, [pollReply]);
    const hook = await renderActions({
      siteSessionViewModels: nodeSeekLoggedInViewModels(),
      topicDetail: topic,
      topicReplies: [pollReply]
    });

    await act(async () => {
      await hook.result.current.actions.lockNodeSeekPoll(ownedNodeSeekPoll);
    });
    await waitFor(() => expect(mockFetchNodeSeekVoteInfo).toHaveBeenCalledTimes(1));

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(mockRunNodeSeekAction.mock.calls[0]?.[0].request).toMatchObject({
      path: '/api/vote/lock/81',
      body: JSON.stringify({ locked: true })
    });
    expect(mockRunNodeSeekAction.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetchNodeSeekVoteInfo.mock.invocationCallOrder[0] || 0
    );
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.polls?.[0]?.closed).toBe(true);
    expect(
      appQueryClient.getQueryData<{ pages: { items: Reply[] }[] }>(repliesKey)?.pages[0]?.items[0]?.polls?.[0]?.closed
    ).toBe(true);
  });

  it('keeps a confirmed lock locally when only the result refresh fails', async () => {
    const topic = detailFor('nodeseek', { polls: [ownedNodeSeekPoll] });
    const notify = jest.fn();
    mockRunNodeSeekAction.mockResolvedValueOnce({ success: true });
    mockFetchNodeSeekVoteInfo.mockRejectedValueOnce(new Error('refresh failed'));
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '锁定')?.onPress?.();
    });
    const { detailKey } = seedTopicCache(topic);
    const hook = await renderActions({
      notify,
      siteSessionViewModels: nodeSeekLoggedInViewModels(),
      topicDetail: topic
    });

    await act(async () => {
      await hook.result.current.actions.lockNodeSeekPoll(ownedNodeSeekPoll);
    });
    await waitFor(() => expect(notify).toHaveBeenCalledWith('锁定成功但结果刷新失败，请手动刷新。'));

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(mockFetchNodeSeekVoteInfo).toHaveBeenCalledTimes(1);
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.polls?.[0]?.closed).toBe(true);
  });

  it('reconciles an ambiguous lock with one GET and never resends the POST', async () => {
    const topic = detailFor('nodeseek', { polls: [ownedNodeSeekPoll] });
    mockRunNodeSeekAction.mockRejectedValueOnce(new Error('timeout'));
    mockFetchNodeSeekVoteInfo.mockResolvedValueOnce({ ...ownedNodeSeekPoll, closed: true });
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '锁定')?.onPress?.();
    });
    const { detailKey } = seedTopicCache(topic);
    const hook = await renderActions({
      siteSessionViewModels: nodeSeekLoggedInViewModels(),
      topicDetail: topic
    });

    await act(async () => {
      await hook.result.current.actions.lockNodeSeekPoll(ownedNodeSeekPoll);
    });
    await waitFor(() => expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.polls?.[0]?.closed).toBe(true));

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(mockFetchNodeSeekVoteInfo).toHaveBeenCalledTimes(1);
  });

  it('keeps NodeSeek voting at exactly one POST followed by one result GET', async () => {
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

  it('keeps a submitted NodeSeek selection without inventing unknown counts when result GET fails', async () => {
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
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
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

  it('does not add NodeSeek confirmation to LinuxDo or Yaohuo polls', async () => {
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
    expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1);
    expect(mockRunYaohuoAction).toHaveBeenCalledTimes(1);
  });

  it('applies a confirmed LinuxDo vote only to the exact topic cache', async () => {
    const linuxDoPoll: TopicPoll = {
      id: 'linuxdo-poll',
      name: 'poll_name',
      postId: '42',
      options: [{ id: '1', label: 'A' }]
    };
    const linuxDoDetail = detailFor('linuxdo', { polls: [linuxDoPoll] });
    const { detailKey } = seedTopicCache(linuxDoDetail);
    const hook = await renderActions({ topicDetail: linuxDoDetail });

    await act(async () => {
      await hook.result.current.actions.votePoll(linuxDoPoll, ['1']);
    });

    expect(mockRunLinuxDoAction).toHaveBeenCalledTimes(1);
    expect(appQueryClient.getQueryData<TopicDetail>(detailKey)?.polls?.[0]).toMatchObject({
      id: 'linuxdo-poll',
      voted: true,
      options: [{ id: '1', selected: true }]
    });
  });

  it('prepares Stardust but sends nothing when the confirmation is canceled', async () => {
    const fetcher = jest.fn(async () => stardustStatusResponse());
    mockRunNodeSeekAction.mockResolvedValue({
      success: true,
      allowedOrigin: true,
      receiver_name: '真实收款人'
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'cancel')?.onPress?.();
    });
    const hook = await renderActions({ fetcher, siteSessionViewModels: nodeSeekLoggedInViewModels() });
    let result: Awaited<ReturnType<typeof hook.result.current.actions.payNodeSeekStardust>> | undefined;

    await act(async () => {
      result = await hook.result.current.actions.payNodeSeekStardust({
        receiverMemberId: '42',
        amount: 3,
        refId: 100,
        description: 'test',
        oneTime: false
      });
    });

    expect(result).toBe('canceled');
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mockRunNodeSeekAction.mock.calls[0]?.[0].request.path).toBe('/api/stardust/payment-prepare');
    expect(JSON.parse(mockRunNodeSeekAction.mock.calls[0]?.[0].request.body || '{}')).toEqual({
      receiver_id: 42,
      origin: 'https://www.nodeseek.com'
    });
    expect(alert.mock.calls[0]?.[1]).toContain('真实收款人');
  });

  it.each([
    [
      'unauthorized origin',
      { success: true, allowedOrigin: false, receiver_name: '真实收款人' },
      '调用支付的网站未被授权'
    ],
    ['missing receiver', { success: true, allowedOrigin: true, receiver_name: '' }, '获取支付基础信息失败'],
    ['malformed receiver', { success: true, allowedOrigin: true, receiver_name: 42 }, '获取支付基础信息失败']
  ])('rejects %s before Stardust confirmation or send', async (_case, prepareResult, message) => {
    const fetcher = jest.fn(async () => stardustStatusResponse());
    const notify = jest.fn();
    mockRunNodeSeekAction.mockResolvedValueOnce(prepareResult);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'cancel')?.onPress?.();
    });
    const hook = await renderActions({ fetcher, notify, siteSessionViewModels: nodeSeekLoggedInViewModels() });
    let result: Awaited<ReturnType<typeof hook.result.current.actions.payNodeSeekStardust>> | undefined;

    await act(async () => {
      result = await hook.result.current.actions.payNodeSeekStardust({
        receiverMemberId: '42',
        amount: 3,
        refId: 100,
        description: 'test',
        oneTime: false
      });
    });

    expect(result).toBe('failed');
    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(message);
  });

  it('reuses one materialized NodeSeek poll when the reply is manually retried', async () => {
    const snapshot = snapshotWithNodeSeekPoll('poll_retry_0001');
    mockRunNodeSeekAction
      .mockResolvedValueOnce({ id: 3023 })
      .mockRejectedValueOnce(new Error('reply failed'))
      .mockResolvedValueOnce({ success: true });
    const hook = await renderActions();

    await act(async () => {
      await hook.result.current.actions.submitReply(snapshot);
      await hook.result.current.actions.submitReply(snapshot);
    });

    const requests = mockRunNodeSeekAction.mock.calls.map(([call]) => call.request);
    expect(requests.map((request) => request.path)).toEqual([
      '/api/vote/info',
      '/api/content/new-comment',
      '/api/content/new-comment'
    ]);
    expect(JSON.parse(requests[2]!.body || '{}').content).toContain('nsapp://vote?id=3023');
    expect(JSON.parse(requests[2]!.body || '{}').content).not.toContain('wz:nodeseek-poll');
  });

  it('blocks a second poll-create attempt after an ambiguous result', async () => {
    const snapshot = snapshotWithNodeSeekPoll('poll_unknown_01');
    const notify = jest.fn();
    mockRunNodeSeekAction.mockRejectedValueOnce(new Error('timeout'));
    const firstHook = await renderActions({ notify });

    await act(async () => {
      await firstHook.result.current.actions.submitReply(snapshot);
    });
    const secondHook = await renderActions({ notify });
    await act(async () => {
      await secondHook.result.current.actions.submitReply(snapshot);
    });

    expect(mockRunNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('结果未知'));
  });

  it('never downgrades a known remote poll id to an unknown result', async () => {
    const identityKey = 'nodeseek:test-user';
    const known = { localId: 'poll_stale_0001', fingerprint: '0123456789abcdef', remoteId: '3025' };

    await saveNodeSeekPollJournalEntry(identityKey, known);
    await saveNodeSeekPollJournalEntry(identityKey, { ...known, remoteId: null });

    await expect(readNodeSeekPollJournalEntry(identityKey, known.localId)).resolves.toEqual(known);
  });

  it.each([
    ['missing sidecar', snapshotWithNodeSeekPolls(['poll_match_0001', 'poll_missing_01'], ['poll_match_0001'])],
    ['extra sidecar', snapshotWithNodeSeekPolls(['poll_match_0001'], ['poll_match_0001', 'poll_extra_0001'])],
    ['duplicate token', snapshotWithNodeSeekPolls(['poll_match_0001', 'poll_match_0001'])]
  ])('rejects %s before creating a remote poll', async (_name, snapshot) => {
    const notify = jest.fn();
    const hook = await renderActions({ notify });

    await act(async () => {
      await hook.result.current.actions.submitReply(snapshot);
    });

    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('投票'));
  });

  it('allows distinct local polls with identical content', async () => {
    const polls = ['poll_same_0001', 'poll_same_0002'].map((localId) =>
      normalizePendingNodeSeekPoll({
        localId,
        title: '相同投票',
        multiple: false,
        isPublic: true,
        options: ['A', 'B']
      })
    );
    const snapshot: ComposerSnapshot = {
      revision: 1,
      markdown: polls.map((poll) => nodeSeekPendingPollToken(poll.localId)).join('\n\n'),
      mode: 'rich',
      isEmpty: false,
      validationIssues: [],
      pendingNodeSeekPolls: polls
    };
    mockRunNodeSeekAction
      .mockResolvedValueOnce({ id: 3026 })
      .mockResolvedValueOnce({ id: 3027 })
      .mockResolvedValueOnce({ success: true });
    const hook = await renderActions();

    await act(async () => {
      await hook.result.current.actions.submitReply(snapshot);
    });

    expect(mockRunNodeSeekAction.mock.calls.map(([call]) => call.request.path)).toEqual([
      '/api/vote/info',
      '/api/vote/info',
      '/api/content/new-comment'
    ]);
  });

  it('allows manual poll-create retry after an explicit server rejection', async () => {
    const snapshot = snapshotWithNodeSeekPoll('poll_reject_0001');
    const rejected = Object.assign(new Error('invalid poll'), { serverRejected: true });
    mockRunNodeSeekAction
      .mockRejectedValueOnce(rejected)
      .mockResolvedValueOnce({ id: 3024 })
      .mockResolvedValueOnce({ success: true });
    const hook = await renderActions();

    await act(async () => {
      await hook.result.current.actions.submitReply(snapshot);
      await hook.result.current.actions.submitReply(snapshot);
    });

    expect(mockRunNodeSeekAction.mock.calls.map(([call]) => call.request.path)).toEqual([
      '/api/vote/info',
      '/api/vote/info',
      '/api/content/new-comment'
    ]);
  });

  it('sends once without status preflight and trusts an explicit success', async () => {
    const fetcher = jest.fn(async () => {
      throw new Error('每天最多进行500次星辰记录查询');
    });
    mockRunNodeSeekAction
      .mockResolvedValueOnce({
        success: true,
        allowedOrigin: true,
        receiver_name: '真实收款人'
      })
      .mockResolvedValueOnce({ success: true });
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '确认付款')?.onPress?.();
    });
    const hook = await renderActions({ fetcher, siteSessionViewModels: nodeSeekLoggedInViewModels() });
    let result: Awaited<ReturnType<typeof hook.result.current.actions.payNodeSeekStardust>> | undefined;

    await act(async () => {
      result = await hook.result.current.actions.payNodeSeekStardust({
        receiverMemberId: '42',
        amount: 3,
        refId: 100,
        description: 'test',
        oneTime: false
      });
    });

    expect(result).toBe('submitted');
    expect(mockRunNodeSeekAction.mock.calls.map(([call]) => call.request.path)).toEqual([
      '/api/stardust/payment-prepare',
      '/api/stardust/send'
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['transport failure', new Error('timeout')],
    ['malformed success', {}]
  ])('reports %s as ambiguous without retrying it', async (_case, sendResult) => {
    const notify = jest.fn();
    const fetcher = jest.fn(async () => stardustStatusResponse());
    mockRunNodeSeekAction.mockResolvedValueOnce({
      success: true,
      allowedOrigin: true,
      receiver_name: '真实收款人'
    });
    if (sendResult instanceof Error) mockRunNodeSeekAction.mockRejectedValueOnce(sendResult);
    else mockRunNodeSeekAction.mockResolvedValueOnce(sendResult);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '确认付款')?.onPress?.();
    });
    const hook = await renderActions({
      fetcher,
      notify,
      siteSessionViewModels: nodeSeekLoggedInViewModels()
    });
    let result: Awaited<ReturnType<typeof hook.result.current.actions.payNodeSeekStardust>> | undefined;

    await act(async () => {
      result = await hook.result.current.actions.payNodeSeekStardust({
        receiverMemberId: '42',
        amount: 3,
        refId: 100,
        description: 'test',
        oneTime: false
      });
    });

    expect(result).toBe('unknown');
    expect(
      mockRunNodeSeekAction.mock.calls.filter(([call]) => call.request.path === '/api/stardust/send')
    ).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('结果未知'));
  });

  it('rejects a legacy Stardust Ref before every remote request', async () => {
    const fetcher = jest.fn(async () => stardustStatusResponse());
    const notify = jest.fn();
    const hook = await renderActions({ fetcher, notify, siteSessionViewModels: nodeSeekLoggedInViewModels() });
    let result: Awaited<ReturnType<typeof hook.result.current.actions.payNodeSeekStardust>> | undefined;

    await act(async () => {
      result = await hook.result.current.actions.payNodeSeekStardust({
        receiverMemberId: '42',
        amount: 3,
        refId: 1,
        description: 'legacy',
        oneTime: false
      });
    });

    expect(result).toBe('failed');
    expect(mockRunNodeSeekAction).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Ref ID 必须为大于等于 100 的安全整数');
  });
});
