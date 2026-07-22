import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React, { type ComponentProps } from 'react';
import { emptyCredentialSummaries } from '../../src/credentialVault';
import { createEmptyNetworkProxyState } from '../../src/networkProxy';
import { createEmptyReaderData } from '../../src/readerData';
import { MoreScreen } from '../../src/screens/MoreScreen';
import { createSiteSessionStates, createSiteSessionViewModels } from '../../src/siteSessionState';
import { createStyles, createTheme } from '../../src/theme';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}));

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
        minDistance() { return this; },
        runOnJS() { return this; },
        onBegin() { return this; },
        onUpdate() { return this; },
        onEnd() { return this; },
        onFinalize() { return this; }
      })
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),
    ScrollView: require('react-native').ScrollView
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    Activity: Icon,
    ArrowLeft: Icon,
    Bug: Icon,
    Check: Icon,
    CheckCircle: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    DatabaseBackup: Icon,
    Image: Icon,
    Info: Icon,
    RefreshCw: Icon,
    Server: Icon,
    Settings: Icon,
    Trash2: Icon,
    User: Icon,
    Wrench: Icon,
    X: Icon
  };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const sessionViewModels = createSiteSessionViewModels(createSiteSessionStates());

function moreProps(overrides: Partial<ComponentProps<typeof MoreScreen>> = {}): ComponentProps<typeof MoreScreen> {
  return {
    appUpdateBusy: false,
    appUpdateDownloading: false,
    appUpdateDownloadProgress: null,
    appUpdateInfo: null,
    appUpdateMessage: '当前版本 1.3.63',
    backupBusy: false,
    checking: false,
    credentialFillAttempt: null,
    credentialLoginSite: null,
    credentialSummaries: emptyCredentialSummaries(),
    devAnonymousAvailable: false,
    devAnonymousOverrides: {},
    diagnosticBusy: false,
    handleNodeSeekLoginNavigation: () => true,
    handleYaohuoLoginNavigation: () => true,
    linuxDoLevelBusy: false,
    linuxDoLevelError: '',
    linuxDoLevelProfile: null,
    xiaoyinsiLevelBusy: false,
    xiaoyinsiLevelError: '',
    xiaoyinsiLevelProfile: null,
    loadingLoginPage: false,
    loadingYaohuoLoginPage: false,
    networkProxyActiveProfile: null,
    networkProxyApplyError: '',
    networkProxyApplyStatus: 'idle',
    networkProxyState: createEmptyNetworkProxyState(),
    networkProxySummary: '未启用',
    nodeImageApiKeyBusy: false,
    nodeImageApiKeySaved: false,
    nodeSeekUserId: null,
    onAccountCenterCommand: jest.fn(async () => undefined),
    onAuthorizeNodeImageApiKey: jest.fn(),
    onCheckAppUpdate: jest.fn(),
    onCheckIn: jest.fn(),
    onCheckLogin: jest.fn(),
    onCheckYaohuoLogin: jest.fn(),
    onClearLogin: jest.fn(),
    onClearNodeImageApiKey: jest.fn(),
    onClearYaohuoLogin: jest.fn(),
    onDeleteNetworkProxyProfile: jest.fn(async () => undefined),
    onDownloadAppUpdate: jest.fn(),
    onExportBackupFile: jest.fn(),
    onExportDiagnosticLog: jest.fn(),
    onHandleLoginMessage: jest.fn(),
    onImportBackupFile: jest.fn(),
    onLoginFormMessage: () => false,
    onNodeSeekLoginWebViewState: jest.fn(),
    onRefreshLinuxDoLevel: jest.fn(),
    onRefreshXiaoyinsiLevel: jest.fn(),
    onSaveNodeImageApiKey: jest.fn(),
    onSelectNetworkProxyProfile: jest.fn(async () => undefined),
    onSetLoadingLoginPage: jest.fn(),
    onSetLoadingYaohuoLoginPage: jest.fn(),
    onSetNetworkProxyEnabled: jest.fn(async () => undefined),
    onShowLoginPanelChange: jest.fn(),
    onShowNetworkProxyPanelChange: jest.fn(),
    onShowSettingsPanelChange: jest.fn(),
    onShowYaohuoLoginPanelChange: jest.fn(),
    onTestNetworkProxyProfile: jest.fn(async () => ({ ok: true, latencyMs: 10 })),
    onToggleDevAnonymousOverride: jest.fn(),
    onUpdateSettings: jest.fn(),
    onUpsertNetworkProxyProfile: jest.fn(async () => undefined),
    onYaohuoLoginWebViewState: jest.fn(),
    pendingCredentialFillSite: null,
    sessionViewModels,
    settings: readerData.settings,
    showLinuxDoPanel: false,
    showLoginPanel: false,
    showNetworkProxyPanel: false,
    showSettingsPanel: false,
    showYaohuoLoginPanel: false,
    statusBusy: false,
    styles,
    theme,
    webViewBlockMessage: '',
    webViewRef: { current: null },
    yaohuoLoginPrompt: '',
    yaohuoWebViewRef: { current: null },
    xiaoyinsiAuth: {
      message: '',
      pending: null,
      phase: 'idle',
      secondsRemaining: 0,
      onBegin: jest.fn(),
      onCancel: jest.fn(),
      onOpenBrowser: jest.fn(),
      onRevoke: jest.fn()
    },
    ...overrides
  };
}

