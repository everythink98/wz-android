import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { ForumNotification } from '@/domain/notifications/models';
import { parseForumTopicLink } from '@/domain/forum/links';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { errorMessage } from '@/platform/network/errors';
import { forumQueryKeys } from '@/platform/query/serverState';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import type { NotificationsRuntimeValue } from './useNotificationsRuntime';
import { sortNotifications } from './notificationPresentation';
import {
  NotificationDetailScreen,
  NotificationSettingsScreen,
  NotificationsScreen,
  type NotificationFilterSource
} from './NotificationScreens';

export type NotificationRouteRuntimeValue = NotificationsRuntimeValue & {
  contentWidth: number;
  notify: (message: string) => void;
};

const NotificationRouteRuntimeContext = createContext<NotificationRouteRuntimeValue | null>(null);

export function NotificationRouteRuntimeProvider({
  children,
  value
}: {
  children: ReactNode;
  value: NotificationRouteRuntimeValue;
}) {
  return <NotificationRouteRuntimeContext.Provider value={value}>{children}</NotificationRouteRuntimeContext.Provider>;
}

function useNotificationRouteRuntime() {
  const runtime = useContext(NotificationRouteRuntimeContext);
  if (!runtime) throw new Error('NotificationRouteRuntimeProvider is required');
  return runtime;
}

type NotificationPageParam = {
  sourceCursor?: string | null;
  allCursors?: Partial<Record<NotificationSource, string | null>>;
};

type NotificationListPage = {
  items: ForumNotification[];
  errors: Partial<Record<NotificationSource, string>>;
  hasMore: boolean;
  nextPage: NotificationPageParam;
};

