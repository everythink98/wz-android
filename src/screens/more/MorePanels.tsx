import { type RefObject, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { CheckCircle, LogIn } from 'lucide-react-native';
import type { ReaderSettings } from '../../readerData';
import type { LoginNavigationRequest } from '../../appTypes';
import { NODESEEK_URL, YAOHUO_URL } from '../../appUrls';
import type { SiteSessionViewModel } from '../../siteSessionState';
import { createStyles, type ReaderTheme } from '../../theme';
import { AppButton, MenuButton, SettingRail } from '../../components/AppControls';
import { LoginWebViewModal } from '../../components/LoginWebViewModal';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from '../../loginWebViewScripts';
import { LinuxDoLevelPanel } from './LinuxDoLevelPanel';

const YAOHUO_LOGIN_URL = YAOHUO_URL + '/waplogin.aspx?siteid=1000';
const YAOHUO_SESSION_URL = YAOHUO_URL + '/wapindex.aspx?sid=-2';
const NODESEEK_WEBVIEW_LOADING_TIMEOUT_MS = 12000;
const NODESEEK_WEBVIEW_CLOSE_URL = 'about:blank';
const NODESEEK_WEBVIEW_CLOSE_TIMEOUT_MS = 1500;

function isNodeSeekTopLevelUrl(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isNodeSeek = hostname === 'nodeseek.com' || hostname.endsWith('.nodeseek.com');
    return isNodeSeek && (parsed.pathname === '' || parsed.pathname === '/');
  } catch {
    return false;
  }
}

export function BackupRestorePanel({
  backupBusy,
  styles,
  onExportBackupFile,
  onImportBackupFile
}: {
  backupBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  onExportBackupFile: () => void;
  onImportBackupFile: () => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.actions}>
        <AppButton label={backupBusy ? '处理中' : '导出备份文件'} styles={styles} disabled={backupBusy} onPress={onExportBackupFile} />
        <AppButton label="选择备份文件恢复" variant="ghost" styles={styles} disabled={backupBusy} onPress={onImportBackupFile} />
      </View>
    </View>
  );
}