function collectRenderedText(node: unknown): string[] {
  if (typeof node === 'string') {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectRenderedText);
  }
  if (!node || typeof node !== 'object' || !('children' in node)) {
    return [];
  }
  return collectRenderedText((node as { children?: unknown }).children);
}

describe('More screen state and actions', () => {
  it('shows current, checking, available-update and download progress states', async () => {
    const onCheckAppUpdate = jest.fn();
    const onDownloadAppUpdate = jest.fn();
    const view = await render(<MoreScreen {...moreProps({ onCheckAppUpdate, onDownloadAppUpdate })} />);

    expect(view.queryByText('有新版本')).toBeNull();
    await fireEvent.press(view.getByLabelText('检查更新'));
    expect(onCheckAppUpdate).toHaveBeenCalledTimes(1);

    await view.rerender(<MoreScreen {...moreProps({ appUpdateBusy: true, onCheckAppUpdate, onDownloadAppUpdate })} />);
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
    await view.rerender(<MoreScreen {...moreProps({
      appUpdateInfo,
      appUpdateMessage: '发现新版 1.4.0',
      onCheckAppUpdate,
      onDownloadAppUpdate
    })} />);
    expect(view.getByText('有新版本')).toBeTruthy();
    expect(view.getByText('修复已知问题')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('下载并安装'));
    expect(onDownloadAppUpdate).toHaveBeenCalledTimes(1);

    await view.rerender(<MoreScreen {...moreProps({
      appUpdateBusy: true,
      appUpdateDownloading: true,
      appUpdateDownloadProgress: {
        title: '正在下载 1.4.0',
        downloadedBytes: 1024,
        totalBytes: 2048,
        percent: 50,
        percentLabel: '50%',
        sizeLabel: '1 KB / 2 KB'
      },
      appUpdateInfo,
      onCheckAppUpdate,
      onDownloadAppUpdate
    })} />);
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
      onExportBackupFile,
      onExportDiagnosticLog,
      onImportBackupFile,
      onShowNetworkProxyPanelChange
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

    await view.rerender(<MoreScreen {...moreProps({ ...props, backupBusy: true, diagnosticBusy: true })} />);
    expect(view.getByLabelText('正在生成').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('处理中').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('选择备份文件恢复').props.accessibilityState.disabled).toBe(true);
  });

  it('keeps development-only anonymous overrides hidden in production and locally reversible in development', async () => {
    const onToggleDevAnonymousOverride = jest.fn();
    const view = await render(<MoreScreen {...moreProps({ onToggleDevAnonymousOverride })} />);

    expect(view.queryByLabelText('展开测试工具')).toBeNull();
    await view.rerender(<MoreScreen {...moreProps({
      devAnonymousAvailable: true,
      devAnonymousOverrides: { linuxdo: true },
      onToggleDevAnonymousOverride
    })} />);
    expect(view.getByText('已开启 1 项')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('展开测试工具'));
    expect(view.getByText('只影响本次运行，不删除 Cookie。重启后恢复。')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('NodeSeek'));
    await fireEvent.press(view.getByLabelText('妖火'));
    await fireEvent.press(view.getByLabelText('linux.do'));
    await fireEvent.press(view.getByLabelText('小隐寺'));
    expect(onToggleDevAnonymousOverride.mock.calls).toEqual([
      ['nodeseek'],
      ['yaohuo'],
      ['linuxdo'],
      ['xiaoyinsi']
    ]);
  });

  it('shows the 小隐寺 Device Code, countdown and browser/cancel actions without credential fields', async () => {
    const onCancel = jest.fn();
    const onOpenBrowser = jest.fn();
    const pending = {
      deviceCode: 'd'.repeat(64),
      userCode: 'ABCD-2345',
      verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
      verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=safe',
      nonce: 'e'.repeat(64),
      createdAt: 1_000,
      expiresAt: 601_000,
      intervalMs: 5_000
    };
    const view = await render(<MoreScreen {...moreProps({
      xiaoyinsiAuth: {
        ...moreProps().xiaoyinsiAuth,
        pending,
        phase: 'waiting',
        secondsRemaining: 599,
        onCancel,
        onOpenBrowser
      }
    })} />);

    expect(await view.findByLabelText('小隐寺授权验证码 ABCD-2345')).toBeTruthy();
    expect(view.getByText('剩余 09:59 · 返回阅坛后会自动继续检测')).toBeTruthy();
    expect(view.queryByPlaceholderText('账号')).toBeNull();
    expect(view.queryByPlaceholderText('密码')).toBeNull();
    expect(view.getByText('系统浏览器只打开一次性小隐寺授权页；阅坛登录态只由独立 User API Key 维护，不读取浏览器 Cookie，也不打开登录 WebView。')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('复制验证码并前往授权页'));
    await fireEvent.press(view.getByLabelText('取消'));
    expect(onOpenBrowser).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-013][REG-XIAOYINSI-014] puts the level entry after authorization management for an authorized 小隐寺 account', async () => {
    const onRefreshXiaoyinsiLevel = jest.fn();
    const authorizedSessions = createSiteSessionViewModels(createSiteSessionStates({
      xiaoyinsi: {
        site: 'xiaoyinsi',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'xiaoyinsi',
          id: 'alice',
          username: 'alice',
          displayName: 'Alice',
          url: 'https://forum.xiaoyinsi.com/u/alice',
          topics: []
        }
      }
    }));
    const view = await render(<MoreScreen {...moreProps({ onRefreshXiaoyinsiLevel, sessionViewModels: authorizedSessions })} />);

    await fireEvent.press(view.getByLabelText('展开账号中心'));
    await fireEvent.press(view.getByTestId('account-site-xiaoyinsi'));

    expect(view.getByText('授权管理')).toBeTruthy();
    expect(view.getByText('User API Key 仅保存在本机，不读取浏览器 Cookie。')).toBeTruthy();
    expect(view.getByText('查看等级')).toBeTruthy();
    expect(view.getByLabelText('撤销授权')).toBeTruthy();
    const renderedText = collectRenderedText(view.toJSON());
    expect(renderedText.indexOf('撤销授权')).toBeLessThan(renderedText.indexOf('查看等级'));
    await fireEvent.press(view.getByText('查看等级'));
    expect(onRefreshXiaoyinsiLevel).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-005] exposes persisted revocation cleanup before any stale logged-in controls', async () => {
    const onBegin = jest.fn();
    const view = await render(<MoreScreen {...moreProps({
      sessionViewModels: {
        ...sessionViewModels,
        xiaoyinsi: {
          ...sessionViewModels.xiaoyinsi,
          isLoggedIn: true,
          canWrite: true
        }
      },
      xiaoyinsiAuth: {
        ...moreProps().xiaoyinsiAuth,
        message: '服务端授权已撤销，但本机安全材料清理未完成，请重试本机清理。',
        phase: 'cleanup',
        onBegin
      }
    })} />);

    await fireEvent.press(await view.findByLabelText('重试本机清理'));
    expect(view.queryByLabelText('重新授权')).toBeNull();
    expect(view.queryByLabelText('撤销授权')).toBeNull();
    expect(onBegin).toHaveBeenCalledTimes(1);
  });
});
