import {
  createDiscoursePolicyOperation,
  policyRequestBusy,
  type PolicyOperationSnapshot
} from '@/domain/forum/discoursePolicyOperation';
import { useNotificationReplyOperation } from './useNotificationReplyOperation';
import { createNotificationRecoveryOwner } from './notificationRecoveryOwner';
import { createNotificationListReads } from './notificationListReads';
import { createNotificationReadReceipt } from './notificationReadReceipt';
import { createNotificationConversationHistory } from './notificationConversationHistory';
import { topicLocationForReply } from '@/domain/forum/topicLocation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { withPickedAttachmentCopies } from '@/platform/media/pickedAttachmentCopies';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect, useIsFocused, useNavigation, type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { focusManager, useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { SourceErrorInfo, Topic, TopicLocationTarget, UserReference } from '@/domain/forum/models';
import { isRecord } from '@/domain/forum/html';
import type { LinuxDoReadRecovery, LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import { isDiscourseSource, sourceCatalog } from '@/domain/forum/sourceCatalog';
import type { ForumNotification } from '@/domain/notifications/models';
import { notificationPageError } from '@/domain/notifications/notificationQuality';

import type {
  ComposerSnapshot,
  ComposerSubmissionSettlement,
  PendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import { parseForumTopicLink } from '@/domain/forum/links';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { errorMessage } from '@/platform/network/errors';
import { RequestCanceledError } from '@/platform/network/request';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { openHttpUrl } from '@/ui/navigation/openHttpUrl';
import { forumQueryKeys } from '@/platform/query/serverState';
import { syncDiscoursePolicyCaches } from '@/platform/query/discoursePolicyCache';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';

import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { retryEmojiCatalog } from '@/sources/discourse/retryEmojiCatalog';
import { MAX_REPLY_IMAGE_UPLOAD_BYTES, normalizeReplyImageAsset } from '@/sources/imageUpload';
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

type NotificationMarkAllRun = {
  phase: 'confirming' | 'submitting';
  controller: AbortController;
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
  const [selectedCategoryId, setCategoryId] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const markAllRef = useRef<{ phase: 'idle' } | NotificationMarkAllRun>({ phase: 'idle' });
  const [listReads] = useState(createNotificationListReads);
  const [refreshing, setRefreshing] = useState(listReads.refreshing);
  const publishRefresh = useCallback(() => setRefreshing(listReads.refreshing), [listReads]);
  const [listRecoveries] = useState(createNotificationRecoveryOwner);
  const latestRuntimeRef = useCommittedRef(runtime);
  const confirmedSourceRetries = useRef(new Map<NotificationSource, { key: readonly unknown[]; epoch: number }>());
  const cancelMarkAll = useCallback(() => {
    const current = markAllRef.current;
    if (current.phase !== 'idle') current.controller.abort();
    markAllRef.current = { phase: 'idle' };
    setMarkAllBusy(false);
  }, []);
  useEffect(() => {
    const requested = route.params?.source;
    if (!requested) return;
    setSource(runtime.enabledNotificationSources.includes(requested) ? requested : 'all');
    setCategoryId('');
    const frame = requestAnimationFrame(() => navigation.setParams({ source: undefined }));
    return () => cancelAnimationFrame(frame);
  }, [enabledSourcesKey, navigation, route.params?.source, runtime.enabledNotificationSources]);
  useEffect(() => {
    if (source === 'all' || runtime.enabledNotificationSources.includes(source)) return;
    cancelMarkAll();
    listReads.cancelRetry();
    void queryClient.cancelQueries({ queryKey: forumQueryKeys.notifications(source) });
    setCategoryId('');
    setSource('all');
  }, [cancelMarkAll, enabledSourcesKey, queryClient, runtime.enabledNotificationSources, source, listReads]);
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
  const categoriesQueryKey = useMemo(
    () => forumQueryKeys.notificationCategories({ source, identityKey }),
    [source, identityKey]
  );
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
        if (!signal.aborted)
          runtime.reportReadError(source, sourceErrorFromUnknown(source, error), runtime.sessionEpochs[source]);
        throw error;
      }
    }
  });
  const categories = useMemo(
    () => (source === 'all' ? [] : categoriesQuery.data || []),
    [categoriesQuery.data, source]
  );
  const categoryId =
    source === 'all'
      ? ''
      : categories.find((category) => category.id === selectedCategoryId)?.id || categories[0]?.id || '';
  useEffect(
    () => () => {
      cancelMarkAll();
      listReads.cancelRetry();
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
      sourceAvailable,
      listReads
    ]
  );
  useEffect(
    () => () => {
      listReads.invalidateRefresh();
      publishRefresh();
    },
    [identityKey, source, categoryId, unreadOnly, isFocused, runtime.ready, sourceAvailable, listReads, publishRefresh]
  );
  useEffect(
    () => () => {
      listRecoveries.cancel();
    },
    [source, categoryId, unreadOnly, isFocused, listRecoveries]
  );
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (!focused) {
          confirmedSourceRetries.current.clear();
          if (listRecoveries.pending) listRecoveries.cancel();
        }
      }),
    [listRecoveries]
  );
  const listQueryKey = useMemo(
    () =>
      forumQueryKeys.notificationList({
        source,
        categoryId: source === 'all' ? null : categoryId,
        identityKey,
        unreadOnly
      }),
    [categoryId, identityKey, source, unreadOnly]
  );
  const activeList = useMemo(
    () => (isFocused && runtime.ready ? { queryKey: listQueryKey, sourceAvailable } : null),
    [isFocused, listQueryKey, runtime.ready, sourceAvailable]
  );
  const activeListRef = useCommittedRef(activeList);
  const currentList = useCallback(
    () => (activeListRef.current === activeList ? activeList : null),
    [activeList, activeListRef]
  );
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
        if (signal.aborted) throw new RequestCanceledError();
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
        if (signal.aborted) throw new RequestCanceledError();
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
        if (signal.aborted) throw error;
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
  useEffect(() => {
    if (isFocused) return;
    void queryClient.cancelQueries({ queryKey: listQueryKey, exact: true, type: 'inactive' });
    if (source !== 'all')
      void queryClient.cancelQueries({ queryKey: categoriesQueryKey, exact: true, type: 'inactive' });
  }, [categoriesQueryKey, isFocused, listQueryKey, queryClient, source]);
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
  const loadMore = useCallback(() => {
    const visit = currentList();
    if (!visit?.sourceAvailable || !hasNextPage || listReads.refreshing) return;
    const current = queryClient.getQueryState(visit.queryKey);
    if (!current?.data || current.data !== listQuery.data) return;
    const fetchingNextPage = current?.fetchStatus !== 'idle' && current?.fetchMeta?.fetchMore?.direction === 'forward';
    if (!fetchingNextPage) void fetchNextPage();
  }, [currentList, fetchNextPage, hasNextPage, listQuery.data, listReads, queryClient]);
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
  const refresh = useCallback(() => {
    if (!currentList()?.sourceAvailable || listReads.refreshing) return;
    const request = listReads.beginRefresh();
    if (!request) return;
    publishRefresh();
    void Promise.allSettled([refetch(), refreshSnapshots()]).finally(() => {
      listReads.finishRefresh(request);
      publishRefresh();
    });
  }, [currentList, listReads, publishRefresh, refetch, refreshSnapshots]);
  const retryReadSource = useCallback(
    async (candidate: NotificationSource): Promise<LinuxDoReadResumeOutcome> => {
      const runtime = latestRuntimeRef.current;
      const expectedIdentityKey = runtime.identityKeys[candidate];
      const epoch = runtime.sessionEpochs[candidate];
      if (!expectedIdentityKey || !runtime.activeSources.includes(candidate)) return 'stale';
      const controller = listReads.beginRetry(candidate);
      const current = () =>
        listReads.ownsRetry(candidate, controller) &&
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
        listReads.finishRetry(candidate, controller);
      }
    },
    [
      categoriesQuery.error,
      categoriesQueryKey,
      categoryId,
      latestRuntimeRef,
      listQueryKey,
      queryClient,
      source,
      unreadOnly,
      listReads
    ]
  );
  useEffect(() => {
    for (const [candidate, admission] of confirmedSourceRetries.current) {
      if (
        !isFocused ||
        !focusManager.isFocused() ||
        admission.key !== listQueryKey ||
        runtime.sessionEpochs[candidate] !== admission.epoch ||
        !runtime.enabledNotificationSources.includes(candidate)
      ) {
        confirmedSourceRetries.current.delete(candidate);
      } else if (runtime.activeSources.includes(candidate) && !listQuery.isFetching) {
        confirmedSourceRetries.current.delete(candidate);
        void retryReadSource(candidate);
      }
    }
  }, [isFocused, listQuery.isFetching, listQueryKey, retryReadSource, runtime]);
  const retrySource = useCallback(
    (candidate: NotificationSource) => {
      if (
        !currentList() ||
        !focusManager.isFocused() ||
        !runtime.enabledNotificationSources.includes(candidate) ||
        listRecoveries.pending
      )
        return;
      const intent = listRecoveries.begin();
      if (!intent) return;
      const epoch = runtime.sessionEpochs[candidate];
      const surfaceCurrent = () =>
        listRecoveries.current(intent) &&
        focusManager.isFocused() &&
        latestRuntimeRef.current.enabledNotificationSources.includes(candidate);
      const current = () => surfaceCurrent() && latestRuntimeRef.current.sessionEpochs[candidate] === epoch;
      const recovery: LinuxDoReadRecovery = {
        queryKey: source !== 'all' && categoriesQuery.error ? categoriesQueryKey : listQueryKey,
        resume: () => (current() ? retryReadSource(candidate) : Promise.resolve('stale'))
      };
      return (async () => {
        let info = errors[candidate];
        if (notificationErrorAction(info) === '重试') {
          const result = await runtime.reconcileAccountStatus(candidate);
          if (result.status === 'anonymous' && surfaceCurrent()) {
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
          else if (source === 'all' && !runtime.activeSources.includes(candidate)) {
            // When the first source becomes readable the aggregate Query starts itself.
            if (
              !runtime.activeSources.length ||
              latestRuntimeRef.current.identitySignature !== runtime.identitySignature
            )
              return;
            if (
              !latestRuntimeRef.current.activeSources.includes(candidate) ||
              queryClient.isFetching({ queryKey: listQueryKey, exact: true })
            ) {
              confirmedSourceRetries.current.set(candidate, { key: listQueryKey, epoch });
              return;
            }
          }
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
          listRecoveries.settled(intent);
        });
    },
    [
      categoriesQuery.error,
      categoriesQueryKey,
      currentList,
      errors,
      latestRuntimeRef,
      listQueryKey,
      queryClient,
      retryReadSource,
      runtime,
      source,
      listRecoveries
    ]
  );
  const markAll = useCallback(() => {
    if (
      markAllRef.current.phase !== 'idle' ||
      !currentList()?.sourceAvailable ||
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
    const run: NotificationMarkAllRun = { phase: 'confirming', controller };
    markAllRef.current = run;
    Alert.alert('全部标记为已读', `将 ${sourceCatalog[source].label} 现有消息全部标记为已读？`, [
      {
        text: '取消',
        style: 'cancel',
        onPress: () => {
          if (markAllRef.current === run) cancelMarkAll();
        }
      },
      {
        text: '确认',
        onPress: () => {
          if (
            !currentList()?.sourceAvailable ||
            run.phase === 'submitting' ||
            markAllRef.current !== run ||
            controller.signal.aborted
          )
            return;
          run.phase = 'submitting';
          setMarkAllBusy(true);
          void runtime.gateway
            .markAllRead(source, expectedIdentityKey, controller.signal)
            .then((result) => {
              if (markAllRef.current !== run || controller.signal.aborted) return;
              runtime.notify(result.confirmed ? '已按原站状态标记全部已读' : result.message || '原站未确认已读');
            })
            .finally(async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications(source), 'list'] }),
                queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications('all'), 'list'] }),
                runtime.refreshSnapshots({
                  source,
                  identityKey: expectedIdentityKey,
                  sessionEpoch: selectedSourceEpoch
                })
              ]);
            })
            .catch((error) => {
              if (markAllRef.current === run && !controller.signal.aborted) {
                runtime.notify(errorMessage(error));
              }
            })
            .finally(() => {
              if (markAllRef.current !== run) return;
              markAllRef.current = { phase: 'idle' };
              setMarkAllBusy(false);
            });
        }
      }
    ]);
  }, [cancelMarkAll, categories, categoryId, currentList, queryClient, runtime, selectedSourceEpoch, source]);
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
      active={isFocused}
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
      sessions={runtime.sessions}
      source={source}
      unreadOnly={unreadOnly}
      onChangeCategory={setCategoryId}
      onChangeSource={changeSource}
      onChangeUnreadOnly={setUnreadOnly}
      onItemPress={(notification) => {
        if (
          !navigation.isFocused() ||
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
    return <ContentSourceDisabledState source={source} navigation={navigation} />;
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
  const [readReceipt] = useState(createNotificationReadReceipt);
  const [markPhase, setMarkPhase] = useState(readReceipt.phase);
  const publishMark = useCallback(() => setMarkPhase(readReceipt.phase), [readReceipt]);

  const composerControllersRef = useRef(new Set<AbortController>());
  const routeFocused = useIsFocused();
  const appFocused = useSyncExternalStore(focusManager.subscribe, () => focusManager.isFocused());
  const replySessionEpoch = runtime.sessionEpochs[item.source];
  const nodeSeekConversation = item.source === 'nodeseek' && item.target.type === 'private-conversation';
  const [markMessage, setMarkMessage] = useState('');

  const [replyContent, setReplyContent] = useState('');
  const replyDraftRevisionRef = useRef(0);
  const changeReplyContent = useCallback((content: string) => {
    replyDraftRevisionRef.current += 1;
    setReplyContent(content);
  }, []);
  const [replyPendingNodeSeekPolls, setReplyPendingNodeSeekPolls] = useState<PendingNodeSeekPoll[]>([]);
  const [replyError, setReplyError] = useState('');
  const [replyStatus, setReplyStatus] = useState('');
  const [replyVisible, setReplyVisible] = useState(false);
  const replyScopeRef = useCommittedRef({ canAccessSource, identityKey, itemId: item.id, replySessionEpoch });
  const {
    busy: replyBusy,
    hasOperation: hasReplyOperation,
    isSending: isReplySending,
    owns: ownsReply,
    beginSend: beginReplySend,
    beginUpload: beginReplyUpload,
    confirmed: confirmReply,
    finish: finishReply,
    markUncertain: markReplyUncertain,
    isUncertain: isReplyUncertain,
    forgetUncertain: forgetUncertainReplies,
    beginConfirmation: beginReplyConfirmation,
    consumeConfirmation: consumeReplyConfirmation,
    cancelConfirmation: cancelReplyConfirmation,
    cancel: cancelReply
  } = useNotificationReplyOperation(() => replyScopeRef.current);

  const [policyError, setPolicyError] = useState('');
  const [policyStatus, setPolicyStatus] = useState('');

  const [historyFlow] = useState(createNotificationConversationHistory);
  const [historyView, setHistoryView] = useState(historyFlow.snapshot);
  const { history: messageHistory, busy: historyBusy, error: historyError } = historyView;
  const publishHistory = useCallback(() => setHistoryView(historyFlow.snapshot), [historyFlow]);
  const historyScopeRef = useCommittedRef({ canAccessSource, routeFocused, sessionEpoch: replySessionEpoch });
  useLayoutEffect(() => {
    historyFlow.observedCommit(messageHistory);
    publishHistory();
  }, [historyFlow, messageHistory, publishHistory]);
  const cancelHistory = useCallback(() => {
    historyFlow.cancel();
    publishHistory();
  }, [historyFlow, publishHistory]);
  useEffect(() => {
    historyFlow.resetScope();
    publishHistory();
    return cancelHistory;
  }, [cancelHistory, historyFlow, publishHistory, replySessionEpoch]);
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

  useEffect(
    () => cancelReplyConfirmation,
    [cancelReplyConfirmation, replyContent, routeFocused, canAccessSource, identityKey, replySessionEpoch]
  );
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (focused) return;
        cancelReplyConfirmation();
        if (isReplySending()) {
          cancelReply();
        }
      }),
    [cancelReply, cancelReplyConfirmation, isReplySending]
  );
  const detailQueryKey = forumQueryKeys.notificationDetail({
    source: item.source,
    identityKey,
    notificationId: item.id,
    sessionEpoch: replySessionEpoch
  });
  const detailReadTraceRef = useRef<DiagnosticTrace | undefined>(undefined);
  const detailQuery = useQuery({
    queryKey: detailQueryKey,
    subscribed: routeFocused,
    enabled: canAccessSource && routeFocused,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval:
      nodeSeekConversation && routeFocused && canAccessSource && !runtime.getReadBlock(item.source) ? 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: ({ signal }) =>
      detailReadTraceRef.current
        ? runtime.gateway.loadDetail(item, identityKey, signal, detailReadTraceRef.current)
        : runtime.gateway.loadDetail(item, identityKey, signal)
  });
  const [detailRecoveries] = useState(createNotificationRecoveryOwner);
  const detailRecoveryScopeRef = useCommittedRef({ runtime, routeFocused });
  useEffect(
    () => () => {
      detailRecoveries.cancel();
    },
    [routeFocused, detailRecoveries]
  );
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (focused) return;
        detailRecoveries.cancel();
      }),
    [detailRecoveries]
  );
  useEffect(() => {
    if (!currentIdentityKey || currentIdentityKey === identityKey) return;
    detailRecoveries.cancel();
  }, [currentIdentityKey, identityKey, detailRecoveries]);
  const needsLogin = !currentIdentityKey && !runtime.sessions[item.source].isLoggedIn;
  const detailReadError = detailQuery.error ? sourceErrorFromUnknown(item.source, detailQuery.error) : undefined;
  const retryDetail = useLatestCallback(async () => {
    const trace = beginDiagnosticTrace('source', 'notification-detail-retry', {
      source: item.source,
      state: 'retry',
      generation: replySessionEpoch,
      hasReadError: Boolean(detailReadError)
    });
    if (!routeFocused || !focusManager.isFocused() || detailRecoveries.pending) {
      finishDiagnosticTrace(trace, 'blocked', {
        source: item.source,
        reason: detailRecoveries.pending ? 'busy' : 'not_ready'
      });
      return;
    }
    const intent = detailRecoveries.begin();
    if (!intent) return;
    const surfaceCurrent = () => {
      const latest = detailRecoveryScopeRef.current;
      return (
        detailRecoveries.current(intent) &&
        latest.routeFocused &&
        focusManager.isFocused() &&
        latest.runtime.enabledNotificationSources.includes(item.source) &&
        (!latest.runtime.identityKeys[item.source] || latest.runtime.identityKeys[item.source] === identityKey)
      );
    };
    const current = () =>
      surfaceCurrent() && detailRecoveryScopeRef.current.runtime.sessionEpochs[item.source] === replySessionEpoch;
    const recovery: LinuxDoReadRecovery = {
      queryKey: detailQueryKey,
      resume: async () => {
        const resumeTrace = beginDiagnosticTrace('source', 'notification-detail-resume', {
          source: item.source,
          parentTraceId: trace.traceId,
          state: 'resuming',
          generation: replySessionEpoch
        });
        try {
          if (!current() || detailRecoveryScopeRef.current.runtime.identityKeys[item.source] !== identityKey) {
            finishDiagnosticTrace(resumeTrace, 'stale', { source: item.source, reason: 'stale' });
            return 'stale';
          }
          runtime.clearReadBlock(item.source, replySessionEpoch);
          detailReadTraceRef.current ??= resumeTrace;
          const result = await detailQuery.refetch({ cancelRefetch: false });
          if (!current()) {
            finishDiagnosticTrace(resumeTrace, intent.controller.signal.aborted ? 'canceled' : 'stale', {
              source: item.source,
              reason: intent.controller.signal.aborted ? 'canceled' : 'stale'
            });
            return 'stale';
          }
          if (result.error) {
            const info = sourceErrorFromUnknown(item.source, result.error);
            runtime.reportReadError(item.source, info, replySessionEpoch);
            finishDiagnosticTrace(resumeTrace, info.kind === 'verification-required' ? 'blocked' : 'failure', {
              source: item.source,
              kind: info.kind,
              reason: normalizeDiagnosticReason(result.error)
            });
            return info.kind === 'verification-required' ? 'verification-required' : 'failed';
          }
          finishDiagnosticTrace(resumeTrace, 'success', { source: item.source, state: 'loaded' });
          return 'completed';
        } catch (error) {
          const reason = normalizeDiagnosticReason(error);
          finishDiagnosticTrace(resumeTrace, reason === 'canceled' ? 'canceled' : 'failure', {
            source: item.source,
            reason
          });
          throw error;
        } finally {
          if (detailReadTraceRef.current === resumeTrace) detailReadTraceRef.current = undefined;
        }
      }
    };
    try {
      if (needsLogin) {
        markDiagnosticStage(trace, 'guard', { source: item.source, state: 'open', reason: 'login_required' });
        await runtime.openAccountSurface(item.source, '登录已失效，请重新登录。');
        finishDiagnosticTrace(trace, 'blocked', { source: item.source, state: 'open', reason: 'login_required' });
        return;
      }
      if (!canAccessSource) return;
      let info = detailReadError;
      if (notificationErrorAction(info) === '重试') {
        markDiagnosticStage(trace, 'credential', { source: item.source, state: 'session-check' });
        const result = await runtime.reconcileAccountStatus(item.source);
        markDiagnosticStage(trace, 'credential', {
          source: item.source,
          isAccountConfirmed: result.status === 'same',
          isAnonymous: result.status === 'anonymous'
        });
        if (result.status === 'anonymous' && surfaceCurrent()) {
          await runtime.openAccountSurface(item.source, '登录已失效，请重新登录。');
          finishDiagnosticTrace(trace, 'blocked', { source: item.source, state: 'open', reason: 'login_required' });
          return;
        }
        if (!current()) return;
        if (result.status === 'unknown') {
          if (result.errorInfo.kind !== 'verification-required') {
            runtime.notify(`账号状态暂不可确认：${result.error}`);
            finishDiagnosticTrace(trace, 'blocked', { source: item.source, reason: 'identity_unavailable' });
            return;
          }
          info = result.errorInfo;
        } else if (result.status !== 'same') return;
      }
      if (!current()) return;
      if (info && notificationErrorAction(info) !== '重试') {
        const reason = info.kind === 'verification-required' ? 'verification_required' : 'login_required';
        markDiagnosticStage(trace, 'guard', { source: item.source, state: 'open', reason });
        await runtime.openAccountSurface(
          item.source,
          info.message,
          info.kind === 'verification-required' ? recovery : undefined
        );
        finishDiagnosticTrace(trace, 'blocked', { source: item.source, state: 'open', reason });
      } else {
        const outcome = await recovery.resume();
        finishDiagnosticTrace(trace, outcome === 'completed' ? 'success' : outcome === 'stale' ? 'stale' : 'failure', {
          source: item.source,
          ...(outcome === 'completed' ? {} : { reason: outcome === 'stale' ? 'stale' : 'refresh_failed' })
        });
      }
    } catch (error) {
      const reason = normalizeDiagnosticReason(error);
      finishDiagnosticTrace(trace, intent.controller.signal.aborted || reason === 'canceled' ? 'canceled' : 'failure', {
        source: item.source,
        reason: intent.controller.signal.aborted ? 'canceled' : reason
      });
      if (current()) runtime.notify(errorMessage(error));
    } finally {
      finishDiagnosticTrace(trace, intent.controller.signal.aborted ? 'canceled' : current() ? 'blocked' : 'stale', {
        source: item.source,
        reason: intent.controller.signal.aborted ? 'canceled' : current() ? 'not_ready' : 'stale'
      });
      detailRecoveries.settled(intent);
    }
  });
  const policy = detailQuery.data?.policy;
  const policyScope = JSON.stringify([identityKey, item.id, policy?.postId, policy?.version, replySessionEpoch]);
  const policyScopeRef = useCommittedRef(policyScope);
  const [policyState, setPolicyState] = useState<PolicyOperationSnapshot>({ request: null, submissions: {} });
  const [policies] = useState(() =>
    createDiscoursePolicyOperation({
      isCurrentScope: (scope) => policyScopeRef.current === scope,
      publish: setPolicyState
    })
  );
  const policyBusy = policyRequestBusy(policyState.request);
  const policyMarker = policy ? policyState.submissions[policy.postId] : undefined;
  const policySubmittedAcceptance =
    policyMarker?.scope === policyScope && policyMarker.version === policy?.version ? policyMarker.accepted : undefined;
  useEffect(() => {
    const messages = detailQuery.data?.messages;
    const pagination = detailQuery.data?.messageHistory;
    if (
      !canAccessSource ||
      !messages ||
      !pagination ||
      !detailQuery.isSuccess ||
      detailQuery.isFetching ||
      !routeFocused
    )
      return;
    historyFlow.latest(replySessionEpoch, messages, pagination.olderCursor);
    publishHistory();
  }, [
    canAccessSource,
    cancelHistory,
    detailQuery.data,
    detailQuery.dataUpdatedAt,
    detailQuery.isFetching,
    detailQuery.isSuccess,
    historyFlow,
    replySessionEpoch,
    routeFocused,
    publishHistory
  ]);
  const historyRequestCurrent = useCallback(
    (controller: AbortController, sessionEpoch: number) =>
      historyFlow.owns(controller) &&
      !controller.signal.aborted &&
      historyScopeRef.current.canAccessSource &&
      historyScopeRef.current.routeFocused &&
      historyScopeRef.current.sessionEpoch === sessionEpoch &&
      focusManager.isFocused(),
    [historyScopeRef, historyFlow]
  );
  const loadEarlierMessages = useLatestCallback(async () => {
    const history = historyFlow.committed;
    if (
      !history?.olderCursor ||
      history.blocked ||
      history.sessionEpoch !== replySessionEpoch ||
      !canAccessSource ||
      !routeFocused ||
      !focusManager.isFocused()
    )
      return;
    const request = historyFlow.beginEarlier(history.sessionEpoch);
    if (!request) return;
    const controller = request.controller;
    publishHistory();
    try {
      const page = await gateway.loadEarlierMessages(item, request.cursor, identityKey, controller.signal);
      if (!historyRequestCurrent(controller, history.sessionEpoch)) return;
      historyFlow.receivedEarlier(controller, page);
      publishHistory();
    } catch (error) {
      if (historyRequestCurrent(controller, history.sessionEpoch)) {
        historyFlow.failed(controller, '更早消息读取失败：' + errorMessage(error));
        publishHistory();
      }
    } finally {
      historyFlow.finished(controller);
      publishHistory();
    }
  });
  const resetMessageHistory = useLatestCallback(async () => {
    if (!canAccessSource || !routeFocused || !focusManager.isFocused()) return;
    const request = historyFlow.beginReset();
    if (!request) return;
    const controller = request.controller;
    publishHistory();
    try {
      const result = await detailQuery.refetch();
      if (!historyRequestCurrent(controller, replySessionEpoch)) return;
      if (result.error) throw result.error;
      if (result.data?.messages && result.data.messageHistory) {
        historyFlow.receivedReset(
          controller,
          replySessionEpoch,
          result.data.messages,
          result.data.messageHistory.olderCursor
        );
        publishHistory();
      }
    } catch (error) {
      if (historyRequestCurrent(controller, replySessionEpoch)) {
        historyFlow.failed(controller, '重新读取会话失败：' + errorMessage(error));
        publishHistory();
      }
    } finally {
      historyFlow.finished(controller);
      publishHistory();
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
      !routeFocused
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
    replySessionEpoch,
    routeFocused
  ]);
  const actorUser = useMemo(
    () =>
      canAccessSource && detailQuery.data
        ? notificationActorUser(detailQuery.data.notification) || undefined
        : undefined,
    [canAccessSource, detailQuery.data]
  );
  const actorInHeader = Boolean(detailQuery.data?.messages && actorUser && item.source !== 'linuxdo');
  const openActor = useLatestCallback((user: UserReference) => {
    if (navigation.isFocused()) navigation.navigate('User', { user });
  });
  const policyAwaitingRead = policySubmittedAcceptance !== undefined && policy?.accepted !== policySubmittedAcceptance;
  useEffect(() => {
    policies.reset();
    setPolicyError('');
    setPolicyStatus('');
    return policies.cancel;
  }, [identityKey, item.id, policy?.postId, policy?.version, replySessionEpoch, policies]);
  useEffect(() => {
    if (routeFocused && canAccessSource) return;
    policies.cancel();
  }, [canAccessSource, routeFocused, policies]);
  useEffect(() => {
    if (policySubmittedAcceptance !== undefined && policy?.accepted === policySubmittedAcceptance) {
      policies.observe(policyScope, [policy]);
      setPolicyStatus('');
    }
  }, [policy?.accepted, policySubmittedAcceptance, policies, policyScope, policy]);
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (!focused) policies.cancel();
      }),
    [policies]
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
          ? () => <NotificationContactTitle user={actorUser} onPress={() => openActor(actorUser)} />
          : undefined
    });
  }, [
    actorInHeader,
    actorUser,
    canAccessSource,
    detailQuery.data?.messages,
    detailQuery.data?.title,
    navigation,
    openActor
  ]);
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
  }, [cancelReply, routeFocused]);
  useEffect(() => {
    if (canAccessSource) return;
    cancelReply();
    composerControllersRef.current.forEach((controller) => controller.abort());
    composerControllersRef.current.clear();
    if (currentIdentityKey !== identityKey) {
      forgetUncertainReplies();
      setReplyContent('');
      setReplyPendingNodeSeekPolls([]);
    }
    setReplyError('');
    setReplyStatus('');
    setReplyVisible(false);
  }, [cancelReply, canAccessSource, currentIdentityKey, identityKey, forgetUncertainReplies]);
  useEffect(() => {
    readReceipt.beginVisit();
    publishMark();
    const cancelMark = () => readReceipt.cancel();
    const unsubscribe = focusManager.subscribe((focused) => {
      if (!focused) {
        cancelMark();
        publishMark();
      }
    });
    return () => {
      unsubscribe();
      cancelMark();
    };
  }, [canAccessSource, publishMark, readReceipt, routeFocused]);
  const markRead = useLatestCallback(async (refreshDetail: boolean) => {
    if (
      !routeFocused ||
      !focusManager.isFocused() ||
      !canAccessSource ||
      readReceipt.phase === 'pending' ||
      (!nodeSeekConversation && (!item.unread || readReceipt.phase === 'confirmed'))
    )
      return;
    const attempt = readReceipt.begin();
    if (!attempt) return;
    const controller = attempt.controller;
    publishMark();
    const current = () => readReceipt.owns(attempt) && focusManager.isFocused();
    let attemptedWrite = false;
    try {
      const refreshed = refreshDetail ? await detailQuery.refetch() : undefined;
      if (!current()) return;
      if (refreshed?.error) throw refreshed.error;
      const detail = refreshed ? refreshed.data : detailQuery.data;
      if (!detail) throw new Error('消息详情暂不可用');
      const unreadMessageIds = readReceipt.select(attempt, detail.unreadMessageIds, refreshDetail);
      if (nodeSeekConversation && !unreadMessageIds.length) {
        const phase = readReceipt.noMessages(attempt, detail.unreadMessageIds);
        publishMark();
        if (phase === 'confirmed') setMarkMessage('');
        return;
      }
      readReceipt.willSend(attempt);
      attemptedWrite = true;
      const result = await gateway.markRead(
        item,
        nodeSeekConversation ? { ...detail, unreadMessageIds } : detail,
        identityKey,
        controller.signal
      );
      if (current()) {
        const remainingUnread = readReceipt.completed(
          attempt,
          result.confirmed,
          nodeSeekConversation ? detail.unreadMessageIds : undefined
        );
        publishMark();
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
        readReceipt.failed(attempt);
        publishMark();
        setMarkMessage(`已读状态未更新：${errorMessage(error)}`);
      }
    } finally {
      // A canceled response cannot undo a server write. Reconciliation failure
      // must not turn a confirmed write back into a retryable attempt.
      if (attemptedWrite) {
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications(item.source), 'list'] }),
          queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications('all'), 'list'] }),
          refreshSnapshots({ source: item.source, identityKey, sessionEpoch: replySessionEpoch })
        ]);
      }
    }
  });
  useEffect(() => {
    if (
      routeFocused &&
      canAccessSource &&
      detailQuery.data &&
      !detailQuery.isFetching &&
      !detailQuery.isError &&
      (!readReceipt.attemptedThisVisit ||
        (nodeSeekConversation && readReceipt.hasNewMessages(detailQuery.data.unreadMessageIds)))
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
    routeFocused,
    readReceipt
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
      if (navigation.isFocused()) return openHttpUrl(url, notify, WebBrowser.openBrowserAsync);
    },
    [navigation, notify]
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
      policies.hasRequest() ||
      (accepted ? !policy.canAccept : !policy.canRevoke)
    )
      return;
    const run = policies.claim({ scope: policyScope, policy, accepted, busyDuringConfirmation: false });
    if (!run) return;
    const controller = run.controller;
    const current = () => policies.owns(run);
    const submit = async () => {
      if (!policies.beginSend(run)) return;
      setPolicyError('');
      setPolicyStatus('');
      try {
        const result = await gateway.setPolicyAcceptance(item, policy, accepted, identityKey, controller.signal);
        if (!current()) return;
        if (result.confirmed) {
          policies.confirmed(run);
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
          policies.observe(policyScope, [refreshed.data.policy]);
        }
      } catch (error) {
        if (current()) setPolicyError(errorMessage(error));
      } finally {
        policies.finish(run);
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
              policies.cancelRun(run);
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
    (snapshot?: ComposerSnapshot, settleSubmission?: ComposerSubmissionSettlement) => {
      const submittedSnapshot = snapshot && Array.isArray(snapshot.validationIssues) ? snapshot : undefined;
      const submittedContent = submittedSnapshot?.markdown ?? replyContent;
      const submittedDraftRevision = replyDraftRevisionRef.current;
      if (
        !routeFocused ||
        !focusManager.isFocused() ||
        !canAccessSource ||
        hasReplyOperation() ||
        !submittedContent.trim() ||
        submittedSnapshot?.validationIssues.length ||
        detailQuery.data?.reply?.disabledReason
      ) {
        return;
      }
      const contentKey = submittedContent.trim();
      const send = () => {
        const run = beginReplySend(contentKey, { identityKey, itemId: item.id, replySessionEpoch });
        if (!run) return Promise.resolve();
        const { controller, dispatchState } = run;
        setReplyError('');
        setReplyStatus('');
        return gateway
          .replyToConversation(item, submittedContent, identityKey, controller.signal, dispatchState)
          .then(async (result) => {
            if (!ownsReply(controller)) return;
            if (!result.confirmed) {
              markReplyUncertain(contentKey);
              setReplyError(result.message || '原站未确认发送成功，请刷新会话后确认。');
              return;
            }
            confirmReply(controller, contentKey);
            const isCurrent = () =>
              !controller.signal.aborted &&
              ownsReply(controller) &&
              replyScopeRef.current.canAccessSource &&
              replyScopeRef.current.identityKey === identityKey &&
              replyScopeRef.current.itemId === item.id &&
              replyScopeRef.current.replySessionEpoch === replySessionEpoch;
            const complete = () => {
              if (!isCurrent() || (!settleSubmission && replyDraftRevisionRef.current !== submittedDraftRevision))
                return false;
              replyDraftRevisionRef.current += 1;
              setReplyContent('');
              setReplyPendingNodeSeekPolls([]);
              setReplyStatus('');
              setReplyVisible(false);
              return true;
            };
            if (!isCurrent()) return;
            if (settleSubmission) await settleSubmission(complete);
            else complete();
            if (!isCurrent()) return;
            runtime.notify('回复已发送');
            await Promise.allSettled([
              queryClient.invalidateQueries({ queryKey: detailQueryKey }),
              queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications(item.source), 'list'] }),
              queryClient.invalidateQueries({ queryKey: [...forumQueryKeys.notifications('all'), 'list'] }),
              refreshSnapshots({ source: item.source, identityKey, sessionEpoch: replySessionEpoch })
            ]);
          })
          .catch((error) => {
            if (!ownsReply(controller)) return;
            const rejected =
              isRecord(error) &&
              (error.serverRejected === true ||
                error.reason === 'http-401' ||
                (error.serverRejected !== false &&
                  typeof error.status === 'number' &&
                  [400, 401, 403, 404, 405, 413, 422, 429].includes(error.status)));
            if (dispatchState.mayHaveSent && !rejected) markReplyUncertain(contentKey);
            setReplyError(
              dispatchState.mayHaveSent && !rejected
                ? `发送结果未确认，可能已发送，请先核对会话。${errorMessage(error)}`
                : errorMessage(error)
            );
          })
          .finally(() => {
            finishReply(controller);
          });
      };
      if (!isReplyUncertain(contentKey)) {
        return send();
      }
      const confirmation = beginReplyConfirmation();
      if (!confirmation) return;
      const confirmCurrent = () => consumeReplyConfirmation(confirmation);
      const dismissConfirmation = () => {
        if (confirmCurrent()) confirmation.complete();
      };
      Alert.alert(
        '私信可能已发送',
        '上次发送结果尚未确认，请先核对会话；仍要重发可能造成重复消息。',
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: dismissConfirmation
          },
          {
            text: '核对会话',
            onPress: () => {
              if (!confirmCurrent()) return;
              setReplyVisible(false);
              void detailQuery.refetch();
              confirmation.complete();
            }
          },
          {
            text: '仍要重发',
            onPress: () => {
              if (confirmCurrent()) void send().then(confirmation.complete, confirmation.fail);
            }
          }
        ],
        { onDismiss: dismissConfirmation }
      );
      return confirmation.completed;
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
      replyScopeRef,
      replySessionEpoch,
      routeFocused,
      detailQuery,
      runtime,
      hasReplyOperation,
      ownsReply,
      beginReplySend,
      confirmReply,
      finishReply,
      markReplyUncertain,
      isReplyUncertain,
      beginReplyConfirmation,
      consumeReplyConfirmation
    ]
  );
  const uploadReplyImage = useCallback(async () => {
    if (
      !canAccessSource ||
      hasReplyOperation() ||
      detailQuery.data?.reply?.format !== 'markdown' ||
      detailQuery.data.reply.disabledReason ||
      item.source === 'yaohuo'
    ) {
      return undefined;
    }
    const run = beginReplyUpload({ identityKey, itemId: item.id, replySessionEpoch });
    if (!run) return undefined;
    const { controller } = run;
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
      return await withPickedAttachmentCopies(
        { type: 'image/*', maxFiles: 1, maxBytes: MAX_REPLY_IMAGE_UPLOAD_BYTES },
        async (picked) => {
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
        }
      );
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return undefined;
      setReplyError(
        isNodeImageApiKeyExpiredError(error)
          ? 'NodeImage API Key 不可用，请到账号中心重新获取授权或手动粘贴'
          : errorMessage(error)
      );
      return undefined;
    } finally {
      finishReply(controller);
    }
  }, [
    canAccessSource,
    detailQuery.data?.reply,
    gateway,
    identityKey,
    item.source,
    runtime.composer,
    hasReplyOperation,
    beginReplyUpload,
    finishReply,
    item.id,
    replySessionEpoch
  ]);
  const openTopic = useLatestCallback((linkedTopic?: Topic, linkedLocation?: TopicLocationTarget) => {
    if (!navigation.isFocused()) return;
    const topic = linkedTopic || targetTopic;
    if (topic) navigation.navigate('Topic', { topic, location: linkedTopic ? linkedLocation : location });
  });
  return (
    <NotificationDetailScreen
      canOpenTopic={Boolean(targetTopic)}
      canRetry={canAccessSource || needsLogin}
      retryLabel={needsLogin ? '去登录' : notificationErrorAction(detailReadError)}
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
      onOpenActor={openActor}
      actorUser={actorUser}
      actorInHeader={actorInHeader}
      routeActive={routeFocused}
      topicReplyAction={item.kind === 'mention' || item.kind === 'reply'}
      onOpenExternalUrl={openExternalUrl}
      onRetry={() => void retryDetail()}
      onOpenTopic={openTopic}
      onOpenReply={() => {
        setReplyError('');
        setReplyStatus('');
        setReplyVisible(true);
      }}
      onReplyClose={() => setReplyVisible(false)}
      onReplyContentChange={changeReplyContent}
      onReplySnapshot={(snapshot) => {
        changeReplyContent(snapshot.markdown);
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
  const navigation = useNavigation();
  const runtime = useNotificationRouteRuntime();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const pendingOptIn = useRef<object | null>(null);
  useFocusEffect(
    useCallback(
      () => () => {
        pendingOptIn.current = null;
      },
      []
    )
  );
  const run = useCallback(
    (operation: () => Promise<unknown>) => {
      if (running.current || !navigation.isFocused()) return;
      running.current = true;
      setBusy(true);
      void operation()
        .catch((error) => runtime.notify(errorMessage(error)))
        .finally(() => {
          running.current = false;
          setBusy(false);
        });
    },
    [navigation, runtime]
  );
  const toggleGlobal = useCallback(
    (enabled: boolean) => {
      const apply = () =>
        run(async () => {
          const granted = await runtime.setGlobalEnabled(enabled);
          if (enabled && !granted) runtime.notify('系统通知权限未开启，已保留你的设置');
        });
      if (enabled && !runtime.state.hasOptedIn) {
        if (!navigation.isFocused() || pendingOptIn.current) return;
        const confirmation = {};
        pendingOptIn.current = confirmation;
        const retire = () => {
          if (pendingOptIn.current !== confirmation) return false;
          pendingOptIn.current = null;
          return true;
        };
        Alert.alert(
          '开启 Android 消息通知',
          'App 会在本机约每 15 分钟检查一次。Android 可能延迟调度；消息正文、Cookie 和 token 不会写入通知存储。',
          [
            { text: '取消', style: 'cancel', onPress: retire },
            {
              text: '继续',
              onPress: () => {
                if (navigation.isFocused() && retire()) apply();
              }
            }
          ],
          { onDismiss: retire }
        );
        return;
      }
      apply();
    },
    [navigation, run, runtime]
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
      onOpenSystemSettings={() => {
        if (navigation.isFocused()) void runtime.openSystemSettings();
      }}
      onToggleGlobal={toggleGlobal}
      onToggleSource={(source, enabled) => run(() => runtime.setSourceEnabled(source, enabled))}
    />
  );
}
