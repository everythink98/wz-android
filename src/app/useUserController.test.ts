import { afterEach, describe, expect, it, vi } from 'vitest';

const reactStateOverrides = vi.hoisted(() => ({ values: [] as unknown[] }));

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useLayoutEffect: (effect: () => void) => effect(),
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
import { annotateSourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import { createSiteSessionStates, createSiteSessionViewModels } from '../siteSessionState';
import type { SourceGateway } from '../sources/sourceGateway';
import type { UserProfile } from '../types';
import { hasNextUserPage, useUserController, userSourceRecoveryTarget } from './useUserController';
import { appQueryClient } from './serverState';
import { REQUEST_CANCELED_MESSAGE } from '../request';

afterEach(() => {
  appQueryClient.clear();
  reactStateOverrides.values = [];
  vi.clearAllMocks();
});

describe('user source recovery routing', () => {
  it('keeps an undisplayed cached cursor reachable and only rejects a repeated cursor', () => {
    expect(hasNextUserPage(true, 'cursor-2', 'cursor-1')).toBe(true);
    expect(hasNextUserPage(true, 'cursor-1', 'cursor-1')).toBe(false);
    expect(hasNextUserPage(false, 'cursor-2', 'cursor-1')).toBe(false);
  });

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
    await expect(recovery.resume()).resolves.toBe('verification-required');
    expect(recovery.isCurrent()).toBe(true);
    await expect(recovery.resume()).resolves.toBe('completed');
    expect(getUserProfile).toHaveBeenCalledTimes(3);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent opens for the same user while only the latest caller applies the result', async () => {
    const user: UserProfile = {
      source: 'nodeseek',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://www.nodeseek.com/space/1',
      topics: []
    };
    const pending = Promise.withResolvers<void>();
    const getUserProfile = vi.fn(async (_options: unknown, context?: { isCurrent?: () => boolean }) => {
      await pending.promise;
      if (context?.isCurrent?.() === false) {
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      return user;
    });
    const controller = useUserController({
      notify: vi.fn(),
      onOpenUserScreen: vi.fn(),
      readerData: createEmptyReaderData(),
      screen: 'user',
      sessionViewModels: createSiteSessionViewModels(createSiteSessionStates()),
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway: { getUserProfile } as unknown as SourceGateway
    });

    const first = controller.openUser(user);
    await vi.waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(1));
    const second = controller.openUser(user);
    pending.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual(['stale', 'completed']);
    expect(getUserProfile).toHaveBeenCalledTimes(1);
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
    await expect(recovery.resume()).resolves.toBe('verification-required');
    expect(recovery.isCurrent()).toBe(true);
    await expect(recovery.resume()).resolves.toBe('completed');

    expect(getUserProfile).toHaveBeenNthCalledWith(1, expect.objectContaining({ cursor, cursorType }), expect.any(Object));
    expect(getUserProfile).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor, cursorType }), expect.any(Object));
    expect(getUserProfile).toHaveBeenNthCalledWith(3, expect.objectContaining({ cursor, cursorType }), expect.any(Object));
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('REG-USER-001 keeps topic and reply pagination independent without repeating either cursor', async () => {
    const user: UserProfile = {
      source: 'linuxdo',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://linux.do/u/alice',
      topics: [],
      replies: [],
      hasMoreTopics: true,
      nextTopicsCursor: 'topics-cursor',
      hasMoreReplies: true,
      nextRepliesCursor: 'replies-cursor'
    };
    reactStateOverrides.values = [null, user, false, false, false, null];
    const firstTopicsPage = Promise.withResolvers<UserProfile>();
    const getUserProfile = vi.fn(async ({ cursorType }: { cursorType?: 'topics' | 'replies' }) => {
      if (cursorType === 'topics' && getUserProfile.mock.calls.length === 1) {
        return firstTopicsPage.promise;
      }
      return {
        ...user,
        hasMoreTopics: false,
        nextTopicsCursor: null,
        hasMoreReplies: false,
        nextRepliesCursor: null
      };
    });
    const controller = useUserController({
      notify: vi.fn(),
      onOpenUserScreen: vi.fn(),
      readerData: createEmptyReaderData(),
      screen: 'user',
      sessionViewModels: createSiteSessionViewModels(createSiteSessionStates()),
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway: { getUserProfile } as unknown as SourceGateway
    });

    const topicsRequest = controller.loadMoreUserTopics();
    await vi.waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(1));
    await expect(controller.loadMoreUserReplies()).resolves.toBe('completed');
    firstTopicsPage.resolve(user);
    await expect(topicsRequest).resolves.toBe('completed');

    await expect(controller.loadMoreUserTopics()).resolves.toBe('completed');
    expect(getUserProfile).toHaveBeenCalledTimes(2);
    expect(getUserProfile.mock.calls.map(([options]) => options.cursorType)).toEqual(['topics', 'replies']);
  });

  it('REG-SOURCE-002 does not accept a user profile whose identity and entries all failed to parse', async () => {
    const user: UserProfile = {
      source: 'nodeseek',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://www.nodeseek.com/space/1',
      topics: []
    };
    const parsedEmpty = annotateSourceDiagnosticSummary({ ...user, displayName: '', topics: [] }, {
      parserVariant: 'html-user',
      candidateCount: 1,
      validCount: 0,
      droppedCount: 1,
      isExpectedEmpty: false
    });
    const notify = vi.fn();
    const controller = useUserController({
      notify,
      onOpenUserScreen: vi.fn(),
      readerData: createEmptyReaderData(),
      screen: 'user',
      sessionViewModels: createSiteSessionViewModels(createSiteSessionStates()),
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway: { getUserProfile: vi.fn(async () => parsedEmpty) } as unknown as SourceGateway
    });

    await expect(controller.openUser(user)).resolves.toBe('failed');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('解析为空'));
  });
});
