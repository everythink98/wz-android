import { topicLocationForReply } from '@/domain/forum/topicLocation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect, useIsFocused, type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { focusManager, useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { SourceErrorInfo } from '@/domain/forum/models';
import { isRecord } from '@/domain/forum/html';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import { isDiscourseSource, sourceCatalog } from '@/domain/forum/sourceCatalog';
import type { ForumNotification, NotificationMessage } from '@/domain/notifications/models';
import { notificationPageError } from '@/domain/notifications/notificationQuality';

import type { ComposerSnapshot, PendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import { parseForumTopicLink } from '@/domain/forum/links';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { errorMessage } from '@/platform/network/errors';
import type { RequestDispatchState } from '@/platform/network/request';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
import { forumQueryKeys } from '@/platform/query/serverState';
import { syncDiscoursePolicyCaches } from '@/platform/query/discoursePolicyCache';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';

import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { retryEmojiCatalog } from '@/sources/discourse/retryEmojiCatalog';
import { normalizeReplyImageAsset } from '@/sources/imageUpload';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import { isNodeImageApiKeyExpiredError } from '@/sources/nodeimage/upload';
import { ContentSourceDisabledState } from '@/ui/controls/FeedbackStates';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

import { notificationErrorAction, sortNotifications } from './notificationPresentation';
import { resolveNotificationNextPage, type NotificationPageParam } from './notificationPagination';
import { notificationActorUser } from './notificationActor';
import { NotificationContactTitle } from './NotificationContactTitle';
import {
  NotificationDetailScreen,
  NotificationSettingsScreen,
  NotificationsScreen,
  type NotificationFilterSource
} from './NotificationScreens';
import { useNotificationRouteRuntime, type NotificationRouteRuntimeValue } from './NotificationRouteRuntime';

export { NotificationRouteRuntimeProvider, type NotificationRouteRuntimeValue } from './NotificationRouteRuntime';

type NotificationListPage = {
  items: ForumNotification[];
  errors: Partial<Record<NotificationSource, SourceErrorInfo>>;
  hasMore: boolean;
  nextPage: NotificationPageParam;
  historyNotices?: Partial<Record<NotificationSource, string>>;
};

export function NotificationsRoute({
  navigation,
  route
}: CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'notifications'>,
  NativeStackScreenProps<RootStackParamList>
>) {
  const runtime = useNotificationRouteRuntime();
  const isFocused = useIsFocused();
  const setCenterVisible = runtime.setCenterVisible;
  const refreshSnapshots = runtime.refreshSnapshots;
  const queryClient = useQueryClient();
  const enabledSourcesKey = runtime.enabledNotificationSources.join('|');
  const [source, setSource] = useState<NotificationFilterSource>(() => {
    const requested = route.params?.source;
    return requested && runtime.enabledNotificationSources.includes(requested) ? requested : 'all';
  });
  const [categoryId, setCategoryId] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const markAllControllerRef = useRef<AbortController | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRequestRef = useRef<object | undefined>(undefined);
  const retryControllerRef = useRef<AbortController | undefined>(undefined);
  const recoveryIntentRef = useRef<{ controller: AbortController; pending: boolean } | undefined>(undefined);
  const latestRuntimeRef = useCommittedRef(runtime);
  const cancelMarkAll = useCallback(() => {
    markAllControllerRef.current?.abort();
    markAllControllerRef.current = undefined;
    setMarkAllBusy(false);
  }, []);
  useEffect(() => {
    const requested = route.params?.source;
    if (!requested) return;
    setSource(requested && runtime.enabledNotificationSources.includes(requested) ? requested : 'all');
    setCategoryId('');
    const frame = requestAnimationFrame(() => navigation.setParams({ source: undefined }));
    return () => cancelAnimationFrame(frame);
  }, [enabledSourcesKey, navigation, route.params?.source, runtime.enabledNotificationSources]);
  useEffect(() => {
    if (source === 'all' || runtime.enabledNotificationSources.includes(source)) return;
    cancelMarkAll();
    retryControllerRef.current?.abort();
    retryControllerRef.current = undefined;
    void queryClient.cancelQueries({ queryKey: forumQueryKeys.notifications(source) });
    setCategoryId('');
    setSource('all');
  }, [cancelMarkAll, enabledSourcesKey, queryClient, runtime.enabledNotificationSources, source]);
  useFocusEffect(
    useCallback(() => {
      setCenterVisible(true);
      void refreshSnapshots();
      return () => setCenterVisible(false);
    }, [refreshSnapshots, setCenterVisible])
  );
  const identityKey = source === 'all' ? runtime.identitySignature : runtime.identityKeys[source] || `${source}:none`;
  const selectedSourceEpoch = source === 'all' ? 0 : runtime.sessionEpochs[source];
  const sourceAvailable = source === 'all' ? runtime.activeSources.length > 0 : runtime.activeSources.includes(source);
  const aggregateSessions =
    source === 'all' && !sourceAvailable
      ? runtime.enabledNotificationSources.map((candidate) => runtime.sessions[candidate])
      : [];
  const sourceUnknown =
    source === 'all'
      ? aggregateSessions.some((session) => session.identityTrust === 'unknown')
      : runtime.enabledNotificationSources.includes(source) && runtime.sessions[source].identityTrust === 'unknown';
  const categoriesQueryKey = forumQueryKeys.notificationCategories({ source, identityKey });
  const categoriesQuery = useQuery({
    queryKey: categoriesQueryKey,
    enabled: runtime.ready && source !== 'all' && sourceAvailable && isFocused,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      if (source === 'all') return [];
      const blocked = runtime.getReadBlock(source);
      if (blocked) throw blocked;
      try {
        return await runtime.gateway.getCategories(source, identityKey, signal);
      } catch (error) {
        runtime.reportReadError(source, sourceErrorFromUnknown(source, error), runtime.sessionEpochs[source]);
        throw error;
      }
    }
  });
  const categories = useMemo(
    () => (source === 'all' ? [] : categoriesQuery.data || []),
    [categoriesQuery.data, source]
  );
  useEffect(() => {
    if (source === 'all') {
      if (categoryId) setCategoryId('');
      return;
    }
    if (categories.length && !categories.some((category) => category.id === categoryId)) {
      setCategoryId(categories[0]!.id);
    }
  }, [categories, categoryId, source]);
  useEffect(
    () => () => {
      cancelMarkAll();
      retryControllerRef.current?.abort();
      retryControllerRef.current = undefined;
    },
    [
      cancelMarkAll,
      identityKey,
      selectedSourceEpoch,
      source,
      categoryId,
      unreadOnly,
      isFocused,
      runtime.ready,
      sourceAvailable
    ]
  );
  useEffect(
    () => () => {
      refreshRequestRef.current = undefined;
      setRefreshing(false);
    },
    [identityKey, source, categoryId, unreadOnly, isFocused, runtime.ready, sourceAvailable]
  );
  useEffect(
    () => () => {
      recoveryIntentRef.current?.controller.abort();
      recoveryIntentRef.current = undefined;
    },
    [source, categoryId, unreadOnly, isFocused]
  );
  const listQueryKey = forumQueryKeys.notificationList({
    source,
    categoryId: source === 'all' ? null : categoryId,
    identityKey,
    unreadOnly
  });
  const listQuery = useInfiniteQuery<
    NotificationListPage,
    Error,
    InfiniteData<NotificationListPage, NotificationPageParam>,
    ReturnType<typeof forumQueryKeys.notificationList>,
    NotificationPageParam
  >({
    queryKey: listQueryKey,
    enabled: runtime.ready && sourceAvailable && isFocused && (source === 'all' || Boolean(categoryId)),
    staleTime: 0,
    refetchInterval: (query) =>
      isFocused &&
      (query.state.data?.pages.length || 0) <= 1 &&
      (source === 'all'
        ? runtime.activeSources.some((candidate) => !runtime.getReadBlock(candidate))
        : !runtime.getReadBlock(source))
        ? 60_000
        : false,
    refetchIntervalInBackground: false,
    initialPageParam: {} as NotificationPageParam,
    queryFn: async ({ pageParam, signal }): Promise<NotificationListPage> => {
      if (source === 'all') {
        const blockedSources = runtime.activeSources.filter((candidate) => runtime.getReadBlock(candidate));
        const page = await runtime.gateway.listAllPage({
          cursors: pageParam.allCursors,
          limit: 30,
          signal,
          sources: runtime.activeSources.filter((candidate) => !blockedSources.includes(candidate)),
          unreadOnly
        });
        for (const candidate of runtime.activeSources) {
          const error = page.errors[candidate];
          if (error) runtime.reportReadError(candidate, error, runtime.sessionEpochs[candidate]);
        }
        const previous =
          queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey);
        const previousPage =
          previous?.pages[
            previous.pageParams.findIndex((param) => JSON.stringify(param) === JSON.stringify(pageParam))
          ];
        const retainedSources = runtime.activeSources.filter(
          (candidate) => blockedSources.includes(candidate) || page.qualities[candidate] === 'invalid'
        );
        return {
          items: [
            ...page.items,
            ...(previousPage?.items.filter((item) => retainedSources.includes(item.source)) || [])
          ],
          errors: {
            ...page.errors,
            ...Object.fromEntries(blockedSources.map((candidate) => [candidate, runtime.getReadBlock(candidate)!]))
          },
          hasMore: page.hasMore,
          nextPage: { allCursors: page.nextCursors } satisfies NotificationPageParam
        };
      }
      try {
        const blocked = runtime.getReadBlock(source);
        if (blocked) throw blocked;
        const page = await runtime.gateway.listPage(source, {
          categoryId,
          cursor: pageParam.sourceCursor,
          expectedIdentityKey: identityKey,
          limit: 30,
          signal,
          unreadOnly
        });
        const qualityError = notificationPageError(page.quality);
        if (page.quality === 'invalid') throw qualityError;
        const errors: Partial<Record<NotificationSource, SourceErrorInfo>> = {};
        if (qualityError) {
          errors[source] = sourceErrorFromUnknown(source, qualityError);
          runtime.reportReadError(source, errors[source], runtime.sessionEpochs[source]);
        }
        return {
          items: page.items,
          errors,
          hasMore: page.hasMore && !qualityError,
          nextPage: { sourceCursor: page.cursor } satisfies NotificationPageParam,
          historyNotices: page.historyNotice ? { [source]: page.historyNotice } : {}
        };
      } catch (error) {
        const info = sourceErrorFromUnknown(source, error);
        runtime.reportReadError(source, info, runtime.sessionEpochs[source]);
        const previous =
          queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey);
        const previousPage =
          previous?.pages[previous.pageParams.findIndex((param) => param.sourceCursor === pageParam.sourceCursor)];
        return {
          items: previousPage?.items || [],
          errors: { [source]: info },
          hasMore: false,
          nextPage: {} satisfies NotificationPageParam,
          historyNotices: previousPage?.historyNotices
        };
      }
    },
    getNextPageParam: (lastPage, _pages, _pageParam, allPageParams) =>
      resolveNotificationNextPage({ source, ...lastPage, consumedPages: allPageParams }).nextPage
  });
  const items = useMemo(() => {
    const unique = new Map<string, ForumNotification>();
    listQuery.data?.pages.forEach((page) => {
      page.items.forEach((item) => unique.set(`${item.source}:${item.id}`, item));
    });
    return sortNotifications([...unique.values()]);
  }, [listQuery.data]);
  const fetchNextPage = listQuery.fetchNextPage;
  const hasNextPage = listQuery.hasNextPage;
  const isFetchingNextPage = listQuery.isFetchingNextPage;
  const loadMore = useLatestCallback(() => {
    if (
      !isFocused ||
      !runtime.ready ||
      !sourceAvailable ||
      !hasNextPage ||
      refreshRequestRef.current ||
      (source !== 'all' && !categoryId)
    )
      return;
    const current = queryClient.getQueryState(listQueryKey);
    if (!current?.data || current.data !== listQuery.data) return;
    const fetchingNextPage = current?.fetchStatus !== 'idle' && current?.fetchMeta?.fetchMore?.direction === 'forward';
    if (!fetchingNextPage) void fetchNextPage();
  });
  useEffect(() => {
    if (source === 'all' || !isFocused || items.length || !hasNextPage || isFetchingNextPage) {
      return;
    }
    loadMore();
  }, [
    loadMore,
    hasNextPage,
    isFetchingNextPage,
    isFocused,
    items.length,
    listQuery.data?.pages.length,
    refreshing,
    runtime.ready,
    source,
    sourceAvailable
  ]);
  const errors = useMemo(() => {
    const result: Partial<Record<NotificationSource, SourceErrorInfo>> = Object.assign(
      {},
      ...(listQuery.data?.pages.map((page) => page.errors) || [])
    );
    listQuery.data?.pages.forEach((page, index) => {
      const { repeatedSources } = resolveNotificationNextPage({
        source,
        ...page,
        consumedPages: listQuery.data.pageParams.slice(0, index + 1)
      });
      for (const candidate of repeatedSources) {
        result[candidate] ||= sourceErrorFromUnknown(candidate, new Error('来源返回了重复的消息分页，请重试该站。'));
      }
    });
    if (source !== 'all' && categoriesQuery.error) {
      result[source] = sourceErrorFromUnknown(source, categoriesQuery.error);
    }
    for (const candidate of runtime.enabledNotificationSources) {
      if (source !== 'all' && source !== candidate) continue;
      const block = runtime.getReadBlock(candidate);
      if (block) result[candidate] = block;
    }
    Object.keys(result).forEach((candidate) => {
      if (!runtime.enabledNotificationSources.includes(candidate as NotificationSource)) {
        delete result[candidate as NotificationSource];
      }
    });
    return result;
  }, [categoriesQuery.error, listQuery.data, runtime, source]);
  const historyNotices = useMemo<Partial<Record<NotificationSource, string>>>(
    () => Object.assign({}, ...(listQuery.data?.pages.map((page) => page.historyNotices) || [])),
    [listQuery.data]
  );
  const pagination = useMemo(() => {
    const lastPage = listQuery.data?.pages.at(-1);
    const result: Partial<Record<NotificationSource, 'more' | 'complete'>> = {};
    if (!lastPage) return result;
    if (source !== 'all') {
      if (!errors[source]) result[source] = lastPage.hasMore ? 'more' : 'complete';
      return result;
    }
    for (const candidate of runtime.activeSources) {
      const cursor = lastPage.nextPage.allCursors?.[candidate];
      if (!errors[candidate] && cursor !== undefined) result[candidate] = cursor === null ? 'complete' : 'more';
    }
    return result;
  }, [errors, listQuery.data, runtime.activeSources, source]);
  const refetch = listQuery.refetch;
  const refresh = useLatestCallback(() => {
    if (!isFocused || !runtime.ready || !sourceAvailable || refreshRequestRef.current) return;
    const request = {};
    refreshRequestRef.current = request;
    setRefreshing(true);
    void Promise.allSettled([refetch(), refreshSnapshots()]).finally(() => {
      if (refreshRequestRef.current !== request) return;
      refreshRequestRef.current = undefined;
      setRefreshing(false);
    });
  });
  const retryReadSource = useCallback(
    async (candidate: NotificationSource): Promise<LinuxDoReadResumeOutcome> => {
      const expectedIdentityKey = runtime.identityKeys[candidate];
      const epoch = runtime.sessionEpochs[candidate];
      if (!expectedIdentityKey || !runtime.activeSources.includes(candidate)) return 'stale';
      const controller = new AbortController();
      retryControllerRef.current?.abort();
      retryControllerRef.current = controller;
      const current = () =>
        !controller.signal.aborted &&
        latestRuntimeRef.current.identityKeys[candidate] === expectedIdentityKey &&
        latestRuntimeRef.current.sessionEpochs[candidate] === epoch &&
        latestRuntimeRef.current.enabledNotificationSources.includes(candidate);
      const cached = queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey);
      const failedPageIndex =
        cached?.pages.findIndex(
          (page, index) =>
            page.errors[candidate] ||
            resolveNotificationNextPage({
              source,
              ...page,
              consumedPages: cached.pageParams.slice(0, index + 1)
            }).repeatedSources.includes(candidate)
        ) ?? -1;
      const pageIndex = failedPageIndex < 0 ? 0 : failedPageIndex;
      const retryCategories = source !== 'all' && Boolean(categoriesQuery.error);
      try {
        if (retryCategories) {
          await queryClient.fetchQuery({
            queryKey: categoriesQueryKey,
            staleTime: 0,
            queryFn: async () => {
              const categories = await runtime.gateway.getCategories(candidate, expectedIdentityKey, controller.signal);
              if (!current()) throw new Error('操作已取消');
              return categories;
            }
          });
        } else {
          const page = await runtime.gateway.listPage(candidate, {
            ...(source === 'all'
              ? { cursor: cached?.pageParams[pageIndex]?.allCursors?.[candidate] }
              : { categoryId, cursor: cached?.pageParams[pageIndex]?.sourceCursor }),
            expectedIdentityKey,
            limit: 30,
            signal: controller.signal,
            unreadOnly
          });
          if (!current()) return 'stale';
          const qualityError = notificationPageError(page.quality);
          if (page.quality === 'invalid') throw qualityError;
          const pageHasMore = page.hasMore && !qualityError;
          queryClient.setQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey, (data) => {
            if (!data?.pages[pageIndex]) return data;
            const nextCursor = pageHasMore ? page.cursor : null;
            const withCursor = (oldPage: NotificationListPage) => {
              if (source !== 'all') return { ...oldPage, hasMore: pageHasMore, nextPage: { sourceCursor: nextCursor } };
              const allCursors = { ...oldPage.nextPage.allCursors, [candidate]: nextCursor };
              return {
                ...oldPage,
                hasMore: Object.values(allCursors).some((value) => value != null),
                nextPage: { allCursors }
              };
            };
            const pages = data.pages.map((oldPage, index) => {
              if (index !== pageIndex) return oldPage;
              const errors = { ...oldPage.errors };
              const historyNotices = { ...oldPage.historyNotices };
              if (page.historyNotice) historyNotices[candidate] = page.historyNotice;
              else delete historyNotices[candidate];
              if (qualityError) errors[candidate] = sourceErrorFromUnknown(candidate, qualityError);
              else delete errors[candidate];
              return withCursor({
                ...oldPage,
                errors,
                historyNotices,
                items: [...oldPage.items.filter((item) => item.source !== candidate), ...page.items]
              });
            });
            if (source === 'all' && pageIndex !== pages.length - 1)
              pages[pages.length - 1] = withCursor(pages[pages.length - 1]!);
            return { ...data, pages };
          });
          if (qualityError) throw qualityError;
        }
        if (!current()) return 'stale';
        runtime.clearReadBlock(candidate, epoch);
        return 'completed';
      } catch (error) {
        if (!current()) return 'stale';
        const info = sourceErrorFromUnknown(candidate, error);
        runtime.clearReadBlock(candidate, epoch);
        runtime.reportReadError(candidate, info, epoch);
        if (!retryCategories)
          queryClient.setQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(
            listQueryKey,
            (data) =>
              data && {
                ...data,
                pages: data.pages.map((page, index) =>
                  index === pageIndex ? { ...page, errors: { ...page.errors, [candidate]: info } } : page
                )
              }
          );
        return info.kind === 'verification-required' ? 'verification-required' : 'failed';
      } finally {
        if (retryControllerRef.current === controller) retryControllerRef.current = undefined;
      }
    },
    [
      categoriesQuery.error,
      categoriesQueryKey,
      categoryId,
      latestRuntimeRef,
      listQueryKey,
      queryClient,
      runtime,
      source,
      unreadOnly
    ]
  );
  const retrySource = useCallback(
    (candidate: NotificationSource) => {
      if (!isFocused || !runtime.enabledNotificationSources.includes(candidate) || recoveryIntentRef.current?.pending)
        return;
      recoveryIntentRef.current?.controller.abort();
      const intent = { controller: new AbortController(), pending: true };
      recoveryIntentRef.current = intent;
      const epoch = runtime.sessionEpochs[candidate];
      const current = () =>
        !intent.controller.signal.aborted &&
        latestRuntimeRef.current.enabledNotificationSources.includes(candidate) &&
        latestRuntimeRef.current.sessionEpochs[candidate] === epoch;
      const recovery: LinuxDoReadRecovery = {
        queryKey: source !== 'all' && categoriesQuery.error ? categoriesQueryKey : listQueryKey,
        resume: () => (current() ? retryReadSource(candidate) : Promise.resolve('stale'))
      };
      return (async () => {
        let info = errors[candidate];
        if (notificationErrorAction(info) === '重试') {
          const result = await runtime.reconcileAccountStatus(candidate);
          if (
            result.status === 'anonymous' &&
            !intent.controller.signal.aborted &&
            latestRuntimeRef.current.enabledNotificationSources.includes(candidate)
          ) {
            await runtime.openAccountSurface(candidate, '登录已失效，请重新登录。');
            return;
          }
          if (!current()) return;
          if (result.status === 'unknown') {
            if (result.errorInfo.kind !== 'verification-required') {
              runtime.notify(`${info?.message || '消息读取失败'}；账号状态暂不可确认：${result.error}`);
              return;
            }
            info = result.errorInfo;
            runtime.reportReadError(candidate, info, epoch);
          } else if (result.status !== 'same') return;
        }
        if (!current()) return;
        if (info && notificationErrorAction(info) !== '重试') {
          await runtime.openAccountSurface(
            candidate,
            info.message,
            info.kind === 'verification-required' ? recovery : undefined
          );
        } else await retryReadSource(candidate);
      })()
        .catch((error) => {
          if (current()) runtime.notify(errorMessage(error));
        })
        .finally(() => {
          if (recoveryIntentRef.current === intent) intent.pending = false;
        });
    },
    [
      categoriesQuery.error,
      categoriesQueryKey,
      errors,
      isFocused,
      latestRuntimeRef,
      listQueryKey,
      retryReadSource,
      runtime,
      source
    ]
  );
  const markAll = useCallback(() => {
    if (
      markAllControllerRef.current ||
      !isFocused ||
      source === 'all' ||
      source === 'yaohuo' ||
      !runtime.enabledNotificationSources.includes(source) ||
      !runtime.activeSources.includes(source) ||
      categoryId !== categories[0]?.id
    ) {
      return;
    }
    const expectedIdentityKey = runtime.identityKeys[source];
    if (!expectedIdentityKey) return;
    const controller = new AbortController();
    markAllControllerRef.current = controller;
    let submitted = false;
    Alert.alert('全部标记为已读', `将 ${sourceCatalog[source].label} 现有消息全部标记为已读？`, [
      {
        text: '取消',
        style: 'cancel',
        onPress: () => {
          if (markAllControllerRef.current === controller) cancelMarkAll();
        }
      },
      {
        text: '确认',
        onPress: () => {
          if (submitted || markAllControllerRef.current !== controller || controller.signal.aborted) return;
          submitted = true;
          setMarkAllBusy(true);
          void runtime.gateway
            .markAllRead(source, expectedIdentityKey, controller.signal)
            .then((result) => {
              if (markAllControllerRef.current !== controller || controller.signal.aborted) return;
              runtime.notify(result.confirmed ? '已按原站状态标记全部已读' : result.message || '原站未确认已读');
            })
            .finally(async () => {
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
  }, [cancelMarkAll, categories, categoryId, isFocused, queryClient, runtime, source]);
  const changeSource = useCallback(
    (nextSource: NotificationFilterSource) => {
      if (nextSource === source) return;
      if (nextSource !== 'all' && !runtime.enabledNotificationSources.includes(nextSource)) return;
      setCategoryId('');
      setSource(nextSource);
    },
    [runtime.enabledNotificationSources, source]
  );
  const retryAccountStatus = useCallback(async () => {
    const candidates =
      source === 'all'
        ? runtime.enabledNotificationSources
        : runtime.enabledNotificationSources.includes(source)
          ? [source]
          : [];
    for (const candidate of candidates) {
      if (runtime.sessions[candidate].identityTrust === 'unknown') {
        await retrySource(candidate);
      }
    }
  }, [retrySource, runtime, source]);
  return (
    <NotificationsScreen
      initializationError={runtime.initializationError}
      storageReady={runtime.ready}
      onRetryInitialization={() => void runtime.retryInitialization()}
      activeSources={runtime.activeSources}
      categories={categories}
      categoryId={categoryId}
      errors={errors}
      enabledSources={runtime.enabledNotificationSources}
      fetchingMore={listQuery.isFetchingNextPage}
      hasMore={Boolean(listQuery.hasNextPage)}
      items={items}
      loading={(listQuery.isLoading || (source !== 'all' && categoriesQuery.isLoading)) && sourceAvailable}
      markAllBusy={markAllBusy}
      historyNotices={historyNotices}
      pagination={pagination}
      refreshing={refreshing}
      source={source}
      sourcePending={false}
      sourceUnknown={sourceUnknown}
      unreadOnly={unreadOnly}
      onChangeCategory={setCategoryId}
      onChangeSource={changeSource}
      onChangeUnreadOnly={setUnreadOnly}
      onItemPress={(notification) => {
        if (
          !runtime.enabledNotificationSources.includes(notification.source) ||
          !runtime.activeSources.includes(notification.source)
        ) {
          return;
        }
        const identityKey = runtime.identityKeys[notification.source];
        if (identityKey) navigation.navigate('NotificationDetail', { identityKey, notification });
      }}
      onLoadMore={loadMore}
      onLoginSource={(candidate) => {
        if (isFocused && runtime.enabledNotificationSources.includes(candidate)) {
          void runtime
            .openAccountSurface(candidate, '请登录并确认账号身份。')
            .catch((error) => runtime.notify(errorMessage(error)));
        }
      }}
      onMarkAll={markAll}
      onRefresh={refresh}
      onRetryAccountStatus={retryAccountStatus}
      onRetrySource={(candidate) => {
        void retrySource(candidate);
      }}
    />
  );
}

type NotificationDetailRouteProps = NativeStackScreenProps<RootStackParamList, 'NotificationDetail'>;

export function NotificationDetailRoute({ navigation, route }: NotificationDetailRouteProps) {
  const runtime = useNotificationRouteRuntime();
  const source = route.params.notification.source;
  if (!runtime.enabledNotificationSources.includes(source)) {
    return (
      <ContentSourceDisabledState
        source={source}
        onBack={navigation.goBack}
        onManage={() => navigation.dispatch(manageContentSourcesAction())}
      />
    );
  }
  return (
    <EnabledNotificationDetailRoute
      key={`${source}:${route.params.identityKey}:${route.params.notification.id}`}
      navigation={navigation}
      route={route}
      runtime={runtime}
    />
  );
}

function EnabledNotificationDetailRoute({
  navigation,
  route,
  runtime
}: NotificationDetailRouteProps & { runtime: NotificationRouteRuntimeValue }) {
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
  const notify = runtime.notify;
  const refreshSnapshots = runtime.refreshSnapshots;
  const markPhaseRef = useRef<'idle' | 'pending' | 'confirmed' | 'retryable'>('idle');
  const markAttemptedThisVisit = useRef(false);
  const attemptedMessageIds = useRef(new Set<string>());
  const confirmedMessageIds = useRef(new Set<string>());
  const [markPhase, setMarkPhase] = useState(markPhaseRef.current);
  const markControllerRef = useRef<{ controller: AbortController; messageIds: string[] } | undefined>(undefined);
  const replyControllerRef = useRef<AbortController | undefined>(undefined);
  const pendingReplyRef = useRef<{ content: string; dispatchState: RequestDispatchState } | undefined>(undefined);
  const uncertainRepliesRef = useRef(new Set<string>());
  const replyConfirmationRef = useRef<AbortController | undefined>(undefined);
  const composerControllersRef = useRef(new Set<AbortController>());
  const replyBusyRef = useRef(false);
  const routeFocused = useIsFocused();
  const appFocused = useSyncExternalStore(focusManager.subscribe, () => focusManager.isFocused());
  const replySessionEpoch = runtime.sessionEpochs[item.source];
  const nodeSeekConversation = item.source === 'nodeseek' && item.target.type === 'private-conversation';
  const [markMessage, setMarkMessage] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [replyPendingNodeSeekPolls, setReplyPendingNodeSeekPolls] = useState<PendingNodeSeekPoll[]>([]);
  const [replyError, setReplyError] = useState('');
  const [replyStatus, setReplyStatus] = useState('');
  const [replyVisible, setReplyVisible] = useState(false);
  const policyControllerRef = useRef<AbortController | undefined>(undefined);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const [policyStatus, setPolicyStatus] = useState('');
  const [policySubmittedAcceptance, setPolicySubmittedAcceptance] = useState<boolean | undefined>(undefined);
  const [messageHistory, setMessageHistory] = useState<{
    sessionEpoch: number;
    messages: NotificationMessage[];
    olderCursor: string | null;
    consumedCursors: string[];
    blocked?: boolean;
  }>();
  const historyRef = useCommittedRef(messageHistory);
  const historyControllerRef = useRef<
    | { controller: AbortController; resetting: true }
    | { controller: AbortController; resetting: false; cursor: string }
    | undefined
  >(undefined);
  const historyScopeRef = useCommittedRef({ canAccessSource, routeFocused, sessionEpoch: replySessionEpoch });
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  useLayoutEffect(() => {
    const request = historyControllerRef.current;
    if (!request || request.resetting || messageHistory?.consumedCursors.at(-1) !== request.cursor) return;
    historyControllerRef.current = undefined;
    setHistoryBusy(false);
  }, [messageHistory]);
  const cancelHistory = useCallback(() => {
    historyControllerRef.current?.controller.abort();
    historyControllerRef.current = undefined;
    setHistoryBusy(false);
  }, []);
  useEffect(() => {
    setMessageHistory(undefined);
    setHistoryError('');
    return cancelHistory;
  }, [cancelHistory, replySessionEpoch]);
  useEffect(() => {
    if (!routeFocused || !canAccessSource) cancelHistory();
  }, [canAccessSource, cancelHistory, routeFocused]);
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (!focused) cancelHistory();
      }),
    [cancelHistory]
  );
  const cancelReplyConfirmation = useCallback(() => {
    replyConfirmationRef.current?.abort();
    replyConfirmationRef.current = undefined;
  }, []);
  const cancelReply = useCallback(() => {
    const attempt = pendingReplyRef.current;
    if (attempt?.dispatchState.mayHaveSent) uncertainRepliesRef.current.add(attempt.content);
    pendingReplyRef.current = undefined;
    replyControllerRef.current?.abort();
    replyControllerRef.current = undefined;
    replyBusyRef.current = false;
    cancelReplyConfirmation();
  }, [cancelReplyConfirmation]);
  useEffect(
    () => cancelReplyConfirmation,
    [cancelReplyConfirmation, replyContent, routeFocused, canAccessSource, identityKey, replySessionEpoch]
  );
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (focused) return;
        cancelReplyConfirmation();
        if (pendingReplyRef.current) {
          cancelReply();
          setReplyBusy(false);
        }
      }),
    [cancelReply, cancelReplyConfirmation]
  );
  const detailQueryKey = forumQueryKeys.notificationDetail({
    source: item.source,
    identityKey,
    notificationId: item.id
  });
  const detailReadEpochRef = useRef<number | undefined>(undefined);
  const detailQuery = useQuery({
    queryKey: detailQueryKey,
    enabled: canAccessSource && routeFocused,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval:
      nodeSeekConversation && routeFocused && canAccessSource && !runtime.getReadBlock(item.source) ? 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const detail = await runtime.gateway.loadDetail(item, identityKey, signal);
      if (!signal.aborted) detailReadEpochRef.current = replySessionEpoch;
      return detail;
    }
  });
  const policy = detailQuery.data?.policy;
  useEffect(() => {
    const messages = detailQuery.data?.messages;
    const pagination = detailQuery.data?.messageHistory;
    if (
      !canAccessSource ||
      !messages ||
      !pagination ||
      !detailQuery.isSuccess ||
      detailQuery.isFetching ||
      detailReadEpochRef.current !== replySessionEpoch
    )
      return;
    const previous = historyRef.current;
    const current = previous?.sessionEpoch === replySessionEpoch ? previous : undefined;
    const latestIds = new Set(messages.map((message) => message.id));
    const overlap = current?.messages.some((message) => latestIds.has(message.id));
    const latestStartIndex = current?.messages.findIndex((message) => message.id === messages[0]?.id) ?? -1;
    const resetting = historyControllerRef.current?.resetting;
    if (current && latestStartIndex >= 0 && !resetting) {
      setMessageHistory({
        ...current,
        messages: [...current.messages.slice(0, latestStartIndex), ...messages]
      });
      return;
    }
    if (current?.messages.length && !resetting) {
      cancelHistory();
      setHistoryError(
        overlap
          ? '最新消息范围已变化，已重新从最新消息开始；可继续加载更早消息。'
          : '最新消息与已加载历史不连续，已重新从最新消息开始；可继续加载更早消息。'
      );
    }
    setMessageHistory({
      sessionEpoch: replySessionEpoch,
      messages,
      olderCursor: pagination.olderCursor,
      consumedCursors: []
    });
  }, [
    canAccessSource,
    cancelHistory,
    detailQuery.data,
    detailQuery.dataUpdatedAt,
    detailQuery.isFetching,
    detailQuery.isSuccess,
    historyRef,
    replySessionEpoch
  ]);
  const historyRequestCurrent = useCallback(
    (controller: AbortController, sessionEpoch: number) =>
      historyControllerRef.current?.controller === controller &&
      !controller.signal.aborted &&
      historyScopeRef.current.canAccessSource &&
      historyScopeRef.current.routeFocused &&
      historyScopeRef.current.sessionEpoch === sessionEpoch &&
      focusManager.isFocused(),
    [historyScopeRef]
  );
  const loadEarlierMessages = useLatestCallback(async () => {
    const history = historyRef.current;
    if (
      !history?.olderCursor ||
      history.blocked ||
      history.sessionEpoch !== replySessionEpoch ||
      !canAccessSource ||
      !routeFocused ||
      !focusManager.isFocused() ||
      historyControllerRef.current
    )
      return;
    const controller = new AbortController();
    historyControllerRef.current = { controller, resetting: false, cursor: history.olderCursor };
    setHistoryBusy(true);
    setHistoryError('');
    let waitingForCommit = false;
    try {
      const page = await gateway.loadEarlierMessages(item, history.olderCursor, identityKey, controller.signal);
      if (!historyRequestCurrent(controller, history.sessionEpoch)) return;
      const consumedCursors = [...history.consumedCursors, history.olderCursor];
      const repeated = page.olderCursor !== null && consumedCursors.includes(page.olderCursor);
      if (repeated) setHistoryError('原站历史游标重复，已停止加载；请重新读取会话后重试。');
      waitingForCommit = true;
      setMessageHistory(
        (current) =>
          current && {
            ...current,
            messages: Array.from(
              new Map([...page.messages, ...current.messages].map((message) => [message.id, message])).values()
            ),
            olderCursor: repeated ? history.olderCursor : page.olderCursor,
            blocked: repeated,
            consumedCursors
          }
      );
    } catch (error) {
      if (historyRequestCurrent(controller, history.sessionEpoch))
        setHistoryError(`更早消息读取失败：${errorMessage(error)}`);
    } finally {
      if (!waitingForCommit && historyControllerRef.current?.controller === controller) {
        historyControllerRef.current = undefined;
        setHistoryBusy(false);
      }
    }
  });
  const resetMessageHistory = useLatestCallback(async () => {
    if (!canAccessSource || !routeFocused || !focusManager.isFocused() || historyControllerRef.current) return;
    const controller = new AbortController();
    historyControllerRef.current = { controller, resetting: true };
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const result = await detailQuery.refetch();
      if (!historyRequestCurrent(controller, replySessionEpoch)) return;
      if (result.error) throw result.error;
      if (result.data?.messages && result.data.messageHistory) {
        setMessageHistory({
          sessionEpoch: replySessionEpoch,
          messages: result.data.messages,
          olderCursor: result.data.messageHistory.olderCursor,
          consumedCursors: []
        });
        setHistoryError('');
      }
    } catch (error) {
      if (historyRequestCurrent(controller, replySessionEpoch))
        setHistoryError(`重新读取会话失败：${errorMessage(error)}`);
    } finally {
      if (historyControllerRef.current?.controller === controller) {
        historyControllerRef.current = undefined;
        setHistoryBusy(false);
      }
    }
  });
  const displayDetail = useMemo(() => {
    const detail = detailQuery.data;
    return detail && messageHistory?.sessionEpoch === replySessionEpoch
      ? { ...detail, messages: messageHistory.messages, messageHistory: { olderCursor: messageHistory.olderCursor } }
      : detail;
  }, [detailQuery.data, messageHistory, replySessionEpoch]);
  useEffect(() => {
    if (
      item.source !== 'linuxdo' ||
      (item.target.type !== 'topic' && item.target.type !== 'topic-post') ||
      !canAccessSource ||
      !policy ||
      !detailQuery.isSuccess ||
      detailQuery.isFetching ||
      detailReadEpochRef.current !== replySessionEpoch
    )
      return;
    syncDiscoursePolicyCaches(queryClient, { topicId: item.target.topicId, sessionEpoch: replySessionEpoch, policy });
  }, [
    canAccessSource,
    detailQuery.dataUpdatedAt,
    detailQuery.isFetching,
    detailQuery.isSuccess,
    item.source,
    item.target,
    policy,
    queryClient,
    replySessionEpoch
  ]);
  const actorUser = useMemo(
    () =>
      canAccessSource && detailQuery.data
        ? notificationActorUser(detailQuery.data.notification) || undefined
        : undefined,
    [canAccessSource, detailQuery.data]
  );
  const actorInHeader = Boolean(detailQuery.data?.messages && actorUser && item.source !== 'linuxdo');
  const policyAwaitingRead = policySubmittedAcceptance !== undefined && policy?.accepted !== policySubmittedAcceptance;
  useEffect(() => {
    setPolicyBusy(false);
    setPolicyError('');
    setPolicyStatus('');
    setPolicySubmittedAcceptance(undefined);
    return () => {
      policyControllerRef.current?.abort();
      policyControllerRef.current = undefined;
    };
  }, [identityKey, item.id, policy?.postId, policy?.version, replySessionEpoch]);
  useEffect(() => {
    if (routeFocused && canAccessSource) return;
    policyControllerRef.current?.abort();
    policyControllerRef.current = undefined;
    setPolicyBusy(false);
  }, [canAccessSource, routeFocused]);
  useEffect(() => {
    if (policySubmittedAcceptance !== undefined && policy?.accepted === policySubmittedAcceptance) {
      setPolicySubmittedAcceptance(undefined);
      setPolicyStatus('');
    }
  }, [policy?.accepted, policySubmittedAcceptance]);
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (focused) return;
        policyControllerRef.current?.abort();
        policyControllerRef.current = undefined;
        setPolicyBusy(false);
      }),
    []
  );
  const discourseEmojiSource =
    appFocused && routeFocused && canAccessSource && detailQuery.data?.reply && isDiscourseSource(item.source)
      ? item.source
      : null;
  const discourseEmojiQuery = useQuery({
    queryKey: forumQueryKeys.emojiUrls(discourseEmojiSource),
    gcTime: Infinity,
    enabled: Boolean(discourseEmojiSource),
    queryFn: ({ signal }) =>
      discourseEmojiSource
        ? retryEmojiCatalog(
            () => runtime.composer.getDiscourseEmojiUrls({ source: discourseEmojiSource, signal }),
            signal
          )
        : Promise.resolve({} as DiscourseEmojiUrlMap)
  });
  const discourseEmojiUrls = discourseEmojiSource ? discourseEmojiQuery.data || {} : {};
  useEffect(() => {
    navigation.setOptions?.({
      title: canAccessSource && detailQuery.data?.messages ? detailQuery.data.title : '消息详情',
      headerTitle:
        actorInHeader && actorUser
          ? () => (
              <NotificationContactTitle
                user={actorUser}
                onPress={() => navigation.navigate('User', { user: actorUser })}
              />
            )
          : undefined
    });
  }, [actorInHeader, actorUser, canAccessSource, detailQuery.data?.messages, detailQuery.data?.title, navigation]);
  useEffect(
    () => () => {
      cancelReply();
      composerControllersRef.current.forEach((controller) => controller.abort());
      composerControllersRef.current.clear();
    },
    [cancelReply, identityKey, item.id]
  );
  useEffect(() => {
    if (routeFocused) return;
    cancelReply();
    composerControllersRef.current.forEach((controller) => controller.abort());
    composerControllersRef.current.clear();
    setReplyBusy(false);
    void queryClient.cancelQueries({ queryKey: detailQueryKey });
  }, [cancelReply, detailQueryKey, queryClient, routeFocused]);
  useEffect(() => {
    if (canAccessSource) return;
    cancelReply();
    composerControllersRef.current.forEach((controller) => controller.abort());
    composerControllersRef.current.clear();
    setReplyBusy(false);
    if (currentIdentityKey !== identityKey) {
      uncertainRepliesRef.current.clear();
      setReplyContent('');
      setReplyPendingNodeSeekPolls([]);
    }
    setReplyError('');
    setReplyStatus('');
    setReplyVisible(false);
  }, [cancelReply, canAccessSource, currentIdentityKey, identityKey]);
  const updateMarkPhase = useCallback((phase: typeof markPhaseRef.current) => {
    markPhaseRef.current = phase;
    setMarkPhase(phase);
  }, []);
  useEffect(() => {
    markAttemptedThisVisit.current = false;
    setMarkPhase(markPhaseRef.current);
    const cancelMark = () => {
      const attempt = markControllerRef.current;
      attempt?.controller.abort();
      attempt?.messageIds.forEach((id) => {
        if (!confirmedMessageIds.current.has(id)) attemptedMessageIds.current.delete(id);
      });
      markControllerRef.current = undefined;
      if (markPhaseRef.current === 'pending') markPhaseRef.current = 'retryable';
      markAttemptedThisVisit.current = false;
    };
    const unsubscribe = focusManager.subscribe((focused) => {
      if (!focused) {
        cancelMark();
        setMarkPhase(markPhaseRef.current);
      }
    });
    return () => {
      unsubscribe();
      cancelMark();
    };
  }, [routeFocused, canAccessSource]);
  const markRead = useLatestCallback(async (refreshDetail: boolean) => {
    if (
      !routeFocused ||
      !focusManager.isFocused() ||
      !canAccessSource ||
      markPhaseRef.current === 'pending' ||
      (!nodeSeekConversation && (!item.unread || markPhaseRef.current === 'confirmed'))
    )
      return;
    markAttemptedThisVisit.current = true;
    const controller = new AbortController();
    let unreadMessageIds: string[] = [];
    const attempt = { controller, messageIds: unreadMessageIds };
    markControllerRef.current = attempt;
    updateMarkPhase('pending');
    const current = () =>
      markControllerRef.current === attempt && !controller.signal.aborted && focusManager.isFocused();
    try {
      const refreshed = refreshDetail ? await detailQuery.refetch() : undefined;
      if (!current()) return;
      if (refreshed?.error) throw refreshed.error;
      const detail = refreshed ? refreshed.data : detailQuery.data;
      if (!detail) throw new Error('消息详情暂不可用');
      unreadMessageIds = (detail.unreadMessageIds || []).filter(
        (id) => !confirmedMessageIds.current.has(id) && (refreshDetail || !attemptedMessageIds.current.has(id))
      );
      attempt.messageIds = unreadMessageIds;
      if (nodeSeekConversation && !unreadMessageIds.length) {
        updateMarkPhase(
          detail.unreadMessageIds?.some((id) => !confirmedMessageIds.current.has(id)) ? 'retryable' : 'confirmed'
        );
        if (markPhaseRef.current === 'confirmed') setMarkMessage('');
        return;
      }
      unreadMessageIds.forEach((id) => attemptedMessageIds.current.add(id));
      const result = await gateway.markRead(
        item,
        nodeSeekConversation ? { ...detail, unreadMessageIds } : detail,
        identityKey,
        controller.signal
      );
      if (current()) {
        if (result.confirmed) unreadMessageIds.forEach((id) => confirmedMessageIds.current.add(id));
        const remainingUnread =
          nodeSeekConversation && detail.unreadMessageIds?.some((id) => !confirmedMessageIds.current.has(id));
        updateMarkPhase(result.confirmed && !remainingUnread ? 'confirmed' : 'retryable');
        setMarkMessage(
          result.confirmed
            ? remainingUnread
              ? '部分消息的已读状态未确认'
              : ''
            : result.message || '原站未确认已读状态'
        );
      }
    } catch (error) {
      if (current()) {
        updateMarkPhase('retryable');
        setMarkMessage(`已读状态未更新：${errorMessage(error)}`);
      }
    } finally {
      if (markControllerRef.current === attempt) markControllerRef.current = undefined;
      // A canceled response cannot undo a server write. Reconciliation failure
      // must not turn a confirmed write back into a retryable attempt.
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications(item.source), 'list'] }),
        queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications('all'), 'list'] }),
        refreshSnapshots()
      ]);
    }
  });
  useEffect(() => {
    if (
      routeFocused &&
      canAccessSource &&
      detailQuery.data &&
      !detailQuery.isFetching &&
      !detailQuery.isError &&
      (!markAttemptedThisVisit.current ||
        (nodeSeekConversation &&
          detailQuery.data.unreadMessageIds?.some(
            (id) => !attemptedMessageIds.current.has(id) && !confirmedMessageIds.current.has(id)
          )))
    ) {
      void markRead(false);
    }
  }, [
    canAccessSource,
    detailQuery.data,
    detailQuery.dataUpdatedAt,
    detailQuery.isError,
    detailQuery.isFetching,
    markPhase,
    markRead,
    nodeSeekConversation,
    routeFocused
  ]);
  const fallbackTopic =
    item.target.type === 'topic' || item.target.type === 'topic-post' ? parseForumTopicLink(item.target.url) : null;
  const targetTopic = detailQuery.data?.topic || (fallbackTopic ? { ...fallbackTopic, title: item.title } : null);
  const targetCommentId = item.target.type === 'topic-post' ? Number(item.target.postId) : 0;
  const location =
    item.target.type === 'topic-post' &&
    ((Number.isSafeInteger(targetCommentId) && targetCommentId > 0) || item.target.postNumber)
      ? topicLocationForReply(item.source, {
          ...(Number.isSafeInteger(targetCommentId) && targetCommentId > 0 ? { commentId: targetCommentId } : {}),
          ...(item.target.postNumber ? { floor: item.target.postNumber } : {})
        })
      : undefined;
  const openExternalUrl = useCallback(
    (url: string) => {
      if (!isHttpOrHttpsUrl(url)) {
        notify('仅支持打开 http/https 链接。');
        return;
      }
      void WebBrowser.openBrowserAsync(url).catch((error) => notify(errorMessage(error)));
    },
    [notify]
  );
  const runComposerRequest = useCallback(async <T,>(operation: (signal: AbortSignal) => Promise<T>) => {
    const controller = new AbortController();
    composerControllersRef.current.add(controller);
    try {
      return await operation(controller.signal);
    } finally {
      composerControllersRef.current.delete(controller);
    }
  }, []);
  const resolveLinuxDoUpload = useCallback(
    (shortUrl: string) => runComposerRequest((signal) => gateway.resolveLinuxDoUpload(shortUrl, identityKey, signal)),
    [gateway, identityKey, runComposerRequest]
  );
  const loadLinuxDoPollCapabilities = useCallback(
    () => runComposerRequest((signal) => gateway.loadLinuxDoPollCapabilities(identityKey, signal)),
    [gateway, identityKey, runComposerRequest]
  );
  const loadLinuxDoTemplates = useCallback(
    () => runComposerRequest((signal) => gateway.loadLinuxDoTemplates(identityKey, signal)),
    [gateway, identityKey, runComposerRequest]
  );
  const useLinuxDoTemplate = useCallback(
    (id: string) => runComposerRequest((signal) => gateway.recordLinuxDoTemplateUse(id, identityKey, signal)),
    [gateway, identityKey, runComposerRequest]
  );
  const setPolicyAcceptance = useLatestCallback((accepted: boolean) => {
    if (
      !policy ||
      !routeFocused ||
      !focusManager.isFocused() ||
      !canAccessSource ||
      detailQuery.isError ||
      policyAwaitingRead ||
      policyControllerRef.current ||
      (accepted ? !policy.canAccept : !policy.canRevoke)
    )
      return;
    const controller = new AbortController();
    policyControllerRef.current = controller;
    const current = () => policyControllerRef.current === controller && !controller.signal.aborted;
    let submitted = false;
    const submit = async () => {
      if (!current() || submitted) return;
      submitted = true;
      setPolicyBusy(true);
      setPolicyError('');
      setPolicyStatus('');
      try {
        const result = await gateway.setPolicyAcceptance(item, policy, accepted, identityKey, controller.signal);
        if (!current()) return;
        if (result.confirmed) {
          setPolicySubmittedAcceptance(accepted);
          setPolicyStatus(accepted ? '阅读确认已提交，正在核对原站状态。' : '撤销确认已提交，正在核对原站状态。');
        } else setPolicyError(result.message || '原站未确认操作结果，请先重试读取消息核对状态。');
        const refreshed = await detailQuery.refetch();
        if (!current()) return;
        if (refreshed.isError) setPolicyError('暂时无法读取原站最新状态，请重试读取消息后核对。');
        else if (
          refreshed.data?.policy?.postId === policy.postId &&
          refreshed.data.policy.version === policy.version &&
          refreshed.data.policy.accepted === accepted
        ) {
          setPolicyError('');
          setPolicyStatus('');
          setPolicySubmittedAcceptance(undefined);
        }
      } catch (error) {
        if (current()) setPolicyError(errorMessage(error));
      } finally {
        if (current()) {
          policyControllerRef.current = undefined;
          setPolicyBusy(false);
        }
      }
    };
    if (accepted) void submit();
    else
      Alert.alert('撤销阅读确认', '撤销后，原站可能再次提醒你阅读这条公告。', [
        {
          text: '取消',
          style: 'cancel',
          onPress: () => {
            if (current()) {
              controller.abort();
              policyControllerRef.current = undefined;
            }
          }
        },
        {
          text: '撤销确认',
          style: 'destructive',
          onPress: () => {
            void submit();
          }
        }
      ]);
  });
  const submitReply = useCallback(
    (snapshot?: ComposerSnapshot) => {
      const submittedSnapshot = snapshot && Array.isArray(snapshot.validationIssues) ? snapshot : undefined;
      const submittedContent = submittedSnapshot?.markdown ?? replyContent;
      if (
        !routeFocused ||
        !focusManager.isFocused() ||
        !canAccessSource ||
        replyBusyRef.current ||
        !submittedContent.trim() ||
        submittedSnapshot?.validationIssues.length ||
        detailQuery.data?.reply?.disabledReason
      ) {
        return;
      }
      const contentKey = submittedContent.trim();
      const send = () => {
        const controller = new AbortController();
        const dispatchState: RequestDispatchState = { mayHaveSent: false };
        replyBusyRef.current = true;
        replyControllerRef.current = controller;
        pendingReplyRef.current = { content: contentKey, dispatchState };
        setReplyBusy(true);
        setReplyError('');
        setReplyStatus('');
        void gateway
          .replyToConversation(item, submittedContent, identityKey, controller.signal, dispatchState)
          .then(async (result) => {
            if (controller.signal.aborted || replyControllerRef.current !== controller) return;
            if (!result.confirmed) {
              uncertainRepliesRef.current.add(contentKey);
              setReplyError(result.message || '原站未确认发送成功，请刷新会话后确认。');
              return;
            }
            uncertainRepliesRef.current.delete(contentKey);
            pendingReplyRef.current = undefined;
            setReplyContent('');
            setReplyPendingNodeSeekPolls([]);
            setReplyStatus('');
            setReplyVisible(false);
            runtime.notify('回复已发送');
            await Promise.allSettled([
              queryClient.invalidateQueries({ queryKey: detailQueryKey }),
              queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications(item.source), 'list'] }),
              queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications('all'), 'list'] }),
              refreshSnapshots()
            ]);
          })
          .catch((error) => {
            if (controller.signal.aborted || replyControllerRef.current !== controller) return;
            const rejected =
              isRecord(error) &&
              (error.serverRejected === true ||
                error.reason === 'http-401' ||
                (error.serverRejected !== false &&
                  typeof error.status === 'number' &&
                  [400, 401, 403, 404, 405, 413, 422, 429].includes(error.status)));
            if (dispatchState.mayHaveSent && !rejected) uncertainRepliesRef.current.add(contentKey);
            setReplyError(
              dispatchState.mayHaveSent && !rejected
                ? `发送结果未确认，可能已发送，请先核对会话。${errorMessage(error)}`
                : errorMessage(error)
            );
          })
          .finally(() => {
            if (replyControllerRef.current !== controller) return;
            pendingReplyRef.current = undefined;
            replyControllerRef.current = undefined;
            replyBusyRef.current = false;
            setReplyBusy(false);
          });
      };
      if (!uncertainRepliesRef.current.has(contentKey)) {
        send();
        return;
      }
      if (replyConfirmationRef.current) return;
      const confirmation = new AbortController();
      replyConfirmationRef.current = confirmation;
      const confirmCurrent = () => {
        if (confirmation.signal.aborted || replyConfirmationRef.current !== confirmation) return false;
        replyConfirmationRef.current = undefined;
        confirmation.abort();
        return true;
      };
      Alert.alert('私信可能已发送', '上次发送结果尚未确认，请先核对会话；仍要重发可能造成重复消息。', [
        {
          text: '取消',
          style: 'cancel',
          onPress: () => {
            confirmCurrent();
          }
        },
        {
          text: '核对会话',
          onPress: () => {
            if (!confirmCurrent()) return;
            setReplyVisible(false);
            void detailQuery.refetch();
          }
        },
        {
          text: '仍要重发',
          onPress: () => {
            if (confirmCurrent()) send();
          }
        }
      ]);
    },
    [
      canAccessSource,
      detailQueryKey,
      gateway,
      identityKey,
      item,
      queryClient,
      refreshSnapshots,
      replyContent,
      routeFocused,
      detailQuery,
      runtime
    ]
  );
  const uploadReplyImage = useCallback(async () => {
    if (
      !canAccessSource ||
      replyBusyRef.current ||
      detailQuery.data?.reply?.format !== 'markdown' ||
      detailQuery.data.reply.disabledReason ||
      item.source === 'yaohuo'
    ) {
      return undefined;
    }
    const controller = new AbortController();
    replyBusyRef.current = true;
    replyControllerRef.current?.abort();
    replyControllerRef.current = controller;
    setReplyBusy(true);
    setReplyError('');
    setReplyStatus('');
    try {
      const ticket = await runtime.composer.ensureWritableSession(item.source);
      let nodeImageGeneration: number | undefined;
      const assertCurrent = () => {
        if (
          controller.signal.aborted ||
          ticket.identityKey !== identityKey ||
          !runtime.composer.isWritableSessionTicketCurrent(ticket)
        ) {
          const error = new Error('账号状态已变化');
          error.name = 'AbortError';
          throw error;
        }
        if (nodeImageGeneration !== undefined && nodeImageGeneration !== currentNodeImageApiKeyGeneration()) {
          throw Object.assign(new Error('NodeImage 凭据已变化'), { reason: 'stale' });
        }
      };
      assertCurrent();
      let nodeImageApiKey: string | undefined;
      if (item.source === 'nodeseek') {
        nodeImageApiKey = (await runtime.composer.ensureNodeImageApiKey()) || undefined;
        assertCurrent();
        nodeImageGeneration = currentNodeImageApiKeyGeneration();
        if (!nodeImageApiKey) {
          throw new Error('NodeImage API Key 不可用，请到账号中心重新获取授权或手动粘贴');
        }
      }
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
        multiple: false
      });
      assertCurrent();
      if (picked.canceled || !picked.assets?.[0]) return undefined;
      const file = normalizeReplyImageAsset(picked.assets[0]);
      const result = await gateway.uploadReplyImage(item.source, {
        expectedIdentityKey: identityKey,
        file,
        nodeImageApiKey,
        beforeSend: assertCurrent,
        signal: controller.signal
      });
      assertCurrent();
      setReplyStatus('图片已插入草稿');
      return result.markup;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return undefined;
      setReplyError(
        isNodeImageApiKeyExpiredError(error)
          ? 'NodeImage API Key 不可用，请到账号中心重新获取授权或手动粘贴'
          : errorMessage(error)
      );
      return undefined;
    } finally {
      if (replyControllerRef.current === controller) {
        replyControllerRef.current = undefined;
        replyBusyRef.current = false;
        setReplyBusy(false);
      }
    }
  }, [canAccessSource, detailQuery.data?.reply, gateway, identityKey, item.source, runtime.composer]);
  return (
    <NotificationDetailScreen
      canOpenTopic={Boolean(targetTopic)}
      canRetry={canAccessSource}
      contentWidth={runtime.contentWidth}
      detail={canAccessSource ? displayDetail : undefined}
      error={canAccessSource ? (detailQuery.error ? errorMessage(detailQuery.error) : undefined) : accessError}
      loading={canAccessSource && detailQuery.isPending}
      markMessage={markMessage}
      markBusy={markPhase === 'pending'}
      onRetryMark={
        canAccessSource && routeFocused && markPhase !== 'confirmed'
          ? () => {
              void markRead(true);
            }
          : undefined
      }
      nodeSeekMemberId={
        item.source === 'nodeseek' && runtime.sessions.nodeseek.currentUser?.id
          ? String(runtime.sessions.nodeseek.currentUser.id)
          : undefined
      }
      replyBusy={replyBusy}
      replyContent={replyContent}
      replyPendingNodeSeekPolls={replyPendingNodeSeekPolls}
      discourseEmojiUrls={discourseEmojiUrls}
      replyError={replyError}
      replyStatus={replyStatus}
      replyVisible={replyVisible}
      historyBusy={historyBusy}
      historyError={historyError}
      onLoadEarlierMessages={
        messageHistory?.blocked
          ? undefined
          : () => {
              void loadEarlierMessages();
            }
      }
      onResetMessageHistory={() => {
        void resetMessageHistory();
      }}
      policyBusy={policyBusy}
      policyDisabled={!canAccessSource || !routeFocused || detailQuery.isError || policyAwaitingRead}
      policyError={policyError}
      policyStatus={policyStatus}
      onSetPolicyAcceptance={setPolicyAcceptance}
      onOpenActor={(user) => navigation.navigate('User', { user })}
      actorUser={actorUser}
      actorInHeader={actorInHeader}
      routeActive={routeFocused}
      topicReplyAction={item.kind === 'mention' || item.kind === 'reply'}
      onOpenExternalUrl={openExternalUrl}
      onRetry={() => {
        if (canAccessSource) void detailQuery.refetch();
      }}
      onOpenTopic={(linkedTopic, linkedLocation) => {
        const topic = linkedTopic || targetTopic;
        if (topic) navigation.navigate('Topic', { topic, location: linkedTopic ? linkedLocation : location });
      }}
      onOpenReply={() => {
        setReplyError('');
        setReplyStatus('');
        setReplyVisible(true);
      }}
      onReplyClose={() => setReplyVisible(false)}
      onReplyContentChange={setReplyContent}
      onReplySnapshot={(snapshot) => {
        setReplyContent(snapshot.markdown);
        setReplyPendingNodeSeekPolls(snapshot.pendingNodeSeekPolls);
      }}
      onSubmitReply={submitReply}
      onLoadLinuxDoPollCapabilities={item.source === 'linuxdo' ? loadLinuxDoPollCapabilities : undefined}
      onResolveLinuxDoUpload={item.source === 'linuxdo' ? resolveLinuxDoUpload : undefined}
      onLoadLinuxDoTemplates={item.source === 'linuxdo' ? loadLinuxDoTemplates : undefined}
      onUseLinuxDoTemplate={item.source === 'linuxdo' ? useLinuxDoTemplate : undefined}
      onUploadReplyImage={uploadReplyImage}
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
      initializationError={runtime.initializationError}
      onRetryInitialization={() => run(runtime.retryInitialization)}
      backgroundEnabled={runtime.backgroundEnabled}
      backgroundError={runtime.backgroundError}
      busy={busy || !runtime.ready}
      enabledSources={runtime.enabledNotificationSources}
      permission={runtime.permission}
      sessions={runtime.sessions}
      state={runtime.state}
      onOpenSystemSettings={() => void runtime.openSystemSettings()}
      onToggleGlobal={toggleGlobal}
      onToggleSource={(source, enabled) => run(() => runtime.setSourceEnabled(source, enabled))}
    />
  );
}
