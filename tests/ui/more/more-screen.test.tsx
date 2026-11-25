import { projectTestAccountSessions } from '../../helpers/accountSessions';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor, within } from '../render';
import { renderHook as renderNativeHook } from '@testing-library/react-native';
import { useDiagnosticLogController } from '@/features/more/useDiagnosticLogController';
import { useReaderRuntime } from '@/app/useReaderRuntime';
import { useReaderSettingsController } from '@/features/more/useReaderSettingsController';
import * as diagnosticFileStore from '@/platform/diagnostics/diagnosticFileStore';
import * as journal from '@/platform/diagnostics/nativeDiagnosticJournal';
import React, { type ComponentProps, Profiler, useLayoutEffect, useState } from 'react';
import { createRoot } from 'test-renderer';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';
import { emptyCredentialSummaries } from '@/platform/storage/credentialVault';
import { clearNodeImageApiKey, NODEIMAGE_API_KEY_STORAGE_KEY } from '@/sources/nodeimage/credentials';
import { createEmptyNetworkProxyState } from '@/platform/network/networkProxy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { MoreScreen as MoreScreenView } from '@/features/more/MoreScreen';
import { AccountOverviewPanel } from '@/features/more/components/AccountOverviewPanel';
import { createMoreScreenStyles } from '@/features/more/styles';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { resolveReaderStyleSettings, createTheme, readerRadii } from '@/ui/theme/tokens';
import { QueryClientProvider } from '@tanstack/react-query';
import { createAppQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { NodeSeekAccountOverview, NodeSeekAttendanceBoard } from '@/domain/forum/accountData';
import { LinuxDoCreditError } from '@/domain/forum/linuxDoCredit';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { NavigationBackdropProvider, NavigationGlass } from '@/ui/navigation/NavigationGlass';
import {
  createEmptyReaderState,
  projectReaderCommand,
  type ReaderChange,
  type ReaderCommand
} from '@/domain/reader/readerRecordState';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { navigationRef } from '@/app/appNavigation';
import { useAppDeepLinkNavigation } from '@/app/useAppDeepLinkNavigation';
import { MoreRoute, ReadingSettingsRoute } from '@/features/more/MoreRoute';
import { MoreRouteRuntimeProvider, type MoreRouteRuntimeValue } from '@/features/more/MoreRouteRuntime';
import type { LocalReaderFont } from '@/domain/reader/readerFonts';
import { downloadableReaderFonts } from '@/platform/storage/readerFonts';
import { localReaderFontRegistration } from '@/ui/theme/useReaderFonts';
import { NetworkSettingsRoute } from '@/features/more/NetworkSettingsRoute';
import { useNodeSeekCheckInController } from '@/features/account/useNodeSeekCheckInController';
import { prepareRequestToSend, type Fetcher } from '@/platform/network/request';
import {
  CURRENT_APP_VERSION,
  CURRENT_ANDROID_VERSION_CODE,
  formatAppUpdateDownloadProgress
} from '@/platform/update/appUpdate';
import { createAppUpdateProgress } from '@/platform/update/appUpdateOperation';

const mockLoadSourceSettings = jest.fn<() => Promise<ReturnType<typeof createEmptyReaderState>>>();
const mockCommitSourceSettings = jest.fn<(command: ReaderCommand) => Promise<ReaderChange>>();
jest.mock('@/platform/storage/readerDataStore', () => ({
  loadReaderState: () => mockLoadSourceSettings(),
  subscribeReaderStorageFreeze: () => jest.fn(),
  commitReaderCommand: (command: ReaderCommand) => mockCommitSourceSettings(command)
}));

const mockSaveBackupDocument =
  jest.fn<(name: string, json: string) => Promise<{ status: 'saved'; byteCount: number }>>();
const mockReadBackupDocument = jest.fn<(uri: string, maxBytes: number) => Promise<string>>();
const mockChooseBackupDocument = jest.fn<() => Promise<{ canceled: false; assets: { uri: string; size: number }[] }>>();
const mockInstallFont = jest.fn<() => Promise<LocalReaderFont>>();
const moreQueryClients = new Set<ReturnType<typeof createAppQueryClient>>();

function createMoreTestQueryClient() {
  const client = createAppQueryClient();
  moreQueryClients.add(client);
  return client;
}

afterEach(() => {
  for (const client of moreQueryClients) client.clear();
  moreQueryClients.clear();
});

jest.mock('@/platform/storage/readerFonts', () => ({
  ...jest.requireActual<typeof import('@/platform/storage/readerFonts')>('@/platform/storage/readerFonts'),
  listLocalReaderFonts: async () => [],
  downloadReaderFont: () => mockInstallFont()
}));
jest.mock('expo', () => {
  const actual = jest.requireActual<typeof import('expo')>('expo');
  return {
    ...actual,
    requireOptionalNativeModule: (name: string) =>
      name === 'BackupExport'
        ? { saveBackupDocument: mockSaveBackupDocument, readBackupDocument: mockReadBackupDocument }
        : actual.requireOptionalNativeModule(name)
  };
});
jest.mock('expo-document-picker', () => ({ getDocumentAsync: () => mockChooseBackupDocument() }));

describe('diagnostic export observation lifetime', () => {
  it.each(['success', 'failure'] as const)(
    'keeps one real diagnostic job through StrictMode and settles its current %s observation',
    async (outcome) => {
      const pending = Promise.withResolvers<void>();
      const exported = jest.spyOn(diagnosticFileStore, 'exportDiagnosticLog').mockReturnValue(pending.promise);
      const notify = jest.fn();
      const latestNotify = jest.fn();
      let controller!: ReturnType<typeof useDiagnosticLogController>;
      let result!: Promise<void>;
      let setups = 0;
      function Harness({ notice }: { notice: (message: string) => void }) {
        const value = useDiagnosticLogController({
          getCurrentScreen: () => 'more',
          metadata: { appVersion: 'fixture', versionCode: 1 },
          notify: notice
        });
        useLayoutEffect(() => {
          controller = value;
        });
        useLayoutEffect(() => {
          setups += 1;
          if (setups === 1) result = controller.exportDiagnosticLogFile();
        }, []);
        return null;
      }
      const root = createRoot({ isStrictMode: true });
      try {
        await act(async () => root.render(<Harness notice={notify} />));
        expect(setups).toBe(2);
        expect(controller.diagnosticBusy).toBe(true);
        await act(async () => {
          await controller.exportDiagnosticLogFile();
        });
        expect(exported).toHaveBeenCalledTimes(1);
        await act(async () => root.render(<Harness notice={latestNotify} />));
        await act(async () => {
          if (outcome === 'success') pending.resolve();
          else pending.reject(new Error('current diagnostic failure'));
          await result;
        });
        expect(exported).toHaveBeenCalledWith({ appVersion: 'fixture', versionCode: 1, currentScreen: 'more' });
        expect(latestNotify).toHaveBeenCalledTimes(1);
        expect(latestNotify).toHaveBeenCalledWith(
          outcome === 'success' ? '诊断日志已生成' : 'current diagnostic failure'
        );
        expect(notify).not.toHaveBeenCalled();
        expect(controller.diagnosticBusy).toBe(false);
      } finally {
        pending.resolve();
        await act(async () => root.unmount());
        exported.mockRestore();
      }
    }
  );
  it.each(['success', 'failure'] as const)(
    'settles a dispatched diagnostic export without a retired %s notice',
    async (outcome) => {
      const pending = Promise.withResolvers<void>();
      const exported = jest.spyOn(diagnosticFileStore, 'exportDiagnosticLog').mockReturnValue(pending.promise);
      const notify = jest.fn();
      const hook = await renderNativeHook(() =>
        useDiagnosticLogController({
          getCurrentScreen: () => 'more',
          metadata: { appVersion: 'fixture', versionCode: 1 },
          notify
        })
      );
      let result!: Promise<void>;
      try {
        await act(async () => {
          result = hook.result.current.exportDiagnosticLogFile();
        });
        expect(exported).toHaveBeenCalledTimes(1);
        await hook.unmount();
        await act(async () => {
          if (outcome === 'success') pending.resolve();
          else pending.reject(new Error('retired diagnostic failure'));
          await result;
        });
        expect(notify).not.toHaveBeenCalled();
      } finally {
        pending.resolve();
        exported.mockRestore();
      }
    }
  );
});

let mockDragRunsOnJS = false;
let mockDeferScheduleOnRN = false;
let mockDeferredRNCalls: (() => unknown)[] = [];
let mockSharedValues: { value: unknown }[] = [];
let mockScreenReaderChangeListener: ((enabled: boolean) => void) | undefined;
let mockScreenReaderInitialState: boolean | null | 'reject' = false;
let mockWindowDimensionsCalls = 0;
const mockScheduleOnRN = jest.fn((callback: (...args: unknown[]) => unknown, ...args: unknown[]) => callback(...args));
const mockAccessibilitySubscriptionRemove = jest.fn();
const mockIsScreenReaderEnabled = jest.fn(() => {
  if (mockScreenReaderInitialState === null) return new Promise<boolean>(() => undefined);
  if (mockScreenReaderInitialState === 'reject') return Promise.reject(new Error('AccessibilityInfo unavailable'));
  return Promise.resolve(mockScreenReaderInitialState);
});
const mockAccessibilityAddEventListener = jest.fn((event: string, listener: (enabled: boolean) => void) => {
  if (event === 'screenReaderChanged') mockScreenReaderChangeListener = listener;
  return { remove: mockAccessibilitySubscriptionRemove };
});

beforeEach(() => {
  mockDragRunsOnJS = false;
  mockDeferScheduleOnRN = false;
  mockDeferredRNCalls = [];
  mockSharedValues = [];
  mockScreenReaderChangeListener = undefined;
  mockScreenReaderInitialState = false;
  mockWindowDimensionsCalls = 0;
  mockScheduleOnRN.mockClear();
  mockAccessibilitySubscriptionRemove.mockClear();
  mockIsScreenReaderEnabled.mockClear();
  mockAccessibilityAddEventListener.mockClear();
});

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as typeof import('react-native');
  const accessibilityInfo = {
    ...actual.AccessibilityInfo,
    addEventListener: (event: string, listener: (enabled: boolean) => void) =>
      mockAccessibilityAddEventListener(event, listener),
    isScreenReaderEnabled: () => mockIsScreenReaderEnabled()
  };
  return new Proxy(actual, {
    get(target, property, receiver) {
      if (property === 'useWindowDimensions') {
        return () => {
          mockWindowDimensionsCalls++;
          return actual.useWindowDimensions();
        };
      }
      return property === 'AccessibilityInfo' ? accessibilityInfo : Reflect.get(target, property, receiver);
    }
  });
});

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}));

jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react') as typeof React;
  const actual = jest.requireActual('react-native-reanimated/mock') as Record<string, unknown>;
  return {
    ...actual,
    useSharedValue<Value>(initialValue: Value) {
      const sharedValue = ReactModule.useRef<{ value: Value } | null>(null);
      if (!sharedValue.current) {
        sharedValue.current = { value: initialValue };
        mockSharedValues.push(sharedValue.current);
      }
      return sharedValue.current;
    }
  };
});

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    WebView: ReactModule.forwardRef(function MockWebView(props: Record<string, unknown>, ref) {
      ReactModule.useImperativeHandle(ref, () => ({ injectJavaScript: () => undefined, reload: () => undefined }));
      return ReactModule.createElement(View, props);
    })
  };
});

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  return {
    usePanGesture: (config: Record<string, unknown>) => ({
      handlers: {
        gestureEnabled: config.enabled,
        onGestureBegin: config.onBegin,
        onGestureEnd: config.onDeactivate,
        onGestureFinalize: config.onFinalize,
        onGestureStart: config.onActivate,
        onGestureUpdate: config.onUpdate
      }
    }),
    GestureDetector: ({
      children,
      gesture
    }: {
      children: React.ReactElement<Record<string, unknown>>;
      gesture: { handlers?: Record<string, unknown> };
    }) => ReactModule.cloneElement(children, gesture.handlers || {}),
    ScrollView: require('react-native').ScrollView
  };
});

jest.mock('react-native-worklets', () => ({
  ...(jest.requireActual('react-native-worklets') as Record<string, unknown>),
  scheduleOnRN: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) =>
    mockScheduleOnRN(() => {
      if (mockDeferScheduleOnRN) {
        mockDeferredRNCalls.push(() => callback(...args));
        return;
      }
      return callback(...args);
    })
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    Activity: Icon,
    PackageCheck: Icon,
    ArrowLeft: Icon,
    Bell: Icon,
    Bug: Icon,
    Check: Icon,
    CheckCircle: Icon,
    CalendarCheck: Icon,
    Copy: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    DatabaseBackup: Icon,
    Download: Icon,
    FilePlus2: Icon,
    Image: Icon,
    Info: Icon,
    GripVertical: Icon,
    History: Icon,
    Pause: Icon,
    Pencil: Icon,
    Play: Icon,
    Plus: Icon,
    Minus: Icon,
    RefreshCw: Icon,
    Server: Icon,
    Settings: Icon,
    Settings2: Icon,
    Star: Icon,
    Trash2: Icon,
    User: Icon,
    Users: Icon,
    X: Icon
  };
});

const readerData = createEmptyReaderData();
const sessionViewModels = projectTestAccountSessions(createSiteSessionStates());
const authorizedLinuxDoSessions = projectTestAccountSessions(
  createSiteSessionStates({
    linuxdo: {
      site: 'linuxdo',
      status: 'logged-in',
      cookieSummary: [],
      isVerifying: false,
      currentUser: {
        source: 'linuxdo',
        id: 'alice',
        username: 'alice',
        displayName: 'Alice',
        url: 'https://linux.do/u/alice'
      }
    }
  })
);

function MoreScreen(props: ComponentProps<typeof MoreScreenView>) {
  const [contentSourcesExpanded, setContentSourcesExpanded] = useState(props.contentSourcesExpanded);
  const [queryClient] = useState(createMoreTestQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <MoreScreenView
        {...props}
        contentSourcesExpanded={contentSourcesExpanded}
        onContentSourcesExpandedChange={setContentSourcesExpanded}
      />
    </QueryClientProvider>
  );
}

async function renderPersistedContentSources(failFirst = false) {
  const notify = jest.fn<(message: string) => void>();
  let stored = createEmptyReaderState();
  let writes = 0;
  let settled = Promise.resolve();
  mockLoadSourceSettings.mockResolvedValue(stored);
  mockCommitSourceSettings.mockReset();
  mockCommitSourceSettings.mockImplementation((command) => {
    const operation = settled.then(() => {
      if (++writes === 1 && failFirst) throw new Error('设置写入未完成');
      stored = projectReaderCommand(stored, command);
      return { membership: [], counts: {}, changed: [], settings: stored.settings };
    });
    settled = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  });

  function ContentSourceReader() {
    const reader = useReaderRuntime({ notify });
    const { updateSettings } = useReaderSettingsController({ commitReaderData: reader.commitReaderData });
    return reader.readerStatus === 'ready' ? (
      <MoreScreen
        {...moreProps({ utilities: { settings: { value: reader.readerData.settings, update: updateSettings } } })}
        contentSourcesExpanded
      />
    ) : null;
  }
  const client = createMoreTestQueryClient();
  const view = await render(
    <QueryClientProvider client={client}>
      <ContentSourceReader />
    </QueryClientProvider>
  );
  return { view, notify, storedSources: () => stored.settings.contentSources };
}

