import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscourseTagOption, DiscourseUserOption, FeedResponse, FeedSource, Source, Topic } from '../types';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage, setDiagnosticWriter } from '../diagnostics';
import { annotateSourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import { getYaohuoTopicDirect } from '../yaohuoApi';

const forumMocks = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getCurrentUserProfile: vi.fn(),
  getFeed: vi.fn(async (): Promise<FeedResponse> => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
  getReplies: vi.fn(async () => ({ items: [], hasMore: false, nextPage: null })),
  getReply: vi.fn(),
  getTopic: vi.fn(async ({ id, source }) => ({ source, id, title: '', author: '', url: '', createdAt: '', replyCount: 0, contentHtml: '', replies: [] })),
  getUserProfile: vi.fn(async ({ id, source }) => ({ source, id, username: id, displayName: id, url: '', topics: [] })),
  searchTopics: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null }))
}));
const linuxDoMocks = vi.hoisted(() => ({
  searchLinuxDoSemantic: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
  searchLinuxDoTags: vi.fn(async (): Promise<DiscourseTagOption[]> => []),
  searchLinuxDoUsers: vi.fn(async (): Promise<DiscourseUserOption[]> => [])
}));
const xiaoyinsiMocks = vi.hoisted(() => ({
  searchXiaoyinsiTags: vi.fn(async (): Promise<DiscourseTagOption[]> => []),
  searchXiaoyinsiUsers: vi.fn(async (): Promise<DiscourseUserOption[]> => [])
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
vi.mock('../localLinuxdo', () => linuxDoMocks);
vi.mock('../localXiaoyinsi', () => xiaoyinsiMocks);
vi.mock('../yaohuoApi', () => ({
  checkYaohuoLoginDirect: vi.fn(),
  getYaohuoFeedDirect: vi.fn(),
  getYaohuoRepliesDirect: vi.fn(),
  getYaohuoTopicDirect: vi.fn(),
  searchYaohuoDirect: vi.fn()
}));

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
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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

  it('records LinuxDo credential presence without exposing credential contents', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const hasLinuxDoCredentialForSource = vi.fn(async () => true);
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource,
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });

    await gateway.searchTagOptions({ source: 'linuxdo' });

    const events = lines.map((line) => JSON.parse(line));
    expect(hasLinuxDoCredentialForSource).toHaveBeenCalledWith('linuxdo', {
      diagnosticTrace: expect.objectContaining({ traceId: events[0].traceId })
    });
    expect(events.find(({ phase }) => phase === 'credential')).toMatchObject({
      source: 'linuxdo',
      hasCredential: true
    });
    expect(lines.join('')).not.toContain('cookieHeader');
  });

  it('does not let a LinuxDo credential diagnostic probe block an all-source read', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => {
        throw new Error('storage read failed');
      }),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getFeed({ source: 'all' })).resolves.toMatchObject({ items: [] });

    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'all' }));
    expect(lines.map((line) => JSON.parse(line)).find(({ phase }) => phase === 'credential')).toMatchObject({
      source: 'all',
      hasCredential: false,
      isCredentialKnown: false,
      reason: 'storage_error'
    });
  });

  it('adds gateway stages without finishing a caller-owned trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const trace = beginDiagnosticTrace('feed', 'refresh', { source: 'v2ex' });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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

  it('classifies an unexpected HTTP-success parse-empty adapter result as a failure', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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

  it('does not report a legal empty search page as parse-empty', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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

  it('marks a Yaohuo topic trace partial when optional favorite state is unavailable', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
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
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => 'sidyaohuo=secret'),
      nodeSeekUserAgent: () => ''
    });
    vi.mocked(getYaohuoTopicDirect).mockResolvedValueOnce(annotateSourceDiagnosticSummary({
      ...topic,
      contentHtml: '<p>private body</p>',
      replies: []
    }, {
      parserVariant: 'html-topic-with-replies',
      candidateCount: 1,
      validCount: 1,
      droppedCount: 0,
      partialErrorCount: 1,
      hasDegradation: true
    }));

    await gateway.getTopic({ source: 'yaohuo', id: topic.id, topic }, { trace });
    markDiagnosticStage(trace, 'apply', { itemCount: 1 });
    finishDiagnosticTrace(trace, 'success');

    const serialized = lines.join('');
    const terminal = lines.map((line) => JSON.parse(line)).filter(({ phase }) => phase === 'finish');
    expect(terminal).toEqual([expect.objectContaining({ outcome: 'partial' })]);
    expect(serialized).not.toMatch(/private-topic-id|private title|private author|private body|yaohuo\.me|sidyaohuo=secret/);
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

  it('keeps linux.do search candidates and AI reads behind the managed gateway', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const fetcher = vi.fn();
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher,
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
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

    expect(linuxDoMocks.searchLinuxDoTags).toHaveBeenCalledWith(expect.objectContaining({
      query: '人', categoryId: '4', selectedTags: ['快问快答'], fetcher: expect.any(Function)
    }));
    expect(linuxDoMocks.searchLinuxDoUsers).toHaveBeenCalledWith(expect.objectContaining({
      term: 'ali', categoryId: '4', fetcher: expect.any(Function)
    }));
    expect(linuxDoMocks.searchLinuxDoSemantic).toHaveBeenCalledWith('AI tags:人工智能', expect.objectContaining({ fetcher: expect.any(Function) }));
    const tagEvents = lines.map((line) => JSON.parse(line)).filter(({ traceId }) => traceId === tagTrace.traceId);
    expect(tagEvents.map(({ phase }) => phase)).toEqual(['intent', 'credential', 'transport', 'parse', 'apply', 'finish']);
    expect(tagEvents.find(({ phase }) => phase === 'parse')).toMatchObject({ itemCount: 1 });
    expect(new Set(tagEvents.map(({ traceId }) => traceId))).toHaveProperty('size', 1);
    expect(lines.join('')).not.toContain('快问快答');
    expect(lines.join('')).not.toContain('AI tags:人工智能');
  });

  it('owns NodeSeek credentials, user agent, and transport for every read path', async () => {
    const fetcher = vi.fn();
    const loadNodeSeekCookieForSource = vi.fn(async () => 'session=node');
    const loadYaohuoCookieForSource = vi.fn(async () => undefined);
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher,
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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
    expect(clearYaohuoLoginState).toHaveBeenCalledWith({ generation: 7 });
  });

  it('does not clear Yaohuo credentials for a stale expired read', async () => {
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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

  it('keeps Yaohuo credentials while surfacing a verification-required user profile error', async () => {
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const gateway = createSourceGateway({
      clearYaohuoLoginState,
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
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

  it('routes 小隐寺 search candidates with its independent User API credentials', async () => {
    const credentials = { apiKey: 'secret-key', clientId: 'install-client' };
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => credentials),
      nodeSeekUserAgent: () => ''
    });
    xiaoyinsiMocks.searchXiaoyinsiTags.mockResolvedValueOnce([{ name: '公告' }]);

    await gateway.searchTagOptions({ source: 'xiaoyinsi', query: '公', selectedTags: [] });
    await gateway.searchUserOptions({ source: 'xiaoyinsi', term: 'ali' });

    expect(xiaoyinsiMocks.searchXiaoyinsiTags).toHaveBeenCalledWith(expect.objectContaining({
      query: '公', credentials, fetcher: expect.any(Function)
    }));
    expect(xiaoyinsiMocks.searchXiaoyinsiUsers).toHaveBeenCalledWith(expect.objectContaining({
      term: 'ali', credentials, fetcher: expect.any(Function)
    }));
  });

  it('[REG-XIAOYINSI-007] rechecks 小隐寺 authorization after an authenticated read returns 403', async () => {
    const refreshXiaoyinsiAuthorization = vi.fn(async () => true);
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => ({ apiKey: 'api-key', clientId: 'client-id' })),
      nodeSeekUserAgent: () => '',
      refreshXiaoyinsiAuthorization
    });
    forumMocks.getTopic.mockRejectedValueOnce(Object.assign(new Error('没有权限读取主题'), {
      source: 'xiaoyinsi',
      status: 403
    }));

    await expect(gateway.getTopic({ source: 'xiaoyinsi', id: '42' })).rejects.toMatchObject({
      kind: 'permission-denied'
    });
    expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-007] rechecks aggregate 小隐寺 read failures but ignores stale reads', async () => {
    const refreshXiaoyinsiAuthorization = vi.fn(async () => true);
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(),
      hasLinuxDoCredentialForSource: vi.fn(async () => false),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
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
    await gateway.getFeed({ source: 'all' }, { isCurrent: () => false });

    expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
  });
});
