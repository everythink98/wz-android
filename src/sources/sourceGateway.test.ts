import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '../request';
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

const forumApi = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getFeed: vi.fn(),
  getReply: vi.fn(),
  getReplies: vi.fn(),
  getTopic: vi.fn(),
  getUserProfile: vi.fn(),
  searchTopics: vi.fn()
}));

vi.mock('../forumApi', () => forumApi);

import {
  getCategories,
  getFeed,
  getReply,
  getReplies,
  getTopic,
  getUserProfile,
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
});
