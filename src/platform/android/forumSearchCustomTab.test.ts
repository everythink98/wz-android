import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  nativeModules: {} as Record<string, unknown>,
  openBrowserAsync: vi.fn()
}));

vi.mock('react-native', () => ({ NativeModules: mocks.nativeModules }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: mocks.openBrowserAsync }));

import { openForumSearchCustomTab } from './forumSearchCustomTab';

const searchUrl = 'https://www.google.com/search?q=site%3Alinux.do+codex';

describe('forum search Custom Tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mocks.nativeModules.ForumSearchCustomTabModule;
  });

  it('uses the native Custom Tab handoff when available', async () => {
    const open = vi.fn(async () => true);
    mocks.nativeModules.ForumSearchCustomTabModule = { open };

    await expect(openForumSearchCustomTab(searchUrl)).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith(searchUrl);
    expect(mocks.openBrowserAsync).not.toHaveBeenCalled();
  });

  it('falls back to the regular browser but never opens an invalid URL', async () => {
    await expect(openForumSearchCustomTab(searchUrl)).resolves.toBe(false);
    expect(mocks.openBrowserAsync).toHaveBeenCalledWith(searchUrl);

    await expect(openForumSearchCustomTab('https://example.com/')).rejects.toThrow('外部搜索地址无效');
    expect(mocks.openBrowserAsync).toHaveBeenCalledTimes(1);
  });
});
