import { memo, type RefObject, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { CheckCircle, LogIn } from 'lucide-react-native';
import type { ReaderSettings } from '../../readerData';
import type { HealthDetail, LoginNavigationRequest } from '../../appTypes';
import { NODESEEK_URL, YAOHUO_URL } from '../../appUrls';
import type { SiteSessionViewModel } from '../../siteSessionState';
import { createStyles, type ReaderTheme } from '../../theme';
import { AppButton, MenuButton, SettingRail } from '../../components/AppControls';
import { LoginWebViewModal } from '../../components/LoginWebViewModal';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from '../../loginWebViewScripts';
import { LinuxDoLevelPanel } from './LinuxDoLevelPanel';

const YAOHUO_LOGIN_URL = YAOHUO_URL + '/waplogin.aspx?siteid=1000';
const YAOHUO_SESSION_URL = YAOHUO_URL + '/wapindex.aspx?sid=-2';

export function BackupRestorePanel({
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
        placeholder="粘贴或生成本机资料 JSON"
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

export const MemoizedBackupRestorePanel = memo(BackupRestorePanel);

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

  useEffect(() => {
    if (!showLoginPanel) {
      setWebViewError('');
      setWebViewNeedsRemount(false);
    }
  }, [showLoginPanel]);

  const refreshWebView = () => {
    setWebViewError('');
    onSetLoadingLoginPage(true);
    if (webViewNeedsRemount) {
      setWebViewNeedsRemount(false);
      setWebViewKey((current) => current + 1);
      return;
    }
    webViewRef.current?.reload();
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
        onClose={() => onShowLoginPanelChange(false)}
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
              source={{ uri: NODESEEK_URL }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              userAgent={nodeSeekWebViewUserAgent}
              injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
              onLoadEnd={(event) => {
                onSetLoadingLoginPage(false);
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
                onSetLoadingLoginPage(true);
              }}
              onMessage={onHandleLoginMessage}
              onError={(event) => {
                onSetLoadingLoginPage(false);
                setWebViewError(`NodeSeek 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
              }}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={() => {
                onSetLoadingLoginPage(false);
                setWebViewNeedsRemount(true);
                setWebViewError('NodeSeek 登录页面已停止，请刷新页面重试。');
              }}
              onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}
            />
        ) : null}
      </LoginWebViewModal>
    </>
  );
}

export const MemoizedNodeSeekLoginPanel = memo(NodeSeekLoginPanel);

export function YaohuoLoginPanel({
  accountExpanded,
  checking,
  yaohuoSession,
  loadingYaohuoLoginPage,
  showYaohuoLoginPanel,
  styles,
  theme,
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
  yaohuoSession: SiteSessionViewModel;
  loadingYaohuoLoginPage: boolean;
  showYaohuoLoginPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  yaohuoLoginState: string;
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
        subtitle={yaohuoLoginState}
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
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
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

export const MemoizedYaohuoLoginPanel = memo(YaohuoLoginPanel);

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

export const MemoizedLinuxDoVerifyPanel = memo(LinuxDoVerifyPanel);

export { LinuxDoLevelPanel };
export const MemoizedLinuxDoLevelPanel = memo(LinuxDoLevelPanel);

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

export const MemoizedAppearancePanel = memo(AppearancePanel);

export function StatusCheckPanel({
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

export const MemoizedStatusCheckPanel = memo(StatusCheckPanel);

export function SettingsPanel({
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

