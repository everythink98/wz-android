import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedResponse, FeedSource, Source } from '../types';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage, setDiagnosticWriter } from '../diagnostics';
import { annotateSourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import { REQUEST_CANCELED_MESSAGE, REQUEST_SUPERSEDED_MESSAGE, REQUEST_TIMEOUT_MESSAGE } from '../request';

const forumMocks = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getCurrentUserProfile: vi.fn(),
  getFeed: vi.fn(async (_options?: { signal?: AbortSignal }): Promise<FeedResponse> => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
  getReplies: vi.fn(async () => ({ items: [], hasMore: false, nextPage: null })),
  getReply: vi.fn(),
  getTopic: vi.fn(async ({ id, source }) => ({ source, id, title: '', author: '', url: '', createdAt: '', replyCount: 0, contentHtml: '', replies: [] })),
  getUserProfile: vi.fn(async ({ id, source }) => ({ source, id, username: id, displayName: id, url: '', topics: [] })),
  searchTopics: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null }))
}));

const yaohuoMocks = vi.hoisted(() => ({
  checkYaohuoLoginDirect: vi.fn(),
  getYaohuoFeedDirect: vi.fn(async (_options: {
    signal?: AbortSignal;
    yaohuoFetcher: (input: string, init?: RequestInit) => Promise<Response>;
  }) => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
  getYaohuoRepliesDirect: vi.fn(),
  getYaohuoTopicDirect: vi.fn(),
  searchYaohuoDirect: vi.fn()
}));

vi.mock('@react-native-cookies/cookies', () => ({
  default: { clearByName: vi.fn(), flush: vi.fn(), get: vi.fn(async () => ({})) }
}));
vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn()
}));
vi.mock('react-native', () => ({ NativeModules: { LinuxDoCookieModule: {} } }));

vi.mock('../forumApi', () => forumMocks);
vi.mock('../yaohuoApi', () => yaohuoMocks);

import { createSourceGateway, getFeed, getReplies, getTopic, getUserProfile, searchTopics } from './sourceGateway';

