import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React, { type ComponentProps } from 'react';
import { Text, View } from 'react-native';
import { LinuxDoVerifyModal } from '../../src/app/LinuxDoVerifyModal';
import { LoginWebViewModal } from '../../src/components/LoginWebViewModal';
import type { LinuxDoLevelProfile } from '../../src/linuxdoLevel';
import { createEmptyReaderData } from '../../src/readerData';
import { LinuxDoLevelPanel } from '../../src/screens/more/LinuxDoLevelPanel';
import { NodeSeekLoginPanel, YaohuoLoginPanel } from '../../src/screens/more/MorePanels';
import {
  createSiteSessionStates,
  createSiteSessionViewModels,
  type SessionSite,
  type SiteSessionStatus
} from '../../src/siteSessionState';
import { createStyles, createTheme } from '../../src/theme';

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
    Gesture: {
      Pan: () => ({
        minDistance() { return this; },
        runOnJS() { return this; },
        onBegin() { return this; },
        onUpdate() { return this; },
        onEnd() { return this; },
        onFinalize() { return this; }
      })
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children)
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
    const button = (label: string, onPress: (() => void) | undefined) => ReactModule.createElement(
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
      button('模拟 WebView 消息', () => props.onMessage?.({ nativeEvent: { data: '{}', url: 'https://evil.example/frame' } })),
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
    isVerifying: status === 'verifying'
  };
  return createSiteSessionViewModels(states)[site];
}

