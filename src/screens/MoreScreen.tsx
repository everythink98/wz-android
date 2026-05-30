import { memo, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Activity, CheckCircle, DatabaseBackup, LogIn, Settings } from 'lucide-react-native';
import type { ReaderSettings } from '../readerData';
import type { HealthDetail, LoginNavigationRequest } from '../appTypes';
import { LINUXDO_URL, NODESEEK_URL, YAOHUO_URL } from '../appUrls';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, ExpandablePanel, InfoRow, MenuButton, SettingRail } from '../components/AppControls';

const YAOHUO_LOGIN_URL = YAOHUO_URL + '/waplogin.aspx?siteid=1000';
const YAOHUO_SESSION_URL = YAOHUO_URL + '/wapindex.aspx?sid=-2';
const LINUXDO_VERIFY_URL = LINUXDO_URL + '/latest';
const LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS = 12000;

export const NODESEEK_LOGIN_PROBE_SCRIPT = `
(() => {
  const body = document.body ? document.body.innerText : "";
  const match = body.match(/UID\s*[:：]\s*(\d+)/i);
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "nodeseek-login",
    loggedIn: !/登录|注册|Sign in/i.test(body) || Boolean(match),
    userId: match ? Number(match[1]) : null,
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || ""
  }));
})();
true;
`;

export const LINUXDO_WEBVIEW_PROBE_SCRIPT = `
(() => {
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "linuxdo-webview",
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || ""
  }));
})();
true;
`;

