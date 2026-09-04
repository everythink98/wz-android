import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '../render';
import React, { type ComponentProps } from 'react';
import { Text, View } from 'react-native';
import { LinuxDoVerifyModal } from '@/features/account/components/LinuxDoVerifyModal';
import { LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import type { LinuxDoLevelProfile } from '@/sources/linuxdo/level';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { LinuxDoLevelPanel } from '@/features/more/components/LinuxDoLevelPanel';
import { NodeSeekLoginHost } from '@/features/account/components/NodeSeekLoginHost';
import { YaohuoLoginHost } from '@/features/account/components/YaohuoLoginHost';
import { NodeSeekServicesPanel } from '@/features/more/components/NodeSeekServicesPanel';
import { createSiteSessionStates, type SessionSite, type SiteSessionStatus } from '@/domain/session/siteSessionState';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';

let mockLoginWebViewProps: Record<string, any> = {};
let mockLoginWebViewMountCount = 0;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    CheckCircle: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    Image: Icon,
    RefreshCw: Icon
  };
});

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  return {
    usePanGesture: (config: Record<string, unknown>) => ({ config }),
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children)
  };
});

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View: NativeView
  } = require('react-native') as typeof import('react-native');
  const mockReload = jest.fn();
  const mockInjectJavaScript = jest.fn();
  const WebView = ReactModule.forwardRef(function MockWebView(props: Record<string, any>, ref) {
    mockLoginWebViewProps = props;
    ReactModule.useEffect(() => {
      mockLoginWebViewMountCount += 1;
    }, []);
    ReactModule.useImperativeHandle(ref, () => ({
      injectJavaScript: mockInjectJavaScript,
      reload: mockReload
    }));
    const button = (label: string, onPress: (() => void) | undefined) =>
      ReactModule.createElement(
        NativePressable,
        { accessibilityRole: 'button', accessibilityLabel: label, onPress },
        ReactModule.createElement(NativeText, null, label)
      );
    return ReactModule.createElement(
      NativeView,
      { testID: 'mock-login-webview' },
      ReactModule.createElement(NativeText, { testID: 'mock-login-webview-uri' }, props.source?.uri || ''),
      button('模拟 WebView 开始加载', () => props.onLoadStart?.()),
      button('模拟 WebView 加载完成', () => props.onLoadEnd?.({ nativeEvent: {} })),
      button('模拟 WebView 消息', () =>
        props.onMessage?.({ nativeEvent: { data: '{}', url: 'https://evil.example/frame' } })
      ),
      button('模拟 WebView 加载失败', () => props.onError?.({ nativeEvent: { description: '断网' } })),
      button('模拟 WebView 渲染进程退出', () => props.onRenderProcessGone?.())
    );
  });
  return { WebView, mockInjectJavaScript, mockReload };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);

function session(site: SessionSite, status: SiteSessionStatus) {
  const states = createSiteSessionStates();
  states[site] = {
    site,
    status,
    cookieSummary: status === 'anonymous' ? [] : ['session'],
    isVerifying: status === 'verifying',
    ...(status === 'logged-in' ? { currentUser: testAccountUser(site) } : {})
  };
  return projectTestAccountSessions(states)[site];
}

const levelProfile: LinuxDoLevelProfile = {
  username: 'alice',
  currentLevel: 1,
  targetLevel: 2,
  source: 'summary',
  estimate: true,
  note: '数据来自本机统计',
  requirements: [
    {
      key: 'days_visited',
      label: '访问天数',
      current: 5,
      required: 10,
      met: false,
      direction: 'minimum',
      ratio: 0.5,
      displayCurrent: '5',
      displayRequired: '10',
      change: 1,
      displayChange: '较上次 +1'
    }
  ],
  activity: {
    daysVisited: 5,
    topicsEntered: 20,
    postsReadCount: 120,
    timeRead: 3660,
    likesGiven: 8,
    likesReceived: 9,
    postCount: 10,
    topicCount: 2
  },
  achievedCount: 0,
  totalCount: 1,
  fetchedAt: '2026-07-14T01:00:00.000Z'
};

