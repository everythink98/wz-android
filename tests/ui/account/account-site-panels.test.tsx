import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '../render';
import React, { type ComponentProps } from 'react';
import { AppState, Text, View, type AppStateStatus } from 'react-native';
import { LinuxDoVerifyModal } from '@/features/account/components/LinuxDoVerifyModal';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import { ShieldCheck } from 'lucide-react-native';
import type { LinuxDoLevelProfile } from '@/sources/linuxdo/level';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { LinuxDoLevelPanel } from '@/features/more/components/LinuxDoLevelPanel';
import { SiteLoginHost } from '@/features/account/components/SiteLoginHost';
import { NodeSeekAttendancePanel, NodeSeekServicesPanel } from '@/features/more/components/NodeSeekServicesPanel';
import type { NodeSeekAttendanceBoard } from '@/domain/forum/accountData';
import { createSiteSessionStates, type SessionSite, type SiteSessionStatus } from '@/domain/session/siteSessionState';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';

let mockLoginWebViewProps: Record<string, any> = {};
let mockLoginWebViewMountCount = 0;
const initialAppState = AppState.currentState;
beforeEach(() => {
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(() => {
  AppState.currentState = initialAppState;
  jest.restoreAllMocks();
});

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    X: Icon,
    ArrowLeft: Icon,
    KeyRound: Icon,
    LogOut: Icon,
    ShieldCheck: Icon,
    CheckCircle: Icon,
    CalendarCheck: Icon,
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
    ScrollView: require('react-native').ScrollView,
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
  overrides: Partial<ComponentProps<typeof SiteLoginHost>> = {}
): ComponentProps<typeof SiteLoginHost> {
  return {
    site: 'nodeseek',
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
  overrides: Partial<ComponentProps<typeof SiteLoginHost>> = {}
): ComponentProps<typeof SiteLoginHost> {
  return {
    site: 'yaohuo',
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
    onVerificationPageEvent: jest.fn(),
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
  it('offers both attendance modes only for a confirmed unsigned board and shows the reward after signing', async () => {
    const board: NodeSeekAttendanceBoard = {
      source: 'nodeseek',
      userId: '42',
      list: [],
      record: null,
      order: null,
      total: 0
    };
    const onCheckIn = jest.fn();
    const onRefresh = jest.fn();
    const common = { busy: false, loading: false, error: null, styles, onCheckIn, onRefresh };
    const view = await render(<NodeSeekAttendancePanel {...common} state={{ kind: 'idle' }} />);
    expect(view.getByLabelText('普通签到').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('随机签到').props.accessibilityState.disabled).toBe(true);

    await view.rerender(<NodeSeekAttendancePanel {...common} board={board} state={{ kind: 'idle' }} />);
    await fireEvent.press(view.getByLabelText('普通签到'));
    await fireEvent.press(view.getByLabelText('随机签到'));
    expect(onCheckIn.mock.calls).toEqual([[false], [true]]);
    expect(view.queryByLabelText('鸡腿流水')).toBeNull();
    expect(view.queryByText('签到')).toBeNull();

    const record = {
      id: '1',
      memberId: '42',
      memberName: 'Alice',
      dayId: 1455,
      gain: 0,
      createdAt: '2026-10-02T01:00:00Z'
    };
    await view.rerender(<NodeSeekAttendancePanel {...common} board={{ ...board, record }} state={{ kind: 'idle' }} />);
    expect(view.getByText('今日已签到 · 获得 0 鸡腿')).toBeTruthy();
    expect(view.getByText('今日已签到 · 获得 0 鸡腿').props.accessibilityLiveRegion).toBe('polite');
    expect(view.queryByLabelText('普通签到')).toBeNull();
    expect(view.queryByLabelText('随机签到')).toBeNull();
    await view.rerender(
      <NodeSeekAttendancePanel {...common} board={board} state={{ kind: 'signed', record, order: null }} />
    );
    expect(view.getByText('今日已签到 · 获得 0 鸡腿')).toBeTruthy();
    expect(view.queryByLabelText('普通签到')).toBeNull();
    expect(view.queryByLabelText('随机签到')).toBeNull();

    for (const state of [{ kind: 'confirmed-pending' }, { kind: 'result-unknown' }] as const) {
      const readingStatus = state.kind === 'confirmed-pending' ? '签到成功，正在读取收益…' : '正在确认签到结果…';
      await view.rerender(<NodeSeekAttendancePanel {...common} board={board} state={state} busy />);
      expect(view.getByText(readingStatus)).toBeTruthy();
      expect(view.getByLabelText('普通签到').props.accessibilityState.disabled).toBe(true);
      expect(view.getByLabelText('随机签到').props.accessibilityState.disabled).toBe(true);
      await view.rerender(<NodeSeekAttendancePanel {...common} board={board} state={state} />);
      expect(view.queryByText(readingStatus)).toBeNull();
      expect(view.getByLabelText('普通签到').props.accessibilityState.disabled).toBe(true);
      expect(view.getByLabelText('随机签到').props.accessibilityState.disabled).toBe(true);
      expect(view.queryByLabelText('刷新签到状态')).toBeNull();
      expect(view.queryByLabelText('重试签到状态')).toBeNull();
      expect(
        view.getByText(
          state.kind === 'confirmed-pending' ? '签到成功，收益暂时无法读取' : '签到结果暂未确认，请稍后查看'
        )
      ).toBeTruthy();
    }
    await view.rerender(
      <NodeSeekAttendancePanel
        {...common}
        error={new Error('读取失败')}
        board={board}
        state={{ kind: 'result-unknown' }}
      />
    );
    await fireEvent.press(view.getByLabelText('重试签到状态'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onCheckIn).toHaveBeenCalledTimes(2);
  });

  it.each(['nodeseek', 'yaohuo'] as const)(
    'keeps the latest %s error when a failed load ends in the same batch',
    async (site) => {
      const onWebViewState = jest.fn();
      const view = await render(
        site === 'nodeseek' ? (
          <SiteLoginHost {...nodeSeekProps({ visible: true, onWebViewState })} />
        ) : (
          <SiteLoginHost {...yaohuoProps({ onWebViewState })} />
        )
      );
      const events = mockLoginWebViewProps;
      await act(() => {
        events.onError({ nativeEvent: { description: '本次连接失败' } });
        events.onLoadEnd({ nativeEvent: { code: -2 } });
      });
      expect(view.getByText(`${site === 'nodeseek' ? 'NodeSeek ' : '妖火'}页面加载失败：本次连接失败`)).toBeTruthy();
      expect(onWebViewState.mock.calls.map(([state]) => state)).toEqual(['error']);
      await act(() => mockLoginWebViewProps.onLoadEnd({ nativeEvent: {} }));
      expect(view.queryByText(/本次连接失败/)).toBeNull();
      expect(onWebViewState.mock.calls.map(([state]) => state)).toEqual(['error', 'ready']);
    }
  );

  it('keeps shared login controls available with an optional busy footer action', async () => {
    const onClose = jest.fn();
    const onRetry = jest.fn();
    const onContinue = jest.fn();
    const modal = (footer?: React.ReactNode) => (
      <LoginWebViewModal
        actions={<Text onPress={onRetry}>重试登录页</Text>}
        footer={footer}
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
    const footer = (loading: boolean) => (
      <LoginWebViewAction icon={ShieldCheck} label="检测并继续" primary loading={loading} onPress={onContinue} />
    );
    const view = await render(modal());

    expect(view.getByText('正在打开登录页')).toBeTruthy();
    expect(view.getByText('页面加载失败')).toBeTruthy();
    await fireEvent.press(view.getByText('重试登录页'));
    await fireEvent.press(view.getByLabelText('关闭'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.rerender(modal(footer(true)));
    const busyAction = view.getByRole('button', { name: '检测并继续' });
    expect(busyAction.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(busyAction);
    expect(onContinue).not.toHaveBeenCalled();
    expect(view.getByText('WebView 内容')).toBeTruthy();
    await view.rerender(modal(footer(false)));
    await fireEvent.press(view.getByRole('button', { name: '检测并继续' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
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
    const progress = view.getByRole('progressbar', { name: '访问天数，当前 5，要求 10，未通过' });
    expect(progress.props.accessibilityValue).toEqual({ min: 0, max: 10, now: 5, text: '5 / 10，未通过' });
    expect(view.getByRole('tab', { name: '等级要求' }).props.accessibilityState.selected).toBe(true);
    expect(view.getByRole('tab', { name: '活跃数据' }).props.accessibilityState.selected).toBe(false);
    expect(view.getByRole('tab', { name: '等级要求' })).toHaveStyle({ minHeight: 48 });
    await fireEvent.press(view.getByText('活跃数据'));
    expect(view.getByRole('tab', { name: '活跃数据' }).props.accessibilityState.selected).toBe(true);
    expect(view.getByText('1小时1分')).toBeTruthy();
    expect(view.queryByLabelText('刷新等级')).toBeNull();
    await view.rerender(
      <LinuxDoLevelPanel
        busy={false}
        error="等级读取失败"
        siteSession={session('linuxdo', 'logged-in')}
        profile={null}
        styles={styles}
        theme={theme}
        onOpenLogin={onOpenLogin}
        onRefresh={onRefresh}
      />
    );
    await fireEvent.press(view.getByLabelText('重试等级'));
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

  it('announces an achieved minimum requirement with its actual value and bounded progress', async () => {
    const view = await render(
      <LinuxDoLevelPanel
        busy={false}
        error=""
        siteSession={session('linuxdo', 'logged-in')}
        profile={{
          ...levelProfile,
          requirements: [
            {
              ...levelProfile.requirements[0],
              current: 12,
              displayCurrent: '12',
              met: true,
              ratio: 1
            }
          ],
          achievedCount: 1
        }}
        styles={styles}
        theme={theme}
        onOpenLogin={jest.fn()}
        onRefresh={jest.fn()}
      />
    );

    const progress = view.getByRole('progressbar', { name: '访问天数，当前 12，要求 10，已通过' });
    expect(progress.props.accessibilityValue).toEqual({ min: 0, max: 10, now: 10, text: '12 / 10，已通过' });
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
    const panel = (active = true) => (
      <NodeSeekServicesPanel
        active={active}
        apiKeyBusy={false}
        apiKeySaved={false}
        recoveryThreshold={1}
        styles={styles}
        theme={theme}
        onAuthorizeApiKey={onAuthorizeNodeImageApiKey}
        onClearApiKey={jest.fn()}
        onRecoveryThresholdChange={onRecoveryThresholdChange}
        onSaveApiKey={onSaveNodeImageApiKey}
      />
    );
    const view = await render(panel());

    expect(view.getByText('读取通道自愈阈值')).toBeTruthy();
    expect(view.queryByLabelText('获取 / 恢复授权', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByLabelText('NodeImage API Key 输入', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('3 次'));
    expect(onRecoveryThresholdChange).toHaveBeenCalledWith(3);

    await fireEvent.press(view.getByText('NodeImage 授权'));
    expect(view.queryByLabelText('NodeImage API Key 输入', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('获取 / 恢复授权'));
    expect(onAuthorizeNodeImageApiKey).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText('手动粘贴备用'));
    expect(view.getByLabelText('保存 Key').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('NodeImage API Key 输入')).toBeTruthy();
    await fireEvent.changeText(view.getByPlaceholderText('NodeImage API Key'), 'local-test-key');
    expect(view.getByLabelText('保存 Key').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByLabelText('保存 Key'));
    expect(onSaveNodeImageApiKey).toHaveBeenCalledWith('local-test-key');
    expect(view.getByPlaceholderText('NodeImage API Key').props.value).toBe('local-test-key');
    await fireEvent.press(view.getByLabelText('收起手动备用'));
    expect(view.queryByLabelText('NodeImage API Key 输入')).toBeNull();
    await fireEvent.press(view.getByLabelText('手动粘贴备用'));
    expect(view.getByPlaceholderText('NodeImage API Key').props.value).toBe('');
    await fireEvent.changeText(view.getByPlaceholderText('NodeImage API Key'), 'local-test-key');
    await view.rerender(panel(false));
    expect(view.queryByLabelText('NodeImage API Key 输入')).toBeNull();
    await view.rerender(panel());
    expect(view.getByRole('button', { name: /^NodeImage 授权/ }).props.accessibilityState.expanded).toBe(false);
    expect(view.queryByLabelText('手动粘贴备用')).toBeNull();
    await fireEvent.press(view.getByText('NodeImage 授权'));
    await fireEvent.press(view.getByLabelText('手动粘贴备用'));
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
    const view = await render(<SiteLoginHost {...props} />);

    expect(view.getByText('正在打开登录页面…')).toBeTruthy();
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
      <SiteLoginHost
        {...nodeSeekProps({
          visible: true,
          webViewBlockMessage: '当前环境禁止打开登录页'
        })}
      />
    );
    expect(view.getByTestId('nodeseek-login-webview-settled')).toBeTruthy();
  });

  it('opens the working challenge directly and returns only after its document probe', async () => {
    const props = linuxDoVerifyProps({
      onChallengeReturned: jest.fn(),
      recoveryPanel: { phase: 'web', dedicated: true, results: [{ kind: 'reading', outcome: 'pending' }] }
    });
    const view = await render(<LinuxDoVerifyModal {...props} />);
    expect(mockLoginWebViewProps.source.uri).toBe('https://cdk.linux.do/');
    expect(view.getByLabelText('检测并继续')).toBeTruthy();
    expect(view.queryByLabelText('清除登录')).toBeNull();
    const previousMessage = mockLoginWebViewProps.onMessage;
    await view.rerender(<LinuxDoVerifyModal {...props} linuxDoWebViewKey={2} />);
    const ready = {
      nativeEvent: {
        url: 'https://cdk.linux.do',
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'https://cdk.linux.do/login:1000',
          hasChallengeMarker: false
        })
      }
    };
    await act(() => previousMessage(ready));
    expect(props.onChallengeReturned).not.toHaveBeenCalled();
    await act(() => {
      mockLoginWebViewProps.onLoadStart({ nativeEvent: { url: 'https://cdk.linux.do/' } });
      mockLoginWebViewProps.onHttpError({ nativeEvent: { url: 'https://cdk.linux.do/', statusCode: 403 } });
      mockLoginWebViewProps.onLoadEnd({ nativeEvent: { url: 'https://cdk.linux.do/' } });
    });
    expect(view.getByTestId('mock-login-webview')).toBeTruthy();
    expect(mockLoginWebViewProps.source.uri).toBe('https://cdk.linux.do/');
    await act(() => {
      mockLoginWebViewProps.onLoadStart({ nativeEvent: { url: 'https://cdk.linux.do/login' } });
      mockLoginWebViewProps.onLoadEnd({ nativeEvent: { url: 'https://cdk.linux.do/login' } });
    });
    expect(props.onChallengeReturned).not.toHaveBeenCalled();
    await act(() => mockLoginWebViewProps.onMessage(ready));
    expect(mockLoginWebViewProps.source.uri).toBe('https://linux.do/latest');
    expect(props.onChallengeReturned).toHaveBeenCalledTimes(1);
    expect(props.onChallengeReturned).toHaveBeenCalledWith(2);
    await act(() => mockLoginWebViewProps.onMessage(ready));
    expect(props.onChallengeReturned).toHaveBeenCalledTimes(1);
    expect(props.onHandleLinuxDoMessage).not.toHaveBeenCalled();
    expect(props.onCheckLinuxDoCookie).not.toHaveBeenCalled();
    expect(props.onClearLinuxDoCookie).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('检测并继续'));
    expect(props.onCheckLinuxDoCookie).toHaveBeenCalledTimes(1);
    await view.rerender(<LinuxDoVerifyModal {...props} showLinuxDoPanel={false} />);
    await view.rerender(<LinuxDoVerifyModal {...props} linuxDoWebViewKey={3} />);
    expect(mockLoginWebViewProps.source.uri).toBe('https://cdk.linux.do/');
  });

  it.each(['network', 'early-http'] as const)(
    'does not return from a failed challenge login document: %s',
    async (failure) => {
      const props = linuxDoVerifyProps({
        onChallengeReturned: jest.fn(),
        recoveryPanel: { phase: 'web', dedicated: true, results: [{ kind: 'reading', outcome: 'pending' }] }
      });
      await render(<LinuxDoVerifyModal {...props} />);
      const url = 'https://cdk.linux.do/login';
      await act(() => {
        if (failure === 'early-http') mockLoginWebViewProps.onHttpError({ nativeEvent: { url, statusCode: 500 } });
        mockLoginWebViewProps.onLoadStart({ nativeEvent: { url } });
        // Android emits finish before its network error, without a code on that first event.
        mockLoginWebViewProps.onLoadEnd({ nativeEvent: { url } });
        if (failure === 'network') mockLoginWebViewProps.onError({ nativeEvent: { url, description: '断网' } });
        mockLoginWebViewProps.onMessage({
          nativeEvent: {
            url,
            data: JSON.stringify({
              type: 'linuxdo-webview',
              documentKey: url + ':1000',
              hasChallengeMarker: false
            })
          }
        });
      });
      expect(mockLoginWebViewProps.source.uri).toBe('https://cdk.linux.do/');
      expect(props.onChallengeReturned).not.toHaveBeenCalled();
    }
  );

  it('keeps ordinary account login separate and retries a blocked result only on request', async () => {
    const props = linuxDoVerifyProps({ onRetryRecovery: jest.fn() });
    const view = await render(<LinuxDoVerifyModal {...props} />);
    expect(mockLoginWebViewProps.source.uri).toBe('https://linux.do/latest');
    expect(view.getByLabelText('检测登录')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('网站验证'));
    expect(props.onResetLinuxDoWebView).toHaveBeenCalledTimes(1);
    await view.rerender(<LinuxDoVerifyModal {...props} linuxDoWebViewKey={2} />);
    expect(mockLoginWebViewProps.source.uri).toBe('https://cdk.linux.do/');
    const blocked = {
      ...props,
      recoveryPanel: {
        phase: 'result' as const,
        dedicated: false,
        results: [{ kind: 'reading' as const, outcome: 'verification-required' as const }]
      }
    };
    await view.rerender(<LinuxDoVerifyModal {...blocked} />);
    expect(props.onRetryRecovery).not.toHaveBeenCalled();
    expect(view.getByText('还需要一次验证')).toBeTruthy();
    expect(view.queryByLabelText('检测并继续')).toBeNull();
    await fireEvent.press(view.getByLabelText('重新验证'));
    expect(props.onRetryRecovery).toHaveBeenCalledTimes(1);
    await view.rerender(<LinuxDoVerifyModal {...blocked} showLinuxDoPanel={false} />);
    await view.rerender(<LinuxDoVerifyModal {...blocked} />);
    expect(props.onRetryRecovery).toHaveBeenCalledTimes(1);
    await view.rerender(<LinuxDoVerifyModal {...props} loginFormMode />);
    expect(view.queryByLabelText('网站验证')).toBeNull();
  });

  it.each(['pending', 'completed', 'failed', 'stale'] as const)(
    'does not open another verification for a %s recovery result',
    async (outcome) => {
      const props = linuxDoVerifyProps({
        onRetryRecovery: jest.fn(),
        recoveryPanel: { phase: 'result', dedicated: true, results: [{ kind: 'reading', outcome }] }
      });
      const view = await render(<LinuxDoVerifyModal {...props} />);
      expect(props.onRetryRecovery).not.toHaveBeenCalled();
      expect(props.onCheckLinuxDoCookie).not.toHaveBeenCalled();
      expect(view.getByLabelText(outcome === 'pending' ? '重新验证' : '返回原页面')).toBeTruthy();
    }
  );

  it('records a main-document HTTP error even when navigation guards ignore its display update', async () => {
    const props = linuxDoVerifyProps();
    await render(<LinuxDoVerifyModal {...props} />);
    await act(() => mockLoginWebViewProps.onLoadStart({ nativeEvent: { url: 'https://linux.do/latest' } }));
    jest.mocked(props.onSetLinuxDoWebViewError).mockClear();
    await act(() =>
      mockLoginWebViewProps.onHttpError({ nativeEvent: { url: 'https://linux.do/challenge', statusCode: 404 } })
    );
    expect(props.onVerificationPageEvent).toHaveBeenCalledWith(
      {
        verificationAction: 'http-error',
        verificationPage: 'challenge',
        status: 404,
        hasLoadError: true,
        isDocumentUrlMatch: false
      },
      1
    );
    expect(props.onSetLinuxDoWebViewError).not.toHaveBeenCalled();
  });

  it('separates permitted document navigation from display-only history callbacks', async () => {
    const onDocumentNavigation = jest.fn();
    const props = linuxDoVerifyProps({ handleLinuxDoNavigation: jest.fn(() => true) });
    const view = await render(<LinuxDoVerifyModal {...props} onDocumentNavigation={onDocumentNavigation} />);
    const navigation = mockLoginWebViewProps.onShouldStartLoadWithRequest;
    await act(() =>
      mockLoginWebViewProps.onLoadStart({ nativeEvent: { url: 'https://linux.do/latest', loading: true } })
    );
    expect(onDocumentNavigation).not.toHaveBeenCalled();
    expect(navigation({ url: 'https://linux.do/latest', isTopFrame: false })).toBe(true);
    expect(onDocumentNavigation).not.toHaveBeenCalled();
    expect(navigation({ url: 'https://linux.do/latest' })).toBe(true);
    expect(onDocumentNavigation).toHaveBeenCalledWith(1);
    jest.mocked(props.handleLinuxDoNavigation).mockReturnValueOnce(false);
    expect(navigation({ url: 'https://example.com/' })).toBe(false);
    await view.rerender(
      <LinuxDoVerifyModal {...props} onDocumentNavigation={onDocumentNavigation} linuxDoWebViewKey={2} />
    );
    navigation({ url: 'https://linux.do/latest' });
    expect(onDocumentNavigation).toHaveBeenCalledTimes(1);
  });

  it('lets Android choose the NodeSeek verification WebView user agent', async () => {
    await render(<SiteLoginHost {...nodeSeekProps({ visible: true })} />);

    expect(mockLoginWebViewProps.userAgent).toBeUndefined();
  });

  it('unmounts a timed-out NodeSeek WebView until the user refreshes', async () => {
    jest.useFakeTimers();
    try {
      mockLoginWebViewMountCount = 0;
      const view = await render(
        <SiteLoginHost
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

      expect(view.getByText('NodeSeek 页面打开超时：请检查网络后重新打开。')).toBeTruthy();
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
      <SiteLoginHost
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
      <SiteLoginHost
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
      <SiteLoginHost
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
      <SiteLoginHost
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

  it.each([false, true])(
    'unmounts a timed-out linux.do WebView until explicit refresh, recovery: %s',
    async (dedicated) => {
      jest.useFakeTimers();
      try {
        const onResetLinuxDoWebView = jest.fn();
        const recoveryPanel = dedicated
          ? { phase: 'web' as const, dedicated, results: [{ kind: 'page' as const, outcome: 'pending' as const }] }
          : undefined;
        const props = linuxDoVerifyProps({ onResetLinuxDoWebView, recoveryPanel });
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
              recoveryPanel,
              onResetLinuxDoWebView
            })}
          />
        );
        expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it.each([true, false, undefined])(
    'preserves the linux.do loading state reported by a loading-start event with loading=%s',
    async (loading) => {
      const onSetLoadingLinuxDoPage = jest.fn();
      const view = await render(<LinuxDoVerifyModal {...linuxDoVerifyProps({ onSetLoadingLinuxDoPage })} />);

      await fireEvent.press(view.getByLabelText('模拟 WebView 加载完成'));
      onSetLoadingLinuxDoPage.mockClear();
      await act(() => {
        mockLoginWebViewProps.onLoadStart({ nativeEvent: { url: 'https://linux.do/latest', loading } });
      });

      expect(onSetLoadingLinuxDoPage).toHaveBeenCalledTimes(1);
      expect(onSetLoadingLinuxDoPage).toHaveBeenCalledWith(loading !== false, 1);
    }
  );

  it.each(['nodeseek', 'yaohuo'] as const)(
    'keeps ordinary %s browsing open after a trusted logged-in hint until manual detection',
    async (site) => {
      const onCheck = jest.fn();
      const onClose = jest.fn();
      const props =
        site === 'nodeseek' ? nodeSeekProps({ visible: true, onCheck, onClose }) : yaohuoProps({ onCheck, onClose });
      const view = await render(<SiteLoginHost {...props} />);
      const url = site === 'nodeseek' ? 'https://www.nodeseek.com/' : 'https://www.yaohuo.me/wapindex.aspx?sid=-2';
      await act(() => {
        mockLoginWebViewProps.onLoadStart({ nativeEvent: { url, loading: true } });
        mockLoginWebViewProps.onLoadEnd({ nativeEvent: { url } });
        mockLoginWebViewProps.onMessage({
          nativeEvent: {
            url: new URL(url).origin,
            data: JSON.stringify({
              type: `${site}-login`,
              documentKey: `${url}:1234`,
              status: 'logged-in',
              hasChallengeMarker: false
            })
          }
        });
      });
      expect(onCheck).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      expect(view.getByTestId('mock-login-webview').parent?.props.pointerEvents).toBe('auto');
      await fireEvent.press(view.getByLabelText('检测登录'));
      expect(onCheck).toHaveBeenCalledTimes(1);
    }
  );

  it.each([true, false])(
    'checks a pending NodeSeek recovery once after a trusted account hint, origin-only bridge: %s',
    async (originOnly) => {
      const onCheck = jest.fn();
      const props = nodeSeekProps({ visible: true, onCheck, recoveryPending: true });
      const view = await render(<SiteLoginHost {...props} />);
      const url = 'https://www.nodeseek.com/';
      const message = {
        nativeEvent: {
          url: originOnly ? new URL(url).origin : url,
          data: JSON.stringify({
            type: 'nodeseek-login',
            documentKey: `${url}:1234`,
            status: 'logged-in',
            hasChallengeMarker: false
          })
        }
      };
      await act(() => {
        mockLoginWebViewProps.onLoadStart({ nativeEvent: { url, loading: true } });
        mockLoginWebViewProps.onLoadEnd({ nativeEvent: { url } });
      });
      expect(onCheck).not.toHaveBeenCalled();
      await act(() => mockLoginWebViewProps.onMessage(message));
      expect(onCheck).toHaveBeenCalledTimes(1);
      expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      await act(() => mockLoginWebViewProps.onMessage(message));
      await fireEvent.press(view.getByLabelText('刷新页面'));
      await act(() => mockLoginWebViewProps.onMessage(message));
      expect(onCheck).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['timeout', 'renderer-gone'] as const)(
    'keeps a %s document unmounted when a late start arrives',
    async (failure) => {
      jest.useFakeTimers();
      try {
        const view = await render(<SiteLoginHost {...yaohuoProps({ loading: true })} />);
        const old = mockLoginWebViewProps;
        await act(() => {
          if (failure === 'timeout') jest.advanceTimersByTime(12_000);
          else old.onRenderProcessGone();
        });
        expect(view.queryByTestId('mock-login-webview')).toBeNull();
        await act(() => old.onLoadStart({ nativeEvent: { url: 'https://www.yaohuo.me/', loading: true } }));
        expect(view.queryByTestId('mock-login-webview')).toBeNull();
        await fireEvent.press(view.getByLabelText('重新打开登录页'));
        expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it('rejects unsafe NodeSeek recovery hints and gives manual detection priority', async () => {
    const onCheck = jest.fn();
    const props = nodeSeekProps({ visible: true, onCheck, recoveryPending: true });
    const view = await render(<SiteLoginHost {...props} />);
    const url = 'https://www.nodeseek.com/';
    const hint = {
      type: 'nodeseek-login',
      documentKey: `${url}:1234`,
      status: 'logged-in',
      hasChallengeMarker: false
    };
    await act(() => mockLoginWebViewProps.onLoadStart({ nativeEvent: { url } }));
    for (const payload of [
      { ...hint, documentKey: `${url}:0` },
      { ...hint, documentKey: 'https://evil.example/:1234' },
      { ...hint, type: 'yaohuo-login' },
      { ...hint, status: 'unknown' },
      { ...hint, hasChallengeMarker: true },
      { ...hint, hasChallengeMarker: undefined }
    ]) {
      await act(() => mockLoginWebViewProps.onMessage({ nativeEvent: { url, data: JSON.stringify(payload) } }));
    }
    await act(() =>
      mockLoginWebViewProps.onMessage({ nativeEvent: { url: 'https://evil.example/', data: JSON.stringify(hint) } })
    );
    expect(onCheck).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('检测并继续'));
    await act(() => mockLoginWebViewProps.onMessage({ nativeEvent: { url, data: JSON.stringify(hint) } }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it.each(['nodeseek', 'yaohuo'] as const)(
    'ignores %s callbacks after closing and reopening the panel',
    async (site) => {
      const onCheck = jest.fn();
      const onWebViewState = jest.fn();
      const props =
        site === 'nodeseek'
          ? nodeSeekProps({ visible: true, onCheck, onWebViewState, recoveryPending: true })
          : yaohuoProps({ onCheck, onWebViewState });
      const view = await render(<SiteLoginHost {...props} />);
      const old = mockLoginWebViewProps;
      const url = site === 'nodeseek' ? 'https://www.nodeseek.com/' : 'https://www.yaohuo.me/wapindex.aspx?sid=-2';
      await view.rerender(<SiteLoginHost {...props} visible={false} />);
      await view.rerender(<SiteLoginHost {...props} />);
      await act(() => {
        old.onLoadStart({ nativeEvent: { url } });
        old.onMessage({
          nativeEvent: {
            url,
            data: JSON.stringify({
              type: `${site}-login`,
              documentKey: `${url}:1234`,
              status: 'logged-in',
              hasChallengeMarker: false
            })
          }
        });
        old.onError({ nativeEvent: { description: '旧页面失败' } });
        old.onLoadEnd({ nativeEvent: { url } });
      });
      expect(onCheck).not.toHaveBeenCalled();
      expect(onWebViewState).not.toHaveBeenCalled();
      expect(view.queryByText(`${site === 'nodeseek' ? 'NodeSeek ' : '妖火'}页面加载失败：旧页面失败`)).toBeNull();
    }
  );

  it('automatically checks an anonymous NodeSeek recovery once without treating load completion as success', async () => {
    const onCheck = jest.fn();
    const view = await render(<SiteLoginHost {...nodeSeekProps({ visible: true, onCheck, recoveryPending: true })} />);
    const url = 'https://www.nodeseek.com/';
    await act(() => {
      mockLoginWebViewProps.onLoadStart({ nativeEvent: { url } });
      mockLoginWebViewProps.onLoadEnd({ nativeEvent: { url } });
    });
    expect(onCheck).not.toHaveBeenCalled();
    expect(view.getByLabelText('检测并继续')).toBeTruthy();
    await act(() =>
      mockLoginWebViewProps.onMessage({
        nativeEvent: {
          url,
          data: JSON.stringify({
            type: 'nodeseek-login',
            documentKey: `${url}:1234`,
            status: 'logged-out',
            hasChallengeMarker: false
          })
        }
      })
    );
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('does not resume automatic detection after backgrounding or a load error', async () => {
    const listeners: ((state: AppStateStatus) => void)[] = [];
    const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    });
    try {
      const onCheck = jest.fn();
      const view = await render(
        <SiteLoginHost {...nodeSeekProps({ visible: true, onCheck, recoveryPending: true })} />
      );
      const url = 'https://www.nodeseek.com/';
      const hint = {
        nativeEvent: {
          url,
          data: JSON.stringify({
            type: 'nodeseek-login',
            documentKey: `${url}:1234`,
            status: 'logged-in',
            hasChallengeMarker: false
          })
        }
      };
      await act(() => {
        mockLoginWebViewProps.onLoadStart({ nativeEvent: { url } });
        mockLoginWebViewProps.onError({ nativeEvent: { description: '断网' } });
        mockLoginWebViewProps.onMessage(hint);
      });
      expect(onCheck).not.toHaveBeenCalled();
      await act(() => {
        mockLoginWebViewProps.onLoadStart({ nativeEvent: { url } });
        listeners.forEach((listener) => listener('background'));
        listeners.forEach((listener) => listener('active'));
        mockLoginWebViewProps.onMessage(hint);
      });
      expect(onCheck).not.toHaveBeenCalled();
      await fireEvent.press(view.getByLabelText('检测并继续'));
      expect(onCheck).toHaveBeenCalledTimes(1);
    } finally {
      subscription.mockRestore();
    }
  });

  it('lets Android choose the Yaohuo login WebView user agent', async () => {
    await render(<SiteLoginHost {...yaohuoProps()} />);

    expect(mockLoginWebViewProps.userAgent).toBeUndefined();
  });

  it('keeps a confirmed Yaohuo session page open while identity reconciliation runs', async () => {
    const confirmed = session('yaohuo', 'logged-in');
    const view = await render(
      <SiteLoginHost
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
    const view = await render(<SiteLoginHost {...nodeSeekProps({ loading: true, visible: true })} />);

    await fireEvent.press(view.getByLabelText('模拟 WebView 加载失败'));
    await fireEvent.press(view.getByLabelText('模拟 WebView 消息'));

    expect(view.getByText('NodeSeek 页面加载失败：断网')).toBeTruthy();
    expect(view.getByTestId('nodeseek-login-webview-settled')).toBeTruthy();
    expect(view.queryByTestId('nodeseek-login-webview-ready')).toBeNull();
  });

  it('does not settle from an arbitrary third-party frame message', async () => {
    const view = await render(<SiteLoginHost {...nodeSeekProps({ loading: true, visible: true })} />);

    await fireEvent.press(view.getByLabelText('模拟 WebView 消息'));

    expect(view.queryByTestId('nodeseek-login-webview-settled')).toBeNull();
    expect(view.queryByTestId('nodeseek-login-webview-ready')).toBeNull();
  });

  it('keeps Yaohuo readiness passive and unmounts it while blocked', async () => {
    const onCheckYaohuoLogin = jest.fn();
    const onSetLoadingYaohuoLoginPage = jest.fn();
    const onWebViewState = jest.fn();
    const view = await render(
      <SiteLoginHost
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
      <SiteLoginHost
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
        <SiteLoginHost
          {...yaohuoProps({
            loading: true
          })}
        />
      );

      expect(view.getByTestId('mock-login-webview')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(12_000);
      });

      expect(view.getByText('妖火页面打开超时：请检查网络后重新打开。')).toBeTruthy();
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
    await fireEvent.press(view.getByLabelText('检测登录'));
    await fireEvent.press(view.getByLabelText('清除登录'));
    await fireEvent.press(view.getByLabelText('刷新页面'));
    expect(onRequestCredentialFill).toHaveBeenCalledTimes(1);
    expect(onCheckLinuxDoCookie).toHaveBeenCalledTimes(1);
    expect(onClearLinuxDoCookie).toHaveBeenCalledTimes(1);
    expect(onResetLinuxDoWebView).toHaveBeenCalledTimes(1);
  });
});
