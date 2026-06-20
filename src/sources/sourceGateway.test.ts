import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '../request';
import type { LinuxDoActionRequest } from '../linuxdoActions';
import type { NodeSeekActionRequest } from '../nodeseekActions';
import type {
  CategoriesResponse,
  FeedResponse,
  Reply,
  RepliesResponse,
  SearchResponse,
  Topic,
  TopicDetail,
  UserProfile
} from '../types';
import type { YaohuoActionRequest } from '../yaohuoActions';

const forumApi = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getFeed: vi.fn(),
  getReply: vi.fn(),
  getReplies: vi.fn(),
  getTopic: vi.fn(),
  getUserProfile: vi.fn(),
  searchTopics: vi.fn()
}));
const linuxDoActionClient = vi.hoisted(() => ({
  checkLinuxDoLoginAccess: vi.fn(),
  runLinuxDoAction: vi.fn()
}));
const linuxDoLevel = vi.hoisted(() => ({
  getLinuxDoLevelProfile: vi.fn()
}));
const nodeSeekActionClient = vi.hoisted(() => ({
  runNodeSeekAction: vi.fn()
}));
const yaohuoApi = vi.hoisted(() => ({
  checkYaohuoLoginDirect: vi.fn(),
  getYaohuoFeedDirect: vi.fn(),
  getYaohuoRepliesDirect: vi.fn(),
  getYaohuoTopicDirect: vi.fn(),
  searchYaohuoDirect: vi.fn()
}));
const yaohuoActionClient = vi.hoisted(() => ({
  runYaohuoAction: vi.fn()
}));

vi.mock('../forumApi', () => forumApi);
vi.mock('../linuxdoActionClient', () => linuxDoActionClient);
vi.mock('../linuxdoLevel', () => linuxDoLevel);
vi.mock('../nodeseekActionClient', () => nodeSeekActionClient);
vi.mock('../yaohuoApi', () => yaohuoApi);
vi.mock('../yaohuoActionClient', () => yaohuoActionClient);

import {
  checkLinuxDoLoginAccess,
  checkYaohuoLogin,
  getCategories,
  getFeed,
  getLinuxDoLevelProfile,
  getReply,
  getReplies,
  getTopic,
  getYaohuoFeed,
  getYaohuoReplies,
  getYaohuoTopic,
  getUserProfile,
  runLinuxDoAction,
  runNodeSeekAction,
  runYaohuoAction,
  searchYaohuoTopics,
  searchTopics
} from './sourceGateway';

const fetcherMock = vi.fn();
const fetcher = fetcherMock as unknown as Fetcher;
const signal = new AbortController().signal;

const topic: Topic = {
  source: 'nodeseek',
  id: 'topic-1',
  title: 'Topic',
  author: 'Alice',
  url: 'https://www.nodeseek.com/post-1-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  replyCount: 2
};

const reply: Reply = {
  author: 'Bob',
  contentHtml: '<p>Reply</p>',
  createdAt: '2026-01-01T00:01:00.000Z'
};

