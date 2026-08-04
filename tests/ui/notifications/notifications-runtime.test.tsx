import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { ToastAndroid } from 'react-native';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import { useNotificationsRuntime } from '@/features/notifications/useNotificationsRuntime';
import { defaultNotificationState } from '@/platform/notifications/notificationStore';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import {
  dismissSourceNotification,
  notificationPermissionGranted,
  replaceSourceNotification,
  requestNotificationPermission,
  syncNotificationBackgroundRegistration
} from '@/platform/notifications/notificationSystem';
import { runNotificationBackgroundWorker } from '@/platform/notifications/notificationWorker';
import { loadXiaoyinsiCredentials } from '@/sources/xiaoyinsi/auth';
import { QueryTestWrapper } from '../QueryTestWrapper';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined)
  }
}));

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  getLastNotificationResponseAsync: jest.fn(async () => null)
}));

jest.mock('@/sources/xiaoyinsi/auth', () => ({
  loadXiaoyinsiCredentials: jest.fn(async () => undefined)
}));

jest.mock('@/platform/notifications/notificationSystem', () => ({
  dismissSourceNotification: jest.fn(async () => undefined),
  notificationPermissionGranted: jest.fn(async () => false),
  openNotificationSystemSettings: jest.fn(async () => undefined),
  replaceSourceNotification: jest.fn(
    async (_source: string, _digest: unknown, _previousIdentifier: string | undefined, identifier: string) => identifier
  ),
  requestNotificationPermission: jest.fn(async () => false),
  syncNotificationBackgroundRegistration: jest.fn(async () => false)
}));

jest.mock('@/platform/notifications/notificationWorker', () => ({
  runNotificationBackgroundWorker: jest.fn(async () => ({
    status: 'success',
    delivered: 0,
    failedSources: 0,
    timedOut: false
  }))
}));

function notificationResponse(source: string, identifier: string, date: number): Notifications.NotificationResponse {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date,
      request: {
        identifier,
        content: {
          title: null,
          subtitle: null,
          body: null,
          data: { source },
          categoryIdentifier: null,
          sound: null
        },
        trigger: null
      }
    }
  };
}

function nodeSeekSessions(identityTrust: 'confirmed' | 'pending' | 'none', userId = '42') {
  const sessions = createSiteSessionViewModels(
    createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'nodeseek',
          id: userId,
          username: 'alice',
          url: `https://www.nodeseek.com/space/${userId}`,
          topics: []
        }
      }
    })
  );
  return {
    ...sessions,
    nodeseek: {
      ...sessions.nodeseek,
      canWrite: identityTrust === 'confirmed',
      identityTrust
    }
  };
}

function xiaoyinsiSessions() {
  return createSiteSessionViewModels(
    createSiteSessionStates({
      xiaoyinsi: {
        site: 'xiaoyinsi',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'xiaoyinsi',
          id: '7',
          username: 'temple-user',
          url: 'https://xiaoyinsi.net/u/temple-user',
          topics: []
        }
      }
    })
  );
}

function runtimeOptions(
  openSource = jest.fn(() => true),
  sessions = createSiteSessionViewModels(createSiteSessionStates())
) {
  return {
    appActive: false,
    authorizationRevision: 'idle',
    beginXiaoyinsiAuthorization: jest.fn(),
    fetcher: jest.fn(),
    getLinuxDoUserAgent: jest.fn(() => 'linux.do'),
    getNodeSeekUserAgent: jest.fn(() => 'NodeSeek'),
    openSource,
    sessions
  };
}

