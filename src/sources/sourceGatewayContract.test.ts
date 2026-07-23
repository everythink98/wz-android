import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscourseTagOption, DiscourseUserOption, FeedResponse, Source, Topic } from '../types';
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
  getLinuxDoEmojiUrls: vi.fn(),
  searchLinuxDoSemantic: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
  searchLinuxDoTags: vi.fn(async (): Promise<DiscourseTagOption[]> => []),
  searchLinuxDoUsers: vi.fn(async (): Promise<DiscourseUserOption[]> => [])
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

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn()
}));
vi.mock('../forumApi', () => forumMocks);
vi.mock('../localLinuxdo', () => linuxDoMocks);
vi.mock('../linuxdoLevel', () => linuxDoLevelMocks);
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

  it('[REG-ACCOUNT-031] blocks a pending site before transport and isolates it from aggregate reads', async () => {
    const pendingSources = new Set<Source>(['nodeseek']);
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
    forumMocks.getFeed.mockResolvedValueOnce({
      items: [publicTopic, stalePrivateTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const gateway = createSourceGateway({
      currentSessionEpoch: () => 7,
      fetcher: vi.fn(),
      isSourceAuthenticated: () => true,
      isSourceIdentityPending: (source) => pendingSources.has(source),
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await expect(gateway.getFeed({ source: 'nodeseek' })).rejects.toThrow('登录状态待确认');
    expect(forumMocks.getFeed).not.toHaveBeenCalled();

    await expect(gateway.getFeed({ source: 'all' })).resolves.toMatchObject({
      items: [publicTopic]
    });
    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({
      source: 'all',
      unavailableSources: ['nodeseek']
    }));
  });

  it('[REG-TOPIC-027] routes emoji reads through managed credentials, fetcher, diagnostics, and cancellation', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async () => new Response('{}'));
    linuxDoMocks.getLinuxDoEmojiUrls.mockImplementationOnce(async (options) => {
      await options.fetcher?.('https://linux.do/emojis.json', { signal: options.signal });
      return { heart: 'https://linux.do/heart.png' };
    });
    const gateway = createSourceGateway({
      fetcher,
      isSourceAuthenticated: (source) => source === 'linuxdo',
      linuxDoUserAgent: () => 'LinuxDo UA',
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getEmojiUrls({ source: 'linuxdo', signal })).resolves.toEqual({
      heart: 'https://linux.do/heart.png'
    });

    expect(linuxDoMocks.getLinuxDoEmojiUrls).toHaveBeenCalledWith(expect.objectContaining({
      linuxDoAccess: { authenticated: true, userAgent: 'LinuxDo UA' },
      signal
    }));
    expect(fetcher).toHaveBeenCalledWith('https://linux.do/emojis.json', { signal });
    expect(lines.map((line) => JSON.parse(line).operation)).toEqual(expect.arrayContaining(['getEmojiUrls']));
  });

  it('records one safe partial diagnostic trace for an owned feed read', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'nodeseek',
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
    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({
      nodeSeekAuthenticated: true,
      nodeSeekUserAgent: 'NodeSeek UA'
    }));
    expect(new Set(events.map(({ traceId }) => traceId))).toHaveProperty('size', 1);
    expect(serialized).not.toContain('private-topic-id');
    expect(serialized).not.toContain('private upstream message');
  });

  it('records LinuxDo credential presence without exposing credential contents', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
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
    const gateway = createSourceGateway({
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

  it('does not probe a private Cookie snapshot before an all-source read', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getFeed({ source: 'all' })).resolves.toMatchObject({
      items: expect.any(Array),
      errors: expect.any(Object)
    });

    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'all' }));
    expect(lines.map((line) => JSON.parse(line)).find(({ phase, source }) => phase === 'credential' && source === 'all')).toMatchObject({
      source: 'all',
      hasCredential: false,
      isCredentialKnown: true
    });
  });

  it('[REG-SOURCE-001] isolates the remaining Xiaoyinsi credential-store failure to its own source', async () => {
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
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => { throw new Error('Xiaoyinsi credential store failed'); }),
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getFeed({ source: 'all' })).resolves.toMatchObject({
      items: [visibleTopic, unauthoritativeTopic],
      errors: {
        xiaoyinsi: { kind: 'ordinary', message: 'Xiaoyinsi credential store failed' }
      }
    });
    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({
      source: 'all',
      unavailableSources: ['xiaoyinsi']
    }));
    await expect(gateway.getFeed({ source: 'nodeseek' })).resolves.toBeDefined();
    await expect(gateway.getFeed({ source: 'xiaoyinsi' })).rejects.toThrow('Xiaoyinsi credential store failed');
  });

  it('adds gateway stages without finishing a caller-owned trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const trace = beginDiagnosticTrace('feed', 'refresh', { source: 'v2ex' });
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
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
      fetcher: vi.fn(),
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
      fetcher: vi.fn(),
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
      fetcher: vi.fn(),
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
      fetcher: vi.fn(),
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
      fetcher: vi.fn(),
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

  it('[REG-LINUXDO-005] preserves the confirmed-auth decision through the managed gateway', async () => {
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
      isSourceAuthenticated: (source) => source === 'linuxdo',
      linuxDoUserAgent: () => 'linux.do UA',
      nodeSeekUserAgent: () => ''
    });

    await gateway.searchTopics({
      source: 'linuxdo',
      query: 'codex'
    });

    expect(forumMocks.searchTopics).toHaveBeenCalledWith(expect.objectContaining({
      source: 'linuxdo',
      query: 'codex',
      linuxDoAuthenticated: true,
      discourseAuth: {
        linuxdo: {
          authenticated: true,
          userAgent: 'linux.do UA'
        }
      }
    }));
  });

  it('keeps linux.do search candidates and AI reads behind the managed gateway', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const fetcher = vi.fn();
    const gateway = createSourceGateway({
      fetcher,
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

  it('owns NodeSeek identity, session epoch, user agent, and transport for every read path', async () => {
    const fetcher = vi.fn();
    const currentSessionEpoch = vi.fn(() => 4);
    const gateway = createSourceGateway({
      currentSessionEpoch,
      fetcher,
      isSourceAuthenticated: (source) => source === 'nodeseek',
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await gateway.getCategories({ source: 'nodeseek' });
    await gateway.getFeed({ source: 'nodeseek' });
    await gateway.searchTopics({ source: 'nodeseek', query: 'codex' });
    await gateway.getTopic({ source: 'nodeseek', id: 'topic-1' });
    await gateway.getReplies({ source: 'nodeseek', id: 'topic-1', page: 1 });
    await gateway.getReply({ source: 'linuxdo', id: 'topic-1', floor: 2 });
    await gateway.getUserProfile({ source: 'nodeseek', id: 'user-1' });

    expect(currentSessionEpoch).toHaveBeenCalledWith('nodeseek');
    expect(forumMocks.getCategories).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekAuthenticated: true, nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekAuthenticated: true, nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.searchTopics).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekAuthenticated: true, nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getTopic).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekAuthenticated: true, nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getReplies).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher: expect.any(Function), nodeSeekAuthenticated: true, nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getReply).toHaveBeenCalledWith(expect.objectContaining({ source: 'linuxdo', id: 'topic-1', floor: 2, fetcher: expect.any(Function) }));
    expect(forumMocks.getUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'nodeseek',
      id: 'user-1',
      fetcher: expect.any(Function),
      nodeSeekAuthenticated: true,
      nodeSeekUserAgent: 'NodeSeek UA'
    }));
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
      const gateway = createSourceGateway({
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

  it('[REG-ACCOUNT-026] returns typed Yaohuo expiry without invoking a logout command', async () => {
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
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
  });

  it('REG-ACCOUNT-009 cancels an expired Yaohuo read when a newer credential takes ownership', async () => {
    let generation = 7;
    const response = Promise.withResolvers<never>();
    const gateway = createSourceGateway({
      currentSessionEpoch: () => generation,
      fetcher: vi.fn(),
      isSourceAuthenticated: () => true,
      nodeSeekUserAgent: () => ''
    });
    forumMocks.getUserProfile.mockReturnValueOnce(response.promise);

    const read = gateway.getUserProfile({ source: 'yaohuo', id: '7' });
    await vi.waitFor(() => expect(forumMocks.getUserProfile).toHaveBeenCalledTimes(1));
    generation += 1;
    response.reject(Object.assign(new Error('旧妖火登录已失效'), {
      loginRequired: true,
      reason: 'expired',
      source: 'yaohuo'
    }));

    await expect(read).rejects.toThrow('请求已取消');
  });

  it('[REG-ACCOUNT-026] cannot invoke a failing Yaohuo logout command during a read', async () => {
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
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
  });

  it('surfaces a Yaohuo verification-required error without mutating session state', async () => {
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
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
  });

  it('routes 小隐寺 search candidates with its independent User API credentials', async () => {
    const credentials = { apiKey: 'secret-key', clientId: 'install-client' };
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
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
      fetcher: vi.fn(),
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

  it('[REG-ACCOUNT-009] drops an old 小隐寺 read when authorization changes during its recheck', async () => {
    let generation = 4;
    const refreshXiaoyinsiAuthorization = vi.fn(async () => {
      generation += 1;
      return true;
    });
    const gateway = createSourceGateway({
      currentXiaoyinsiCredentialGeneration: () => generation,
      fetcher: vi.fn(),
      loadXiaoyinsiCredentialsForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(generation);
        return { apiKey: 'old-key', clientId: 'old-client' };
      }),
      nodeSeekUserAgent: () => '',
      refreshXiaoyinsiAuthorization
    });
    forumMocks.getTopic.mockRejectedValueOnce(Object.assign(new Error('旧授权没有权限读取主题'), {
      source: 'xiaoyinsi',
      status: 403
    }));

    await expect(gateway.getTopic({ source: 'xiaoyinsi', id: '42' })).rejects.toThrow('请求已取消');
    expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-007] routes the authenticated level read through authorization recheck', async () => {
    const refreshXiaoyinsiAuthorization = vi.fn(async () => false);
    const credentials = { apiKey: 'api-key', clientId: 'client-id' };
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
      loadXiaoyinsiCredentialsForSource: vi.fn(async () => credentials),
      nodeSeekUserAgent: () => '',
      refreshXiaoyinsiAuthorization
    });
    xiaoyinsiMocks.getXiaoyinsiLevelProfile.mockRejectedValueOnce(Object.assign(new Error('授权已失效'), {
      status: 403
    }));
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
    const gateway = createSourceGateway({
      fetcher: vi.fn(),
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