export function NodeSeekLoginPanel({
  accountExpanded,
  checking,
  nodeSeekSession,
  loginState,
  loadingLoginPage,
  nodeSeekWebViewUserAgent,
  showLoginPanel,
  styles,
  theme,
  webViewRef,
  onCheckIn,
  onCheckLogin,
  onClearLogin,
  onHandleLoginMessage,
  handleNodeSeekLoginNavigation,
  onRememberNodeSeekCookies,
  onSetLoadingLoginPage,
  onShowLoginPanelChange
}: {
  accountExpanded: boolean;
  checking: boolean;
  nodeSeekSession: SiteSessionViewModel;
  loginState: string;
  loadingLoginPage: boolean;
  nodeSeekWebViewUserAgent: string;
  showLoginPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onClearLogin: () => void;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onRememberNodeSeekCookies: (options?: { silent?: boolean }) => Promise<boolean>;
  onSetLoadingLoginPage: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
}) {
  const [webViewError, setWebViewError] = useState('');
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewNeedsRemount, setWebViewNeedsRemount] = useState(false);
  const [webViewCanGoBack, setWebViewCanGoBack] = useState(false);
  const [webViewUrl, setWebViewUrl] = useState(NODESEEK_URL);
  const webViewReadyRef = useRef(false);
  const webViewCurrentUrlRef = useRef(NODESEEK_URL);
  const closePendingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markWebViewReady = () => {
    webViewReadyRef.current = true;
    onSetLoadingLoginPage(false);
  };

  useEffect(() => {
    if (!showLoginPanel) {
      setWebViewError('');
      setWebViewNeedsRemount(false);
      setWebViewCanGoBack(false);
      setWebViewUrl(NODESEEK_URL);
      webViewCurrentUrlRef.current = NODESEEK_URL;
      closePendingRef.current = false;
    }
  }, [showLoginPanel]);

  useEffect(() => {
    webViewReadyRef.current = false;
  }, [showLoginPanel, webViewKey]);

  useEffect(() => () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!showLoginPanel || !loadingLoginPage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      webViewRef.current?.stopLoading();
      setWebViewNeedsRemount(true);
      onSetLoadingLoginPage(false);
      setWebViewError('NodeSeek 页面打开超时：请检查模拟器网络后刷新页面。');
    }, NODESEEK_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [loadingLoginPage, onSetLoadingLoginPage, showLoginPanel, webViewKey, webViewRef]);

  const refreshWebView = () => {
    setWebViewError('');
    closePendingRef.current = false;
    setWebViewUrl(NODESEEK_URL);
    onSetLoadingLoginPage(true);
    if (webViewNeedsRemount) {
      setWebViewNeedsRemount(false);
      setWebViewKey((current) => current + 1);
      return;
    }
    webViewRef.current?.reload();
  };
  const finishCloseWebView = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closePendingRef.current = false;
    onShowLoginPanelChange(false);
  };
  const closeWebView = () => {
    webViewRef.current?.stopLoading();
    closePendingRef.current = true;
    setWebViewUrl(NODESEEK_WEBVIEW_CLOSE_URL);
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(finishCloseWebView, NODESEEK_WEBVIEW_CLOSE_TIMEOUT_MS);
  };
  const handleRequestClose = () => {
    if (webViewCanGoBack && !isNodeSeekTopLevelUrl(webViewCurrentUrlRef.current)) {
      webViewRef.current?.goBack();
      return;
    }
    closeWebView();
  };
  const handleNodeSeekMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string; blank?: boolean };
      if (data.type === 'nodeseek-login' && data.blank) {
        webViewRef.current?.stopLoading();
        setWebViewNeedsRemount(true);
        onSetLoadingLoginPage(false);
        setWebViewError('NodeSeek 页面为空白，请刷新页面重试。');
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
    onHandleLoginMessage(event);
  };

  return (
    <>
      <MenuButton icon={LogIn} label="NodeSeek 登录 / 验证" value={loginState} styles={styles} theme={theme} onPress={() => onShowLoginPanelChange(!showLoginPanel)} />
      {nodeSeekSession.canWrite ? <MenuButton icon={CheckCircle} label="NodeSeek 签到" value="使用本机登录 Cookie" styles={styles} theme={theme} onPress={onCheckIn} /> : null}
      <LoginWebViewModal
        visible={showLoginPanel}
        title="NodeSeek 登录 / 验证"
        subtitle={loginState}
        loading={loadingLoginPage}
        loadingText="正在打开 NodeSeek..."
        error={webViewError}
        styles={styles}
        theme={theme}
        onClose={closeWebView}
        onRequestClose={handleRequestClose}
        actions={(
          <View style={styles.actions}>
            <AppButton label={checking ? '检测中' : '检测登录'} styles={styles} disabled={checking} onPress={onCheckLogin} />
            <AppButton label="清除登录" variant="danger" styles={styles} onPress={onClearLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={refreshWebView} />
          </View>
        )}
      >
        {showLoginPanel && accountExpanded ? (
            <WebView
              key={`nodeseek-login-${webViewKey}`}
              ref={webViewRef}
              source={{ uri: webViewUrl }}
              androidLayerType="software"
              javaScriptCanOpenWindowsAutomatically={false}
              domStorageEnabled
              cacheEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              userAgent={nodeSeekWebViewUserAgent}
              injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
              onLoadProgress={(event) => {
                if (event.nativeEvent.progress >= 0.8) {
                  markWebViewReady();
                }
              }}
              onLoadEnd={(event) => {
                markWebViewReady();
                webViewCurrentUrlRef.current = event.nativeEvent.url;
                if (event.nativeEvent.url === NODESEEK_WEBVIEW_CLOSE_URL) {
                  if (closePendingRef.current) {
                    finishCloseWebView();
                  }
                  return;
                }
                if ('code' in event.nativeEvent) {
                  return;
                }
                setWebViewError('');
                webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
                void onRememberNodeSeekCookies({ silent: true });
              }}
              onLoadStart={() => {
                setWebViewError('');
                setWebViewNeedsRemount(false);
                if (!webViewReadyRef.current) {
                  onSetLoadingLoginPage(true);
                }
              }}
              onMessage={handleNodeSeekMessage}
              onNavigationStateChange={(event) => {
                webViewCurrentUrlRef.current = event.url;
                setWebViewCanGoBack(event.canGoBack);
              }}
              onError={(event) => {
                onSetLoadingLoginPage(false);
                setWebViewError(`NodeSeek 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
              }}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={() => {
                if (closePendingRef.current) {
                  finishCloseWebView();
                  return;
                }
                onSetLoadingLoginPage(false);
                setWebViewNeedsRemount(true);
                setWebViewError('NodeSeek 登录页面已停止，请刷新页面重试。');
              }}
              onShouldStartLoadWithRequest={(request) => (
                request.url === NODESEEK_WEBVIEW_CLOSE_URL || handleNodeSeekLoginNavigation(request)
              )}
            />
        ) : null}
      </LoginWebViewModal>
    </>
  );
}

export function YaohuoLoginPanel({
  accountExpanded,
  checking,
  yaohuoSession,
  loadingYaohuoLoginPage,
  showYaohuoLoginPanel,
  styles,
  theme,
  yaohuoLoginState,
  yaohuoLoginPrompt,
  yaohuoWebViewRef,
  onCheckYaohuoLogin,
  onClearYaohuoLogin,
  handleYaohuoLoginNavigation,
  onSetLoadingYaohuoLoginPage,
  onShowYaohuoLoginPanelChange
}: {
  accountExpanded: boolean;
  checking: boolean;
  yaohuoSession: SiteSessionViewModel;
  loadingYaohuoLoginPage: boolean;
  showYaohuoLoginPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  yaohuoLoginState: string;
  yaohuoLoginPrompt: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  onCheckYaohuoLogin: () => void;
  onClearYaohuoLogin: () => void;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
}) {
  const [webViewError, setWebViewError] = useState('');
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewNeedsRemount, setWebViewNeedsRemount] = useState(false);

  useEffect(() => {
    if (!showYaohuoLoginPanel) {
      setWebViewError('');
      setWebViewNeedsRemount(false);
    }
  }, [showYaohuoLoginPanel]);

  const refreshWebView = () => {
    setWebViewError('');
    onSetLoadingYaohuoLoginPage(true);
    if (webViewNeedsRemount) {
      setWebViewNeedsRemount(false);
      setWebViewKey((current) => current + 1);
      return;
    }
    yaohuoWebViewRef.current?.reload();
  };

  return (
    <>
      <MenuButton icon={LogIn} label="妖火登录" value={yaohuoLoginState} styles={styles} theme={theme} onPress={() => onShowYaohuoLoginPanelChange(!showYaohuoLoginPanel)} />
      <LoginWebViewModal
        visible={showYaohuoLoginPanel}
        title="妖火登录"
        subtitle={yaohuoLoginPrompt || yaohuoLoginState}
        loading={loadingYaohuoLoginPage}
        loadingText="正在打开妖火..."
        error={webViewError}
        styles={styles}
        theme={theme}
        onClose={() => onShowYaohuoLoginPanelChange(false)}
        actions={(
          <View style={styles.actions}>
            <AppButton label={checking ? '检测中' : '检测登录'} styles={styles} disabled={checking} onPress={onCheckYaohuoLogin} />
            <AppButton label="清除登录" variant="danger" styles={styles} onPress={onClearYaohuoLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={refreshWebView} />
          </View>
        )}
      >
        {showYaohuoLoginPanel && accountExpanded ? (
            <WebView
              key={`yaohuo-login-${webViewKey}`}
              ref={yaohuoWebViewRef}
              source={{ uri: yaohuoSession.canWrite ? YAOHUO_SESSION_URL : YAOHUO_LOGIN_URL }}
              javaScriptCanOpenWindowsAutomatically={false}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              onLoadEnd={(event) => {
                onSetLoadingYaohuoLoginPage(false);
                if ('code' in event.nativeEvent) {
                  return;
                }
                setWebViewError('');
              }}
              onLoadStart={() => {
                setWebViewError('');
                setWebViewNeedsRemount(false);
                onSetLoadingYaohuoLoginPage(true);
              }}
              onError={(event) => {
                onSetLoadingYaohuoLoginPage(false);
                setWebViewError(`妖火页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
              }}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={() => {
                onSetLoadingYaohuoLoginPage(false);
                setWebViewNeedsRemount(true);
                setWebViewError('妖火登录页面已停止，请刷新页面重试。');
              }}
              onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}
            />
        ) : null}
      </LoginWebViewModal>
    </>
  );
}

