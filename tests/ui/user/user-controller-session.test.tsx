import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { appQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { resetForumSourceQueries } from '@/features/account/sessionQueryOwnership';
import { useUserController } from '@/features/user/useUserController';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import { LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import type { ReadGateway } from '@/sources/readGateway';
import type { Source, UserProfile, UserReference } from '@/domain/forum/models';
import { resolveForumReadPlan, type ForumReadOperation } from '@/domain/forum/readPlan';
import { isSessionSource, type SessionSource } from '@/domain/forum/sourceCatalog';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
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
  getIdentityTrust,
  getSessionEpochs = () => initialForumSessionEpochs,
  getSourceEnabled = () => true,
  getUser = () => user,
  getUserProfile,
  onRetryIdentityStatus = jest.fn(),
  resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>(),
  showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
  showNodeSeekVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
  showYaohuoLogin = jest.fn<(message?: string) => void>()
}: {
  getActive?: () => boolean;
  getIdentityBarriers?: () => SessionSource[];
  getIdentityTrust?: (source: SessionRuntimeSnapshot['source']) => SessionRuntimeSnapshot['identityTrust'];
  getSessionEpochs?: () => ForumSessionEpochs;
  getSourceEnabled?: (source: Source) => boolean;
  getUser?: () => UserReference;
  getUserProfile: ReadGateway['getUserProfile'];
  onRetryIdentityStatus?: (source: Source) => Promise<unknown> | unknown;
  resolveNodeSeekUser?: ReadGateway['resolveNodeSeekUser'];
  showLinuxDoVerification?: (message?: string, recovery?: LinuxDoReadRecovery) => void;
  showNodeSeekVerification?: (message?: string, recovery?: LinuxDoReadRecovery) => void;
  showYaohuoLogin?: (message?: string) => void;
}) {
  return renderHook(() =>
    useUserController({
      active: getActive(),
      sessionEpochs: getSessionEpochs(),
      notify: jest.fn(),
      onRetryIdentityStatus,
      readerData: createEmptyReaderData(),
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      readGateway: {
        getReadPlan: (source: Source, operation: ForumReadOperation) => {
          const authSurfaceOpen = isSessionSource(source) && getIdentityBarriers().includes(source);
          const identityTrust = isSessionSource(source) ? getIdentityTrust?.(source) || 'confirmed' : undefined;
          return resolveForumReadPlan(
            source,
            operation,
            getSourceEnabled(source),
            isSessionSource(source)
              ? {
                  source,
                  authenticated: identityTrust === 'confirmed',
                  authSurfaceOpen,
                  identityKey: `${source}:test`,
                  identityTrust: identityTrust!,
                  sessionEpoch: getSessionEpochs()[source],
                  sourceEnabled: getSourceEnabled(source)
                }
              : undefined
          );
        },
        getUserProfile,
        resolveNodeSeekUser
      } as unknown as ReadGateway,
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

  it('reads a public LinuxDo User while account identity remains pending', async () => {
    const requested: UserReference = {
      source: 'linuxdo',
      id: '7',
      username: 'alice',
      url: 'https://linux.do/u/alice'
    };
    const profile: UserProfile = { ...user, ...requested, displayName: 'Alice', topics: [] };
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async () => profile);
    const hook = await renderUserController({
      getIdentityBarriers: () => ['linuxdo'],
      getUser: () => requested,
      getUserProfile
    });

    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(hook.result.current.userProfile).toEqual(
        expect.objectContaining({ source: profile.source, id: profile.id, username: profile.username })
      )
    );
    expect(getUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'linuxdo' }),
      expect.objectContaining({ readPlanScope: 'public:omit' })
    );
  });

  it('settles pending NodeSeek username resolution as a terminal blocked result', async () => {
    const requested: UserReference = {
      source: 'nodeseek',
      username: 'alice',
      url: 'https://www.nodeseek.com/member?t=alice'
    };
    const resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>(async () => {
      throw Object.assign(new Error('登录状态暂时无法确认'), {
        kind: 'login-required' as const,
        reason: 'identity-pending',
        retryable: true,
        source: 'nodeseek' as const
      });
    });
    const hook = await renderUserController({
      getIdentityBarriers: () => ['nodeseek'],
      getUser: () => requested,
      getUserProfile: jest.fn<ReadGateway['getUserProfile']>(),
      resolveNodeSeekUser
    });

    await waitFor(() => expect(resolveNodeSeekUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.userError).not.toBeNull());
    expect(hook.result.current.userBusy).toBe(false);
  });

  it('retries an unknown strict User by reconciling identity without replaying transport', async () => {
    const requested: UserReference = {
      source: 'yaohuo',
      id: '7',
      username: 'alice',
      url: 'https://www.yaohuo.me/space-7.html'
    };
    const onRetryIdentityStatus = jest.fn(async () => undefined);
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async () => {
      throw Object.assign(new Error('登录状态核对失败，请重试'), {
        kind: 'ordinary' as const,
        reason: 'identity-unavailable',
        retryable: true,
        source: 'yaohuo' as const
      });
    });
    const hook = await renderUserController({
      getIdentityTrust: () => 'unknown',
      getUser: () => requested,
      getUserProfile,
      onRetryIdentityStatus
    });
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(1));

    await act(async () => {
      await expect(hook.result.current.refreshUser()).resolves.toBe('stale');
    });

    expect(onRetryIdentityStatus).toHaveBeenCalledTimes(1);
    expect(onRetryIdentityStatus).toHaveBeenCalledWith('yaohuo');
    expect(getUserProfile).toHaveBeenCalledTimes(1);
  });

  it('opens Yaohuo login for a typed anonymous User block', async () => {
    const requested: UserReference = {
      source: 'yaohuo',
      id: '7',
      username: 'alice',
      url: 'https://www.yaohuo.me/space-7.html'
    };
    const showYaohuoLogin = jest.fn();
    const getUserProfile = jest.fn<ReadGateway['getUserProfile']>(async () => {
      throw Object.assign(new Error('请先登录该内容源'), {
        kind: 'login-required' as const,
        loginRequired: true,
        reason: 'login-required',
        source: 'yaohuo' as const
      });
    });
    await renderUserController({
      getIdentityTrust: () => 'none',
      getUser: () => requested,
      getUserProfile,
      showYaohuoLogin
    });

    await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(1));
    expect(showYaohuoLogin).toHaveBeenCalledWith('请先登录该内容源');
  });

  it('gates route queries and commands while inactive', async () => {
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

  it('resolves a username before loading the canonical NodeSeek profile', async () => {
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

  it('retries a failed resolution only after explicit refresh', async () => {
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

  it('preserves the exact resolution query for NodeSeek verification recovery', async () => {
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

  it('preserves the exact canonical profile query for NodeSeek verification recovery', async () => {
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
    expect(recovery?.queryKey).toEqual([
      'forum',
      'nodeseek',
      'user',
      { readPlanScope: 'authenticated:0', sessionEpoch: 0, userId: '1414' }
    ]);

    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('completed');
    });
    await waitFor(() => expect(hook.result.current.userProfile).toMatchObject({ id: '1414', username: '男朋友' }));
    expect(resolveNodeSeekUser).not.toHaveBeenCalled();
    expect(getUserProfile).toHaveBeenCalledTimes(2);
  });

  it('does not turn a NodeSeek pagination failure into a user-route recovery', async () => {
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

  it('keeps a known logged-out resolution error out of Cloudflare recovery', async () => {
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

  it('settles blocked resolution, then re-resolves after trust and epoch changes', async () => {
    const reference: UserReference = {
      source: 'nodeseek',
      username: 'xy',
      url: 'https://www.nodeseek.com/member?t=xy'
    };
    let identityBarriers: SessionSource[] = ['nodeseek'];
    let sessionEpochs = initialForumSessionEpochs;
    const resolveNodeSeekUser = jest.fn<ReadGateway['resolveNodeSeekUser']>(async () => {
      if (identityBarriers.includes('nodeseek')) {
        throw Object.assign(new Error('登录状态暂时无法确认'), {
          kind: 'login-required' as const,
          reason: 'identity-pending',
          source: 'nodeseek' as const
        });
      }
      return {
        source: 'nodeseek',
        id: '8052',
        username: 'xy',
        url: 'https://www.nodeseek.com/space/8052'
      };
    });
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
    await waitFor(() => expect(resolveNodeSeekUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.userError).not.toBeNull());
    expect(getUserProfile).not.toHaveBeenCalled();

    identityBarriers = [];
    await act(async () => {
      hook.rerender(undefined);
    });
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(1));
    expect(resolveNodeSeekUser).toHaveBeenCalledTimes(2);

    sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
    await act(async () => {
      hook.rerender(undefined);
    });
    await waitFor(() => expect(resolveNodeSeekUser).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(2));
  });

  it('cancels an old username resolution when the selected user changes', async () => {
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

  it('isolates cached authenticated profile from a pending public read', async () => {
    let identityBarriers: SessionSource[] = [];
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
    await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(2));
    await act(async () => {
      await hook.result.current.refreshUser();
      await hook.result.current.loadMoreUserTopics();
    });

    expect(getUserProfile).toHaveBeenCalledTimes(3);
    expect(getUserProfile.mock.calls.map(([, context]) => context?.readPlanScope)).toEqual([
      'authenticated:0',
      'public:omit',
      'public:omit'
    ]);
    await waitFor(() =>
      expect(hook.result.current.userProfile).toMatchObject({
        source: user.source,
        id: user.id,
        username: user.username,
        displayName: user.displayName
      })
    );
  });

  it.each([false, true])(
    'keeps concurrent topic and reply cursors independent when replies finish first: %s',
    async (repliesFirst) => {
      const topicsReady = Promise.withResolvers<void>();
      const repliesReady = Promise.withResolvers<void>();
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
        await (cursorType === 'topics' ? topicsReady.promise : repliesReady.promise);
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
      const initialTopics = hook.result.current.userProfile?.topics;
      const initialReplies = hook.result.current.userProfile?.replies;
      let requests: Promise<unknown>[] = [];
      await act(async () => {
        requests = [hook.result.current.loadMoreUserTopics(), hook.result.current.loadMoreUserReplies()];
      });
      await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(3));
      await act(async () => {
        (repliesFirst ? repliesReady : topicsReady).resolve();
        await requests[repliesFirst ? 1 : 0];
      });
      const firstLane = repliesFirst ? 'replies' : 'topics';
      const secondLane = repliesFirst ? 'topics' : 'replies';
      await waitFor(() => expect(hook.result.current.userProfile?.[firstLane]).toHaveLength(1));
      expect(hook.result.current.userProfile?.[secondLane]).toBe(repliesFirst ? initialTopics : initialReplies);
      const loadedFirstLane = hook.result.current.userProfile?.[firstLane];
      await act(async () => {
        (repliesFirst ? topicsReady : repliesReady).resolve();
        await Promise.all(requests);
      });
      await waitFor(() => expect(hook.result.current.userProfile?.[secondLane]).toHaveLength(1));
      expect(hook.result.current.userProfile?.[firstLane]).toBe(loadedFirstLane);

      await waitFor(() => {
        expect(hook.result.current.userProfile?.topics.map(({ id }) => id)).toEqual(['topic-2']);
        expect(hook.result.current.userProfile?.replies?.map(({ id }) => id)).toEqual(['reply-2']);
      });
      expect(getUserProfile.mock.calls.map(([request]) => request.cursorType)).toEqual([
        undefined,
        'topics',
        'replies'
      ]);
    }
  );

  describe('profile refresh', () => {
    const firstTopic = {
      source: 'nodeseek' as const,
      id: 'topic-1',
      title: '已加载的主题',
      author: 'alice',
      url: 'https://www.nodeseek.com/post-1-1',
      createdAt: '2026-09-05T00:00:00Z',
      replyCount: 0
    };
    const firstReply = {
      source: 'nodeseek' as const,
      id: 'reply-1',
      topicId: firstTopic.id,
      topicTitle: firstTopic.title,
      topicUrl: firstTopic.url,
      url: `${firstTopic.url}#1`
    };
    const firstPage: UserProfile = {
      ...user,
      topics: [firstTopic],
      replies: [firstReply],
      hasMoreTopics: true,
      nextTopicsCursor: 'topics-2',
      hasMoreReplies: true,
      nextRepliesCursor: 'replies-2'
    };

    it.each([false, true])('preserves both loaded lanes after refresh failure with more pages: %s', async (hasMore) => {
      const getUserProfile = jest
        .fn<ReadGateway['getUserProfile']>()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce({
          ...firstPage,
          topics: [{ ...firstTopic, id: 'topic-2' }],
          hasMoreTopics: hasMore,
          nextTopicsCursor: hasMore ? 'topics-3' : null
        })
        .mockResolvedValueOnce({
          ...firstPage,
          replies: [{ ...firstReply, id: 'reply-2' }],
          hasMoreReplies: hasMore,
          nextRepliesCursor: hasMore ? 'replies-3' : null
        })
        .mockRejectedValueOnce(new Error('刷新网络失败'));
      const hook = await renderUserController({ getUserProfile });
      await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(1));
      await act(async () => {
        await hook.result.current.loadMoreUserTopics();
        await hook.result.current.loadMoreUserReplies();
      });
      await waitFor(() => {
        expect(hook.result.current.userProfile?.topics).toHaveLength(2);
        expect(hook.result.current.userProfile?.replies).toHaveLength(2);
      });
      const loaded = hook.result.current.userProfile;
      const lanes = appQueryClient
        .getQueryCache()
        .getAll()
        .filter(({ queryKey }) => queryKey[2] === 'user' && queryKey.length === 5)
        .map(({ queryKey, state }) => ({ queryKey, data: state.data }));
      expect(lanes).toHaveLength(2);
      await act(async () => {
        await expect(hook.result.current.refreshUser()).resolves.toBe('failed');
      });
      await waitFor(() => expect(hook.result.current.userError?.message).toBe('刷新网络失败'));
      expect(hook.result.current.userProfile).toBe(loaded);
      for (const lane of lanes) expect(appQueryClient.getQueryData(lane.queryKey)).toBe(lane.data);
      expect(hook.result.current.userBusy).toBe(false);

      if (hasMore)
        getUserProfile
          .mockResolvedValueOnce({
            ...firstPage,
            topics: [{ ...firstTopic, id: 'topic-3' }],
            hasMoreTopics: false,
            nextTopicsCursor: null
          })
          .mockResolvedValueOnce({
            ...firstPage,
            replies: [{ ...firstReply, id: 'reply-3' }],
            hasMoreReplies: false,
            nextRepliesCursor: null
          });
      await act(async () => {
        await hook.result.current.loadMoreUserTopics();
        await hook.result.current.loadMoreUserReplies();
      });
      if (hasMore) {
        expect(getUserProfile.mock.calls.slice(4).map(([request]) => [request.cursorType, request.cursor])).toEqual([
          ['topics', 'topics-3'],
          ['replies', 'replies-3']
        ]);
        await waitFor(() => {
          expect(hook.result.current.userProfile?.topics.map(({ id }) => id)).toEqual([
            'topic-1',
            'topic-2',
            'topic-3'
          ]);
          expect(hook.result.current.userProfile?.replies?.map(({ id }) => id)).toEqual([
            'reply-1',
            'reply-2',
            'reply-3'
          ]);
        });
      } else {
        expect(getUserProfile).toHaveBeenCalledTimes(4);
      }
      getUserProfile.mockResolvedValueOnce(firstPage);
      await act(async () => {
        await expect(hook.result.current.refreshUser()).resolves.toBe('completed');
      });
      await waitFor(() => {
        expect(hook.result.current.userProfile).toEqual(firstPage);
        expect(hook.result.current.userError).toBeNull();
      });
    });

    it.each(['cancel', 'cancel-after-error', 'inactive', 'user', 'epoch', 'other-source-epoch'] as const)(
      'ignores a pending refresh after %s without rebuilding cached pages',
      async (change) => {
        const pending = Promise.withResolvers<UserProfile>();
        let active = true;
        let selectedUser = user;
        let epochs = initialForumSessionEpochs;
        let signal: AbortSignal | undefined;
        const getUserProfile = jest
          .fn<ReadGateway['getUserProfile']>()
          .mockResolvedValueOnce(firstPage)
          .mockResolvedValueOnce({ ...firstPage, topics: [{ ...firstTopic, id: 'topic-2' }] });
        if (change === 'cancel-after-error') getUserProfile.mockRejectedValueOnce(new Error('上次刷新失败'));
        getUserProfile
          .mockImplementationOnce(async (request) => {
            signal = request.signal;
            return pending.promise;
          })
          .mockResolvedValue({ ...firstPage, displayName: '新的页面身份' });
        const hook = await renderUserController({
          getUserProfile,
          getActive: () => active,
          getUser: () => selectedUser,
          getSessionEpochs: () => epochs
        });
        await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(1));
        await act(async () => {
          await hook.result.current.loadMoreUserTopics();
        });
        await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(2));
        if (change === 'cancel-after-error') {
          await act(async () => {
            await expect(hook.result.current.refreshUser()).resolves.toBe('failed');
          });
          await waitFor(() => expect(hook.result.current.userError?.message).toBe('上次刷新失败'));
        }
        const profileKey = appQueryClient
          .getQueryCache()
          .getAll()
          .find(({ queryKey }) => queryKey[2] === 'user' && queryKey.length === 4)!.queryKey;
        const laneKey = [...profileKey, 'topics'];
        const loaded = appQueryClient.getQueryData(laneKey);
        let refreshing!: Promise<unknown>;
        await act(async () => {
          refreshing = hook.result.current.refreshUser();
        });
        await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(change === 'cancel-after-error' ? 4 : 3));
        await act(async () => {
          if (change === 'cancel' || change === 'cancel-after-error')
            await appQueryClient.cancelQueries({ queryKey: profileKey, exact: true });
          if (change === 'inactive') active = false;
          if (change === 'user') selectedUser = { ...user, id: '2', username: 'bob' };
          if (change === 'epoch') {
            resetForumSourceQueries('nodeseek', appQueryClient);
            epochs = { ...epochs, nodeseek: epochs.nodeseek + 1 };
          }
          if (change === 'other-source-epoch') epochs = { ...epochs, linuxdo: epochs.linuxdo + 1 };
          hook.rerender(undefined);
        });
        await waitFor(() => expect(signal?.aborted).toBe(true));
        await act(async () => {
          pending.resolve({ ...firstPage, displayName: '过期的刷新结果', topics: [] });
          await expect(refreshing).resolves.toBe('stale');
        });
        if (change === 'epoch') expect(appQueryClient.getQueryData(laneKey)).toBeUndefined();
        else expect(appQueryClient.getQueryData(laneKey)).toBe(loaded);
        if (change === 'user' || change === 'epoch') {
          await waitFor(() => expect(hook.result.current.userProfile?.displayName).toBe('新的页面身份'));
        } else {
          expect(hook.result.current.userProfile?.topics).toHaveLength(2);
        }
        expect(hook.result.current.userBusy).toBe(false);
      }
    );

    it.each(['unchanged', 'empty'] as const)(
      'applies a successful %s refresh even within the previous update millisecond',
      async (scenario) => {
        const pending = Promise.withResolvers<UserProfile>();
        const getUserProfile = jest
          .fn<ReadGateway['getUserProfile']>()
          .mockResolvedValueOnce(firstPage)
          .mockResolvedValueOnce({ ...firstPage, topics: [{ ...firstTopic, id: 'topic-2' }] })
          .mockImplementationOnce(async () => pending.promise);
        const hook = await renderUserController({ getUserProfile });
        await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(1));
        await act(async () => {
          await hook.result.current.loadMoreUserTopics();
        });
        await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(2));
        const before = appQueryClient
          .getQueryCache()
          .getAll()
          .find(({ queryKey }) => queryKey[2] === 'user' && queryKey.length === 4)!.state;
        let refreshing!: Promise<unknown>;
        await act(async () => {
          refreshing = hook.result.current.refreshUser();
        });
        await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(3));
        const fresh =
          scenario === 'empty'
            ? {
                ...firstPage,
                topics: [],
                replies: [],
                hasMoreTopics: false,
                nextTopicsCursor: null,
                hasMoreReplies: false,
                nextRepliesCursor: null
              }
            : firstPage;
        const clock = jest.spyOn(Date, 'now').mockReturnValue(before.dataUpdatedAt);
        try {
          await act(async () => {
            pending.resolve(fresh);
            await expect(refreshing).resolves.toBe('completed');
          });
        } finally {
          clock.mockRestore();
        }
        await waitFor(() => {
          expect(hook.result.current.userProfile).toEqual(fresh);
          expect(hook.result.current.userError).toBeNull();
          expect(hook.result.current.userBusy).toBe(false);
        });
      }
    );
  });

  it('refreshes the profile as a fresh pagination snapshot and exposes its busy state', async () => {
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

  it('seeds the visible cursor before verification retries the exact failed page', async () => {
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
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    await waitFor(() => expect(hook.result.current.userProfile?.topics).toEqual([secondTopic]));
    expect(attempts).toBe(2);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('reports an ordinary user recovery failure instead of another verification result', async () => {
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

  it('does not cache a parse-empty profile', async () => {
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
