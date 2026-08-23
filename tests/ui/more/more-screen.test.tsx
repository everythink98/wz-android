import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '../render';
import React, { type ComponentProps, useState } from 'react';
import { StyleSheet } from 'react-native';
import { emptyCredentialSummaries } from '@/platform/storage/credentialVault';
import { createEmptyNetworkProxyState } from '@/platform/network/networkProxy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { MoreScreen as MoreScreenView } from '@/features/more/MoreScreen';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import { createTheme } from '@/ui/theme/tokens';

let mockDragRunsOnJS = false;
let mockDeferScheduleOnRN = false;
let mockDeferredRNCalls: (() => unknown)[] = [];
let mockSharedValues: { value: unknown }[] = [];
const mockScheduleOnRN = jest.fn((callback: (...args: unknown[]) => unknown, ...args: unknown[]) => callback(...args));
const mockWithTiming = jest.fn((value: unknown) => value);

beforeEach(() => {
  mockDragRunsOnJS = false;
  mockDeferScheduleOnRN = false;
  mockDeferredRNCalls = [];
  mockSharedValues = [];
  mockScheduleOnRN.mockClear();
  mockWithTiming.mockClear();
});

jest.mock('react-native-safe-area-context', () => ({
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
    },
    withTiming: (value: unknown) => mockWithTiming(value)
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
    Gesture: {
      Pan: () => ({
        handlers: {} as Record<string, (...args: unknown[]) => void>,
        activateAfterLongPress() {
          return this;
        },
        minDistance() {
          return this;
        },
        runOnJS(enabled = true) {
          mockDragRunsOnJS = enabled;
          return this;
        },
        onBegin(handler: (...args: unknown[]) => void) {
          this.handlers.onGestureBegin = handler;
          return this;
        },
        onStart(handler: (...args: unknown[]) => void) {
          this.handlers.onGestureStart = handler;
          return this;
        },
        onUpdate(handler: (...args: unknown[]) => void) {
          this.handlers.onGestureUpdate = handler;
          return this;
        },
        onEnd(handler: (...args: unknown[]) => void) {
          this.handlers.onGestureEnd = handler;
          return this;
        },
        onFinalize(handler: (...args: unknown[]) => void) {
          this.handlers.onGestureFinalize = handler;
          return this;
        }
      })
    },
    GestureDetector: ({
      children,
      gesture
    }: {
      children: React.ReactElement<Record<string, unknown>>;
      gesture: { handlers?: Record<string, (...args: unknown[]) => void> };
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
    Trash2: Icon,
    User: Icon,
    X: Icon
  };
});

const readerData = createEmptyReaderData();
const sessionViewModels = createSiteSessionViewModels(createSiteSessionStates());
const authorizedLinuxDoSessions = createSiteSessionViewModels(
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
        url: 'https://linux.do/u/alice',
        topics: []
      }
    }
  })
);

function MoreScreen(props: ComponentProps<typeof MoreScreenView>) {
  const [contentSourcesExpanded, setContentSourcesExpanded] = useState(props.contentSourcesExpanded);
  return (
    <MoreScreenView
      {...props}
      contentSourcesExpanded={contentSourcesExpanded}
      onContentSourcesExpandedChange={setContentSourcesExpanded}
    />
  );
}

type MoreScreenProps = ComponentProps<typeof MoreScreen>;
type MoreScreenOverrides = {
  account?: {
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
    notifications?: Partial<MoreScreenProps['utilities']['notifications']>;
    backup?: Partial<MoreScreenProps['utilities']['backup']>;
    diagnostics?: Partial<MoreScreenProps['utilities']['diagnostics']>;
    proxy?: Partial<MoreScreenProps['utilities']['proxy']>;
    settings?: Partial<MoreScreenProps['utilities']['settings']>;
  };
};

