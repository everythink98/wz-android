import { beforeEach, describe, expect, it, vi } from 'vitest';

const readers = vi.hoisted(() => ({
  getLinuxDoCategories: vi.fn(),
  getLinuxDoCurrentUserProfile: vi.fn(),
  getLinuxDoEmojiUrls: vi.fn(),
  getLinuxDoFeed: vi.fn(),
  getLinuxDoReplies: vi.fn(),
  getLinuxDoReply: vi.fn(),
  getLinuxDoTopic: vi.fn(),
  getLinuxDoUserProfile: vi.fn(),
  searchLinuxDo: vi.fn(),
  searchLinuxDoTags: vi.fn(),
  searchLinuxDoUsers: vi.fn()
}));

vi.mock('@/sources/linuxdo/reader', () => ({
  getLinuxDoCategories: readers.getLinuxDoCategories,
  getLinuxDoEmojiUrls: readers.getLinuxDoEmojiUrls,
  getLinuxDoFeed: readers.getLinuxDoFeed,
  getLinuxDoReplies: readers.getLinuxDoReplies,
  getLinuxDoReply: readers.getLinuxDoReply,
  getLinuxDoTopic: readers.getLinuxDoTopic
}));

vi.mock('@/sources/linuxdo/account', () => ({
  getLinuxDoCurrentUserProfile: readers.getLinuxDoCurrentUserProfile,
  getLinuxDoUserProfile: readers.getLinuxDoUserProfile
}));

vi.mock('@/sources/linuxdo/search', () => ({
  searchLinuxDo: readers.searchLinuxDo,
  searchLinuxDoTags: readers.searchLinuxDoTags,
  searchLinuxDoUsers: readers.searchLinuxDoUsers
}));

import {
  getDiscourseSourceCurrentUserProfile,
  getDiscourseSourceEmojiUrls,
  getDiscourseSourceFeed,
  searchDiscourseSourceTagOptions
} from './discourseRead';

describe('Discourse source reader registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes the shared feed contract into site adapter options', async () => {
    readers.getLinuxDoFeed.mockResolvedValueOnce({ items: [] });

    await getDiscourseSourceFeed('linuxdo', { filter: 'hot', page: 2 });

    expect(readers.getLinuxDoFeed).toHaveBeenCalledWith({ linuxDoFilter: 'hot', page: 2 });
  });

  it('[REG-SOURCE-004] forwards the gateway-owned linux.do identity proof without a Cookie header', async () => {
    readers.getLinuxDoFeed.mockResolvedValueOnce({ items: [] });
    const access = { authenticated: true, userAgent: 'android' };

    await getDiscourseSourceFeed('linuxdo', {
      auth: { linuxdo: access },
      filter: 'latest',
      page: 2
    });

    expect(readers.getLinuxDoFeed).toHaveBeenCalledWith({
      linuxDoAccess: access,
      linuxDoFilter: 'latest',
      page: 2
    });
  });

  it('keeps site authentication inside the registered adapter boundary', async () => {
    readers.getLinuxDoCurrentUserProfile.mockResolvedValueOnce({ source: 'linuxdo' });
    const auth = { linuxdo: { authenticated: true, userAgent: 'android' } };

    await getDiscourseSourceCurrentUserProfile('linuxdo', { auth });

    expect(readers.getLinuxDoCurrentUserProfile).toHaveBeenCalledWith({
      linuxDoUserAgent: 'android'
    });
  });

  it('dispatches shared option lookup without a public site branch', async () => {
    readers.searchLinuxDoTags.mockResolvedValueOnce([]);
    const auth = { linuxdo: { authenticated: true, userAgent: 'android' } };

    await searchDiscourseSourceTagOptions('linuxdo', { auth, query: 'arch' });

    expect(readers.searchLinuxDoTags).toHaveBeenCalledWith({
      linuxDoAccess: auth.linuxdo,
      query: 'arch'
    });
  });

  it('dispatches the site-owned emoji catalog through the Discourse reader port', async () => {
    readers.getLinuxDoEmojiUrls.mockResolvedValueOnce({ heart: 'https://linux.do/heart.png' });

    await getDiscourseSourceEmojiUrls('linuxdo');

    expect(readers.getLinuxDoEmojiUrls).toHaveBeenCalledWith({});
  });
});