const officialRiskProfile: LinuxDoLevelProfile = {
  ...levelProfile,
  currentLevel: 2,
  targetLevel: 3,
  source: 'connect',
  estimate: false,
  note: '官方 Connect 页面读取到的当前状态。',
  requirements: [
    {
      key: 'connect:被举报帖子',
      label: '被举报帖子',
      current: 2,
      required: 5,
      met: true,
      direction: 'maximum',
      ratio: 0.4,
      displayCurrent: '2',
      displayRequired: '5',
      change: 1,
      displayChange: '较上次 +1'
    },
    {
      key: 'connect:举报用户',
      label: '举报用户',
      current: 1,
      required: 5,
      met: true,
      direction: 'maximum',
      ratio: 0.2,
      displayCurrent: '1',
      displayRequired: '5',
      change: -1,
      displayChange: '较上次 -1'
    },
    {
      key: 'connect:被禁言',
      label: '被禁言',
      current: 0,
      required: 0,
      met: true,
      direction: 'maximum',
      ratio: 0,
      displayCurrent: '0',
      displayRequired: '已通过'
    },
    {
      key: 'connect:被封禁',
      label: '被封禁',
      current: 1,
      required: 0,
      met: false,
      direction: 'maximum',
      ratio: 1,
      displayCurrent: '1',
      displayRequired: '需为 0',
      change: 2,
      displayChange: '较上次 +2'
    }
  ],
  achievedCount: 3,
  totalCount: 4
};

function nodeSeekProps(
  overrides: Partial<ComponentProps<typeof NodeSeekLoginHost>> = {}
): ComponentProps<typeof NodeSeekLoginHost> {
  return {
    checking: false,
    credentialAttempt: 3,
    credentialFillPending: false,
    credentialSaved: true,
    loading: false,
    loginFormMode: false,
    onCheck: jest.fn(),
    onClear: jest.fn(),
    onClose: jest.fn(),
    onHandleMessage: jest.fn(),
    onLoginFormMessage: () => false,
    onNavigation: () => true,
    onRequestCredentialFill: jest.fn(),
    onSetLoading: jest.fn(),
    onWebViewState: jest.fn(),
    session: session('nodeseek', 'anonymous'),
    styles,
    visible: false,
    webViewBlockMessage: '',
    webViewRef: { current: null },
    ...overrides
  };
}

function yaohuoProps(
  overrides: Partial<ComponentProps<typeof YaohuoLoginHost>> = {}
): ComponentProps<typeof YaohuoLoginHost> {
  return {
    checking: false,
    credentialAttempt: 4,
    credentialFillPending: false,
    credentialSaved: true,
    loading: false,
    loginFormMode: false,
    onCheck: jest.fn(),
    onClear: jest.fn(),
    onClose: jest.fn(),
    onLoginFormMessage: () => false,
    onNavigation: () => true,
    onRequestCredentialFill: jest.fn(),
    onSetLoading: jest.fn(),
    onWebViewState: jest.fn(),
    prompt: '登录后返回本页检测状态',
    session: session('yaohuo', 'anonymous'),
    styles,
    visible: true,
    webViewBlockMessage: '',
    webViewRef: { current: null },
    ...overrides
  };
}

function linuxDoVerifyProps(
  overrides: Partial<ComponentProps<typeof LinuxDoVerifyModal>> = {}
): ComponentProps<typeof LinuxDoVerifyModal> {
  return {
    checking: false,
    credentialAttempt: 5,
    credentialFillPending: false,
    credentialSaved: true,
    handleLinuxDoNavigation: () => true,
    linuxDoSession: session('linuxdo', 'anonymous'),
    linuxDoWebViewError: '',
    linuxDoWebViewKey: 1,
    linuxDoWebViewRef: { current: null },
    loadingLinuxDoPage: true,
    loginFormMode: false,
    mountLinuxDoWebView: true,
    onCheckLinuxDoCookie: jest.fn(),
    onClearLinuxDoCookie: jest.fn(),
    onHandleLinuxDoMessage: jest.fn(),
    onLoginFormMessage: () => false,
    onRequestCredentialFill: jest.fn(),
    onResetLinuxDoWebView: jest.fn(),
    onSetLinuxDoWebViewError: jest.fn(),
    onSetLoadingLinuxDoPage: jest.fn(),
    onShowLinuxDoPanelChange: jest.fn(),
    showLinuxDoPanel: true,
    styles,
    webViewBlockMessage: '',
    ...overrides
  };
}

