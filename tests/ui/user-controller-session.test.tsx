import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { appQueryClient, resetForumSourceQueries } from '../../src/app/serverState';
import { useUserController } from '../../src/app/useUserController';
import type { LinuxDoReadRecovery } from '../../src/app/useVerificationController';
import { LinuxDoCloudflareError } from '../../src/cloudflareChallenge';
import { createEmptyReaderData } from '../../src/readerData';
import { createSiteSessionStates, createSiteSessionViewModels } from '../../src/siteSessionState';
import type { SourceGateway } from '../../src/sources/sourceGateway';
import type { UserProfile } from '../../src/types';

const user: UserProfile = {
  source: 'nodeseek',
  id: 'alice',
  username: 'alice',
  displayName: 'Alice',
  url: 'https://www.nodeseek.com/space/1',
  topics: []
};

describe('user controller session isolation', () => {
  it('clears a changed source profile without disturbing it for another source transition', async () => {
    const hook = await renderHook(() => useUserController({
      notify: jest.fn(),
      onOpenUserScreen: jest.fn(),
      readerData: createEmptyReaderData(),
      screen: 'user',
      sessionViewModels: createSiteSessionViewModels(createSiteSessionStates()),
      showLinuxDoVerification: jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
      showNodeSeekVerification: jest.fn(),
      showYaohuoLogin: jest.fn(),
      sourceGateway: {
        getUserProfile: jest.fn(async () => user)
      } as unknown as SourceGateway
    }));

    await act(async () => {
      await hook.result.current.openUser(user);
    });
    await waitFor(() => expect(hook.result.current.userProfile).toMatchObject({ source: 'nodeseek', id: 'alice' }));

    await act(async () => {
      resetForumSourceQueries('linuxdo', appQueryClient, 'login-expired');
    });
    expect(hook.result.current.userProfile).toMatchObject({ source: 'nodeseek', id: 'alice' });

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient, 'login-expired');
    });

    expect(hook.result.current.selectedUser).toMatchObject({ source: 'nodeseek', id: '1' });
    expect(hook.result.current.userProfile).toBeNull();
    expect(hook.result.current.userBusy).toBe(false);
    expect(hook.result.current.userError?.message).toContain('会话已变化');
  });

  it.each(['topics', 'replies'] as const)(
    'REG-LINUXDO-002 preserves the loaded user profile across session reset before resuming %s pagination',
    async (lane) => {
      const firstTopic = {
        source: 'linuxdo' as const,
        id: 'topic-1',
        title: '第一页帖子',
        author: 'alice',
        url: 'https://linux.do/t/topic-1',
        createdAt: '2026-07-20T00:00:00.000Z',
        replyCount: 0
      };
      const secondTopic = {
        ...firstTopic,
        id: 'topic-2',
        title: '第二页帖子',
        url: 'https://linux.do/t/topic-2'
      };
      const firstReply = {
        source: 'linuxdo' as const,
        id: 'reply-1',
        topicId: 'topic-1',
        topicTitle: '第一页帖子',
        topicUrl: 'https://linux.do/t/topic-1',
        url: 'https://linux.do/t/topic-1/1',
        excerpt: '第一页回复'
      };
      const secondReply = {
        ...firstReply,
        id: 'reply-2',
        url: 'https://linux.do/t/topic-1/2',
        excerpt: '第二页回复'
      };
      const linuxDoUser: UserProfile = {
        source: 'linuxdo',
        id: 'alice',
        username: 'alice',
        displayName: 'Alice',
        url: 'https://linux.do/u/alice',
        topics: [firstTopic],
        hasMoreTopics: true,
        nextTopicsCursor: 'topics-2',
        replies: [firstReply],
        hasMoreReplies: true,
        nextRepliesCursor: 'replies-2'
      };
      let paginationAttempts = 0;
      const getUserProfile = jest.fn(async ({ cursorType }: { cursorType?: 'topics' | 'replies' }) => {
        if (!cursorType) {
          return linuxDoUser;
        }
        paginationAttempts += 1;
        if (paginationAttempts === 1) {
          throw new LinuxDoCloudflareError();
        }
        return lane === 'topics'
          ? {
            ...linuxDoUser,
            topics: [secondTopic],
            replies: [],
            hasMoreTopics: false,
            nextTopicsCursor: null
          }
          : {
            ...linuxDoUser,
            topics: [],
            replies: [secondReply],
            hasMoreReplies: false,
            nextRepliesCursor: null
          };
      });
      const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
      const hook = await renderHook(() => useUserController({
        notify: jest.fn(),
        onOpenUserScreen: jest.fn(),
        readerData: createEmptyReaderData(),
        screen: 'user',
        sessionViewModels: createSiteSessionViewModels(createSiteSessionStates({
          linuxdo: {
            site: 'linuxdo',
            status: 'logged-in',
            cookieSummary: ['session-present'],
            isVerifying: false
          }
        })),
        showLinuxDoVerification,
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        sourceGateway: { getUserProfile } as unknown as SourceGateway
      }));

      await act(async () => {
        await hook.result.current.openUser(linuxDoUser);
      });
      await waitFor(() => expect(hook.result.current.userProfile).toEqual(linuxDoUser));
      await act(async () => {
        await (lane === 'topics'
          ? hook.result.current.loadMoreUserTopics()
          : hook.result.current.loadMoreUserReplies());
      });

      const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;
      expect(recovery).toBeDefined();
      await act(async () => {
        resetForumSourceQueries('linuxdo', appQueryClient, 'session-updated', recovery.key);
      });

      expect(hook.result.current.userProfile).toEqual(linuxDoUser);
      expect(hook.result.current.userLoadingMoreTopics).toBe(false);
      expect(hook.result.current.userLoadingMoreReplies).toBe(false);

      await act(async () => {
        await expect(recovery.resume()).resolves.toBe('completed');
      });

      expect(paginationAttempts).toBe(2);
      if (lane === 'topics') {
        expect(hook.result.current.userProfile?.topics.map(({ id }) => id)).toEqual(['topic-1', 'topic-2']);
      } else {
        expect(hook.result.current.userProfile?.replies?.map(({ id }) => id)).toEqual(['reply-1', 'reply-2']);
      }
      expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    }
  );
});