describe('content source settings persisted through ReaderRuntime', () => {
  it.each([false, true])('keeps queued switches independent when the first save fails: %s', async (failFirst) => {
    const { view, storedSources, notify } = await renderPersistedContentSources(failFirst);
    const labels = ['V2EX', 'linux.do', 'NodeSeek', '妖火'];
    await view.findByLabelText('V2EX 内容源开关');
    const changes = labels.map((label) => view.getByLabelText(`${label} 内容源开关`).props.onChange);
    await act(async () => {
      for (const change of changes) change({ nativeEvent: { value: false } });
    });
    expect(mockCommitSourceSettings).toHaveBeenCalledTimes(4);
    expect(storedSources().map(({ enabled }) => enabled)).toEqual([failFirst, false, false, false]);
    expect(labels.map((label) => view.getByLabelText(`${label} 内容源开关`).props.value)).toEqual([
      failFirst,
      false,
      false,
      false
    ]);
    if (failFirst) expect(notify).toHaveBeenCalledWith('设置写入未完成');
    else expect(notify).not.toHaveBeenCalled();
  });

  it('moves the source named by a queued TalkBack action after another move changes its position', async () => {
    mockScreenReaderInitialState = true;
    const { view, storedSources } = await renderPersistedContentSources();
    const v2ex = await view.findByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
    const queuedMove = view.getByLabelText('拖动排序：linux.do，第 2 项，共 4 项').props.onAccessibilityAction;
    await fireEvent(v2ex, 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
    await waitFor(() => expect(view.getByLabelText('拖动排序：linux.do，第 1 项，共 4 项')).toBeTruthy());
    await act(async () => {
      queuedMove({ nativeEvent: { actionName: 'moveDown' } });
    });
    expect(mockCommitSourceSettings).toHaveBeenCalledTimes(2);
    expect(storedSources().map(({ source }) => source)).toEqual(['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']);
  });
});

type MoreScreenProps = ComponentProps<typeof MoreScreen>;
type MoreScreenOverrides = {
  account?: {
    active?: boolean;
    enabledSessionSources?: MoreScreenProps['account']['enabledSessionSources'];
    read?: Partial<MoreScreenProps['account']['read']>;
    center?: {
      command?: MoreScreenProps['account']['center']['command'];
      credentials?: Partial<MoreScreenProps['account']['center']['credentials']>;
      linuxDoLevel?: Partial<MoreScreenProps['account']['center']['linuxDoLevel']>;
      nodeImageKey?: Partial<MoreScreenProps['account']['center']['nodeImageKey']>;
      nodeSeek?: Partial<MoreScreenProps['account']['center']['nodeSeek']>;
    };
    surfaces?: Partial<MoreScreenProps['account']['surfaces']>;
  };
  update?: Partial<MoreScreenProps['update']>;
  utilities?: {
    library?: Partial<MoreScreenProps['utilities']['library']>;
    backup?: Partial<MoreScreenProps['utilities']['backup']>;
    diagnostics?: Partial<MoreScreenProps['utilities']['diagnostics']>;
    proxy?: Partial<MoreScreenProps['utilities']['proxy']>;
    settings?: Partial<MoreScreenProps['utilities']['settings']>;
  };
};

function moreProps(overrides: MoreScreenOverrides = {}): MoreScreenProps {
  const account: MoreScreenProps['account'] = {
    active: overrides.account?.active ?? true,
    enabledSessionSources: ['nodeseek', 'linuxdo', 'yaohuo'],
    read: {
      sessionEpochs: initialForumSessionEpochs,
      gateway: {
        getReadPlan: (source, operation) => ({
          source,
          operation,
          state: 'blocked',
          reason: 'login-required',
          cacheScope: 'blocked:login-required'
        }),
        getUserDetails: async () => {
          throw new Error('资料未提供');
        },
        getNodeSeekAccountOverview: async () => {
          throw new Error('资料未提供');
        },
        getYaohuoAccountOverview: async () => {
          throw new Error('资料未提供');
        },
        getNodeSeekAttendanceBoard: async () => {
          throw new Error('签到状态未提供');
        },
        getNodeSeekCredits: async () => {
          throw new Error('流水未提供');
        },
        getNodeSeekStardustCredits: async () => {
          throw new Error('星辰流水未提供');
        },
        getLinuxDoCreditAccount: async () => {
          throw new Error('LDC 余额未提供');
        },
        getLinuxDoCreditTransactions: async () => {
          throw new Error('LDC 明细未提供');
        }
      },
      sessions: sessionViewModels,
      statusBusy: false,
      ...overrides.account?.read
    },
    center: {
      openCredits: jest.fn(),
      openLinuxDoCredit: jest.fn(),
      linuxDoCredit: {
        open: jest.fn<() => void>(),
        connectSilently: jest.fn<() => void>(),
        busy: false
      },
      command: jest.fn(async () => undefined),
      credentials: {
        summaries: emptyCredentialSummaries(),
        pendingFillSite: null,
        ...overrides.account?.center?.credentials
      },
      linuxDoLevel: {
        busy: false,
        error: '',
        profile: null,
        refresh: jest.fn(),
        ...overrides.account?.center?.linuxDoLevel
      },
      nodeImageKey: {
        authorize: jest.fn(),
        authorized: false,
        busy: false,
        clear: jest.fn(),
        save: jest.fn(),
        saved: false,
        ...overrides.account?.center?.nodeImageKey
      },
      nodeSeek: {
        busy: false,
        state: { kind: 'idle' },
        observeBoard: jest.fn(),
        checkIn: jest.fn(),
        ...overrides.account?.center?.nodeSeek
      },
      ...(overrides.account?.center?.command ? { command: overrides.account.center.command } : {})
    },
    surfaces: {
      closeAll: jest.fn(),
      linuxdo: false,
      nodeseek: false,
      yaohuo: false,
      ...overrides.account?.surfaces
    },
    ...(overrides.account?.enabledSessionSources
      ? { enabledSessionSources: overrides.account.enabledSessionSources }
      : {})
  };
  return {
    account,
    contentSourcesExpanded: false,
    onContentSourcesExpandedChange: jest.fn(),
    update: {
      phase: 'idle',
      artifact: null,
      restoreFailed: false,
      progress: createAppUpdateProgress(),
      info: null,
      message: '',
      check: jest.fn(),
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      install: jest.fn(),
      ...overrides.update
    },
    utilities: {
      library: {
        open: jest.fn(),
        ...overrides.utilities?.library
      },
      backup: {
        readerStatus: 'ready',
        operation: 'idle',
        exportFile: jest.fn(),
        importFile: jest.fn(),
        ...overrides.utilities?.backup
      },
      diagnostics: {
        busy: false,
        exportLog: jest.fn(),
        ...overrides.utilities?.diagnostics
      },
      proxy: {
        summary: '跟随系统',
        open: jest.fn(),
        ...overrides.utilities?.proxy
      },
      settings: {
        value: readerData.settings,
        visible: false,
        changeVisible: jest.fn(),
        update: jest.fn(),
        ...overrides.utilities?.settings
      }
    }
  };
}

function createMoreRouteRuntime(props = moreProps()): MoreRouteRuntimeValue {
  return {
    account: props.account,
    diagnostics: {
      getCurrentScreen: () => 'more',
      metadata: { appVersion: CURRENT_APP_VERSION, versionCode: CURRENT_ANDROID_VERSION_CODE }
    },
    notify: jest.fn(),
    library: props.utilities.library,
    proxy: {
      activeProfile: null,
      applyError: '',
      applyStatus: 'disabled',
      confirmedState: undefined,
      effectiveMode: 'system',
      proxyState: createEmptyNetworkProxyState(),
      summary: props.utilities.proxy.summary,
      deleteProxyProfile: jest.fn(async () => undefined),
      selectProxyProfile: jest.fn(async () => undefined),
      setNetworkMode: jest.fn(async () => undefined),
      networkProxyFetcher: jest.fn(
        async () => new Response('<html>forum</html>', { headers: { 'content-type': 'text/html' } })
      ),
      upsertProxyProfile: jest.fn(async () => undefined)
    },
    reader: {
      status: 'ready',
      commit: jest.fn(),
      data: createEmptyReaderState(),
      importBackup: jest.fn(async () => undefined),
      exportBackup: jest.fn(async () => '')
    },
    update: {
      phase: 'downloading',
      artifact: null,
      restoreFailed: false,
      appUpdateBusy: true,
      downloadProgress: createAppUpdateProgress(formatAppUpdateDownloadProgress('2.0.0', 0, 100)),
      appUpdateInfo: null,
      appUpdateMessage: '',
      checkAppUpdate: jest.fn(async () => undefined),
      startAppUpdateDownload: jest.fn(async () => undefined),
      pauseAppUpdateDownload: jest.fn(async () => undefined),
      resumeAppUpdateDownload: jest.fn(async () => undefined),
      installAppUpdate: jest.fn(async () => undefined)
    }
  };
}

const NetworkSettingsStack = createNativeStackNavigator<RootStackParamList>();

function renderNetworkSettings(runtime: MoreRouteRuntimeValue) {
  return (
    <MoreRouteRuntimeProvider value={runtime}>
      <NavigationContainer>
        <NetworkSettingsStack.Navigator screenOptions={{ headerShown: false }}>
          <NetworkSettingsStack.Screen name="NetworkSettings" component={NetworkSettingsRoute} />
        </NetworkSettingsStack.Navigator>
      </NavigationContainer>
    </MoreRouteRuntimeProvider>
  );
}

describe('network settings transitions', () => {
  it('selects the saved profile before enabling the application proxy', async () => {
    const runtime = createMoreRouteRuntime();
    const actions: string[] = [];
    runtime.proxy.upsertProxyProfile = async (profile) => {
      actions.push(`save:${profile.id}`);
    };
    runtime.proxy.selectProxyProfile = async (id) => {
      actions.push(`select:${id}`);
    };
    runtime.proxy.setNetworkMode = async (mode) => {
      actions.push(mode);
    };
    const view = await render(renderNetworkSettings(runtime));
    try {
      await fireEvent.press(view.getByRole('radio', { name: /应用代理/ }));
      await fireEvent.press(await view.findByText('添加代理'));
      await fireEvent.changeText(view.getByLabelText('名称'), '测试代理');
      await fireEvent.changeText(view.getByLabelText('服务器'), 'proxy.example.test');
      await fireEvent.changeText(view.getByLabelText('端口'), '8080');
      await fireEvent.press(view.getByLabelText('确定'));
      expect(actions).toEqual([expect.stringMatching(/^save:.+/), actions[0]!.replace('save:', 'select:'), 'proxy']);
    } finally {
      await view.unmount();
    }
  });

  it('opens a network-only log, filters failures, and retries an unavailable journal', async () => {
    const time = '2026-11-22T09:00:00Z';
    const nativeRequest = {
      timeMs: Date.parse(time),
      diagnosticKind: 'network',
      operation: 'request',
      source: 'nodeseek'
    };
    const snapshot: journal.DiagnosticJournalSnapshot = {
      status: 'available',
      health: {},
      crashLines: '',
      jsLines: [
        {
          time,
          area: 'source',
          operation: 'getAccountOverview',
          phase: 'finish',
          outcome: 'failure',
          source: 'nodeseek',
          reason: 'invalid_response'
        },
        {
          time,
          area: 'source',
          operation: 'attendance',
          phase: 'finish',
          outcome: 'failure',
          source: 'nodeseek',
          reason: 'timeout'
        },
        {
          time,
          area: 'credential',
          operation: 'check',
          phase: 'transport',
          source: 'linuxdo',
          isCurrent: true,
          verificationPage: 'alternate',
          verificationAction: 'load-end'
        },
        {
          time,
          area: 'credential',
          operation: 'check',
          phase: 'transport',
          source: 'linuxdo',
          isCurrent: true,
          verificationPage: 'alternate',
          verificationAction: 'load-error',
          reason: 'tls_error'
        },
        {
          time,
          area: 'credential',
          operation: 'check',
          phase: 'transport',
          source: 'linuxdo',
          isCurrent: true,
          verificationPage: 'alternate',
          verificationAction: 'load-end',
          hasLoadError: true
        }
      ]
        .map((v) => JSON.stringify(v))
        .join('\n'),
      nativeLines: [
        {
          ...nativeRequest,
          phase: 'response-headers',
          status: 200,
          url: 'private-field'
        },
        { ...nativeRequest, phase: 'call-failed', outcome: 'canceled', socketFailure: 'closed' },
        { ...nativeRequest, phase: 'call-failed', outcome: 'failure', socketFailure: 'refused' },
        {
          timeMs: Date.parse(time),
          diagnosticKind: 'network',
          operation: 'cookie-request',
          source: 'linuxdo',
          phase: 'finish',
          cookie: 'private-field'
        }
      ]
        .map((v) => JSON.stringify(v))
        .join('\n')
    };
    const reading = jest
      .spyOn(journal, 'readDiagnosticJournal')
      .mockResolvedValueOnce({ ...snapshot, status: 'timeout' })
      .mockResolvedValue(snapshot);
    const copy = jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValue(true);
    const view = await render(renderNetworkSettings(createMoreRouteRuntime()));
    try {
      await fireEvent.press(view.getByText('网络日志'));
      expect(await view.findByText('暂时无法读取网络日志，请刷新重试。')).toBeTruthy();
      await fireEvent.press(view.getByRole('button', { name: '刷新日志' }));
      expect(await view.findByText('HTTP 200')).toBeTruthy();
      expect(view.getAllByText(/^\d{2}:\d{2}:\d{2}$/).length).toBeGreaterThan(1);
      expect(view.getAllByRole('header', { name: '2026年11月22日' })).toHaveLength(1);
      expect(view.getByText('响应格式不符')).toBeTruthy();
      expect(view.getAllByText('页面已加载')).toHaveLength(1);
      expect(view.getByText('TLS 握手失败')).toBeTruthy();
      expect(view.queryByText(/private-field/)).toBeNull();
      await fireEvent.press(view.getByRole('button', { name: '仅看失败' }));
      expect(view.queryByText('HTTP 200')).toBeNull();
      expect(view.queryByText('连接已关闭')).toBeNull();
      expect(view.getByText('连接被拒绝')).toBeTruthy();
      expect(view.getByText('响应格式不符')).toBeTruthy();
      await fireEvent.press(view.getByRole('button', { name: '复制日志' }));
      expect(copy).toHaveBeenCalledWith(
        [
          '2026-11-22T09:00:00.000Z · NodeSeek · 网络请求 · 连接被拒绝',
          '2026-11-22T09:00:00.000Z · NodeSeek · 我的资料 · 响应格式不符',
          '2026-11-22T09:00:00.000Z · NodeSeek · 签到榜 · 超时',
          '2026-11-22T09:00:00.000Z · linux.do · 网站验证页 · TLS 握手失败'
        ].join('\n')
      );
      reading.mockResolvedValue({ ...snapshot, jsLines: '', nativeLines: '' });
      await fireEvent.press(view.getByRole('button', { name: '刷新日志' }));
      expect(await view.findByText('最近没有失败记录。')).toBeTruthy();
    } finally {
      await view.unmount();
      reading.mockRestore();
      copy.mockRestore();
    }
  });
  it('offers only system networking and the application proxy, with access to website verification', async () => {
    const runtime = createMoreRouteRuntime();
    const slow = Promise.withResolvers<Response>();
    const fetcher = jest.fn<import('@/platform/network/request').Fetcher>(async (url) => {
      if (url.includes('yaohuo.me')) return slow.promise;
      if (url.includes('linux.do'))
        return new Response('<title>Just a moment</title>', { status: 403, headers: { 'content-type': 'text/html' } });
      if (url.includes('v2ex.com')) throw new Error('Network request failed');
      return new Response('<html>forum</html>', { status: 200 });
    });
    runtime.proxy.networkProxyFetcher = fetcher;
    const view = await render(renderNetworkSettings(runtime));
    try {
      expect(view.getAllByRole('radio')).toHaveLength(2);
      expect(view.getByRole('radio', { name: /跟随系统/, checked: true })).toBeTruthy();
      expect(view.getByRole('radio', { name: /应用代理/, checked: false })).toBeTruthy();
      await fireEvent.press(view.getByText('测试当前网络'));
      expect(await view.findByText(/可访问 · HTTP 200/)).toBeTruthy();
      expect(view.getByText(/需网站验证 · HTTP 403/)).toBeTruthy();
      expect(view.getByText(/连接失败 ·/)).toBeTruthy();
      expect(view.getByText('测试中')).toBeTruthy();
      await act(async () => slow.resolve(new Response('', { status: 503 })));
      expect(await view.findByText(/站点返回错误 · HTTP 503/)).toBeTruthy();
      expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'omit')).toBe(true);
      expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual(
        ['https://linux.do/', 'https://www.nodeseek.com/', 'https://www.v2ex.com/', 'https://www.yaohuo.me/'].sort()
      );
      await fireEvent.press(view.getByText('打开网站验证页'));
      expect(runtime.account.center.command).toHaveBeenCalledWith({ type: 'open-linuxdo-verification' });
    } finally {
      await view.unmount();
    }
  });
});