function MoreScreen({
  checking,
  hasNodeSeekLoginCookie,
  hasYaohuoCookie,
  hasLinuxDoClearance,
  hasLinuxDoLogin,
  healthDetails,
  healthSummary,
  loginState,
  loadingLoginPage,
  loadingYaohuoLoginPage,
  loadingLinuxDoPage,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewUserAgent,
  nodeSeekWebViewUserAgent,
  settings,
  backupJson,
  showLoginPanel,
  showYaohuoLoginPanel,
  showLinuxDoPanel,
  showSettingsPanel,
  statusBusy,
  styles,
  backupBusy,
  theme,
  webViewRef,
  yaohuoLoginCookieHeader,
  yaohuoLoginState,
  yaohuoWebViewRef,
  linuxDoCookieNames,
  linuxDoWebViewRef,
  onCheckHealth,
  onCheckIn,
  onCheckLogin,
  onRememberNodeSeekCookies,
  onCheckYaohuoLogin,
  onCheckLinuxDoCookie,
  onClearLogin,
  onClearYaohuoLogin,
  onClearLinuxDoCookie,
  handleNodeSeekLoginNavigation,
  handleYaohuoLoginNavigation,
  handleLinuxDoNavigation,
  onHandleLoginMessage,
  onHandleLinuxDoMessage,
  onImportBackup,
  onExportBackup,
  onExportBackupFile,
  onImportBackupFile,
  onBackupJsonChange,
  onSetLoadingLoginPage,
  onSetLoadingYaohuoLoginPage,
  onSetLoadingLinuxDoPage,
  onSetLinuxDoWebViewError,
  onResetLinuxDoWebView,
  onShowLoginPanelChange,
  onShowYaohuoLoginPanelChange,
  onShowLinuxDoPanelChange,
  onShowSettingsPanelChange,
  onUpdateSettings
}: {
  checking: boolean;
  hasNodeSeekLoginCookie: boolean;
  hasYaohuoCookie: boolean;
  hasLinuxDoClearance: boolean;
  hasLinuxDoLogin: boolean;
  healthDetails: HealthDetail[];
  healthSummary: string;
  loginState: string;
  loadingLoginPage: boolean;
  loadingYaohuoLoginPage: boolean;
  loadingLinuxDoPage: boolean;
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewUserAgent: string;
  nodeSeekWebViewUserAgent: string;
  settings: ReaderSettings;
  backupJson: string;
  showLoginPanel: boolean;
  showYaohuoLoginPanel: boolean;
  showLinuxDoPanel: boolean;
  showSettingsPanel: boolean;
  statusBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  backupBusy: boolean;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  yaohuoLoginCookieHeader: string;
  yaohuoLoginState: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  linuxDoCookieNames: string[];
  linuxDoWebViewRef: RefObject<WebView | null>;
  onCheckHealth: () => void;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onRememberNodeSeekCookies: (options?: { silent?: boolean }) => Promise<boolean>;
  onCheckYaohuoLogin: () => void;
  onCheckLinuxDoCookie: () => void;
  onClearLogin: () => void;
  onClearYaohuoLogin: () => void;
  onClearLinuxDoCookie: () => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onHandleLinuxDoMessage: (event: WebViewMessageEvent) => void;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onExportBackupFile: () => void;
  onImportBackupFile: () => void;
  onBackupJsonChange: (value: string) => void;
  onSetLoadingLoginPage: (value: boolean) => void;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onSetLoadingLinuxDoPage: (value: boolean) => void;
  onSetLinuxDoWebViewError: (value: string) => void;
  onResetLinuxDoWebView: () => void;
  onShowLoginPanelChange: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
  onShowSettingsPanelChange: (value: boolean) => void;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const [backupExpanded, setBackupExpanded] = useState(false);
  const [accountExpanded, setAccountExpanded] = useState(false);
  const [statusExpanded, setStatusExpanded] = useState(false);
  useEffect(() => {
    if (showLoginPanel || showYaohuoLoginPanel || showLinuxDoPanel) {
      setAccountExpanded(true);
    }
  }, [showLinuxDoPanel, showLoginPanel, showYaohuoLoginPanel]);
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>更多</Text>
      <View style={styles.groupList}>
        <InfoRow icon={Activity} label="关于" value="Android 本机阅读器" styles={styles} theme={theme} />
      </View>
      <ExpandablePanel
        quiet
        title="备份 / 恢复"
        meta={backupBusy ? '处理中' : backupJson ? '已有 JSON 内容' : 'JSON 导出和导入'}
        icon={DatabaseBackup}
        expanded={backupExpanded}
        styles={styles}
        theme={theme}
        onExpandedChange={setBackupExpanded}
      >
        <MemoizedBackupRestorePanel
          backupJson={backupJson}
          backupBusy={backupBusy}
          styles={styles}
          theme={theme}
          onBackupJsonChange={onBackupJsonChange}
          onExportBackup={onExportBackup}
          onImportBackup={onImportBackup}
          onExportBackupFile={onExportBackupFile}
          onImportBackupFile={onImportBackupFile}
        />
      </ExpandablePanel>
      <ExpandablePanel
        quiet
        title="账号与验证"
        meta={`NodeSeek ${hasNodeSeekLoginCookie ? '已登录' : '未登录'} · 妖火 ${hasYaohuoCookie ? '已登录' : '未登录'} · linux.do ${hasLinuxDoLogin ? '已登录' : hasLinuxDoClearance ? '已验证' : '匿名可用'}`}
        icon={LogIn}
        expanded={accountExpanded}
        styles={styles}
        theme={theme}
        onExpandedChange={setAccountExpanded}
      >
        <MemoizedNodeSeekLoginPanel
          checking={checking}
          hasNodeSeekLoginCookie={hasNodeSeekLoginCookie}
          accountExpanded={accountExpanded}
          loginState={loginState}
          loadingLoginPage={loadingLoginPage}
          nodeSeekWebViewUserAgent={nodeSeekWebViewUserAgent}
          showLoginPanel={showLoginPanel}
          styles={styles}
          theme={theme}
          webViewRef={webViewRef}
          onCheckIn={onCheckIn}
          onCheckLogin={onCheckLogin}
          onClearLogin={onClearLogin}
          onHandleLoginMessage={onHandleLoginMessage}
          handleNodeSeekLoginNavigation={handleNodeSeekLoginNavigation}
          onRememberNodeSeekCookies={onRememberNodeSeekCookies}
          onSetLoadingLoginPage={onSetLoadingLoginPage}
          onShowLoginPanelChange={onShowLoginPanelChange}
        />
        <MemoizedYaohuoLoginPanel
          checking={checking}
          hasYaohuoCookie={hasYaohuoCookie}
          accountExpanded={accountExpanded}
          loadingYaohuoLoginPage={loadingYaohuoLoginPage}
          showYaohuoLoginPanel={showYaohuoLoginPanel}
          styles={styles}
          theme={theme}
          yaohuoLoginCookieHeader={yaohuoLoginCookieHeader}
          yaohuoLoginState={yaohuoLoginState}
          yaohuoWebViewRef={yaohuoWebViewRef}
          onCheckYaohuoLogin={onCheckYaohuoLogin}
          onClearYaohuoLogin={onClearYaohuoLogin}
          handleYaohuoLoginNavigation={handleYaohuoLoginNavigation}
          onSetLoadingYaohuoLoginPage={onSetLoadingYaohuoLoginPage}
          onShowYaohuoLoginPanelChange={onShowYaohuoLoginPanelChange}
        />
        <MemoizedLinuxDoVerifyPanel
          checking={checking}
          hasLinuxDoClearance={hasLinuxDoClearance}
          hasLinuxDoLogin={hasLinuxDoLogin}
          accountExpanded={accountExpanded}
          linuxDoCookieNames={linuxDoCookieNames}
          linuxDoWebViewError={linuxDoWebViewError}
          linuxDoWebViewKey={linuxDoWebViewKey}
          linuxDoWebViewRef={linuxDoWebViewRef}
          linuxDoWebViewUserAgent={linuxDoWebViewUserAgent}
          loadingLinuxDoPage={loadingLinuxDoPage}
          showLinuxDoPanel={showLinuxDoPanel}
          styles={styles}
          theme={theme}
          onCheckLinuxDoCookie={onCheckLinuxDoCookie}
          onClearLinuxDoCookie={onClearLinuxDoCookie}
          handleLinuxDoNavigation={handleLinuxDoNavigation}
          onHandleLinuxDoMessage={onHandleLinuxDoMessage}
          onResetLinuxDoWebView={onResetLinuxDoWebView}
          onSetLinuxDoWebViewError={onSetLinuxDoWebViewError}
          onSetLoadingLinuxDoPage={onSetLoadingLinuxDoPage}
          onShowLinuxDoPanelChange={onShowLinuxDoPanelChange}
        />
      </ExpandablePanel>
      <ExpandablePanel
        quiet
        title="外观"
        meta="字号 · 白天/黑夜 · 阅读调节"
        icon={Settings}
        expanded={showSettingsPanel}
        styles={styles}
        theme={theme}
        onExpandedChange={onShowSettingsPanelChange}
      >
        <MemoizedAppearancePanel
          settings={settings}
          showSettingsPanel={showSettingsPanel}
          styles={styles}
          onUpdateSettings={onUpdateSettings}
        />
      </ExpandablePanel>
      <ExpandablePanel
        quiet
        title="状态检查"
        meta={statusBusy ? '检查中' : healthSummary || '来源状态'}
        icon={Activity}
        expanded={statusExpanded}
        styles={styles}
        theme={theme}
        onExpandedChange={setStatusExpanded}
      >
        <MemoizedStatusCheckPanel
          healthDetails={healthDetails}
          statusBusy={statusBusy}
          styles={styles}
          onCheckHealth={onCheckHealth}
        />
      </ExpandablePanel>
    </View>
  );
}

