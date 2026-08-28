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

import { getDiscourseCurrentUserProfile, getDiscourseFeed } from './discourseRead';

describe('Discourse read composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the gateway-owned linux.do identity proof without a Cookie header', async () => {
    readers.getLinuxDoFeed.mockResolvedValueOnce({ items: [] });
    const access = { authenticated: true, userAgent: 'android' };

    await getDiscourseFeed({
      auth: access,
      filter: 'latest',
      page: 2
    });

    expect(readers.getLinuxDoFeed).toHaveBeenCalledWith({
      linuxDoAccess: access,
      linuxDoFilter: 'latest',
      page: 2
    });
  });

  it('keeps site authentication inside the read composition seam', async () => {
    readers.getLinuxDoCurrentUserProfile.mockResolvedValueOnce({ source: 'linuxdo' });
    const auth = { authenticated: true, userAgent: 'android' };

    await getDiscourseCurrentUserProfile({ auth });

    expect(readers.getLinuxDoCurrentUserProfile).toHaveBeenCalledWith({
      linuxDoUserAgent: 'android'
    });
  });
});