describe('notification runtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appQueryClient.clear();
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(null);
    jest.mocked(loadXiaoyinsiCredentials).mockResolvedValue(undefined);
    jest.mocked(notificationPermissionGranted).mockResolvedValue(false);
    jest.mocked(requestNotificationPermission).mockResolvedValue(false);
    jest
      .mocked(replaceSourceNotification)
      .mockImplementation(async (_source, _digest, _previousIdentifier, identifier) => identifier);
    jest.mocked(runNotificationBackgroundWorker).mockResolvedValue({
      status: 'success',
      delivered: 0,
      failedSources: 0,
      timedOut: false
    });
    jest.mocked(syncNotificationBackgroundRegistration).mockResolvedValue(false);
  });

  it('[REG-NOTIFY-001] keeps stored unread state without showing a native foreground toast', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek.unreadCount = 1;
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify(stored));
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);

    try {
      const hook = await renderHook(
        () =>
          useNotificationsRuntime({
            appActive: false,
            authorizationRevision: 'idle',
            beginXiaoyinsiAuthorization: jest.fn(),
            fetcher: jest.fn(),
            getLinuxDoUserAgent: jest.fn(() => 'linux.do'),
            getNodeSeekUserAgent: jest.fn(() => 'NodeSeek'),
            openSource: jest.fn(() => true),
            sessions: createSiteSessionViewModels(createSiteSessionStates())
          }),
        { wrapper: QueryTestWrapper }
      );

      await waitFor(() => expect(hook.result.current.unreadTotal).toBe(1));
      expect(toast).not.toHaveBeenCalled();
    } finally {
      toast.mockRestore();
    }
  });

  it('keeps identity keys stable when the session container changes without an identity change', async () => {
    let sessions = createSiteSessionViewModels(createSiteSessionStates());
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          appActive: false,
          authorizationRevision: 'idle',
          beginXiaoyinsiAuthorization: jest.fn(),
          fetcher: jest.fn(),
          getLinuxDoUserAgent: jest.fn(() => 'linux.do'),
          getNodeSeekUserAgent: jest.fn(() => 'NodeSeek'),
          openSource: jest.fn(() => true),
          sessions
        }),
      { wrapper: QueryTestWrapper }
    );
    const firstIdentityKeys = hook.result.current.identityKeys;

    sessions = createSiteSessionViewModels(createSiteSessionStates());
    await act(async () => {
      hook.rerender({});
    });

    expect(hook.result.current.identityKeys).toBe(firstIdentityKeys);
  });

  it('opens a warm Android notification response once and clears it', async () => {
    const openSource = jest.fn(() => true);
    await renderHook(() => useNotificationsRuntime(runtimeOptions(openSource)), { wrapper: QueryTestWrapper });

    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1));
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls[0]![0];
    const response = notificationResponse('nodeseek', 'warm-nodeseek', 1);

    await act(async () => {
      listener(response);
      listener(response);
    });

    expect(openSource).toHaveBeenCalledTimes(1);
    expect(openSource).toHaveBeenCalledWith('nodeseek');
    await waitFor(() => expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1));
  });

  it('opens a cold Android notification response once and clears duplicate delivery', async () => {
    const response = notificationResponse('linuxdo', 'cold-linuxdo', 2);
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(response);
    const openSource = jest.fn(() => true);
    await renderHook(() => useNotificationsRuntime(runtimeOptions(openSource)), { wrapper: QueryTestWrapper });

    await waitFor(() => expect(openSource).toHaveBeenCalledWith('linuxdo'));
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls[0]![0];
    await act(async () => listener(response));

    expect(openSource).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1));
  });

  it('keeps first opt-in intent but leaves background disabled when Android permission is denied', async () => {
    const hook = await renderHook(() => useNotificationsRuntime(runtimeOptions()), { wrapper: QueryTestWrapper });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    await act(async () => {
      await hook.result.current.setGlobalEnabled(true);
    });

    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toMatchObject({ globalEnabled: true, hasOptedIn: true });
    expect(hook.result.current.permission).toBe('denied');
    expect(hook.result.current.backgroundEnabled).toBe(false);
    expect(syncNotificationBackgroundRegistration).toHaveBeenLastCalledWith(
      expect.objectContaining({ globalEnabled: true, hasOptedIn: true }),
      false,
      []
    );
  });

  it('[REG-NOTIFY-006] retains the trusted identity, cache, and delivery watermark while identity is pending', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek = {
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:known']
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    const notificationCache = { items: ['cached'] };
    appQueryClient.setQueryData(forumQueryKeys.notifications('nodeseek'), notificationCache);

    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('pending')
          )
        ),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(hook.result.current.identityKeys.nodeseek).toBe('nodeseek:42'));
    expect(hook.result.current.activeSources).not.toContain('nodeseek');
    expect(hook.result.current.state.sources.nodeseek.deliveredIds).toEqual(['reply:known']);
    expect(appQueryClient.getQueryData(forumQueryKeys.notifications('nodeseek'))).toBe(notificationCache);
  });

  it('[REG-NOTIFY-020] reconciles other source identities while Xiaoyinsi credential loading is stalled', async () => {
    jest.mocked(loadXiaoyinsiCredentials).mockImplementation(() => new Promise(() => undefined));
    let persisted: string | null = null;
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed')
          )
        ),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await waitFor(() => expect(hook.result.current.state.sources.nodeseek.identityKey).toBe('nodeseek:42'));
  });

  it('[REG-NOTIFY-020] does not report background enabled for a legacy Xiaoyinsi-only credential', async () => {
    jest.mocked(loadXiaoyinsiCredentials).mockResolvedValue({
      apiKey: 'legacy-key',
      clientId: 'client-id',
      scopes: ['read', 'write']
    });
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.xiaoyinsi = {
      ...stored.sources.xiaoyinsi,
      intentEnabled: true,
      identityKey: 'xiaoyinsi:7'
    };
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));

    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            xiaoyinsiSessions()
          )
        ),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(hook.result.current.xiaoyinsiNeedsUpgrade).toBe(true));
    expect(hook.result.current.backgroundEnabled).toBe(false);
    expect(syncNotificationBackgroundRegistration).toHaveBeenLastCalledWith(expect.anything(), true, []);
  });

  it('[REG-NOTIFY-018] runs the shared delivery state machine after a foreground unread refresh', async () => {
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.nodeseek = {
      ...stored.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:old']
    };
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );

    await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed')
          ),
          appActive: true,
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalled());
    expect(runNotificationBackgroundWorker).toHaveBeenCalledWith(expect.objectContaining({ sources: ['nodeseek'] }));
    const dependencies = jest.mocked(runNotificationBackgroundWorker).mock.calls[0]![0];
    await dependencies.system.replaceDigest(
      'nodeseek',
      {
        title: 'NodeSeek',
        body: 'Alice 回复了你的主题',
        data: { source: 'nodeseek' }
      },
      undefined,
      'wz-message-nodeseek-nodeseek%3A42'
    );
    expect(replaceSourceNotification).toHaveBeenCalledTimes(1);
  });

  it('[REG-NOTIFY-026] does not suppress foreground delivery when snapshot persistence fails', async () => {
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.nodeseek = {
      ...stored.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:old']
    };
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );

    await renderHook(
      () =>
        useNotificationsRuntime({
          ...runtimeOptions(
            jest.fn(() => true),
            nodeSeekSessions('confirmed')
          ),
          appActive: true,
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() =>
      expect(runNotificationBackgroundWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: ['nodeseek']
        })
      )
    );
  });

  it('[REG-NOTIFY-025] still presents an Android notification while the message center is visible', async () => {
    jest.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const stored = defaultNotificationState();
    stored.globalEnabled = true;
    stored.hasOptedIn = true;
    stored.sources.nodeseek = {
      ...stored.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:old']
    };
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored));
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ atMe: 0, reply: 1, message: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    const appActive = true;
    const options = runtimeOptions(
      jest.fn(() => true),
      nodeSeekSessions('confirmed')
    );
    const hook = await renderHook(
      () =>
        useNotificationsRuntime({
          ...options,
          appActive,
          fetcher
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(runNotificationBackgroundWorker).toHaveBeenCalled());
    const dependencies = jest.mocked(runNotificationBackgroundWorker).mock.calls[0]![0];
    await act(async () => {
      hook.result.current.setCenterVisible(true);
    });

    await expect(
      dependencies.system.replaceDigest(
        'nodeseek',
        {
          title: 'NodeSeek',
          body: 'Alice 回复了你的主题',
          data: { source: 'nodeseek' }
        },
        undefined,
        'wz-message-nodeseek-nodeseek%3A42'
      )
    ).resolves.toBe('wz-message-nodeseek-nodeseek%3A42');
    expect(replaceSourceNotification).toHaveBeenCalledTimes(1);
  });

  it('[REG-NOTIFY-005] keeps a signed-in legacy Xiaoyinsi credential paused for upgrade without discarding identity state', async () => {
    jest.mocked(loadXiaoyinsiCredentials).mockResolvedValue({
      apiKey: 'legacy-key',
      clientId: 'client-id',
      scopes: ['read', 'write']
    });
    const stored = defaultNotificationState();
    stored.sources.xiaoyinsi = {
      intentEnabled: true,
      identityKey: 'xiaoyinsi:7',
      baselineReady: true,
      deliveredIds: ['reply:known']
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });

    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            xiaoyinsiSessions()
          )
        ),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(hook.result.current.xiaoyinsiNeedsUpgrade).toBe(true));
    expect(hook.result.current.identityKeys.xiaoyinsi).toBe('xiaoyinsi:7');
    expect(hook.result.current.activeSources).not.toContain('xiaoyinsi');
    expect(hook.result.current.state.sources.xiaoyinsi.deliveredIds).toEqual(['reply:known']);
  });

  it('clears the previous account watermark after a confirmed account switch', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek = {
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:known']
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    appQueryClient.setQueryData(forumQueryKeys.notifications('nodeseek'), { items: ['cached'] });

    let sessions = nodeSeekSessions('confirmed');
    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            sessions
          )
        ),
      { wrapper: QueryTestWrapper }
    );
    sessions = nodeSeekSessions('confirmed', '84');
    await act(async () => hook.rerender({}));

    await waitFor(() => expect(hook.result.current.state.sources.nodeseek.identityKey).toBe('nodeseek:84'));
    expect(hook.result.current.state.sources.nodeseek.deliveredIds).toEqual([]);
    expect(appQueryClient.getQueryData(forumQueryKeys.notifications('nodeseek'))).toBeUndefined();
  });

  it('[REG-NOTIFY-023] lets only the latest account reconciliation persist its identity', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek = {
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:known']
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    let releaseDismissal!: () => void;
    const dismissalBlocked = new Promise<void>((resolve) => {
      releaseDismissal = resolve;
    });
    let dismissalStarted!: () => void;
    const dismissalDidStart = new Promise<void>((resolve) => {
      dismissalStarted = resolve;
    });
    jest.mocked(dismissSourceNotification).mockImplementationOnce(async () => {
      dismissalStarted();
      await dismissalBlocked;
    });

    let sessions = nodeSeekSessions('confirmed', '42');
    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            sessions
          )
        ),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    sessions = nodeSeekSessions('confirmed', '84');
    await act(async () => hook.rerender({}));
    await dismissalDidStart;
    sessions = nodeSeekSessions('confirmed', '126');
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(hook.result.current.state.sources.nodeseek.identityKey).toBe('nodeseek:126'));

    releaseDismissal();
    await act(async () => {
      await dismissalBlocked;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(JSON.parse(persisted).sources.nodeseek.identityKey).toBe('nodeseek:126');
  });

  it('clears the previous account watermark after an explicit logout', async () => {
    const stored = defaultNotificationState();
    stored.sources.nodeseek = {
      intentEnabled: true,
      identityKey: 'nodeseek:42',
      baselineReady: true,
      deliveredIds: ['reply:known']
    };
    let persisted = JSON.stringify(stored);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    appQueryClient.setQueryData(forumQueryKeys.notifications('nodeseek'), { items: ['cached'] });
    const aggregateKey = forumQueryKeys.notificationList({
      source: 'all',
      identityKey: 'nodeseek:42',
      unreadOnly: false
    });
    appQueryClient.setQueryData(aggregateKey, { items: ['private aggregate row'] });

    let sessions = nodeSeekSessions('confirmed');
    const hook = await renderHook(
      () =>
        useNotificationsRuntime(
          runtimeOptions(
            jest.fn(() => true),
            sessions
          )
        ),
      { wrapper: QueryTestWrapper }
    );
    sessions = createSiteSessionViewModels(createSiteSessionStates());
    await act(async () => hook.rerender({}));

    await waitFor(() => expect(hook.result.current.state.sources.nodeseek.identityKey).toBeUndefined());
    expect(hook.result.current.state.sources.nodeseek.deliveredIds).toEqual([]);
    expect(appQueryClient.getQueryData(forumQueryKeys.notifications('nodeseek'))).toBeUndefined();
    expect(appQueryClient.getQueryData(aggregateKey)).toBeUndefined();
  });
});
