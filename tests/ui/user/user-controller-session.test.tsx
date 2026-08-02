import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { appQueryClient, type ForumIdentityBarrierSource } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { resetForumSourceQueries } from '@/features/account/sessionControllerHelpers';
import { useUserController } from '@/features/user/useUserController';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import type { ReadGateway } from '@/sources/readGateway';
import type { UserProfile, UserReference } from '@/domain/forum/models';
import { QueryTestWrapper } from '../QueryTestWrapper';

function renderHook<Result>(callback: () => Result) {
  return renderNativeHook(callback, { wrapper: QueryTestWrapper });
}

const user: UserProfile = {
  source: 'nodeseek',
  id: '1',
  username: 'alice',
  displayName: 'Alice',
  url: 'https://www.nodeseek.com/space/1',
  topics: []
};

function renderUserController({
  getActive = () => true,
  getIdentityBarriers = () => [],
  getSessionEpochs = () => initialForumSessionEpochs,
  getUser = () => user,
  getUserProfile,
  resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>(),
  showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
  showNodeSeekVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>()
}: {
  getActive?: () => boolean;
  getIdentityBarriers?: () => ForumIdentityBarrierSource[];
  getSessionEpochs?: () => ForumSessionEpochs;
  getUser?: () => UserReference;
  getUserProfile: ReadGateway['getUserProfile'];
  resolveNodeSeekUser?: ReadGateway['resolveNodeSeekUser'];
  showLinuxDoVerification?: (message?: string, recovery?: LinuxDoReadRecovery) => void;
  showNodeSeekVerification?: (message?: string, recovery?: LinuxDoReadRecovery) => void;
}) {
  return renderHook(() =>
    useUserController({
      active: getActive(),
      identityBarriers: getIdentityBarriers(),
      sessionEpochs: getSessionEpochs(),
      notify: jest.fn(),
      readerData: createEmptyReaderData(),
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin: jest.fn(),
      readGateway: { getUserProfile, resolveNodeSeekUser } as unknown as ReadGateway,
      user: getUser()
    })
  );
}

