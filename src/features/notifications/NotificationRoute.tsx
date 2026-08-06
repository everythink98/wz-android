import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import type { ForumNotification } from '@/domain/notifications/models';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';
import { parseForumTopicLink } from '@/domain/forum/links';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { errorMessage } from '@/platform/network/errors';
import { forumQueryKeys } from '@/platform/query/serverState';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import type { ReadGateway } from '@/sources/readGateway';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { appendReplyImageMarkup, normalizeReplyImageAsset } from '@/sources/imageUpload';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import { isNodeImageApiKeyExpiredError } from '@/sources/nodeimage/upload';
import type { NotificationsRuntimeValue } from './useNotificationsRuntime';
import { sortNotifications } from './notificationPresentation';
import {
  NotificationDetailScreen,
  NotificationSettingsScreen,
  NotificationsScreen,
  type NotificationFilterSource
} from './NotificationScreens';

export type NotificationRouteRuntimeValue = NotificationsRuntimeValue & {
  composer: {
    ensureNodeImageApiKey: () => Promise<string | null>;
    ensureWritableSession: (source: NotificationSource) => Promise<WritableSessionTicket>;
    getDiscourseEmojiUrls: ReadGateway['getEmojiUrls'];
    isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
  };
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
  const [categoryId, setCategoryId] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const markAllControllerRef = useRef<AbortController | undefined>(undefined);
  const retryControllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (route.params?.source) {
      setSource(route.params.source);
      setCategoryId('');
    }
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
  const categoriesQuery = useQuery({
    queryKey: forumQueryKeys.notificationCategories({ source, identityKey }),
    enabled: runtime.ready && source !== 'all' && sourceAvailable && isFocused,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      source === 'all' ? Promise.resolve([]) : runtime.gateway.getCategories(source, identityKey, signal)
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
      markAllControllerRef.current?.abort();
      markAllControllerRef.current = undefined;
      retryControllerRef.current?.abort();
      retryControllerRef.current = undefined;
    },
    [identityKey, source]
  );
  const listQueryKey = forumQueryKeys.notificationList({
    source,
    categoryId: source === 'all' ? null : categoryId,
    identityKey,
    unreadOnly
  });
  const listQuery = useInfiniteQuery({
    queryKey: listQueryKey,
    enabled: runtime.ready && sourceAvailable && isFocused && (source === 'all' || Boolean(categoryId)),
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
          categoryId,
          cursor: pageParam.sourceCursor,
          expectedIdentityKey: identityKey,
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
  const fetchNextPage = listQuery.fetchNextPage;
  const hasNextPage = listQuery.hasNextPage;
  const isFetchingNextPage = listQuery.isFetchingNextPage;
  useEffect(() => {
    if (source === 'all' || !isFocused || items.length || !hasNextPage || isFetchingNextPage) {
      return;
    }
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isFocused, items.length, source]);
  const errors = useMemo(() => {
    const result: Partial<Record<NotificationSource, string>> = Object.assign(
      {},
      ...(listQuery.data?.pages.map((page) => page.errors) || [])
    );
    if (source !== 'all' && categoriesQuery.error) {
      result[source] = sourceErrorFromUnknown(source, categoriesQuery.error).message;
    }
    return result;
  }, [categoriesQuery.error, listQuery.data, source]);
  const refetch = listQuery.refetch;
  const refetchCategories = categoriesQuery.refetch;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const retrySource = useCallback(
    (candidate: NotificationSource) => {
      if (source !== 'all') {
        void (categoriesQuery.error ? refetchCategories() : refetch());
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
    [
      categoriesQuery.error,
      listQueryKey,
      queryClient,
      refetch,
      refetchCategories,
      runtime.gateway,
      runtime.identityKeys,
      source,
      unreadOnly
    ]
  );
  const markAll = useCallback(() => {
    if (source === 'all' || source === 'yaohuo' || categoryId !== categories[0]?.id) return;
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
  }, [categories, categoryId, queryClient, runtime, source]);
  const changeSource = useCallback((nextSource: NotificationFilterSource) => {
    setCategoryId('');
    setSource(nextSource);
  }, []);
  return (
    <NotificationsScreen
      activeSources={runtime.activeSources}
      categories={categories}
      categoryId={categoryId}
      errors={errors}
      fetchingMore={listQuery.isFetchingNextPage}
      hasMore={Boolean(listQuery.hasNextPage)}
      items={items}
      loading={(listQuery.isPending || (source !== 'all' && categoriesQuery.isPending)) && sourceAvailable}
      markAllBusy={markAllBusy}
      refreshing={listQuery.isRefetching && !listQuery.isFetchingNextPage}
      source={source}
      sourcePending={sourcePending}
      unreadOnly={unreadOnly}
      xiaoyinsiNeedsUpgrade={runtime.xiaoyinsiNeedsUpgrade}
      onChangeCategory={setCategoryId}
      onChangeSource={changeSource}
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
  const markControllerRef = useRef<AbortController | undefined>(undefined);
  const replyControllerRef = useRef<AbortController | undefined>(undefined);
  const replyBusyRef = useRef(false);
  const [routeFocused, setRouteFocused] = useState(() => navigation.isFocused?.() ?? true);
  const [markMessage, setMarkMessage] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [replyError, setReplyError] = useState('');
  const [replyStatus, setReplyStatus] = useState('');
  const [replyVisible, setReplyVisible] = useState(false);
  const [discourseEmojiCatalog, setDiscourseEmojiCatalog] = useState<{
    source: 'linuxdo' | 'xiaoyinsi';
    urls: DiscourseEmojiUrlMap;
  } | null>(null);
  const detailQueryKey = forumQueryKeys.notificationDetail({
    source: item.source,
    identityKey,
    notificationId: item.id
  });
  const detailQuery = useQuery({
    queryKey: detailQueryKey,
    enabled: canAccessSource && routeFocused,
    staleTime: 0,
    queryFn: ({ signal }) => runtime.gateway.loadDetail(item, identityKey, signal)
  });
  const discourseEmojiUrls =
    discourseEmojiCatalog?.source === item.source ? discourseEmojiCatalog.urls : ({} as DiscourseEmojiUrlMap);
  useEffect(() => {
    if (!routeFocused || !canAccessSource || !detailQuery.data?.reply || !isDiscourseSource(item.source)) {
      setDiscourseEmojiCatalog(null);
      return undefined;
    }
    const discourseSource = item.source;
    const controller = new AbortController();
    runtime.composer
      .getDiscourseEmojiUrls({ source: discourseSource, signal: controller.signal })
      .then((urls) => {
        if (!controller.signal.aborted) setDiscourseEmojiCatalog({ source: discourseSource, urls });
      })
      .catch(() => {
        if (!controller.signal.aborted) setDiscourseEmojiCatalog(null);
      });
    return () => controller.abort();
  }, [canAccessSource, detailQuery.data?.reply, item.source, routeFocused, runtime.composer]);
  useEffect(() => {
    navigation.setOptions?.({ title: detailQuery.data?.messages ? detailQuery.data.title : '消息详情' });
  }, [detailQuery.data?.messages, detailQuery.data?.title, navigation]);
  useEffect(
    () => () => {
      markControllerRef.current?.abort();
      markControllerRef.current = undefined;
      replyControllerRef.current?.abort();
      replyControllerRef.current = undefined;
      replyBusyRef.current = false;
    },
    [identityKey, item.id]
  );
  useEffect(() => {
    const removeFocus = navigation.addListener?.('focus', () => setRouteFocused(true));
    const removeBlur = navigation.addListener?.('blur', () => {
      setRouteFocused(false);
      markControllerRef.current?.abort();
      markControllerRef.current = undefined;
      replyControllerRef.current?.abort();
      replyControllerRef.current = undefined;
      replyBusyRef.current = false;
      setReplyBusy(false);
      setReplyVisible(false);
      void queryClient.cancelQueries({ queryKey: detailQueryKey });
    });
    return () => {
      removeFocus?.();
      removeBlur?.();
    };
  }, [detailQueryKey, navigation, queryClient]);
  useEffect(() => {
    if (canAccessSource) return;
    replyControllerRef.current?.abort();
    replyControllerRef.current = undefined;
    replyBusyRef.current = false;
    setReplyBusy(false);
    if (currentIdentityKey !== identityKey) setReplyContent('');
    setReplyError('');
    setReplyStatus('');
    setReplyVisible(false);
  }, [canAccessSource, currentIdentityKey, identityKey]);
  useEffect(() => {
    const detail = detailQuery.data;
    const markKey = `${identityKey}:${item.id}`;
    if (!routeFocused || !canAccessSource || !detail || !item.unread || markStartedRef.current === markKey) return;
    markStartedRef.current = markKey;
    const controller = new AbortController();
    markControllerRef.current?.abort();
    markControllerRef.current = controller;
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
      })
      .finally(() => {
        if (markControllerRef.current === controller) markControllerRef.current = undefined;
      });
    return () => {
      current = false;
      controller.abort();
      if (markControllerRef.current === controller) markControllerRef.current = undefined;
    };
  }, [canAccessSource, detailQuery.data, gateway, identityKey, item, queryClient, refreshSnapshots, routeFocused]);
  const fallbackTopic =
    item.target.type === 'topic' || item.target.type === 'topic-post' ? parseForumTopicLink(item.target.url) : null;
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
  const submitReply = useCallback(() => {
    if (!canAccessSource || replyBusyRef.current || !replyContent.trim() || detailQuery.data?.reply?.disabledReason) {
      return;
    }
    const controller = new AbortController();
    replyBusyRef.current = true;
    replyControllerRef.current?.abort();
    replyControllerRef.current = controller;
    setReplyBusy(true);
    setReplyError('');
    setReplyStatus('');
    void gateway
      .replyToConversation(item, replyContent, identityKey, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return;
        if (!result.confirmed) {
          setReplyError(result.message || '原站未确认发送成功，请刷新会话后确认。');
          return;
        }
        setReplyContent('');
        setReplyStatus('');
        setReplyVisible(false);
        runtime.notify('回复已发送');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: detailQueryKey }),
          queryClient.invalidateQueries({ queryKey: forumQueryKeys.notifications(item.source) }),
          queryClient.invalidateQueries({ queryKey: forumQueryKeys.notifications('all') }),
          refreshSnapshots()
        ]);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setReplyError(errorMessage(error));
      })
      .finally(() => {
        if (replyControllerRef.current !== controller) return;
        replyControllerRef.current = undefined;
        replyBusyRef.current = false;
        setReplyBusy(false);
      });
  }, [
    canAccessSource,
    detailQuery.data?.reply?.disabledReason,
    detailQueryKey,
    gateway,
    identityKey,
    item,
    queryClient,
    refreshSnapshots,
    replyContent,
    runtime
  ]);
  const uploadReplyImage = useCallback(() => {
    if (
      !canAccessSource ||
      replyBusyRef.current ||
      detailQuery.data?.reply?.format !== 'markdown' ||
      detailQuery.data.reply.disabledReason ||
      item.source === 'yaohuo'
    ) {
      return;
    }
    const controller = new AbortController();
    replyBusyRef.current = true;
    replyControllerRef.current?.abort();
    replyControllerRef.current = controller;
    setReplyBusy(true);
    setReplyError('');
    setReplyStatus('');
    void (async () => {
      const ticket = await runtime.composer.ensureWritableSession(item.source);
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
      };
      assertCurrent();
      let nodeImageApiKey: string | undefined;
      let nodeImageGeneration: number | undefined;
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
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = normalizeReplyImageAsset(picked.assets[0]);
      const result = await gateway.uploadReplyImage(item.source, {
        expectedIdentityKey: identityKey,
        file,
        nodeImageApiKey,
        signal: controller.signal
      });
      assertCurrent();
      if (nodeImageGeneration !== undefined && nodeImageGeneration !== currentNodeImageApiKeyGeneration()) {
        throw new Error('NodeImage 凭据已变化');
      }
      setReplyContent((current) => appendReplyImageMarkup(current, result.markup));
      setReplyStatus('图片已插入草稿');
    })()
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
        setReplyError(
          isNodeImageApiKeyExpiredError(error)
            ? 'NodeImage API Key 不可用，请到账号中心重新获取授权或手动粘贴'
            : errorMessage(error)
        );
      })
      .finally(() => {
        if (replyControllerRef.current !== controller) return;
        replyControllerRef.current = undefined;
        replyBusyRef.current = false;
        setReplyBusy(false);
      });
  }, [canAccessSource, detailQuery.data?.reply, gateway, identityKey, item.source, runtime.composer]);
  return (
    <NotificationDetailScreen
      canOpenTopic={Boolean(targetTopic)}
      canRetry={canAccessSource}
      contentWidth={runtime.contentWidth}
      detail={canAccessSource ? detailQuery.data : undefined}
      error={canAccessSource ? (detailQuery.error ? errorMessage(detailQuery.error) : undefined) : accessError}
      loading={canAccessSource && detailQuery.isPending}
      markMessage={markMessage}
      replyBusy={replyBusy}
      replyContent={replyContent}
      discourseEmojiUrls={discourseEmojiUrls}
      replyError={replyError}
      replyStatus={replyStatus}
      replyVisible={replyVisible}
      topicReplyAction={item.kind === 'mention' || item.kind === 'reply'}
      onRetry={() => {
        if (canAccessSource) void detailQuery.refetch();
      }}
      onOpenTopic={(linkedTopic, linkedTargetReply) => {
        const topic = linkedTopic || targetTopic;
        if (topic) navigation.navigate('Topic', { topic, targetReply: linkedTopic ? linkedTargetReply : targetReply });
      }}
      onOpenReply={() => {
        setReplyError('');
        setReplyStatus('');
        setReplyVisible(true);
      }}
      onReplyClose={() => setReplyVisible(false)}
      onReplyContentChange={setReplyContent}
      onSubmitReply={submitReply}
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
