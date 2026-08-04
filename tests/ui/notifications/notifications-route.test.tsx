import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Alert } from 'react-native';
import type { ForumNotification } from '@/domain/notifications/models';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import {
  NotificationDetailRoute,
  NotificationRouteRuntimeProvider,
  NotificationsRoute,
  type NotificationRouteRuntimeValue
} from '@/features/notifications/NotificationRoute';
import { defaultNotificationState } from '@/platform/notifications/notificationStore';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { NotificationAdapter, NotificationAdapterAccess } from '@/sources/notificationAdapter';
import { createNotificationGateway } from '@/sources/notificationGateway';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { act, fireEvent, render, waitFor } from '../render';

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ({
      data = [],
      ListEmptyComponent,
      ListHeaderComponent,
      renderItem
    }: {
      data?: unknown[];
      ListEmptyComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
    }) =>
      ReactModule.createElement(
        View,
        null,
        ListHeaderComponent,
        data.length === 0 ? ListEmptyComponent : null,
        ...data.map((item, index) => ReactModule.createElement(View, { key: index }, renderItem?.({ item, index })))
      )
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined)
  }
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { ChevronRight: Icon };
});

const notification: ForumNotification = {
  source: 'nodeseek',
  id: 'reply:old-account',
  kind: 'reply',
  actor: { name: '张三' },
  title: '旧账号消息',
  createdAt: null,
  unread: true,
  target: { type: 'information' }
};

type FocusTestStackParamList = {
  Notifications: undefined;
  Other: undefined;
};

const FocusTestStack = createNativeStackNavigator<FocusTestStackParamList>();

function routeRuntime(gateway: NotificationRouteRuntimeValue['gateway']): NotificationRouteRuntimeValue {
  return {
    activeSources: ['nodeseek'],
    backgroundEnabled: false,
    backgroundError: '',
    beginXiaoyinsiAuthorization: jest.fn(),
    contentWidth: 360,
    gateway,
    identityKeys: { nodeseek: 'nodeseek:new-account' },
    identitySignature: 'nodeseek:new-account',
    notify: jest.fn(),
    onNavigationReady: jest.fn(),
    openSystemSettings: jest.fn(),
    partialUnavailable: false,
    permission: 'denied',
    ready: true,
    refreshSnapshots: jest.fn(),
    sessions: createSiteSessionViewModels(createSiteSessionStates()),
    setCenterVisible: jest.fn(),
    setGlobalEnabled: jest.fn(async () => false),
    setSourceEnabled: jest.fn(async () => undefined),
    snapshotErrors: {},
    state: defaultNotificationState(),
    unreadTotal: 0,
    xiaoyinsiNeedsUpgrade: false
  } as NotificationRouteRuntimeValue;
}