function BackupRestorePanel({
  backupJson,
  backupBusy,
  styles,
  theme,
  onBackupJsonChange,
  onExportBackup,
  onImportBackup,
  onExportBackupFile,
  onImportBackupFile
}: {
  backupJson: string;
  backupBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onBackupJsonChange: (value: string) => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onExportBackupFile: () => void;
  onImportBackupFile: () => void;
}) {
  return (
    <View style={styles.stack}>
      <TextInput
        style={styles.input}
        value={backupJson}
        onChangeText={onBackupJsonChange}
        placeholder="粘贴或生成阅读资料 JSON"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <View style={styles.actions}>
        <AppButton label={backupBusy ? '处理中' : '生成备份'} styles={styles} disabled={backupBusy} onPress={onExportBackup} />
        <AppButton label={backupBusy ? '处理中' : '恢复备份'} variant="ghost" styles={styles} disabled={backupBusy} onPress={onImportBackup} />
        <AppButton label="分享 JSON" variant="ghost" styles={styles} disabled={backupBusy} onPress={onExportBackupFile} />
        <AppButton label="选择 JSON" variant="ghost" styles={styles} disabled={backupBusy} onPress={onImportBackupFile} />
      </View>
    </View>
  );
}

const MemoizedBackupRestorePanel = memo(BackupRestorePanel);