function moreProps(overrides: MoreScreenOverrides = {}): MoreScreenProps {
  const account: MoreScreenProps['account'] = {
    enabledSessionSources: ['nodeseek', 'linuxdo', 'yaohuo'],
    read: {
      sessions: sessionViewModels,
      statusBusy: false,
      ...overrides.account?.read
    },
    center: {
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
      busy: false,
      downloading: false,
      progress: null,
      info: null,
      message: '当前版本 1.3.63',
      check: jest.fn(),
      download: jest.fn(),
      ...overrides.update
    },
    utilities: {
      notifications: {
        hasUnread: false,
        open: jest.fn(),
        summary: '暂无未读 · 后台通知未开启',
        ...overrides.utilities?.notifications
      },
      backup: {
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

  it('[REG-MORE-001] keeps settled rows off the Fabric transform path while other panels expand', async () => {
    const view = await render(<MoreScreen {...moreProps()} />);

    expect(view.queryByTestId('content-source-row-v2ex')).toBeNull();
    await fireEvent.press(view.getByLabelText('展开账号中心'));
    await fireEvent.press(view.getByLabelText('展开内容源'));

    for (const source of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']) {
      expect(StyleSheet.flatten(view.getByTestId(`content-source-row-${source}`).props.style)).toHaveProperty(
        'transform',
        undefined
      );
    }

    await fireEvent.press(view.getByLabelText('展开问题诊断'));
    expect(view.getByText(/日志只保存在本机并经过脱敏/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('展开备份 / 恢复'));
    expect(view.getByLabelText('导出备份文件')).toBeTruthy();
  });

  it('[REG-PERF-011] keeps drag frames off JS and persists the final source order once', async () => {
    const updateSettings = jest.fn();
    const view = await render(<MoreScreen {...moreProps({ utilities: { settings: { update: updateSettings } } })} />);
    await fireEvent.press(view.getByLabelText('展开内容源'));

    for (const [index, source] of ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'].entries()) {
      await fireEvent(view.getByTestId(`content-source-row-${source}`), 'layout', {
        nativeEvent: { layout: { height: 56, width: 300, x: 0, y: index * 56 } }
      });
    }
    const handle = view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项');
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
      handle.props.onGestureFinalize({}, true);
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
      handle.props.onGestureFinalize({}, false);
    });
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      handle.props.onGestureUpdate({ translationY: 10_000 });
      handle.props.onGestureFinalize({}, true);
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
    await act(async () => handle.props.onGestureFinalize({}, true));
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('[REG-PERF-012][REG-MORE-002] keeps each source on one native host across forward and reverse reorders', async () => {
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
    mockWithTiming.mockClear();
    await act(async () => {
      handle.props.onGestureStart({ translationY: 0 });
      handle.props.onGestureUpdate({ translationY: 56 });
    });
    expect(mockWithTiming).not.toHaveBeenCalled();
    const dragTranslation = mockSharedValues[3];
    expect(dragTranslation?.value).toBe(56);

    mockDeferScheduleOnRN = true;
    await act(async () => handle.props.onGestureFinalize({}, true));

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
      reverseHandle.props.onGestureFinalize({}, true);
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
    expect(StyleSheet.flatten(view.getByTestId('content-source-row-v2ex').props.style)).toHaveProperty(
      'transform',
      undefined
    );
    expect(StyleSheet.flatten(view.getByTestId('content-source-row-linuxdo').props.style)).toHaveProperty(
      'transform',
      undefined
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
        undefined
      );
    }

    await act(async () =>
      view.getByLabelText('拖动排序：V2EX，第 1 项，共 4 项').props.onGestureStart({ translationY: 0 })
    );
    expect(dragTranslation?.value).toBe(0);
  });

  it('[REG-NOTIFY-052] shows which More entry owns the unread badge', async () => {
    const open = jest.fn();
    const view = await render(
      <MoreScreen
        {...moreProps({
          utilities: {
            notifications: { hasUnread: true, open, summary: '有未读 · 后台通知已开启' }
          }
        })}
      />
    );

    await fireEvent.press(view.getByLabelText('消息通知，有未读 · 后台通知已开启'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(view.getByTestId('more-notifications-unread-dot').props.style)).toMatchObject({
      backgroundColor: createTheme(readerData.settings).danger,
      height: 8,
      width: 8
    });
    expect(StyleSheet.flatten(view.getByTestId('more-notifications-row').props.style)).toMatchObject({
      borderBottomColor: createTheme(readerData.settings).line,
      borderBottomWidth: StyleSheet.hairlineWidth
    });

    await view.rerender(<MoreScreen {...moreProps()} />);
    expect(view.queryByTestId('more-notifications-unread-dot')).toBeNull();
  });

  it('shows current, checking, available-update and download progress states', async () => {
    const onCheckAppUpdate = jest.fn();
    const onDownloadAppUpdate = jest.fn();
    const view = await render(
      <MoreScreen {...moreProps({ update: { check: onCheckAppUpdate, download: onDownloadAppUpdate } })} />
    );

    expect(view.queryByText('有新版本')).toBeNull();
    await fireEvent.press(view.getByLabelText('检查更新'));
    expect(onCheckAppUpdate).toHaveBeenCalledTimes(1);

    await view.rerender(
      <MoreScreen {...moreProps({ update: { busy: true, check: onCheckAppUpdate, download: onDownloadAppUpdate } })} />
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
            download: onDownloadAppUpdate
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
            busy: true,
            downloading: true,
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
            download: onDownloadAppUpdate
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

  it('[REG-TEST-003] never exposes an in-app anonymous simulation', async () => {
    const view = await render(<MoreScreen {...moreProps()} />);

    expect(view.queryByLabelText('展开测试工具')).toBeNull();
  });

  it('[REG-NODESEEK-004] updates the read-channel threshold from Account Center', async () => {
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
    await fireEvent.press(view.getByLabelText('4 次'));

    expect(updateSettings).toHaveBeenCalledWith({ nodeSeekRecoveryThreshold: 4 });
  });
});