async function renderWarmMore(Provider: React.ComponentType<{ children: React.ReactNode }>) {
  const queryClient = createMoreTestQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, mutations: { ...defaults.mutations, gcTime: Infinity } });
  const subscription = Linking.addEventListener('url', () => {});
  const addEventListener = jest.fn<typeof Linking.addEventListener>(() => subscription);
  const linking = { addEventListener, getInitialURL: async () => null };
  const Tab = createBottomTabNavigator<MainTabParamList>();
  const Stack = createNativeStackNavigator<RootStackParamList>();
  function Tabs() {
    return (
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="more" component={MoreRoute} />
      </Tab.Navigator>
    );
  }
  function Routes() {
    const onReady = useAppDeepLinkNavigation(linking);
    return (
      <NavigationContainer ref={navigationRef} onReady={onReady}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs" component={Tabs} />
          <Stack.Screen name="Topic">{() => <Text>通过链接打开的主题</Text>}</Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    );
  }
  const view = await render(
    <QueryClientProvider client={queryClient}>
      <Provider>
        <Routes />
      </Provider>
    </QueryClientProvider>
  );
  const followLink = () => {
    const [[, onUrl]] = addEventListener.mock.calls;
    onUrl({ url: 'https://linux.do/t/topic/123' });
    expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
  };
  const dispose = async () => {
    await view.unmount();
    queryClient.clear();
  };
  return { view, followLink, dispose };
}
describe('More screen state and actions', () => {
  it.each(['导出备份文件', '选择备份文件恢复'] as const)(
    'ignores a queued %s after a warm link and completes a chooser started while focused',
    async (label) => {
      const content = '{"version":2}';
      const uri = 'content://fixture/reader-backup';
      const save = Promise.withResolvers<{ status: 'saved'; byteCount: number }>();
      const choose = Promise.withResolvers<{ canceled: false; assets: { uri: string; size: number }[] }>();
      mockSaveBackupDocument.mockReset().mockReturnValue(save.promise);
      mockChooseBackupDocument.mockReset().mockReturnValue(choose.promise);
      mockReadBackupDocument.mockReset().mockResolvedValue(content);
      const runtime = createMoreRouteRuntime();
      runtime.reader.exportBackup = jest.fn(async () => content);
      const { view, followLink, dispose } = await renderWarmMore(({ children }) => (
        <MoreRouteRuntimeProvider value={runtime}>{children}</MoreRouteRuntimeProvider>
      ));
      try {
        await fireEvent.press(view.getByLabelText('展开备份 / 恢复'));
        const queued = view.getByLabelText(label);
        await act(async () => {
          followLink();
          await fireEvent.press(queued);
        });
        expect(mockSaveBackupDocument).not.toHaveBeenCalled();
        expect(mockChooseBackupDocument).not.toHaveBeenCalled();

        await act(() => navigationRef.goBack());
        await fireEvent.press(view.getByLabelText(label));
        if (label === '导出备份文件') {
          await waitFor(() =>
            expect(mockSaveBackupDocument).toHaveBeenCalledWith(expect.stringMatching(/\.json$/), content)
          );
        } else {
          expect(mockChooseBackupDocument).toHaveBeenCalledTimes(1);
        }
        await act(async () => {
          followLink();
          save.resolve({ status: 'saved', byteCount: content.length });
          choose.resolve({ canceled: false, assets: [{ uri, size: content.length }] });
        });
        if (label === '选择备份文件恢复') {
          expect(mockReadBackupDocument).toHaveBeenCalledWith(uri, expect.any(Number));
          expect(runtime.reader.importBackup).toHaveBeenCalledWith(content);
        }
        await waitFor(() =>
          expect(runtime.notify).toHaveBeenCalledWith(
            label === '导出备份文件' ? '备份已保存到所选位置' : '备份已恢复，本机资料已合并'
          )
        );
      } finally {
        save.resolve({ status: 'saved', byteCount: content.length });
        choose.resolve({ canceled: false, assets: [{ uri, size: content.length }] });
        await dispose();
      }
    }
  );

  it('ignores queued diagnostic sharing after a warm link and settles an export started while focused', async () => {
    const settled = Promise.withResolvers<void>();
    const exportLog = jest.spyOn(diagnosticFileStore, 'exportDiagnosticLog').mockReturnValue(settled.promise);
    const runtime = createMoreRouteRuntime();
    const { view, followLink, dispose } = await renderWarmMore(({ children }) => (
      <MoreRouteRuntimeProvider value={runtime}>{children}</MoreRouteRuntimeProvider>
    ));
    try {
      const queued = view.getByRole('button', { name: '问题诊断' });
      await act(async () => {
        followLink();
        await fireEvent.press(queued);
      });
      expect(exportLog).not.toHaveBeenCalled();

      await act(() => navigationRef.goBack());
      await act(() => {
        void fireEvent.press(view.getByTestId('more-diagnostics'));
      });
      expect(exportLog).toHaveBeenCalledTimes(1);
      expect(exportLog).toHaveBeenCalledWith({ ...runtime.diagnostics.metadata, currentScreen: 'more' });
      await act(async () => {
        followLink();
        settled.resolve();
      });
      expect(runtime.notify).toHaveBeenCalledWith('诊断日志已生成');
      expect(exportLog).toHaveBeenCalledTimes(1);
    } finally {
      settled.resolve();
      exportLog.mockRestore();
      await dispose();
    }
  });

  it('ignores a queued install after a warm link and permits a fresh install after returning', async () => {
    const installAppUpdate = jest.fn(async () => undefined);
    const runtime = createMoreRouteRuntime();
    runtime.update = {
      ...runtime.update,
      phase: 'idle',
      appUpdateBusy: false,
      downloadProgress: createAppUpdateProgress(),
      appUpdateMessage: '',
      installAppUpdate,
      artifact: {
        kind: 'verified',
        bytes: 200,
        update: {
          version: '9.0.0',
          versionName: '9.0.0',
          versionCode: CURRENT_ANDROID_VERSION_CODE + 1,
          packageName: 'com.everythink.wzandroid',
          sha256: 'a'.repeat(64),
          signerSha256: 'b'.repeat(64),
          apkUrl: 'https://github.com/everythink98/wz-android/releases/download/v9.0.0/app-arm64-v8a-release.apk',
          notes: ''
        }
      }
    };
    const { view, followLink, dispose } = await renderWarmMore(({ children }) => (
      <MoreRouteRuntimeProvider value={runtime}>{children}</MoreRouteRuntimeProvider>
    ));
    try {
      const queued = view.getByLabelText('安装');
      await act(async () => {
        followLink();
        await fireEvent.press(queued);
      });
      expect(installAppUpdate).not.toHaveBeenCalled();

      await act(() => navigationRef.goBack());
      await fireEvent.press(view.getByLabelText('安装'));
      expect(installAppUpdate).toHaveBeenCalledTimes(1);
    } finally {
      await dispose();
    }
  });

  it('samples scrolling content below a separately measured glass header', async () => {
    const view = await render(
      <NavigationBackdropProvider>
        <MoreScreen {...moreProps()} />
        <NavigationGlass />
      </NavigationBackdropProvider>
    );
    const content = within(view.getByTestId('more-glass-content'));
    const header = view.getByTestId('more-glass-header');
    expect(within(header).getByText('我的')).toBeTruthy();
    expect(content.queryByText('我的')).toBeNull();
    expect(content.getByTestId('account-site-nodeseek')).toBeTruthy();
    const topGlass = view.getByTestId('navigation-glass-toolbar');
    const bottomGlass = view.getByTestId('navigation-glass');
    expect(topGlass.props.blurTarget.current).toBeTruthy();
    expect(topGlass.props.blurTarget.current).toBe(bottomGlass.props.blurTarget.current);
    await fireEvent(header, 'layout', { nativeEvent: { layout: { height: 104 } } });
    expect(StyleSheet.flatten(view.getByTestId('more-scroll').props.contentContainerStyle).paddingTop).toBe(104);
  });

  it('shows account controls directly above grouped personal settings', async () => {
    const view = await render(<MoreScreen {...moreProps()} />);

    expect(view.getByText('我的')).toBeTruthy();
    expect(view.getByTestId('account-site-nodeseek')).toBeTruthy();
    expect(view.queryByLabelText('展开账号中心')).toBeNull();
    expect(view.queryByLabelText('收起账号中心')).toBeNull();
    expect(view.getByTestId('more-content-sources')).toBeTruthy();
    expect(view.getByTestId('more-appearance')).toBeTruthy();
    expect(
      view.getByText('浅色 ·\u00A0界\u2060面\u00A0100% ·\u00A0阅\u2060读\u00A0100%', { normalizer: (text) => text })
    ).toBeTruthy();
    expect(view.getByRole('button', { name: '收藏' })).toBeTruthy();
    expect(view.getByRole('button', { name: '关注' })).toBeTruthy();
    expect(view.getByRole('button', { name: '历史' })).toBeTruthy();
  });

  it.each(['success', 'failure'] as const)(
    'settles a More font download after returning from another route (%s)',
    async (outcome) => {
      const client = createMoreTestQueryClient();
      const runtime = createMoreRouteRuntime();
      const font = downloadableReaderFonts.find(({ name }) => name === 'Inter')!;
      const downloaded = Promise.withResolvers<LocalReaderFont>();
      mockInstallFont.mockImplementationOnce(() => downloaded.promise);
      const measurement = jest.spyOn(View.prototype, 'measureInWindow').mockImplementation((callback) => {
        callback(160, 240, 180, 44);
      });
      const Stack = createNativeStackNavigator<RootStackParamList>();
      const Tab = createBottomTabNavigator<MainTabParamList>();
      function MainTabs() {
        return (
          <Tab.Navigator screenOptions={{ headerShown: false }}>
            <Tab.Screen name="more" component={MoreRoute} />
          </Tab.Navigator>
        );
      }
      const view = await render(
        <QueryClientProvider client={client}>
          <MoreRouteRuntimeProvider value={runtime}>
            <NavigationContainer ref={navigationRef}>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="MainTabs" component={MainTabs} />
                <Stack.Screen name="ReadingSettings" component={ReadingSettingsRoute} />
              </Stack.Navigator>
            </NavigationContainer>
          </MoreRouteRuntimeProvider>
        </QueryClientProvider>
      );
      try {
        await fireEvent.press(view.getByLabelText('展开外观'));
        await fireEvent.press(view.getByLabelText('阅读字体，思源黑体'));
        await fireEvent.press(await view.findByRole('menuitem', { name: 'Inter，安装' }));
        await waitFor(() => expect(mockInstallFont).toHaveBeenCalledTimes(1));
        await fireEvent.press(view.getByRole('button', { name: '关闭阅读字体选择' }));
        await act(() => navigationRef.navigate('ReadingSettings'));
        await fireEvent.press(await view.findByLabelText('阅读字体，正在连接…'));
        await fireEvent.press(await view.findByRole('menuitem', { name: '跟随系统' }));
        await act(() => navigationRef.goBack());
        expect(await view.findByLabelText('收起外观')).toBeTruthy();
        if (outcome === 'failure') {
          await act(async () => downloaded.reject(new Error('字体下载失败，请重试。')));
          expect(await view.findByRole('alert')).toHaveTextContent('字体下载失败，请重试。');
          await fireEvent.press(view.getByLabelText('阅读字体，思源黑体'));
          expect(await view.findByRole('menuitem', { name: 'Inter，重试' })).toBeEnabled();
        } else {
          await act(async () => downloaded.resolve(font));
          await waitFor(() =>
            expect(client.getQueryData(localReaderFontRegistration(font.family).queryKey)).toBe(true)
          );
          expect(await view.findByLabelText('阅读字体，思源黑体')).toBeTruthy();
        }
        expect(jest.mocked(runtime.reader.commit).mock.calls).toEqual([
          [{ type: 'settings', patch: { fontFamily: 'system' } }]
        ]);
      } finally {
        mockInstallFont.mockReset();
        measurement.mockRestore();
        await view.unmount();
      }
    }
  );

  it('updates download progress without rerunning unrelated account and proxy layout consumers', async () => {
    const queryClient = createMoreTestQueryClient();
    const runtime = createMoreRouteRuntime();
    const reader = runtime.reader.data;
    const Tab = createBottomTabNavigator<MainTabParamList>();
    const navigator = (
      <NavigationContainer>
        <Tab.Navigator screenOptions={{ headerShown: false }}>
          <Tab.Screen name="more" component={MoreRoute} />
        </Tab.Navigator>
      </NavigationContainer>
    );
    const screen = (value: MoreRouteRuntimeValue) => (
      <QueryClientProvider client={queryClient}>
        <MoreRouteRuntimeProvider value={value}>{navigator}</MoreRouteRuntimeProvider>
      </QueryClientProvider>
    );
    const view = await render(screen(runtime));
    await fireEvent.press(view.getByLabelText('展开外观'));
    expect(view.getAllByText('100%')).toHaveLength(2);
    expect(mockWindowDimensionsCalls).toBe(0);
    const beforeProgress = mockWindowDimensionsCalls;

    for (let percent = 10; percent <= 100; percent += 10) {
      await act(async () => {
        runtime.update.downloadProgress.set(formatAppUpdateDownloadProgress('2.0.0', percent, 100));
      });
      expect(view.getByRole('button', { name: '暂停下载' }).props.accessibilityValue.now).toBe(percent);
    }
    expect(mockWindowDimensionsCalls - beforeProgress).toBe(0);

    await view.rerender(
      screen({
        ...runtime,
        reader: { ...runtime.reader, data: { ...reader, settings: { ...reader.settings, fontScale: 1.15 } } }
      })
    );
    expect(view.getByText('115%')).toBeTruthy();
  });

  it.each(['获取 / 恢复授权', '清除 Key', '保存 Key'] as const)(
    'ignores a queued NodeImage %s after opening a warm deep link and keeps a new action available',
    async (action) => {
      const fixtureKey = 'synthetic-local-credential';
      let savedKey: string | null = fixtureKey;
      const nativeDelete = jest.spyOn(SecureStore, 'deleteItemAsync').mockImplementation(async (storageKey) => {
        if (storageKey === NODEIMAGE_API_KEY_STORAGE_KEY) savedKey = null;
      });
      const authorize = jest.fn(async () => undefined);
      const save = jest.fn(async (_value: string) => undefined);
      const runtime = createMoreRouteRuntime(
        moreProps({
          account: {
            center: { nodeImageKey: { authorized: true, saved: true, authorize, clear: clearNodeImageApiKey, save } }
          }
        })
      );
      const { view, followLink, dispose } = await renderWarmMore(({ children }) => (
        <MoreRouteRuntimeProvider value={runtime}>{children}</MoreRouteRuntimeProvider>
      ));
      async function showKeyAction() {
        if (!view.queryByLabelText('站点设置')) await fireEvent.press(view.getByTestId('account-site-nodeseek'));
        if (!view.queryByRole('button', { name: /^NodeImage 授权/ })) {
          await fireEvent.press(view.getByLabelText('站点设置'));
        }
        if (!view.queryByRole('button', { name: '清除 Key' })) {
          await fireEvent.press(view.getByRole('button', { name: /^NodeImage 授权/ }));
        }
        if (action === '保存 Key') {
          if (!view.queryByLabelText('NodeImage API Key 输入')) {
            await fireEvent.press(view.getByLabelText('手动粘贴备用'));
          }
          await fireEvent.changeText(view.getByLabelText('NodeImage API Key 输入'), fixtureKey);
        }
      }
      try {
        await showKeyAction();
        await act(async () => {
          followLink();
          await fireEvent.press(view.getByRole('button', { name: action, includeHiddenElements: true }));
        });
        expect(nativeDelete).not.toHaveBeenCalled();
        expect(savedKey).toBe(fixtureKey);
        expect(authorize).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();

        await act(() => navigationRef.goBack());
        await showKeyAction();
        await fireEvent.press(view.getByRole('button', { name: action }));
        if (action === '清除 Key') {
          await waitFor(() => expect(nativeDelete).toHaveBeenCalledWith(NODEIMAGE_API_KEY_STORAGE_KEY));
          expect(savedKey).toBeNull();
        } else if (action === '保存 Key') expect(save).toHaveBeenCalledWith(fixtureKey);
        else expect(authorize).toHaveBeenCalledTimes(1);
      } finally {
        await dispose();
        nativeDelete.mockRestore();
      }
    }
  );

  it.each([
    { label: '普通签到', random: false },
    { label: '随机签到', random: true }
  ])(
    'does not send a queued $label after a warm deep link and sends a fresh choice once',
    async ({ label, random }) => {
      const user = {
        source: 'nodeseek' as const,
        id: '42',
        username: 'alice',
        url: 'https://www.nodeseek.com/space/42'
      };
      const ticket = { source: user.source, identityKey: 'nodeseek:42', sessionEpoch: 0 };
      const sessions = projectTestAccountSessions(
        createSiteSessionStates({
          nodeseek: { site: 'nodeseek', status: 'logged-in', isVerifying: false, cookieSummary: [], currentUser: user }
        })
      );
      const props = moreProps({ account: { read: { sessions } } });
      const fetcher = jest.fn<Fetcher>(async (_input, init) => {
        prepareRequestToSend(init);
        return Response.json({ success: true });
      });
      const readAttendance = async (): Promise<NodeSeekAttendanceBoard> => ({
        source: 'nodeseek',
        userId: user.id,
        list: [],
        record: fetcher.mock.calls.length
          ? { id: '1', memberId: user.id, dayId: 8, gain: 2, createdAt: '2026-11-20T00:00:00.000Z' }
          : null,
        order: null,
        total: 0
      });
      props.account.read.gateway = {
        ...props.account.read.gateway,
        getReadPlan: (source, operation) => ({
          source,
          operation,
          state: 'ready',
          lane: 'authenticated',
          transport: 'managed-session',
          cacheScope: 'authenticated:0'
        }),
        getUserDetails: async () => user,
        getNodeSeekAccountOverview: async () => ({ source: 'nodeseek', userId: user.id, profile: user, coin: 5 }),
        getNodeSeekAttendanceBoard: readAttendance
      };
      const runtime = createMoreRouteRuntime(props);
      function AttendanceRuntime({ children }: { children: React.ReactNode }) {
        const controller = useNodeSeekCheckInController({
          currentSessionTicket: ticket,
          ensureWritableSession: async () => ticket,
          fetcher,
          isWritableSessionTicketCurrent: (candidate) => candidate === ticket,
          getNodeSeekUserAgent: () => 'fixture',
          notify: runtime.notify,
          onSessionExpired: () => {},
          readAttendance
        });
        const account = runtime.account;
        return (
          <MoreRouteRuntimeProvider
            value={{
              ...runtime,
              account: {
                ...account,
                center: {
                  ...account.center,
                  nodeSeek: {
                    busy: controller.busy,
                    state: controller.state,
                    checkIn: controller.checkIn,
                    observeBoard: (board) => controller.observeBoard(board, ticket)
                  }
                }
              }
            }}
          >
            {children}
          </MoreRouteRuntimeProvider>
        );
      }
      const { view, followLink, dispose } = await renderWarmMore(AttendanceRuntime);
      try {
        expect(await view.findByLabelText(label)).toBeEnabled();
        await act(async () => {
          followLink();
          await fireEvent.press(view.getByLabelText(label, { includeHiddenElements: true }));
        });
        expect(fetcher).not.toHaveBeenCalled();

        await act(() => navigationRef.goBack());
        await fireEvent.press(await view.findByLabelText(label));
        await waitFor(() => expect(view.getByText('今日已签到 · 获得 2 鸡腿')).toBeTruthy());
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith(
          `https://www.nodeseek.com/api/attendance?random=${random}`,
          expect.objectContaining({ method: 'POST' })
        );
      } finally {
        await dispose();
      }
    }
  );
  it.each(['selected', 'draft', 'save'] as const)(
    'rejects a late %s proxy action after a warm topic link',
    async (mode) => {
      const profile = {
        id: 'fixture-proxy',
        name: '测试代理',
        protocol: 'http' as const,
        host: 'proxy.example.test',
        port: 8080
      };
      const deleteProfile = jest.fn(async (_id: string) => undefined);
      const upsertProfile = jest.fn(async () => undefined);
      const write = mode === 'save' ? upsertProfile : deleteProfile;
      const runtime = createMoreRouteRuntime();
      runtime.proxy.activeProfile = profile;
      runtime.proxy.proxyState = { activeId: profile.id, enabled: true, profiles: [profile] };
      runtime.proxy.deleteProxyProfile = deleteProfile;
      runtime.proxy.upsertProxyProfile = upsertProfile;
      const queryClient = createMoreTestQueryClient();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      let openLink: ((event: { url: string }) => void) | undefined;
      const linking: NonNullable<Parameters<typeof useAppDeepLinkNavigation>[0]> = {
        getInitialURL: async () => null,
        addEventListener: (type, listener) => {
          openLink = listener;
          return Linking.addEventListener(type, listener);
        }
      };
      const Tab = createBottomTabNavigator<MainTabParamList>();
      const Stack = createNativeStackNavigator<RootStackParamList>();
      function Tabs() {
        return (
          <Tab.Navigator screenOptions={{ headerShown: false }}>
            <Tab.Screen name="more" component={MoreRoute} />
          </Tab.Navigator>
        );
      }
      function Routes() {
        useAppDeepLinkNavigation(linking);
        return (
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="MainTabs" component={Tabs} />
              <Stack.Screen name="Topic">{() => <Text>通过链接打开的主题</Text>}</Stack.Screen>
              <Stack.Screen name="NetworkSettings" component={NetworkSettingsRoute} />
            </Stack.Navigator>
          </NavigationContainer>
        );
      }
      const view = await render(
        <QueryClientProvider client={queryClient}>
          <MoreRouteRuntimeProvider value={runtime}>
            <Routes />
          </MoreRouteRuntimeProvider>
        </QueryClientProvider>
      );
      async function prepareAction() {
        if (navigationRef.getCurrentRoute()?.name !== 'NetworkSettings') {
          await fireEvent.press(view.getByTestId('more-proxy'));
          await fireEvent.press(view.getByText('管理代理'));
        }
        if (mode === 'save') {
          await fireEvent.press(view.getByText('添加代理'));
          await fireEvent.changeText(view.getByLabelText('名称'), '新代理');
          await fireEvent.changeText(view.getByLabelText('服务器'), 'proxy.example.test');
          await fireEvent.changeText(view.getByLabelText('端口'), '8080');
          return () => fireEvent.press(view.getByLabelText('确定', { includeHiddenElements: true }));
        }
        if (mode === 'selected') {
          await fireEvent(view.getByText(profile.name), 'longPress');
          await fireEvent.press(view.getByLabelText('删除选中的代理'));
        } else {
          await fireEvent.press(view.getByLabelText('编辑代理'));
          await fireEvent.press(view.getByRole('button', { name: '删除' }));
        }
        const confirm = alert.mock.calls.at(-1)?.[2]?.find((action) => action.style === 'destructive')?.onPress;
        if (!confirm) throw new Error('Missing destructive proxy confirmation');
        return confirm;
      }
      try {
        const oldAction = await prepareAction();
        expect(write).not.toHaveBeenCalled();
        await act(async () => {
          openLink?.({ url: 'https://linux.do/t/topic/123' });
          expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
          await oldAction();
        });
        expect(view.getByText('通过链接打开的主题')).toBeTruthy();
        expect(write).not.toHaveBeenCalled();
        await act(() => navigationRef.goBack());
        const currentAction = await prepareAction();
        if (mode !== 'save') await act(async () => oldAction());
        expect(write).not.toHaveBeenCalled();
        await act(async () => currentAction());
        expect(write).toHaveBeenCalledTimes(1);
        if (mode === 'save') expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ name: '新代理' }));
        else expect(deleteProfile).toHaveBeenCalledWith(profile.id);
      } finally {
        alert.mockRestore();
        await view.unmount();
      }
    }
  );

  it('keeps appearance content measurable while collapsed and discards unfinished font-size previews', async () => {
    const updateSettings = jest.fn();
    const props = moreProps();
    function AppearanceHarness() {
      const [visible, setVisible] = useState(false);
      const [settings, setSettings] = useState(readerData.settings);
      return (
        <MoreScreen
          {...props}
          utilities={{
            ...props.utilities,
            settings: {
              value: settings,
              visible,
              changeVisible: setVisible,
              update: (patch) => {
                updateSettings(patch);
                setSettings((current) => ({ ...current, ...patch }));
              }
            }
          }}
        />
      );
    }
    const view = await render(<AppearanceHarness />);
    const slider = view.getByTestId('appearance-reading-font-scale-slider', { includeHiddenElements: true });
    await fireEvent.press(view.getByLabelText('展开外观'));
    expect(view.getByTestId('appearance-reading-font-scale-slider')).toBe(slider);
    let step = view.getByLabelText('增大阅读字号');
    while (StyleSheet.flatten(step.props.style)?.width === undefined) step = step.parent!;
    expect(StyleSheet.flatten(step.props.style)).toMatchObject({ width: 48, height: 48 });
    await fireEvent(slider, 'valueChange', 1.15);
    expect(view.getByText('115%')).toBeTruthy();
    expect(updateSettings).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('收起外观'));
    expect(view.getByTestId('appearance-reading-font-scale-slider', { includeHiddenElements: true })).toBe(slider);
    expect(view.queryByLabelText('增大阅读字号')).toBeNull();
    expect(view.getAllByText('100%', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(view.getByLabelText('增大阅读字号', { includeHiddenElements: true }));
    await act(async () => {
      slider.props.onRNCSliderValueChange({ nativeEvent: { value: 1.3 } });
      slider.props.onRNCSliderSlidingComplete({ nativeEvent: { value: 1.3 } });
    });
    expect(view.getAllByText('100%', { includeHiddenElements: true })).toBeTruthy();
    expect(updateSettings).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('展开外观'));
    expect(view.getByTestId('appearance-reading-font-scale-slider')).toBe(slider);
    expect(view.getAllByText('100%')).toHaveLength(2);
    await fireEvent(view.getByTestId('appearance-reading-font-scale-slider'), 'slidingComplete', 1.1);
    expect(updateSettings.mock.calls).toEqual([[{ fontScale: 1.1 }]]);
    await fireEvent.press(view.getByLabelText('收起外观'));
    expect(view.getByText('110%', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(view.getByLabelText('展开外观'));
    expect(view.getByText('110%')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('增大阅读字号'));
    expect(updateSettings.mock.calls).toEqual([[{ fontScale: 1.1 }], [{ fontScale: 1.15 }]]);
  });

  it('keeps the selected site when all account sources are temporarily disabled', async () => {
    const enabled = moreProps({ account: { enabledSessionSources: ['linuxdo', 'nodeseek'] } });
    const view = await render(<MoreScreen {...enabled} />);

    await fireEvent.press(view.getByTestId('account-site-linuxdo'));

    await view.rerender(<MoreScreen {...moreProps({ account: { enabledSessionSources: [] } })} />);
    expect(view.getByText('尚未启用账号站点')).toBeTruthy();
    await view.rerender(<MoreScreen {...enabled} />);

    expect(view.getByTestId('account-site-linuxdo').props.accessibilityState.selected).toBe(true);
  });

  it.each(['verification', 'credential-fill'] as const)(
    'keeps the %s account selected after its surface closes',
    async (trigger) => {
      const initial = moreProps();
      const requested = moreProps({
        account:
          trigger === 'verification'
            ? { surfaces: { linuxdo: true } }
            : { center: { credentials: { pendingFillSite: 'linuxdo' } } }
      });
      const view = await render(<MoreScreen {...initial} />);

      await view.rerender(<MoreScreen {...requested} />);
      expect(view.getByTestId('account-site-linuxdo').props.accessibilityState.selected).toBe(true);
      await view.rerender(<MoreScreen {...initial} />);
      expect(view.getByTestId('account-site-linuxdo').props.accessibilityState.selected).toBe(true);
    }
  );

  it('shows the separate LDC balance in the LinuxDo profile and opens its income and expense records', async () => {
    const props = moreProps({
      account: { enabledSessionSources: ['linuxdo'], read: { sessions: authorizedLinuxDoSessions } }
    });
    const getBalance = jest.fn<MoreScreenProps['account']['read']['gateway']['getLinuxDoCreditAccount']>(async () => ({
      userId: '7',
      username: 'alice',
      availableBalance: '1234.50',
      pendingBalance: '2.25'
    }));
    const getTransactions = jest.fn<MoreScreenProps['account']['read']['gateway']['getLinuxDoCreditTransactions']>();
    props.account.read.gateway = {
      ...props.account.read.gateway,
      getReadPlan: (source, operation) => ({
        source,
        operation,
        state: 'ready',
        lane: 'authenticated',
        transport: 'managed-session',
        cacheScope: 'authenticated:ldc-profile'
      }),
      getLinuxDoCreditAccount: getBalance,
      getLinuxDoCreditTransactions: getTransactions
    };
    const view = await render(<MoreScreen {...props} />);
    await waitFor(() => expect(view.getByLabelText('LDC 可用余额 1,234.50')).toBeTruthy());
    expect(view.getByText('待到账 2.25 LDC')).toBeTruthy();
    expect(getTransactions).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('LDC 可用余额 1,234.50'));
    expect(props.account.center.openLinuxDoCredit).toHaveBeenCalledTimes(1);
    expect(view.queryByRole('button', { name: '刷新 LDC 余额' })).toBeNull();
    expect(getBalance).toHaveBeenCalledTimes(1);
    expect(getTransactions).not.toHaveBeenCalled();
  });

  it('requests background LDC connection and shows loading until that attempt releases the account barrier', async () => {
    const props = moreProps({
      account: { enabledSessionSources: ['linuxdo'], read: { sessions: authorizedLinuxDoSessions } }
    });
    props.account.read.gateway = {
      ...props.account.read.gateway,
      getReadPlan: (source, operation) => ({
        source,
        operation,
        state: 'ready',
        lane: 'authenticated',
        transport: 'managed-session',
        cacheScope: 'authenticated:ldc-profile'
      }),
      getLinuxDoCreditAccount: async () => {
        throw new LinuxDoCreditError('authorization-required', '请先连接 LDC');
      }
    };
    const view = await render(<MoreScreen {...props} />);
    await waitFor(() => expect(props.account.center.linuxDoCredit.connectSilently).toHaveBeenCalledTimes(1));
    expect(props.account.center.linuxDoCredit.open).not.toHaveBeenCalled();
    await view.rerender(
      <MoreScreen
        {...props}
        account={{
          ...props.account,
          center: {
            ...props.account.center,
            linuxDoCredit: { ...props.account.center.linuxDoCredit, busy: true }
          }
        }}
      />
    );
    expect(view.getByText('读取余额中')).toBeTruthy();
    expect(view.queryByText('请先连接 LDC')).toBeNull();
    expect(view.queryByRole('button', { name: '连接 LDC' })).toBeNull();
    await view.rerender(<MoreScreen {...props} />);
    expect(view.getByText('请先连接 LDC')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: '连接 LDC' }));
    expect(props.account.center.linuxDoCredit.open).toHaveBeenCalledTimes(1);
  });

  it.each(['collapsed', 'inactive'] as const)(
    'pauses a retained pending level indicator while %s and resumes it without another read',
    async (hidden) => {
      const props = moreProps({
        account: {
          enabledSessionSources: ['linuxdo'],
          read: { sessions: authorizedLinuxDoSessions },
          center: { linuxDoLevel: { busy: true } }
        }
      });
      const view = await render(<MoreScreen {...props} />);
      const animatingIndicators = () =>
        view.root?.queryAll(
          (instance) => instance.props.accessibilityRole === 'progressbar' && instance.props.accessibilityState?.busy
        ) ?? [];
      await fireEvent.press(view.getByText('linux.do 等级'));
      const reading = view.getByText('加载中');
      expect(animatingIndicators().length).toBeGreaterThan(0);

      if (hidden === 'collapsed') await fireEvent.press(view.getByText('linux.do 等级'));
      else await view.rerender(<MoreScreen {...props} account={{ ...props.account, active: false }} />);

      expect(view.getByText('加载中', { includeHiddenElements: true })).toBe(reading);
      if (hidden === 'collapsed') expect(view.queryByText('加载中')).toBeNull();
      expect(props.account.center.linuxDoLevel.busy).toBe(true);
      expect(animatingIndicators()).toHaveLength(0);
      if (hidden === 'inactive') expect(view.getByLabelText('刷新中').props.accessibilityState.disabled).toBe(true);

      if (hidden === 'collapsed') await fireEvent.press(view.getByText('linux.do 等级'));
      else await view.rerender(<MoreScreen {...props} />);
      expect(view.getByText('加载中')).toBe(reading);
      expect(animatingIndicators().length).toBeGreaterThan(0);
      expect(props.account.center.linuxDoLevel.refresh).not.toHaveBeenCalled();
    }
  );

  it('refreshes level details through the unified account action only after the user expands them', async () => {
    const refreshLevel = jest.fn();
    const props = moreProps({
      account: {
        enabledSessionSources: ['linuxdo'],
        read: { sessions: authorizedLinuxDoSessions },
        center: { linuxDoLevel: { error: '等级读取失败', refresh: refreshLevel } }
      }
    });
    const view = await render(<MoreScreen {...props} />);

    expect(view.queryByLabelText('重试等级', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('刷新账号'));
    expect(refreshLevel).not.toHaveBeenCalled();
    await fireEvent.press(view.getByText('linux.do 等级'));
    const retryLevel = view.getByLabelText('重试等级');
    await fireEvent.press(view.getByLabelText('刷新账号'));
    await waitFor(() => expect(refreshLevel).toHaveBeenCalledTimes(1));
    await fireEvent.press(retryLevel);
    expect(refreshLevel).toHaveBeenCalledTimes(2);
    await fireEvent.press(view.getByText('linux.do 等级'));
    expect(view.queryByLabelText('重试等级')).toBeNull();
    expect(view.getByLabelText('重试等级', { includeHiddenElements: true })).toBe(retryLevel);
    await view.rerender(
      <MoreScreen {...props} account={{ ...props.account, enabledSessionSources: ['nodeseek', 'linuxdo'] }} />
    );
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    expect(view.queryByLabelText('重试等级', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByText('linux.do 等级'));
    expect(view.getByLabelText('重试等级')).toBeTruthy();

    const withLinuxDoUser = (id: string) => (
      <MoreScreen
        {...props}
        account={{
          ...props.account,
          read: {
            ...props.account.read,
            sessions: {
              ...props.account.read.sessions,
              linuxdo: {
                ...props.account.read.sessions.linuxdo,
                currentUser: { source: 'linuxdo', id, username: id, url: `https://linux.do/u/${id}` }
              }
            }
          }
        }}
      />
    );
    const previousOwnerRetry = view.getByLabelText('重试等级');
    await view.rerender(withLinuxDoUser('next-owner'));
    const currentOwnerRetry = view.getByLabelText('重试等级');
    expect(currentOwnerRetry).not.toBe(previousOwnerRetry);
    await fireEvent.press(view.getByText('linux.do 等级'));
    expect(view.getByLabelText('重试等级', { includeHiddenElements: true })).toBe(currentOwnerRetry);
    await view.rerender(withLinuxDoUser('later-owner'));
    expect(view.queryByLabelText('重试等级', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByText('linux.do 等级'));
    expect(view.getByLabelText('重试等级')).toBeTruthy();
    expect(refreshLevel).toHaveBeenCalledTimes(2);
  });

  it('reuses cached metric controls and resets low-frequency details across sources and user identities', async () => {
    const nodeSeekUser = (id: string) => ({
      source: 'nodeseek' as const,
      id,
      username: `fixture-${id}`,
      url: `https://www.nodeseek.com/space/${id}`
    });
    const linuxDoUser = {
      source: 'linuxdo' as const,
      id: 'metric-user',
      username: 'metric-user',
      url: 'https://linux.do/u/metric-user'
    };
    const nodeSeekProfile = (id: string) => ({
      ...nodeSeekUser(id),
      topicCount: 0,
      replyCount: 8,
      bio: `NS 资料 ${id}`
    });
    const linuxDoProfile = {
      ...linuxDoUser,
      topicCount: 3,
      replyCount: 9,
      likesReceived: 7,
      timeRead: 600,
      bio: 'L 资料'
    };
    const getUserDetails = jest.fn<MoreScreenProps['account']['read']['gateway']['getUserDetails']>(
      async ({ source, id }) => (source === 'linuxdo' ? linuxDoProfile : nodeSeekProfile(id))
    );
    const getOverview = jest.fn<MoreScreenProps['account']['read']['gateway']['getNodeSeekAccountOverview']>(
      async ({ userId }) => ({ source: 'nodeseek', userId, profile: nodeSeekProfile(userId), coin: 5, stardust: 2 })
    );
    const getBoard = jest.fn<MoreScreenProps['account']['read']['gateway']['getNodeSeekAttendanceBoard']>(
      async ({ userId }) => ({ source: 'nodeseek', userId, list: [], record: null, order: null, total: 0 })
    );
    const command = jest.fn<MoreScreenProps['account']['center']['command']>();
    const openCredits = jest.fn<MoreScreenProps['account']['center']['openCredits']>();
    const propsFor = (id: string) => {
      const props = moreProps({
        account: {
          enabledSessionSources: ['nodeseek', 'linuxdo'],
          center: { command },
          read: {
            sessions: projectTestAccountSessions(
              createSiteSessionStates({
                nodeseek: {
                  site: 'nodeseek',
                  status: 'logged-in',
                  cookieSummary: [],
                  isVerifying: false,
                  currentUser: nodeSeekUser(id)
                },
                linuxdo: {
                  site: 'linuxdo',
                  status: 'logged-in',
                  cookieSummary: [],
                  isVerifying: false,
                  currentUser: linuxDoUser
                }
              })
            )
          }
        }
      });
      props.account.read.gateway = {
        ...props.account.read.gateway,
        getReadPlan: (source, operation) => ({
          source,
          operation,
          state: 'ready',
          lane: 'authenticated',
          transport: 'managed-session',
          cacheScope: 'authenticated:metrics'
        }),
        getUserDetails,
        getNodeSeekAccountOverview: getOverview,
        getNodeSeekAttendanceBoard: getBoard
      };
      props.account.center.openCredits = openCredits;
      return props;
    };
    const view = await render(<MoreScreen {...propsFor('42')} />);

    await waitFor(() => expect(view.getByLabelText('回复 8')).toBeTruthy());
    await waitFor(() => expect(view.getByLabelText('鸡腿 5')).toBeTruthy());
    expect(view.queryByText('NS 资料 42', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('更多资料'));
    const details = view.getByText('NS 资料 42');
    await fireEvent.press(view.getByLabelText('收起资料'));
    expect(view.getByText('NS 资料 42', { includeHiddenElements: true })).toBe(details);
    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    await waitFor(() => expect(view.getByLabelText('回复 9')).toBeTruthy());
    const linuxDoMetrics = ['主题 3', '回复 9', '获赞 7', '阅读时长 10 分'].map((label) => view.getByLabelText(label));
    expect(view.queryByLabelText('鸡腿 5')).toBeNull();
    expect(view.queryByLabelText('星辰 2')).toBeNull();
    for (const metric of linuxDoMetrics.slice(2)) {
      expect(metric.props.accessibilityRole).toBeUndefined();
      expect(metric.props.accessibilityHint).toBeUndefined();
      await fireEvent.press(metric);
    }
    expect(openCredits).not.toHaveBeenCalled();
    const replyMetric = view.getByLabelText('回复 9');
    expect(view.queryByText('L 资料', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('更多资料'));
    expect(view.getByText('L 资料')).toBeTruthy();
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    expect(view.getByLabelText('回复 8')).toBe(replyMetric);
    const nodeSeekMetrics = ['主题 0', '回复 8', '鸡腿 5', '星辰 2'].map((label) => view.getByLabelText(label));
    await fireEvent.press(view.getByLabelText('鸡腿 5'));
    expect(openCredits).toHaveBeenLastCalledWith('coin');
    await fireEvent.press(view.getByLabelText('星辰 2'));
    expect(openCredits).toHaveBeenLastCalledWith('stardust');
    expect(openCredits).toHaveBeenCalledTimes(2);
    expect(view.getByLabelText('更多资料').props.accessibilityState.expanded).toBe(false);
    expect(view.queryByText('NS 资料 42', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByText('L 资料', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    expect(view.getByLabelText('回复 9')).toBe(replyMetric);
    const cachedLinuxDoMetrics = ['主题 3', '回复 9', '获赞 7', '阅读时长 10 分'].map((label) =>
      view.getByLabelText(label)
    );
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    expect(getUserDetails).toHaveBeenCalledTimes(1);
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(getBoard).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText('更多资料'));
    await view.rerender(<MoreScreen {...propsFor('43')} />);
    await waitFor(() => expect(view.getByLabelText('鸡腿 5')).toBeTruthy());
    expect(view.queryByText('NS 资料 42', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByText('NS 资料 43', { includeHiddenElements: true })).toBeNull();
    expect(view.getByLabelText('更多资料').props.accessibilityState.expanded).toBe(false);
    await fireEvent.press(view.getByLabelText('回复 8'));
    expect(command).toHaveBeenLastCalledWith({ type: 'open-user', user: nodeSeekUser('43'), initialTab: 'replies' });
    expect(cachedLinuxDoMetrics.map((metric, index) => metric === nodeSeekMetrics[index])).toEqual([
      true,
      true,
      true,
      true
    ]);
  });

  it('resets open profile details in the same commit as a source or user change', async () => {
    const commits = jest.fn();
    const styles = createMoreScreenStyles(
      createTheme(readerData.settings),
      resolveReaderStyleSettings(readerData.settings)
    );
    const panel = (site: 'nodeseek' | 'linuxdo', id: string) => {
      const profile = {
        source: site,
        id,
        username: 'fixture',
        url: `https://account.invalid/${id}`,
        bio: `${site} ${id}`
      };
      const data = {
        profile,
        overview: undefined,
        board: undefined,
        boardBusy: false,
        boardError: null,
        boardUpdatedAt: 0,
        busy: false,
        error: null,
        updatedAt: 0,
        refresh: async () => undefined,
        retryOverview: async () => undefined,
        retryAttendance: async () => undefined
      } satisfies ComponentProps<typeof AccountOverviewPanel>['data'];
      return (
        <Profiler id="profile-details" onRender={commits}>
          <AccountOverviewPanel
            data={data}
            site={site}
            user={profile}
            styles={styles}
            onCommand={jest.fn<() => void>()}
            onOpenCredits={jest.fn()}
          />
        </Profiler>
      );
    };
    const view = await render(panel('nodeseek', '42'));
    for (const site of ['linuxdo', 'nodeseek'] as const) {
      commits.mockClear();
      mockWindowDimensionsCalls = 0;
      await view.rerender(panel(site, '42'));
      expect(mockWindowDimensionsCalls).toBe(1);
      expect(commits).toHaveBeenCalledTimes(1);
      expect(view.queryByText(`${site} 42`, { includeHiddenElements: true })).toBeNull();
    }
    await fireEvent.press(view.getByLabelText('更多资料'));
    expect(view.getByText('nodeseek 42')).toBeTruthy();
    for (const [site, id] of [
      ['linuxdo', '42'],
      ['linuxdo', '43']
    ] as const) {
      commits.mockClear();
      await view.rerender(panel(site, id));
      expect(commits).toHaveBeenCalledTimes(1);
      expect(view.getByLabelText('更多资料').props.accessibilityState.expanded).toBe(false);
      expect(view.queryByText(`${site} ${id}`, { includeHiddenElements: true })).toBeNull();
      await fireEvent.press(view.getByLabelText('更多资料'));
      expect(view.getByText(`${site} ${id}`)).toBeTruthy();
    }
  });

  it.each([
    { site: 'nodeseek' as const, labels: ['主题', '回复', '鸡腿', '星辰'], values: ['0', '8', '0', '2'] },
    { site: 'linuxdo' as const, labels: ['主题', '回复', '获赞', '阅读时长'], values: ['0', '8', '0', '0 分'] },
    { site: 'yaohuo' as const, labels: ['帖子', '回复', '妖晶', '经验'], values: ['0', '8', '0', '2'] }
  ])('keeps account metric slots visible while $site data arrives or fails', async ({ site, labels, values }) => {
    const user = { source: site, id: '42', username: 'fixture', url: 'https://account.invalid/42' };
    const theme = createTheme(readerData.settings);
    const styles = createMoreScreenStyles(theme, resolveReaderStyleSettings(readerData.settings));
    const command = jest.fn<ComponentProps<typeof AccountOverviewPanel>['onCommand']>();
    const openCredits = jest.fn<ComponentProps<typeof AccountOverviewPanel>['onOpenCredits']>();
    const data = {
      profile: undefined,
      overview: undefined,
      board: undefined,
      boardBusy: false,
      boardError: null,
      boardUpdatedAt: 0,
      busy: true,
      error: null,
      updatedAt: 0,
      refresh: async () => undefined,
      retryOverview: async () => undefined,
      retryAttendance: async () => undefined
    } satisfies ComponentProps<typeof AccountOverviewPanel>['data'];
    const panel = (next: ComponentProps<typeof AccountOverviewPanel>['data']) => (
      <AccountOverviewPanel
        data={next}
        site={site}
        user={user}
        styles={styles}
        onCommand={command}
        onOpenCredits={openCredits}
      />
    );
    const view = await render(panel(data));
    const slots = labels.map((label) => view.getByLabelText(`${label} 加载中`));
    expect(view.getAllByText('—')).toHaveLength(4);
    for (const slot of slots) {
      expect(slot.props.accessibilityState.busy).toBe(true);
      expect(StyleSheet.flatten(within(slot).getByText('—').props.style).color).toBe(theme.muted);
    }
    for (const label of ['我的主题', '我的帖子', '我的回复', '鸡腿流水', '星辰流水']) {
      expect(view.queryByLabelText(label)).toBeNull();
    }

    const partial = { ...data, profile: { ...user, topicCount: 0 } };
    await view.rerender(panel(partial));
    expect(view.getByLabelText(`${labels[0]} 0`)).toBe(slots[0]);
    expect(slots[0].props.accessibilityState.busy).toBe(false);
    expect(view.getAllByText('—')).toHaveLength(3);
    labels.slice(1).forEach((label, index) => {
      expect(view.getByLabelText(`${label} 加载中`)).toBe(slots[index + 1]);
    });

    await view.rerender(panel({ ...partial, busy: false, error: new Error('资料读取失败') }));
    labels.slice(1).forEach((label, index) => {
      expect(view.getByLabelText(`${label} 暂无数据`)).toBe(slots[index + 1]);
      expect(slots[index + 1].props.accessibilityState.busy).toBe(false);
    });
    await fireEvent.press(view.getByLabelText(`${labels[0]} 0`));
    expect(command).toHaveBeenLastCalledWith({ type: 'open-user', user, initialTab: 'topics' });
    await fireEvent.press(view.getByLabelText('回复 暂无数据'));
    expect(command).toHaveBeenLastCalledWith({ type: 'open-user', user, initialTab: 'replies' });
    if (site === 'nodeseek') {
      await fireEvent.press(view.getByLabelText('鸡腿 暂无数据'));
      expect(openCredits).toHaveBeenLastCalledWith('coin');
      await fireEvent.press(view.getByLabelText('星辰 暂无数据'));
      expect(openCredits).toHaveBeenLastCalledWith('stardust');
    }

    const profile = { ...user, topicCount: 0, replyCount: 8, likesReceived: 0, timeRead: 0 };
    const complete = {
      ...data,
      profile,
      overview:
        site === 'nodeseek'
          ? { source: 'nodeseek' as const, userId: user.id, profile, coin: 0, stardust: 2 }
          : site === 'yaohuo'
            ? { source: 'yaohuo' as const, userId: user.id, profile, crystals: 0, experience: 2 }
            : undefined,
      busy: false
    };
    await view.rerender(panel(complete));
    await view.rerender(panel({ ...complete, busy: true }));
    labels.forEach((label, index) => {
      expect(view.getByLabelText(`${label} ${values[index]}`)).toBe(slots[index]);
      expect(slots[index].props.accessibilityState.busy).toBe(false);
    });
    expect(view.queryByText('—')).toBeNull();
    for (const label of ['我的主题', '我的帖子', '我的回复', '鸡腿流水', '星辰流水']) {
      expect(view.queryByLabelText(label)).toBeNull();
    }
  });

  it('shows targeted retries only for failed data and never resubmits attendance', async () => {
    const user = { source: 'nodeseek' as const, id: '42', username: 'alice', url: 'https://www.nodeseek.com/space/42' };
    const profile = { ...user, topicCount: 1 };
    const getUserDetails = jest.fn(async () => profile).mockRejectedValueOnce(new Error('主页读取失败'));
    const getOverview = jest
      .fn(async () => ({ source: 'nodeseek' as const, userId: '42', profile, coin: 5 }))
      .mockRejectedValueOnce(new Error('概要读取失败'));
    const getAttendance = jest
      .fn(async () => ({ source: 'nodeseek' as const, userId: '42', list: [], record: null, order: null, total: 0 }))
      .mockRejectedValueOnce(new Error('看板读取失败'));
    const props = moreProps({
      account: {
        read: {
          sessions: projectTestAccountSessions(
            createSiteSessionStates({
              nodeseek: {
                site: 'nodeseek',
                status: 'logged-in',
                isVerifying: false,
                cookieSummary: [],
                currentUser: user
              }
            })
          )
        }
      }
    });
    props.account.read.gateway = {
      ...props.account.read.gateway,
      getReadPlan: (source, operation) => ({
        source,
        operation,
        state: 'ready',
        lane: 'authenticated',
        transport: 'managed-session',
        cacheScope: 'authenticated:0'
      }),
      getUserDetails,
      getNodeSeekAccountOverview: getOverview,
      getNodeSeekAttendanceBoard: getAttendance
    };
    const view = await render(<MoreScreen {...props} />);

    await waitFor(() => expect(view.getByLabelText('重试资料')).toBeTruthy());
    await waitFor(() => expect(view.getByLabelText('重试签到状态')).toBeTruthy());
    const coinSlot = await view.findByLabelText('鸡腿 暂无数据');
    const stardustSlot = view.getByLabelText('星辰 暂无数据');
    expect(coinSlot.props.accessibilityState.busy).toBe(false);
    expect(stardustSlot.props.accessibilityState.busy).toBe(false);
    await fireEvent.press(coinSlot);
    expect(props.account.center.openCredits).toHaveBeenLastCalledWith('coin');
    await fireEvent.press(stardustSlot);
    expect(props.account.center.openCredits).toHaveBeenLastCalledWith('stardust');
    await fireEvent.press(view.getByLabelText('重试资料'));
    await waitFor(() => expect(view.getByLabelText('鸡腿 5')).toBe(coinSlot));
    expect(view.queryByLabelText('鸡腿流水')).toBeNull();
    expect(view.queryByLabelText('星辰流水')).toBeNull();
    expect(view.getByLabelText('星辰 暂无数据')).toBe(stardustSlot);
    expect(getUserDetails).toHaveBeenCalledTimes(2);
    expect(getOverview).toHaveBeenCalledTimes(2);
    expect(getAttendance).toHaveBeenCalledTimes(1);
    expect(view.queryByLabelText('重试资料')).toBeNull();
    await fireEvent.press(view.getByLabelText('重试签到状态'));
    await waitFor(() => expect(view.queryByLabelText('重试签到状态')).toBeNull());
    expect(getAttendance).toHaveBeenCalledTimes(2);
    expect(getUserDetails).toHaveBeenCalledTimes(2);
    expect(getOverview).toHaveBeenCalledTimes(2);
    expect(props.account.center.nodeSeek.checkIn).not.toHaveBeenCalled();
    expect(props.account.center.command).not.toHaveBeenCalled();
  });

  it('cancels the old identity read and never displays its balance after switching accounts', async () => {
    const user = { source: 'nodeseek' as const, id: '42', username: 'alice', url: 'https://www.nodeseek.com/space/42' };
    const accountSessions = (id: string) =>
      projectTestAccountSessions(
        createSiteSessionStates({
          nodeseek: {
            site: 'nodeseek',
            status: 'logged-in',
            isVerifying: false,
            cookieSummary: [],
            currentUser: { ...user, id }
          }
        })
      );
    let finishOldRead: ((value: NodeSeekAccountOverview) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    const oldRead = new Promise<NodeSeekAccountOverview>((resolve) => {
      finishOldRead = resolve;
    });
    const getOverview = jest.fn(({ userId, signal }: { userId: string; signal?: AbortSignal }) => {
      if (userId === '42') {
        oldSignal = signal;
        return oldRead;
      }
      return Promise.resolve({ source: 'nodeseek' as const, userId, profile: { ...user, id: userId }, coin: 7 });
    });
    const props = moreProps({ account: { read: { sessions: accountSessions('42') } } });
    props.account.read.gateway = {
      ...props.account.read.gateway,
      getReadPlan: (source, operation) => ({
        source,
        operation,
        state: 'ready',
        lane: 'authenticated',
        transport: 'managed-session',
        cacheScope: 'authenticated'
      }),
      getUserDetails: async ({ id }) => ({ ...user, id }),
      getNodeSeekAccountOverview: getOverview,
      getNodeSeekAttendanceBoard: async ({ userId }) => ({
        source: 'nodeseek',
        userId,
        list: [],
        record: null,
        order: null,
        total: 0
      })
    };
    const view = await render(<MoreScreen {...props} />);

    await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(1));
    await view.rerender(
      <MoreScreen
        {...props}
        account={{
          ...props.account,
          read: {
            ...props.account.read,
            sessions: accountSessions('43'),
            sessionEpochs: { ...initialForumSessionEpochs, nodeseek: 1 }
          }
        }}
      />
    );
    await waitFor(() => expect(view.getByLabelText('鸡腿 7')).toBeTruthy());
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => finishOldRead?.({ source: 'nodeseek', userId: '42', profile: user, coin: 999 }));
    expect(view.queryByLabelText('鸡腿 999')).toBeNull();
    expect(view.getByLabelText('鸡腿 7')).toBeTruthy();
  });

  it('loads only the selected confirmed account, exposes zero statistics, and pauses reads while inactive', async () => {
    const user = {
      source: 'nodeseek' as const,
      id: '42',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://www.nodeseek.com/space/42'
    };
    const profile = {
      ...user,
      topicCount: 0,
      replyCount: 8,
      bio: '我的简介',
      joinedAt: new Date(2026, 3, 24, 11, 20, 2).toISOString()
    };
    const getUserDetails = jest.fn(async () => profile);
    const getNodeSeekAccountOverview = jest.fn(async () => ({
      source: 'nodeseek' as const,
      userId: '42',
      profile,
      coin: 0,
      stardust: 2,
      fans: 2
    }));
    const getNodeSeekAttendanceBoard = jest.fn(async () => ({
      source: 'nodeseek' as const,
      userId: '42',
      list: [],
      record: null,
      order: null,
      total: 0
    }));
    const props = moreProps({
      account: {
        read: {
          sessions: projectTestAccountSessions(
            createSiteSessionStates({
              nodeseek: {
                site: 'nodeseek',
                status: 'logged-in',
                isVerifying: false,
                cookieSummary: [],
                currentUser: user
              }
            })
          )
        }
      }
    });
    props.account.read.gateway = {
      ...props.account.read.gateway,
      getReadPlan: (source, operation) => ({
        source,
        operation,
        state: 'ready',
        lane: 'authenticated',
        transport: 'managed-session',
        cacheScope: 'authenticated:0'
      }),
      getUserDetails,
      getNodeSeekAccountOverview,
      getNodeSeekAttendanceBoard
    };
    const view = await render(<MoreScreen {...props} />);
    expect(getUserDetails).not.toHaveBeenCalled();
    expect(getNodeSeekAttendanceBoard).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(view.getByLabelText('鸡腿 0')).toBeTruthy());
    expect(view.getByLabelText('主题 0')).toBeTruthy();
    expect(view.getByLabelText('星辰 2')).toBeTruthy();
    expect(view.queryByText('读取通道自愈阈值')).toBeNull();
    expect(getUserDetails).not.toHaveBeenCalled();
    expect(getNodeSeekAccountOverview).toHaveBeenCalledTimes(1);
    expect(getNodeSeekAttendanceBoard).toHaveBeenCalledTimes(1);
    expect(props.account.center.nodeSeek.observeBoard).toHaveBeenCalledTimes(1);
    expect(view.queryByLabelText('我的主题')).toBeNull();
    expect(view.queryByLabelText('我的回复')).toBeNull();
    expect(view.queryByText(/^更新于 /)).toBeNull();
    await fireEvent.press(view.getByLabelText('回复 8'));
    expect(props.account.center.command).toHaveBeenLastCalledWith({ type: 'open-user', user, initialTab: 'replies' });
    expect(view.getByLabelText('更多资料').props.accessibilityState.expanded).toBe(false);
    expect(StyleSheet.flatten(view.getByLabelText('更多资料').props.style).minHeight).toBe(48);
    const toggleDetails = view.getByLabelText('更多资料');
    await act(async () => {
      await fireEvent.press(toggleDetails);
      await fireEvent.press(toggleDetails);
    });
    expect(view.getByLabelText('更多资料').props.accessibilityState.expanded).toBe(false);
    expect(view.queryByText('粉丝 · 2')).toBeNull();
    await fireEvent.press(view.getByLabelText('更多资料'));
    expect(view.getByLabelText('收起资料').props.accessibilityState.expanded).toBe(true);
    expect(view.getByText('粉丝 · 2')).toBeTruthy();
    expect(view.getByText('加入日期 · 2026-04-24')).toBeTruthy();
    expect(view.queryByText(`加入日期 · ${profile.joinedAt}`)).toBeNull();
    await fireEvent.press(view.getByLabelText('收起资料'));
    expect(view.getByLabelText('更多资料').props.accessibilityState.expanded).toBe(false);
    expect(view.queryByText('粉丝 · 2')).toBeNull();
    const hiddenDetails = view.getByText('粉丝 · 2', { includeHiddenElements: true }).parent?.parent;
    expect(hiddenDetails?.props.pointerEvents).toBe('none');
    expect(hiddenDetails?.props.accessibilityElementsHidden).toBe(true);
    expect(hiddenDetails?.props.importantForAccessibility).toBe('no-hide-descendants');
    await fireEvent.press(view.getByLabelText('更多资料'));
    expect(view.getByText('粉丝 · 2')).toBeTruthy();
    expect(getUserDetails).not.toHaveBeenCalled();
    expect(getNodeSeekAccountOverview).toHaveBeenCalledTimes(1);
    expect(view.queryByLabelText('鸡腿流水')).toBeNull();
    expect(view.getByLabelText('鸡腿 0').props.accessibilityHint).toBe('查看鸡腿流水');
    await fireEvent.press(view.getByLabelText('鸡腿 0'));
    expect(props.account.center.openCredits).toHaveBeenLastCalledWith('coin');
    expect(view.queryByLabelText('星辰流水')).toBeNull();
    expect(view.getByLabelText('星辰 2').props.accessibilityHint).toBe('查看星辰流水');
    await fireEvent.press(view.getByLabelText('星辰 2'));
    expect(props.account.center.openCredits).toHaveBeenLastCalledWith('stardust');
    expect(props.account.center.openCredits).toHaveBeenCalledTimes(2);
    expect(view.queryByLabelText('刷新资料')).toBeNull();
    expect(view.queryByLabelText('刷新签到状态')).toBeNull();
    expect(view.queryByLabelText('重试资料')).toBeNull();
    await fireEvent.press(view.getByLabelText('刷新账号'));
    await waitFor(() => expect(getNodeSeekAttendanceBoard).toHaveBeenCalledTimes(2));
    expect(getUserDetails).not.toHaveBeenCalled();
    expect(getNodeSeekAccountOverview).toHaveBeenCalledTimes(2);
    expect(props.account.center.command).toHaveBeenLastCalledWith({ type: 'refresh' });
    await view.rerender(<MoreScreen {...props} account={{ ...props.account, active: false }} />);
    expect(view.getByLabelText('鸡腿 0')).toBeTruthy();
    expect(view.getByLabelText('主题 0')).toBeTruthy();
    expect(view.getByText('粉丝 · 2')).toBeTruthy();
    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    expect(getUserDetails).not.toHaveBeenCalled();
    expect(getNodeSeekAccountOverview).toHaveBeenCalledTimes(2);
    expect(getNodeSeekAttendanceBoard).toHaveBeenCalledTimes(2);
    await view.rerender(<MoreScreen {...props} />);
    expect(getNodeSeekAttendanceBoard).toHaveBeenCalledTimes(2);
    expect(getNodeSeekAccountOverview).toHaveBeenCalledTimes(2);
    expect(getUserDetails).not.toHaveBeenCalled();
    expect(view.getByLabelText('鸡腿 0')).toBeTruthy();
    getNodeSeekAccountOverview.mockRejectedValueOnce(new Error('NodeSeek 页面读取超时'));
    await fireEvent.press(view.getByLabelText('刷新账号'));
    await waitFor(() => expect(view.getByLabelText('重试资料')).toBeTruthy());
    expect(view.getByLabelText('主题 0')).toBeTruthy();
    expect(getUserDetails).not.toHaveBeenCalled();
    await view.rerender(
      <MoreScreen
        {...props}
        account={{
          ...props.account,
          active: false,
          read: {
            ...props.account.read,
            gateway: {
              ...props.account.read.gateway,
              getReadPlan: (source, operation) => ({
                source,
                operation,
                state: 'blocked',
                reason: 'source-disabled',
                cacheScope: 'blocked:source-disabled'
              })
            }
          }
        }}
      />
    );
    expect(view.queryByLabelText('鸡腿 0')).toBeNull();
    expect(view.queryByLabelText('主题 0')).toBeNull();
  });

  it.each([12, 0])(
    'opens linux.do replies from the reply count (%s) without a duplicate shortcut',
    async (replyCount) => {
      const user = authorizedLinuxDoSessions.linuxdo.currentUser;
      if (!user) throw new Error('Fixture requires a confirmed linux.do user');
      const props = moreProps({
        account: { enabledSessionSources: ['linuxdo'], read: { sessions: authorizedLinuxDoSessions } }
      });
      props.account.read.gateway = {
        ...props.account.read.gateway,
        getReadPlan: (source, operation) => ({
          source,
          operation,
          state: 'ready',
          lane: 'authenticated',
          transport: 'managed-session',
          cacheScope: 'authenticated:0'
        }),
        getUserDetails: async () => ({ ...user, topicCount: 3, replyCount, likesReceived: 9, timeRead: 120 })
      };
      const settings = { ...readerData.settings, fontScale: 1.6 };
      const view = await render(<MoreScreen {...props} />, {
        wrapper: ({ children }) => (
          <ReaderStyleProvider value={{ settings: resolveReaderStyleSettings(settings), theme: createTheme(settings) }}>
            {children}
          </ReaderStyleProvider>
        )
      });

      await waitFor(() => expect(view.getByLabelText('主题 3')).toBeTruthy());
      expect(StyleSheet.flatten(view.getByLabelText('主题 3').props.style).width).toBe('50%');
      expect(view.getByLabelText(`回复 ${replyCount}`).props.accessibilityRole).toBe('button');
      expect(view.queryByLabelText(`发言 ${replyCount}`)).toBeNull();
      expect(view.queryByLabelText('我的主题')).toBeNull();
      expect(view.queryByLabelText('我的回复')).toBeNull();
      await fireEvent.press(view.getByLabelText('主题 3'));
      expect(props.account.center.command).toHaveBeenLastCalledWith({ type: 'open-user', user, initialTab: 'topics' });
      await fireEvent.press(view.getByLabelText(`回复 ${replyCount}`));
      expect(props.account.center.command).toHaveBeenLastCalledWith({ type: 'open-user', user, initialTab: 'replies' });
    }
  );

  it('keeps the linux.do reply metric reachable when the reply count is unavailable', async () => {
    const user = authorizedLinuxDoSessions.linuxdo.currentUser;
    if (!user) throw new Error('Fixture requires a confirmed linux.do user');
    const props = moreProps({
      account: { enabledSessionSources: ['linuxdo'], read: { sessions: authorizedLinuxDoSessions } }
    });
    props.account.read.gateway = {
      ...props.account.read.gateway,
      getReadPlan: (source, operation) => ({
        source,
        operation,
        state: 'ready',
        lane: 'authenticated',
        transport: 'managed-session',
        cacheScope: 'authenticated:0'
      }),
      getUserDetails: async () => ({ ...user, topicCount: 3 })
    };
    const view = await render(<MoreScreen {...props} />);

    await waitFor(() => expect(view.getByLabelText('主题 3')).toBeTruthy());
    expect(view.queryByLabelText('回复 0')).toBeNull();
    expect(view.queryByLabelText('我的回复')).toBeNull();
    await fireEvent.press(view.getByLabelText('回复 暂无数据'));
    expect(props.account.center.command).toHaveBeenLastCalledWith({ type: 'open-user', user, initialTab: 'replies' });
  });

  it('does not mount or refresh account-specific content after its source is disabled', async () => {
    const refreshLinuxDoLevel = jest.fn();
    const view = await render(
      <MoreScreen
        {...moreProps({
          account: {
            enabledSessionSources: ['linuxdo', 'nodeseek'],
            read: { sessions: authorizedLinuxDoSessions },
            center: { linuxDoLevel: { error: '暂不可用', refresh: refreshLinuxDoLevel } }
          }
        })}
      />
    );

    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    await fireEvent.press(view.getByText('linux.do 等级'));
    expect(refreshLinuxDoLevel).not.toHaveBeenCalled();

    await view.rerender(
      <MoreScreen
        {...moreProps({
          account: {
            enabledSessionSources: ['nodeseek'],
            read: { sessions: authorizedLinuxDoSessions },
            center: { linuxDoLevel: { error: '', refresh: refreshLinuxDoLevel } }
          }
        })}
      />
    );
    expect(view.queryByTestId('account-site-linuxdo')).toBeNull();
    expect(view.queryByText('授权管理')).toBeNull();
    expect(view.queryByText('linux.do 等级')).toBeNull();
    expect(refreshLinuxDoLevel).not.toHaveBeenCalled();
    await view.rerender(
      <MoreScreen
        {...moreProps({
          account: {
            enabledSessionSources: ['linuxdo', 'nodeseek'],
            read: { sessions: authorizedLinuxDoSessions },
            center: { linuxDoLevel: { error: '', refresh: refreshLinuxDoLevel } }
          }
        })}
      />
    );
    expect(view.getByTestId('account-site-nodeseek').props.accessibilityState.selected).toBe(true);
    expect(refreshLinuxDoLevel).not.toHaveBeenCalled();
  });

  it.each(['start', 'finish'] as const)(
    'keeps source rows measurable through collapse and rejects hidden changes or a delayed drag %s',
    async (delayedPhase) => {
      const updateSettings = jest.fn();
      const view = await render(
        <MoreScreen {...moreProps({ utilities: { settings: { update: updateSettings } } })} contentSourcesExpanded />
      );
      const sources = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];
      const rows = sources.map((source) => view.getByTestId(`content-source-row-${source}`));
      for (const [index, row] of rows.entries()) {
        await fireEvent(row, 'layout', {
          nativeEvent: { layout: { height: 56, width: 300, x: 0, y: index * 56 } }
        });
      }
      const sourceSwitch = view.getByLabelText('V2EX 内容源开关');
      const handle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
      const lateSwitchChange = sourceSwitch.props.onChange;
      const lateAccessibilityAction = handle.props.onAccessibilityAction;
      mockDeferScheduleOnRN = delayedPhase === 'start';
      await act(async () => {
        handle.props.onGestureStart({ translationY: 0 });
      });
      mockDeferScheduleOnRN = true;
      await act(async () => {
        handle.props.onGestureUpdate({ translationY: 56 });
        handle.props.onGestureFinalize({ canceled: false });
      });
      await fireEvent.press(view.getByLabelText('收起内容源'));
      for (const [index, source] of sources.entries()) {
        expect(view.getByTestId(`content-source-row-${source}`, { includeHiddenElements: true })).toBe(rows[index]);
        expect(view.queryByTestId(`content-source-row-${source}`)).toBeNull();
      }
      expect(view.queryByLabelText('V2EX 内容源开关')).toBeNull();
      expect(
        view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项', { includeHiddenElements: true }).props.gestureEnabled
      ).toBe(false);
      await act(async () => {
        lateSwitchChange({ nativeEvent: { value: false } });
        lateAccessibilityAction({ nativeEvent: { actionName: 'moveDown' } });
      });
      expect(updateSettings).not.toHaveBeenCalled();

      mockDeferScheduleOnRN = false;
      await fireEvent.press(view.getByLabelText('展开内容源'));
      for (const [index, source] of sources.entries()) {
        expect(view.getByTestId(`content-source-row-${source}`)).toBe(rows[index]);
      }
      await act(async () => {
        for (const callback of mockDeferredRNCalls.splice(0)) callback();
      });
      expect(updateSettings).not.toHaveBeenCalled();
      const reopenedHandle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
      await act(async () => {
        reopenedHandle.props.onGestureStart({ translationY: 0 });
        reopenedHandle.props.onGestureUpdate({ translationY: 56 });
        reopenedHandle.props.onGestureFinalize({ canceled: false });
      });
      expect(updateSettings).toHaveBeenCalledWith({
        kind: 'drop-source',
        source: 'v2ex',
        target: 'linuxdo',
        fromOrder: sources
      });
    }
  );

  it.each(['mode changes twice', 'initial discovery finishes'] as const)(
    'preserves measured source rows when screen-reader %s while collapsed',
    async (change) => {
      const discovery = Promise.withResolvers<boolean>();
      if (change === 'initial discovery finishes') mockIsScreenReaderEnabled.mockReturnValueOnce(discovery.promise);
      const updateSettings = jest.fn();
      const view = await render(<MoreScreen {...moreProps({ utilities: { settings: { update: updateSettings } } })} />);
      const sources = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];
      const heights = [56, 72, 64, 80];
      let y = 0;
      for (const [index, source] of sources.entries()) {
        await fireEvent(view.getByTestId(`content-source-row-${source}`, { includeHiddenElements: true }), 'layout', {
          nativeEvent: { layout: { height: heights[index], width: 300, x: 0, y } }
        });
        y += heights[index]!;
      }
      if (change === 'mode changes twice') {
        await act(async () => mockScreenReaderChangeListener?.(true));
        await act(async () => mockScreenReaderChangeListener?.(false));
      } else await act(async () => discovery.resolve(false));
      expect(updateSettings).not.toHaveBeenCalled();

      await fireEvent.press(view.getByLabelText('展开内容源'));
      const handle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
      expect(handle.props.gestureEnabled).toBe(true);
      await act(async () => {
        handle.props.onGestureStart({ translationY: 0 });
        handle.props.onGestureUpdate({ translationY: 64 });
        handle.props.onGestureFinalize({ canceled: false });
      });
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings).toHaveBeenCalledWith({
        kind: 'drop-source',
        source: 'v2ex',
        target: 'linuxdo',
        fromOrder: sources
      });
    }
  );

  it('keeps all content sources in an accessible, collapsed settings-only panel', async () => {
    const updateSettings = jest.fn();
    const persistedPreferences = readerData.settings.contentSources;
    const persistedSnapshot = JSON.stringify(persistedPreferences);
    const command = jest.fn(
      async (_command: Parameters<MoreScreenProps['account']['center']['command']>[0]) => undefined
    );
    const view = await render(
      <MoreScreen
        {...moreProps({
          account: { center: { command } },
          utilities: { settings: { update: updateSettings } }
        })}
      />
    );

    const contentSourceToggle = view.getByLabelText('展开内容源');
    expect(contentSourceToggle.props.accessibilityState.expanded).toBe(false);
    expect(StyleSheet.flatten(contentSourceToggle.parent?.props.style)).toMatchObject({
      backgroundColor: 'transparent',
      borderRadius: 0,
      paddingHorizontal: 0
    });
    await fireEvent.press(contentSourceToggle);

    const sourceSwitches = view
      .getAllByRole('switch')
      .filter((control) => String(control.props.accessibilityLabel).endsWith('内容源开关'));
    expect(sourceSwitches.map((control) => control.props.accessibilityLabel)).toEqual([
      'V2EX 内容源开关',
      'linux.do 内容源开关',
      'NodeSeek 内容源开关',
      '妖火 内容源开关'
    ]);
    expect(sourceSwitches.every((control) => control.props.accessibilityState.checked === true)).toBe(true);
    const firstHandle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
    const lastHandle = view.getByLabelText('拖动排序：妖火，第 4 项，共 4 项');
    expect(StyleSheet.flatten(view.getByTestId('content-source-row-v2ex').props.style)).toMatchObject({
      marginHorizontal: 4
    });
    expect(firstHandle.props.accessibilityActions).toEqual([{ name: 'moveDown', label: '下移' }]);
    expect(lastHandle.props.accessibilityActions).toEqual([{ name: 'moveUp', label: '上移' }]);
    expect(StyleSheet.flatten(firstHandle.props.style)).toMatchObject({
      alignItems: 'flex-end',
      backgroundColor: 'transparent',
      height: 48,
      paddingRight: 3,
      width: 48
    });
    expect(StyleSheet.flatten(firstHandle.parent?.props.style)).toMatchObject({
      flexDirection: 'row',
      gap: 0
    });

    await fireEvent(firstHandle, 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
    expect(updateSettings).toHaveBeenCalledWith({
      kind: 'move-source',
      source: 'v2ex',
      offset: 1
    });
    expect(command).not.toHaveBeenCalled();
    expect(JSON.stringify(persistedPreferences)).toBe(persistedSnapshot);

    updateSettings.mockClear();
    await fireEvent(view.getByLabelText('V2EX 内容源开关'), 'valueChange', false);
    expect(updateSettings).toHaveBeenCalledWith({
      kind: 'set-source-enabled',
      source: 'v2ex',
      enabled: false
    });
    expect(view.getByLabelText('V2EX 内容源开关').props.accessibilityState.checked).toBe(true);

    await view.rerender(
      <MoreScreen
        {...moreProps({
          account: { center: { command } },
          utilities: { settings: { value: readerData.settings, update: updateSettings } }
        })}
      />
    );
    expect(
      view
        .getAllByRole('switch')
        .filter((control) => String(control.props.accessibilityLabel).endsWith('内容源开关'))
        .map((control) => control.props.accessibilityLabel)
    ).toEqual(['V2EX 内容源开关', 'linux.do 内容源开关', 'NodeSeek 内容源开关', '妖火 内容源开关']);
    expect(view.getByLabelText('V2EX 内容源开关').props.accessibilityState.checked).toBe(true);
    expect(JSON.stringify(persistedPreferences)).toBe(persistedSnapshot);

    await view.rerender(
      <MoreScreen
        {...moreProps({
          account: { enabledSessionSources: [] },
          utilities: {
            settings: {
              value: {
                ...readerData.settings,
                contentSources: readerData.settings.contentSources.map((preference) => ({
                  ...preference,
                  enabled: false
                }))
              },
              update: updateSettings
            }
          }
        })}
      />
    );
    const disabledSourceSwitches = view
      .getAllByRole('switch')
      .filter((control) => String(control.props.accessibilityLabel).endsWith('内容源开关'));
    expect(disabledSourceSwitches).toHaveLength(4);
    expect(disabledSourceSwitches.every((control) => control.props.accessibilityState.checked === false)).toBe(true);
  });

  it('keeps settled rows on an array-shaped identity transform while other panels expand', async () => {
    const view = await render(<MoreScreen {...moreProps()} />);

    expect(view.queryByTestId('content-source-row-v2ex')).toBeNull();

    await fireEvent.press(view.getByLabelText('展开内容源'));

    for (const source of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']) {
      expect(StyleSheet.flatten(view.getByTestId(`content-source-row-${source}`).props.style)).toHaveProperty(
        'transform',
        []
      );
    }

    expect(view.getByTestId('more-diagnostics')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('展开备份 / 恢复'));
    expect(view.getByLabelText('导出备份文件')).toBeTruthy();
  });

  it('keeps drag frames off JS and persists the final source order once', async () => {
    const updateSettings = jest.fn();
    const view = await render(<MoreScreen {...moreProps({ utilities: { settings: { update: updateSettings } } })} />);
    await fireEvent.press(view.getByLabelText('展开内容源'));

    for (const [index, source] of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'].entries()) {
      await fireEvent(view.getByTestId(`content-source-row-${source}`), 'layout', {
        nativeEvent: { layout: { height: 56, width: 300, x: 0, y: index * 56 } }
      });
    }
    const handle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
    expect(handle.props.gestureEnabled).toBe(true);
    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      for (let translationY = 1; translationY <= 20; translationY += 1) {
        handle.props.onGestureUpdate({ translationY });
      }
      handle.props.onGestureUpdate({ translationY: 120 });
    });
    expect(mockDragRunsOnJS).toBe(false);
    expect(mockScheduleOnRN).toHaveBeenCalledTimes(2);
    expect(StyleSheet.flatten(view.getByTestId('content-source-row-v2ex').props.style)).toMatchObject({
      backgroundColor: createTheme(readerData.settings).surface2,
      borderRadius: readerRadii.control,
      borderTopWidth: 0,
      elevation: 2,
      marginHorizontal: 0,
      paddingHorizontal: 8
    });
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      handle.props.onGestureFinalize({ canceled: false });
    });

    expect(mockScheduleOnRN).toHaveBeenCalledTimes(3);
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      kind: 'drop-source',
      source: 'v2ex',
      target: 'nodeseek',
      fromOrder: ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']
    });

    updateSettings.mockClear();
    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      handle.props.onGestureUpdate({ translationY: 56 });
      handle.props.onGestureFinalize({ canceled: true });
    });
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      handle.props.onGestureUpdate({ translationY: 10_000 });
      handle.props.onGestureFinalize({ canceled: false });
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenLastCalledWith({
      kind: 'drop-source',
      source: 'v2ex',
      target: 'yaohuo',
      fromOrder: ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']
    });

    updateSettings.mockClear();
    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      handle.props.onGestureUpdate({ translationY: 56 });
    });
    await view.rerender(
      <MoreScreen
        {...moreProps({
          utilities: {
            settings: {
              value: {
                ...readerData.settings,
                contentSources: readerData.settings.contentSources.map((preference) =>
                  preference.source === 'v2ex' ? { ...preference, enabled: false } : preference
                )
              },
              update: updateSettings
            }
          }
        })}
      />
    );
    await act(async () => handle.props.onGestureFinalize({ canceled: false }));
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('keeps each source on one native host across forward and reverse reorders', async () => {
    const updateSettings = jest.fn();
    const props = moreProps({ utilities: { settings: { update: updateSettings } } });
    const view = await render(<MoreScreen {...props} />);
    await fireEvent.press(view.getByLabelText('展开内容源'));

    for (const [index, source] of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'].entries()) {
      await fireEvent(view.getByTestId(`content-source-row-${source}`), 'layout', {
        nativeEvent: { layout: { height: 56, width: 300, x: 0, y: index * 56 } }
      });
    }
    const v2exHost = view.getByTestId('content-source-row-v2ex');
    const linuxDoHost = view.getByTestId('content-source-row-linuxdo');
    const handle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      handle.props.onGestureUpdate({ translationY: 56 });
    });
    const translations = mockSharedValues.filter((sharedValue) => sharedValue.value === 56);
    expect(translations).toHaveLength(1);
    const [dragTranslation] = translations;
    expect(dragTranslation?.value).toBe(56);

    mockDeferScheduleOnRN = true;
    await act(async () => handle.props.onGestureFinalize({ canceled: false }));

    expect(updateSettings).not.toHaveBeenCalled();
    expect(dragTranslation?.value).toBe(56);

    mockDeferScheduleOnRN = false;
    await act(async () => {
      for (const run of mockDeferredRNCalls.splice(0)) run();
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(dragTranslation?.value).toBe(56);
    expect(StyleSheet.flatten(v2exHost.props.style).elevation).not.toBe(2);

    const reorderedContentSources = [
      { source: 'linuxdo', enabled: true },
      { source: 'v2ex', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true }
    ] as const;
    await view.rerender(
      <MoreScreen
        {...moreProps({
          utilities: {
            settings: {
              value: { ...readerData.settings, contentSources: [...reorderedContentSources] },
              update: updateSettings
            }
          }
        })}
      />
    );
    expect(
      view
        .getAllByRole('switch')
        .filter((control) => String(control.props.accessibilityLabel).endsWith('内容源开关'))
        .map((control) => control.props.accessibilityLabel)
    ).toEqual(['V2EX 内容源开关', 'linux.do 内容源开关', 'NodeSeek 内容源开关', '妖火 内容源开关']);
    expect(view.getByLabelText('拖动排序：linux.do，第 1 项，共 4 项')).toBeTruthy();
    expect(view.getByLabelText('拖动排序：V2EX，第 2 项，共 4 项')).toBeTruthy();
    expect(view.getByTestId('content-source-row-v2ex')).toBe(v2exHost);
    expect(view.getByTestId('content-source-row-linuxdo')).toBe(linuxDoHost);
    expect(StyleSheet.flatten(view.getByTestId('content-source-row-v2ex').props.style)).toMatchObject({
      transform: [{ translateY: 56 }]
    });
    expect(StyleSheet.flatten(view.getByTestId('content-source-row-linuxdo').props.style)).toMatchObject({
      transform: [{ translateY: -56 }]
    });

    updateSettings.mockClear();
    const reverseHandle = view.getByLabelText('拖动排序：V2EX，第 2 项，共 4 项');
    await act(async () => {
      reverseHandle.props.onGestureStart({ translationY: 0 });
      reverseHandle.props.onGestureUpdate({ translationY: -56 });
      reverseHandle.props.onGestureFinalize({ canceled: false });
    });
    expect(updateSettings).toHaveBeenCalledWith({
      kind: 'drop-source',
      source: 'v2ex',
      target: 'linuxdo',
      fromOrder: reorderedContentSources.map(({ source }) => source)
    });

    await view.rerender(
      <MoreScreen
        {...moreProps({
          utilities: {
            settings: {
              value: readerData.settings,
              update: updateSettings
            }
          }
        })}
      />
    );
    expect(view.getByTestId('content-source-row-v2ex')).toBe(v2exHost);
    expect(view.getByTestId('content-source-row-linuxdo')).toBe(linuxDoHost);
    expect(StyleSheet.flatten(view.getByTestId('content-source-row-v2ex').props.style)).toHaveProperty('transform', []);
    expect(StyleSheet.flatten(view.getByTestId('content-source-row-linuxdo').props.style)).toHaveProperty(
      'transform',
      []
    );

    await fireEvent.press(view.getByLabelText('收起内容源'));
    expect(view.queryByTestId('content-source-row-v2ex')).toBeNull();
    await fireEvent.press(view.getByLabelText('展开内容源'));
    expect(
      view
        .getAllByRole('switch')
        .filter((control) => String(control.props.accessibilityLabel).endsWith('内容源开关'))
        .map((control) => control.props.accessibilityLabel)
    ).toEqual(['V2EX 内容源开关', 'linux.do 内容源开关', 'NodeSeek 内容源开关', '妖火 内容源开关']);
    for (const source of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']) {
      expect(StyleSheet.flatten(view.getByTestId(`content-source-row-${source}`).props.style)).toHaveProperty(
        'transform',
        []
      );
    }

    await act(async () =>
      view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项').props.onGestureStart({ translationY: 0 })
    );
    expect(dragTranslation?.value).toBe(0);
  });

  it.each<[string, boolean | null | 'reject']>([
    ['screen-reader discovery is pending', null],
    ['screen-reader discovery fails', 'reject'],
    ['screen reader is enabled', true]
  ])('follows persisted preference order while %s', async (_case, screenReaderState) => {
    mockScreenReaderInitialState = screenReaderState;
    const updateSettings = jest.fn();
    const reorderedContentSources = [
      { source: 'linuxdo', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true },
      { source: 'v2ex', enabled: true }
    ] as const;
    const view = await render(
      <MoreScreen {...moreProps({ utilities: { settings: { update: updateSettings } } })} contentSourcesExpanded />
    );
    await act(async () => undefined);
    for (const [index, source] of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'].entries()) {
      await fireEvent(view.getByTestId(`content-source-row-${source}`), 'layout', {
        nativeEvent: { layout: { height: 56, width: 300, x: 0, y: index * 56 } }
      });
    }

    await view.rerender(
      <MoreScreen
        {...moreProps({
          utilities: {
            settings: {
              value: { ...readerData.settings, contentSources: [...reorderedContentSources] },
              update: updateSettings
            }
          }
        })}
        contentSourcesExpanded
      />
    );

    expect(
      view
        .getAllByRole('switch')
        .filter((control) => String(control.props.accessibilityLabel).endsWith('内容源开关'))
        .map((control) => control.props.accessibilityLabel)
    ).toEqual(['linux.do 内容源开关', 'NodeSeek 内容源开关', '妖火 内容源开关', 'V2EX 内容源开关']);
    expect(
      view
        .getAllByRole('button')
        .filter((control) => String(control.props.accessibilityLabel).startsWith('拖动排序：'))
        .map((control) => control.props.accessibilityLabel)
    ).toEqual([
      '拖动排序：linux.do，第 1 项，共 4 项',
      '拖动排序：NodeSeek，第 2 项，共 4 项',
      '拖动排序：妖火，第 3 项，共 4 项',
      '拖动排序：V2EX，第 4 项，共 4 项'
    ]);
    expect(view.getByLabelText('拖动排序：linux.do，第 1 项，共 4 项').props.gestureEnabled).toBe(false);
    for (const { source } of reorderedContentSources) {
      expect(StyleSheet.flatten(view.getByTestId(`content-source-row-${source}`).props.style)).toHaveProperty(
        'transform',
        []
      );
    }
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('cancels an unfinished drag when screen-reader mode turns on', async () => {
    mockScreenReaderInitialState = false;
    const updateSettings = jest.fn();
    const reorderedContentSources = [
      { source: 'linuxdo', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true },
      { source: 'v2ex', enabled: true }
    ] as const;
    const view = await render(
      <MoreScreen {...moreProps({ utilities: { settings: { update: updateSettings } } })} contentSourcesExpanded />
    );
    await act(async () => undefined);
    for (const [index, source] of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'].entries()) {
      await fireEvent(view.getByTestId(`content-source-row-${source}`), 'layout', {
        nativeEvent: { layout: { height: 56, width: 300, x: 0, y: index * 56 } }
      });
    }
    const handle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      handle.props.onGestureUpdate({ translationY: 112 });
    });
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      mockScreenReaderInitialState = true;
      mockScreenReaderChangeListener?.(true);
    });
    await view.rerender(
      <MoreScreen
        {...moreProps({
          utilities: {
            settings: {
              value: { ...readerData.settings, contentSources: [...reorderedContentSources] },
              update: updateSettings
            }
          }
        })}
        contentSourcesExpanded
      />
    );

    expect(updateSettings).not.toHaveBeenCalled();
    expect(
      view
        .getAllByRole('switch')
        .filter((control) => String(control.props.accessibilityLabel).endsWith('内容源开关'))
        .map((control) => control.props.accessibilityLabel)
    ).toEqual(['linux.do 内容源开关', 'NodeSeek 内容源开关', '妖火 内容源开关', 'V2EX 内容源开关']);
    expect(
      view
        .getAllByRole('button')
        .filter((control) => String(control.props.accessibilityLabel).startsWith('拖动排序：'))
        .map((control) => control.props.accessibilityLabel)
    ).toEqual([
      '拖动排序：linux.do，第 1 项，共 4 项',
      '拖动排序：NodeSeek，第 2 项，共 4 项',
      '拖动排序：妖火，第 3 项，共 4 项',
      '拖动排序：V2EX，第 4 项，共 4 项'
    ]);
    for (const { source } of reorderedContentSources) {
      expect(StyleSheet.flatten(view.getByTestId(`content-source-row-${source}`).props.style)).toHaveProperty(
        'transform',
        []
      );
    }

    for (const [index, { source }] of reorderedContentSources.entries()) {
      await fireEvent(view.getByTestId(`content-source-row-${source}`), 'layout', {
        nativeEvent: { layout: { height: 56, width: 300, x: 0, y: index * 56 } }
      });
    }
    const screenReaderHandle = view.getByLabelText('拖动排序：linux.do，第 1 项，共 4 项');
    await act(async () => {
      screenReaderHandle.props.onGestureStart({ translationY: 0 });
      screenReaderHandle.props.onGestureUpdate({ translationY: 112 });
      mockScreenReaderInitialState = false;
      mockScreenReaderChangeListener?.(false);
    });
    await act(async () => screenReaderHandle.props.onGestureFinalize({ canceled: false }));

    expect(updateSettings).not.toHaveBeenCalled();
    expect(
      view
        .getAllByRole('switch')
        .filter((control) => String(control.props.accessibilityLabel).endsWith('内容源开关'))
        .map((control) => control.props.accessibilityLabel)
    ).toEqual(['linux.do 内容源开关', 'NodeSeek 内容源开关', '妖火 内容源开关', 'V2EX 内容源开关']);
    for (const { source } of reorderedContentSources) {
      expect(StyleSheet.flatten(view.getByTestId(`content-source-row-${source}`).props.style)).toHaveProperty(
        'transform',
        []
      );
    }
  });

  it('ignores queued visual drag callbacks after screen-reader mode rotation', async () => {
    mockScreenReaderInitialState = false;
    const updateSettings = jest.fn();
    const view = await render(
      <MoreScreen {...moreProps({ utilities: { settings: { update: updateSettings } } })} contentSourcesExpanded />
    );
    await act(async () => undefined);
    for (const [index, source] of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'].entries()) {
      await fireEvent(view.getByTestId(`content-source-row-${source}`), 'layout', {
        nativeEvent: { layout: { height: 56, width: 300, x: 0, y: index * 56 } }
      });
    }

    const handle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
    mockDeferScheduleOnRN = true;
    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      handle.props.onGestureUpdate({ translationY: 112 });
      handle.props.onGestureFinalize({ canceled: false });
    });
    expect(mockDeferredRNCalls).toHaveLength(3);

    await act(async () => {
      mockScreenReaderChangeListener?.(true);
      mockScreenReaderChangeListener?.(false);
    });
    mockDeferScheduleOnRN = false;
    await act(async () => {
      for (const run of mockDeferredRNCalls.splice(0)) run();
    });

    expect({
      persistedChanges: updateSettings.mock.calls.length,
      transforms: ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'].map(
        (source) => StyleSheet.flatten(view.getByTestId(`content-source-row-${source}`).props.style).transform
      )
    }).toEqual({ persistedChanges: 0, transforms: [[], [], [], []] });
  });

  it.each<[string, null | 'reject']>([
    ['screen-reader discovery is pending', null],
    ['screen-reader discovery fails', 'reject']
  ])('keeps drag writes disabled while %s', async (_case, screenReaderState) => {
    mockScreenReaderInitialState = screenReaderState;
    const updateSettings = jest.fn();
    const view = await render(
      <MoreScreen {...moreProps({ utilities: { settings: { update: updateSettings } } })} contentSourcesExpanded />
    );
    await act(async () => undefined);
    for (const [index, source] of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'].entries()) {
      await fireEvent(view.getByTestId(`content-source-row-${source}`), 'layout', {
        nativeEvent: { layout: { height: 56, width: 300, x: 0, y: index * 56 } }
      });
    }

    const handle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      handle.props.onGestureUpdate({ translationY: 112 });
      handle.props.onGestureFinalize({ canceled: false });
    });

    expect({
      gestureEnabled: handle.props.gestureEnabled,
      persistedChanges: updateSettings.mock.calls.length
    }).toEqual({ gestureEnabled: false, persistedChanges: 0 });
  });

  it('opens each personal shortcut in its Library collection without a duplicate message entry', async () => {
    const open = jest.fn();
    const view = await render(
      <MoreScreen
        {...moreProps({
          utilities: {
            library: { open }
          }
        })}
      />
    );

    for (const label of ['收藏', '关注', '历史']) {
      await fireEvent.press(view.getByRole('button', { name: label }));
    }
    expect(open.mock.calls).toEqual([['favorites'], ['users'], ['history']]);
    expect(StyleSheet.flatten(view.getByTestId('more-library-row').props.style)).toMatchObject({
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth
    });
    expect(view.queryByText('消息通知')).toBeNull();
    expect(view.queryByTestId('more-notifications-unread-dot')).toBeNull();
  });

  it('keeps the same update control and installed version from checking through download progress', async () => {
    const onCheckAppUpdate = jest.fn();
    const onDownloadAppUpdate = jest.fn();
    const view = await render(
      <MoreScreen {...moreProps({ update: { check: onCheckAppUpdate, start: onDownloadAppUpdate } })} />
    );

    expect(view.queryByText('有新版本')).toBeNull();
    const action = view.getByRole('button', { name: '检查更新' });
    await fireEvent.press(action);
    expect(onCheckAppUpdate).toHaveBeenCalledTimes(1);

    await view.rerender(
      <MoreScreen
        {...moreProps({ update: { phase: 'checking', check: onCheckAppUpdate, start: onDownloadAppUpdate } })}
      />
    );
    expect(view.getByLabelText('检查中').props.accessibilityState.disabled).toBe(true);

    const appUpdateInfo = {
      version: '1.4.0',
      apkUrl: 'https://github.com/everythink98/wz-android/releases/download/v1.4.0/app-arm64-v8a-release.apk',
      notes: '修复已知问题',
      sha256: 'a'.repeat(64),
      packageName: 'com.everythink.wzandroid',
      versionName: '1.4.0',
      versionCode: 68,
      signerSha256: 'b'.repeat(64)
    };
    await view.rerender(
      <MoreScreen
        {...moreProps({
          update: {
            info: appUpdateInfo,
            check: onCheckAppUpdate,
            start: onDownloadAppUpdate
          }
        })}
      />
    );
    expect(view.getByRole('button', { name: '下载并安装' }) === action).toBe(true);
    expect(view.getByText(`当前版本 ${CURRENT_APP_VERSION} → 1.4.0`)).toBeTruthy();
    expect(view.getByLabelText(`当前版本 ${CURRENT_APP_VERSION}，更新至 1.4.0`)).toBeTruthy();
    expect(view.queryByText('1.4.0')).toBeNull();
    expect(view.queryByText('修复已知问题')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '展开更新说明' }));
    expect(view.getByText('修复已知问题')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('下载并安装'));
    expect(onDownloadAppUpdate).toHaveBeenCalledTimes(1);

    await view.rerender(
      <MoreScreen
        {...moreProps({
          update: {
            phase: 'downloading',
            progress: createAppUpdateProgress({
              title: '正在下载 1.4.0',
              downloadedBytes: 1024,
              totalBytes: 2048,
              percent: 50,
              percentLabel: '50%',
              sizeLabel: '1 KB / 2 KB'
            }),
            info: appUpdateInfo,
            check: onCheckAppUpdate,
            start: onDownloadAppUpdate
          }
        })}
      />
    );
    expect(view.getByText('1 KB / 2 KB')).toBeTruthy();
    expect(view.getByText('50%')).toBeTruthy();
    expect(view.getByText('修复已知问题')).toBeTruthy();
    expect(view.getByText(`当前版本 ${CURRENT_APP_VERSION} → 1.4.0`)).toBeTruthy();
    expect(view.queryByLabelText('下载中')).toBeNull();
    const pause = view.getByRole('button', { name: '暂停下载' });
    expect(pause === action).toBe(true);
    expect(pause.props.accessibilityState.disabled).toBe(false);
    expect(pause.props.accessibilityValue).toMatchObject({ now: 50, text: '1 KB / 2 KB，50%' });
    const height = StyleSheet.flatten(pause.props.style).minHeight;
    const hitSlop = pause.props.hitSlop;
    expect(height + (hitSlop?.top ?? 0) + (hitSlop?.bottom ?? 0)).toBeGreaterThanOrEqual(48);
  });

  it('routes proxy, diagnostic and backup actions and exposes their busy gates', async () => {
    const onExportBackupFile = jest.fn();
    const onExportDiagnosticLog = jest.fn();
    const onImportBackupFile = jest.fn();
    const onShowNetworkProxyPanelChange = jest.fn();
    const props = moreProps({
      utilities: {
        backup: { exportFile: onExportBackupFile, importFile: onImportBackupFile },
        diagnostics: { exportLog: onExportDiagnosticLog },
        proxy: { open: () => onShowNetworkProxyPanelChange(true) }
      }
    });
    const view = await render(<MoreScreen {...props} />);

    await fireEvent.press(view.getByText('网络设置'));
    expect(onShowNetworkProxyPanelChange).toHaveBeenCalledWith(true);

    await fireEvent.press(view.getByTestId('more-diagnostics'));
    expect(onExportDiagnosticLog).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByLabelText('展开备份 / 恢复'));
    await fireEvent.press(view.getByLabelText('导出备份文件'));
    await fireEvent.press(view.getByLabelText('选择备份文件恢复'));
    expect(onExportBackupFile).toHaveBeenCalledTimes(1);
    expect(onImportBackupFile).toHaveBeenCalledTimes(1);

    await view.rerender(
      <MoreScreen
        {...moreProps({
          utilities: {
            backup: { operation: 'export', exportFile: onExportBackupFile, importFile: onImportBackupFile },
            diagnostics: { busy: true, exportLog: onExportDiagnosticLog }
          }
        })}
      />
    );
    expect(view.getByLabelText('问题诊断，正在生成').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true
    });
    await fireEvent.press(view.getByTestId('more-diagnostics'));
    expect(onExportDiagnosticLog).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('导出中').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true
    });
    expect(view.getByLabelText('选择备份文件恢复').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('导出中'));
    await fireEvent.press(view.getByLabelText('选择备份文件恢复'));
    expect(onExportBackupFile).toHaveBeenCalledTimes(1);
    expect(onImportBackupFile).toHaveBeenCalledTimes(1);
  });

  it('never exposes an in-app anonymous simulation', async () => {
    const view = await render(<MoreScreen {...moreProps()} />);

    expect(view.queryByLabelText('展开测试工具')).toBeNull();
  });

  it('explains recovery and keeps backup import reachable while export is protected', async () => {
    const exportFile = jest.fn();
    const importFile = jest.fn();
    const view = await render(
      <MoreScreen {...moreProps({ utilities: { backup: { readerStatus: 'recovery', exportFile, importFile } } })} />
    );
    expect(view.getByText(/本机资料读取失败，来源访问已暂停/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('展开备份 / 恢复'));
    expect(view.getByLabelText('导出备份文件').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('导出备份文件'));
    await fireEvent.press(view.getByLabelText('选择备份文件恢复'));
    expect(exportFile).not.toHaveBeenCalled();
    expect(importFile).toHaveBeenCalledTimes(1);
  });

  it('explains that frozen storage needs a restart before the backup can be picked', async () => {
    const importFile = jest.fn();
    const view = await render(
      <MoreScreen {...moreProps({ utilities: { backup: { readerStatus: 'restart-required', importFile } } })} />
    );
    expect(view.getByRole('alert')).toHaveTextContent(/事务状态不明.*重新启动/);
    await fireEvent.press(view.getByLabelText('展开备份 / 恢复'));
    const restore = view.getByLabelText('选择备份文件恢复');
    expect(restore).toBeDisabled();
    expect(view.getByLabelText('导出备份文件')).toBeDisabled();
    await fireEvent.press(restore);
    expect(importFile).not.toHaveBeenCalled();
  });

  it('updates the read-channel threshold from Account Center', async () => {
    const measure = jest
      .spyOn(View.prototype, 'measureInWindow')
      .mockImplementation((callback) => callback(40, 200, 180, 240));
    try {
      const updateSettings = jest.fn();
      const view = await render(
        <MoreScreen
          {...moreProps({
            utilities: { settings: { update: updateSettings } }
          })}
        />
      );

      await fireEvent.press(view.getByTestId('account-site-nodeseek'));
      await fireEvent.press(view.getByLabelText('站点设置'));
      await fireEvent.press(view.getByRole('button', { name: '读取通道自愈阈值' }));
      await waitFor(() => expect(view.getByLabelText('4 次')).toBeTruthy());
      await fireEvent.press(view.getByLabelText('4 次'));

      expect(updateSettings).toHaveBeenCalledWith({ nodeSeekRecoveryThreshold: 4 });
    } finally {
      measure.mockRestore();
    }
  });
});