export function NotificationsRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Notifications'>) {
  const runtime = useNotificationRouteRuntime();
  const isFocused = useIsFocused();
  const setCenterVisible = runtime.setCenterVisible;
  const queryClient = useQueryClient();
  const [source, setSource] = useState<NotificationFilterSource>(route.params?.source || 'all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const markAllControllerRef = useRef<AbortController | undefined>(undefined);
  const retryControllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (route.params?.source) setSource(route.params.source);
  }, [route.params?.source]);
  useFocusEffect(
    useCallback(() => {
      setCenterVisible(true);
      return () => setCenterVisible(false);
    }, [setCenterVisible])
  );
  const identityKey = source === 'all' ? runtime.identitySignature : runtime.identityKeys[source] || `${source}:none`;
  const sourceAvailable = source === 'all' ? runtime.activeSources.length > 0 : runtime.activeSources.includes(source);
  const sourcePending = source !== 'all' && runtime.sessions[source].identityTrust === 'pending';
  useEffect(
    () => () => {
      markAllControllerRef.current?.abort();
      markAllControllerRef.current = undefined;
      retryControllerRef.current?.abort();
      retryControllerRef.current = undefined;
    },
    [identityKey, source]
  );
  const listQueryKey = forumQueryKeys.notificationList({ source, identityKey, unreadOnly });
  const listQuery = useInfiniteQuery({
    queryKey: listQueryKey,
    enabled: runtime.ready && sourceAvailable && isFocused,
    staleTime: 0,
    refetchInterval: isFocused ? 60_000 : false,
    refetchIntervalInBackground: false,
    initialPageParam: {} as NotificationPageParam,
    queryFn: async ({ pageParam, signal }) => {
      if (source === 'all') {
        const page = await runtime.gateway.listAllPage({
          cursors: pageParam.allCursors,
          limit: 30,
          signal,
          sources: runtime.activeSources,
          unreadOnly
        });
        return {
          items: page.items,
          errors: Object.fromEntries(
            Object.entries(page.errors).map(([candidate, error]) => [candidate, error?.message || '读取失败'])
          ) as Partial<Record<NotificationSource, string>>,
          hasMore: page.hasMore,
          nextPage: { allCursors: page.nextCursors } satisfies NotificationPageParam
        };
      }
      try {
        const page = await runtime.gateway.listPage(source, {
          cursor: pageParam.sourceCursor,
          limit: 30,
          signal,
          unreadOnly
        });
        return {
          items: page.items,
          errors: {} as Partial<Record<NotificationSource, string>>,
          hasMore: page.hasMore,
          nextPage: { sourceCursor: page.cursor } satisfies NotificationPageParam
        };
      } catch (error) {
        return {
          items: [],
          errors: { [source]: sourceErrorFromUnknown(source, error).message },
          hasMore: false,
          nextPage: {} satisfies NotificationPageParam
        };
      }
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextPage : undefined)
  });
  const items = useMemo(() => {
    const unique = new Map<string, ForumNotification>();
    listQuery.data?.pages.forEach((page) => {
      page.items.forEach((item) => unique.set(`${item.source}:${item.id}`, item));
    });
    return sortNotifications([...unique.values()]);
  }, [listQuery.data]);
  const errors = useMemo(
    () => Object.assign({}, ...(listQuery.data?.pages.map((page) => page.errors) || [])),
    [listQuery.data]
  );
  const refetch = listQuery.refetch;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const retrySource = useCallback(
    (candidate: NotificationSource) => {
      if (source !== 'all') {
        void refetch();
        return;
      }
      const cached = queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey);
      const failedPageIndex = cached?.pages.findIndex((page) => page.errors[candidate]) ?? -1;
      const pageIndex = failedPageIndex < 0 ? 0 : failedPageIndex;
      const cursor = cached?.pageParams[pageIndex]?.allCursors?.[candidate];
      const expectedIdentityKey = runtime.identityKeys[candidate];
      if (!expectedIdentityKey) return;
      const controller = new AbortController();
      retryControllerRef.current?.abort();
      retryControllerRef.current = controller;
      void runtime.gateway
        .listPage(candidate, {
          cursor,
          expectedIdentityKey,
          limit: 30,
          signal: controller.signal,
          unreadOnly
        })
        .then((page) => {
          if (controller.signal.aborted) return;
          queryClient.setQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(
            listQueryKey,
            (current) => {
              if (!current?.pages[pageIndex]) return current;
              const nextCursor = page.hasMore ? page.cursor : null;
              const withCursor = (currentPage: NotificationListPage) => {
                const allCursors = { ...currentPage.nextPage.allCursors, [candidate]: nextCursor };
                return {
                  ...currentPage,
                  hasMore: Object.values(allCursors).some((value) => value != null),
                  nextPage: { allCursors }
                };
              };
              const pages = current.pages.map((currentPage, index) => {
                if (index !== pageIndex) return currentPage;
                const errors = { ...currentPage.errors };
                delete errors[candidate];
                return withCursor({
                  ...currentPage,
                  items: [...currentPage.items.filter((item) => item.source !== candidate), ...page.items],
                  errors
                });
              });
              const lastPageIndex = pages.length - 1;
              if (lastPageIndex !== pageIndex) pages[lastPageIndex] = withCursor(pages[lastPageIndex]!);
              return { ...current, pages };
            }
          );
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          queryClient.setQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(
            listQueryKey,
            (current) => {
              if (!current?.pages[pageIndex]) return current;
              const pages = current.pages.map((currentPage, index) =>
                index === pageIndex
                  ? {
                      ...currentPage,
                      errors: { ...currentPage.errors, [candidate]: sourceErrorFromUnknown(candidate, error).message }
                    }
                  : currentPage
              );
              return { ...current, pages };
            }
          );
        })
        .finally(() => {
          if (retryControllerRef.current === controller) retryControllerRef.current = undefined;
        });
    },
    [listQueryKey, queryClient, refetch, runtime.gateway, runtime.identityKeys, source, unreadOnly]
  );
  const markAll = useCallback(() => {
    if (source === 'all' || source === 'yaohuo') return;
    const expectedIdentityKey = runtime.identityKeys[source];
    if (!expectedIdentityKey) return;
    Alert.alert('全部标记为已读', `将该站现有消息全部标记为已读？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '确认',
        onPress: () => {
          const controller = new AbortController();
          markAllControllerRef.current?.abort();
          markAllControllerRef.current = controller;
          setMarkAllBusy(true);
          void runtime.gateway
            .markAllRead(source, expectedIdentityKey, controller.signal)
            .then(async (result) => {
              runtime.notify(result.confirmed ? '已按原站状态标记全部已读' : result.message || '原站未确认已读');
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: forumQueryKeys.notifications(source) }),
                queryClient.invalidateQueries({ queryKey: forumQueryKeys.notifications('all') }),
                runtime.refreshSnapshots()
              ]);
            })
            .catch((error) => {
              if (markAllControllerRef.current === controller && !controller.signal.aborted) {
                runtime.notify(errorMessage(error));
              }
            })
            .finally(() => {
              if (markAllControllerRef.current !== controller) return;
              markAllControllerRef.current = undefined;
              setMarkAllBusy(false);
            });
        }
      }
    ]);
  }, [queryClient, runtime, source]);
  return (
    <NotificationsScreen
      activeSources={runtime.activeSources}
      errors={errors}
      fetchingMore={listQuery.isFetchingNextPage}
      hasMore={Boolean(listQuery.hasNextPage)}
      items={items}
      loading={listQuery.isPending && sourceAvailable}
      markAllBusy={markAllBusy}
      refreshing={listQuery.isRefetching && !listQuery.isFetchingNextPage}
      source={source}
      sourcePending={sourcePending}
      unreadOnly={unreadOnly}
      xiaoyinsiNeedsUpgrade={runtime.xiaoyinsiNeedsUpgrade}
      onChangeSource={setSource}
      onChangeUnreadOnly={setUnreadOnly}
      onItemPress={(notification) => {
        const identityKey = runtime.identityKeys[notification.source];
        if (identityKey) navigation.navigate('NotificationDetail', { identityKey, notification });
      }}
      onLoadMore={() => void listQuery.fetchNextPage()}
      onMarkAll={markAll}
      onRefresh={refresh}
      onRetrySource={retrySource}
      onUpgradeXiaoyinsi={runtime.beginXiaoyinsiAuthorization}
    />
  );
}

export function NotificationDetailRoute({
  navigation,
  route
}: NativeStackScreenProps<RootStackParamList, 'NotificationDetail'>) {
  const runtime = useNotificationRouteRuntime();
  const queryClient = useQueryClient();
  const item = route.params.notification;
  const identityKey = route.params.identityKey;
  const currentIdentityKey = runtime.identityKeys[item.source];
  const canAccessSource = currentIdentityKey === identityKey && runtime.activeSources.includes(item.source);
  const accessError =
    currentIdentityKey && currentIdentityKey !== identityKey
      ? '账号状态已变化，请返回消息列表重新打开。'
      : '账号状态暂时无法确认，请返回消息列表后重试。';
  const gateway = runtime.gateway;
  const refreshSnapshots = runtime.refreshSnapshots;
  const markStartedRef = useRef('');
  const [markMessage, setMarkMessage] = useState('');
  const detailQuery = useQuery({
    queryKey: forumQueryKeys.notificationDetail({ source: item.source, identityKey, notificationId: item.id }),
    enabled: canAccessSource,
    staleTime: 0,
    queryFn: ({ signal }) => runtime.gateway.loadDetail(item, identityKey, signal)
  });
  useEffect(() => {
    const detail = detailQuery.data;
    const markKey = `${identityKey}:${item.id}`;
    if (!canAccessSource || !detail || !item.unread || markStartedRef.current === markKey) return;
    markStartedRef.current = markKey;
    const controller = new AbortController();
    let current = true;
    void gateway
      .markRead(item, detail, identityKey, controller.signal)
      .then(async (result) => {
        if (!current) return;
        setMarkMessage(result.confirmed ? '' : result.message || '原站未确认已读状态');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: forumQueryKeys.notifications(item.source) }),
          queryClient.invalidateQueries({ queryKey: forumQueryKeys.notifications('all') }),
          refreshSnapshots()
        ]);
      })
      .catch((error) => {
        if (current) setMarkMessage(`已读状态未更新：${errorMessage(error)}`);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [canAccessSource, detailQuery.data, gateway, identityKey, item, queryClient, refreshSnapshots]);
  const fallbackTopic = item.target.type === 'topic-post' ? parseForumTopicLink(item.target.url) : null;
  const targetTopic = detailQuery.data?.topic || (fallbackTopic ? { ...fallbackTopic, title: item.title } : null);
  const targetCommentId = item.target.type === 'topic-post' ? Number(item.target.postId) : 0;
  const targetReply =
    item.target.type === 'topic-post' &&
    ((Number.isSafeInteger(targetCommentId) && targetCommentId > 0) || item.target.postNumber)
      ? {
          ...(Number.isSafeInteger(targetCommentId) && targetCommentId > 0 ? { commentId: targetCommentId } : {}),
          ...(item.target.postNumber ? { floor: item.target.postNumber } : {})
        }
      : undefined;
  return (
    <NotificationDetailScreen
      canOpenTopic={Boolean(targetTopic)}
      canRetry={canAccessSource}
      contentWidth={runtime.contentWidth}
      detail={canAccessSource ? detailQuery.data : undefined}
      error={canAccessSource ? (detailQuery.error ? errorMessage(detailQuery.error) : undefined) : accessError}
      loading={canAccessSource && detailQuery.isPending}
      markMessage={markMessage}
      onRetry={() => {
        if (canAccessSource) void detailQuery.refetch();
      }}
      onOpenTopic={() => {
        if (targetTopic) navigation.navigate('Topic', { topic: targetTopic, targetReply });
      }}
    />
  );
}

export function NotificationSettingsRoute() {
  const runtime = useNotificationRouteRuntime();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    (operation: () => Promise<unknown>) => {
      setBusy(true);
      void operation()
        .catch((error) => runtime.notify(errorMessage(error)))
        .finally(() => setBusy(false));
    },
    [runtime]
  );
  const toggleGlobal = useCallback(
    (enabled: boolean) => {
      const apply = () =>
        run(async () => {
          const granted = await runtime.setGlobalEnabled(enabled);
          if (enabled && !granted) runtime.notify('系统通知权限未开启，已保留你的设置');
        });
      if (enabled && !runtime.state.hasOptedIn) {
        Alert.alert(
          '开启 Android 消息通知',
          'App 会在本机约每 15 分钟检查一次。Android 可能延迟调度；消息正文、Cookie 和 token 不会写入通知存储。',
          [
            { text: '取消', style: 'cancel' },
            { text: '继续', onPress: apply }
          ]
        );
        return;
      }
      apply();
    },
    [run, runtime]
  );
  return (
    <NotificationSettingsScreen
      backgroundEnabled={runtime.backgroundEnabled}
      backgroundError={runtime.backgroundError}
      busy={busy}
      permission={runtime.permission}
      sessions={runtime.sessions}
      state={runtime.state}
      xiaoyinsiNeedsUpgrade={runtime.xiaoyinsiNeedsUpgrade}
      onOpenSystemSettings={() => void runtime.openSystemSettings()}
      onToggleGlobal={toggleGlobal}
      onToggleSource={(source, enabled) => run(() => runtime.setSourceEnabled(source, enabled))}
      onUpgradeXiaoyinsi={runtime.beginXiaoyinsiAuthorization}
    />
  );
}