describe('Account site panels', () => {
  it('shows the shared login modal loading, error, actions and close behavior', async () => {
    const onClose = jest.fn();
    const onRetry = jest.fn();
    const view = await render(
      <LoginWebViewModal
        actions={<Text onPress={onRetry}>重试登录页</Text>}
        error="页面加载失败"
        loading
        loadingText="正在打开登录页"
        title="站点登录"
        subtitle="未登录"
        visible
        onClose={onClose}
      >
        <View>
          <Text>WebView 内容</Text>
        </View>
      </LoginWebViewModal>
    );

    expect(view.getByText('正在打开登录页')).toBeTruthy();
    expect(view.getByText('页面加载失败')).toBeTruthy();
    await fireEvent.press(view.getByText('重试登录页'));
    await fireEvent.press(view.getByLabelText('关闭'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('guides anonymous linux.do users and switches a loaded profile between progress and activity', async () => {
    const onOpenLogin = jest.fn();
    const onRefresh = jest.fn();
    const view = await render(
      <LinuxDoLevelPanel
        busy={false}
        error=""
        siteSession={session('linuxdo', 'anonymous')}
        profile={null}
        styles={styles}
        theme={theme}
        onOpenLogin={onOpenLogin}
        onRefresh={onRefresh}
      />
    );

    expect(view.getByText(/需要先保存 linux\.do 登录 Cookie/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('打开 linux.do 登录 / 验证'));
    expect(onOpenLogin).toHaveBeenCalledTimes(1);

    await view.rerender(
      <LinuxDoLevelPanel
        busy={false}
        error=""
        siteSession={session('linuxdo', 'logged-in')}
        profile={levelProfile}
        styles={styles}
        theme={theme}
        onOpenLogin={onOpenLogin}
        onRefresh={onRefresh}
      />
    );
    expect(view.getByText('LV 1 → LV 2')).toBeTruthy();
    expect(view.getByText('5 / 10')).toBeTruthy();
    await fireEvent.press(view.getByText('活跃数据'));
    expect(view.getByText('1小时1分')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('刷新等级'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows official maximum requirements as risk usage instead of positive completion', async () => {
    const view = await render(
      <LinuxDoLevelPanel
        busy={false}
        error=""
        siteSession={session('linuxdo', 'logged-in')}
        profile={officialRiskProfile}
        styles={styles}
        theme={theme}
        onOpenLogin={jest.fn()}
        onRefresh={jest.fn()}
      />
    );

    expect(view.getByText('官方要求')).toBeTruthy();
    expect(view.getByText('通过 3 / 4 项')).toBeTruthy();
    expect(view.getByText('2 / 5')).toBeTruthy();
    expect(view.queryByText('40%')).toBeNull();
    expect(view.getAllByTestId('level-risk-used-connect:被举报帖子')).toHaveLength(2);
    expect(view.getAllByTestId('level-risk-remaining-connect:被举报帖子')).toHaveLength(3);
    expect(view.getAllByTestId('level-risk-used-connect:被举报帖子')[0]).toHaveStyle(styles.levelRiskSegmentUsed);
    expect(view.getAllByTestId('level-risk-remaining-connect:被举报帖子')[0]).toHaveStyle(
      styles.levelRiskSegmentRemaining
    );

    const quota = view.getByLabelText('被举报帖子，风险已用 2 / 5，剩余 3，已通过');
    expect(quota.props.accessibilityRole).toBe('progressbar');
    expect(quota.props.accessibilityValue).toEqual({ min: 0, max: 5, now: 2, text: '风险已用 2 / 5' });
    expect(view.getByTestId('level-veto-connect:被禁言').props.accessibilityLabel).toBe('被禁言，当前 0，已通过');
    expect(view.getByTestId('level-veto-connect:被封禁').props.accessibilityLabel).toBe(
      '被封禁，当前 1，未通过，较上次 +2 · 变差'
    );
    expect(view.getByText('较上次 +1 · 变差')).toHaveStyle(styles.levelChangeDanger);
    expect(view.getByText('较上次 -1 · 改善')).toHaveStyle(styles.levelChangeSuccess);
  });

  it('bounds visual segments for a customized remote risk limit without changing its exact values', async () => {
    const requirement = officialRiskProfile.requirements[0];
    const profile: LinuxDoLevelProfile = {
      ...officialRiskProfile,
      requirements: [
        {
          ...requirement,
          key: 'connect:自定义风险',
          label: '自定义风险',
          current: 25,
          required: 1000,
          ratio: 0.025,
          displayCurrent: '25',
          displayRequired: '1000'
        }
      ],
      achievedCount: 1,
      totalCount: 1
    };
    const view = await render(
      <LinuxDoLevelPanel
        busy={false}
        error=""
        siteSession={session('linuxdo', 'logged-in')}
        profile={profile}
        styles={styles}
        theme={theme}
        onOpenLogin={jest.fn()}
        onRefresh={jest.fn()}
      />
    );

    expect(view.getByText('25 / 1000')).toBeTruthy();
    expect(view.getByLabelText('自定义风险，风险已用 25 / 1000，剩余 975，已通过')).toBeTruthy();
    expect(view.getAllByTestId('level-risk-used-connect:自定义风险')).toHaveLength(1);
    expect(view.getAllByTestId('level-risk-remaining-connect:自定义风险')).toHaveLength(19);
  });

  it('validates and routes the NodeImage key without opening a real login page', async () => {
    const onAuthorizeNodeImageApiKey = jest.fn();
    const onSaveNodeImageApiKey = jest.fn();
    const onRecoveryThresholdChange = jest.fn();
    const view = await render(
      <NodeSeekServicesPanel
        apiKeyBusy={false}
        apiKeySaved={false}
        recoveryThreshold={1}
        session={session('nodeseek', 'anonymous')}
        styles={styles}
        theme={theme}
        onAuthorizeApiKey={onAuthorizeNodeImageApiKey}
        onCheckIn={jest.fn()}
        onClearApiKey={jest.fn()}
        onRecoveryThresholdChange={onRecoveryThresholdChange}
        onSaveApiKey={onSaveNodeImageApiKey}
      />
    );

    expect(view.getByText('读取通道自愈阈值')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('3 次'));
    expect(onRecoveryThresholdChange).toHaveBeenCalledWith(3);

    await fireEvent.press(view.getByText('NodeImage API Key'));
    await fireEvent.press(view.getByLabelText('获取 / 恢复授权'));
    expect(onAuthorizeNodeImageApiKey).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText('手动粘贴备用'));
    expect(view.getByLabelText('保存 Key').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('NodeImage API Key 输入')).toBeTruthy();
    await fireEvent.changeText(view.getByPlaceholderText('NodeImage API Key'), 'local-test-key');
    expect(view.getByLabelText('保存 Key').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('保存 Key'));
    expect(onSaveNodeImageApiKey).toHaveBeenCalledWith('local-test-key');
    expect(view.getByPlaceholderText('NodeImage API Key').props.value).toBe('');
  });

  it('settles the App-owned NodeSeek WebView flow and detects only after the user asks', async () => {
    const onCheckLogin = jest.fn();
    const onSetLoadingLoginPage = jest.fn();
    const onShowLoginPanelChange = jest.fn();
    const onWebViewState = jest.fn();
    const props = nodeSeekProps({
      loading: true,
      onCheck: onCheckLogin,
      onSetLoading: onSetLoadingLoginPage,
      onClose: onShowLoginPanelChange,
      onWebViewState,
      visible: true
    });
    const view = await render(<NodeSeekLoginHost {...props} />);

    expect(view.getByText('正在打开 NodeSeek...')).toBeTruthy();
    expect(view.queryByTestId('nodeseek-login-webview-settled')).toBeNull();
    expect(view.getByLabelText('刷新页面')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('模拟 WebView 加载完成'));
    await waitFor(() => {
      expect(onWebViewState).toHaveBeenCalledWith('ready', 3);
    });
    expect(view.getByTestId('nodeseek-login-webview-settled')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('检测登录'));
    expect(onCheckLogin).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByLabelText('模拟 WebView 加载失败'));
    expect(view.getByText('NodeSeek 页面加载失败：断网')).toBeTruthy();
    expect(view.getByTestId('nodeseek-login-webview-settled')).toBeTruthy();
    expect(onWebViewState).toHaveBeenCalledWith('error', 3);
    expect(onSetLoadingLoginPage).toHaveBeenCalledWith(false);

    await fireEvent.press(view.getByLabelText('刷新页面'));
    expect(onSetLoadingLoginPage).toHaveBeenLastCalledWith(true);
    expect(view.queryByTestId('nodeseek-login-webview-settled')).toBeNull();
    const webViewMock = jest.requireMock('react-native-webview') as { mockReload: jest.Mock };
    expect(webViewMock.mockReload).toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('关闭'));
    expect(onShowLoginPanelChange).toHaveBeenCalledTimes(1);

    await view.rerender(
      <NodeSeekLoginHost
        {...nodeSeekProps({
          visible: true,
          webViewBlockMessage: '当前环境禁止打开登录页'
        })}
      />
    );
    expect(view.getByTestId('nodeseek-login-webview-settled')).toBeTruthy();
  });

  it('lets Android choose the NodeSeek verification WebView user agent', async () => {
    await render(<NodeSeekLoginHost {...nodeSeekProps({ visible: true })} />);

    expect(mockLoginWebViewProps.userAgent).toBeUndefined();
  });

  it('unmounts a timed-out NodeSeek WebView until the user refreshes', async () => {
    jest.useFakeTimers();
    try {
      mockLoginWebViewMountCount = 0;
      const view = await render(
        <NodeSeekLoginHost
          {...nodeSeekProps({
            loading: true,
            visible: true
          })}
        />
      );

      expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(12_000);
      });

      expect(view.getByText('NodeSeek 页面打开超时：请检查模拟器网络后刷新页面。')).toBeTruthy();
      expect(view.queryByTestId('mock-login-webview')).toBeNull();
      expect(view.getByTestId('nodeseek-login-webview-settled')).toBeTruthy();

      await fireEvent.press(view.getByLabelText('刷新页面'));
      expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      expect(mockLoginWebViewMountCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps login WebViews mounted while a new credential fill attempt is injected', async () => {
    mockLoginWebViewMountCount = 0;
    const nodeSeek = await render(
      <NodeSeekLoginHost
        {...nodeSeekProps({
          credentialAttempt: 1,
          loginFormMode: true,
          visible: true
        })}
      />
    );
    expect(mockLoginWebViewMountCount).toBe(1);
    const nodeSeekWebViewMock = jest.requireMock('react-native-webview') as { mockInjectJavaScript: jest.Mock };
    nodeSeekWebViewMock.mockInjectJavaScript.mockClear();

    await nodeSeek.rerender(
      <NodeSeekLoginHost
        {...nodeSeekProps({
          credentialAttempt: 2,
          loginFormMode: true,
          visible: true
        })}
      />
    );
    expect(mockLoginWebViewMountCount).toBe(1);
    expect(nodeSeekWebViewMock.mockInjectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('const attempt = 2;')
    );
    await nodeSeek.unmount();

    mockLoginWebViewMountCount = 0;
    const yaohuo = await render(
      <YaohuoLoginHost
        {...yaohuoProps({
          credentialAttempt: 1,
          loginFormMode: true
        })}
      />
    );
    expect(mockLoginWebViewMountCount).toBe(1);
    const yaohuoWebViewMock = jest.requireMock('react-native-webview') as { mockInjectJavaScript: jest.Mock };
    yaohuoWebViewMock.mockInjectJavaScript.mockClear();

    await yaohuo.rerender(
      <YaohuoLoginHost
        {...yaohuoProps({
          credentialAttempt: 2,
          loginFormMode: true
        })}
      />
    );
    expect(mockLoginWebViewMountCount).toBe(1);
    expect(yaohuoWebViewMock.mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('const attempt = 2;'));
    await yaohuo.unmount();
  });

  it('lets Android choose the linux.do verification WebView user agent', async () => {
    await render(<LinuxDoVerifyModal {...linuxDoVerifyProps()} />);

    expect(mockLoginWebViewProps.userAgent).toBeUndefined();
  });

  it('unmounts a timed-out linux.do WebView until the user refreshes', async () => {
    jest.useFakeTimers();
    try {
      const onResetLinuxDoWebView = jest.fn();
      const props = linuxDoVerifyProps({ onResetLinuxDoWebView });
      const view = await render(<LinuxDoVerifyModal {...props} />);

      expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(12_000);
      });

      expect(view.queryByTestId('mock-login-webview')).toBeNull();
      await fireEvent.press(view.getByLabelText('刷新页面'));
      expect(onResetLinuxDoWebView).toHaveBeenCalledTimes(1);
      await view.rerender(
        <LinuxDoVerifyModal
          {...linuxDoVerifyProps({
            linuxDoWebViewKey: 2,
            onResetLinuxDoWebView
          })}
        />
      );
      expect(view.getByTestId('mock-login-webview')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('invalidates the linux.do document probe on every navigation after the page was ready', async () => {
    const onSetLoadingLinuxDoPage = jest.fn();
    const view = await render(<LinuxDoVerifyModal {...linuxDoVerifyProps({ onSetLoadingLinuxDoPage })} />);

    await fireEvent.press(view.getByLabelText('模拟 WebView 加载完成'));
    onSetLoadingLinuxDoPage.mockClear();
    await fireEvent.press(view.getByLabelText('模拟 WebView 开始加载'));

    expect(onSetLoadingLinuxDoPage).toHaveBeenCalledWith(true, 1);
  });

  it('lets Android choose the Yaohuo login WebView user agent', async () => {
    await render(<YaohuoLoginHost {...yaohuoProps()} />);

    expect(mockLoginWebViewProps.userAgent).toBeUndefined();
  });

  it('keeps a confirmed Yaohuo session page open while identity reconciliation runs', async () => {
    const confirmed = session('yaohuo', 'logged-in');
    const view = await render(
      <YaohuoLoginHost
        {...yaohuoProps({
          session: {
            ...confirmed,
            isVerifying: true
          }
        })}
      />
    );

    expect(view.getByTestId('mock-login-webview-uri').props.children).toBe(
      'https://www.yaohuo.me/wapindex.aspx?sid=-2'
    );
  });

  it('settles on an explicit error', async () => {
    const view = await render(<NodeSeekLoginHost {...nodeSeekProps({ loading: true, visible: true })} />);

    await fireEvent.press(view.getByLabelText('模拟 WebView 加载失败'));
    await fireEvent.press(view.getByLabelText('模拟 WebView 消息'));

    expect(view.getByText('NodeSeek 页面加载失败：断网')).toBeTruthy();
    expect(view.getByTestId('nodeseek-login-webview-settled')).toBeTruthy();
    expect(view.queryByTestId('nodeseek-login-webview-ready')).toBeNull();
  });

  it('does not settle from an arbitrary third-party frame message', async () => {
    const view = await render(<NodeSeekLoginHost {...nodeSeekProps({ loading: true, visible: true })} />);

    await fireEvent.press(view.getByLabelText('模拟 WebView 消息'));

    expect(view.queryByTestId('nodeseek-login-webview-settled')).toBeNull();
    expect(view.queryByTestId('nodeseek-login-webview-ready')).toBeNull();
  });

  it('keeps Yaohuo readiness passive and unmounts it while blocked', async () => {
    const onCheckYaohuoLogin = jest.fn();
    const onSetLoadingYaohuoLoginPage = jest.fn();
    const onWebViewState = jest.fn();
    const view = await render(
      <YaohuoLoginHost
        {...yaohuoProps({
          onCheck: onCheckYaohuoLogin,
          onSetLoading: onSetLoadingYaohuoLoginPage,
          onWebViewState
        })}
      />
    );

    expect(view.getByText('登录后返回本页检测状态')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('模拟 WebView 加载完成'));
    expect(onWebViewState).toHaveBeenCalledWith('ready', 4);
    expect(onCheckYaohuoLogin).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('检测登录'));
    expect(onCheckYaohuoLogin).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText('模拟 WebView 加载失败'));
    expect(view.getByText('妖火页面加载失败：断网')).toBeTruthy();
    expect(onWebViewState).toHaveBeenCalledWith('error', 4);
    await fireEvent.press(view.getByLabelText('刷新页面'));
    expect(onSetLoadingYaohuoLoginPage).toHaveBeenLastCalledWith(true);

    await view.rerender(
      <YaohuoLoginHost
        {...yaohuoProps({
          onCheck: onCheckYaohuoLogin,
          onSetLoading: onSetLoadingYaohuoLoginPage,
          onWebViewState,
          webViewBlockMessage: '代理状态切换中'
        })}
      />
    );
    expect(view.getByText('代理状态切换中')).toBeTruthy();
    expect(view.queryByTestId('mock-login-webview')).toBeNull();
  });

  it('unmounts a timed-out Yaohuo WebView until the user refreshes', async () => {
    jest.useFakeTimers();
    try {
      mockLoginWebViewMountCount = 0;
      const view = await render(
        <YaohuoLoginHost
          {...yaohuoProps({
            loading: true
          })}
        />
      );

      expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(12_000);
      });

      expect(view.getByText('妖火页面打开超时：请检查模拟器网络后刷新页面。')).toBeTruthy();
      expect(view.queryByTestId('mock-login-webview')).toBeNull();

      await fireEvent.press(view.getByLabelText('刷新页面'));
      expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      expect(mockLoginWebViewMountCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows linux.do block messages and keeps all verification actions available', async () => {
    const onCheckLinuxDoCookie = jest.fn();
    const onClearLinuxDoCookie = jest.fn();
    const onRequestCredentialFill = jest.fn();
    const onResetLinuxDoWebView = jest.fn();
    const props = linuxDoVerifyProps({
      onCheckLinuxDoCookie,
      onClearLinuxDoCookie,
      onRequestCredentialFill,
      onResetLinuxDoWebView,
      webViewBlockMessage: '当前环境禁止打开登录页'
    });
    const view = await render(<LinuxDoVerifyModal {...props} />);

    expect(view.getByText('当前环境禁止打开登录页')).toBeTruthy();
    expect(view.queryByTestId('mock-login-webview')).toBeNull();
    await fireEvent.press(view.getByLabelText('填入已保存登录信息'));
    await fireEvent.press(view.getByLabelText('检测状态'));
    await fireEvent.press(view.getByLabelText('清除登录'));
    await fireEvent.press(view.getByLabelText('刷新页面'));
    expect(onRequestCredentialFill).toHaveBeenCalledTimes(1);
    expect(onCheckLinuxDoCookie).toHaveBeenCalledTimes(1);
    expect(onClearLinuxDoCookie).toHaveBeenCalledTimes(1);
    expect(onResetLinuxDoWebView).toHaveBeenCalledTimes(1);
  });
});
