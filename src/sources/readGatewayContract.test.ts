import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Category,
  DiscourseTagOption,
  DiscourseUserOption,
  FeedResponse,
  Reply,
  RepliesResponse,
  SearchResponse,
  Source,
  Topic
} from '@/domain/forum/models';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  setDiagnosticWriter
} from '@/platform/diagnostics/diagnostics';
import { browserFetchIntentFromInit, withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { RequestCanceledError, RequestTimeoutError, type Fetcher } from '@/platform/network/request';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import { annotateSourceDiagnosticSummary } from './diagnostics';
import { acceptForumReadResponse, registerForumReadResponseEvidence } from './forumSourceReadAttempt';
import { forumReadEvidenceFetcher } from '../../tests/helpers/forumReadEvidence';
import { getYaohuoFeedDirect, getYaohuoTopicDirect } from '@/sources/yaohuo/reader';

const forumMocks = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getCurrentUserProfile: vi.fn(),
  getFeed: vi.fn(async (_options: { fetcher: Fetcher }): Promise<FeedResponse> => ({
    items: [],
    errors: {},
    hasMore: false,
    nextPage: null
  })),
  getReplies: vi.fn(async (): Promise<RepliesResponse> => ({ items: [], hasMore: false, nextPage: null })),
  getReply: vi.fn(async (): Promise<Reply> => ({ author: '', contentHtml: '', createdAt: '' })),
  getTopic: vi.fn(async ({ id, source }) => ({
    source,
    id,
    title: '',
    author: '',
    url: '',
    createdAt: '',
    replyCount: 0,
    contentHtml: '',
    replies: []
  })),
  getUserProfile: vi.fn(async ({ id, source }) => ({ source, id, username: id, displayName: id, url: '', topics: [] })),
  searchTopics: vi.fn(
    async (_options: {
      source: Source | 'all';
      fetcher: Fetcher;
      fetcherForSource?: (source: Source) => Fetcher;
    }): Promise<SearchResponse> => ({
      items: [],
      errors: {},
      hasMore: false,
      nextPage: null
    })
  )
}));
const linuxDoMocks = vi.hoisted(() => ({
  getLinuxDoEmojiUrls: vi.fn(),
  searchLinuxDoSemantic: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
  searchLinuxDoTags: vi.fn(async (): Promise<DiscourseTagOption[]> => []),
  searchLinuxDoUsers: vi.fn(async (): Promise<DiscourseUserOption[]> => [])
}));
const nodeSeekMocks = vi.hoisted(() => ({
  resolveNodeSeekUser: vi.fn()
}));
const linuxDoLevelMocks = vi.hoisted(() => ({
  getLinuxDoLevelProfile: vi.fn()
}));
const xiaoyinsiMocks = vi.hoisted(() => ({
  getXiaoyinsiEmojiUrls: vi.fn(),
  getXiaoyinsiLevelProfile: vi.fn(),
  searchXiaoyinsiTags: vi.fn(async (): Promise<DiscourseTagOption[]> => []),
  searchXiaoyinsiUsers: vi.fn(async (): Promise<DiscourseUserOption[]> => [])
}));
const readNetworkRuntimeMocks = vi.hoisted(() => ({
  generation: 0,
  triggerSource: null as Source | null,
  recoverReadNetworkRuntime: vi.fn()
}));

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn()
}));
vi.mock('./feedRead', () => forumMocks);
vi.mock('./searchRead', () => forumMocks);
vi.mock('./sourceRead', () => forumMocks);
vi.mock('@/sources/linuxdo/reader', () => ({
  getLinuxDoEmojiUrls: linuxDoMocks.getLinuxDoEmojiUrls
}));
vi.mock('@/sources/linuxdo/search', () => ({
  searchLinuxDoSemantic: linuxDoMocks.searchLinuxDoSemantic,
  searchLinuxDoTags: linuxDoMocks.searchLinuxDoTags,
  searchLinuxDoUsers: linuxDoMocks.searchLinuxDoUsers
}));
vi.mock('@/sources/nodeseek/reader', () => nodeSeekMocks);
vi.mock('@/sources/linuxdo/level', () => linuxDoLevelMocks);
vi.mock('@/sources/xiaoyinsi/reader', () => ({
  getXiaoyinsiEmojiUrls: xiaoyinsiMocks.getXiaoyinsiEmojiUrls
}));
vi.mock('@/sources/xiaoyinsi/account', () => ({
  getXiaoyinsiLevelProfile: xiaoyinsiMocks.getXiaoyinsiLevelProfile
}));
vi.mock('@/sources/xiaoyinsi/search', () => ({
  searchXiaoyinsiTags: xiaoyinsiMocks.searchXiaoyinsiTags,
  searchXiaoyinsiUsers: xiaoyinsiMocks.searchXiaoyinsiUsers
}));
vi.mock('@/sources/yaohuo/reader', () => ({
  checkYaohuoLoginDirect: vi.fn(),
  getYaohuoFeedDirect: vi.fn(),
  getYaohuoRepliesDirect: vi.fn(),
  getYaohuoTopicDirect: vi.fn(),
  searchYaohuoDirect: vi.fn()
}));
vi.mock('@/platform/network/networkProxy', () => ({
  recoverReadNetworkRuntime: readNetworkRuntimeMocks.recoverReadNetworkRuntime
}));
vi.mock('@/platform/network/readNetworkRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/network/readNetworkRuntime')>()),
  currentReadNetworkRuntimeGeneration: () => readNetworkRuntimeMocks.generation,
  getReadNetworkRuntimeSnapshot: () => ({
    generation: readNetworkRuntimeMocks.generation,
    triggerSource: readNetworkRuntimeMocks.triggerSource
  })
}));

import {
  createReadGateway as createProductionReadGateway,
  getFeed,
  getReplies,
  getTopic,
  getUserProfile,
  searchTopics
} from './readGateway';

type ReadGatewayTestDependencies = Omit<
  Parameters<typeof createProductionReadGateway>[0],
  'anonymousFetcher' | 'readSessionRuntimeSnapshot'
> & {
  anonymousFetcher?: Fetcher;
  currentSessionEpoch?: (source: SessionSource) => number;
  isSourceAuthenticated?: (source: SessionSource) => boolean;
  isSourceReadBlocked?: (source: SessionSource) => boolean;
  readSessionRuntimeSnapshot?: (source: SessionSource) => SessionRuntimeSnapshot;
};

function createReadGateway(dependencies: ReadGatewayTestDependencies) {
  const {
    currentSessionEpoch,
    isSourceAuthenticated,
    isSourceReadBlocked,
    readSessionRuntimeSnapshot,
    ...productionDependencies
  } = dependencies;
  return createProductionReadGateway({
    ...productionDependencies,
    anonymousFetcher: dependencies.anonymousFetcher || dependencies.fetcher,
    readSessionRuntimeSnapshot:
      readSessionRuntimeSnapshot ||
      ((source) => {
        const authenticated = isSourceAuthenticated?.(source) === true;
        return {
          source,
          authenticated,
          authSurfaceOpen: false,
          identityKey: authenticated ? `${source}:authenticated` : `${source}:anonymous`,
          identityTrust: isSourceReadBlocked?.(source) ? 'pending' : authenticated ? 'confirmed' : 'none',
          sessionEpoch: currentSessionEpoch?.(source) ?? 0,
          sourceEnabled: dependencies.getEnabledSources?.().includes(source) ?? true
        };
      })
  });
}

