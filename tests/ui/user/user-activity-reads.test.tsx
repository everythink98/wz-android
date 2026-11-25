import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createReadGateway } from '@/sources/readGateway';
import { appQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useUserController } from '@/features/user/useUserController';
import { useAccountOverview } from '@/features/more/useAccountOverview';
import { UserRoute } from '@/features/user/UserRoute';
import { UserRouteRuntimeProvider, type UserRouteRuntimeValue } from '@/features/user/UserRouteRuntime';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { Source, UserReference } from '@/domain/forum/models';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { fireEvent, render } from '../render';
import { projectTestAccountSessions } from '../../helpers/accountSessions';

import { createUserActivityResponse, laneFor } from '../../fixtures/userActivityEvidence';

type Handoff = 'settled' | 'open' | 'resuming';

function setup(
  source: Source,
  empty = false,
  activityResponse?: (url: string, handoff: Handoff) => Response | Promise<Response> | undefined
) {
  let failure: 'topics' | 'replies' | undefined;
  let handoff: Handoff = 'settled';
  const responseFor = createUserActivityResponse(source, empty);
  const urls: string[] = [];
  const showNodeSeekVerification = jest.fn<(message?: string, recovery?: ReadRecovery) => void>();
  const fetcher = async (url: string) => {
    urls.push(url);
    return activityResponse?.(url, handoff) ?? responseFor(url, failure);
  };
  const gateway = createReadGateway({
    fetcher,
    anonymousFetcher: fetcher,
    nodeSeekUserAgent: () => 'test-agent',
    getEnabledSources: () => [source],
    readSessionRuntimeSnapshot: (site) => ({
      source: site,
      authenticated: true,
      authSurfaceOpen: handoff !== 'settled',
      ...(handoff === 'resuming' ? { foregroundReadDuringHandoff: true } : {}),
      identityKey: `${site}:7`,
      identityTrust: 'confirmed',
      sessionEpoch: 0,
      sourceEnabled: true
    })
  });
  return {
    gateway,
    urls,
    showNodeSeekVerification,
    setHandoff: (next: Handoff) => {
      handoff = next;
    },
    fail: (lane: typeof failure) => {
      failure = lane;
    },
    mount: (user: UserReference = { source, id: '7', username: 'alice', url: 'https://example.com/user-fixture' }) =>
      renderHook(
        () =>
          useUserController({
            active: true,
            notify: jest.fn(),
            readerData: createEmptyReaderData(),
            readGateway: gateway,
            showLinuxDoVerification: jest.fn(() => undefined),
            showNodeSeekVerification,
            showYaohuoLogin: jest.fn(),
            user
          }),
        { wrapper: QueryTestWrapper }
      )
  };
}

const Stack = createNativeStackNavigator<RootStackParamList>();

it('keeps a User activity error out of the shared Account profile status', async () => {
  appQueryClient.clear();
  const fixture = setup('linuxdo');
  const user = { source: 'linuxdo' as const, id: 'alice', username: 'alice', url: 'https://linux.do/u/alice' };
  const session = projectTestAccountSessions(
    createSiteSessionStates({
      linuxdo: { site: 'linuxdo', status: 'logged-in', cookieSummary: [], isVerifying: false, currentUser: user }
    })
  ).linuxdo;
  const userPage = await fixture.mount(user);
  try {
    await waitFor(() => expect(userPage.result.current.userProfile?.replies).toHaveLength(1));
    fixture.fail('replies');
    await act(async () => {
      await expect(userPage.result.current.refreshUser()).resolves.toBe('failed');
    });
    await waitFor(() => expect(userPage.result.current.userRepliesError).not.toBeNull());
    expect(userPage.result.current.userError).toBeNull();
  } finally {
    await userPage.unmount();
  }
  const account = await renderHook(
    () =>
      useAccountOverview({
        active: true,
        gateway: fixture.gateway,
        session,
        sessionEpochs: initialForumSessionEpochs,
        site: 'linuxdo'
      }),
    { wrapper: QueryTestWrapper }
  );
  try {
    await waitFor(() => expect(account.result.current.profile?.id).toBe('alice'));
    expect(account.result.current.error).toBeNull();
  } finally {
    await account.unmount();
    appQueryClient.clear();
  }
});