describe('sourceGateway', () => {
  beforeEach(() => {
    forumApi.getCategories.mockReset();
    forumApi.getFeed.mockReset();
    forumApi.getReply.mockReset();
    forumApi.getReplies.mockReset();
    forumApi.getTopic.mockReset();
    forumApi.getUserProfile.mockReset();
    forumApi.searchTopics.mockReset();
    linuxDoActionClient.checkLinuxDoLoginAccess.mockReset();
    linuxDoActionClient.runLinuxDoAction.mockReset();
    linuxDoLevel.getLinuxDoLevelProfile.mockReset();
    nodeSeekActionClient.runNodeSeekAction.mockReset();
    yaohuoApi.checkYaohuoLoginDirect.mockReset();
    yaohuoApi.getYaohuoFeedDirect.mockReset();
    yaohuoApi.getYaohuoRepliesDirect.mockReset();
    yaohuoApi.getYaohuoTopicDirect.mockReset();
    yaohuoApi.searchYaohuoDirect.mockReset();
    yaohuoActionClient.runYaohuoAction.mockReset();
    fetcherMock.mockReset();
  });

  it('forwards getFeed to forumApi unchanged', async () => {
    const response: FeedResponse = { items: [topic], errors: {}, hasMore: false, nextPage: null };
    const options = {
      source: 'nodeseek' as const,
      page: 2,
      limit: 30,
      cursor: 'cursor',
      category: 'dev',
      nocache: true,
      fetcher,
      nodeSeekCookie: 'cookie',
      nodeSeekUserAgent: 'agent',
      signal,
      timeoutMs: 1000
    };
    forumApi.getFeed.mockResolvedValue(response);

    await expect(getFeed(options)).resolves.toBe(response);

    expect(forumApi.getFeed).toHaveBeenCalledWith(options);
  });

  it('forwards getCategories to forumApi unchanged', async () => {
    const response: CategoriesResponse = { items: [{ source: 'nodeseek', id: 'dev', name: 'Dev' }], errors: {} };
    const options = {
      source: 'all' as const,
      nocache: true,
      fetcher,
      nodeSeekCookie: 'cookie',
      nodeSeekUserAgent: 'agent',
      signal,
      timeoutMs: 1000
    };
    forumApi.getCategories.mockResolvedValue(response);

    await expect(getCategories(options)).resolves.toBe(response);

    expect(forumApi.getCategories).toHaveBeenCalledWith(options);
  });

  it('forwards getTopic to forumApi unchanged', async () => {
    const response: TopicDetail = { ...topic, contentHtml: '<p>Topic</p>', replies: [reply] };
    const options = {
      source: 'nodeseek' as const,
      id: 'topic-1',
      fetcher,
      nodeSeekCookie: 'cookie',
      nodeSeekUserAgent: 'agent',
      signal,
      timeoutMs: 1000
    };
    forumApi.getTopic.mockResolvedValue(response);

    await expect(getTopic(options)).resolves.toBe(response);

    expect(forumApi.getTopic).toHaveBeenCalledWith(options);
  });

  it('forwards getReplies to forumApi unchanged', async () => {
    const response: RepliesResponse = { items: [reply], hasMore: false, nextPage: null };
    const options = {
      source: 'nodeseek' as const,
      id: 'topic-1',
      page: 2,
      limit: 30,
      offset: 40,
      fetcher,
      nodeSeekCookie: 'cookie',
      nodeSeekUserAgent: 'agent',
      signal,
      timeoutMs: 1000
    };
    forumApi.getReplies.mockResolvedValue(response);

    await expect(getReplies(options)).resolves.toBe(response);

    expect(forumApi.getReplies).toHaveBeenCalledWith(options);
  });

  it('forwards getReply to forumApi unchanged', async () => {
    const options = {
      source: 'linuxdo' as const,
      id: 'topic-1',
      floor: 3,
      fetcher,
      signal,
      timeoutMs: 1000
    };
    forumApi.getReply.mockResolvedValue(reply);

    await expect(getReply(options)).resolves.toBe(reply);

    expect(forumApi.getReply).toHaveBeenCalledWith(options);
  });

  it('forwards getUserProfile to forumApi unchanged', async () => {
    const response: UserProfile = {
      source: 'nodeseek',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://www.nodeseek.com/space/alice',
      topics: [topic]
    };
    const options = {
      source: 'nodeseek' as const,
      id: 'alice',
      username: 'alice',
      fetcher,
      nodeSeekCookie: 'cookie',
      nodeSeekUserAgent: 'agent',
      yaohuoCookie: 'yaohuo-cookie',
      cursor: 'cursor',
      signal,
      timeoutMs: 1000
    };
    forumApi.getUserProfile.mockResolvedValue(response);

    await expect(getUserProfile(options)).resolves.toBe(response);

    expect(forumApi.getUserProfile).toHaveBeenCalledWith(options);
  });

  it('forwards searchTopics to forumApi unchanged', async () => {
    const response: SearchResponse = { items: [topic], errors: {}, hasMore: false, nextPage: null };
    const options = {
      source: 'all' as const,
      query: 'typescript',
      limit: 30,
      page: 2,
      fetcher,
      nodeSeekCookie: 'cookie',
      nodeSeekUserAgent: 'agent',
      sort: 'time' as const,
      signal,
      timeoutMs: 1000
    };
    forumApi.searchTopics.mockResolvedValue(response);

    await expect(searchTopics(options)).resolves.toBe(response);

    expect(forumApi.searchTopics).toHaveBeenCalledWith(options);
  });

  it('forwards getYaohuoFeed to yaohuoApi unchanged', async () => {
    const response: FeedResponse = { items: [topic], errors: {}, hasMore: false, nextPage: null };
    const options = {
      yaohuoCookie: 'cookie',
      category: '177',
      page: 2,
      limit: 30,
      yaohuoFetcher: fetcher,
      signal,
      timeoutMs: 1000
    };
    yaohuoApi.getYaohuoFeedDirect.mockResolvedValue(response);

    await expect(getYaohuoFeed(options)).resolves.toBe(response);

    expect(yaohuoApi.getYaohuoFeedDirect).toHaveBeenCalledWith(options);
  });

  it('forwards searchYaohuoTopics to yaohuoApi unchanged', async () => {
    const response: SearchResponse = { items: [topic], errors: {}, hasMore: false, nextPage: null };
    const options = {
      yaohuoCookie: 'cookie',
      query: 'typescript',
      page: 2,
      limit: 30,
      category: '177',
      yaohuoFetcher: fetcher,
      signal,
      timeoutMs: 1000
    };
    yaohuoApi.searchYaohuoDirect.mockResolvedValue(response);

    await expect(searchYaohuoTopics(options)).resolves.toBe(response);

    expect(yaohuoApi.searchYaohuoDirect).toHaveBeenCalledWith(options);
  });

  it('forwards getYaohuoTopic to yaohuoApi unchanged', async () => {
    const response: TopicDetail = { ...topic, source: 'yaohuo', contentHtml: '<p>Topic</p>', replies: [reply] };
    const yaohuoTopic: Topic = { ...topic, source: 'yaohuo', categoryId: '177' };
    const options = {
      topic: yaohuoTopic,
      yaohuoCookie: 'cookie',
      replyLimit: 30,
      yaohuoFetcher: fetcher,
      signal,
      timeoutMs: 1000
    };
    yaohuoApi.getYaohuoTopicDirect.mockResolvedValue(response);

    await expect(getYaohuoTopic(options)).resolves.toBe(response);

    expect(yaohuoApi.getYaohuoTopicDirect).toHaveBeenCalledWith(options);
  });

  it('forwards getYaohuoReplies to yaohuoApi unchanged', async () => {
    const response: RepliesResponse = { items: [reply], hasMore: false, nextPage: null };
    const options = {
      id: 'topic-1',
      categoryId: '177',
      page: 2,
      limit: 30,
      yaohuoCookie: 'cookie',
      yaohuoFetcher: fetcher,
      signal,
      timeoutMs: 1000
    };
    yaohuoApi.getYaohuoRepliesDirect.mockResolvedValue(response);

    await expect(getYaohuoReplies(options)).resolves.toBe(response);

    expect(yaohuoApi.getYaohuoRepliesDirect).toHaveBeenCalledWith(options);
  });

  it('forwards checkYaohuoLogin to yaohuoApi unchanged', async () => {
    const response = { ok: true, loginRequired: false, message: '登录可用' };
    const options = {
      yaohuoCookie: 'cookie',
      yaohuoFetcher: fetcher,
      signal,
      timeoutMs: 1000
    };
    yaohuoApi.checkYaohuoLoginDirect.mockResolvedValue(response);

    await expect(checkYaohuoLogin(options)).resolves.toBe(response);

    expect(yaohuoApi.checkYaohuoLoginDirect).toHaveBeenCalledWith(options);
  });

  it('forwards runNodeSeekAction to nodeseekActionClient unchanged', async () => {
    const response = { ok: true };
    const request = { method: 'POST', path: '/api/action', body: '{}' } as unknown as NodeSeekActionRequest;
    const options = {
      cookieHeader: 'cookie',
      request,
      fetcher,
      signal,
      timeoutMs: 1000,
      userAgent: 'agent'
    };
    nodeSeekActionClient.runNodeSeekAction.mockResolvedValue(response);

    await expect(runNodeSeekAction(options)).resolves.toBe(response);

    expect(nodeSeekActionClient.runNodeSeekAction).toHaveBeenCalledWith(options);
  });

  it('forwards runLinuxDoAction to linuxdoActionClient unchanged', async () => {
    const response = { ok: true };
    const request = { method: 'POST', path: '/posts/1/like', body: '{}' } as unknown as LinuxDoActionRequest;
    const options = {
      cookieHeader: 'cookie',
      request,
      fetcher,
      signal,
      timeoutMs: 1000,
      userAgent: 'agent'
    };
    linuxDoActionClient.runLinuxDoAction.mockResolvedValue(response);

    await expect(runLinuxDoAction(options)).resolves.toBe(response);

    expect(linuxDoActionClient.runLinuxDoAction).toHaveBeenCalledWith(options);
  });

  it('forwards checkLinuxDoLoginAccess to linuxdoActionClient unchanged', async () => {
    const response = { ok: true, message: '登录可用' };
    const options = {
      cookieHeader: 'cookie',
      fetcher,
      signal,
      timeoutMs: 1000,
      userAgent: 'agent'
    };
    linuxDoActionClient.checkLinuxDoLoginAccess.mockResolvedValue(response);

    await expect(checkLinuxDoLoginAccess(options)).resolves.toBe(response);

    expect(linuxDoActionClient.checkLinuxDoLoginAccess).toHaveBeenCalledWith(options);
  });

  it('forwards runYaohuoAction to yaohuoActionClient unchanged', async () => {
    const response = { ok: true, message: '操作已提交' };
    const request = { method: 'POST', path: '/bbs/action.aspx', body: 'id=1' } as unknown as YaohuoActionRequest;
    const options = {
      cookieHeader: 'cookie',
      request,
      fetcher,
      signal,
      timeoutMs: 1000
    };
    yaohuoActionClient.runYaohuoAction.mockResolvedValue(response);

    await expect(runYaohuoAction(options)).resolves.toBe(response);

    expect(yaohuoActionClient.runYaohuoAction).toHaveBeenCalledWith(options);
  });

  it('forwards getLinuxDoLevelProfile to linuxdoLevel unchanged', async () => {
    const response = {
      username: 'alice',
      currentLevel: 1,
      targetLevel: 2,
      source: 'summary',
      estimate: true,
      note: 'note',
      requirements: [],
      activity: {
        daysVisited: 0,
        topicsEntered: 0,
        postsReadCount: 0,
        timeRead: 0,
        likesGiven: 0,
        likesReceived: 0,
        postCount: 0,
        topicCount: 0
      },
      achievedCount: 0,
      totalCount: 0,
      fetchedAt: '2026-01-01T00:00:00.000Z'
    };
    const options = {
      cookieHeader: 'cookie',
      userAgent: 'agent',
      fetcher,
      signal,
      timeoutMs: 1000
    };
    linuxDoLevel.getLinuxDoLevelProfile.mockResolvedValue(response);

    await expect(getLinuxDoLevelProfile(options)).resolves.toBe(response);

    expect(linuxDoLevel.getLinuxDoLevelProfile).toHaveBeenCalledWith(options);
  });
});
