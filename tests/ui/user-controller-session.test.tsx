import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import {
  appQueryClient,
  emptyForumCredentialScope,
  type ForumCredentialScope
} from '../../src/app/serverState';
import { resetForumSourceQueries } from '../../src/app/sessionControllerHelpers';
import { useUserController } from '../../src/app/useUserController';
import type { LinuxDoReadRecovery } from '../../src/app/useVerificationController';
import { LinuxDoCloudflareError } from '../../src/cloudflareChallenge';
import { createEmptyReaderData } from '../../src/readerData';
import { annotateSourceDiagnosticSummary } from '../../src/sourceAdapterDiagnostics';
import type { SourceGateway } from '../../src/sources/sourceGateway';
import type { UserProfile } from '../../src/types';
import { QueryTestWrapper } from './QueryTestWrapper';

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
  getCredentialScope = () => emptyForumCredentialScope,
  getUserProfile,
  showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>()
}: {
  getCredentialScope?: () => ForumCredentialScope;
  getUserProfile: SourceGateway['getUserProfile'];
  showLinuxDoVerification?: (message?: string, recovery?: LinuxDoReadRecovery) => void;
}) {
  return renderHook(() => useUserController({
    credentialScope: getCredentialScope(),
    notify: jest.fn(),
    onOpenUserScreen: jest.fn(),
    readerData: createEmptyReaderData(),
    screen: 'user',
    showLinuxDoVerification,
    showNodeSeekVerification: jest.fn(),
    showYaohuoLogin: jest.fn(),
    sourceGateway: { getUserProfile } as unknown as SourceGateway
  }));
}

describe('user query controller', () => {
  beforeEach(() => appQueryClient.clear());
  afterEach(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  it('loads the profile once and seeds both pagination lanes without repeating first-page transport', async () => {
    const getUserProfile = jest.fn<SourceGateway['getUserProfile']>(async () => ({
      ...user,
      topics: [{
        source: 'nodeseek',
        id: 'topic-1',
        title: '首屏主题',
        author: 'alice',
        url: 'https://www.nodeseek.com/post-1-1',
        createdAt: '2026-07-20T00:00:00.000Z',
        replyCount: 0
      }],
      replies: []
    }));
    const hook = await renderUserController({ getUserProfile });

    await act(async () => { void hook.result.current.openUser(user); });
    await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(1));

    expect(getUserProfile).toHaveBeenCalledTimes(1);
    expect(getUserProfile.mock.calls[0]?.[0]).not.toHaveProperty('cursorType');
  });

  it('REG-USER-001 keeps topic and reply cursors independent', async () => {
    const getUserProfile = jest.fn<SourceGateway['getUserProfile']>(async ({ cursorType }) => {
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
          topics: [{
            source: 'nodeseek',
            id: 'topic-2',
            title: '第二页主题',
            author: 'alice',
            url: 'https://www.nodeseek.com/post-2-1',
            createdAt: '2026-07-20T00:00:00.000Z',
            replyCount: 0
          }],
          hasMoreTopics: false,
          nextTopicsCursor: null
        }
        : {
          ...user,
          replies: [{
            source: 'nodeseek',
            id: 'reply-2',
            topicId: 'topic-2',
            topicTitle: '第二页主题',
            topicUrl: 'https://www.nodeseek.com/post-2-1',
            url: 'https://www.nodeseek.com/post-2-2'
          }],
          hasMoreReplies: false,
          nextRepliesCursor: null
        };
    });
    const hook = await renderUserController({ getUserProfile });

    await act(async () => { void hook.result.current.openUser(user); });
    await waitFor(() => expect(hook.result.current.userProfile?.nextTopicsCursor).toBe('topics-2'));
    await act(async () => {
      await Promise.all([
        hook.result.current.loadMoreUserTopics(),
        hook.result.current.loadMoreUserReplies()
      ]);
    });

    await waitFor(() => {
      expect(hook.result.current.userProfile?.topics.map(({ id }) => id)).toEqual(['topic-2']);
      expect(hook.result.current.userProfile?.replies?.map(({ id }) => id)).toEqual(['reply-2']);
    });
    expect(getUserProfile.mock.calls.map(([request]) => request.cursorType)).toEqual([undefined, 'topics', 'replies']);
  });

  it('isolates a replacement credential scope from the previous cached profile', async () => {
    const replacement = Promise.withResolvers<UserProfile>();
    const getUserProfile = jest.fn<SourceGateway['getUserProfile']>()
      .mockResolvedValueOnce(user)
      .mockImplementationOnce(async () => replacement.promise);
    let credentialScope = emptyForumCredentialScope;
    const hook = await renderUserController({ getCredentialScope: () => credentialScope, getUserProfile });

    await act(async () => { void hook.result.current.openUser(user); });
    await waitFor(() => expect(hook.result.current.userProfile).toMatchObject({
      source: 'nodeseek',
      id: '1',
      username: 'alice',
      displayName: 'Alice'
    }));

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
      credentialScope = { ...credentialScope, nodeseek: credentialScope.nodeseek + 1 };
      hook.rerender(undefined);
    });
    expect(hook.result.current.userProfile).toBeNull();
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
    const getUserProfile = jest.fn<SourceGateway['getUserProfile']>(async ({ cursorType }) => {
      if (!cursorType) return linuxUser;
      attempts += 1;
      if (attempts === 1) throw new LinuxDoCloudflareError();
      return { ...linuxUser, topics: [secondTopic], hasMoreTopics: false, nextTopicsCursor: null };
    });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderUserController({ getUserProfile, showLinuxDoVerification });

    await act(async () => { void hook.result.current.openUser(linuxUser); });
    await waitFor(() => expect(hook.result.current.userProfile?.nextTopicsCursor).toBe('topics-2'));
    await act(async () => { await hook.result.current.loadMoreUserTopics(); });
    await waitFor(
      () => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1),
      { timeout: 3000 }
    );
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
    const getUserProfile = jest.fn<SourceGateway['getUserProfile']>()
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new LinuxDoCloudflareError())
      .mockRejectedValueOnce(new Error('恢复后网络失败'));
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const hook = await renderUserController({ getUserProfile, showLinuxDoVerification });

    await act(async () => { void hook.result.current.openUser(linuxUser); });
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
    const parsedEmpty = annotateSourceDiagnosticSummary({ ...user, displayName: '', topics: [] }, {
      parserVariant: 'html-user',
      candidateCount: 1,
      validCount: 0,
      droppedCount: 1,
      isExpectedEmpty: false
    });
    const hook = await renderUserController({
      getUserProfile: jest.fn<SourceGateway['getUserProfile']>(async () => parsedEmpty)
    });

    await act(async () => { void hook.result.current.openUser(user); });
    await waitFor(() => expect(hook.result.current.userError?.message).toContain('解析为空'));
    expect(hook.result.current.userProfile).toBeNull();
  });
});