export function LinuxDoVerifyPanel({
  linuxDoSession,
  showLinuxDoPanel,
  styles,
  theme,
  onShowLinuxDoPanelChange
}: {
  linuxDoSession: SiteSessionViewModel;
  showLinuxDoPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onShowLinuxDoPanelChange: (value: boolean) => void;
}) {
  return (
    <MenuButton icon={LogIn} label="linux.do 登录 / 验证" value={linuxDoSession.summaryLabel} styles={styles} theme={theme} onPress={() => onShowLinuxDoPanelChange(!showLinuxDoPanel)} />
  );
}

export { LinuxDoLevelPanel };

export function AppearancePanel({
  settings,
  showSettingsPanel,
  styles,
  onUpdateSettings
}: {
  settings: ReaderSettings;
  showSettingsPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <View style={styles.stack}>
      {showSettingsPanel ? (
        <SettingsPanel settings={settings} styles={styles} onUpdateSettings={onUpdateSettings} />
      ) : null}
    </View>
  );
}

function SettingsPanel({
  settings,
  styles,
  onUpdateSettings
}: {
  settings: ReaderSettings;
  styles: ReturnType<typeof createStyles>;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <View style={styles.stack}>
      <SettingRail title="字号" items={[
        { value: '0.9', label: '小' },
        { value: '1', label: '标准' },
        { value: '1.15', label: '大' },
        { value: '1.25', label: '特大' }
      ]} value={String(settings.fontScale)} styles={styles} onChange={(value) => onUpdateSettings({ fontScale: Number(value) })} />
      <SettingRail title="主题" items={[
        { value: 'light', label: '浅色' },
        { value: 'dark', label: '深色' }
      ]} value={settings.theme} styles={styles} onChange={(value) => onUpdateSettings({ theme: value as ReaderSettings['theme'] })} />
      <SettingRail title="列表密度" items={[
        { value: 'compact', label: '紧凑' },
        { value: 'standard', label: '标准' },
        { value: 'loose', label: '宽松' }
      ]} value={settings.listDensity} styles={styles} onChange={(value) => onUpdateSettings({ listDensity: value as ReaderSettings['listDensity'] })} />
      <SettingRail title="行距" items={[
        { value: 'compact', label: '紧凑' },
        { value: 'standard', label: '标准' },
        { value: 'loose', label: '宽松' }
      ]} value={settings.lineHeight} styles={styles} onChange={(value) => onUpdateSettings({ lineHeight: value as ReaderSettings['lineHeight'] })} />
      <SettingRail title="正文宽度" items={[
        { value: 'narrow', label: '窄' },
        { value: 'standard', label: '标准' },
        { value: 'wide', label: '宽' }
      ]} value={settings.contentWidth} styles={styles} onChange={(value) => onUpdateSettings({ contentWidth: value as ReaderSettings['contentWidth'] })} />
      <SettingRail title="字体" items={[
        { value: 'sans', label: '无衬线' },
        { value: 'serif', label: '衬线' }
      ]} value={settings.fontFamily} styles={styles} onChange={(value) => onUpdateSettings({ fontFamily: value as ReaderSettings['fontFamily'] })} />
    </View>
  );
}

