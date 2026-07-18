import { afterEach, describe, expect, it, vi } from 'vitest';

const reactStateOverrides = vi.hoisted(() => ({ values: [] as unknown[] }));

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    let state = reactStateOverrides.values.length
      ? reactStateOverrides.values.shift() as T
      : typeof initial === 'function' ? (initial as () => T)() : initial;
    return [state, (next: T | ((current: T) => T)) => {
      state = typeof next === 'function' ? (next as (current: T) => T)(state) : next;
    }];
  }
}));

import { LinuxDoCloudflareError } from '../cloudflareChallenge';
import { createEmptyReaderData } from '../readerData';
import { createSiteSessionStates, createSiteSessionViewModels } from '../siteSessionState';
import type { SourceGateway } from '../sources/sourceGateway';
import type { UserProfile } from '../types';
import { useUserController, userSourceRecoveryTarget } from './useUserController';

afterEach(() => {
  reactStateOverrides.values = [];
  vi.clearAllMocks();
});

describe('user source recovery routing', () => {
  it('routes Yaohuo verification errors back to the in-app login and verification surface', () => {
    expect(userSourceRecoveryTarget('yaohuo', {
      kind: 'verification-required',
      message: '妖火需要完成访问验证'
    })).toBe('yaohuo-login');
  });

  it('does not treat an ordinary Yaohuo failure as a login recovery event', () => {
    expect(userSourceRecoveryTarget('yaohuo', {
      kind: 'ordinary',
      message: '请求超时'
    })).toBeNull();
  });

  it('REG-LINUXDO-002 resumes the exact linux.do user read once through the visible verification flow', async () => {
    const user: UserProfile = {
      source: 'linuxdo',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://linux.do/u/alice',
      topics: []
    };
    const getUserProfile = vi.fn()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockResolvedValueOnce(user);
    const showLinuxDoVerification = vi.fn();
    const controller = useUserController({
      notify: vi.fn(),
      onOpenUserScreen: vi.fn(),
      readerData: createEmptyReaderData(),
      screen: 'user',
      sessionViewModels: createSiteSessionViewModels(createSiteSessionStates()),
      showLinuxDoVerification,
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway: { getUserProfile } as unknown as SourceGateway
    });

    await expect(controller.openUser(user)).resolves.toBe('verification-required');

    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery).toMatchObject({ key: expect.stringContaining('user:linuxdo:alice') });
    await expect(recovery.resume()).resolves.toBe('completed');
    expect(getUserProfile).toHaveBeenCalledTimes(2);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it.each([
    { cursorType: 'topics' as const, method: 'loadMoreUserTopics' as const, cursor: 'topics-cursor' },
    { cursorType: 'replies' as const, method: 'loadMoreUserReplies' as const, cursor: 'replies-cursor' }
  ])('REG-LINUXDO-002 retries the exact failed user $cursorType cursor', async ({ cursorType, method, cursor }) => {
    const user: UserProfile = {
      source: 'linuxdo',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://linux.do/u/alice',
      topics: [],
      replies: [],
      hasMoreTopics: cursorType === 'topics',
      nextTopicsCursor: cursorType === 'topics' ? cursor : null,
      hasMoreReplies: cursorType === 'replies',
      nextRepliesCursor: cursorType === 'replies' ? cursor : null
    };
    reactStateOverrides.values = [null, user, false, false, false, null];
    const getUserProfile = vi.fn()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockResolvedValueOnce({
        ...user,
        hasMoreTopics: false,
        nextTopicsCursor: null,
        hasMoreReplies: false,
        nextRepliesCursor: null
      });
    const showLinuxDoVerification = vi.fn();
    const controller = useUserController({
      notify: vi.fn(),
      onOpenUserScreen: vi.fn(),
      readerData: createEmptyReaderData(),
      screen: 'user',
      sessionViewModels: createSiteSessionViewModels(createSiteSessionStates()),
      showLinuxDoVerification,
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway: { getUserProfile } as unknown as SourceGateway
    });

    await expect(controller[method]()).resolves.toBe('verification-required');
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    await expect(recovery.resume()).resolves.toBe('completed');

    expect(getUserProfile).toHaveBeenNthCalledWith(1, expect.objectContaining({ cursor, cursorType }), expect.any(Object));
    expect(getUserProfile).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor, cursorType }), expect.any(Object));
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });
});
