import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createReadGateway } from '@/sources/readGateway';
import { appQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useUserController } from '@/features/user/useUserController';
import { UserRoute, UserRouteRuntimeProvider, type UserRouteRuntimeValue } from '@/features/user/UserRoute';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { Source } from '@/domain/forum/models';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { fireEvent, render } from '../render';

import { createUserActivityResponse, laneFor } from '../../fixtures/userActivityEvidence';

function setup(source: Source, empty = false, activityResponse?: (url: string) => Response | undefined) {
  let failure: 'topics' | 'replies' | undefined;
  const responseFor = createUserActivityResponse(source, empty);
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    return activityResponse?.(url) ?? responseFor(url, failure);
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
    gateway,
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

const Stack = createNativeStackNavigator<RootStackParamList>();

describe('NodeSeek profile error recovery', () => {
  beforeEach(() => appQueryClient.clear());

  const lookup = '/api/account/find/alice';
  const profilePath = '/api/account/getInfo/7';

  it.each([
    { label: 'retries username resolution', failedPath: lookup, leaves: false },
    { label: 'retries the resolved profile', failedPath: profilePath, leaves: false },
    { label: 'ignores a queued press after leaving', failedPath: lookup, leaves: true }
  ])('$label from the profile error button', async ({ failedPath, leaves }) => {
    let fail = true;
    const fixture = setup('nodeseek', false, (url) => {
      const path = new URL(url).pathname;
      if (fail && path === failedPath) {
        fail = false;
        return new Response('temporarily unavailable', { status: 503 });
      }
      if (path === lookup) {
        return new Response(JSON.stringify({ success: true, memberList: [{ member_id: 7, member_name: 'alice' }] }));
      }
    });
    const data = createEmptyReaderData();
    const runtime: UserRouteRuntimeValue = {
      enabledSources: ['nodeseek'],
      account: {
        linuxDoVerificationVisible: false,
        readGateway: fixture.gateway,
        reconcileAccountStatus: async () => undefined,
        requestNodeSeekVerification: jest.fn(),
        sessionEpochs: initialForumSessionEpochs,
        showLinuxDoVerification: jest.fn(() => undefined),
        showYaohuoLogin: jest.fn()
      },
      appActive: true,
      nodeSeekMessaging: { identityKey: 'nodeseek:123', available: true },
      notify: jest.fn(),
      topicStateIndex: createTopicListItemStateIndex(data),
      reader: { data, dataRef: { current: data }, commit: jest.fn() }
    };
    const navigationRef = createNavigationContainerRef<RootStackParamList>();
    const view = await render(
      <UserRouteRuntimeProvider value={runtime}>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator initialRouteName="User" screenOptions={{ headerShown: false, freezeOnBlur: true }}>
            <Stack.Screen name="MainTabs">{() => null}</Stack.Screen>
            <Stack.Screen
              name="User"
              component={UserRoute}
              initialParams={{
                user: { source: 'nodeseek', username: 'alice', url: 'https://www.nodeseek.com/member?t=alice' }
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </UserRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    const requestedPaths = () => fixture.urls.map((url) => new URL(url).pathname);
    try {
      const retry = await view.findByRole('button', { name: '重试资料' });
      expect(requestedPaths()).toEqual(failedPath === lookup ? [lookup] : [lookup, profilePath]);
      expect(view.queryByRole('button', { name: '关注' })).toBeNull();

      if (leaves) {
        const queuedPress = retry.props.onClick;
        expect(queuedPress).toEqual(expect.any(Function));
        await act(() => navigationRef.navigate('MainTabs', { screen: 'feed' }));
        expect(navigationRef.getCurrentRoute()?.name).toBe('MainTabs');
        await act(() => queuedPress({ target: 1, currentTarget: 1, nativeEvent: {} }));
        expect(requestedPaths()).toEqual([lookup]);
        return;
      }

      await fireEvent.press(retry);
      expect(await view.findByRole('button', { name: '关注' })).toBeTruthy();
      expect(requestedPaths().filter((path) => path === lookup)).toHaveLength(failedPath === lookup ? 2 : 1);
      expect(requestedPaths().filter((path) => path === profilePath)).toHaveLength(failedPath === profilePath ? 2 : 1);
    } finally {
      await view.unmount();
    }
  });
});

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
      expect(fixture.urls.slice(before)).toHaveLength(1);
      await hook.unmount();
    }
  );

  it('reads only the evidenced profile and activity endpoints for the first screen', async () => {
    const fixture = setup(source);
    const hook = await fixture.mount();
    await waitFor(() => expect(hook.result.current.userProfile?.topics).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.userProfile?.replies).toHaveLength(1));
    expect(fixture.urls.filter((url) => laneFor(url) === 'details')).toHaveLength(1);
    if (source === 'linuxdo') {
      expect(hook.result.current.userProfile?.displayName).toBe('Alice 昵称');
      expect(fixture.urls.filter((url) => laneFor(url) === 'nickname')).toHaveLength(1);
    }
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

describe('Yaohuo user activity pagination', () => {
  beforeEach(() => appQueryClient.clear());

  it.each(['topics', 'replies'] as const)(
    'retains prior %s and stops when an older activity page redirects back to the first',
    async (lane) => {
      const pageNumber = (url: string) => Number(new URL(url).searchParams.get('page') || '1');
      const fixture = setup('yaohuo', false, (url) => {
        if (laneFor(url) !== lane) return;
        const requestPage = pageNumber(url);
        const page = requestPage === 3 ? 1 : requestPage;
        const current = new URL(url);
        current.searchParams.set('page', String(page));
        const next = new URL(current);
        next.searchParams.set('page', String(page + 1));
        const count = page === 1 && lane === 'topics' ? 30 : 1;
        const rows = Array.from({ length: count }, (_, index) => {
          const id = page * 100 + index;
          return lane === 'topics'
            ? `<div class="listdata"><a href="/bbs-${id}.html?classid=177">主题 ${id}</a>/alice/阅1/2026-05-20 10:30</div>`
            : `<div>alice (7) #2 回复样本 ${id}。 2026-05-20 10:30 <a href="/bbs-${id}.html">查看</a></div>`;
        }).join('');
        const response = new Response(`${rows}<a href="${next}">下一页</a>`);
        Object.defineProperty(response, 'url', { value: current.toString() });
        return response;
      });
      const hook = await fixture.mount();
      const initialCount = lane === 'topics' ? 30 : 1;
      const activity = () => hook.result.current.userProfile?.[lane];
      const continuation = () => {
        const profile = hook.result.current.userProfile;
        return lane === 'topics'
          ? { hasMore: profile?.hasMoreTopics, cursor: profile?.nextTopicsCursor }
          : { hasMore: profile?.hasMoreReplies, cursor: profile?.nextRepliesCursor };
      };
      const loadMore = () =>
        lane === 'topics' ? hook.result.current.loadMoreUserTopics() : hook.result.current.loadMoreUserReplies();
      try {
        await waitFor(() => expect(activity()).toHaveLength(initialCount));
        await act(async () => {
          await loadMore();
        });
        await waitFor(() => expect(activity()).toHaveLength(initialCount + 1));
        await act(async () => {
          await loadMore();
        });
        const afterRedirect = continuation();
        await act(async () => {
          await loadMore();
        });

        expect({
          afterRedirect,
          items: activity()?.length,
          pagesRequested: fixture.urls.filter((url) => laneFor(url) === lane).map(pageNumber)
        }).toEqual({
          afterRedirect: { hasMore: false, cursor: null },
          items: initialCount + 1,
          pagesRequested: [1, 2, 3]
        });
      } finally {
        await hook.unmount();
      }
    }
  );

  it.each<{ lane: 'topics' | 'replies'; forward: boolean }>([
    { lane: 'topics', forward: false },
    { lane: 'topics', forward: true },
    { lane: 'replies', forward: false },
    { lane: 'replies', forward: true }
  ])('keeps $lane and uses only forward continuations (valid candidate: $forward)', async ({ lane, forward }) => {
    const pageNumber = (url: string) => Number(new URL(url).searchParams.get('page') || '1');
    const fixture = setup('yaohuo', false, (url) => {
      if (laneFor(url) !== lane) return;
      const page = pageNumber(url);
      const link = (targetPage: number) => {
        const target = new URL(url);
        target.searchParams.set('page', String(targetPage));
        return `<a href="${target}">下一页</a>`;
      };
      const itemCount = page === 1 && lane === 'topics' ? 30 : 1;
      const rows = Array.from({ length: itemCount }, (_, index) => {
        const id = page * 100 + index;
        return lane === 'topics'
          ? `<div class="listdata"><a href="/bbs-${id}.html?classid=177">主题 ${id}</a>/alice/阅1/2026-05-20 10:30</div>`
          : `<div>alice (7) #2 回复样本 ${id}。 2026-05-20 10:30 <a href="/bbs-${id}.html">查看</a></div>`;
      }).join('');
      const next = page === 1 ? link(2) : page === 2 ? link(1) + (forward ? link(3) : '') : '';
      return new Response(rows + next);
    });
    const hook = await fixture.mount();
    const initialCount = lane === 'topics' ? 30 : 1;
    const activity = () => hook.result.current.userProfile?.[lane];
    const hasMore = () =>
      lane === 'topics'
        ? hook.result.current.userProfile?.hasMoreTopics
        : hook.result.current.userProfile?.hasMoreReplies;
    const loadMore = () =>
      lane === 'topics' ? hook.result.current.loadMoreUserTopics() : hook.result.current.loadMoreUserReplies();
    try {
      await waitFor(() => expect(activity()).toHaveLength(initialCount));
      expect(hasMore()).toBe(true);

      await act(async () => {
        await loadMore();
      });
      await waitFor(() => expect(activity()).toHaveLength(initialCount + 1));
      expect(hasMore()).toBe(forward);
      await act(async () => {
        await loadMore();
      });

      expect(fixture.urls.filter((url) => laneFor(url) === lane).map(pageNumber)).toEqual(forward ? [1, 2, 3] : [1, 2]);
      expect(activity()).toHaveLength(initialCount + (forward ? 2 : 1));
      expect(hasMore()).toBe(false);
    } finally {
      await hook.unmount();
    }
  });
});