describe('user query controller', () => {
  beforeEach(() => appQueryClient.clear());
  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it('[REG-PERF-008][REG-ACCOUNT-031] gates route queries and commands while inactive', async () => {
    let active = false;
    let signal: AbortSignal | undefined;
    const pending = Promise.withResolvers<UserProfile>();
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async (request) => {
      signal = request.signal;
      return pending.promise;
    });
    const hook = await renderUserController({ getActive: () => active, getUserProfile });

    await act(async () => {
      await Promise.resolve();
    });
    expect(getUserProfile).not.toHaveBeenCalled();
    await expect(hook.result.current.refreshUser()).resolves.toBe('stale');

    active = true;
    await act(async () => {
      hook.rerender(undefined);
    });
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(1));

    active = false;
    await act(async () => {
      hook.rerender(undefined);
    });
    await waitFor(() => expect(signal?.aborted).toBe(true));
    await expect(hook.result.current.loadMoreUserTopics()).resolves.toBe('stale');

    pending.resolve(user);
  });

  it('[REG-TOPIC-039] resolves a username before loading the canonical NodeSeek profile', async () => {
    const reference: UserReference = {
      source: 'nodeseek',
      username: 'xy',
      url: 'https://www.nodeseek.com/member?t=xy'
    };
    const resolution = Promise.withResolvers<UserReference>();
    const resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>(async () => resolution.promise);
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async ({ cursorType }) => ({
      ...user,
      id: '8052',
      username: 'xy',
      url: 'https://www.nodeseek.com/space/8052',
      hasMoreTopics: !cursorType,
      nextTopicsCursor: cursorType ? null : 'topics-2'
    }));
    const hook = await renderUserController({ getUser: () => reference, getUserProfile, resolveNodeSeekUser });
    await waitFor(() => expect(resolveNodeSeekUser).toHaveBeenCalledTimes(1));
    expect(getUserProfile).not.toHaveBeenCalled();
    expect(hook.result.current.userBusy).toBe(true);
    expect(hook.result.current.currentUserFollowed).toBe(false);

    await act(async () => {
      resolution.resolve({
        source: 'nodeseek',
        id: '8052',
        username: 'xy',
        url: 'https://www.nodeseek.com/space/8052'
      });
      await resolution.promise;
    });

    await waitFor(() =>
      expect(getUserProfile).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'nodeseek', id: '8052', username: 'xy' }),
        expect.anything()
      )
    );
    await waitFor(() => expect(hook.result.current.userProfile).toMatchObject({ id: '8052', username: 'xy' }));

    await act(async () => {
      await hook.result.current.loadMoreUserTopics();
    });
    expect(getUserProfile.mock.calls.map(([request]) => request.id)).toEqual(['8052', '8052']);

    await act(async () => {
      await hook.result.current.refreshUser();
    });
    expect(resolveNodeSeekUser).toHaveBeenCalledTimes(1);
    expect(getUserProfile).toHaveBeenCalledTimes(3);
  });

  it('[REG-TOPIC-039] retries a failed resolution only after explicit refresh', async () => {
    const reference: UserReference = {
      source: 'nodeseek',
      username: 'xy',
      url: 'https://www.nodeseek.com/member?t=xy'
    };
    const resolveNodeSeekUser = jest
      .fn<ReadGateway['resolveNodeSeekUser']>()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce({
        source: 'nodeseek',
        id: '8052',
        username: 'xy',
        url: 'https://www.nodeseek.com/space/8052'
      });
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async () => ({
      ...user,
      id: '8052',
      username: 'xy'
    }));
    const hook = await renderUserController({ getUser: () => reference, getUserProfile, resolveNodeSeekUser });
    await waitFor(() => expect(hook.result.current.userError).not.toBeNull());
    expect(resolveNodeSeekUser).toHaveBeenCalledTimes(1);
    expect(getUserProfile).not.toHaveBeenCalled();

    await act(async () => {
      await hook.result.current.refreshUser();
    });
    await waitFor(() => expect(hook.result.current.userProfile?.id).toBe('8052'));
    expect(resolveNodeSeekUser).toHaveBeenCalledTimes(2);
    expect(getUserProfile).toHaveBeenCalledTimes(1);
  });

  it('[REG-TOPIC-039] preserves the exact resolution query for NodeSeek verification recovery', async () => {
    const reference: UserReference = {
      source: 'nodeseek',
      username: 'xy',
      url: 'https://www.nodeseek.com/member?t=xy'
    };
    const resolveNodeSeekUser = jest
      .fn<ReadGateway['resolveNodeSeekUser']>()
      .mockRejectedValueOnce(
        Object.assign(new Error('NodeSeek 需要完成 Cloudflare 验证'), {
          source: 'nodeseek',
          reason: 'cloudflare'
        })
      )
      .mockResolvedValueOnce({
        source: 'nodeseek',
        id: '8052',
        username: 'xy',
        url: 'https://www.nodeseek.com/space/8052'
      });
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async () => ({
      ...user,
      id: '8052',
      username: 'xy'
    }));
    const showNodeSeekVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderUserController({
      getUser: () => reference,
      getUserProfile,
      resolveNodeSeekUser,
      showNodeSeekVerification
    });
    await waitFor(() => expect(showNodeSeekVerification).toHaveBeenCalledTimes(1));
    const recovery = showNodeSeekVerification.mock.calls[0]?.[1];
    expect(recovery?.queryKey).toEqual(expect.arrayContaining(['forum', 'nodeseek', 'user-resolution']));

    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('completed');
    });
    await waitFor(() => expect(hook.result.current.userProfile?.id).toBe('8052'));
    expect(resolveNodeSeekUser).toHaveBeenCalledTimes(2);
  });

  it('[REG-TOPIC-039] preserves the exact canonical profile query for NodeSeek verification recovery', async () => {
    const getUserProfile = jest
      .fn<ReadGateway['getUserProfile']>()
      .mockRejectedValueOnce(
        Object.assign(new Error('NodeSeek 需要完成 Cloudflare 验证'), {
          source: 'nodeseek',
          reason: 'cloudflare'
        })
      )
      .mockResolvedValueOnce({ ...user, id: '1414', username: '男朋友' });
    const resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>();
    const showNodeSeekVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderUserController({
      getUser: () => ({
        source: 'nodeseek',
        id: '1414',
        username: '男朋友',
        url: 'https://www.nodeseek.com/space/1414'
      }),
      getUserProfile,
      resolveNodeSeekUser,
      showNodeSeekVerification
    });
    await waitFor(() => expect(showNodeSeekVerification).toHaveBeenCalledTimes(1));
    const recovery = showNodeSeekVerification.mock.calls[0]?.[1];
    expect(recovery?.queryKey).toEqual(['forum', 'nodeseek', 'user', { sessionEpoch: 0, userId: '1414' }]);

    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('completed');
    });
    await waitFor(() => expect(hook.result.current.userProfile).toMatchObject({ id: '1414', username: '男朋友' }));
    expect(resolveNodeSeekUser).not.toHaveBeenCalled();
    expect(getUserProfile).toHaveBeenCalledTimes(2);
  });

  it('[REG-TOPIC-039] does not turn a NodeSeek pagination failure into a user-route recovery', async () => {
    const getUserProfile = jest
      .fn<ReadGateway['getUserProfile']>()
      .mockResolvedValueOnce({
        ...user,
        id: '1414',
        username: '男朋友',
        hasMoreTopics: true,
        nextTopicsCursor: '2'
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('NodeSeek 需要完成 Cloudflare 验证'), {
          source: 'nodeseek',
          reason: 'cloudflare'
        })
      );
    const showNodeSeekVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderUserController({
      getUser: () => ({
        source: 'nodeseek',
        id: '1414',
        username: '男朋友',
        url: 'https://www.nodeseek.com/space/1414'
      }),
      getUserProfile,
      showNodeSeekVerification
    });
    await waitFor(() => expect(hook.result.current.userProfile?.id).toBe('1414'));
    await act(async () => {
      await hook.result.current.loadMoreUserTopics();
    });
    await waitFor(() => expect(showNodeSeekVerification).toHaveBeenCalledTimes(1));
    expect(showNodeSeekVerification.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('[REG-TOPIC-039] keeps a known logged-out resolution error out of Cloudflare recovery', async () => {
    const resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>(async () => {
      throw Object.assign(new Error('请先登录 NodeSeek 后再打开用户主页'), {
        source: 'nodeseek',
        loginRequired: true
      });
    });
    const showNodeSeekVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderUserController({
      getUser: () => ({
        source: 'nodeseek',
        username: 'xy',
        url: 'https://www.nodeseek.com/member?t=xy'
      }),
      getUserProfile: jest.fn<ReadGateway['getUserProfile']>(),
      resolveNodeSeekUser,
      showNodeSeekVerification
    });
    await waitFor(() => expect(hook.result.current.userError?.kind).toBe('login-required'));
    expect(showNodeSeekVerification).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-031] blocks username resolution at the identity barrier and re-resolves after the epoch changes', async () => {
    const reference: UserReference = {
      source: 'nodeseek',
      username: 'xy',
      url: 'https://www.nodeseek.com/member?t=xy'
    };
    let identityBarriers: ForumIdentityBarrierSource[] = ['nodeseek'];
    let sessionEpochs = initialForumSessionEpochs;
    const resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>(async () => ({
      source: 'nodeseek',
      id: '8052',
      username: 'xy',
      url: 'https://www.nodeseek.com/space/8052'
    }));
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async () => ({
      ...user,
      id: '8052',
      username: 'xy'
    }));
    const hook = await renderUserController({
      getIdentityBarriers: () => identityBarriers,
      getSessionEpochs: () => sessionEpochs,
      getUser: () => reference,
      getUserProfile,
      resolveNodeSeekUser
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveNodeSeekUser).not.toHaveBeenCalled();
    expect(getUserProfile).not.toHaveBeenCalled();

    identityBarriers = [];
    await act(async () => {
      hook.rerender(undefined);
    });
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(1));
    expect(resolveNodeSeekUser).toHaveBeenCalledTimes(1);

    sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
    await act(async () => {
      hook.rerender(undefined);
    });
    await waitFor(() => expect(resolveNodeSeekUser).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(2));
  });

  it('[REG-TOPIC-039] cancels an old username resolution when the selected user changes', async () => {
    const oldResolution = Promise.withResolvers<UserReference>();
    let oldSignal: AbortSignal | undefined;
    const resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>(async ({ signal, username }) => {
      if (username === 'old-user') {
        oldSignal = signal;
        return oldResolution.promise;
      }
      return {
        source: 'nodeseek',
        id: '22',
        username: 'new-user',
        url: 'https://www.nodeseek.com/space/22'
      };
    });
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async ({ id, username }) => ({
      ...user,
      id,
      username: username || id,
      url: `https://www.nodeseek.com/space/${id}`
    }));
    let routeUser: UserReference = {
      source: 'nodeseek',
      username: 'old-user',
      url: 'https://www.nodeseek.com/member?t=old-user'
    };
    const hook = await renderUserController({
      getUser: () => routeUser,
      getUserProfile,
      resolveNodeSeekUser
    });

    await waitFor(() => expect(resolveNodeSeekUser).toHaveBeenCalledTimes(1));
    await act(async () => {
      routeUser = {
        source: 'nodeseek',
        username: 'new-user',
        url: 'https://www.nodeseek.com/member?t=new-user'
      };
      hook.rerender(undefined);
    });
    await waitFor(() => expect(hook.result.current.userProfile?.id).toBe('22'));
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => {
      oldResolution.resolve({
        source: 'nodeseek',
        id: '11',
        username: 'old-user',
        url: 'https://www.nodeseek.com/space/11'
      });
      await oldResolution.promise;
    });
    expect(hook.result.current.selectedUser?.username).toBe('new-user');
    expect(hook.result.current.userProfile?.id).toBe('22');
    expect(getUserProfile.mock.calls.map(([request]) => request.id)).toEqual(['22']);
  });

  it('loads the profile once and seeds both pagination lanes without repeating first-page transport', async () => {
    const resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>();
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async () => ({
      ...user,
      topics: [
        {
          source: 'nodeseek',
          id: 'topic-1',
          title: '首屏主题',
          author: 'alice',
          url: 'https://www.nodeseek.com/post-1-1',
          createdAt: '2026-07-20T00:00:00.000Z',
          replyCount: 0
        }
      ],
      replies: []
    }));
    const hook = await renderUserController({ getUserProfile, resolveNodeSeekUser });
    await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(1));

    expect(getUserProfile).toHaveBeenCalledTimes(1);
    expect(resolveNodeSeekUser).not.toHaveBeenCalled();
    expect(getUserProfile.mock.calls[0]?.[0]).not.toHaveProperty('cursorType');
  });

  it('[REG-ACCOUNT-031] keeps a loaded user profile read-only while its identity is pending', async () => {
    let identityBarriers: ForumIdentityBarrierSource[] = [];
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async () => user);
    const hook = await renderUserController({
      getIdentityBarriers: () => identityBarriers,
      getUserProfile
    });
    await waitFor(() =>
      expect(hook.result.current.userProfile).toMatchObject({
        source: user.source,
        id: user.id,
        username: user.username,
        displayName: user.displayName
      })
    );

    identityBarriers = ['nodeseek'];
    await act(async () => {
      hook.rerender(undefined);
      await Promise.resolve();
    });
    await act(async () => {
      await hook.result.current.refreshUser();
      await hook.result.current.loadMoreUserTopics();
    });

    expect(getUserProfile).toHaveBeenCalledTimes(1);
    expect(hook.result.current.userProfile).toMatchObject({
      source: user.source,
      id: user.id,
      username: user.username,
      displayName: user.displayName
    });
  });

  it('REG-USER-001 keeps topic and reply cursors independent', async () => {
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async ({ cursorType }) => {
      if (!cursorType) {
        return {
          ...user,
          hasMoreTopics: true,
          nextTopicsCursor: 'topics-2',
          hasMoreReplies: true,
          nextRepliesCursor: 'replies-2'
        };
      }
      return cursorType === 'topics'
        ? {
            ...user,
            topics: [
              {
                source: 'nodeseek',
                id: 'topic-2',
                title: '第二页主题',
                author: 'alice',
                url: 'https://www.nodeseek.com/post-2-1',
                createdAt: '2026-07-20T00:00:00.000Z',
                replyCount: 0
              }
            ],
            hasMoreTopics: false,
            nextTopicsCursor: null
          }
        : {
            ...user,
            replies: [
              {
                source: 'nodeseek',
                id: 'reply-2',
                topicId: 'topic-2',
                topicTitle: '第二页主题',
                topicUrl: 'https://www.nodeseek.com/post-2-1',
                url: 'https://www.nodeseek.com/post-2-2'
              }
            ],
            hasMoreReplies: false,
            nextRepliesCursor: null
          };
    });
    const hook = await renderUserController({ getUserProfile });
    await waitFor(() => expect(hook.result.current.userProfile?.nextTopicsCursor).toBe('topics-2'));
    await act(async () => {
      await Promise.all([hook.result.current.loadMoreUserTopics(), hook.result.current.loadMoreUserReplies()]);
    });

    await waitFor(() => {
      expect(hook.result.current.userProfile?.topics.map(({ id }) => id)).toEqual(['topic-2']);
      expect(hook.result.current.userProfile?.replies?.map(({ id }) => id)).toEqual(['reply-2']);
    });
    expect(getUserProfile.mock.calls.map(([request]) => request.cursorType)).toEqual([undefined, 'topics', 'replies']);
  });

  it('[REG-USER-007] refreshes the profile as a fresh pagination snapshot and exposes its busy state', async () => {
    const firstTopic = {
      source: 'nodeseek' as const,
      id: 'topic-1',
      title: '旧首屏主题',
      author: 'alice',
      url: 'https://www.nodeseek.com/post-1-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const staleSecondTopic = {
      ...firstTopic,
      id: 'topic-2',
      title: '旧第二页主题',
      url: 'https://www.nodeseek.com/post-2-1'
    };
    const refreshedTopic = {
      ...firstTopic,
      id: 'topic-3',
      title: '刷新后的首屏主题',
      url: 'https://www.nodeseek.com/post-3-1'
    };
    const refresh = Promise.withResolvers<UserProfile>();
    const getUserProfile = jest
      .fn<ReadGateway['getUserProfile']>()
      .mockResolvedValueOnce({
        ...user,
        topics: [firstTopic],
        hasMoreTopics: true,
        nextTopicsCursor: 'topics-2'
      })
      .mockResolvedValueOnce({
        ...user,
        topics: [staleSecondTopic],
        hasMoreTopics: false,
        nextTopicsCursor: null
      })
      .mockImplementationOnce(async () => refresh.promise);
    const hook = await renderUserController({ getUserProfile });
    await waitFor(() => expect(hook.result.current.userProfile?.nextTopicsCursor).toBe('topics-2'));
    await act(async () => {
      await hook.result.current.loadMoreUserTopics();
    });
    await waitFor(() =>
      expect(hook.result.current.userProfile?.topics.map(({ id }) => id)).toEqual(['topic-1', 'topic-2'])
    );

    let refreshOpen!: Promise<unknown>;
    await act(async () => {
      refreshOpen = hook.result.current.refreshUser();
      await Promise.resolve();
    });
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(hook.result.current.userBusy).toBe(true));

    await act(async () => {
      refresh.resolve({
        ...user,
        topics: [refreshedTopic],
        hasMoreTopics: true,
        nextTopicsCursor: 'fresh-topics-2'
      });
      await refreshOpen;
    });

    await waitFor(() => {
      expect(hook.result.current.userBusy).toBe(false);
      expect(hook.result.current.userProfile?.topics.map(({ id }) => id)).toEqual(['topic-3']);
      expect(hook.result.current.userProfile?.nextTopicsCursor).toBe('fresh-topics-2');
    });
  });

  it('isolates a replacement credential scope from the previous cached profile', async () => {
    const replacement = Promise.withResolvers<UserProfile>();
    const oldRouteProfile: UserProfile = {
      ...user,
      avatar: 'https://www.nodeseek.com/avatar/alice-old.png',
      bio: '账号 A 的个人简介',
      displayName: '账号 A 看到的 Alice',
      levelLabel: 'LV99',
      topics: [
        {
          source: 'nodeseek',
          id: 'old-topic',
          title: '账号 A 的旧主题',
          author: 'alice',
          url: 'https://www.nodeseek.com/post-old-1',
          createdAt: '2026-07-20T00:00:00.000Z',
          replyCount: 0
        }
      ]
    };
    const getUserProfile = jest
      .fn<ReadGateway['getUserProfile']>()
      .mockResolvedValueOnce(oldRouteProfile)
      .mockImplementationOnce(async () => replacement.promise);
    let sessionEpochs = initialForumSessionEpochs;
    const hook = await renderUserController({
      getSessionEpochs: () => sessionEpochs,
      getUser: () => oldRouteProfile,
      getUserProfile
    });
    await waitFor(() =>
      expect(hook.result.current.userProfile).toMatchObject({
        source: 'nodeseek',
        id: '1',
        username: 'alice',
        displayName: '账号 A 看到的 Alice'
      })
    );

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
      sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
      hook.rerender(undefined);
    });
    expect(hook.result.current.userProfile).toBeNull();
    expect(hook.result.current.selectedUser).toEqual({
      source: 'nodeseek',
      id: '1',
      username: 'alice',
      displayName: '账号 A 看到的 Alice',
      avatar: 'https://www.nodeseek.com/avatar/alice-old.png',
      url: 'https://www.nodeseek.com/space/1'
    });
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(2));

    await act(async () => {
      replacement.resolve({ ...user, displayName: 'New session' });
      await replacement.promise;
    });
    await waitFor(() => expect(hook.result.current.userProfile?.displayName).toBe('New session'));
  });

  it('REG-USER-006 REG-LINUXDO-002 seeds the visible cursor before verification retries the exact failed page', async () => {
    const linuxUser: UserProfile = {
      ...user,
      source: 'linuxdo',
      id: 'alice',
      url: 'https://linux.do/u/alice',
      hasMoreTopics: true,
      nextTopicsCursor: 'topics-2'
    };
    const secondTopic = {
      source: 'linuxdo' as const,
      id: 'topic-2',
      title: '第二页主题',
      author: 'alice',
      url: 'https://linux.do/t/topic-2',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    let attempts = 0;
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async ({ cursorType }) => {
      if (!cursorType) return linuxUser;
      attempts += 1;
      if (attempts === 1) throw new LinuxDoCloudflareError();
      return { ...linuxUser, topics: [secondTopic], hasMoreTopics: false, nextTopicsCursor: null };
    });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderUserController({
      getUser: () => linuxUser,
      getUserProfile,
      showLinuxDoVerification
    });
    await waitFor(() => expect(hook.result.current.userProfile?.nextTopicsCursor).toBe('topics-2'));
    await act(async () => {
      await hook.result.current.loadMoreUserTopics();
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    await act(async () => {
      resetForumSourceQueries('linuxdo', appQueryClient, recovery.queryKey);
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    await waitFor(() => expect(hook.result.current.userProfile?.topics).toEqual([secondTopic]));
    expect(attempts).toBe(2);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('REG-LINUXDO-003 reports an ordinary user recovery failure instead of another verification result', async () => {
    const linuxUser: UserProfile = {
      ...user,
      source: 'linuxdo',
      id: 'alice',
      url: 'https://linux.do/u/alice'
    };
    const getUserProfile = jest
      .fn<ReadGateway['getUserProfile']>()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new Error('恢复后网络失败'));
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    await renderUserController({
      getUser: () => linuxUser,
      getUserProfile,
      showLinuxDoVerification
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('verification-required');
    });
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('failed');
    });
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    expect(getUserProfile).toHaveBeenCalledTimes(3);
  });

  it('[REG-SOURCE-002] does not cache a parse-empty profile', async () => {
    const parsedEmpty = annotateSourceDiagnosticSummary(
      { ...user, displayName: '', topics: [] },
      {
        parserVariant: 'html-user',
        candidateCount: 1,
        validCount: 0,
        droppedCount: 1,
        isExpectedEmpty: false
      }
    );
    const hook = await renderUserController({
      getUserProfile: jest.fn<ReadGateway['getUserProfile']>(async () => parsedEmpty)
    });
    await waitFor(() => expect(hook.result.current.userError?.message).toContain('解析为空'));
    expect(hook.result.current.userProfile).toBeNull();
  });
});