describe('NodeSeek profile error recovery', () => {
  beforeEach(() => appQueryClient.clear());

  const lookup = '/api/account/find/alice';
  const profilePath = '/api/account/getInfo/7';

  it.each(['profile', 'username', 'topic page'] as const)(
    'restores the original NodeSeek %s across the same account handoff',
    async (target) => {
      const path =
        target === 'username' ? lookup : target === 'profile' ? profilePath : '/api/content/list-discussions';
      const requests: Handoff[] = [];
      const fixture = setup('nodeseek', false, (url, handoff) => {
        const request = new URL(url);
        if (target === 'topic page') {
          if (request.pathname === profilePath) {
            return Response.json({ success: true, detail: { member_id: 7, member_name: 'alice', nPost: 16 } });
          }
          if (request.searchParams.get('page') !== '2') return;
        }
        if (request.pathname !== path) return;
        requests.push(handoff);
        if (handoff === 'settled') {
          throw Object.assign(new Error('需要验证'), { source: 'nodeseek', reason: 'cloudflare' });
        }
        if (target === 'username') {
          return Response.json({ success: true, memberList: [{ member_id: 7, member_name: 'alice' }] });
        }
        if (target === 'topic page') {
          return Response.json({ success: true, discussions: [{ post_id: 202, title: '下一页' }] });
        }
      });
      const hook = await fixture.mount({
        source: 'nodeseek',
        id: target === 'username' ? 'alice' : '7',
        username: 'alice',
        url: 'https://www.nodeseek.com/member?t=alice'
      });
      try {
        if (target === 'topic page') {
          await waitFor(() => expect(hook.result.current.userProfile?.nextTopicsCursor).toBe('2'));
          await act(async () => {
            await hook.result.current.loadMoreUserTopics();
          });
        }
        await waitFor(() => expect(fixture.showNodeSeekVerification).toHaveBeenCalledTimes(1));
        const recovery = fixture.showNodeSeekVerification.mock.calls[0]?.[1];
        expect(recovery?.isCurrent?.()).toBe(true);
        fixture.setHandoff('open');
        await act(async () => hook.rerender(undefined));
        expect(recovery?.isCurrent?.()).toBe(true);
        fixture.setHandoff('resuming');
        await act(async () => {
          await expect(recovery?.resume()).resolves.toBe('completed');
        });
        expect(requests.filter((handoff) => handoff === 'resuming')).toHaveLength(1);
        expect(fixture.showNodeSeekVerification).toHaveBeenCalledTimes(1);
        if (target === 'topic page') {
          await act(async () => hook.rerender(undefined));
          await waitFor(() =>
            expect(hook.result.current.userProfile?.topics?.map(({ id }) => id)).toEqual(['101', '202'])
          );
        }
      } finally {
        await hook.unmount();
      }
    }
  );

  it('keeps the whole profile and both activity cursors until a refresh succeeds', async () => {
    let refreshing = false;
    const repliesResponse = Promise.withResolvers<Response>();
    const fixture = setup('nodeseek', false, (url) => {
      const lane = laneFor(url);
      if (lane === 'details') {
        return Response.json({
          success: true,
          detail: { member_id: 7, member_name: 'alice', nPost: 16, nComment: 16 }
        });
      }
      if (lane !== 'topics' && lane !== 'replies') return;
      if (refreshing && lane === 'replies') return repliesResponse.promise;
      const page = Number(new URL(url).searchParams.get('page'));
      const row = { post_id: refreshing ? 101 : page, title: '主题样本', floor_id: 2, text: '回复样本' };
      return Response.json({ success: true, [lane === 'topics' ? 'discussions' : 'comments']: [row] });
    });
    const hook = await fixture.mount();
    try {
      await waitFor(() => expect(hook.result.current.userProfile?.replies).toHaveLength(1));
      await act(async () => {
        await hook.result.current.loadMoreUserTopics();
        await hook.result.current.loadMoreUserReplies();
      });
      await waitFor(() => {
        expect(hook.result.current.userProfile?.topics).toHaveLength(2);
        expect(hook.result.current.userProfile?.replies).toHaveLength(2);
      });
      const previous = hook.result.current.userProfile;
      refreshing = true;
      let refresh!: ReturnType<typeof hook.result.current.refreshUser>;
      await act(async () => {
        refresh = hook.result.current.refreshUser();
      });
      await waitFor(() => expect(fixture.urls.map(laneFor).slice(-2)).toEqual(['topics', 'replies']));
      const beforeDuplicate = fixture.urls.length;
      const whileRefreshing = {
        headerBusy: hook.result.current.userBusy,
        results: hook.result.current.userProfile
      };
      await act(async () => {
        void hook.result.current.refreshUser();
        await Promise.resolve();
      });
      const afterDuplicate = fixture.urls.length;
      await act(async () => {
        repliesResponse.resolve(new Response('activity unavailable', { status: 503 }));
        await expect(refresh).resolves.toBe('failed');
      });
      expect(whileRefreshing).toEqual({ headerBusy: true, results: previous });
      expect(afterDuplicate).toBe(beforeDuplicate);
      expect(hook.result.current.userProfile).toBe(previous);
      await waitFor(() => {
        expect(hook.result.current.userBusy).toBe(false);
        expect(hook.result.current.userRepliesError).not.toBeNull();
      });
    } finally {
      repliesResponse.resolve(new Response('activity unavailable', { status: 503 }));
      await hook.unmount();
    }
  });

  it.each(['topics', 'replies'] as const)(
    'retries a failed first-page %s refresh without reading cached later pages',
    async (lane) => {
      let failing = false;
      const fixture = setup('nodeseek', false, (url) => {
        const requested = laneFor(url);
        if (requested === 'details')
          return Response.json({
            success: true,
            detail: { member_id: 7, member_name: 'alice', nPost: 16, nComment: 16 }
          });
        if (requested !== lane) return;
        if (failing) return new Response('activity unavailable', { status: 503 });
        const page = Number(new URL(url).searchParams.get('page'));
        const row = { post_id: page, title: '主题样本', floor_id: 2, text: '回复样本' };
        return Response.json({ success: true, [lane === 'topics' ? 'discussions' : 'comments']: [row] });
      });
      const hook = await fixture.mount();
      try {
        await waitFor(() => expect(hook.result.current.userProfile?.[lane]).toHaveLength(1));
        await act(async () => {
          await (lane === 'topics'
            ? hook.result.current.loadMoreUserTopics()
            : hook.result.current.loadMoreUserReplies());
        });
        await waitFor(() => expect(hook.result.current.userProfile?.[lane]).toHaveLength(2));
        failing = true;
        await act(async () => {
          await expect(hook.result.current.refreshUser()).resolves.toBe('failed');
        });
        await waitFor(() =>
          expect(
            lane === 'topics' ? hook.result.current.userTopicsError : hook.result.current.userRepliesError
          ).not.toBeNull()
        );
        expect(hook.result.current.userProfile?.[lane]).toHaveLength(2);
        const before = fixture.urls.length;
        failing = false;
        await act(async () => {
          await (lane === 'topics' ? hook.result.current.retryUserTopics() : hook.result.current.retryUserReplies());
        });
        expect(fixture.urls.slice(before).map((url) => [laneFor(url), new URL(url).searchParams.get('page')])).toEqual([
          [lane, '1']
        ]);
        await waitFor(() => expect(hook.result.current.userProfile?.[lane]).toHaveLength(1));
      } finally {
        await hook.unmount();
      }
    }
  );

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