function LoginWebViewModal({
  actions,
  children,
  error,
  loading,
  loadingText,
  styles,
  theme,
  title,
  subtitle,
  visible,
  onClose
}: {
  actions?: ReactNode;
  children: ReactNode;
  error?: string;
  loading: boolean;
  loadingText: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  title: string;
  subtitle: string;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.loginWebViewModal, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.loginWebViewHeader}>
          <View style={styles.loginWebViewTitleBlock}>
            <Text style={styles.loginWebViewTitle}>{title}</Text>
            <Text style={styles.loginWebViewSubtitle}>{subtitle}</Text>
          </View>
          <AppButton label="关闭" variant="ghost" styles={styles} onPress={onClose} />
        </View>
        {actions ? <View style={styles.loginWebViewToolbar}>{actions}</View> : null}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        <View style={styles.loginWebViewBody}>
          {loading ? (
            <View pointerEvents="none" style={styles.loading}>
              <ActivityIndicator color={theme.primary} />
              <Text style={styles.loadingText}>{loadingText}</Text>
            </View>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

function NodeSeekLoginPanel({
  accountExpanded,
  checking,
  hasNodeSeekLoginCookie,
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
  hasNodeSeekLoginCookie: boolean;
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
  return (
    <>
      <MenuButton icon={LogIn} label="NodeSeek 登录 / 验证" value={loginState} styles={styles} theme={theme} onPress={() => onShowLoginPanelChange(!showLoginPanel)} />
      {hasNodeSeekLoginCookie ? <MenuButton icon={CheckCircle} label="NodeSeek 签到" value="使用本机登录 Cookie" styles={styles} theme={theme} onPress={onCheckIn} /> : null}
      <LoginWebViewModal
        visible={showLoginPanel}
        title="NodeSeek 登录 / 验证"
        subtitle={loginState}
        loading={loadingLoginPage}
        loadingText="正在打开 NodeSeek..."
        styles={styles}
        theme={theme}
        onClose={() => onShowLoginPanelChange(false)}
        actions={(
          <View style={styles.actions}>
            <AppButton label={checking ? '检测中' : '检测登录'} styles={styles} disabled={checking} onPress={onCheckLogin} />
            <AppButton label="清除登录" variant="ghost" styles={styles} onPress={onClearLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={() => webViewRef.current?.reload()} />
          </View>
        )}
      >
        {showLoginPanel && accountExpanded ? (
            <WebView
              ref={webViewRef}
              source={{ uri: NODESEEK_URL }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              userAgent={nodeSeekWebViewUserAgent}
              injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
              onLoadEnd={() => {
                onSetLoadingLoginPage(false);
                webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
                void onRememberNodeSeekCookies({ silent: true });
              }}
              onLoadStart={() => onSetLoadingLoginPage(true)}
              onMessage={onHandleLoginMessage}
              onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}
            />
        ) : null}
      </LoginWebViewModal>
    </>
  );
}

const MemoizedNodeSeekLoginPanel = memo(NodeSeekLoginPanel);

function YaohuoLoginPanel({
  accountExpanded,
  checking,
  hasYaohuoCookie,
  loadingYaohuoLoginPage,
  showYaohuoLoginPanel,
  styles,
  theme,
  yaohuoLoginCookieHeader,
  yaohuoLoginState,
  yaohuoWebViewRef,
  onCheckYaohuoLogin,
  onClearYaohuoLogin,
  handleYaohuoLoginNavigation,
  onSetLoadingYaohuoLoginPage,
  onShowYaohuoLoginPanelChange
}: {
  accountExpanded: boolean;
  checking: boolean;
  hasYaohuoCookie: boolean;
  loadingYaohuoLoginPage: boolean;
  showYaohuoLoginPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  yaohuoLoginCookieHeader: string;
  yaohuoLoginState: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  onCheckYaohuoLogin: () => void;
  onClearYaohuoLogin: () => void;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
}) {
  return (
    <>
      <MenuButton icon={LogIn} label="妖火登录" value={yaohuoLoginState} styles={styles} theme={theme} onPress={() => onShowYaohuoLoginPanelChange(!showYaohuoLoginPanel)} />
      <LoginWebViewModal
        visible={showYaohuoLoginPanel}
        title="妖火登录"
        subtitle={yaohuoLoginState}
        loading={loadingYaohuoLoginPage}
        loadingText="正在打开妖火..."
        styles={styles}
        theme={theme}
        onClose={() => onShowYaohuoLoginPanelChange(false)}
        actions={(
          <View style={styles.actions}>
            <AppButton label={checking ? '检测中' : '检测登录'} styles={styles} disabled={checking} onPress={onCheckYaohuoLogin} />
            <AppButton label="清除登录" variant="ghost" styles={styles} onPress={onClearYaohuoLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={() => yaohuoWebViewRef.current?.reload()} />
          </View>
        )}
      >
        {showYaohuoLoginPanel && accountExpanded ? (
            <WebView
              ref={yaohuoWebViewRef}
              source={{
                uri: hasYaohuoCookie ? YAOHUO_SESSION_URL : YAOHUO_LOGIN_URL,
                headers: yaohuoLoginCookieHeader ? { Cookie: yaohuoLoginCookieHeader } : undefined
              }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              onLoadEnd={() => onSetLoadingYaohuoLoginPage(false)}
              onLoadStart={() => onSetLoadingYaohuoLoginPage(true)}
              onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}
            />
        ) : null}
      </LoginWebViewModal>
    </>
  );
}

const MemoizedYaohuoLoginPanel = memo(YaohuoLoginPanel);

function LinuxDoVerifyPanel({
  accountExpanded,
  checking,
  hasLinuxDoClearance,
  hasLinuxDoLogin,
  linuxDoCookieNames,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewRef,
  linuxDoWebViewUserAgent,
  loadingLinuxDoPage,
  showLinuxDoPanel,
  styles,
  theme,
  onCheckLinuxDoCookie,
  onClearLinuxDoCookie,
  handleLinuxDoNavigation,
  onHandleLinuxDoMessage,
  onResetLinuxDoWebView,
  onSetLinuxDoWebViewError,
  onSetLoadingLinuxDoPage,
  onShowLinuxDoPanelChange
}: {
  accountExpanded: boolean;
  checking: boolean;
  hasLinuxDoClearance: boolean;
  hasLinuxDoLogin: boolean;
  linuxDoCookieNames: string[];
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewRef: RefObject<WebView | null>;
  linuxDoWebViewUserAgent: string;
  loadingLinuxDoPage: boolean;
  showLinuxDoPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCheckLinuxDoCookie: () => void;
  onClearLinuxDoCookie: () => void;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLinuxDoMessage: (event: WebViewMessageEvent) => void;
  onResetLinuxDoWebView: () => void;
  onSetLinuxDoWebViewError: (value: string) => void;
  onSetLoadingLinuxDoPage: (value: boolean) => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
}) {
  const linuxDoWebViewReadyRef = useRef(false);
  const markLinuxDoPageReady = () => {
    linuxDoWebViewReadyRef.current = true;
    onSetLoadingLinuxDoPage(false);
  };

  useEffect(() => {
    linuxDoWebViewReadyRef.current = false;
  }, [linuxDoWebViewKey, showLinuxDoPanel]);

  useEffect(() => {
    if (!showLinuxDoPanel || !loadingLinuxDoPage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      onSetLoadingLinuxDoPage(false);
      onSetLinuxDoWebViewError('linux.do 页面打开超时：请检查模拟器网络后刷新页面。');
    }, LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [loadingLinuxDoPage, onSetLinuxDoWebViewError, onSetLoadingLinuxDoPage, showLinuxDoPanel]);
  return (
    <>
      <MenuButton icon={LogIn} label="linux.do 登录 / 验证" value={hasLinuxDoLogin ? `已登录 ${linuxDoCookieNames.join('、') || '_t'}` : hasLinuxDoClearance ? `已验证 ${linuxDoCookieNames.join('、') || 'cf_clearance'}` : '匿名可用'} styles={styles} theme={theme} onPress={() => onShowLinuxDoPanelChange(!showLinuxDoPanel)} />
      <LoginWebViewModal
        visible={showLinuxDoPanel}
        title="linux.do 登录 / 验证"
        subtitle={hasLinuxDoLogin ? `已登录 ${linuxDoCookieNames.join('、') || '_t'}` : hasLinuxDoClearance ? `已验证 ${linuxDoCookieNames.join('、') || '访问信息'}` : '匿名可用，登录后内容更完整'}
        loading={loadingLinuxDoPage}
        loadingText="正在打开 linux.do..."
        error={linuxDoWebViewError}
        styles={styles}
        theme={theme}
        onClose={() => onShowLinuxDoPanelChange(false)}
        actions={(
          <View style={styles.actions}>
            <AppButton label={checking ? '检测中' : '检测状态'} styles={styles} disabled={checking} onPress={onCheckLinuxDoCookie} />
            <AppButton label="清除登录" variant="ghost" styles={styles} onPress={onClearLinuxDoCookie} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={onResetLinuxDoWebView} />
          </View>
        )}
      >
        {showLinuxDoPanel && accountExpanded ? (
            <WebView
              key={linuxDoWebViewKey}
              ref={linuxDoWebViewRef}
              source={{ uri: LINUXDO_VERIFY_URL }}
              androidLayerType="software"
              javaScriptEnabled
              domStorageEnabled
              cacheEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              userAgent={linuxDoWebViewUserAgent}
              injectedJavaScript={LINUXDO_WEBVIEW_PROBE_SCRIPT}
              onLoadProgress={(event) => {
                if (event.nativeEvent.progress >= 0.8) {
                  markLinuxDoPageReady();
                }
              }}
              onLoadEnd={(event) => {
                markLinuxDoPageReady();
                if (!('code' in event.nativeEvent)) {
                  onSetLinuxDoWebViewError('');
                }
                linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
              }}
              onLoadStart={() => {
                onSetLinuxDoWebViewError('');
                if (!linuxDoWebViewReadyRef.current) {
                  onSetLoadingLinuxDoPage(true);
                }
              }}
              onMessage={onHandleLinuxDoMessage}
              onError={(event) => {
                onSetLoadingLinuxDoPage(false);
                onSetLinuxDoWebViewError(`linux.do 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
              }}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={() => {
                onSetLoadingLinuxDoPage(false);
                onSetLinuxDoWebViewError('linux.do 验证页面已停止，请刷新页面重试。');
              }}
              onShouldStartLoadWithRequest={handleLinuxDoNavigation}
            />
        ) : null}
      </LoginWebViewModal>
    </>
  );
}

const MemoizedLinuxDoVerifyPanel = memo(LinuxDoVerifyPanel);

function AppearancePanel({
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

const MemoizedAppearancePanel = memo(AppearancePanel);

function StatusCheckPanel({
  healthDetails,
  statusBusy,
  styles,
  onCheckHealth
}: {
  healthDetails: HealthDetail[];
  statusBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  onCheckHealth: () => void;
}) {
  return (
    <View style={styles.stack}>
      <AppButton label={statusBusy ? '检查中' : '检查状态'} styles={styles} disabled={statusBusy} onPress={onCheckHealth} />
      {healthDetails.length ? (
        <View style={styles.stack}>
          {healthDetails.map((item) => (
            <View key={item.label} style={styles.statusDetailRow}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={[styles.meta, item.ok ? styles.statusOk : styles.statusBad]}>{item.ok ? '可用' : '不可用'} · {item.message}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const MemoizedStatusCheckPanel = memo(StatusCheckPanel);

export const MemoizedMoreScreen = memo(MoreScreen);

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
