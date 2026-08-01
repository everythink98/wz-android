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
  getXiaoyinsiCategories: vi.fn(),
  getXiaoyinsiCurrentUserProfile: vi.fn(),
  getXiaoyinsiEmojiUrls: vi.fn(),
  getXiaoyinsiFeed: vi.fn(),
  getXiaoyinsiReplies: vi.fn(),
  getXiaoyinsiReply: vi.fn(),
  getXiaoyinsiTopic: vi.fn(),
  getXiaoyinsiUserProfile: vi.fn(),
  searchLinuxDo: vi.fn(),
  searchLinuxDoTags: vi.fn(),
  searchLinuxDoUsers: vi.fn(),
  searchXiaoyinsi: vi.fn(),
  searchXiaoyinsiTags: vi.fn(),
  searchXiaoyinsiUsers: vi.fn()
}));

vi.mock('@/localLinuxdo', () => ({
  getLinuxDoCategories: readers.getLinuxDoCategories,
  getLinuxDoCurrentUserProfile: readers.getLinuxDoCurrentUserProfile,
  getLinuxDoEmojiUrls: readers.getLinuxDoEmojiUrls,
  getLinuxDoFeed: readers.getLinuxDoFeed,
  getLinuxDoReplies: readers.getLinuxDoReplies,
  getLinuxDoReply: readers.getLinuxDoReply,
  getLinuxDoTopic: readers.getLinuxDoTopic,
  getLinuxDoUserProfile: readers.getLinuxDoUserProfile,
  searchLinuxDo: readers.searchLinuxDo,
  searchLinuxDoTags: readers.searchLinuxDoTags,
  searchLinuxDoUsers: readers.searchLinuxDoUsers
}));

vi.mock('@/localXiaoyinsi', () => ({
  getXiaoyinsiCategories: readers.getXiaoyinsiCategories,
  getXiaoyinsiCurrentUserProfile: readers.getXiaoyinsiCurrentUserProfile,
  getXiaoyinsiEmojiUrls: readers.getXiaoyinsiEmojiUrls,
  getXiaoyinsiFeed: readers.getXiaoyinsiFeed,
  getXiaoyinsiReplies: readers.getXiaoyinsiReplies,
  getXiaoyinsiReply: readers.getXiaoyinsiReply,
  getXiaoyinsiTopic: readers.getXiaoyinsiTopic,
  getXiaoyinsiUserProfile: readers.getXiaoyinsiUserProfile,
  searchXiaoyinsi: readers.searchXiaoyinsi,
  searchXiaoyinsiTags: readers.searchXiaoyinsiTags,
  searchXiaoyinsiUsers: readers.searchXiaoyinsiUsers
}));

import {
  discourseReaderSources,
  getDiscourseSourceCurrentUserProfile,
  getDiscourseSourceEmojiUrls,
  getDiscourseSourceFeed,
  getDiscourseSourceReply,
  searchDiscourseSourceTagOptions
} from './readers';

describe('Discourse source reader registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers every current Discourse source', () => {
    expect(discourseReaderSources).toEqual(['linuxdo', 'xiaoyinsi']);
  });

  it('normalizes the shared feed contract into site adapter options', async () => {
    readers.getLinuxDoFeed.mockResolvedValueOnce({ items: [] });
    readers.getXiaoyinsiFeed.mockResolvedValueOnce({ items: [] });
    const auth = { xiaoyinsi: { apiKey: 'key', clientId: 'client' } };

    await getDiscourseSourceFeed('linuxdo', { filter: 'hot', page: 2 });
    await getDiscourseSourceFeed('xiaoyinsi', { auth, filter: 'new-topics', page: 3 });

    expect(readers.getLinuxDoFeed).toHaveBeenCalledWith({ linuxDoFilter: 'hot', page: 2 });
    expect(readers.getXiaoyinsiFeed).toHaveBeenCalledWith({
      credentials: auth.xiaoyinsi,
      feedFilter: 'new-topics',
      page: 3
    });
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
    readers.getXiaoyinsiReply.mockResolvedValueOnce({ floor: 2 });
    const auth = {
      linuxdo: { authenticated: true, userAgent: 'android' },
      xiaoyinsi: { apiKey: 'key', clientId: 'client' }
    };

    await getDiscourseSourceCurrentUserProfile('linuxdo', { auth });
    await getDiscourseSourceReply('xiaoyinsi', '42', 2, { auth });

    expect(readers.getLinuxDoCurrentUserProfile).toHaveBeenCalledWith({
      linuxDoUserAgent: 'android'
    });
    expect(readers.getXiaoyinsiReply).toHaveBeenCalledWith('42', 2, {
      credentials: auth.xiaoyinsi
    });
  });

  it('dispatches shared option lookup without a public site branch', async () => {
    readers.searchXiaoyinsiTags.mockResolvedValueOnce([]);
    const auth = { xiaoyinsi: { apiKey: 'key', clientId: 'client' } };

    await searchDiscourseSourceTagOptions('xiaoyinsi', { auth, query: 'arch' });

    expect(readers.searchXiaoyinsiTags).toHaveBeenCalledWith({
      credentials: auth.xiaoyinsi,
      query: 'arch'
    });
  });

  it('dispatches the site-owned emoji catalog through the Discourse reader port', async () => {
    readers.getLinuxDoEmojiUrls.mockResolvedValueOnce({ heart: 'https://linux.do/heart.png' });
    readers.getXiaoyinsiEmojiUrls.mockResolvedValueOnce({ heart: 'https://forum.xiaoyinsi.com/heart.png' });

    await getDiscourseSourceEmojiUrls('linuxdo');
    await getDiscourseSourceEmojiUrls('xiaoyinsi');

    expect(readers.getLinuxDoEmojiUrls).toHaveBeenCalledWith({});
    expect(readers.getXiaoyinsiEmojiUrls).toHaveBeenCalledWith({ credentials: undefined });
  });
});
