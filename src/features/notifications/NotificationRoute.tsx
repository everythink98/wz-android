import {
  createDiscoursePolicyOperation,
  policyRequestBusy,
  type PolicyOperationSnapshot
} from '@/domain/forum/discoursePolicyOperation';
import { useNotificationReplyOperation } from './useNotificationReplyOperation';
import { createNotificationRecoveryOwner } from './notificationRecoveryOwner';
import {
  createNotificationListReads,
  type NotificationListReadFilter,
  type NotificationListReadTicket,
  type NotificationListScopeAccess,
  type NotificationSourceAccessCheck,
  type NotificationSourceAuthority
} from './notificationListReads';
import { createNotificationReadReceipt } from './notificationReadReceipt';
import { createNotificationConversationHistory } from './notificationConversationHistory';
import { topicLocationForReply } from '@/domain/forum/topicLocation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { withPickedAttachmentCopies } from '@/platform/media/pickedAttachmentCopies';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect, useIsFocused, useNavigation, type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  focusManager,
  replaceEqualDeep,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData
} from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { SourceErrorInfo, Topic, TopicLocationTarget, UserReference } from '@/domain/forum/models';
import { isRecord } from '@/domain/forum/html';
import type { LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import { isDiscourseSource, notificationSources, sourceCatalog } from '@/domain/forum/sourceCatalog';
import type { ForumNotification, NotificationCategory } from '@/domain/notifications/models';
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
import { isDefinitiveHttpRejection, RequestCanceledError } from '@/platform/network/request';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { openHttpUrl } from '@/ui/navigation/openHttpUrl';
import { forumQueryKeys } from '@/platform/query/serverState';
import {
  captureDiscoursePolicyRead,
  readDiscoursePolicyWriteBlock,
  recordDiscoursePolicyReceipt,
  selectDiscoursePolicyWriteBlock,
  useDiscoursePolicyState
} from '@/platform/query/discoursePolicyCache';
import { resumeExactQuery } from '@/platform/query/useFirstPageInfiniteQuery';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';

import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { retryEmojiCatalog } from '@/sources/discourse/retryEmojiCatalog';
import { MAX_REPLY_IMAGE_UPLOAD_BYTES, normalizeReplyImageAsset } from '@/sources/imageUpload';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import { isNodeImageApiKeyExpiredError } from '@/sources/nodeimage/upload';
import { ContentSourceDisabledState } from '@/ui/controls/FeedbackStates';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

import { notificationErrorAction, sortNotifications } from './notificationPresentation';
import {
  commitNotificationSourceRetry,
  compatibleNotificationRefreshPrefix,
  findNotificationSourceRetryTarget,
  resolveNotificationNextPage,
  retainNotificationSourceChains,
  type NotificationListPage,
  type NotificationPageParam
} from './notificationPagination';
import { notificationActorUser } from './notificationActor';
import { NotificationContactTitle } from './NotificationContactTitle';
import {
  NotificationDetailScreen,
  NotificationSettingsScreen,
  NotificationsScreen,
  type NotificationFilterSource
} from './NotificationScreens';
import { useNotificationRouteRuntime, type NotificationRouteRuntimeValue } from './NotificationRouteRuntime';
import type { NotificationOperationOutcome } from './useNotificationsRuntime';

// Refresh evidence belongs to this fetch until structuralSharing commits its source chains.
const refreshPage = Symbol('notification-refresh-page');
type NotificationRefreshPage = NotificationListPage & {
  [refreshPage]?: {
    ticket: NotificationListReadTicket;
    retaining: ReadonlySet<NotificationSource>;
    failures: NotificationListPage['errors'];
  };
};

type NotificationMarkAllRun = {
  phase: 'confirming' | 'submitting';
  controller: AbortController;
};

type ConfirmedSourceRetryAdmission = {
  key: readonly unknown[];
  epoch: number;
  baselineSeq: number;
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
  const appFocused = useSyncExternalStore(focusManager.subscribe, () => focusManager.isFocused());
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
  const refreshing = useSyncExternalStore(listReads.subscribeRefresh, listReads.getRefreshing);
  const [listRecoveries] = useState(createNotificationRecoveryOwner);
  const latestRuntimeRef = useCommittedRef(runtime);
  const confirmedSourceRetries = useRef(new Map<NotificationSource, ConfirmedSourceRetryAdmission>());
  const observedAggregateActiveRef = useRef<{
    key: readonly unknown[] | null;
    active: NotificationSource[];
  }>({ key: null, active: [] });
  const previousSourceAuthRef = useRef<
    Partial<
      Record<
        NotificationSource,
        { identityKey: string | undefined; sessionEpoch: number; active: boolean; enabled: boolean }
      >
    >
  >({});
  const accountRetryRunRef = useRef<object | null>(null);
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
    listReads.invalidateScope();
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
  const categoriesQuery = useQuery<readonly NotificationCategory[]>({
    queryKey: categoriesQueryKey,
    enabled: runtime.ready && source !== 'all' && sourceAvailable && isFocused,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: (query) => query.state.data === undefined,
    queryFn: async ({ signal }) => {
      if (source === 'all') return [];
      if (!isFocused || !focusManager.isFocused() || signal.aborted) throw new RequestCanceledError();
      const blocked = runtime.getReadBlock(source);
      if (blocked) throw blocked;
      try {
        return await runtime.gateway.getCategories(source, identityKey, signal);
      } catch (error) {
        if (
          !signal.aborted &&
          focusManager.isFocused() &&
          latestRuntimeRef.current.enabledNotificationSources.includes(source) &&
          latestRuntimeRef.current.identityKeys[source] === runtime.identityKeys[source] &&
          latestRuntimeRef.current.sessionEpochs[source] === runtime.sessionEpochs[source]
        )
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
  const listReadFilter = useMemo<NotificationListReadFilter>(
    () => ({
      source,
      categoryId: source === 'all' ? '' : categoryId,
      unreadOnly,
      queryKey: listQueryKey
    }),
    [categoryId, listQueryKey, source, unreadOnly]
  );
  const listReadFilterRef = useCommittedRef(listReadFilter);
  const activeList = useMemo(
    () =>
      isFocused && runtime.ready
        ? { queryKey: listQueryKey, categoriesKey: source === 'all' ? null : categoriesQueryKey, sourceAvailable }
        : null,
    [categoriesQueryKey, isFocused, listQueryKey, runtime.ready, source, sourceAvailable]
  );
  const activeListRef = useCommittedRef(activeList);
  const currentList = useCallback(
    () => (activeListRef.current === activeList && focusManager.isFocused() ? activeList : null),
    [activeList, activeListRef]
  );
  const readScopeAccess = useCallback((): NotificationListScopeAccess => {
    const currentActive = activeListRef.current;
    return {
      focused: Boolean(currentActive),
      appFocused: focusManager.isFocused(),
      ready: latestRuntimeRef.current.ready,
      queryKey: currentActive?.queryKey ?? null
    };
  }, [activeListRef, latestRuntimeRef]);
  const readSourceAccess = useCallback(
    (candidate: NotificationSource): NotificationSourceAccessCheck => {
      const latestRuntime = latestRuntimeRef.current;
      return {
        ...readScopeAccess(),
        enabled: latestRuntime.enabledNotificationSources.includes(candidate),
        active: latestRuntime.activeSources.includes(candidate),
        identityKey: latestRuntime.identityKeys[candidate],
        sessionEpoch: latestRuntime.sessionEpochs[candidate]
      };
    },
    [latestRuntimeRef, readScopeAccess]
  );
  useLayoutEffect(
    () => () => {
      cancelMarkAll();
      listReads.invalidateScope();
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
  useLayoutEffect(() => {
    const prev = previousSourceAuthRef.current;
    const next: typeof prev = {};
    for (const candidate of notificationSources) {
      const current = {
        identityKey: runtime.identityKeys[candidate],
        sessionEpoch: runtime.sessionEpochs[candidate],
        active: runtime.activeSources.includes(candidate),
        enabled: runtime.enabledNotificationSources.includes(candidate)
      };
      const before = prev[candidate];
      if (
        before &&
        (before.identityKey !== current.identityKey ||
          before.sessionEpoch !== current.sessionEpoch ||
          (before.active && !current.active) ||
          (before.enabled && !current.enabled))
      ) {
        listReads.invalidateSource(candidate);
      }
      next[candidate] = current;
    }
    previousSourceAuthRef.current = next;
  }, [
    enabledSourcesKey,
    listReads,
    runtime.activeSources,
    runtime.enabledNotificationSources,
    runtime.identityKeys,
    runtime.sessionEpochs
  ]);
  useEffect(
    () => () => {
      accountRetryRunRef.current = null;
      listRecoveries.cancel();
    },
    [source, categoryId, unreadOnly, isFocused, listRecoveries]
  );
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (!focused) {
          accountRetryRunRef.current = null;
          confirmedSourceRetries.current.clear();
          listReads.invalidateScope();
          if (listRecoveries.pending) listRecoveries.cancel();
          const visit = activeListRef.current;
          if (visit) {
            void queryClient.cancelQueries({ queryKey: visit.queryKey, exact: true });
            if (visit.categoriesKey) void queryClient.cancelQueries({ queryKey: visit.categoriesKey, exact: true });
          }
        }
      }),
    [activeListRef, listReads, listRecoveries, queryClient]
  );
  const listQuery = useInfiniteQuery<
    NotificationRefreshPage,
    Error,
    InfiniteData<NotificationListPage, NotificationPageParam>,
    ReturnType<typeof forumQueryKeys.notificationList>,
    NotificationPageParam
  >({
    queryKey: listQueryKey,
    enabled: runtime.ready && sourceAvailable && isFocused && (source === 'all' || Boolean(categoryId)),
    staleTime: 0,
    // Resume a canceled first read without rereading loaded history on an AppState change.
    refetchOnWindowFocus: (query) => query.state.data === undefined,
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
    structuralSharing: (previous, incoming) => {
      const refreshed = incoming as InfiniteData<NotificationRefreshPage, NotificationPageParam>;
      if (!refreshed.pages.some((page) => page[refreshPage])) return replaceEqualDeep(previous, incoming);
      const cached = previous as InfiniteData<NotificationListPage, NotificationPageParam> | undefined;
      const retained = new Map<NotificationSource, number>();
      const failures = new Map<
        NotificationSource,
        { pageIndex: number; error: SourceErrorInfo; cursor?: string; seq: number }
      >();
      const latestRetries = new Map<NotificationSource, NonNullable<ReturnType<typeof listReads.newerSourceRetry>>>();
      const pages = refreshed.pages.map((page, pageIndex) => {
        const { [refreshPage]: state, ...data } = page;
        if (!state) return page;
        const { ticket, retaining } = state;
        for (const candidate of retaining) retained.set(candidate, 0);
        for (const candidate of ticket.requestedSources) {
          const retry = listReads.newerSourceRetry(ticket, candidate);
          if (retry) latestRetries.set(candidate, retry);
          const error = state.failures[candidate];
          if (error && !failures.has(candidate))
            failures.set(candidate, {
              pageIndex,
              error,
              cursor: refreshed.pageParams[pageIndex]?.allCursors?.[candidate] ?? undefined,
              seq: ticket.seq
            });
        }
        return data;
      });
      const fresh = { pages, pageParams: refreshed.pageParams };
      for (const [candidate, failure] of failures) {
        retained.set(candidate, failure.pageIndex);
      }
      for (const [candidate, retry] of latestRetries) {
        failures.delete(candidate);
        if (cached) {
          retained.set(
            candidate,
            compatibleNotificationRefreshPrefix(cached, fresh, candidate, source === 'all', retry)
          );
        }
      }
      if (cached && source === 'all' && retained.size) {
        return replaceEqualDeep(previous, retainNotificationSourceChains(cached, fresh, retained, failures));
      }
      if (cached && source !== 'all' && latestRetries.has(source)) {
        const retainedFrom = retained.get(source) ?? 0;
        if (!retainedFrom) return cached;
        return replaceEqualDeep(previous, {
          pages: [...fresh.pages.slice(0, retainedFrom), ...cached.pages.slice(retainedFrom)],
          pageParams: [...fresh.pageParams.slice(0, retainedFrom), ...cached.pageParams.slice(retainedFrom)]
        });
      }
      return replaceEqualDeep(previous, fresh);
    },
    queryFn: async ({ pageParam, signal }): Promise<NotificationRefreshPage> => {
      if (!isFocused || !focusManager.isFocused() || signal.aborted) throw new RequestCanceledError();
      const launchRuntime = latestRuntimeRef.current;
      const isInitialPage = source === 'all' ? !pageParam.allCursors : !pageParam.sourceCursor;
      const fetchDirection = queryClient.getQueryState(listQueryKey)?.fetchMeta?.fetchMore?.direction;
      const mode = isInitialPage || fetchDirection !== 'forward' ? 'full-chain' : 'pagination';
      if (source === 'all') {
        const paginationCursors = pageParam.allCursors;
        const blockedSources = launchRuntime.activeSources.filter((candidate) =>
          Boolean(launchRuntime.getReadBlock(candidate))
        );
        const querySources = launchRuntime.activeSources.filter(
          (candidate) =>
            !blockedSources.includes(candidate) && (!paginationCursors || paginationCursors[candidate] != null)
        );
        const sourceAuthorities: Partial<Record<NotificationSource, NotificationSourceAuthority>> = {};
        for (const candidate of querySources) {
          const candidateIdentity = launchRuntime.identityKeys[candidate];
          if (candidateIdentity) {
            sourceAuthorities[candidate] = {
              identityKey: candidateIdentity,
              sessionEpoch: launchRuntime.sessionEpochs[candidate]
            };
          }
        }
        const ticket = listReads.beginQueryRead({
          mode,
          signal,
          filter: listReadFilter,
          requestedSources: querySources,
          sourceAuthorities,
          cursor: pageParam
        });
        const page = await launchRuntime.gateway.listAllPage({
          cursors: paginationCursors,
          limit: 30,
          signal,
          sources: querySources,
          unreadOnly
        });
        if (signal.aborted) throw new RequestCanceledError();
        if (!listReads.isScopeCurrent(ticket, readScopeAccess())) {
          void queryClient.cancelQueries({ queryKey: listQueryKey, exact: true });
          throw new RequestCanceledError();
        }
        const commitRuntime = latestRuntimeRef.current;
        const previous =
          queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey);
        const exactPrevIndex = previous
          ? previous.pageParams.findIndex((param) => JSON.stringify(param) === JSON.stringify(pageParam))
          : -1;
        const previousPageFor = (candidate: NotificationSource): NotificationListPage | undefined => {
          if (!previous?.pages.length) return undefined;
          if (isInitialPage) return previous.pages[0];
          if (exactPrevIndex >= 0) return previous.pages[exactPrevIndex];
          const requestedCursor = paginationCursors?.[candidate];
          if (requestedCursor != null) {
            const matchedIndex = previous.pageParams.findIndex(
              (param) => param.allCursors?.[candidate] === requestedCursor
            );
            if (matchedIndex >= 0) return previous.pages[matchedIndex];
          }
          return undefined;
        };
        const mergedItems: ForumNotification[] = [];
        const mergedErrors: Partial<Record<NotificationSource, SourceErrorInfo>> = {};
        const nextCursors: Partial<Record<NotificationSource, string | null>> = {};
        const mergedHistoryNotices: Partial<Record<NotificationSource, string>> = {};
        const retaining = new Set<NotificationSource>();
        const failures: NotificationListPage['errors'] = {};
        for (const candidate of commitRuntime.activeSources) {
          const prevPage = previousPageFor(candidate);
          const sourceOwnsRead =
            querySources.includes(candidate) &&
            listReads.ownsSourceRead(ticket, candidate, readSourceAccess(candidate));
          if (mode === 'full-chain') {
            if (!sourceOwnsRead) {
              if (isInitialPage || paginationCursors?.[candidate] != null) retaining.add(candidate);
              if (paginationCursors?.[candidate] === null) nextCursors[candidate] = null;
              if (blockedSources.includes(candidate)) {
                const block = commitRuntime.getReadBlock(candidate);
                if (block) {
                  mergedErrors[candidate] = block;
                  if (isInitialPage) failures[candidate] = block;
                }
              }
              continue;
            }
            const quality = page.qualities[candidate];
            if (quality === 'invalid' || quality === 'partial') {
              retaining.add(candidate);
              const error = page.errors[candidate];
              if (error && !listReads.newerSourceRetry(ticket, candidate)) {
                commitRuntime.reportReadError(candidate, error, ticket.sourceAuthorities[candidate]!.sessionEpoch);
                mergedErrors[candidate] = error;
                failures[candidate] = error;
                if (quality === 'partial') mergedItems.push(...page.items.filter((item) => item.source === candidate));
              }
              continue;
            }
          }
          if (sourceOwnsRead) {
            const error = page.errors[candidate];
            if (error) {
              if (mode !== 'full-chain' || !listReads.newerSourceRetry(ticket, candidate)) {
                commitRuntime.reportReadError(candidate, error, ticket.sourceAuthorities[candidate]!.sessionEpoch);
              }
              mergedErrors[candidate] = error;
            }
            if (page.qualities[candidate] === 'invalid') {
              if (prevPage) {
                mergedItems.push(...prevPage.items.filter((item) => item.source === candidate));
                if (prevPage.historyNotices?.[candidate]) {
                  mergedHistoryNotices[candidate] = prevPage.historyNotices[candidate]!;
                }
              }
              nextCursors[candidate] = page.nextCursors[candidate] ?? null;
            } else {
              mergedItems.push(...page.items.filter((item) => item.source === candidate));
              nextCursors[candidate] = page.nextCursors[candidate] ?? null;
            }
          } else {
            if (!isInitialPage && paginationCursors?.[candidate] === null) {
              nextCursors[candidate] = null;
              continue;
            }
            if (!isInitialPage && paginationCursors?.[candidate] === undefined) {
              if (prevPage) {
                mergedItems.push(...prevPage.items.filter((item) => item.source === candidate));
                if (prevPage.errors[candidate]) mergedErrors[candidate] = prevPage.errors[candidate]!;
                if (prevPage.historyNotices?.[candidate]) {
                  mergedHistoryNotices[candidate] = prevPage.historyNotices[candidate]!;
                }
                if (prevPage.nextPage.allCursors && candidate in prevPage.nextPage.allCursors) {
                  nextCursors[candidate] = prevPage.nextPage.allCursors[candidate];
                }
              } else if (mode === 'pagination') {
                const prevTailCursor = previous?.pages.at(-1)?.nextPage.allCursors?.[candidate];
                if (prevTailCursor !== undefined) nextCursors[candidate] = prevTailCursor;
              }
              continue;
            }
            if (prevPage) {
              mergedItems.push(...prevPage.items.filter((item) => item.source === candidate));
              if (prevPage.errors[candidate]) mergedErrors[candidate] = prevPage.errors[candidate]!;
              if (prevPage.historyNotices?.[candidate]) {
                mergedHistoryNotices[candidate] = prevPage.historyNotices[candidate]!;
              }
              if (prevPage.nextPage.allCursors && candidate in prevPage.nextPage.allCursors) {
                nextCursors[candidate] = prevPage.nextPage.allCursors[candidate];
              }
            }
            if (!mergedErrors[candidate] && blockedSources.includes(candidate)) {
              const currentBlock = commitRuntime.getReadBlock(candidate);
              if (currentBlock) mergedErrors[candidate] = currentBlock;
            }
          }
        }
        return {
          items: mergedItems,
          errors: mergedErrors,
          hasMore: Object.values(nextCursors).some((cursor) => cursor != null),
          nextPage: { allCursors: nextCursors } satisfies NotificationPageParam,
          ...(mode === 'full-chain' ? { [refreshPage]: { ticket, retaining, failures } } : {}),
          ...(Object.keys(mergedHistoryNotices).length ? { historyNotices: mergedHistoryNotices } : {})
        };
      }
      let ticket: NotificationListReadTicket | null = null;
      const trackRefresh = (data: NotificationListPage): NotificationRefreshPage =>
        ticket && mode === 'full-chain'
          ? { ...data, [refreshPage]: { ticket, retaining: new Set(), failures: {} } }
          : data;
      try {
        const blocked = launchRuntime.getReadBlock(source);
        if (blocked) throw blocked;
        const expectedSourceIdentity = launchRuntime.identityKeys[source] || identityKey;
        ticket = listReads.beginQueryRead({
          mode,
          signal,
          filter: listReadFilter,
          requestedSources: [source],
          sourceAuthorities: {
            [source]: {
              identityKey: expectedSourceIdentity,
              sessionEpoch: launchRuntime.sessionEpochs[source]
            }
          },
          cursor: pageParam.sourceCursor
        });
        const page = await launchRuntime.gateway.listPage(source, {
          categoryId,
          cursor: pageParam.sourceCursor,
          expectedIdentityKey: identityKey,
          limit: 30,
          signal,
          unreadOnly
        });
        if (signal.aborted) throw new RequestCanceledError();
        if (!listReads.isScopeCurrent(ticket, readScopeAccess())) {
          void queryClient.cancelQueries({ queryKey: listQueryKey, exact: true });
          throw new RequestCanceledError();
        }
        const qualityError = notificationPageError(page.quality);
        if (page.quality === 'invalid') throw qualityError;
        const commitRuntime = latestRuntimeRef.current;
        if (!listReads.ownsSourceRead(ticket, source, readSourceAccess(source))) {
          const previous =
            queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey);
          const previousPage =
            previous?.pages[
              isInitialPage
                ? 0
                : previous.pageParams.findIndex((param) => param.sourceCursor === pageParam.sourceCursor)
            ];
          return trackRefresh(
            previousPage || {
              items: [],
              errors: {},
              hasMore: false,
              nextPage: {} satisfies NotificationPageParam
            }
          );
        }
        const errors: Partial<Record<NotificationSource, SourceErrorInfo>> = {};
        if (qualityError && (mode !== 'full-chain' || !listReads.newerSourceRetry(ticket, source))) {
          errors[source] = sourceErrorFromUnknown(source, qualityError);
          commitRuntime.reportReadError(source, errors[source], ticket.sourceAuthorities[source]!.sessionEpoch);
        }
        return trackRefresh({
          items: page.items,
          errors,
          hasMore: page.hasMore && !qualityError,
          nextPage: { sourceCursor: page.cursor } satisfies NotificationPageParam,
          historyNotices: page.historyNotice ? { [source]: page.historyNotice } : {}
        });
      } catch (error) {
        if (signal.aborted || error instanceof RequestCanceledError) throw error;
        if (ticket && !listReads.isScopeCurrent(ticket, readScopeAccess())) {
          void queryClient.cancelQueries({ queryKey: listQueryKey, exact: true });
          throw new RequestCanceledError();
        }
        const previous =
          queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey);
        const previousPage =
          previous?.pages[
            isInitialPage ? 0 : previous.pageParams.findIndex((param) => param.sourceCursor === pageParam.sourceCursor)
          ];
        if (ticket && !listReads.ownsSourceRead(ticket, source, readSourceAccess(source))) {
          return trackRefresh(
            previousPage || {
              items: [],
              errors: {},
              hasMore: false,
              nextPage: {} satisfies NotificationPageParam
            }
          );
        }
        const info = sourceErrorFromUnknown(source, error);
        const commitRuntime = latestRuntimeRef.current;
        if (ticket && (mode !== 'full-chain' || !listReads.newerSourceRetry(ticket, source))) {
          commitRuntime.reportReadError(source, info, ticket.sourceAuthorities[source]!.sessionEpoch);
        } else if (
          !ticket &&
          activeListRef.current?.queryKey === listQueryKey &&
          focusManager.isFocused() &&
          commitRuntime.enabledNotificationSources.includes(source)
        ) {
          commitRuntime.reportReadError(source, info, commitRuntime.sessionEpochs[source]);
        }
        return trackRefresh({
          items: previousPage?.items || [],
          errors: { [source]: info },
          hasMore: false,
          nextPage: {} satisfies NotificationPageParam,
          historyNotices: previousPage?.historyNotices
        });
      }
    },
    getNextPageParam: (lastPage, pages, _pageParam, allPageParams) =>
      resolveNotificationNextPage({ source, ...lastPage, consumedPages: allPageParams, retainedFailures: pages })
        .nextPage
  });
  useEffect(() => {
    if (isFocused) return;
    void queryClient.cancelQueries({ queryKey: listQueryKey, exact: true, type: 'inactive' });
    if (source !== 'all')
      void queryClient.cancelQueries({ queryKey: categoriesQueryKey, exact: true, type: 'inactive' });
  }, [categoriesQueryKey, isFocused, listQueryKey, queryClient, source]);
  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: listQueryKey, exact: true, type: 'inactive' });
      if (source !== 'all')
        void queryClient.cancelQueries({ queryKey: categoriesQueryKey, exact: true, type: 'inactive' });
    },
    [categoriesQueryKey, listQueryKey, queryClient, source]
  );
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
    if (!visit?.sourceAvailable || !hasNextPage || listReads.getRefreshing()) return;
    const current = queryClient.getQueryState(visit.queryKey);
    if (!current?.data || current.data !== listQuery.data) return;
    const fetchingNextPage = current?.fetchStatus !== 'idle' && current?.fetchMeta?.fetchMore?.direction === 'forward';
    if (!fetchingNextPage) void fetchNextPage();
  }, [currentList, fetchNextPage, hasNextPage, listQuery.data, listReads, queryClient]);
  useEffect(() => {
    if (source === 'all' || !isFocused || !appFocused || items.length || !hasNextPage || isFetchingNextPage) {
      return;
    }
    loadMore();
  }, [
    loadMore,
    hasNextPage,
    isFetchingNextPage,
    isFocused,
    appFocused,
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
    const visit = currentList();
    if (!visit?.sourceAvailable) return;
    const request = listReads.beginRefresh();
    if (!request) return;
    void Promise.allSettled([refetch(), refreshSnapshots()]).finally(() => listReads.finishRefresh(request));
  }, [currentList, listReads, refetch, refreshSnapshots]);
  const aggregateSourceCovered = useCallback(
    (candidate: NotificationSource, baselineSeq: number) => {
      const latestRuntime = latestRuntimeRef.current;
      const expectedIdentityKey = latestRuntime.identityKeys[candidate];
      if (!expectedIdentityKey) return false;
      const authority: NotificationSourceAuthority = {
        identityKey: expectedIdentityKey,
        sessionEpoch: latestRuntime.sessionEpochs[candidate]
      };
      return listReads.sourceReadSeq(candidate, authority, listReadFilterRef.current) > baselineSeq;
    },
    [latestRuntimeRef, listReadFilterRef, listReads]
  );
  const retryReadSource = useCallback(
    async (candidate: NotificationSource, resumeSignal?: AbortSignal): Promise<LinuxDoReadResumeOutcome> => {
      const launchRuntime = latestRuntimeRef.current;
      const expectedIdentityKey = launchRuntime.identityKeys[candidate];
      const epoch = launchRuntime.sessionEpochs[candidate];
      if (
        !expectedIdentityKey ||
        !launchRuntime.activeSources.includes(candidate) ||
        !launchRuntime.enabledNotificationSources.includes(candidate) ||
        activeListRef.current?.queryKey !== listQueryKey ||
        resumeSignal?.aborted ||
        !focusManager.isFocused()
      ) {
        return 'stale';
      }
      const cached = queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey);
      const target = findNotificationSourceRetryTarget(cached, source, candidate);
      const { pageIndex, cursor: expectedCursor } = target;
      const ticket = listReads.beginSourceRetry({
        source: candidate,
        authority: { identityKey: expectedIdentityKey, sessionEpoch: epoch },
        filter: listReadFilter,
        pageIndex,
        cursor: expectedCursor
      });
      const { signal } = ticket;
      const abort = () => listReads.finishSourceRetry(ticket, 'aborted');
      resumeSignal?.addEventListener('abort', abort, { once: true });
      if (resumeSignal?.aborted) abort();
      const current = () =>
        !resumeSignal?.aborted && listReads.ownsSourceRead(ticket, candidate, readSourceAccess(candidate));
      const waitForListQueryIdle = async () => {
        while (current()) {
          const query = queryClient.getQueryCache().find({ queryKey: listQueryKey, exact: true });
          if (!query || query.state.fetchStatus !== 'fetching') return;
          await new Promise<void>((resolve) => {
            const finish = () => {
              unsubscribe();
              signal.removeEventListener('abort', finish);
              resolve();
            };
            const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
              if (event.query === query && (event.type === 'removed' || query.state.fetchStatus !== 'fetching')) {
                finish();
              }
            });
            signal.addEventListener('abort', finish, { once: true });
            if (query.state.fetchStatus !== 'fetching' || signal.aborted) finish();
          });
        }
      };
      const retryCategories = source !== 'all' && Boolean(categoriesQuery.error);
      try {
        if (!current()) return 'stale';
        let result: Parameters<typeof commitNotificationSourceRetry>[2] | undefined;
        try {
          if (retryCategories) {
            const categoryRead = {
              queryKey: categoriesQueryKey,
              queryFn: async () => {
                const categories = await launchRuntime.gateway.getCategories(candidate, expectedIdentityKey, signal);
                if (!current()) throw new RequestCanceledError();
                return categories;
              }
            };
            if (resumeSignal) {
              const resumed = await resumeExactQuery(queryClient, categoryRead, current, resumeSignal);
              if (resumed.kind === 'stale') return 'stale';
              if (resumed.kind === 'failed') throw resumed.error;
            } else {
              await queryClient.fetchQuery({ ...categoryRead, staleTime: 0 });
            }
          } else {
            const page = await launchRuntime.gateway.listPage(candidate, {
              ...(source === 'all' ? { cursor: expectedCursor } : { categoryId, cursor: expectedCursor }),
              expectedIdentityKey,
              limit: 30,
              signal,
              unreadOnly
            });
            const qualityError = notificationPageError(page.quality);
            if (page.quality === 'invalid') throw qualityError;
            result = { page, error: qualityError ? sourceErrorFromUnknown(candidate, qualityError) : undefined };
          }
        } catch (error) {
          result = { error: sourceErrorFromUnknown(candidate, error) };
        }
        if (!current()) return 'stale';
        const outcome = result;
        if (!retryCategories && outcome) {
          await waitForListQueryIdle();
          if (!current()) return 'stale';
          queryClient.setQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey, (data) =>
            commitNotificationSourceRetry(data, target, outcome)
          );
        }
        if (!current()) return 'stale';
        const latest = latestRuntimeRef.current;
        latest.clearReadBlock(candidate, epoch);
        const info = outcome?.error;
        if (!info) return 'completed';
        latest.reportReadError(candidate, info, epoch);
        return info.kind === 'verification-required' ? 'verification-required' : 'failed';
      } finally {
        resumeSignal?.removeEventListener('abort', abort);
        listReads.finishSourceRetry(ticket);
      }
    },
    [
      activeListRef,
      categoriesQuery.error,
      categoriesQueryKey,
      categoryId,
      latestRuntimeRef,
      listQueryKey,
      listReadFilter,
      listReads,
      queryClient,
      readSourceAccess,
      source,
      unreadOnly
    ]
  );
  const retryReadSourceRef = useCommittedRef(retryReadSource);
  const settleConfirmedAggregateSource = useCallback(
    async (candidate: NotificationSource, epoch: number, baselineSeq: number) => {
      const latestRuntime = latestRuntimeRef.current;
      const currentKey = activeListRef.current?.queryKey;
      if (
        !currentKey ||
        !focusManager.isFocused() ||
        !latestRuntime.enabledNotificationSources.includes(candidate) ||
        latestRuntime.sessionEpochs[candidate] !== epoch
      ) {
        return;
      }
      const fetching = queryClient.isFetching({ queryKey: currentKey, exact: true }) > 0;
      const cached = queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(currentKey);
      if (!latestRuntime.activeSources.includes(candidate) || fetching || !cached?.pages[0]) {
        confirmedSourceRetries.current.set(candidate, {
          key: currentKey,
          epoch,
          baselineSeq
        });
        return;
      }
      if (aggregateSourceCovered(candidate, baselineSeq)) return;
      await retryReadSourceRef.current(candidate);
    },
    [activeListRef, aggregateSourceCovered, latestRuntimeRef, queryClient, retryReadSourceRef]
  );
  useEffect(() => {
    if (!isFocused || !runtime.ready || source !== 'all') {
      observedAggregateActiveRef.current = { key: null, active: [] };
    } else if (observedAggregateActiveRef.current.key !== listQueryKey) {
      observedAggregateActiveRef.current = { key: listQueryKey, active: [...runtime.activeSources] };
    } else {
      const previousActive = observedAggregateActiveRef.current.active;
      if (previousActive.length > 0 && focusManager.isFocused()) {
        for (const candidate of runtime.activeSources) {
          if (
            !previousActive.includes(candidate) &&
            !runtime.getReadBlock(candidate) &&
            !confirmedSourceRetries.current.has(candidate) &&
            !aggregateSourceCovered(candidate, 0)
          ) {
            confirmedSourceRetries.current.set(candidate, {
              key: listQueryKey,
              epoch: runtime.sessionEpochs[candidate],
              baselineSeq: 0
            });
          }
        }
      }
      observedAggregateActiveRef.current.active = [...runtime.activeSources];
    }
    const fetching = listQuery.isFetching || queryClient.isFetching({ queryKey: listQueryKey, exact: true }) > 0;
    const cached = queryClient.getQueryData<InfiniteData<NotificationListPage, NotificationPageParam>>(listQueryKey);
    for (const [candidate, admission] of confirmedSourceRetries.current) {
      if (
        !isFocused ||
        !focusManager.isFocused() ||
        !runtime.ready ||
        admission.key !== listQueryKey ||
        runtime.sessionEpochs[candidate] !== admission.epoch ||
        !runtime.enabledNotificationSources.includes(candidate)
      ) {
        confirmedSourceRetries.current.delete(candidate);
      } else if (runtime.activeSources.includes(candidate) && !fetching) {
        if (source === 'all' && !cached?.pages[0]) continue;
        confirmedSourceRetries.current.delete(candidate);
        if (source === 'all' && aggregateSourceCovered(candidate, admission.baselineSeq)) continue;
        void retryReadSource(candidate);
      }
    }
  }, [
    aggregateSourceCovered,
    isFocused,
    listQuery.dataUpdatedAt,
    listQuery.isFetching,
    listQueryKey,
    queryClient,
    retryReadSource,
    runtime,
    source
  ]);
  const retrySource = useCallback(
    (candidate: NotificationSource, aggregateBaselineSeq?: number) => {
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
      const expectedIdentityKey = runtime.identityKeys[candidate];
      const wasActive = runtime.activeSources.includes(candidate);
      const startKey = listQueryKey;
      const baselineSeq = aggregateBaselineSeq ?? listReads.currentSeq;
      const startSourceSeq = expectedIdentityKey
        ? listReads.sourceReadSeq(candidate, { identityKey: expectedIdentityKey, sessionEpoch: epoch }, listReadFilter)
        : 0;
      const surfaceCurrent = () =>
        listRecoveries.current(intent) &&
        focusManager.isFocused() &&
        latestRuntimeRef.current.enabledNotificationSources.includes(candidate);
      const current = () =>
        surfaceCurrent() &&
        latestRuntimeRef.current.sessionEpochs[candidate] === epoch &&
        (!expectedIdentityKey || latestRuntimeRef.current.identityKeys[candidate] === expectedIdentityKey);
      const recovery: ReadRecovery = {
        queryKey: source !== 'all' && categoriesQuery.error ? categoriesQueryKey : listQueryKey,
        explicit: true,
        isCurrent: current,
        cancel: () => {
          if (listRecoveries.current(intent)) listRecoveries.cancel();
        },
        resume: (signal) => (current() ? retryReadSourceRef.current(candidate, signal) : Promise.resolve('stale'))
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
          else if (source === 'all' && !wasActive) {
            const currentKey = activeListRef.current?.queryKey;
            if (!currentKey) return;
            await settleConfirmedAggregateSource(candidate, epoch, currentKey === startKey ? baselineSeq : 0);
            return;
          }
        }
        if (!current()) return;
        if (info && notificationErrorAction(info) !== '重试') {
          await runtime.openAccountSurface(
            candidate,
            info.message,
            info.kind === 'verification-required' ? recovery : undefined
          );
        } else if (
          !wasActive ||
          !expectedIdentityKey ||
          listReads.sourceReadSeq(
            candidate,
            { identityKey: expectedIdentityKey, sessionEpoch: epoch },
            listReadFilter
          ) === startSourceSeq
        ) {
          await retryReadSourceRef.current(candidate);
        }
      })()
        .catch((error) => {
          if (current()) runtime.notify(errorMessage(error));
        })
        .finally(() => {
          listRecoveries.settled(intent);
        });
    },
    [
      activeListRef,
      categoriesQuery.error,
      categoriesQueryKey,
      currentList,
      errors,
      latestRuntimeRef,
      listQueryKey,
      listReadFilter,
      listReads,
      retryReadSourceRef,
      runtime,
      settleConfirmedAggregateSource,
      source,
      listRecoveries
    ]
  );
  const selectedSourcesKey =
    source === 'all' ? enabledSourcesKey : runtime.enabledNotificationSources.includes(source) ? source : '';
  const selectedSessionEpochsKey = useMemo(() => {
    const selected = selectedSourcesKey ? (selectedSourcesKey.split('|') as NotificationSource[]) : [];
    return selected.map((candidate) => `${candidate}:${runtime.sessionEpochs[candidate]}`).join('|');
  }, [runtime.sessionEpochs, selectedSourcesKey]);
  const accountRetryAccessKey = useMemo(() => {
    const selected = selectedSourcesKey ? (selectedSourcesKey.split('|') as NotificationSource[]) : [];
    return [
      enabledSourcesKey,
      identityKey,
      ...selected.map((candidate) => {
        const session = runtime.sessions[candidate];
        return [
          candidate,
          runtime.identityKeys[candidate] || 'none',
          session.currentUser?.id || 'none',
          runtime.sessionEpochs[candidate],
          runtime.activeSources.includes(candidate) ? '1' : '0',
          session.isLoggedIn ? '1' : '0',
          session.identityTrust,
          session.isVerifying ? '1' : '0'
        ].join(':');
      })
    ].join('|');
  }, [
    enabledSourcesKey,
    identityKey,
    runtime.activeSources,
    runtime.identityKeys,
    runtime.sessionEpochs,
    runtime.sessions,
    selectedSourcesKey
  ]);
  const accountRetryBatchScope = useMemo(
    () => (isFocused && runtime.ready ? { source, categoryId, unreadOnly, enabledSourcesKey } : null),
    [categoryId, enabledSourcesKey, isFocused, runtime.ready, source, unreadOnly]
  );
  const accountRetryBatchScopeRef = useCommittedRef(accountRetryBatchScope);
  const accountRetryScope = useMemo(
    () =>
      accountRetryBatchScope
        ? {
            batch: accountRetryBatchScope,
            accessKey: accountRetryAccessKey,
            sourceAvailable
          }
        : null,
    [accountRetryAccessKey, accountRetryBatchScope, sourceAvailable]
  );
  const accountRetryScopeRef = useCommittedRef(accountRetryScope);
  useEffect(
    () => () => {
      accountRetryRunRef.current = null;
    },
    [accountRetryBatchScope, selectedSessionEpochsKey]
  );
  const latestRetryStateRef = useCommittedRef({
    listQueryKey,
    retrySource
  });
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
    const cancelConfirmation = () => {
      if (markAllRef.current === run && run.phase === 'confirming') cancelMarkAll();
    };
    Alert.alert(
      '全部标记为已读',
      `将 ${sourceCatalog[source].label} 现有消息全部标记为已读？`,
      [
        {
          text: '取消',
          style: 'cancel',
          onPress: cancelConfirmation
        },
        {
          text: '确认',
          onPress: () => {
            if (
              !currentList()?.sourceAvailable ||
              run.phase !== 'confirming' ||
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
      ],
      { cancelable: true, onDismiss: cancelConfirmation }
    );
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
    const startRuntime = latestRuntimeRef.current;
    if (
      !accountRetryScope ||
      accountRetryScopeRef.current !== accountRetryScope ||
      accountRetryScope.sourceAvailable ||
      !focusManager.isFocused() ||
      !startRuntime.ready ||
      accountRetryRunRef.current
    )
      return;
    const run = {};
    accountRetryRunRef.current = run;
    const startSource = accountRetryScope.batch.source;
    let baselineKey = latestRetryStateRef.current.listQueryKey;
    let baselineSeq = listReads.currentSeq;
    const candidates =
      startSource === 'all'
        ? startRuntime.enabledNotificationSources.filter(
            (candidate) => startRuntime.sessions[candidate].identityTrust === 'unknown'
          )
        : startRuntime.enabledNotificationSources.includes(startSource) &&
            startRuntime.sessions[startSource].identityTrust === 'unknown'
          ? [startSource]
          : [];
    const startEpochs = Object.fromEntries(
      candidates.map((candidate) => [candidate, startRuntime.sessionEpochs[candidate]])
    ) as Partial<Record<NotificationSource, number>>;
    const startIdentities = Object.fromEntries(
      candidates.map((candidate) => [candidate, startRuntime.identityKeys[candidate]])
    ) as Partial<Record<NotificationSource, string | undefined>>;
    const batchCurrent = () => {
      const latestRuntime = latestRuntimeRef.current;
      return (
        accountRetryRunRef.current === run &&
        accountRetryBatchScopeRef.current === accountRetryScope.batch &&
        focusManager.isFocused() &&
        latestRuntime.ready &&
        candidates.every(
          (candidate) =>
            latestRuntime.sessionEpochs[candidate] === startEpochs[candidate] &&
            (!startIdentities[candidate] || latestRuntime.identityKeys[candidate] === startIdentities[candidate])
        )
      );
    };
    try {
      for (const candidate of candidates) {
        if (!batchCurrent()) return;
        const latest = latestRetryStateRef.current;
        const latestRuntime = latestRuntimeRef.current;
        if (!latestRuntime.enabledNotificationSources.includes(candidate)) continue;
        if (latest.listQueryKey !== baselineKey) {
          baselineKey = latest.listQueryKey;
          baselineSeq = 0;
        }
        const session = latestRuntime.sessions[candidate];
        if (session.identityTrust === 'unknown') {
          await latest.retrySource(candidate, baselineSeq);
        } else if (startSource === 'all' && session.identityTrust === 'confirmed' && session.isLoggedIn) {
          await settleConfirmedAggregateSource(candidate, latestRuntime.sessionEpochs[candidate], baselineSeq);
        }
      }
    } finally {
      if (accountRetryRunRef.current === run) accountRetryRunRef.current = null;
    }
  }, [
    accountRetryBatchScopeRef,
    accountRetryScope,
    accountRetryScopeRef,
    latestRetryStateRef,
    latestRuntimeRef,
    listReads,
    settleConfirmedAggregateSource
  ]);
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
  const policyAccount = item.source === 'linuxdo' ? { identityKey, sessionEpoch: replySessionEpoch } : undefined;
  const policyState = useDiscoursePolicyState(policyAccount);
  const detailRead = {
    queryKey: detailQueryKey,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const topicId =
        item.target.type === 'topic' || item.target.type === 'topic-post' ? item.target.topicId : undefined;
      const observe =
        policyAccount && topicId ? captureDiscoursePolicyRead(queryClient, policyAccount, topicId, true) : undefined;
      const detail = await (detailReadTraceRef.current
        ? runtime.gateway.loadDetail(item, identityKey, signal, detailReadTraceRef.current)
        : runtime.gateway.loadDetail(item, identityKey, signal));
      return !signal.aborted && observe ? observe(detail) : detail;
    }
  };
  const detailQuery = useQuery({
    ...detailRead,
    subscribed: routeFocused,
    enabled: canAccessSource && routeFocused,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval:
      nodeSeekConversation && routeFocused && canAccessSource && !runtime.getReadBlock(item.source) ? 60_000 : false,
    refetchIntervalInBackground: false
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
    const exactCurrent = () =>
      current() && detailRecoveryScopeRef.current.runtime.identityKeys[item.source] === identityKey;
    const recovery: ReadRecovery = {
      queryKey: detailQueryKey,
      explicit: true,
      isCurrent: exactCurrent,
      cancel: () => {
        if (detailRecoveries.current(intent)) detailRecoveries.cancel();
      },
      resume: async (signal) => {
        const resumeTrace = beginDiagnosticTrace('source', 'notification-detail-resume', {
          source: item.source,
          parentTraceId: trace.traceId,
          state: 'resuming',
          generation: replySessionEpoch
        });
        try {
          if (!exactCurrent() || signal?.aborted) {
            finishDiagnosticTrace(resumeTrace, 'stale', { source: item.source, reason: 'stale' });
            return 'stale';
          }
          if (!signal) runtime.clearReadBlock(item.source, replySessionEpoch);
          detailReadTraceRef.current ??= resumeTrace;
          const result = signal
            ? await resumeExactQuery(queryClient, detailRead, exactCurrent, signal)
            : await detailQuery
                .refetch({ cancelRefetch: false })
                .then((read) =>
                  read.error ? { kind: 'failed' as const, error: read.error } : { kind: 'success' as const }
                );
          if (result.kind === 'stale' || signal?.aborted || !exactCurrent()) {
            const canceled = signal?.aborted || intent.controller.signal.aborted;
            finishDiagnosticTrace(resumeTrace, canceled ? 'canceled' : 'stale', {
              source: item.source,
              reason: canceled ? 'canceled' : 'stale'
            });
            return 'stale';
          }
          if (signal) detailRecoveryScopeRef.current.runtime.clearReadBlock(item.source, replySessionEpoch);
          if (result.kind === 'failed') {
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
  const [policyRequest, setPolicyRequest] = useState<PolicyOperationSnapshot>(null);
  const [policies] = useState(() =>
    createDiscoursePolicyOperation({
      isCurrentScope: (scope) => policyScopeRef.current === scope,
      publish: setPolicyRequest
    })
  );
  const policyBusy = policyRequestBusy(policyRequest);
  const policyRecord = policy ? policyState[policy.postId] : undefined;
  const policyMarker = policyRecord?.phase === 'awaiting-readback' ? policyRecord.receipt : undefined;
  const policyBlocked = policy ? selectDiscoursePolicyWriteBlock(policyState, policy) : undefined;
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
  useEffect(() => {
    setPolicyError('');
    return policies.cancel;
  }, [identityKey, item.id, policy?.postId, policy?.version, replySessionEpoch, policies]);
  useEffect(() => {
    if (routeFocused && canAccessSource) return;
    policies.cancel();
  }, [canAccessSource, routeFocused, policies]);
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
      !policyAccount ||
      !routeFocused ||
      !focusManager.isFocused() ||
      !canAccessSource ||
      detailQuery.isError ||
      readDiscoursePolicyWriteBlock(queryClient, policyAccount, policy) ||
      policies.hasRequest() ||
      (accepted ? !policy.canAccept : !policy.canRevoke)
    )
      return;
    const run = policies.claim({ scope: policyScope, busyDuringConfirmation: false });
    if (!run) return;
    const controller = run.controller;
    const current = () => policies.owns(run);
    const submit = async () => {
      if (readDiscoursePolicyWriteBlock(queryClient, policyAccount, policy)) {
        policies.cancelRun(run);
        return;
      }
      if (!policies.beginSend(run)) return;
      setPolicyError('');
      try {
        const result = await gateway.setPolicyAcceptance(item, policy, accepted, identityKey, controller.signal, () => {
          if (!current() || readDiscoursePolicyWriteBlock(queryClient, policyAccount, policy)) {
            throw new Error('公告状态已变化，请刷新后重试');
          }
        });
        if (!current()) return;
        if (result.confirmed) {
          recordDiscoursePolicyReceipt(queryClient, policyAccount, {
            postId: policy.postId,
            version: policy.version,
            accepted
          });
        } else setPolicyError(result.message || '原站未确认操作结果，请先重试读取消息核对状态。');
        const refreshed = await detailQuery.refetch();
        if (!current()) return;
        if (
          !refreshed.isError &&
          refreshed.data?.policy?.postId === policy.postId &&
          refreshed.data.policy.version === policy.version &&
          refreshed.data.policy.accepted === accepted
        ) {
          setPolicyError('');
        }
      } catch (error) {
        if (current()) setPolicyError(errorMessage(error));
      } finally {
        policies.finish(run);
      }
    };
    if (accepted) void submit();
    else {
      let awaitingConfirmation = true;
      const cancelConfirmation = () => {
        if (!awaitingConfirmation) return;
        awaitingConfirmation = false;
        if (current()) {
          policies.cancelRun(run);
        }
      };
      Alert.alert(
        '撤销阅读确认',
        '撤销后，原站可能再次提醒你阅读这条公告。',
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: cancelConfirmation
          },
          {
            text: '撤销确认',
            style: 'destructive',
            onPress: () => {
              if (!awaitingConfirmation) return;
              awaitingConfirmation = false;
              void submit();
            }
          }
        ],
        { cancelable: true, onDismiss: cancelConfirmation }
      );
    }
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
                (error.serverRejected !== false && isDefinitiveHttpRejection(error.status)));
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
      policyDisabled={!canAccessSource || !routeFocused || detailQuery.isError || Boolean(policyBlocked)}
      policyError={
        policyMarker && detailQuery.isError ? '暂时无法读取原站最新状态，请重试读取消息后核对。' : policyError
      }
      policyStatus={
        policyMarker
          ? policyMarker.accepted
            ? '阅读确认已提交，正在核对原站状态。'
            : '撤销确认已提交，正在核对原站状态。'
          : policyBlocked && '请刷新公告核对阅读状态。'
      }
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
  const latestRuntimeRef = useCommittedRef(runtime);
  const mountedRef = useRef(true);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const focusedSettingsVisit = useRef<object | null>(null);
  const pendingOptIn = useRef<object | null>(null);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );
  useFocusEffect(
    useCallback(() => {
      const visit = {};
      focusedSettingsVisit.current = visit;
      return () => {
        if (focusedSettingsVisit.current === visit) focusedSettingsVisit.current = null;
        pendingOptIn.current = null;
      };
    }, [])
  );
  const run = useCallback(
    (operation: (current: () => boolean) => Promise<unknown>) => {
      const visit = focusedSettingsVisit.current;
      if (!visit || running.current || !navigation.isFocused()) return;
      const current = () => focusedSettingsVisit.current === visit && navigation.isFocused();
      running.current = true;
      setBusy(true);
      void operation(current)
        .catch((error) => {
          if (current()) latestRuntimeRef.current.notify(errorMessage(error));
        })
        .finally(() => {
          running.current = false;
          if (mountedRef.current) setBusy(false);
        });
    },
    [latestRuntimeRef, navigation]
  );
  const notifyPermissionOutcome = useCallback(
    (outcome: NotificationOperationOutcome | boolean, enabled: boolean) => {
      if (!enabled || !mountedRef.current) return;
      if (typeof outcome === 'boolean') {
        if (outcome) return;
        const currentPermission =
          latestRuntimeRef.current.readPermissionState?.() ?? latestRuntimeRef.current.permission;
        runtime.notify(
          currentPermission === 'unavailable'
            ? '系统通知权限读取失败，已保留你的设置，请重试通知初始化'
            : '系统通知权限未开启，已保留你的设置'
        );
        return;
      }
      if (outcome.status === 'invalidated') return;
      if (outcome.status === 'permission-read-failed') {
        runtime.notify('系统通知权限读取失败，已保留你的设置，请重试通知初始化');
        return;
      }
      if (!outcome.granted) {
        runtime.notify('系统通知权限未开启，已保留你的设置');
      }
    },
    [latestRuntimeRef, runtime]
  );
  const toggleGlobal = useCallback(
    (enabled: boolean) => {
      const apply = () =>
        run(async (current) => {
          const outcome = await runtime.setGlobalEnabled(enabled);
          if (current()) notifyPermissionOutcome(outcome, enabled);
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
    [navigation, notifyPermissionOutcome, run, runtime]
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
      onRequestPermission={
        runtime.requestPermission
          ? () =>
              run(async (current) => {
                const outcome = await runtime.requestPermission?.();
                if (outcome && current()) notifyPermissionOutcome(outcome, true);
              })
          : undefined
      }
      onToggleGlobal={toggleGlobal}
      onToggleSource={(source, enabled) => run(() => runtime.setSourceEnabled(source, enabled))}
    />
  );
}