const levelProfile: LinuxDoLevelProfile = {
  username: 'alice',
  currentLevel: 1,
  targetLevel: 2,
  source: 'summary',
  estimate: true,
  note: '数据来自本机统计',
  requirements: [{
    key: 'days_visited',
    label: '访问天数',
    current: 5,
    required: 10,
    met: false,
    ratio: 0.5,
    displayCurrent: '5',
    displayRequired: '10',
    displayChange: '较上次 +1'
  }],
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

function nodeSeekProps(overrides: Partial<ComponentProps<typeof NodeSeekLoginPanel>> = {}): ComponentProps<typeof NodeSeekLoginPanel> {
  return {
    accountExpanded: true,
    checking: false,
    credentialAttempt: 3,
    credentialFillPending: false,
    credentialSaved: true,
    handleNodeSeekLoginNavigation: () => true,
    loadingLoginPage: false,
    loginFormMode: false,
    nodeImageApiKeyBusy: false,
    nodeImageApiKeySaved: false,
    nodeSeekSession: session('nodeseek', 'anonymous'),
    onAuthorizeNodeImageApiKey: jest.fn(),
    onCheckIn: jest.fn(),
    onCheckLogin: jest.fn(),
    onClearLogin: jest.fn(),
    onClearNodeImageApiKey: jest.fn(),
    onHandleLoginMessage: jest.fn(),
    onLoginFormMessage: () => false,
    onRequestCredentialFill: jest.fn(),
    onSaveNodeImageApiKey: jest.fn(),
    onSetLoadingLoginPage: jest.fn(),
    onShowLoginPanelChange: jest.fn(),
    onWebViewState: jest.fn(),
    showLoginPanel: false,
    styles,
    theme,
    webViewBlockMessage: '',
    webViewRef: { current: null },
    ...overrides
  };
}

function yaohuoProps(overrides: Partial<ComponentProps<typeof YaohuoLoginPanel>> = {}): ComponentProps<typeof YaohuoLoginPanel> {
  return {
    accountExpanded: true,
    checking: false,
    credentialAttempt: 4,
    credentialFillPending: false,
    credentialSaved: true,
    handleYaohuoLoginNavigation: () => true,
    loadingYaohuoLoginPage: false,
    loginFormMode: false,
    onCheckYaohuoLogin: jest.fn(),
    onClearYaohuoLogin: jest.fn(),
    onLoginFormMessage: () => false,
    onRequestCredentialFill: jest.fn(),
    onSetLoadingYaohuoLoginPage: jest.fn(),
    onShowYaohuoLoginPanelChange: jest.fn(),
    onWebViewState: jest.fn(),
    showYaohuoLoginPanel: true,
    styles,
    theme,
    webViewBlockMessage: '',
    yaohuoLoginPrompt: '登录后返回本页检测状态',
    yaohuoSession: session('yaohuo', 'anonymous'),
    yaohuoWebViewRef: { current: null },
    ...overrides
  };
}

function linuxDoVerifyProps(overrides: Partial<ComponentProps<typeof LinuxDoVerifyModal>> = {}): ComponentProps<typeof LinuxDoVerifyModal> {
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
    theme,
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
        styles={styles}
        theme={theme}
        title="站点登录"
        subtitle="未登录"
        visible
        onClose={onClose}
      >
        <View><Text>WebView 内容</Text></View>
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

  it('validates and routes the NodeImage key without opening a real login page', async () => {
    const onAuthorizeNodeImageApiKey = jest.fn();
    const onSaveNodeImageApiKey = jest.fn();
    const view = await render(<NodeSeekLoginPanel {...nodeSeekProps({
      onAuthorizeNodeImageApiKey,
      onSaveNodeImageApiKey
    })} />);

    await fireEvent.press(view.getByText('NodeImage API Key'));
    await fireEvent.press(view.getByLabelText('获取 / 恢复授权'));
    expect(onAuthorizeNodeImageApiKey).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText('手动粘贴备用'));
    expect(view.getByLabelText('保存 Key').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(view.getByPlaceholderText('NodeImage API Key'), 'local-test-key');
    expect(view.getByLabelText('保存 Key').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('保存 Key'));
    expect(onSaveNodeImageApiKey).toHaveBeenCalledWith('local-test-key');
    expect(view.getByPlaceholderText('NodeImage API Key').props.value).toBe('');
  });

  it('[REG-VERIFICATION-001] settles the App-owned NodeSeek WebView flow and detects only after the user asks', async () => {
    const onCheckLogin = jest.fn();
    const onSetLoadingLoginPage = jest.fn();
    const onShowLoginPanelChange = jest.fn();
    const onWebViewState = jest.fn();
    const props = nodeSeekProps({
      loadingLoginPage: true,
      onCheckLogin,
      onSetLoadingLoginPage,
      onShowLoginPanelChange,
      onWebViewState,
      showLoginPanel: true
    });
    const view = await render(<NodeSeekLoginPanel {...props} />);

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
    expect(onShowLoginPanelChange).toHaveBeenCalledWith(false);

    await view.rerender(<NodeSeekLoginPanel {...nodeSeekProps({
      showLoginPanel: true,
      webViewBlockMessage: '当前环境禁止打开登录页'
    })} />);
    expect(view.getByTestId('nodeseek-login-webview-settled')).toBeTruthy();
  });

  it('[REG-VERIFICATION-003] lets Android choose the NodeSeek verification WebView user agent', async () => {
    await render(<NodeSeekLoginPanel {...nodeSeekProps({ showLoginPanel: true })} />);

    expect(mockLoginWebViewProps.userAgent).toBeUndefined();
  });

  it('[REG-ACCOUNT-022] keeps login WebViews mounted while a new credential fill attempt is injected', async () => {
    mockLoginWebViewMountCount = 0;
    const nodeSeek = await render(<NodeSeekLoginPanel {...nodeSeekProps({
      credentialAttempt: 1,
      loginFormMode: true,
      showLoginPanel: true
    })} />);
    expect(mockLoginWebViewMountCount).toBe(1);
    const nodeSeekWebViewMock = jest.requireMock('react-native-webview') as { mockInjectJavaScript: jest.Mock };
    nodeSeekWebViewMock.mockInjectJavaScript.mockClear();

    await nodeSeek.rerender(<NodeSeekLoginPanel {...nodeSeekProps({
      credentialAttempt: 2,
      loginFormMode: true,
      showLoginPanel: true
    })} />);
    expect(mockLoginWebViewMountCount).toBe(1);
    expect(nodeSeekWebViewMock.mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('const attempt = 2;'));
    await nodeSeek.unmount();

    mockLoginWebViewMountCount = 0;
    const yaohuo = await render(<YaohuoLoginPanel {...yaohuoProps({
      credentialAttempt: 1,
      loginFormMode: true
    })} />);
    expect(mockLoginWebViewMountCount).toBe(1);
    const yaohuoWebViewMock = jest.requireMock('react-native-webview') as { mockInjectJavaScript: jest.Mock };
    yaohuoWebViewMock.mockInjectJavaScript.mockClear();

    await yaohuo.rerender(<YaohuoLoginPanel {...yaohuoProps({
      credentialAttempt: 2,
      loginFormMode: true
    })} />);
    expect(mockLoginWebViewMountCount).toBe(1);
    expect(yaohuoWebViewMock.mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('const attempt = 2;'));
    await yaohuo.unmount();
  });

  it('[REG-VERIFICATION-003] lets Android choose the linux.do verification WebView user agent', async () => {
    await render(<LinuxDoVerifyModal {...linuxDoVerifyProps()} />);

    expect(mockLoginWebViewProps.userAgent).toBeUndefined();
  });

  it('[REG-ACCOUNT-019] invalidates the linux.do document probe on every navigation after the page was ready', async () => {
    const onSetLoadingLinuxDoPage = jest.fn();
    const view = await render(<LinuxDoVerifyModal {...linuxDoVerifyProps({ onSetLoadingLinuxDoPage })} />);

    await fireEvent.press(view.getByLabelText('模拟 WebView 加载完成'));
    onSetLoadingLinuxDoPage.mockClear();
    await fireEvent.press(view.getByLabelText('模拟 WebView 开始加载'));

    expect(onSetLoadingLinuxDoPage).toHaveBeenCalledWith(true, 1);
  });

  it('[REG-VERIFICATION-003] lets Android choose the Yaohuo login WebView user agent', async () => {
    await render(<YaohuoLoginPanel {...yaohuoProps()} />);

    expect(mockLoginWebViewProps.userAgent).toBeUndefined();
  });

  it('[REG-ACCOUNT-032] keeps a confirmed Yaohuo session page open while identity reconciliation is pending', async () => {
    const confirmed = session('yaohuo', 'logged-in');
    const view = await render(<YaohuoLoginPanel {...yaohuoProps({
      yaohuoSession: {
        ...confirmed,
        canWrite: false,
        identityTrust: 'pending',
        summaryLabel: '登录状态待确认'
      }
    })} />);

    expect(view.getByTestId('mock-login-webview-uri').props.children)
      .toBe('https://www.yaohuo.me/wapindex.aspx?sid=-2');
  });

  it('[REG-NODESEEK-002] settles on an explicit error', async () => {
    const view = await render(<NodeSeekLoginPanel {...nodeSeekProps({ loadingLoginPage: true, showLoginPanel: true })} />);

    await fireEvent.press(view.getByLabelText('模拟 WebView 加载失败'));
    await fireEvent.press(view.getByLabelText('模拟 WebView 消息'));

    expect(view.getByText('NodeSeek 页面加载失败：断网')).toBeTruthy();
    expect(view.getByTestId('nodeseek-login-webview-settled')).toBeTruthy();
    expect(view.queryByTestId('nodeseek-login-webview-ready')).toBeNull();
  });

  it('does not settle from an arbitrary third-party frame message', async () => {
    const view = await render(<NodeSeekLoginPanel {...nodeSeekProps({ loadingLoginPage: true, showLoginPanel: true })} />);

    await fireEvent.press(view.getByLabelText('模拟 WebView 消息'));

    expect(view.queryByTestId('nodeseek-login-webview-settled')).toBeNull();
    expect(view.queryByTestId('nodeseek-login-webview-ready')).toBeNull();
  });

  it('[REG-VERIFICATION-001] keeps Yaohuo readiness passive and detects only after the user asks', async () => {
    const onCheckYaohuoLogin = jest.fn();
    const onSetLoadingYaohuoLoginPage = jest.fn();
    const onWebViewState = jest.fn();
    const view = await render(
      <YaohuoLoginPanel {...yaohuoProps({ onCheckYaohuoLogin, onSetLoadingYaohuoLoginPage, onWebViewState })} />
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
