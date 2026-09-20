import '@/platform/diagnostics/diagnosticBootstrap';
import { registerRootComponent } from 'expo';
import { File, Paths } from 'expo-file-system';
import { QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Permissions from 'expo-notifications/build/NotificationPermissionsModule';
import * as Notifications from 'expo-notifications';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { findNodeHandle, Linking, NativeModules, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { FlashListRef } from '@shopify/flash-list';
import WebView from 'react-native-webview';
import {
  LINUXDO_BROWSER_FETCH_SCRIPT,
  NODESEEK_BROWSER_FETCH_SCRIPT,
  useHiddenBrowserFetchController
} from '@/features/account/useHiddenBrowserFetchController';
import { useUserController } from '@/features/user/useUserController';
import { useNotificationsRuntime } from '@/features/notifications/useNotificationsRuntime';
import { appQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import {
  accountSessionSnapshotFromObservation,
  createAccountSessionSnapshot,
  createAccountSessionViewModel
} from '@/domain/session/siteSessionState';
import { createReadGateway } from '@/sources/readGateway';
import {
  defaultNotificationState,
  NOTIFICATION_STORAGE_KEY,
  loadNotificationState,
  saveNotificationState,
  recordNotificationSnapshot,
  recordNotificationDelivery,
  clearNotificationSourceForContentDisable,
  resetNotificationSourceIdentity
} from '@/platform/notifications/notificationStore';
import {
  runNotificationBackgroundWorker,
  notificationIdentifiersForIdentity
} from '@/platform/notifications/notificationWorker';
import {
  notificationPermissionGranted,
  presentSourceNotification,
  reconcileSourceNotificationSlots,
  dismissSourceNotificationExact
} from '@/platform/notifications/notificationSystem';
import { diagnosticBuildContext } from '@/platform/diagnostics/nativeDiagnosticJournal';
import { laneFor, userResponses } from '../../tests/fixtures/userActivityEvidence';
import type { Source, Topic } from '@/domain/forum/models';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { useFeedController } from '@/features/feed/useFeedController';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { useVerificationController } from '@/features/account/useVerificationController';
import type { AccountReconcileResult, LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import { withRequestBeforeSend } from '@/platform/network/request';
import { validateWritableSessionTicket, type SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { buildDiscourseActionRequest } from '@/sources/discourse/actionRequest';
import { AcceptanceProof } from './acceptance';
import { PlatformExportsProof } from './platformExports';
import { verifyNotificationQuality } from './notificationQuality';
import { prepareBackgroundProof } from './background';

// Isolated developer entry only. Synthetic payloads test boundaries, never upstream protocol claims.
// HTTP fixtures use the supplied fetcher; the platform-export route uses an instrumentation-owned loopback server.
// WebView uses inline documents with no remote resources.
const delay = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function until(test: () => unknown, message: string) {
  const deadline = Date.now() + 20000;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(message);
    await delay();
  }
}
function deferred() {
  let release: () => void = () => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function HookProbe<T>({ useValue, observe }: { useValue: () => T; observe: (value: T) => void }) {
  const value = useValue();
  useLayoutEffect(() => observe(value));
  return null;
}
type BrowserResult = { html?: string; body?: string; challenge?: boolean; error?: string };
function BrowserProbe({
  source,
  body,
  html,
  observe
}: {
  source: 'nodeseek' | 'linuxdo';
  body: string;
  html?: string;
  observe: (value: BrowserResult) => void;
}) {
  const webview = useRef<WebView>(null);
  const handlers = useHiddenBrowserFetchController({
    completeLinuxDoBrowserFetch: observe,
    completeNodeSeekBrowserFetch: observe
  });
  const script =
    source === 'nodeseek'
      ? NODESEEK_BROWSER_FETCH_SCRIPT.replaceAll('__NODESEEK_BROWSER_FETCH_ID__', '42').replaceAll(
          '__NODESEEK_BROWSER_FETCH_OWNER__',
          '"user"'
        )
      : LINUXDO_BROWSER_FETCH_SCRIPT.replaceAll('__LINUXDO_BROWSER_FETCH_ID__', '42');
  const escaped = body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return (
    <WebView
      ref={webview}
      style={{ height: 180 }}
      originWhitelist={['*']}
      source={{
        html:
          html ||
          `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"></head><body><pre>${escaped}</pre></body></html>`,
        baseUrl: source === 'nodeseek' ? 'https://www.nodeseek.com/api/proof' : 'https://linux.do/proof.json'
      }}
      onLoadEnd={() => {
        webview.current?.injectJavaScript(script);
        // NodeSeek explicitly owns repeat-injection suppression; LinuxDo is injected once in production.
        if (source === 'nodeseek') webview.current?.injectJavaScript(script);
      }}
      onMessage={
        source === 'nodeseek' ? handlers.handleNodeSeekBrowserFetchMessage : handlers.handleLinuxDoBrowserFetchMessage
      }
    />
  );
}

async function execute(token: string, mount: (node: ReactNode) => void, status: (text: string) => void) {
  check((await AsyncStorage.getItem('reader-storage-proof-owner')) === 'isolated', 'Refusing unowned device storage');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Uncontrolled network denied by isolated proof');
  };
  const originalNotificationState = await AsyncStorage.getItem(NOTIFICATION_STORAGE_KEY);
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const write = (checkpoint: string) => {
    const file = new File(Paths.cache, 'review-remediation-proof.json');
    file.create({ overwrite: true });
    file.write(
      JSON.stringify({
        ...diagnosticBuildContext(),
        token,
        checkpoint,
        isDev: __DEV__,
        isHermes: 'HermesInternal' in globalThis,
        results
      })
    );
    status(`${checkpoint}: ${results.length} checks`);
  };
  const run = async (name: string, task: () => Promise<void>) => {
    try {
      await task();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      mount(null);
      await delay(80);
      appQueryClient.clear();
      write('running');
    }
  };
  async function hook<T>(useValue: () => T) {
    let current: T | undefined;
    mount(
      <HookProbe
        useValue={useValue}
        observe={(value) => {
          current = value;
        }}
      />
    );
    await until(() => current !== undefined, 'Hook did not mount');
    return () => {
      check(current !== undefined, 'Missing hook observation');
      return current;
    };
  }
  try {
    for (const source of ['nodeseek', 'linuxdo'] as const) {
      for (const [name, body] of [
        ['short', JSON.stringify({ boundary: '小😀文'.repeat(300) })],
        ['long-unicode', JSON.stringify({ boundary: '中😀文'.repeat(6000), tail: 'complete' })],
        ['cf-words', JSON.stringify({ boundary: 'Just a moment cf-turnstile challenge-platform', tail: 'complete' })],
        ['over-envelope', JSON.stringify({ boundary: 'x'.repeat(900001) })]
      ]) {
        await run(`webview-${source}-${name}`, async () => {
          const messages: BrowserResult[] = [];
          mount(<BrowserProbe source={source} body={body} observe={(value) => messages.push(value)} />);
          await until(() => messages.length > 0, 'WebView bridge did not respond');
          await delay(600);
          check(messages.length === 1, 'Request completed more than once');
          const result = messages[0];
          if (name === 'over-envelope')
            check(Boolean(result.error) && !(result.html || result.body), 'Oversized document was returned as success');
          else
            check(
              !result.error && !result.challenge && (result.html || result.body) === body,
              'JSON body changed or was classified as challenge'
            );
        });
      }
      await run(`webview-${source}-challenge`, async () => {
        const messages: BrowserResult[] = [];
        // Same structural challenge oracle as hidden-browser-scripts; no challenge network is contacted.
        mount(
          <BrowserProbe
            source={source}
            body=""
            html={
              '<html><head><title>Just a moment...</title></head><body><h1>Just a moment...</h1><div id="challenge-running"></div></body></html>'
            }
            observe={(value) => messages.push(value)}
          />
        );
        await until(() => messages.length > 0, 'Challenge bridge did not respond');
        await delay(600);
        check(
          messages.length === 1 && messages[0].challenge && !(messages[0].html || messages[0].body),
          'Challenge reported readable content'
        );
      });
    }
    for (const source of ['nodeseek', 'linuxdo', 'v2ex', 'yaohuo'] as const) {
      for (const failedLane of ['topics', 'replies'] as const) {
        await run(`user-${source}-${failedLane}-failure-retry-refresh`, async () => {
          const responses = userResponses(source, false);
          let failure: string | undefined = failedLane;
          const requests: string[] = [];
          const fetcher = async (url: string) => {
            requests.push(url);
            if (laneFor(url) === failure) return new Response('Injected HTTP failure', { status: 503 });
            if (url.includes('/feed/member/')) return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
            return new Response(responses[laneFor(url)]);
          };
          const gateway = userGateway(source, fetcher);
          const get = await hook(function useValue() {
            return useUserController(userOptions(source, gateway));
          });
          const other = failedLane === 'topics' ? 'replies' : 'topics';
          const error = () => (failedLane === 'topics' ? get().userTopicsError : get().userRepliesError);
          await until(
            () => get().userProfile?.[other]?.length === 1 && error(),
            'Failed lane or healthy lane not settled'
          );
          check(get().userProfile?.[failedLane] === undefined, 'Failure seeded fake empty success');
          const before = requests.length;
          failure = undefined;
          await (failedLane === 'topics' ? get().retryUserTopics() : get().retryUserReplies());
          await until(
            () => get().userProfile?.[failedLane]?.length === 1 && !error(),
            'Independent retry did not recover'
          );
          check(!requests.slice(before).some((url) => laneFor(url) === other), 'Retry reread healthy lane');
          const trusted = JSON.stringify(get().userProfile?.[failedLane]);
          failure = failedLane;
          await get().refreshUser();
          await until(error, 'Failed refresh not exposed');
          check(JSON.stringify(get().userProfile?.[failedLane]) === trusted, 'Failed refresh replaced trusted data');
        });
      }
    }
    for (const order of ['page-first', 'refresh-first']) {
      await run(`user-race-${order}`, async () => {
        const page = deferred();
        const refresh = deferred();
        let pageStarted = false;
        let refreshStarted = false;
        let refreshing = false;
        const fetcher = async (url: string) => {
          if (url.includes('getInfo')) {
            if (refreshing) {
              refreshStarted = true;
              await refresh.promise;
            }
            return new Response(
              JSON.stringify({ success: true, detail: { member_id: 7, member_name: 'alice', nPost: 30, nComment: 0 } })
            );
          }
          if (url.includes('list-comments')) return new Response('{"success":true,"comments":[]}');
          if (new URL(url).searchParams.get('page') === '2') {
            pageStarted = true;
            await page.promise;
            return new Response(JSON.stringify({ success: true, discussions: [{ post_id: 999, title: 'late page' }] }));
          }
          // Boundary fixtures use only already-evidenced NodeSeek fields.
          return new Response(
            JSON.stringify({
              success: true,
              discussions: Array.from({ length: 15 }, (_, index) => ({
                post_id: (refreshing ? 100 : 1) + index,
                title: refreshing ? 'fresh' : 'old'
              }))
            })
          );
        };
        const gateway = userGateway('nodeseek', fetcher);
        const get = await hook(function useValue() {
          return useUserController(userOptions('nodeseek', gateway));
        });
        await until(() => get().userProfile?.topics?.length === 15, 'Initial page not loaded');
        const paging = get().loadMoreUserTopics();
        await until(() => pageStarted, 'Next page not started');
        refreshing = true;
        const refreshingPromise = get().refreshUser();
        await until(() => refreshStarted, 'Refresh did not start');
        if (order === 'page-first') {
          page.release();
          await paging;
          refresh.release();
          await refreshingPromise;
        } else {
          refresh.release();
          await refreshingPromise;
          page.release();
          await paging;
        }
        await until(() => get().userProfile?.topics?.[0]?.id === '100', 'Fresh first page was overwritten');
        check(
          get().userProfile?.topics?.length === 15 && !get().userProfile?.topics?.some((topic) => topic.id === '999'),
          'Canceled old page leaked into refreshed list'
        );
      });
    }
    for (const outcome of ['success', 'failure']) {
      await run(`feed-native-host-cold-${outcome}`, async () => {
        const pending = deferred();
        let pendingStarted = false;
        const response = (title: string) =>
          new Response(
            JSON.stringify({
              topic_list: {
                topics: [{ id: 1, title, slug: 'sample', created_at: '2026-05-20T00:00:00Z', posts_count: 1 }]
              }
            })
          );
        const gateway = userGateway('linuxdo', async (url) => {
          if (url.includes('/new.json')) {
            pendingStarted = true;
            await pending.promise;
            return outcome === 'success'
              ? response('FRESH_PROOF_TOPIC')
              : new Response('Injected failure', { status: 503 });
          }
          return response('INITIAL_PROOF_TOPIC');
        });
        const scrollRef: { current: FlashListRef<Topic> | null } = { current: null };
        let current: ReturnType<typeof useFeedController> | undefined;
        const get = () => {
          check(current, 'Feed not mounted');
          return current;
        };
        mount(
          <FeedProbe
            gateway={gateway}
            scrollRef={scrollRef}
            observe={(value) => {
              current = value;
            }}
          />
        );
        await until(() => current?.shownFeedItems.length && scrollRef.current, 'Initial native Feed not mounted');
        get().changeFeedSource('linuxdo');
        await until(
          () => current?.feedSource === 'linuxdo' && !current.feedBusy && scrollRef.current,
          'Source Feed not ready'
        );
        await delay(200);
        const before = findNodeHandle(scrollRef.current?.getNativeScrollRef() ?? null);
        check(before, 'No native FlashList host');
        get().setFeedFilter('new-topics');
        await until(() => pendingStarted && current?.feedBusy, 'Cold filter did not wait for HTTP');
        await delay(200);
        check(get().shownFeedItems.length === 0, 'Cold pending filter displayed stale rows');
        const pendingHost = findNodeHandle(scrollRef.current?.getNativeScrollRef() ?? null);
        check(pendingHost === before, `Cold pending filter replaced native list host: ${before} -> ${pendingHost}`);
        pending.release();
        await until(() => !get().feedBusy, 'Filter did not settle');
        await delay(200);
        check(
          findNodeHandle(scrollRef.current?.getNativeScrollRef() ?? null) === before,
          'Filter result replaced native list host'
        );
        check(
          outcome === 'success'
            ? get().shownFeedItems[0]?.title === 'FRESH_PROOF_TOPIC'
            : get().shownFeedItems.length === 0,
          'Filter displayed stale rows'
        );
      });
    }
    for (const mode of ['cancel-reopen', 'inactive', 'scope-change', 'unmount']) {
      await run(`verification-core-${mode}`, async () => {
        const handoff = deferred();
        let handoffStarted = false;
        let resumed = 0;
        const control = {
          active: true,
          scope: 'linuxdo:7:0',
          handoff: async () => {
            handoffStarted = true;
            if (mode !== 'cancel-reopen') await handoff.promise;
          }
        };
        const get = await hook(function useValue() {
          return useRecoveryProbe(control);
        });
        const recovery = (): LinuxDoReadRecovery => ({
          queryKey: ['device-proof', mode],
          isCurrent: () => control.active,
          resume: async () => {
            resumed += 1;
            return 'completed';
          }
        });
        check(await get().showLinuxDoVerification('controlled proof', recovery()), 'Verification did not open');
        if (mode === 'cancel-reopen') {
          get().closeLinuxDoPanel();
          check(
            await get().showLinuxDoVerification('controlled reopen', recovery()),
            'Canceled verification could not reopen'
          );
          await get().checkLinuxDoCookie();
          await get().checkLinuxDoCookie();
          check(resumed === 1, 'Current recovery was not resumed exactly once');
        } else {
          const checking = get().checkLinuxDoCookie();
          await until(() => handoffStarted, 'Cookie handoff not reached');
          if (mode === 'inactive') control.active = false;
          if (mode === 'scope-change') control.scope = 'linuxdo:8:1';
          if (mode === 'unmount') {
            mount(null);
            await delay(100);
          }
          handoff.release();
          await checking;
          check(resumed === 0, 'Invalid recovery resumed its old request');
        }
        get().closeLinuxDoPanel();
        handoff.release();
      });
    }
    for (const invalidation of ['identity', 'epoch', 'source', 'surface'] as const) {
      await run(`write-csrf-${invalidation}`, async () => {
        const csrf = deferred();
        let entered = false;
        let writes = 0;
        const snapshot: SessionRuntimeSnapshot = {
          source: 'linuxdo',
          authenticated: true,
          authSurfaceOpen: false,
          identityKey: 'linuxdo:7',
          identityTrust: 'confirmed',
          sessionEpoch: 0,
          sourceEnabled: true
        };
        const ticket = { source: 'linuxdo' as const, identityKey: 'linuxdo:7', sessionEpoch: 0 };
        const fetcher = withRequestBeforeSend(
          async (url) => {
            if (url.endsWith('/session/csrf')) {
              entered = true;
              await csrf.promise;
              return new Response('{"csrf":"isolated-fixture"}');
            }
            writes += 1;
            return new Response('{}');
          },
          () => check(validateWritableSessionTicket(ticket, snapshot), 'stale write ticket')
        );
        const pending = runLinuxDoAction({
          request: buildDiscourseActionRequest({ type: 'set-like', postId: '1', active: true }),
          fetcher
        }).then(
          () => false,
          () => true
        );
        await until(() => entered, 'CSRF did not start');
        if (invalidation === 'identity') snapshot.identityKey = 'linuxdo:8';
        if (invalidation === 'epoch') snapshot.sessionEpoch += 1;
        if (invalidation === 'source') snapshot.sourceEnabled = false;
        if (invalidation === 'surface') snapshot.authSurfaceOpen = true;
        csrf.release();
        check((await pending) && writes === 0, 'Stale action sent a side-effect request');
      });
    }
    await run('write-native-proxy-preparation', async () => {
      const module = NativeModules.NetworkProxyModule;
      check(typeof module?.applyProxy === 'function', 'Missing real Native proxy module');
      const original = module.applyProxy;
      const prepared = deferred();
      let entered = false;
      let writes = 0;
      let current = true;
      try {
        module.applyProxy = async (...args: unknown[]) => {
          entered = true;
          await prepared.promise;
          return original(...args);
        };
        const get = await hook(function useValue() {
          return useNetworkProxyRuntime({
            notify: () => undefined,
            baseFetcher: async () => {
              writes += 1;
              return new Response('{}');
            }
          });
        });
        await until(() => entered, 'Native proxy preparation not reached');
        const guarded = withRequestBeforeSend(get().networkProxyFetcher, () => check(current, 'stale write ticket'));
        const pending = guarded('https://linux.do/post_actions', { method: 'POST' }).then(
          () => false,
          () => true
        );
        current = false;
        prepared.release();
        check((await pending) && writes === 0, 'Proxy preparation sent a stale write');
      } finally {
        prepared.release();
        module.applyProxy = original;
      }
    });
    await run('write-confirmed-response-after-invalidation', async () => {
      let current = true;
      let requests = 0;
      const fetcher = withRequestBeforeSend(
        async (url) => {
          requests += 1;
          if (url.endsWith('/session/csrf')) return new Response('{"csrf":"isolated-fixture"}');
          current = false;
          return new Response('{}');
        },
        () => check(current, 'stale write ticket')
      );
      await runLinuxDoAction({
        request: buildDiscourseActionRequest({ type: 'set-like', postId: '1', active: true }),
        fetcher
      });
      check(requests === 2 && !current, 'Confirmed response was retried or post-validated');
    });
    const sessions = {
      nodeseek: createAccountSessionViewModel(
        accountSessionSnapshotFromObservation(createAccountSessionSnapshot('nodeseek'), {
          session: {
            site: 'nodeseek',
            status: 'logged-in',
            cookieSummary: [],
            isVerifying: false,
            currentUser: { source: 'nodeseek', id: '7', username: 'alice', url: 'https://www.nodeseek.com/space/7' }
          }
        })
      ),
      linuxdo: createAccountSessionViewModel(createAccountSessionSnapshot('linuxdo')),
      yaohuo: createAccountSessionViewModel(createAccountSessionSnapshot('yaohuo'))
    };
    const notificationOptions = {
      appActive: false,
      contentSourcesReady: true,
      enabledNotificationSources: ['nodeseek', 'linuxdo', 'yaohuo'] as const,
      fetcher: async () => {
        throw new Error('Unexpected notification network');
      },
      getLinuxDoUserAgent: () => '',
      getNodeSeekUserAgent: () => '',
      onSessionExpired: () => undefined,
      openSource: () => false,
      privateAccessAllowed: () => false,
      remoteReady: false,
      sessionEpochs: initialForumSessionEpochs,
      sessions
    };
    const state = defaultNotificationState();
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['kept'],
      unreadCount: 80
    };
    for (const mode of ['storage-retry', 'permission-error', 'permission-denied', 'unmount-late']) {
      await run(`notification-${mode}`, async () => {
        await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(state));
        const originalGet = AsyncStorage.getItem;
        const originalPermission = Permissions.getPermissionsAsync;
        const paused = deferred();
        let rejectStorage = mode === 'storage-retry';
        let reads = 0;
        try {
          AsyncStorage.getItem = async (key) => {
            if (key === NOTIFICATION_STORAGE_KEY) {
              reads += 1;
              if (rejectStorage) throw new Error('Injected storage read error');
              if (mode === 'unmount-late') await paused.promise;
            }
            return originalGet.call(AsyncStorage, key);
          };
          if (mode === 'permission-error')
            Permissions.getPermissionsAsync = async () => {
              throw new Error('Injected platform permission error');
            };
          const get = await hook(function useValue() {
            return useNotificationsRuntime(notificationOptions);
          });
          if (mode === 'storage-retry') {
            await until(
              () => get().initializationError && !get().ready && get().permission !== 'checking',
              'Storage error not surfaced'
            );
            let rejected = false;
            try {
              await get().setGlobalEnabled(false);
            } catch {
              rejected = true;
            }
            check(
              rejected && (await originalGet.call(AsyncStorage, NOTIFICATION_STORAGE_KEY)) === JSON.stringify(state),
              'Failed initialization overwrote state'
            );
            rejectStorage = false;
            const a = get().retryInitialization();
            const b = get().retryInitialization();
            check(a === b, 'Concurrent retries were not coalesced');
            await a;
            await until(() => get().ready && !get().initializationError, 'Initialization retry failed');
            check(
              reads === 2 &&
                get().state.sources.nodeseek.unreadCount === 80 &&
                get().state.sources.nodeseek.deliveredIds[0] === 'kept',
              'Stored watermark/settings changed'
            );
          } else if (mode === 'permission-error') {
            await until(
              () => get().ready && get().permission === 'unavailable',
              'Permission error blocked storage or looked denied'
            );
            check(
              Boolean(get().initializationError) &&
                !get().backgroundEnabled &&
                get().state.sources.nodeseek.unreadCount === 80,
              'Unknown permission enabled delivery or lost state'
            );
          } else if (mode === 'permission-denied') {
            await until(() => get().ready && get().permission !== 'checking', 'Native permission probe did not settle');
            check(
              get().permission === 'denied' && !get().initializationError && !get().backgroundEnabled,
              'Native permission denial was confused with a probe error'
            );
          } else {
            await until(() => reads === 1, 'Storage read not started');
            mount(null);
            await delay(100);
            paused.release();
            await delay(150);
            check(
              !get().ready && (await loadNotificationState()).sources.nodeseek.unreadCount === 80,
              'Unmounted initialization committed late result'
            );
          }
        } finally {
          paused.release();
          AsyncStorage.getItem = originalGet;
          Permissions.getPermissionsAsync = originalPermission;
        }
      });
    }
    // The guarded runner grants this permission only on the named isolated AVD, then restores its prior state.
    write('grant-notifications');
    const permissionDeadline = Date.now() + 15000;
    while (!(await notificationPermissionGranted())) {
      check(Date.now() < permissionDeadline, 'Runner did not grant isolated notification permission');
      await delay(100);
    }
    for (const mode of ['total-80', 'total-1', 'native-failure', 'store-failure', 'identity-change']) {
      await run(`notification-worker-${mode}`, async () => {
        const identityKey = 'nodeseek:7';
        const state = defaultNotificationState();
        state.globalEnabled = true;
        state.sources.nodeseek = {
          ...state.sources.nodeseek,
          intentEnabled: true,
          identityKey,
          baselineReady: true,
          deliveredIds: ['old']
        };
        await saveNotificationState(state);
        const total = mode === 'total-1' ? 1 : 80;
        await recordNotificationSnapshot('nodeseek', identityKey, total, '2026-09-16T00:00:00.000Z');
        let activeIdentity = identityKey;
        let pageRequests = 0;
        let nativeFailureSeen = false;
        let storeFailureSeen = false;
        const originalSet = AsyncStorage.setItem;
        try {
          if (mode === 'store-failure')
            AsyncStorage.setItem = async (key, value) => {
              if (
                !storeFailureSeen &&
                key === NOTIFICATION_STORAGE_KEY &&
                JSON.parse(value).sources?.nodeseek?.notificationIdentifier
              ) {
                storeFailureSeen = true;
                throw new Error('Injected delivery storage failure');
              }
              return originalSet.call(AsyncStorage, key, value);
            };
          const result = await runNotificationBackgroundWorker({
            sources: ['nodeseek'],
            sourceAllowed: () => true,
            privateAccessAllowed: (_source, identity) => identity === activeIdentity,
            network: {
              restoreProxy: async () => undefined,
              probeAccess: async () => ({ identityKey, userId: '7' }),
              listPage: async () => {
                pageRequests += 1;
                return {
                  quality: 'complete',
                  items: Array.from({ length: 60 }, (_, index) => ({
                    source: 'nodeseek' as const,
                    id: String(index),
                    kind: 'reply' as const,
                    actor: { name: '设备测试' },
                    title: '合成消息',
                    createdAt: null,
                    unread: mode !== 'total-1',
                    target: { type: 'information' as const }
                  })),
                  cursor: 'next',
                  hasMore: true
                };
              }
            },
            store: {
              load: loadNotificationState,
              record: recordNotificationDelivery,
              clearForContentDisable: clearNotificationSourceForContentDisable
            },
            system: {
              permissionGranted: notificationPermissionGranted,
              reconcileDigests: reconcileSourceNotificationSlots,
              presentDigest: async (source, digest, identifier) => {
                if (mode === 'native-failure') {
                  nativeFailureSeen = true;
                  throw new Error('Injected Native presentation failure');
                }
                const value = await presentSourceNotification(source, digest, identifier);
                if (mode === 'identity-change') {
                  activeIdentity = 'nodeseek:8';
                  await resetNotificationSourceIdentity('nodeseek', activeIdentity);
                }
                return value;
              },
              dismissDigest: (_source, identifier) => dismissSourceNotificationExact(identifier)
            }
          });
          const persisted = (await loadNotificationState()).sources.nodeseek;
          check(pageRequests === 1, 'Scan exceeded the 60-item bound');
          if (mode === 'identity-change')
            check(
              persisted.identityKey === activeIdentity && persisted.deliveredIds.length === 0,
              'Old delivery polluted the new identity'
            );
          else check(persisted.unreadCount === total, 'Scan sample overwrote authoritative total');
          if (mode === 'native-failure' || mode === 'store-failure')
            check(
              result.failedSources === 1 &&
                persisted.deliveredIds.join('|') === 'old' &&
                (nativeFailureSeen || storeFailureSeen),
              'Delivery failure committed its watermark'
            );
          const presented = await Notifications.getPresentedNotificationsAsync();
          const identifiers = notificationIdentifiersForIdentity('nodeseek', identityKey);
          const visible = presented.filter((item) => identifiers.includes(item.request.identifier));
          if (mode === 'total-80')
            check(
              result.delivered === 60 &&
                visible.length === 1 &&
                persisted.notificationIdentifier === visible[0].request.identifier,
              'Successful digest did not reach Android'
            );
          else check(visible.length === 0, 'Failed/stale/no-unread delivery left a visible digest');
        } finally {
          AsyncStorage.setItem = originalSet;
          for (const identifier of notificationIdentifiersForIdentity('nodeseek', identityKey))
            await dismissSourceNotificationExact(identifier);
        }
      });
    }
    for (const quality of ['partial', 'invalid', 'legacy'] as const)
      await run(`notification-quality-${quality}`, () => verifyNotificationQuality(quality));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNotificationState === null) await AsyncStorage.removeItem(NOTIFICATION_STORAGE_KEY);
    else await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, originalNotificationState);
    mount(null);
    appQueryClient.clear();
  }
  write(results.every((result) => result.passed) ? 'passed' : 'failed');
}

