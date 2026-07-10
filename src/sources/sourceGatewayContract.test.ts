import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedSource, Source } from '../types';

const forumMocks = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getCurrentUserProfile: vi.fn(),
  getFeed: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
  getReplies: vi.fn(async () => ({ items: [], hasMore: false, nextPage: null })),
  getReply: vi.fn(),
  getTopic: vi.fn(async ({ id, source }) => ({ source, id, title: '', author: '', url: '', createdAt: '', replyCount: 0, contentHtml: '', replies: [] })),
  getUserProfile: vi.fn(async ({ id, source }) => ({ source, id, username: id, displayName: id, url: '', topics: [] })),
  searchTopics: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null }))
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
    expect(forumMocks.getCategories).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.searchTopics).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getTopic).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getReplies).toHaveBeenCalledWith(expect.objectContaining({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=node', nodeSeekUserAgent: 'NodeSeek UA' }));
    expect(forumMocks.getReply).toHaveBeenCalledWith(expect.objectContaining({ source: 'linuxdo', id: 'topic-1', floor: 2, fetcher }));
    expect(forumMocks.getUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'nodeseek',
      id: 'user-1',
      fetcher,
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
