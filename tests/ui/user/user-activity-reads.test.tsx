import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createReadGateway } from '@/sources/readGateway';
import { appQueryClient } from '@/platform/query/serverState';
import { useUserController } from '@/features/user/useUserController';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import type { Source } from '@/domain/forum/models';
import { QueryTestWrapper } from '../QueryTestWrapper';

import { userResponses, laneFor } from '../../fixtures/userActivityEvidence';

function setup(source: Source, empty = false) {
  let failure: 'topics' | 'replies' | undefined;
  const responses = userResponses(source, empty);
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    const lane = laneFor(url);
    if (lane === failure) return new Response('activity unavailable', { status: 503 });
    if (url.includes('/feed/member/')) return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    return new Response(responses[lane]);
  };
  const gateway = createReadGateway({
    fetcher,
    anonymousFetcher: fetcher,
    nodeSeekUserAgent: () => 'test-agent',
    getEnabledSources: () => [source],
    readSessionRuntimeSnapshot: (site) => ({
      source: site,
      authenticated: true,
      authSurfaceOpen: false,
      identityKey: `${site}:7`,
      identityTrust: 'confirmed',
      sessionEpoch: 0,
      sourceEnabled: true
    })
  });
  return {
    urls,
    fail: (lane: typeof failure) => {
      failure = lane;
    },
    mount: () =>
      renderHook(
        () =>
          useUserController({
            active: true,
            notify: jest.fn(),
            readerData: createEmptyReaderData(),
            readGateway: gateway,
            showLinuxDoVerification: jest.fn(() => undefined),
            showNodeSeekVerification: jest.fn(),
            showYaohuoLogin: jest.fn(),
            user: { source, id: '7', username: 'alice', url: 'https://example.com/user-fixture' }
          }),
        { wrapper: QueryTestWrapper }
      )
  };
}

describe.each(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo'] as const)('%s independent user activity reads', (source) => {
  beforeEach(() => appQueryClient.clear());
  it.each(['topics', 'replies'] as const)(
    'keeps the profile and other lane usable when %s fails, then retries only that lane',
    async (lane) => {
      const fixture = setup(source);
      fixture.fail(lane);
      const hook = await fixture.mount();
      await waitFor(() => expect(hook.result.current.userProfile?.username).toBe('alice'));
      await waitFor(() =>
        expect(
          lane === 'topics' ? hook.result.current.userTopicsError : hook.result.current.userRepliesError
        ).not.toBeNull()
      );
      expect(hook.result.current.userProfile?.[lane]).toBeUndefined();
      const other = lane === 'topics' ? 'replies' : 'topics';
      await waitFor(() => expect(hook.result.current.userProfile?.[other]).toHaveLength(1));
      const good = hook.result.current.userProfile?.[other];
      const before = fixture.urls.length;
      fixture.fail(undefined);
      await act(async () => {
        await (lane === 'topics' ? hook.result.current.retryUserTopics() : hook.result.current.retryUserReplies());
      });
      await waitFor(() => expect(hook.result.current.userProfile?.[lane]).toHaveLength(1));
      expect(hook.result.current.userProfile?.[other]).toBe(good);
      expect(fixture.urls.slice(before).some((url) => laneFor(url) === other)).toBe(false);
      expect(fixture.urls.slice(before)).toHaveLength(source === 'yaohuo' ? 2 : 1);
      await hook.unmount();
    }
  );

  it('reads only the evidenced profile and activity endpoints for the first screen', async () => {
    const fixture = setup(source);
    const hook = await fixture.mount();
    await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.userProfile?.replies).toHaveLength(1));
    expect(fixture.urls.filter((url) => laneFor(url) === 'details')).toHaveLength(source === 'yaohuo' ? 3 : 1);
    expect(fixture.urls.filter((url) => laneFor(url) === 'topics')).toHaveLength(1);
    expect(fixture.urls.filter((url) => laneFor(url) === 'replies')).toHaveLength(1);
    await hook.unmount();
  });

  it('distinguishes a successful empty activity result from a failed read', async () => {
    const hook = await setup(source, true).mount();
    await waitFor(() => expect(hook.result.current.userProfile?.topics).toEqual([]));
    await waitFor(() => expect(hook.result.current.userProfile?.replies).toEqual([]));
    expect(hook.result.current.userTopicsError).toBeNull();
    expect(hook.result.current.userRepliesError).toBeNull();
    await hook.unmount();
  });

  it.each(['topics', 'replies'] as const)('retains trusted %s data when a refresh fails', async (lane) => {
    const fixture = setup(source);
    const hook = await fixture.mount();
    await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.userProfile?.replies).toHaveLength(1));
    const previous = hook.result.current.userProfile?.[lane];
    fixture.fail(lane);
    await act(async () => {
      await expect(hook.result.current.refreshUser()).resolves.toBe('failed');
    });
    expect(hook.result.current.userProfile?.[lane]).toBe(previous);
    expect(hook.result.current.userError).toBeNull();
    await hook.unmount();
  });
});