describe('source gateway read contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readNetworkRuntimeMocks.generation = 7;
    readNetworkRuntimeMocks.triggerSource = null;
    readNetworkRuntimeMocks.recoverReadNetworkRuntime.mockImplementation(async (source, expectedGeneration) => {
      readNetworkRuntimeMocks.generation = Math.max(readNetworkRuntimeMocks.generation, expectedGeneration + 1);
      readNetworkRuntimeMocks.triggerSource = source;
      return {
        ok: true,
        rotated: true,
        previousGeneration: expectedGeneration,
        generation: readNetworkRuntimeMocks.generation,
        canceledQueued: 0,
        canceledRunning: 1
      };
    });
  });

  afterEach(() => {
    setDiagnosticWriter(null);
  });

  function runtime(
    source: SessionRuntimeSnapshot['source'],
    overrides: Partial<SessionRuntimeSnapshot> = {}
  ): SessionRuntimeSnapshot {
    return {
      source,
      authenticated: false,
      authSurfaceOpen: false,
      identityKey: `${source}:anonymous`,
      identityTrust: 'pending',
      sessionEpoch: 2,
      sourceEnabled: true,
      ...overrides
    };
  }

  it('[REG-TOPIC-077] normalizes missing reply completeness to a conservative partial boundary', async () => {
    await expect(getTopic({ source: 'v2ex', id: 'topic-1' })).resolves.toMatchObject({
      replyCompleteness: 'partial'
    });
    await expect(
      getReplies({ source: 'v2ex', id: 'topic-1', order: 'oldest', position: { kind: 'start' } })
    ).resolves.toMatchObject({ completeness: 'partial' });
  });

  it('[REG-SOURCE-011] executes pending public Topic reads only through the native no-cookie lane', async () => {
    const managedFetcher = vi.fn<Fetcher>();
    const anonymousFetcher = vi.fn<Fetcher>(async () => new Response('public'));
    const loadXiaoyinsiCredentialsForSource = vi.fn();
    forumMocks.getTopic.mockImplementationOnce(async ({ fetcher, id, source }) => {
      await fetcher('https://forum.xiaoyinsi.com/t/42.json', { credentials: 'include' });
      return {
        source,
        id,
        title: '公开主题',
        author: 'alice',
        url: 'https://forum.xiaoyinsi.com/t/42',
        createdAt: '',
        replyCount: 0,
        contentHtml: '<p>public</p>',
        replies: []
      };
    });
    const gateway = createReadGateway({
      anonymousFetcher,
      fetcher: managedFetcher,
      loadXiaoyinsiCredentialsForSource,
      nodeSeekUserAgent: () => 'NodeSeek UA',
      readSessionRuntimeSnapshot: (source: SessionRuntimeSnapshot['source']) => runtime(source)
    });

    await expect(gateway.getTopic({ source: 'xiaoyinsi', id: '42' })).resolves.toMatchObject({ id: '42' });

    expect(anonymousFetcher).toHaveBeenCalledWith(
      'https://forum.xiaoyinsi.com/t/42.json',
      expect.objectContaining({ credentials: 'omit' })
    );
    expect(managedFetcher).not.toHaveBeenCalled();
    expect(loadXiaoyinsiCredentialsForSource).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-011] settles pending Yaohuo local categories but blocks remote reads before transport', async () => {
    forumMocks.getCategories.mockResolvedValueOnce({
      items: [{ source: 'yaohuo', id: 'all', name: '全部' }],
      errors: {}
    });
    const managedFetcher = vi.fn<Fetcher>();
    const anonymousFetcher = vi.fn<Fetcher>();
    const loadXiaoyinsiCredentialsForSource = vi.fn();
    const gateway = createReadGateway({
      anonymousFetcher,
      fetcher: managedFetcher,
      loadXiaoyinsiCredentialsForSource,
      nodeSeekUserAgent: () => 'NodeSeek UA',
      readSessionRuntimeSnapshot: (source: SessionRuntimeSnapshot['source']) => runtime(source)
    });

    await expect(gateway.getCategories({ source: 'yaohuo' })).resolves.toMatchObject({
      items: [{ source: 'yaohuo', id: 'all', name: '全部' }]
    });
    await expect(gateway.getFeed({ source: 'yaohuo' })).rejects.toMatchObject({
      reason: 'identity-pending',
      source: 'yaohuo'
    });

    expect(forumMocks.getCategories).toHaveBeenCalledTimes(1);
    expect(forumMocks.getFeed).not.toHaveBeenCalled();
    expect(managedFetcher).not.toHaveBeenCalled();
    expect(anonymousFetcher).not.toHaveBeenCalled();
    expect(loadXiaoyinsiCredentialsForSource).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-011] settles unknown strict reads as retryable identity-unavailable without transport', async () => {
    const managedFetcher = vi.fn<Fetcher>();
    const anonymousFetcher = vi.fn<Fetcher>();
    const loadXiaoyinsiCredentialsForSource = vi.fn();
    const gateway = createReadGateway({
      anonymousFetcher,
      fetcher: managedFetcher,
      loadXiaoyinsiCredentialsForSource,
      nodeSeekUserAgent: () => 'NodeSeek UA',
      readSessionRuntimeSnapshot: (source: SessionRuntimeSnapshot['source']) =>
        runtime(source, { identityTrust: 'unknown' })
    });

    await expect(gateway.getFeed({ source: 'yaohuo' })).rejects.toMatchObject({
      reason: 'identity-unavailable',
      retryable: true,
      source: 'yaohuo'
    });
    expect(forumMocks.getFeed).not.toHaveBeenCalled();
    expect(managedFetcher).not.toHaveBeenCalled();
    expect(anonymousFetcher).not.toHaveBeenCalled();
    expect(loadXiaoyinsiCredentialsForSource).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-011] rejects a late authenticated result after its read-plan scope changes', async () => {
    const response = Promise.withResolvers<Response>();
    let snapshot = runtime('xiaoyinsi', {
      authenticated: true,
      identityKey: 'xiaoyinsi:42',
      identityTrust: 'confirmed',
      sessionEpoch: 5
    });
    const managedFetcher = vi.fn<Fetcher>(async () => response.promise);
    forumMocks.getTopic.mockImplementationOnce(async ({ fetcher, id, source }) => {
      await fetcher('https://forum.xiaoyinsi.com/t/42.json');
      return {
        source,
        id,
        title: 'private',
        author: 'alice',
        url: '',
        createdAt: '',
        replyCount: 0,
        contentHtml: '',
        replies: []
      };
    });
    const gateway = createReadGateway({
      anonymousFetcher: vi.fn<Fetcher>(),
      fetcher: managedFetcher,
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => ({ apiKey: 'key', clientId: 'client' })),
      nodeSeekUserAgent: () => 'NodeSeek UA',
      readSessionRuntimeSnapshot: () => snapshot
    });

    const read = gateway.getTopic({ source: 'xiaoyinsi', id: '42' });
    await vi.waitFor(() => expect(managedFetcher).toHaveBeenCalledTimes(1));
    snapshot = { ...snapshot, authSurfaceOpen: true };
    response.resolve(new Response('private'));

    await expect(read).rejects.toThrow('请求已取消');
  });

  it('[REG-SOURCE-011] routes aggregate V2EX search through its explicit public child plan', async () => {
    const anonymousFetcher = vi.fn<Fetcher>(async () => new Response('{}'));
    const managedFetcher = vi.fn<Fetcher>(async () => new Response('{}'));
    forumMocks.searchTopics.mockImplementationOnce(async ({ fetcherForSource }) => {
      await fetcherForSource?.('v2ex')('https://www.sov2ex.com/api/search?q=read-plan', {
        credentials: 'include'
      });
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({
      anonymousFetcher,
      fetcher: managedFetcher,
      nodeSeekUserAgent: () => ''
    });

    await gateway.searchTopics(
      { source: 'all', query: 'read-plan' },
      { includedSources: ['v2ex'], readPlanScopes: [['v2ex', 'public:omit']] }
    );

    expect(anonymousFetcher).toHaveBeenCalledWith(
      'https://www.sov2ex.com/api/search?q=read-plan',
      expect.objectContaining({ credentials: 'omit' })
    );
    expect(managedFetcher).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-011] preserves a typed login action for anonymous Yaohuo remote reads', async () => {
    const managedFetcher = vi.fn<Fetcher>();
    const anonymousFetcher = vi.fn<Fetcher>();
    const gateway = createReadGateway({
      anonymousFetcher,
      fetcher: managedFetcher,
      nodeSeekUserAgent: () => '',
      readSessionRuntimeSnapshot: (source) => runtime(source, { identityTrust: 'none' })
    });

    await expect(gateway.getTopic({ source: 'yaohuo', id: '42' })).rejects.toMatchObject({
      kind: 'login-required',
      loginRequired: true,
      reason: 'login-required',
      source: 'yaohuo'
    });
    expect(forumMocks.getTopic).not.toHaveBeenCalled();
    expect(managedFetcher).not.toHaveBeenCalled();
    expect(anonymousFetcher).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-031][REG-SOURCE-011] keeps public reads available while identity is pending', async () => {
    const blockedSources = new Set<Source>(['nodeseek']);
    const publicTopic: Topic = {
      source: 'v2ex',
      id: 'public',
      title: '公开主题',
      author: 'alice',
      url: 'https://www.v2ex.com/t/public',
      createdAt: '2026-07-24T00:00:00.000Z',
      replyCount: 0
    };
    const stalePrivateTopic: Topic = {
      ...publicTopic,
      source: 'nodeseek',
      id: 'stale-private',
      url: 'https://www.nodeseek.com/post-stale-private-1'
    };
    const publicCategory: Category = {
      source: 'v2ex',
      id: 'public',
      name: '公开分类'
    };
    const stalePrivateCategory: Category = {
      ...publicCategory,
      source: 'nodeseek',
      id: 'stale-private'
    };
    const pendingError = {
      nodeseek: {
        kind: 'ordinary' as const,
        message: 'NodeSeek 暂时不可用',
        retryable: true
      }
    };
    forumMocks.getFeed.mockResolvedValueOnce({
      items: [publicTopic, stalePrivateTopic],
      errors: pendingError,
      hasMore: false,
      nextPage: null
    });
    const gateway = createReadGateway({
      currentSessionEpoch: () => 7,
      fetcher: vi.fn(),
      isSourceAuthenticated: () => true,
      isSourceReadBlocked: (source) => blockedSources.has(source),
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await expect(gateway.getFeed({ source: 'nodeseek' })).resolves.toMatchObject({
      items: [publicTopic, stalePrivateTopic]
    });
    forumMocks.getFeed.mockResolvedValueOnce({
      items: [publicTopic, stalePrivateTopic],
      errors: pendingError,
      hasMore: false,
      nextPage: null
    });

    const aggregate = await gateway.getFeed({ source: 'all' });
    expect(aggregate.items).toEqual([publicTopic, stalePrivateTopic]);
    expect(aggregate.errors).toEqual(pendingError);
    expect(forumMocks.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'all'
      })
    );

    forumMocks.getCategories.mockResolvedValueOnce({
      items: [publicCategory, stalePrivateCategory],
      errors: pendingError
    });
    await expect(gateway.getCategories({ source: 'all' })).resolves.toEqual({
      items: [publicCategory, stalePrivateCategory],
      errors: pendingError
    });
  });

  it('[REG-SEARCH-024] uses only the explicit anonymous search lane while identity is pending', async () => {
    const fallbackFetcher = vi.fn<Fetcher>(async () => new Response('fallback must stay unused'));
    const anonymousFetcher = vi.fn<Fetcher>(async () => new Response('anonymous'));
    const loadXiaoyinsiCredentialsForSource = vi.fn();
    const blockedSources = new Set<Source>(['linuxdo', 'nodeseek', 'xiaoyinsi', 'yaohuo']);
    const simulateSearchTransport = async (options: {
      source: Source | 'all';
      fetcher: Fetcher;
      fetcherForSource?: (source: Source) => Fetcher;
    }) => {
      const input =
        options.source === 'xiaoyinsi'
          ? 'https://forum.xiaoyinsi.com/search.json?q=pending'
          : 'https://www.google.com/search?q=site%3Alinux.do+pending';
      const scopedFetcher = options.source === 'all' ? options.fetcherForSource?.('v2ex') : options.fetcher;
      await scopedFetcher!(input, { credentials: 'include' });
      return { items: [], errors: {}, hasMore: false, nextPage: null } satisfies SearchResponse;
    };
    for (let request = 0; request < 4; request += 1) {
      forumMocks.searchTopics.mockImplementationOnce(simulateSearchTransport);
    }
    const gateway = createReadGateway({
      anonymousFetcher,
      fetcher: fallbackFetcher,
      isSourceAuthenticated: () => true,
      isSourceReadBlocked: (source) => blockedSources.has(source),
      linuxDoUserAgent: () => 'linux.do UA',
      loadXiaoyinsiCredentialsForSource,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    for (const source of ['linuxdo', 'nodeseek', 'xiaoyinsi'] as const) {
      await expect(gateway.searchTopics({ source, query: 'pending public search' })).resolves.toMatchObject({
        items: [],
        errors: {}
      });
    }

    expect(forumMocks.searchTopics).toHaveBeenCalledTimes(3);
    expect(forumMocks.searchTopics).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        source: 'linuxdo',
        discourseAuth: expect.objectContaining({ linuxdo: expect.objectContaining({ authenticated: false }) }),
        linuxDoAuthenticated: false
      })
    );
    expect(forumMocks.searchTopics).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ source: 'nodeseek', nodeSeekAuthenticated: false })
    );
    expect(forumMocks.searchTopics).toHaveBeenNthCalledWith(
      3,
      expect.not.objectContaining({ discourseAuth: expect.anything() })
    );
    expect(loadXiaoyinsiCredentialsForSource).not.toHaveBeenCalled();
    expect(fallbackFetcher).not.toHaveBeenCalled();
    expect(anonymousFetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of anonymousFetcher.mock.calls) {
      expect(init).toMatchObject({ credentials: 'omit' });
    }

    await expect(gateway.searchTopics({ source: 'yaohuo', query: 'still private' })).rejects.toThrow(
      '登录状态暂时无法确认'
    );
    expect(forumMocks.searchTopics).toHaveBeenCalledTimes(3);

    forumMocks.searchTopics.mockClear();
    await gateway.searchTopics({ source: 'all', query: 'pending aggregate search' });
    expect(forumMocks.searchTopics).toHaveBeenCalledTimes(1);
    expect(forumMocks.searchTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'all',
        discourseAuth: expect.objectContaining({ linuxdo: expect.objectContaining({ authenticated: false }) }),
        linuxDoAuthenticated: false,
        nodeSeekAuthenticated: false,
        unavailableSources: ['yaohuo']
      })
    );
    expect(loadXiaoyinsiCredentialsForSource).not.toHaveBeenCalled();
    expect(fallbackFetcher).not.toHaveBeenCalled();
    expect(anonymousFetcher).toHaveBeenCalledTimes(4);
    expect(anonymousFetcher.mock.calls[3]?.[1]).toMatchObject({ credentials: 'omit' });
  });

  it('[REG-SEARCH-024] rejects a late anonymous result after the identity mode becomes confirmed', async () => {
    const response = Promise.withResolvers<Response>();
    const fallbackFetcher = vi.fn<Fetcher>(async () => new Response('fallback must stay unused'));
    const anonymousFetcher = vi.fn<Fetcher>(async () => response.promise);
    let blocked = true;
    forumMocks.searchTopics.mockImplementationOnce(async (options: { fetcher: Fetcher }): Promise<SearchResponse> => {
      await options.fetcher('https://www.google.com/search?q=site%3Alinux.do+pending');
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({
      anonymousFetcher,
      fetcher: fallbackFetcher,
      isSourceAuthenticated: () => true,
      isSourceReadBlocked: () => blocked,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    const read = gateway.searchTopics({ source: 'linuxdo', query: 'pending' });
    await vi.waitFor(() => expect(anonymousFetcher).toHaveBeenCalledTimes(1));
    blocked = false;
    response.resolve(new Response('anonymous'));

    await expect(read).rejects.toThrow('请求已取消');
    expect(fallbackFetcher).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-010] rejects disabled direct reads before credentials, user agent, adapter, or transport', async () => {
    const fetcher = vi.fn();
    const nodeSeekUserAgent = vi.fn(() => 'NodeSeek UA');
    const loadXiaoyinsiCredentialsForSource = vi.fn();
    const gateway = createReadGateway({
      fetcher,
      getEnabledSources: () => ['v2ex'] as const,
      loadXiaoyinsiCredentialsForSource,
      nodeSeekUserAgent
    });

    for (const read of [
      () => gateway.getFeed({ source: 'nodeseek' }),
      () => gateway.getTopic({ source: 'nodeseek', id: '42' })
    ]) {
      await expect(read()).rejects.toMatchObject({ reason: 'source-disabled', source: 'nodeseek' });
    }

    expect(forumMocks.getFeed).not.toHaveBeenCalled();
    expect(forumMocks.getTopic).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(nodeSeekUserAgent).not.toHaveBeenCalled();
    expect(loadXiaoyinsiCredentialsForSource).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-010] uses one enabled snapshot for an all-source read and returns an empty aggregate without credentials or transport', async () => {
    const fetcher = vi.fn();
    const nodeSeekUserAgent = vi.fn(() => 'NodeSeek UA');
    const loadXiaoyinsiCredentialsForSource = vi.fn();
    const enabledSources = ['v2ex', 'nodeseek'] as const;
    const gateway = createReadGateway({
      fetcher,
      getEnabledSources: () => enabledSources,
      loadXiaoyinsiCredentialsForSource,
      nodeSeekUserAgent
    });

    await gateway.getFeed({ source: 'all' });

    expect(forumMocks.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ includedSources: ['nodeseek', 'v2ex'], source: 'all' })
    );

    forumMocks.getFeed.mockClear();
    nodeSeekUserAgent.mockClear();
    loadXiaoyinsiCredentialsForSource.mockClear();
    const emptyGateway = createReadGateway({
      fetcher,
      getEnabledSources: () => [] as const,
      loadXiaoyinsiCredentialsForSource,
      nodeSeekUserAgent
    });

    await expect(emptyGateway.getFeed({ source: 'all' })).resolves.toEqual({
      errors: {},
      hasMore: false,
      items: [],
      nextPage: null
    });
    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ includedSources: [], source: 'all' }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(nodeSeekUserAgent).not.toHaveBeenCalled();
    expect(loadXiaoyinsiCredentialsForSource).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-010] cancels an all-source read after its enabled set changes and does not commit later fallback evidence', async () => {
    let enabledSources: readonly Source[] = ['nodeseek'];
    const parsed = Promise.withResolvers<void>();
    const allowFetch = Promise.withResolvers<void>();
    const recoverReadChannel = vi.fn(async () => undefined);
    const fetcher = vi.fn(forumReadEvidenceFetcher(recoverReadChannel));
    forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
      parsed.resolve();
      await allowFetch.promise;
      const response = await scopedFetcher('https://www.nodeseek.com/');
      acceptForumReadResponse(response);
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({
      fetcher,
      getEnabledSources: () => enabledSources,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    const read = gateway.getFeed({ source: 'all' });
    await parsed.promise;
    enabledSources = [];
    allowFetch.resolve();

    await expect(read).rejects.toThrow('请求已取消');
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it.each([
    ['continues when another source becomes enabled', ['nodeseek'], ['nodeseek', 'v2ex'], true],
    ['continues when another source becomes disabled', ['nodeseek', 'v2ex'], ['nodeseek'], true],
    ['cancels when the direct source becomes disabled', ['nodeseek', 'v2ex'], ['v2ex'], false]
  ] as const)(
    '[REG-SOURCE-010] %s during an in-flight direct read',
    async (_behavior, initialSources, nextSources, remainsCurrent) => {
      let enabledSources: readonly Source[] = initialSources;
      const parsed = Promise.withResolvers<void>();
      const finishRead = Promise.withResolvers<void>();
      const recoverReadChannel = vi.fn(async () => undefined);
      const fetcher = vi.fn(forumReadEvidenceFetcher(recoverReadChannel));
      forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
        const response = await scopedFetcher('https://www.nodeseek.com/');
        acceptForumReadResponse(response);
        parsed.resolve();
        await finishRead.promise;
        return { items: [], errors: {}, hasMore: false, nextPage: null };
      });
      const gateway = createReadGateway({
        fetcher,
        getEnabledSources: () => enabledSources,
        nodeSeekUserAgent: () => 'NodeSeek UA'
      });

      const read = gateway.getFeed({ source: 'nodeseek' });
      await parsed.promise;
      enabledSources = nextSources;
      finishRead.resolve();

      if (remainsCurrent) {
        await expect(read).resolves.toMatchObject({ items: [] });
        expect(recoverReadChannel).toHaveBeenCalledTimes(1);
      } else {
        await expect(read).rejects.toThrow('请求已取消');
        expect(recoverReadChannel).not.toHaveBeenCalled();
      }
    }
  );

  it('[REG-SOURCE-010] rejects a stale all-source context before credentials, user agents, adapter, or transport', async () => {
    const fetcher = vi.fn();
    const isSourceAuthenticated = vi.fn(() => true);
    const linuxDoUserAgent = vi.fn(() => 'linux.do UA');
    const loadXiaoyinsiCredentialsForSource = vi.fn(async () => ({ apiKey: 'key', clientId: 'client' }));
    const nodeSeekUserAgent = vi.fn(() => 'NodeSeek UA');
    const gateway = createReadGateway({
      fetcher,
      getEnabledSources: () => ['v2ex'] as const,
      isSourceAuthenticated,
      linuxDoUserAgent,
      loadXiaoyinsiCredentialsForSource,
      nodeSeekUserAgent
    });

    await expect(gateway.getFeed({ source: 'all' }, { includedSources: ['xiaoyinsi'] })).rejects.toThrow('请求已取消');

    expect(loadXiaoyinsiCredentialsForSource).not.toHaveBeenCalled();
    expect(isSourceAuthenticated).not.toHaveBeenCalled();
    expect(linuxDoUserAgent).not.toHaveBeenCalled();
    expect(nodeSeekUserAgent).not.toHaveBeenCalled();
    expect(forumMocks.getFeed).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-010] keeps a reordered all-source context current when its canonical set is unchanged', async () => {
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      getEnabledSources: () => ['v2ex', 'nodeseek'] as const,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await expect(gateway.getFeed({ source: 'all' }, { includedSources: ['nodeseek', 'v2ex'] })).resolves.toMatchObject({
      items: []
    });
    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ includedSources: ['nodeseek', 'v2ex'] }));
  });

  it('[REG-SOURCE-010] terminates an owned disabled-source trace as blocked', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      getEnabledSources: () => ['v2ex'] as const,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await expect(gateway.getFeed({ source: 'nodeseek' })).rejects.toMatchObject({
      reason: 'source-disabled',
      source: 'nodeseek'
    });

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ phase: 'intent', source: 'nodeseek' }),
      expect.objectContaining({
        phase: 'finish',
        outcome: 'blocked',
        reason: 'source_disabled',
        source: 'nodeseek'
      })
    ]);
  });

  it('[REG-TOPIC-039] resolves a NodeSeek username through managed session transport', async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn();
    nodeSeekMocks.resolveNodeSeekUser.mockResolvedValueOnce({
      source: 'nodeseek',
      id: '23042',
      username: 'lcy0828',
      displayName: 'lcy0828',
      url: 'https://www.nodeseek.com/space/23042'
    });
    const gateway = createReadGateway({
      currentSessionEpoch: () => 4,
      fetcher,
      isSourceAuthenticated: (source) => source === 'nodeseek',
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await expect(gateway.resolveNodeSeekUser({ username: 'lcy0828', signal })).resolves.toMatchObject({
      id: '23042',
      username: 'lcy0828'
    });
    expect(nodeSeekMocks.resolveNodeSeekUser).toHaveBeenCalledWith('lcy0828', {
      authenticated: true,
      fetcher: expect.any(Function),
      nodeSeekUserAgent: 'NodeSeek UA',
      signal
    });
  });

  it('[REG-TOPIC-039] blocks NodeSeek username resolution at the identity barrier', async () => {
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: () => true,
      isSourceReadBlocked: (source) => source === 'nodeseek',
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await expect(gateway.resolveNodeSeekUser({ username: 'alice' })).rejects.toThrow('登录状态暂时无法确认');
    expect(nodeSeekMocks.resolveNodeSeekUser).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-039] records safe diagnostics for NodeSeek username resolution', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const privateUsername = 'private-resolver-user';
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ memberList: [privateUsername] }), {
          headers: { 'content-type': 'application/json' }
        })
    );
    nodeSeekMocks.resolveNodeSeekUser.mockImplementationOnce(async (username, options) => {
      await options.fetcher(`https://www.nodeseek.com/api/account/find/${encodeURIComponent(username)}`, {
        signal: options.signal
      });
      return {
        source: 'nodeseek',
        id: '7',
        username,
        url: 'https://www.nodeseek.com/space/7'
      };
    });
    const gateway = createReadGateway({
      fetcher,
      isSourceAuthenticated: () => true,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await gateway.resolveNodeSeekUser({ username: privateUsername });

    const serialized = lines.join('');
    expect(lines.map((line) => JSON.parse(line).operation)).toEqual(expect.arrayContaining(['resolveUser']));
    expect(serialized).not.toMatch(/private-resolver-user|account\/find|memberList/i);
  });

  it('[REG-ACCOUNT-009][REG-TOPIC-039] drops a resolved username from an old NodeSeek session epoch', async () => {
    let epoch = 4;
    const pending = Promise.withResolvers<{
      source: 'nodeseek';
      id: string;
      username: string;
      url: string;
    }>();
    nodeSeekMocks.resolveNodeSeekUser.mockReturnValueOnce(pending.promise);
    const gateway = createReadGateway({
      currentSessionEpoch: () => epoch,
      fetcher: vi.fn(),
      isSourceAuthenticated: () => true,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    const resolution = gateway.resolveNodeSeekUser({ username: 'alice' });
    await vi.waitFor(() => expect(nodeSeekMocks.resolveNodeSeekUser).toHaveBeenCalledTimes(1));
    epoch += 1;
    pending.resolve({
      source: 'nodeseek',
      id: '7',
      username: 'alice',
      url: 'https://www.nodeseek.com/space/7'
    });

    await expect(resolution).rejects.toThrow('请求已取消');
  });

  it('[REG-TOPIC-027] routes emoji reads through managed credentials, fetcher, diagnostics, and cancellation', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async () => new Response('{}'));
    linuxDoMocks.getLinuxDoEmojiUrls.mockImplementationOnce(async (options) => {
      await options.fetcher?.('https://linux.do/emojis.json', { signal: options.signal });
      return { heart: 'https://linux.do/heart.png' };
    });
    const gateway = createReadGateway({
      fetcher,
      isSourceAuthenticated: (source) => source === 'linuxdo',
      linuxDoUserAgent: () => 'LinuxDo UA',
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getEmojiUrls({ source: 'linuxdo', signal })).resolves.toEqual({
      heart: 'https://linux.do/heart.png'
    });

    expect(linuxDoMocks.getLinuxDoEmojiUrls).toHaveBeenCalledWith(
      expect.objectContaining({
        linuxDoAccess: { authenticated: true, userAgent: 'LinuxDo UA' },
        signal
      })
    );
    expect(fetcher).toHaveBeenCalledWith('https://linux.do/emojis.json', expect.objectContaining({ signal }));
    expect(lines.map((line) => JSON.parse(line).operation)).toEqual(expect.arrayContaining(['getEmojiUrls']));
  });

  it('records one safe partial diagnostic trace for an owned feed read', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'nodeseek',
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });
    forumMocks.getFeed.mockResolvedValueOnce({
      items: [
        {
          source: 'nodeseek',
          id: 'private-topic-id',
          title: 'private title',
          author: 'private author',
          url: 'https://www.nodeseek.com/private-topic-id',
          createdAt: '2026-07-10T00:00:00.000Z',
          replyCount: 0
        }
      ],
      errors: { linuxdo: { kind: 'ordinary', message: 'private upstream message' } },
      hasMore: true,
      nextPage: 2
    });

    await gateway.getFeed({ source: 'nodeseek' });

    const serialized = lines.join('');
    const events = lines.map((line) => JSON.parse(line));
    expect(events.map(({ phase }) => phase)).toEqual(['intent', 'credential', 'transport', 'parse', 'finish']);
    expect(events.at(-2)).toMatchObject({
      phase: 'parse',
      itemCount: 1,
      partialErrorCount: 1,
      hasMore: true
    });
    expect(events.at(-1)).toMatchObject({ phase: 'finish', outcome: 'partial' });
    expect(events.find(({ phase }) => phase === 'transport')).toMatchObject({ channel: 'direct', state: 'start' });
    expect(forumMocks.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeSeekAuthenticated: true,
        nodeSeekUserAgent: 'NodeSeek UA'
      })
    );
    expect(new Set(events.map(({ traceId }) => traceId))).toHaveProperty('size', 1);
    expect(serialized).not.toContain('private-topic-id');
    expect(serialized).not.toContain('private upstream message');
  });

  it('records LinuxDo credential presence without exposing credential contents', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'linuxdo',
      linuxDoUserAgent: () => 'LinuxDo UA',
      nodeSeekUserAgent: () => ''
    });

    await gateway.searchTagOptions({ source: 'linuxdo' });

    const events = lines.map((line) => JSON.parse(line));
    expect(events.find(({ phase }) => phase === 'credential')).toMatchObject({
      source: 'linuxdo',
      hasCredential: true
    });
    expect(lines.join('')).not.toMatch(/cookie|token|LinuxDo UA/i);
  });

  it('loads linux.do level access and enforces its session epoch inside the gateway', async () => {
    let generation = 3;
    const signal = new AbortController().signal;
    const pending = Promise.withResolvers<{ username: string }>();
    linuxDoLevelMocks.getLinuxDoLevelProfile.mockReturnValueOnce(pending.promise);
    const gateway = createReadGateway({
      currentSessionEpoch: () => generation,
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'linuxdo',
      linuxDoUserAgent: () => 'safe-agent',
      nodeSeekUserAgent: () => ''
    });

    const read = gateway.getLinuxDoLevelProfile({ source: 'linuxdo', signal });
    await vi.waitFor(() => expect(linuxDoLevelMocks.getLinuxDoLevelProfile).toHaveBeenCalledTimes(1));

    expect(linuxDoLevelMocks.getLinuxDoLevelProfile).toHaveBeenCalledWith({
      userAgent: 'safe-agent',
      fetcher: expect.any(Function),
      signal
    });

    generation += 1;
    pending.resolve({ username: 'alice' });
    await expect(read).rejects.toThrow('请求已取消');
  });

  it('does not probe credentials before a public all-source read', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getFeed({ source: 'all' })).resolves.toMatchObject({
      items: expect.any(Array),
      errors: expect.any(Object)
    });

    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'all' }));
    expect(
      lines.map((line) => JSON.parse(line)).find(({ phase, source }) => phase === 'credential' && source === 'all')
    ).toMatchObject({
      source: 'all',
      hasCredential: false,
      isCredentialKnown: false
    });
  });

  it('[REG-SOURCE-001][REG-SOURCE-011] skips Xiaoyinsi credentials on its public read lane', async () => {
    const visibleTopic: Topic = {
      source: 'v2ex',
      id: 'visible-topic',
      title: '仍可读取的公开主题',
      author: 'alice',
      url: 'https://www.v2ex.com/t/visible-topic',
      createdAt: '2026-07-19T00:00:00.000Z',
      replyCount: 0
    };
    const unauthoritativeTopic: Topic = {
      source: 'nodeseek',
      id: 'anonymous-topic',
      title: '凭据失败后匿名读取到的主题',
      author: 'bob',
      url: 'https://www.nodeseek.com/post-anonymous-topic-1',
      createdAt: '2026-07-19T00:01:00.000Z',
      replyCount: 0
    };
    forumMocks.getFeed.mockResolvedValueOnce({
      items: [visibleTopic, unauthoritativeTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const loadXiaoyinsiCredentialsForSource = vi.fn(async () => {
      throw new Error('Xiaoyinsi credential store failed');
    });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      loadXiaoyinsiCredentialsForSource,
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getFeed({ source: 'all' })).resolves.toMatchObject({
      items: [visibleTopic, unauthoritativeTopic],
      errors: {}
    });
    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.not.objectContaining({ unavailableSources: ['xiaoyinsi'] }));
    await expect(gateway.getFeed({ source: 'nodeseek' })).resolves.toBeDefined();
    await expect(gateway.getFeed({ source: 'xiaoyinsi' })).resolves.toBeDefined();
    expect(loadXiaoyinsiCredentialsForSource).not.toHaveBeenCalled();
  });

  it('adds gateway stages without finishing a caller-owned trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const trace = beginDiagnosticTrace('feed', 'refresh', { source: 'v2ex' });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      nodeSeekUserAgent: () => ''
    });

    await gateway.getFeed({ source: 'v2ex' }, { trace });

    expect(lines.map((line) => JSON.parse(line).phase)).toEqual(['intent', 'credential', 'transport', 'parse']);
    finishDiagnosticTrace(trace, 'success');
    expect(lines.map((line) => JSON.parse(line).phase).filter((phase) => phase === 'finish')).toHaveLength(1);
  });

  it('[REG-PROXY-012] rebuilds the shared read runtime and settles a V2EX feed after one direct timeout', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const fetcher = vi
      .fn<Fetcher>()
      .mockRejectedValueOnce(new RequestTimeoutError())
      .mockResolvedValueOnce(new Response('{}'));
    const readFeed = async ({ fetcher: scopedFetcher }: { fetcher: Fetcher }) => {
      await scopedFetcher('https://www.v2ex.com/?tab=all');
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    };
    forumMocks.getFeed.mockImplementationOnce(readFeed).mockImplementationOnce(readFeed);
    const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

    await expect(gateway.getFeed({ source: 'v2ex' })).resolves.toMatchObject({ items: [], errors: {} });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).toHaveBeenCalledWith(
      'v2ex',
      7,
      expect.objectContaining({ trace: expect.any(Object) })
    );
    expect(browserFetchIntentFromInit(fetcher.mock.calls[0]?.[1])).toEqual({ owner: 'feed', priority: 'foreground' });
    const events = lines.map((line) => JSON.parse(line));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'rotate-read-runtime',
          phase: 'intent',
          source: 'v2ex',
          generation: 7,
          reason: 'timeout'
        }),
        expect.objectContaining({
          phase: 'transport',
          source: 'v2ex',
          state: 'retry',
          generation: 8,
          reason: 'timeout',
          retryCount: 1
        })
      ])
    );
  });

  it.each([
    ['typed cancellation', () => new RequestCanceledError()],
    ['native network cancellation', () => new TypeError('Network request failed')]
  ])(
    '[REG-PROXY-012] replays a current foreground read rejected by a completed runtime rotation: %s',
    async (_kind, cancellation) => {
      const fetcher = vi
        .fn<Fetcher>()
        .mockImplementationOnce(async () => {
          readNetworkRuntimeMocks.generation = 8;
          readNetworkRuntimeMocks.triggerSource = 'v2ex';
          throw cancellation();
        })
        .mockResolvedValueOnce(new Response('{}'));
      const readFeed = async ({ fetcher: scopedFetcher }: { fetcher: Fetcher }) => {
        await scopedFetcher('https://www.v2ex.com/?tab=all');
        return { items: [], errors: {}, hasMore: false, nextPage: null };
      };
      forumMocks.getFeed.mockImplementationOnce(readFeed).mockImplementationOnce(readFeed);
      const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

      await expect(gateway.getFeed({ source: 'v2ex' })).resolves.toMatchObject({ items: [], errors: {} });

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).not.toHaveBeenCalled();
    }
  );

  it('[REG-PROXY-012] does not replay a cancellation caused by another source rotation', async () => {
    const fetcher = vi.fn<Fetcher>().mockImplementationOnce(async () => {
      readNetworkRuntimeMocks.generation = 8;
      readNetworkRuntimeMocks.triggerSource = 'linuxdo';
      throw new RequestCanceledError();
    });
    forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
      await scopedFetcher('https://www.v2ex.com/?tab=all');
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

    await expect(gateway.getFeed({ source: 'v2ex' })).rejects.toBeInstanceOf(RequestCanceledError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).not.toHaveBeenCalled();
  });

  it('[REG-PROXY-012] reuses the shared runtime recovery for one Yaohuo feed timeout', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockRejectedValueOnce(new RequestTimeoutError())
      .mockResolvedValueOnce(new Response('{}'));
    const readFeed = async (options: Parameters<typeof getYaohuoFeedDirect>[0]) => {
      if (!options.yaohuoFetcher) throw new Error('missing Yaohuo fetcher');
      await options.yaohuoFetcher('https://www.yaohuo.me/bbs/book_list.aspx');
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    };
    vi.mocked(getYaohuoFeedDirect).mockImplementationOnce(readFeed).mockImplementationOnce(readFeed);
    const gateway = createReadGateway({
      fetcher,
      isSourceAuthenticated: (source) => source === 'yaohuo',
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getFeed({ source: 'yaohuo' })).resolves.toMatchObject({ items: [], errors: {} });

    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).toHaveBeenCalledWith(
      'yaohuo',
      7,
      expect.objectContaining({ trace: expect.any(Object) })
    );
    expect(fetcher.mock.calls.every(([, init]) => browserFetchIntentFromInit(init)?.owner === 'feed')).toBe(true);
  });

  it('[REG-PROXY-012] reuses the shared runtime recovery for one Xiaoyinsi feed timeout', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockRejectedValueOnce(new RequestTimeoutError())
      .mockResolvedValueOnce(new Response('{}'));
    const readFeed = async ({ fetcher: scopedFetcher }: { fetcher: Fetcher }) => {
      await scopedFetcher('https://forum.xiaoyinsi.com/latest.json');
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    };
    forumMocks.getFeed.mockImplementationOnce(readFeed).mockImplementationOnce(readFeed);
    const gateway = createReadGateway({
      fetcher,
      isSourceAuthenticated: (source) => source === 'xiaoyinsi',
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => ({ apiKey: 'api-key', clientId: 'client-id' })),
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getFeed({ source: 'xiaoyinsi' })).resolves.toMatchObject({ items: [], errors: {} });

    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).toHaveBeenCalledWith(
      'xiaoyinsi',
      7,
      expect.objectContaining({ trace: expect.any(Object) })
    );
    expect(fetcher.mock.calls.every(([, init]) => browserFetchIntentFromInit(init)?.owner === 'feed')).toBe(true);
  });

  it('[REG-PROXY-012] stops after one recovery when the replay also times out', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockRejectedValueOnce(new RequestTimeoutError())
      .mockRejectedValueOnce(new RequestTimeoutError());
    const readFeed = async ({ fetcher: scopedFetcher }: { fetcher: Fetcher }) => {
      await scopedFetcher('https://www.v2ex.com/?tab=all');
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    };
    forumMocks.getFeed.mockImplementationOnce(readFeed).mockImplementationOnce(readFeed);
    const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

    await expect(gateway.getFeed({ source: 'v2ex' })).rejects.toBeInstanceOf(RequestTimeoutError);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).toHaveBeenCalledTimes(1);
  });

  it('[REG-PROXY-012] restarts the whole logical Topic read instead of retrying only its timed-out HTTP call', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(new Response('{}'))
      .mockRejectedValueOnce(new RequestTimeoutError())
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}'));
    let logicalAttempts = 0;
    const readTopic = async ({ fetcher: scopedFetcher, id, source }: Parameters<typeof getTopic>[0]) => {
      if (!scopedFetcher) throw new Error('missing Topic fetcher');
      logicalAttempts += 1;
      await scopedFetcher(`https://www.v2ex.com/api/topics/show.json?id=${id}`);
      await scopedFetcher(`https://www.v2ex.com/t/${id}`);
      return {
        source,
        id,
        title: '',
        author: '',
        url: '',
        createdAt: '',
        replyCount: 0,
        contentHtml: '',
        replies: []
      };
    };
    forumMocks.getTopic.mockImplementationOnce(readTopic).mockImplementationOnce(readTopic);
    const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

    await expect(gateway.getTopic({ source: 'v2ex', id: '123' })).resolves.toMatchObject({ id: '123' });

    expect(logicalAttempts).toBe(2);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://www.v2ex.com/api/topics/show.json?id=123',
      'https://www.v2ex.com/t/123',
      'https://www.v2ex.com/api/topics/show.json?id=123',
      'https://www.v2ex.com/t/123'
    ]);
    expect(fetcher.mock.calls.every(([, init]) => browserFetchIntentFromInit(init)?.owner === 'topic')).toBe(true);
    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).toHaveBeenCalledTimes(1);
  });

  it('[REG-PROXY-012] ignores a timeout that was not produced by an owned content request', async () => {
    forumMocks.getFeed.mockRejectedValueOnce(new RequestTimeoutError());
    const gateway = createReadGateway({ fetcher: vi.fn(), nodeSeekUserAgent: () => '' });

    await expect(gateway.getFeed({ source: 'v2ex' })).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).not.toHaveBeenCalled();
  });

  it('[REG-PROXY-012] preserves the original timeout when runtime recovery fails before publication', async () => {
    const timeout = new RequestTimeoutError();
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(timeout);
    forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
      await scopedFetcher('https://www.v2ex.com/?tab=all');
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    readNetworkRuntimeMocks.recoverReadNetworkRuntime.mockRejectedValueOnce(new Error('recovery failed'));
    const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

    await expect(gateway.getFeed({ source: 'v2ex' })).rejects.toBe(timeout);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['HTTP 500', '解析失败', '登录已失效'])(
    '[REG-PROXY-012] does not rebuild for an ordinary %s failure',
    async (message) => {
      const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(new Error(message));
      forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
        await scopedFetcher('https://www.v2ex.com/?tab=all');
        return { items: [], errors: {}, hasMore: false, nextPage: null };
      });
      const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

      await expect(gateway.getFeed({ source: 'v2ex' })).rejects.toThrow(message);
      expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).not.toHaveBeenCalled();
    }
  );

  it('[REG-PROXY-012] does not rebuild after the current page aborts its timed-out read', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(new RequestTimeoutError());
    forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
      await scopedFetcher('https://www.v2ex.com/?tab=all');
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

    const read = gateway.getFeed({ source: 'v2ex', signal: controller.signal });
    controller.abort();

    await expect(read).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).not.toHaveBeenCalled();
  });

  it('[REG-PROXY-012] does not rebuild or replay a write-owned GET routed through the read boundary', async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(new RequestTimeoutError());
    forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
      await scopedFetcher(
        'https://www.v2ex.com/write-like-get',
        withBrowserFetchIntent({}, { owner: 'write', priority: 'write' })
      );
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

    await expect(gateway.getFeed({ source: 'v2ex' })).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('[REG-PROXY-012] does not rebuild or replay a background-owned GET routed through the read boundary', async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValueOnce(new RequestTimeoutError());
    forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
      await scopedFetcher(
        'https://www.v2ex.com/background-check',
        withBrowserFetchIntent({}, { owner: 'account', priority: 'background' })
      );
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => '' });

    await expect(gateway.getFeed({ source: 'v2ex' })).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['nodeseek', 'linuxdo'] as const)(
    '[REG-PROXY-012] leaves %s recovery behind its parsed WebView evidence',
    async (source) => {
      forumMocks.getFeed.mockRejectedValueOnce(new RequestTimeoutError());
      const gateway = createReadGateway({ fetcher: vi.fn(), nodeSeekUserAgent: () => '' });

      await expect(gateway.getFeed({ source })).rejects.toBeInstanceOf(RequestTimeoutError);
      expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).not.toHaveBeenCalled();
    }
  );

  it('[REG-PROXY-012] does not treat the all-source aggregate timeout as runtime damage', async () => {
    forumMocks.getFeed.mockRejectedValueOnce(new RequestTimeoutError());
    const gateway = createReadGateway({ fetcher: vi.fn(), nodeSeekUserAgent: () => '' });

    await expect(gateway.getFeed({ source: 'all' })).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(readNetworkRuntimeMocks.recoverReadNetworkRuntime).not.toHaveBeenCalled();
  });

  it('classifies an unexpected HTTP-success parse-empty adapter result as a failure', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getFeed.mockResolvedValueOnce(
      annotateSourceDiagnosticSummary(
        {
          items: [],
          errors: {},
          hasMore: false,
          nextPage: null
        },
        {
          parserVariant: 'rendered-list',
          candidateCount: 2,
          validCount: 0,
          droppedCount: 2,
          isExpectedEmpty: false
        }
      )
    );

    await gateway.getFeed({ source: 'nodeseek' });

    const events = lines.map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({
      phase: 'parse',
      parserVariant: 'rendered-list',
      candidateCount: 2,
      validCount: 0,
      droppedCount: 2,
      isParseEmpty: true
    });
    expect(events.at(-1)).toMatchObject({ phase: 'finish', outcome: 'failure', reason: 'parse_empty' });
  });

  it('does not report a legal empty search page as parse-empty', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.searchTopics.mockResolvedValueOnce(
      annotateSourceDiagnosticSummary(
        {
          items: [],
          errors: {},
          hasMore: false,
          nextPage: null
        },
        {
          parserVariant: 'sov2ex-search',
          candidateCount: 0,
          validCount: 0,
          droppedCount: 0,
          isExpectedEmpty: true
        }
      )
    );

    await gateway.searchTopics({ source: 'v2ex', query: 'no-result' });

    const events = lines.map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({ phase: 'parse', isExpectedEmpty: true });
    expect(events.at(-2).isParseEmpty).not.toBe(true);
    expect(events.at(-1)).toMatchObject({ phase: 'finish', outcome: 'success' });
  });

  it('defers a caller-owned parse-empty terminal until controller apply and upgrades success to failure', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const trace = beginDiagnosticTrace('feed', 'load', { source: 'nodeseek' });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getFeed.mockResolvedValueOnce(
      annotateSourceDiagnosticSummary(
        {
          items: [],
          errors: {},
          hasMore: false,
          nextPage: null
        },
        {
          parserVariant: 'embedded-list',
          candidateCount: 1,
          validCount: 0,
          droppedCount: 1,
          isExpectedEmpty: false
        }
      )
    );

    await gateway.getFeed({ source: 'nodeseek' }, { trace });
    expect(lines.map((line) => JSON.parse(line).phase)).not.toContain('finish');

    markDiagnosticStage(trace, 'apply', { itemCount: 0 });
    finishDiagnosticTrace(trace, 'success');

    const events = lines.map((line) => JSON.parse(line));
    expect(events.map(({ phase }) => phase)).toContain('apply');
    expect(events.filter(({ phase }) => phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'failure', reason: 'parse_empty' })
    ]);
  });

  it('upgrades a caller-owned successful valid result with adapter degradation to partial', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const trace = beginDiagnosticTrace('user', 'open', { source: 'v2ex' });
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockResolvedValueOnce(
      annotateSourceDiagnosticSummary(
        {
          source: 'v2ex',
          id: 'user',
          username: 'user',
          displayName: 'user',
          url: '',
          topics: []
        },
        {
          parserVariant: 'api-user',
          candidateCount: 1,
          validCount: 1,
          droppedCount: 0,
          partialErrorCount: 1,
          hasDegradation: true
        }
      )
    );

    await gateway.getUserProfile({ source: 'v2ex', id: 'user' }, { trace });
    markDiagnosticStage(trace, 'apply', { itemCount: 1 });
    finishDiagnosticTrace(trace, 'success');

    const terminal = lines.map((line) => JSON.parse(line)).filter(({ phase }) => phase === 'finish');
    expect(terminal).toEqual([expect.objectContaining({ outcome: 'partial' })]);
  });

  it('marks a Yaohuo topic trace partial when optional favorite state is unavailable', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const trace = beginDiagnosticTrace('topic', 'open', { source: 'yaohuo' });
    const topic: Topic = {
      source: 'yaohuo',
      id: 'private-topic-id',
      title: 'private title',
      author: 'private author',
      url: 'https://www.yaohuo.me/bbs-private-topic-id.html',
      createdAt: '',
      replyCount: 0
    };
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'yaohuo',
      nodeSeekUserAgent: () => ''
    });
    vi.mocked(getYaohuoTopicDirect).mockResolvedValueOnce(
      annotateSourceDiagnosticSummary(
        {
          ...topic,
          contentHtml: '<p>private body</p>',
          replies: []
        },
        {
          parserVariant: 'html-topic-with-replies',
          candidateCount: 1,
          validCount: 1,
          droppedCount: 0,
          partialErrorCount: 1,
          hasDegradation: true
        }
      )
    );

    await gateway.getTopic({ source: 'yaohuo', id: topic.id, topic }, { trace });
    markDiagnosticStage(trace, 'apply', { itemCount: 1 });
    finishDiagnosticTrace(trace, 'success');

    const serialized = lines.join('');
    const parseStates = lines
      .map((line) => JSON.parse(line))
      .filter(({ phase }) => phase === 'parse')
      .map(({ state }) => state);
    const terminal = lines.map((line) => JSON.parse(line)).filter(({ phase }) => phase === 'finish');
    expect(parseStates).toEqual(['source-parsed', 'content-plan-ready', undefined]);
    expect(terminal).toEqual([expect.objectContaining({ outcome: 'partial' })]);
    expect(serialized).not.toMatch(
      /private-topic-id|private title|private author|private body|yaohuo\.me|sidyaohuo=secret/
    );
  });

  it.each<Source>(['v2ex', 'linuxdo', 'nodeseek'])('keeps all five reads behind the gateway for %s', async (source) => {
    await getFeed({ source });
    await searchTopics({ source, query: 'codex' });
    await getTopic({ source, id: 'topic-1' });
    await getReplies({ source, id: 'topic-1', order: 'oldest', position: { kind: 'start' } });
    await getUserProfile({ source, id: 'user-1' });

    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ source }));
    expect(forumMocks.searchTopics).toHaveBeenCalledWith(expect.objectContaining({ source, query: 'codex' }));
    expect(forumMocks.getTopic).toHaveBeenCalledWith(expect.objectContaining({ source, id: 'topic-1' }));
    expect(forumMocks.getReplies).toHaveBeenCalledWith(
      expect.objectContaining({ source, id: 'topic-1', order: 'oldest', position: { kind: 'start' } })
    );
    expect(forumMocks.getUserProfile).toHaveBeenCalledWith(expect.objectContaining({ source, id: 'user-1' }));
  });

  it('[REG-TOPIC-067] records order, position kind, and resolved page without reply content', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    forumMocks.getReplies.mockResolvedValueOnce({
      items: [{ author: 'private-author', floor: 45, contentHtml: '<p>private-body</p>', createdAt: '' }],
      currentPage: 5,
      currentOffset: 40,
      hasMore: false,
      nextPage: null
    });
    const gateway = createReadGateway({ fetcher: vi.fn(), nodeSeekUserAgent: () => '' });

    await gateway.getReplies({
      source: 'nodeseek',
      id: 'private-topic-id',
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 45
    });

    const events = lines.map((line) => JSON.parse(line));
    expect(events.find(({ phase }) => phase === 'intent')).toMatchObject({
      replyOrder: 'newest',
      positionKind: 'start'
    });
    expect(events.find(({ resolvedPage }) => resolvedPage === 5)).toMatchObject({ phase: 'parse' });
    expect(lines.join('')).not.toMatch(/private-topic-id|private-author|private-body/);
  });

  it('[REG-LINUXDO-005] preserves the confirmed-auth decision through the managed gateway', async () => {
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'linuxdo',
      linuxDoUserAgent: () => 'linux.do UA',
      nodeSeekUserAgent: () => ''
    });

    await gateway.searchTopics({
      source: 'linuxdo',
      query: 'codex'
    });

    expect(forumMocks.searchTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'linuxdo',
        query: 'codex',
        linuxDoAuthenticated: true,
        discourseAuth: {
          linuxdo: {
            authenticated: true,
            categoryCacheScope: 'authenticated:0',
            userAgent: 'linux.do UA'
          }
        }
      })
    );
  });

  it('keeps linux.do search candidates and AI reads behind the managed gateway', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const fetcher = vi.fn();
    const gateway = createReadGateway({
      fetcher,
      isSourceAuthenticated: (source) => source === 'linuxdo',
      nodeSeekUserAgent: () => ''
    });
    const tagTrace = beginDiagnosticTrace('search', 'searchTagOptions', { source: 'linuxdo' });
    linuxDoMocks.searchLinuxDoTags.mockResolvedValueOnce([{ name: '人工智能' }]);

    await gateway.searchTagOptions(
      { source: 'linuxdo', query: '人', categoryId: '4', selectedTags: ['快问快答'] },
      { trace: tagTrace }
    );
    markDiagnosticStage(tagTrace, 'apply', { source: 'linuxdo', itemCount: 1 });
    finishDiagnosticTrace(tagTrace, 'success', { source: 'linuxdo', itemCount: 1 });
    await gateway.searchUserOptions({ source: 'linuxdo', term: 'ali', categoryId: '4' });
    await gateway.searchSemanticTopics({ source: 'linuxdo', query: 'AI tags:人工智能' });

    expect(linuxDoMocks.searchLinuxDoTags).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '人',
        categoryId: '4',
        selectedTags: ['快问快答'],
        fetcher: expect.any(Function)
      })
    );
    expect(linuxDoMocks.searchLinuxDoUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        term: 'ali',
        categoryId: '4',
        fetcher: expect.any(Function)
      })
    );
    expect(linuxDoMocks.searchLinuxDoSemantic).toHaveBeenCalledWith(
      'AI tags:人工智能',
      expect.objectContaining({ fetcher: expect.any(Function) })
    );
    const tagEvents = lines.map((line) => JSON.parse(line)).filter(({ traceId }) => traceId === tagTrace.traceId);
    expect(tagEvents.map(({ phase }) => phase)).toEqual([
      'intent',
      'credential',
      'transport',
      'parse',
      'apply',
      'finish'
    ]);
    expect(tagEvents.find(({ phase }) => phase === 'parse')).toMatchObject({ itemCount: 1 });
    expect(new Set(tagEvents.map(({ traceId }) => traceId))).toHaveProperty('size', 1);
    expect(lines.join('')).not.toContain('快问快答');
    expect(lines.join('')).not.toContain('AI tags:人工智能');
  });

  it('owns NodeSeek identity, session epoch, user agent, and transport for every read path', async () => {
    const fetcher = vi.fn();
    const currentSessionEpoch = vi.fn(() => 4);
    const gateway = createReadGateway({
      currentSessionEpoch,
      fetcher,
      isSourceAuthenticated: (source) => source === 'nodeseek',
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await gateway.getCategories({ source: 'nodeseek' });
    await gateway.getFeed({ source: 'nodeseek' });
    await gateway.searchTopics({ source: 'nodeseek', query: 'codex' });
    await gateway.getTopic({ source: 'nodeseek', id: 'topic-1' });
    await gateway.getReplies({
      source: 'nodeseek',
      id: 'topic-1',
      order: 'oldest',
      position: { kind: 'start' }
    });
    await gateway.getReply({ source: 'linuxdo', id: 'topic-1', floor: 2 });
    await gateway.getUserProfile({ source: 'nodeseek', id: 'user-1' });

    expect(currentSessionEpoch).toHaveBeenCalledWith('nodeseek');
    expect(forumMocks.getCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nodeseek',
        fetcher: expect.any(Function),
        nodeSeekAuthenticated: true,
        nodeSeekUserAgent: 'NodeSeek UA'
      })
    );
    expect(forumMocks.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nodeseek',
        fetcher: expect.any(Function),
        nodeSeekAuthenticated: true,
        nodeSeekUserAgent: 'NodeSeek UA'
      })
    );
    expect(forumMocks.searchTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nodeseek',
        fetcher: expect.any(Function),
        nodeSeekAuthenticated: true,
        nodeSeekUserAgent: 'NodeSeek UA'
      })
    );
    expect(forumMocks.getTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nodeseek',
        fetcher: expect.any(Function),
        nodeSeekAuthenticated: true,
        nodeSeekUserAgent: 'NodeSeek UA'
      })
    );
    expect(forumMocks.getReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nodeseek',
        fetcher: expect.any(Function),
        nodeSeekAuthenticated: true,
        nodeSeekUserAgent: 'NodeSeek UA'
      })
    );
    expect(forumMocks.getReply).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'linuxdo', id: 'topic-1', floor: 2, fetcher: expect.any(Function) })
    );
    expect(forumMocks.getUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nodeseek',
        id: 'user-1',
        fetcher: expect.any(Function),
        nodeSeekAuthenticated: true,
        nodeSeekUserAgent: 'NodeSeek UA'
      })
    );
  });

  it.each(['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi'] as const)(
    'REG-ACCOUNT-009 cancels a %s read when its session epoch changes before the response',
    async (source) => {
      let generation = 7;
      const response = Promise.withResolvers<{
        source: typeof source;
        id: string;
        username: string;
        displayName: string;
        url: string;
        topics: never[];
      }>();
      forumMocks.getUserProfile.mockReturnValueOnce(response.promise);
      const gateway = createReadGateway({
        currentSessionEpoch: () => generation,
        currentXiaoyinsiCredentialGeneration: () => generation,
        fetcher: vi.fn(),
        isSourceAuthenticated: () => true,
        loadXiaoyinsiCredentialsForSource: vi.fn(async (_source, options) => {
          options?.captureGeneration?.(generation);
          return { apiKey: 'old-key', clientId: 'old-client' };
        }),
        nodeSeekUserAgent: () => ''
      });

      const read = gateway.getUserProfile({ source, id: '7' });
      await vi.waitFor(() => expect(forumMocks.getUserProfile).toHaveBeenCalledTimes(1));
      generation += 1;
      response.resolve({ source, id: '7', username: 'old-user', displayName: 'Old User', url: '', topics: [] });

      await expect(read).rejects.toThrow('请求已取消');
    }
  );

  it('[REG-SOURCE-009] does not commit parsed fallback evidence after the gateway read is superseded', async () => {
    let generation = 4;
    const parsed = Promise.withResolvers<void>();
    const finishAuxiliaryWork = Promise.withResolvers<void>();
    const recoverReadChannel = vi.fn(async () => undefined);
    const fetcher = vi.fn(forumReadEvidenceFetcher(recoverReadChannel));
    forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
      const response = await scopedFetcher('https://www.nodeseek.com/');
      acceptForumReadResponse(response);
      parsed.resolve();
      await finishAuxiliaryWork.promise;
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({
      currentSessionEpoch: () => generation,
      fetcher,
      isSourceAuthenticated: (source) => source === 'nodeseek',
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });
    const read = gateway.getFeed({ source: 'nodeseek' });
    await parsed.promise;

    generation += 1;
    finishAuxiliaryWork.resolve();

    await expect(read).rejects.toThrow('请求已取消');
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-009] does not commit parsed fallback evidence after its AbortSignal is canceled', async () => {
    const controller = new AbortController();
    const parsed = Promise.withResolvers<void>();
    const finishAuxiliaryWork = Promise.withResolvers<void>();
    const recoverReadChannel = vi.fn(async () => undefined);
    const fetcher = vi.fn(forumReadEvidenceFetcher(recoverReadChannel));
    forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
      const response = await scopedFetcher('https://www.nodeseek.com/', { signal: controller.signal });
      acceptForumReadResponse(response);
      parsed.resolve();
      await finishAuxiliaryWork.promise;
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({ fetcher, nodeSeekUserAgent: () => 'NodeSeek UA' });
    const read = gateway.getFeed({ source: 'nodeseek', signal: controller.signal });
    await parsed.promise;

    controller.abort();
    finishAuxiliaryWork.resolve();

    await expect(read).resolves.toMatchObject({ items: [] });
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-009] stops committing response evidence when eligibility changes between commits', async () => {
    let generation = 9;
    let requestOrdinal = 0;
    const firstCommit = vi.fn(async () => {
      generation += 1;
    });
    const secondCommit = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      const response = new Response('{}');
      const ordinal = ++requestOrdinal;
      registerForumReadResponseEvidence(init, response, {
        commit: ordinal === 1 ? firstCommit : secondCommit,
        kind: 'fallback',
        ordinal,
        source: 'nodeseek'
      });
      return response;
    });
    forumMocks.getFeed.mockImplementationOnce(async ({ fetcher: scopedFetcher }) => {
      const first = await scopedFetcher('https://www.nodeseek.com/first');
      const second = await scopedFetcher('https://www.nodeseek.com/second');
      acceptForumReadResponse(first);
      acceptForumReadResponse(second);
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const gateway = createReadGateway({
      currentSessionEpoch: () => generation,
      fetcher,
      isSourceAuthenticated: (source) => source === 'nodeseek',
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await expect(gateway.getFeed({ source: 'nodeseek' })).rejects.toThrow('请求已取消');
    expect(firstCommit).toHaveBeenCalledTimes(1);
    expect(secondCommit).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-026] returns typed Yaohuo expiry without invoking a logout command', async () => {
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'yaohuo',
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockRejectedValueOnce(
      Object.assign(new Error('妖火登录已失效'), {
        loginRequired: true,
        reason: 'expired',
        source: 'yaohuo'
      })
    );

    await expect(gateway.getUserProfile({ source: 'yaohuo', id: '7' })).rejects.toMatchObject({
      kind: 'login-expired',
      message: '妖火登录已失效'
    });
  });

  it('REG-ACCOUNT-009 cancels an expired Yaohuo read when a newer credential takes ownership', async () => {
    let generation = 7;
    const response = Promise.withResolvers<never>();
    const gateway = createReadGateway({
      currentSessionEpoch: () => generation,
      fetcher: vi.fn(),
      isSourceAuthenticated: () => true,
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockReturnValueOnce(response.promise);

    const read = gateway.getUserProfile({ source: 'yaohuo', id: '7' });
    await vi.waitFor(() => expect(forumMocks.getUserProfile).toHaveBeenCalledTimes(1));
    generation += 1;
    response.reject(
      Object.assign(new Error('旧妖火登录已失效'), {
        loginRequired: true,
        reason: 'expired',
        source: 'yaohuo'
      })
    );

    await expect(read).rejects.toThrow('请求已取消');
  });

  it('surfaces a Yaohuo verification-required error without mutating session state', async () => {
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'yaohuo',
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockRejectedValueOnce(
      Object.assign(new Error('妖火需要完成访问验证'), {
        loginRequired: true,
        reason: 'verification',
        source: 'yaohuo',
        verificationRequired: true
      })
    );

    await expect(gateway.getUserProfile({ source: 'yaohuo', id: '7' })).rejects.toMatchObject({
      kind: 'verification-required',
      message: '妖火需要完成访问验证'
    });
  });

  it('routes 小隐寺 search candidates with its independent User API credentials', async () => {
    const credentials = { apiKey: 'secret-key', clientId: 'install-client' };
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'xiaoyinsi',
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => credentials),
      nodeSeekUserAgent: () => ''
    });
    xiaoyinsiMocks.searchXiaoyinsiTags.mockResolvedValueOnce([{ name: '公告' }]);

    await gateway.searchTagOptions({ source: 'xiaoyinsi', query: '公', selectedTags: [] });
    await gateway.searchUserOptions({ source: 'xiaoyinsi', term: 'ali' });

    expect(xiaoyinsiMocks.searchXiaoyinsiTags).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '公',
        credentials,
        fetcher: expect.any(Function)
      })
    );
    expect(xiaoyinsiMocks.searchXiaoyinsiUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        term: 'ali',
        credentials,
        fetcher: expect.any(Function)
      })
    );
  });

  it('[REG-XIAOYINSI-007] rechecks 小隐寺 authorization after an authenticated read returns 403', async () => {
    const refreshXiaoyinsiAuthorization = vi.fn(async () => true);
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'xiaoyinsi',
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => ({ apiKey: 'api-key', clientId: 'client-id' })),
      nodeSeekUserAgent: () => '',
      refreshXiaoyinsiAuthorization
    });
    forumMocks.getTopic.mockRejectedValueOnce(
      Object.assign(new Error('没有权限读取主题'), {
        source: 'xiaoyinsi',
        status: 403
      })
    );

    await expect(gateway.getTopic({ source: 'xiaoyinsi', id: '42' })).rejects.toMatchObject({
      kind: 'permission-denied'
    });
    expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
  });

  it('[REG-ACCOUNT-009] drops an old 小隐寺 read when authorization changes during its recheck', async () => {
    let generation = 4;
    const refreshXiaoyinsiAuthorization = vi.fn(async () => {
      generation += 1;
      return true;
    });
    const gateway = createReadGateway({
      currentXiaoyinsiCredentialGeneration: () => generation,
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'xiaoyinsi',
      loadXiaoyinsiCredentialsForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(generation);
        return { apiKey: 'old-key', clientId: 'old-client' };
      }),
      nodeSeekUserAgent: () => '',
      refreshXiaoyinsiAuthorization
    });
    forumMocks.getTopic.mockRejectedValueOnce(
      Object.assign(new Error('旧授权没有权限读取主题'), {
        source: 'xiaoyinsi',
        status: 403
      })
    );

    await expect(gateway.getTopic({ source: 'xiaoyinsi', id: '42' })).rejects.toThrow('请求已取消');
    expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-007] routes the authenticated level read through authorization recheck', async () => {
    const refreshXiaoyinsiAuthorization = vi.fn(async () => false);
    const credentials = { apiKey: 'api-key', clientId: 'client-id' };
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'xiaoyinsi',
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => credentials),
      nodeSeekUserAgent: () => '',
      refreshXiaoyinsiAuthorization
    });
    xiaoyinsiMocks.getXiaoyinsiLevelProfile.mockRejectedValueOnce(
      Object.assign(new Error('授权已失效'), {
        status: 403
      })
    );
    const trace = beginDiagnosticTrace('session', 'refresh', { source: 'xiaoyinsi' });

    await expect(gateway.getLevelProfile({ source: 'xiaoyinsi' }, { trace })).rejects.toMatchObject({
      kind: 'permission-denied'
    });
    expect(xiaoyinsiMocks.getXiaoyinsiLevelProfile).toHaveBeenCalledWith(expect.objectContaining({ credentials }));
    expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledWith(trace);
    finishDiagnosticTrace(trace, 'blocked', { source: 'xiaoyinsi', reason: 'permission_denied' });
  });

  it('[REG-XIAOYINSI-007] rechecks aggregate 小隐寺 read failures once', async () => {
    const refreshXiaoyinsiAuthorization = vi.fn(async () => true);
    const gateway = createReadGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'xiaoyinsi',
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => ({ apiKey: 'api-key', clientId: 'client-id' })),
      nodeSeekUserAgent: () => '',
      refreshXiaoyinsiAuthorization
    });
    forumMocks.getFeed.mockResolvedValue({
      items: [],
      errors: { xiaoyinsi: { kind: 'login-expired', message: '授权已失效' } },
      hasMore: false,
      nextPage: null
    });

    await gateway.getFeed({ source: 'all' });

    expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
    expect(forumMocks.getFeed).toHaveBeenCalledTimes(1);
  });
});