describe('source gateway read contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('records one safe partial diagnostic trace for an owned feed read', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const loadNodeSeekCookieForSource = vi.fn(async () => 'session=diagnostic-secret');
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource,
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });
    forumMocks.getFeed.mockResolvedValueOnce({
      items: [{
        source: 'nodeseek',
        id: 'private-topic-id',
        title: 'private title',
        author: 'private author',
        url: 'https://www.nodeseek.com/private-topic-id',
        createdAt: '2026-07-10T00:00:00.000Z',
        replyCount: 0
      }],
      errors: { linuxdo: { kind: 'ordinary', message: 'private upstream message' } },
      hasMore: true,
      nextPage: 2
    });

    await gateway.getFeed({ source: 'nodeseek' });

    const serialized = lines.join('');
    const events = lines.map((line) => JSON.parse(line));
    expect(events.map(({ phase }) => phase)).toEqual([
      'intent',
      'credential',
      'transport',
      'parse',
      'finish'
    ]);
    expect(events.at(-2)).toMatchObject({
      phase: 'parse',
      itemCount: 1,
      partialErrorCount: 1,
      hasMore: true
    });
    expect(events.at(-1)).toMatchObject({ phase: 'finish', outcome: 'partial' });
    expect(events.find(({ phase }) => phase === 'transport')).toMatchObject({ channel: 'direct', state: 'start' });
    expect(loadNodeSeekCookieForSource).toHaveBeenCalledWith('nodeseek', {
      diagnosticTrace: expect.objectContaining({ traceId: events[0].traceId })
    });
    expect(new Set(events.map(({ traceId }) => traceId))).toHaveProperty('size', 1);
    expect(serialized).not.toContain('diagnostic-secret');
    expect(serialized).not.toContain('private-topic-id');
    expect(serialized).not.toContain('private upstream message');
  });

  it('adds gateway stages without finishing a caller-owned trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const trace = beginDiagnosticTrace('feed', 'refresh', { source: 'v2ex' });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });

    await gateway.getFeed({ source: 'v2ex' }, { trace });

    expect(lines.map((line) => JSON.parse(line).phase)).toEqual([
      'intent',
      'credential',
      'transport',
      'parse'
    ]);
    finishDiagnosticTrace(trace, 'success');
    expect(lines.map((line) => JSON.parse(line).phase).filter((phase) => phase === 'finish')).toHaveLength(1);
  });

  it.each<Exclude<FeedSource, 'all'>>(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo'])(
    'ends a hung %s managed read at the shared operation deadline',
    async (source) => {
      vi.useFakeTimers();
      let operationSignal: AbortSignal | undefined;
      const pendingRead = (options?: { signal?: AbortSignal }) => {
        operationSignal = options?.signal;
        return new Promise<never>(() => undefined);
      };
      if (source === 'yaohuo') {
        yaohuoMocks.getYaohuoFeedDirect.mockImplementationOnce(pendingRead);
      } else {
        forumMocks.getFeed.mockImplementationOnce(pendingRead);
      }
      const gateway = createSourceGateway({
        clearYaohuoLoginState: vi.fn(async () => undefined),
        fetcher: vi.fn(),
        loadNodeSeekCookieForSource: vi.fn(async () => undefined),
        loadYaohuoCookieForSource: vi.fn(async () => source === 'yaohuo' ? 'sidyaohuo=valid' : undefined),
        nodeSeekUserAgent: () => ''
      });

      try {
        let settled = false;
        const outcome = gateway.getFeed({ source })
          .then(() => undefined, (error: unknown) => error)
          .finally(() => { settled = true; });

        await vi.advanceTimersByTimeAsync(29_999);
        expect(settled).toBe(false);
        expect(operationSignal?.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(outcome).resolves.toMatchObject({ message: REQUEST_TIMEOUT_MESSAGE });
        expect(operationSignal?.aborted).toBe(true);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    }
  );

  it('finishes exactly one timeout trace even when the adapter ignores abort forever', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    forumMocks.getFeed.mockImplementationOnce(async () => new Promise<never>(() => undefined));
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });

    try {
      const outcome = gateway.getFeed({ source: 'v2ex' });
      const assertion = expect(outcome).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;

      const terminal = lines
        .map((line) => JSON.parse(line))
        .filter(({ phase }) => phase === 'finish');
      expect(terminal).toEqual([
        expect.objectContaining({ outcome: 'failure', reason: 'timeout' })
      ]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not start a late adapter after credential loading outlives the deadline', async () => {
    vi.useFakeTimers();
    const credential = Promise.withResolvers<string | undefined>();
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(() => credential.promise),
      nodeSeekUserAgent: () => ''
    });

    try {
      const outcome = gateway.getFeed({ source: 'yaohuo' });
      const assertion = expect(outcome).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;

      credential.resolve('sidyaohuo=late');
      await Promise.resolve();
      await Promise.resolve();
      expect(yaohuoMocks.getYaohuoFeedDirect).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps caller abort distinct from the managed operation deadline', async () => {
    const controller = new AbortController();
    let operationSignal: AbortSignal | undefined;
    forumMocks.getFeed.mockImplementationOnce(async (options?: { signal?: AbortSignal }) => {
      operationSignal = options?.signal;
      return new Promise<never>(() => undefined);
    });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });

    const outcome = gateway.getFeed({ source: 'v2ex', signal: controller.signal });
    await vi.waitFor(() => expect(operationSignal).toBeDefined());
    controller.abort();

    await expect(outcome).rejects.toThrow(REQUEST_CANCELED_MESSAGE);
    expect(operationSignal?.aborted).toBe(true);
  });

  it('classifies an unexpected HTTP-success parse-empty adapter result as a failure', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getFeed.mockResolvedValueOnce(annotateSourceDiagnosticSummary({
      items: [], errors: {}, hasMore: false, nextPage: null
    }, {
      parserVariant: 'rendered-list',
      candidateCount: 2,
      validCount: 0,
      droppedCount: 2,
      isExpectedEmpty: false
    }));

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

  it('uses the structured source classification for an owned HTTP auth failure trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => 'session=old'),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getFeed.mockRejectedValueOnce(Object.assign(new Error('request failed'), { status: 401 }));

    await expect(gateway.getFeed({ source: 'nodeseek' })).rejects.toMatchObject({ kind: 'login-expired' });

    expect(lines.map((line) => JSON.parse(line)).at(-1)).toMatchObject({
      phase: 'finish',
      outcome: 'blocked',
      reason: 'login_required'
    });
  });

  it('does not report a legal empty search page as parse-empty', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.searchTopics.mockResolvedValueOnce(annotateSourceDiagnosticSummary({
      items: [], errors: {}, hasMore: false, nextPage: null
    }, {
      parserVariant: 'sov2ex-search',
      candidateCount: 0,
      validCount: 0,
      droppedCount: 0,
      isExpectedEmpty: true
    }));

    await gateway.searchTopics({ source: 'v2ex', query: 'no-result' });

    const events = lines.map((line) => JSON.parse(line));
    expect(events.at(-2)).toMatchObject({ phase: 'parse', isExpectedEmpty: true });
    expect(events.at(-2).isParseEmpty).not.toBe(true);
    expect(events.at(-1)).toMatchObject({ phase: 'finish', outcome: 'success' });
  });

  it('defers a caller-owned parse-empty terminal until controller apply and upgrades success to failure', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const trace = beginDiagnosticTrace('feed', 'load', { source: 'nodeseek' });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getFeed.mockResolvedValueOnce(annotateSourceDiagnosticSummary({
      items: [], errors: {}, hasMore: false, nextPage: null
    }, {
      parserVariant: 'embedded-list',
      candidateCount: 1,
      validCount: 0,
      droppedCount: 1,
      isExpectedEmpty: false
    }));

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
    setDiagnosticWriter((line) => { lines.push(line); });
    const trace = beginDiagnosticTrace('user', 'open', { source: 'v2ex' });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockResolvedValueOnce(annotateSourceDiagnosticSummary({
      source: 'v2ex', id: 'user', username: 'user', displayName: 'user', url: '', topics: []
    }, {
      parserVariant: 'api-user',
      candidateCount: 1,
      validCount: 1,
      droppedCount: 0,
      partialErrorCount: 1,
      hasDegradation: true
    }));

    await gateway.getUserProfile({ source: 'v2ex', id: 'user' }, { trace });
    markDiagnosticStage(trace, 'apply', { itemCount: 1 });
    finishDiagnosticTrace(trace, 'success');

    const terminal = lines.map((line) => JSON.parse(line)).filter(({ phase }) => phase === 'finish');
    expect(terminal).toEqual([expect.objectContaining({ outcome: 'partial' })]);
  });

  it.each<Source>(['v2ex', 'linuxdo', 'nodeseek'])('keeps all five reads behind the gateway for %s', async (source) => {
    await getFeed({ source });
    await searchTopics({ source, query: 'codex' });
    await getTopic({ source, id: 'topic-1' });
    await getReplies({ source, id: 'topic-1', page: 1 });
    await getUserProfile({ source, id: 'user-1' });

    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ source }));
    expect(forumMocks.searchTopics).toHaveBeenCalledWith(expect.objectContaining({ source, query: 'codex' }));
    expect(forumMocks.getTopic).toHaveBeenCalledWith(expect.objectContaining({ source, id: 'topic-1' }));
    expect(forumMocks.getReplies).toHaveBeenCalledWith(expect.objectContaining({ source, id: 'topic-1' }));
    expect(forumMocks.getUserProfile).toHaveBeenCalledWith(expect.objectContaining({ source, id: 'user-1' }));
  });

  it('owns NodeSeek credentials, user agent, and transport for every read path', async () => {
    const fetcher = vi.fn();
    const loadNodeSeekCookieForSource = vi.fn(async () => 'session=node');
    const loadYaohuoCookieForSource = vi.fn(async () => undefined);
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher,
      loadNodeSeekCookieForSource,
      loadYaohuoCookieForSource,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await gateway.getCategories({ source: 'nodeseek' });
    await gateway.getFeed({ source: 'nodeseek' });
    await gateway.searchTopics({ source: 'nodeseek', query: 'codex' });
    await gateway.getTopic({ source: 'nodeseek', id: 'topic-1' });
    await gateway.getReplies({ source: 'nodeseek', id: 'topic-1', page: 1 });
    await gateway.getReply({ source: 'linuxdo', id: 'topic-1', floor: 2 });
    await gateway.getUserProfile({ source: 'nodeseek', id: 'user-1' });

    expect(loadNodeSeekCookieForSource).toHaveBeenCalledTimes(6);
    expect(loadYaohuoCookieForSource).not.toHaveBeenCalled();
    expect(forumMocks.getCategories).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.searchTopics).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getTopic).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getReplies).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getReply).toHaveBeenCalledWith(expect.objectContaining({ source: 'linuxdo', id: 'topic-1', floor: 2, fetcher: expect.any(Function) }));
    expect(forumMocks.getUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'nodeseek',
      id: 'user-1',
      fetcher: expect.any(Function),
      nodeSeekCookie: 'session=node',
      nodeSeekUserAgent: 'NodeSeek UA'
    }));
  });

  it('prevents React Native from attaching WebView cookies to an anonymous Yaohuo read', async () => {
    const fetcher = vi.fn(async () => new Response(''));
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher,
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });
    yaohuoMocks.getYaohuoFeedDirect.mockImplementationOnce(async ({ yaohuoFetcher }) => {
      await yaohuoFetcher('https://www.yaohuo.me/bbs/book_list.aspx');
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });

    await gateway.getFeed({ source: 'yaohuo' });

    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_list.aspx',
      expect.objectContaining({ credentials: 'omit' })
    );
  });

  it('does not expose a credential result after Yaohuo suppression starts during storage read', async () => {
    const credential = Promise.withResolvers<string | undefined>();
    let suppressed = false;
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      isYaohuoCredentialSuppressed: () => suppressed,
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(() => credential.promise),
      nodeSeekUserAgent: () => ''
    });

    const result = gateway.getFeedIfCredentialed({ source: 'yaohuo' });
    suppressed = true;
    credential.resolve('sidyaohuo=real');

    await expect(result).resolves.toBeNull();
  });

  it('clears only the Yaohuo credential generation used by an expired user profile read', async () => {
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const loadYaohuoCookieForSource = vi.fn(async (
      _source: FeedSource,
      options?: { captureGeneration?: (generation: number) => void }
    ) => {
      options?.captureGeneration?.(7);
      return 'sidyaohuo=expired';
    });
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource,
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockRejectedValueOnce(Object.assign(new Error('妖火登录已失效'), {
      loginRequired: true,
      reason: 'expired',
      source: 'yaohuo'
    }));

    await expect(gateway.getUserProfile({ source: 'yaohuo', id: '7' })).rejects.toMatchObject({
      kind: 'login-expired',
      message: '妖火登录已失效'
    });
    expect(clearYaohuoLoginState).toHaveBeenCalledWith(expect.objectContaining({ generation: 7 }));
  });

  it('keeps the original login-expired error when automatic Yaohuo cleanup fails', async () => {
    const clearYaohuoLoginState = vi.fn(async () => {
      throw new Error('cleanup failed');
    });
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(7);
        return 'sidyaohuo=expired';
      }),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockRejectedValueOnce(Object.assign(new Error('妖火登录已失效'), {
      loginRequired: true,
      reason: 'expired',
      source: 'yaohuo'
    }));

    await expect(gateway.getUserProfile({ source: 'yaohuo', id: '7' })).rejects.toMatchObject({
      kind: 'login-expired',
      message: '妖火登录已失效'
    });
    expect(clearYaohuoLoginState).toHaveBeenCalledWith(expect.objectContaining({ generation: 7 }));
  });

  it('drops an expired Yaohuo result when a newer credential operation supersedes cleanup', async () => {
    const clearYaohuoLoginState = vi.fn(async () => false);
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(7);
        return 'sidyaohuo=expired';
      }),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockRejectedValueOnce(Object.assign(new Error('妖火登录已失效'), {
      loginRequired: true,
      reason: 'expired',
      source: 'yaohuo'
    }));

    await expect(gateway.getUserProfile({ source: 'yaohuo', id: '7' }))
      .rejects.toThrow(REQUEST_SUPERSEDED_MESSAGE);
  });

  it('does not clear Yaohuo credentials for a stale expired read', async () => {
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => 'sidyaohuo=stale'),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockRejectedValueOnce(Object.assign(new Error('妖火登录已失效'), {
      loginRequired: true,
      reason: 'expired',
      source: 'yaohuo'
    }));

    await expect(gateway.getUserProfile(
      { source: 'yaohuo', id: '7' },
      { isCurrent: () => false }
    )).rejects.toMatchObject({ kind: 'login-expired' });
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
  });

  it('does not clear a real Yaohuo credential when anonymous mode starts during a read', async () => {
    const read = Promise.withResolvers<never>();
    let suppressed = false;
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher: vi.fn(),
      isYaohuoCredentialSuppressed: () => suppressed,
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => 'sidyaohuo=real'),
      nodeSeekUserAgent: () => ''
    });
    yaohuoMocks.getYaohuoFeedDirect.mockReturnValueOnce(read.promise);

    const result = gateway.getFeed({ source: 'yaohuo' });
    await vi.waitFor(() => expect(yaohuoMocks.getYaohuoFeedDirect).toHaveBeenCalled());
    suppressed = true;
    read.reject(Object.assign(new Error('妖火登录已失效'), {
      loginRequired: true,
      reason: 'expired',
      source: 'yaohuo'
    }));

    await expect(result).rejects.toMatchObject({ kind: 'login-expired' });
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
  });

  it('does not return an authenticated Yaohuo result after anonymous mode starts', async () => {
    const read = Promise.withResolvers<{ items: []; errors: {}; hasMore: false; nextPage: null }>();
    let suppressed = false;
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      isYaohuoCredentialSuppressed: () => suppressed,
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => 'sidyaohuo=real'),
      nodeSeekUserAgent: () => ''
    });
    yaohuoMocks.getYaohuoFeedDirect.mockReturnValueOnce(read.promise);

    const result = gateway.getFeed({ source: 'yaohuo' });
    await vi.waitFor(() => expect(yaohuoMocks.getYaohuoFeedDirect).toHaveBeenCalled());
    suppressed = true;
    read.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });

    await expect(result).rejects.toThrow('请求已取消');
  });

  it('keeps Yaohuo credentials while surfacing a verification-required user profile error', async () => {
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher: vi.fn(),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => 'sidyaohuo=verify'),
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockRejectedValueOnce(Object.assign(new Error('妖火需要完成访问验证'), {
      loginRequired: true,
      reason: 'verification',
      source: 'yaohuo',
      verificationRequired: true
    }));

    await expect(gateway.getUserProfile({ source: 'yaohuo', id: '7' })).rejects.toMatchObject({
      kind: 'verification-required',
      message: '妖火需要完成访问验证'
    });
    expect(clearYaohuoLoginState).not.toHaveBeenCalled();
  });
});