describe('notification routes', () => {
  it('[REG-NOTIFY-027] stops the mounted notification list from reading after it loses focus', async () => {
    appQueryClient.clear();
    const listAllPage = jest.fn(async () => ({
      items: [],
      pages: {},
      errors: {},
      nextCursors: { nodeseek: null },
      hasMore: false
    }));
    const gateway = {
      listAllPage,
      listPage: jest.fn(),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const navigationRef = createNavigationContainerRef<FocusTestStackParamList>();
    await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer ref={navigationRef}>
          <FocusTestStack.Navigator>
            <FocusTestStack.Screen name="Notifications">
              {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route as never} />}
            </FocusTestStack.Screen>
            <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(listAllPage).toHaveBeenCalledTimes(1));

    await act(async () => navigationRef.navigate('Other'));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('Other'));
    await appQueryClient.refetchQueries({
      queryKey: forumQueryKeys.notificationList({
        source: 'all',
        identityKey: runtime.identitySignature,
        unreadOnly: false
      })
    });

    expect(listAllPage).toHaveBeenCalledTimes(1);
  });

  it('[REG-NOTIFY-016] keeps a pending source distinct from logged out in the single-source route', async () => {
    appQueryClient.clear();
    const gateway = {
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    runtime.sessions.yaohuo = { ...runtime.sessions.yaohuo, identityTrust: 'pending' };
    runtime.identityKeys.yaohuo = 'yaohuo:known-account';

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: { source: 'yaohuo' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    expect(view.getByText('账号确认中')).toBeTruthy();
    expect(view.queryByText('账号尚未就绪')).toBeNull();
    expect(gateway.listPage).not.toHaveBeenCalled();
  });

  it('[REG-NOTIFY-015] retries only the selected failed source in the aggregate list', async () => {
    appQueryClient.clear();
    const linuxdoNotification = { ...notification, source: 'linuxdo', id: 'reply:linuxdo' } as ForumNotification;
    const listAllPage = jest.fn(async () => ({
      items: [notification],
      pages: { nodeseek: { items: [notification], cursor: null, hasMore: false } },
      errors: { linuxdo: { message: '暂不可用' } },
      nextCursors: { nodeseek: null, linuxdo: null },
      hasMore: false
    }));
    const listPage = jest.fn(async () => ({ items: [linuxdoNotification], cursor: null, hasMore: false }));
    const gateway = {
      listAllPage,
      listPage,
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['nodeseek', 'linuxdo'] as const,
      identityKeys: { nodeseek: 'nodeseek:new-account', linuxdo: 'linuxdo:user' },
      identitySignature: 'linuxdo:user|nodeseek:new-account'
    } as NotificationRouteRuntimeValue;

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText('重试 linux.do')).toBeTruthy());
    await fireEvent.press(view.getByText('重试 linux.do'));
    await waitFor(() => expect(view.queryByText('重试 linux.do')).toBeNull());
    expect(view.getByText('linux.do · 时间未知')).toBeTruthy();
    expect(listPage).toHaveBeenCalledWith(
      'linuxdo',
      expect.objectContaining({
        cursor: undefined,
        expectedIdentityKey: 'linuxdo:user',
        limit: 30,
        signal: expect.any(AbortSignal),
        unreadOnly: false
      })
    );
    expect(listAllPage).toHaveBeenCalledTimes(1);
  });

  it('[REG-NOTIFY-021] keeps recovered source pagination reachable after other sources already paged', async () => {
    appQueryClient.clear();
    const listAllPage = jest.fn(async () => ({
      items: [notification],
      pages: { nodeseek: { items: [notification], cursor: 'ns-next', hasMore: true } },
      errors: { linuxdo: { message: '暂不可用' } },
      nextCursors: { nodeseek: 'ns-next', linuxdo: null },
      hasMore: true
    }));
    const listPage = jest.fn(async () => ({ items: [], cursor: 'linux-next', hasMore: true }));
    const gateway = {
      listAllPage,
      listPage,
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['nodeseek', 'linuxdo'] as const,
      identityKeys: { nodeseek: 'nodeseek:new-account', linuxdo: 'linuxdo:user' },
      identitySignature: 'linuxdo:user|nodeseek:new-account'
    } as NotificationRouteRuntimeValue;
    const queryKey = forumQueryKeys.notificationList({
      source: 'all',
      identityKey: runtime.identitySignature,
      unreadOnly: false
    });
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText('重试 linux.do')).toBeTruthy());
    await act(async () => {
      appQueryClient.setQueryData(queryKey, (current: any) => ({
        ...current,
        pages: [
          ...current.pages,
          { items: [], errors: {}, hasMore: false, nextPage: { allCursors: { nodeseek: null, linuxdo: null } } }
        ],
        pageParams: [...current.pageParams, { allCursors: { nodeseek: 'ns-next', linuxdo: null } }]
      }));
    });
    await fireEvent.press(view.getByText('重试 linux.do'));

    await waitFor(() => {
      const cached = appQueryClient.getQueryData<any>(queryKey);
      expect(cached.pages.at(-1)).toMatchObject({
        hasMore: true,
        nextPage: { allCursors: { linuxdo: 'linux-next' } }
      });
    });
  });

  it('[REG-NOTIFY-007] never loads or marks an old notification through a newly confirmed account', async () => {
    appQueryClient.clear();
    const loadDetail = jest.fn(async () => ({ notification, title: '消息详情', contentText: '正文' }));
    const markRead = jest.fn(async () => ({ confirmed: true }));
    const gateway = {
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail,
      markAllRead: jest.fn(),
      markRead,
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const navigation = { navigate: jest.fn() };

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NotificationDetailRoute
          navigation={navigation as never}
          route={{
            key: 'notification-detail',
            name: 'NotificationDetail',
            params: { notification, identityKey: 'nodeseek:old-account' }
          }}
        />
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText(/账号状态已变化/)).toBeTruthy());
    expect(loadDetail).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(view.queryByText('重试')).toBeNull();
  });

  it('cancels an in-flight read write when the confirmed account changes', async () => {
    appQueryClient.clear();
    let resolveWriteAccess!: (access: NotificationAdapterAccess) => void;
    let accessCalls = 0;
    const sourceAdapter: NotificationAdapter = {
      listPage: jest.fn(async () => ({ items: [], cursor: null, hasMore: false })),
      readUnreadSnapshot: jest.fn(async () => ({
        total: 0,
        checkedAt: '2026-08-03T00:00:00Z'
      })),
      loadDetail: jest.fn(async (item: ForumNotification) => ({
        notification: item,
        title: '消息详情',
        contentText: '正文'
      })),
      markRead: jest.fn(async () => ({ confirmed: true }))
    };
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: sourceAdapter,
        yaohuo: sourceAdapter,
        xiaoyinsi: sourceAdapter
      },
      readAccess: async () => {
        accessCalls += 1;
        if (accessCalls === 1) return { identityKey: 'nodeseek:new-account', userId: 'new-account' };
        return new Promise<NotificationAdapterAccess>((resolve) => {
          resolveWriteAccess = resolve;
        });
      }
    });
    let runtime = routeRuntime(gateway);
    const route = {
      key: 'notification-detail',
      name: 'NotificationDetail' as const,
      params: { notification, identityKey: 'nodeseek:new-account' }
    };
    const navigation = { navigate: jest.fn() };
    const screen = () => (
      <NotificationRouteRuntimeProvider value={runtime}>
        <NotificationDetailRoute navigation={navigation as never} route={route} />
      </NotificationRouteRuntimeProvider>
    );
    const view = await render(screen(), { wrapper: QueryTestWrapper });

    await waitFor(() => expect(accessCalls).toBe(2));
    runtime = {
      ...runtime,
      identityKeys: { nodeseek: 'nodeseek:next-account' },
      identitySignature: 'nodeseek:next-account'
    };
    await view.rerender(screen());
    resolveWriteAccess({ identityKey: 'nodeseek:next-account', userId: 'next-account' });

    await waitFor(() => expect(view.getByText(/账号状态已变化/)).toBeTruthy());
    expect(sourceAdapter.markRead).not.toHaveBeenCalled();
  });

  it('cancels an in-flight mark-all when the selected account changes', async () => {
    appQueryClient.clear();
    let resolveWriteAccess!: (access: NotificationAdapterAccess) => void;
    let accessCalls = 0;
    const sourceAdapter: NotificationAdapter = {
      listPage: jest.fn(async () => ({ items: [], cursor: null, hasMore: false })),
      readUnreadSnapshot: jest.fn(async () => ({
        total: 0,
        checkedAt: '2026-08-03T00:00:00Z'
      })),
      loadDetail: jest.fn(async (item: ForumNotification) => ({ notification: item, title: item.title })),
      markRead: jest.fn(async () => ({ confirmed: true })),
      markAllRead: jest.fn(async () => ({ confirmed: true }))
    };
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: sourceAdapter,
        yaohuo: sourceAdapter,
        xiaoyinsi: sourceAdapter
      },
      readAccess: async () => {
        accessCalls += 1;
        if (accessCalls === 1) return { identityKey: 'nodeseek:new-account', userId: 'new-account' };
        if (accessCalls === 2) {
          return new Promise<NotificationAdapterAccess>((resolve) => {
            resolveWriteAccess = resolve;
          });
        }
        return { identityKey: 'nodeseek:next-account', userId: 'next-account' };
      }
    });
    let runtime = routeRuntime(gateway);
    const route = {
      key: 'notifications',
      name: 'Notifications' as const,
      params: { source: 'nodeseek' as const }
    };
    const navigation = { navigate: jest.fn() };
    const screen = () => (
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute navigation={navigation as never} route={route} />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '确认')?.onPress?.();
    });

    try {
      const view = await render(screen(), { wrapper: QueryTestWrapper });
      await waitFor(() => expect(view.getByLabelText('将 NodeSeek 全部标记为已读')).toBeTruthy());
      await fireEvent.press(view.getByLabelText('将 NodeSeek 全部标记为已读'));
      await waitFor(() => expect(accessCalls).toBe(2));

      runtime = {
        ...runtime,
        identityKeys: { nodeseek: 'nodeseek:next-account' },
        identitySignature: 'nodeseek:next-account'
      };
      await view.rerender(screen());
      resolveWriteAccess({ identityKey: 'nodeseek:next-account', userId: 'next-account' });

      await waitFor(() => expect(view.getByLabelText('将 NodeSeek 全部标记为已读')).toBeTruthy());
      expect(sourceAdapter.markAllRead).not.toHaveBeenCalled();
      expect(runtime.notify).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
  });
});
