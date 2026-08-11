import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useAppRuntime } from '@/app/useAppRuntime';

jest.mock('@/app/useAppLifecycleRuntime', () => ({
  useAppLifecycleRuntime: () => ({
    appActive: true,
    changeScreen: jest.fn(),
    getCurrentScreen: jest.fn(() => 'feed'),
    height: 800,
    loginNavigation: {},
    notify: jest.fn(),
    onReady: jest.fn(),
    onScreenChange: jest.fn(),
    openUserRoute: jest.fn(),
    screen: 'more',
    width: 400
  })
}));

jest.mock('@/app/useReaderRuntime', () => ({
  useReaderRuntime: () => {
    const { createEmptyReaderData } =
      jest.requireActual<typeof import('@/domain/reader/readerData')>('@/domain/reader/readerData');
    const readerData = createEmptyReaderData();
    return {
      commitReaderData: jest.fn(),
      readerData,
      readerDataLoaded: true,
      readerDataRef: { current: readerData },
      replaceReaderData: jest.fn(),
      waitForReaderDataSave: jest.fn(async () => undefined)
    };
  }
}));

jest.mock('@/platform/network/useNetworkProxyRuntime', () => ({
  useNetworkProxyRuntime: () => ({
    activeProfile: null,
    applyError: '',
    applyStatus: 'loading',
    deleteProxyProfile: jest.fn(),
    ensureNetworkProxyReady: jest.fn(async () => {
      throw new Error('代理状态读取中。');
    }),
    loaded: false,
    networkProxyFetcher: jest.fn(async () => {
      throw new Error('代理状态读取中。');
    }),
    proxyState: { enabled: false, activeId: null, profiles: [] },
    selectProxyProfile: jest.fn(),
    setProxyEnabled: jest.fn(),
    summary: '代理状态读取中',
    testProxyProfile: jest.fn(),
    upsertProxyProfile: jest.fn(),
    webViewBlockMessage: '代理状态读取中。'
  })
}));

jest.mock('@/features/account/useAccountRuntime', () => ({
  useAccountRuntime: () => ({
    center: {
      account: {
        linuxDoLevelBusy: false,
        linuxDoLevelError: '',
        linuxDoLevelProfile: null,
        refreshLinuxDoLevel: jest.fn()
      },
      checkIn: {},
      credentials: { credentialSummaries: [], pendingCredentialFillSite: null },
      handleAccountCenterCommand: jest.fn(),
      nodeImage: {
        key: {
          authorize: jest.fn(),
          busy: false,
          clear: jest.fn(),
          save: jest.fn(),
          saved: false
        }
      },
      webLoginUserId: null,
      xiaoyinsiAuth: {
        beginAuthorization: jest.fn(),
        cancelAuthorization: jest.fn(),
        message: '',
        openAuthorizationBrowser: jest.fn(),
        pending: false,
        phase: 'idle',
        refreshAuthorization: jest.fn(),
        revokeAuthorization: jest.fn(),
        secondsRemaining: 0
      },
      xiaoyinsiLevel: {
        levelBusy: false,
        levelError: '',
        levelProfile: null,
        refreshLevel: jest.fn()
      }
    },
    hosts: {
      closePanels: jest.fn(),
      closeTopmostSurface: jest.fn(),
      element: null,
      linuxDoVerificationVisible: false,
      requestNodeSeekVerification: jest.fn(),
      showLinuxDoVerification: jest.fn(),
      showYaohuoLogin: jest.fn(),
      surfaces: { linuxdo: {}, nodeseek: {}, yaohuo: {} }
    },
    read: {
      accountIdentityPending: false,
      accountSessionViewModels: { nodeseek: { isLoggedIn: false } },
      forumSessionEpochs: { linuxdo: 0, nodeseek: 0, xiaoyinsi: 0, yaohuo: 0 },
      getLinuxDoUserAgent: jest.fn(),
      getNodeSeekUserAgent: jest.fn(),
      identityBarriers: {},
      readGateway: { getEmojiUrls: jest.fn() },
      reconcileAccountStatus: jest.fn(),
      statusBusy: false
    },
    write: {
      ensureNodeImageApiKey: jest.fn(),
      ensureWritableSession: jest.fn(),
      isWritableSessionTicketCurrent: jest.fn(),
      reconcileWritableSession: jest.fn()
    }
  })
}));

jest.mock('@/platform/update/useAppUpdateRuntime', () => ({
  useAppUpdateRuntime: () => ({ appUpdateBusy: false, appUpdateDownloading: false, appUpdateInfo: null })
}));

jest.mock('@/features/notifications/useNotificationsRuntime', () => ({
  useNotificationsRuntime: () => ({
    backgroundEnabled: false,
    onNavigationReady: jest.fn(),
    partialUnavailable: false,
    unreadTotal: 0
  })
}));

jest.mock('@/app/useForumCatalogRuntime', () => ({ useForumCatalogRuntime: () => ({ categories: [] }) }));
jest.mock('@/app/useAppDiagnosticsRuntime', () => ({ useAppDiagnosticsRuntime: () => ({ metadata: {} }) }));
jest.mock('@/app/useAppBackHandler', () => ({ useAppBackHandler: jest.fn() }));
jest.mock('@/app/useContentSourceQueryCleanup', () => ({ useContentSourceQueryCleanup: jest.fn() }));

describe('app runtime startup', () => {
  it('[REG-PROXY-011] exposes local routes while proxy state is still unavailable', async () => {
    const hook = await renderHook(() => useAppRuntime());

    expect(hook.result.current.routes).not.toBeNull();
    expect(hook.result.current.routes?.libraryRouteRuntime).toBeDefined();
    expect(hook.result.current.routes?.moreRouteRuntime).toBeDefined();
  });
});
