import { projectTestAccountSessions } from '../../helpers/accountSessions';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor, within } from '../render';
import React, { type ComponentProps, Profiler, useState } from 'react';
import { StyleSheet } from 'react-native';
import { emptyCredentialSummaries } from '@/platform/storage/credentialVault';
import { createEmptyNetworkProxyState } from '@/platform/network/networkProxy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { MoreScreen as MoreScreenView } from '@/features/more/MoreScreen';
import { AccountOverviewPanel } from '@/features/more/components/AccountOverviewPanel';
import { createMoreScreenStyles } from '@/features/more/styles';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { createTheme } from '@/ui/theme/tokens';
import { QueryClientProvider } from '@tanstack/react-query';
import { createAppQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { NodeSeekAccountOverview } from '@/domain/forum/accountData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';

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
    ArrowLeft: Icon,
    Bell: Icon,
    Bug: Icon,
    Check: Icon,
    CheckCircle: Icon,
    CalendarCheck: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    DatabaseBackup: Icon,
    Image: Icon,
    Info: Icon,
    GripVertical: Icon,
    RefreshCw: Icon,
    Server: Icon,
    Settings: Icon,
    Star: Icon,
    Trash2: Icon,
    User: Icon,
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
  const [queryClient] = useState(createAppQueryClient);
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
        getReadPlan: () => ({ state: 'blocked', reason: 'login-required', cacheScope: 'blocked:login-required' }),
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
        }
      },
      sessions: sessionViewModels,
      statusBusy: false,
      ...overrides.account?.read
    },
    center: {
      openCredits: jest.fn(),
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
      progress: null,
      info: null,
      message: '当前版本 1.3.63',
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
        recovery: false,
        busy: false,
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
        activeProfile: null,
        applyError: '',
        applyStatus: 'idle',
        state: createEmptyNetworkProxyState(),
        summary: '未启用',
        visible: false,
        close: jest.fn(),
        open: jest.fn(),
        deleteProfile: jest.fn(async () => undefined),
        selectProfile: jest.fn(async () => undefined),
        setEnabled: jest.fn(async () => undefined),
        testProfile: jest.fn(async () => ({ ok: true, latencyMs: 10 })),
        upsertProfile: jest.fn(async () => undefined),
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

describe('More screen state and actions', () => {
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
    const slider = view.getByTestId('appearance-font-scale-slider', { includeHiddenElements: true });
    await fireEvent.press(view.getByLabelText('展开外观'));
    expect(view.getByTestId('appearance-font-scale-slider')).toBe(slider);
    await fireEvent(slider, 'valueChange', 1.15);
    expect(view.getByText('字号 115%')).toBeTruthy();
    expect(updateSettings).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('收起外观'));
    expect(view.getByTestId('appearance-font-scale-slider', { includeHiddenElements: true })).toBe(slider);
    expect(view.queryByLabelText('增大字号')).toBeNull();
    expect(view.getByText('字号 100%', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(view.getByLabelText('增大字号', { includeHiddenElements: true }));
    await act(async () => {
      slider.props.onRNCSliderValueChange({ nativeEvent: { value: 1.3 } });
      slider.props.onRNCSliderSlidingComplete({ nativeEvent: { value: 1.3 } });
    });
    expect(view.getByText('字号 100%', { includeHiddenElements: true })).toBeTruthy();
    expect(updateSettings).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('展开外观'));
    expect(view.getByTestId('appearance-font-scale-slider')).toBe(slider);
    expect(view.getByText('字号 100%')).toBeTruthy();
    await fireEvent(view.getByTestId('appearance-font-scale-slider'), 'slidingComplete', 1.1);
    expect(updateSettings.mock.calls).toEqual([[{ fontScale: 1.1 }]]);
    await fireEvent.press(view.getByLabelText('收起外观'));
    expect(view.getByText('字号 110%', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(view.getByLabelText('展开外观'));
    expect(view.getByText('字号 110%')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('增大字号'));
    expect(updateSettings.mock.calls).toEqual([[{ fontScale: 1.1 }], [{ fontScale: 1.15 }]]);
  });

  it('keeps the selected site when all account sources are temporarily disabled', async () => {
    const enabled = moreProps({ account: { enabledSessionSources: ['linuxdo', 'nodeseek'] } });
    const view = await render(<MoreScreen {...enabled} />);
    await fireEvent.press(view.getByLabelText('展开账号中心'));
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
      await fireEvent.press(view.getByLabelText('展开账号中心'));
      await view.rerender(<MoreScreen {...requested} />);
      expect(view.getByTestId('account-site-linuxdo').props.accessibilityState.selected).toBe(true);
      await view.rerender(<MoreScreen {...initial} />);
      expect(view.getByTestId('account-site-linuxdo').props.accessibilityState.selected).toBe(true);
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
    await fireEvent.press(view.getByLabelText('展开账号中心'));
    expect(view.queryByLabelText('重试等级', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('刷新账号'));
    expect(refreshLevel).not.toHaveBeenCalled();
    await fireEvent.press(view.getByText('linux.do 等级'));
    const retryLevel = view.getByLabelText('重试等级');
    await fireEvent.press(view.getByLabelText('刷新账号'));
    await waitFor(() => expect(refreshLevel).toHaveBeenCalledTimes(1));
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
        getReadPlan: () => ({
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
    await fireEvent.press(view.getByLabelText('展开账号中心'));
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
    expect(getUserDetails).toHaveBeenCalledTimes(2);
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
    const styles = createMoreScreenStyles(createTheme(readerData.settings), readerData.settings);
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
    const styles = createMoreScreenStyles(theme, readerData.settings);
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
      getReadPlan: () => ({
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
    await fireEvent.press(view.getByLabelText('展开账号中心'));
    await waitFor(() => expect(view.getByLabelText('重试资料')).toBeTruthy());
    await waitFor(() => expect(view.getByLabelText('重试签到状态')).toBeTruthy());
    const coinSlot = view.getByLabelText('鸡腿 暂无数据');
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
      getReadPlan: () => ({
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
    await fireEvent.press(view.getByLabelText('展开账号中心'));
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

  it('loads only the expanded confirmed account, exposes zero statistics, and pauses reads while inactive', async () => {
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
      getReadPlan: () => ({
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
    expect(getNodeSeekAttendanceBoard).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('展开账号中心'));
    await waitFor(() => expect(view.getByLabelText('鸡腿 0')).toBeTruthy());
    expect(view.getByLabelText('主题 0')).toBeTruthy();
    expect(view.getByLabelText('星辰 2')).toBeTruthy();
    expect(view.queryByText('读取通道自愈阈值')).toBeNull();
    expect(getUserDetails).toHaveBeenCalledTimes(1);
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
    expect(getUserDetails).toHaveBeenCalledTimes(1);
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
    expect(getUserDetails).toHaveBeenCalledTimes(2);
    expect(getNodeSeekAccountOverview).toHaveBeenCalledTimes(2);
    expect(props.account.center.command).toHaveBeenLastCalledWith({ type: 'refresh' });
    await view.rerender(<MoreScreen {...props} account={{ ...props.account, active: false }} />);
    expect(view.getByLabelText('鸡腿 0')).toBeTruthy();
    expect(view.getByLabelText('主题 0')).toBeTruthy();
    expect(view.getByText('粉丝 · 2')).toBeTruthy();
    await fireEvent.press(view.getByTestId('account-site-linuxdo'));
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    expect(getUserDetails).toHaveBeenCalledTimes(2);
    expect(getNodeSeekAccountOverview).toHaveBeenCalledTimes(2);
    expect(getNodeSeekAttendanceBoard).toHaveBeenCalledTimes(2);
    await view.rerender(<MoreScreen {...props} />);
    expect(getNodeSeekAttendanceBoard).toHaveBeenCalledTimes(2);
    expect(getNodeSeekAccountOverview).toHaveBeenCalledTimes(2);
    expect(getUserDetails).toHaveBeenCalledTimes(2);
    expect(view.getByLabelText('鸡腿 0')).toBeTruthy();
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
              getReadPlan: () => ({
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
        getReadPlan: () => ({
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
          <ReaderStyleProvider value={{ settings, theme: createTheme(settings) }}>{children}</ReaderStyleProvider>
        )
      });
      await fireEvent.press(view.getByLabelText('展开账号中心'));
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
      getReadPlan: () => ({
        state: 'ready',
        lane: 'authenticated',
        transport: 'managed-session',
        cacheScope: 'authenticated:0'
      }),
      getUserDetails: async () => ({ ...user, topicCount: 3 })
    };
    const view = await render(<MoreScreen {...props} />);
    await fireEvent.press(view.getByLabelText('展开账号中心'));
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

    await fireEvent.press(view.getByLabelText('展开账号中心'));
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
      contentSources: [
        { source: 'linuxdo', enabled: true },
        { source: 'v2ex', enabled: true },
        { source: 'nodeseek', enabled: true },
        { source: 'yaohuo', enabled: true }
      ]
    });
    expect(command).not.toHaveBeenCalled();
    expect(JSON.stringify(persistedPreferences)).toBe(persistedSnapshot);

    updateSettings.mockClear();
    await fireEvent(view.getByLabelText('V2EX 内容源开关'), 'valueChange', false);
    expect(updateSettings).toHaveBeenCalledWith({
      contentSources: [
        { source: 'v2ex', enabled: false },
        { source: 'linuxdo', enabled: true },
        { source: 'nodeseek', enabled: true },
        { source: 'yaohuo', enabled: true }
      ]
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
    await fireEvent.press(view.getByLabelText('展开账号中心'));
    await fireEvent.press(view.getByLabelText('展开内容源'));

    for (const source of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']) {
      expect(StyleSheet.flatten(view.getByTestId(`content-source-row-${source}`).props.style)).toHaveProperty(
        'transform',
        []
      );
    }

    await fireEvent.press(view.getByLabelText('展开问题诊断'));
    expect(view.getByText(/日志只保存在本机并经过脱敏/)).toBeTruthy();
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
      backgroundColor: '#F0F0F0',
      borderRadius: 10,
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
      contentSources: [
        { source: 'linuxdo', enabled: true },
        { source: 'nodeseek', enabled: true },
        { source: 'v2ex', enabled: true },
        { source: 'yaohuo', enabled: true }
      ]
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
      contentSources: [
        { source: 'linuxdo', enabled: true },
        { source: 'nodeseek', enabled: true },
        { source: 'yaohuo', enabled: true },
        { source: 'v2ex', enabled: true }
      ]
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
    expect(updateSettings).toHaveBeenCalledWith({ contentSources: readerData.settings.contentSources });

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

  it('opens the Library from More without a duplicate message entry', async () => {
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

    await fireEvent.press(view.getByRole('button', { name: '收藏' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(view.getByTestId('more-library-row').props.style)).toMatchObject({
      borderBottomColor: createTheme(readerData.settings).line,
      borderBottomWidth: StyleSheet.hairlineWidth
    });
    expect(view.queryByText('消息通知')).toBeNull();
    expect(view.queryByTestId('more-notifications-unread-dot')).toBeNull();
  });

  it('shows current, checking, available-update and download progress states', async () => {
    const onCheckAppUpdate = jest.fn();
    const onDownloadAppUpdate = jest.fn();
    const view = await render(
      <MoreScreen {...moreProps({ update: { check: onCheckAppUpdate, start: onDownloadAppUpdate } })} />
    );

    expect(view.queryByText('有新版本')).toBeNull();
    await fireEvent.press(view.getByLabelText('检查更新'));
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
            message: '发现新版 1.4.0',
            check: onCheckAppUpdate,
            start: onDownloadAppUpdate
          }
        })}
      />
    );
    expect(view.getByText('有新版本')).toBeTruthy();
    expect(view.getByText('修复已知问题')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('下载并安装'));
    expect(onDownloadAppUpdate).toHaveBeenCalledTimes(1);

    await view.rerender(
      <MoreScreen
        {...moreProps({
          update: {
            phase: 'downloading',
            progress: {
              title: '正在下载 1.4.0',
              downloadedBytes: 1024,
              totalBytes: 2048,
              percent: 50,
              percentLabel: '50%',
              sizeLabel: '1 KB / 2 KB'
            },
            info: appUpdateInfo,
            check: onCheckAppUpdate,
            start: onDownloadAppUpdate
          }
        })}
      />
    );
    expect(view.getByText('正在下载 1.4.0')).toBeTruthy();
    expect(view.getByText('50%')).toBeTruthy();
    expect(view.getByLabelText('下载中').props.accessibilityState.disabled).toBe(true);
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

    await fireEvent.press(view.getByText('服务器代理'));
    expect(onShowNetworkProxyPanelChange).toHaveBeenCalledWith(true);

    await fireEvent.press(view.getByLabelText('展开问题诊断'));
    expect(view.getByText(/日志只保存在本机并经过脱敏/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('生成并分享诊断日志'));
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
            backup: { busy: true, exportFile: onExportBackupFile, importFile: onImportBackupFile },
            diagnostics: { busy: true, exportLog: onExportDiagnosticLog }
          }
        })}
      />
    );
    expect(view.getByLabelText('正在生成').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('处理中').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('选择备份文件恢复').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('处理中'));
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
      <MoreScreen {...moreProps({ utilities: { backup: { recovery: true, exportFile, importFile } } })} />
    );
    expect(view.getByText(/本机资料读取失败，来源访问已暂停/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('展开备份 / 恢复'));
    expect(view.getByLabelText('导出备份文件').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('导出备份文件'));
    await fireEvent.press(view.getByLabelText('选择备份文件恢复'));
    expect(exportFile).not.toHaveBeenCalled();
    expect(importFile).toHaveBeenCalledTimes(1);
  });

  it('updates the read-channel threshold from Account Center', async () => {
    const updateSettings = jest.fn();
    const view = await render(
      <MoreScreen
        {...moreProps({
          utilities: { settings: { update: updateSettings } }
        })}
      />
    );

    await fireEvent.press(view.getByLabelText('展开账号中心'));
    await fireEvent.press(view.getByTestId('account-site-nodeseek'));
    await fireEvent.press(view.getByLabelText('站点设置'));
    await fireEvent.press(view.getByLabelText('4 次'));

    expect(updateSettings).toHaveBeenCalledWith({ nodeSeekRecoveryThreshold: 4 });
  });
});