function userGateway(source: Source, fetcher: (url: string) => Promise<Response>) {
  return createReadGateway({
    fetcher,
    anonymousFetcher: fetcher,
    nodeSeekUserAgent: () => 'isolated-proof',
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
}
function userOptions(source: Source, readGateway: ReturnType<typeof createReadGateway>) {
  return {
    active: true,
    notify: () => undefined,
    readerData: createEmptyReaderData(),
    readGateway,
    showLinuxDoVerification: () => undefined,
    showNodeSeekVerification: () => undefined,
    showYaohuoLogin: () => undefined,
    user: { source, id: '7', username: 'alice', url: 'https://example.invalid/isolated-user' }
  };
}
const proofReader = createEmptyReaderData();
const proofStyle = { settings: proofReader.settings, theme: createTheme(proofReader.settings) };
const feedReader = {
  ...proofReader,
  settings: {
    ...proofReader.settings,
    contentSources: proofReader.settings.contentSources.map((item) => ({ ...item, enabled: item.source === 'linuxdo' }))
  }
};
function FeedProbe({
  gateway,
  scrollRef,
  observe
}: {
  gateway: ReturnType<typeof createReadGateway>;
  scrollRef: { current: FlashListRef<Topic> | null };
  observe: (value: ReturnType<typeof useFeedController>) => void;
}) {
  const controller = useFeedController({
    enabledSources: ['linuxdo'],
    enabledSourcesKey: 'linuxdo',
    active: true,
    catalogCategories: [],
    linuxDoVerificationActive: false,
    notify: () => undefined,
    readerData: feedReader,
    readerDataLoaded: true,
    showLinuxDoVerification: () => undefined,
    showNodeSeekVerification: () => undefined,
    showYaohuoLogin: () => undefined,
    readGateway: gateway
  });
  useLayoutEffect(() => observe(controller));
  return (
    <FeedScreen
      busy={controller.feedBusy}
      categories={controller.feedCategories}
      categoryFilter={controller.categoryFilter}
      feedHasMore={controller.activeFeedState.hasMore}
      feedItems={controller.shownFeedItems}
      feedOutcomeKind={controller.feedOutcomeKind}
      feedPage={controller.activeFeedState.page}
      feedFilter={controller.feedFilter}
      feedFilters={controller.feedFilters}
      feedSource={controller.feedSource}
      enabledFeedSources={controller.enabledFeedSources}
      loadMoreFailureSignal={controller.activeFeedState.loadMoreFailureSignal}
      loadingMore={controller.activeFeedState.loadingMore}
      topicStateIndex={{ favorites: {}, history: {}, listDensity: proofReader.settings.listDensity }}
      readingFilter={controller.readingFilter}
      refreshing={controller.activeFeedState.refreshing}
      scrollRef={scrollRef}
      onCategoryChange={controller.setCategoryFilter}
      onFeedFilterChange={controller.setFeedFilter}
      onFeedSourceChange={controller.changeFeedSource}
      onManageContentSources={() => undefined}
      onLoadMore={() => undefined}
      onOpenTopic={() => undefined}
      onReadingFilterChange={controller.setReadingFilter}
      onRefresh={controller.refreshFeed}
    />
  );
}
function useRecoveryProbe(control: { active: boolean; scope: string; handoff: () => Promise<void> }) {
  const visible = useRef(false);
  return useVerificationController({
    awaitLinuxDoCookieHandoff: control.handoff,
    getRecoveryScope: () => control.scope,
    changeNodeSeekLoginPanel: () => undefined,
    checkingRequestIdRef: useRef(0),
    closeYaohuoLoginPanel: () => undefined,
    commitLinuxDoWebViewUserAgent: () => undefined,
    linuxDoPanelClosingSessionRef: useRef<number | null>(null),
    linuxDoPanelCloseSettleTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewMountTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewRef: useRef<WebView | null>(null),
    linuxDoWebViewSessionRef: useRef(0),
    isLinuxDoSurfaceVisible: () => visible.current,
    notify: () => undefined,
    onLoginWebViewFailure: () => undefined,
    onLinuxDoSurfaceClosed: () => {
      visible.current = false;
    },
    onLinuxDoSurfaceOpened: () => {
      visible.current = true;
    },
    prepareLinuxDoCookieResponseBarrier: async () => undefined,
    reconcileAccountStatus: async (): Promise<AccountReconcileResult> => ({
      status: 'same',
      session: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: { source: 'linuxdo', id: '7', username: 'alice', url: 'https://linux.do/u/alice' }
      }
    }),
    setChecking: () => undefined,
    setLinuxDoWebViewError: () => undefined,
    setLinuxDoWebViewKey: () => undefined,
    setLoadingLinuxDoPage: () => undefined,
    setMountLinuxDoWebView: () => undefined,
    updateLinuxDoSession: () => undefined,
    updateNodeSeekSession: () => undefined
  });
}
function ProofApp() {
  const [content, setContent] = useState<ReactNode>(null);
  const [status, setStatus] = useState('Isolated remediation proof');
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      const background = /^wzreviewproof:\/\/background\/(success|deadline|cleanup)\/([a-f0-9]{32})$/.exec(url || '');
      if (background) {
        void prepareBackgroundProof(background[1] as 'success' | 'deadline' | 'cleanup', background[2]).then(
          () => setStatus(`Background proof ${background[1]} ready`),
          (error: unknown) => setStatus(String(error))
        );
        return;
      }
      const exports = /^wzreviewproof:\/\/exports\/([a-f0-9]{32})$/.exec(url || '');
      if (exports) {
        setContent(<PlatformExportsProof token={exports[1]} />);
        return;
      }
      const acceptance = /^wzreviewproof:\/\/(boundaries|recovery|notification)\/([a-f0-9]{32})$/.exec(url || '');
      if (acceptance) {
        setContent(<AcceptanceProof mode={acceptance[1]} token={acceptance[2]} />);
        setStatus('Pro 修复专项设备验收');
        return;
      }
      const token = /^wzreviewproof:\/\/run\/([a-f0-9]{32})$/.exec(url || '')?.[1];
      if (token) void execute(token, setContent, setStatus).catch((error: unknown) => setStatus(String(error)));
    });
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ReaderStyleProvider value={proofStyle}>
          <QueryClientProvider client={appQueryClient}>
            <View style={{ flex: 1, paddingTop: 60 }}>
              <Text>{status}</Text>
              {content}
            </View>
          </QueryClientProvider>
        </ReaderStyleProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
registerRootComponent(ProofApp);
