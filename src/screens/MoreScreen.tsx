import { memo, type RefObject, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Activity, Bug, DatabaseBackup, LogIn, Server, Settings, User, Wrench } from 'lucide-react-native';
import { CURRENT_APP_VERSION, type AppUpdateDownloadProgress, type AppUpdateInfo } from '../appUpdate';
import type { ReaderSettings } from '../readerData';
import type { NetworkProxyProfile, NetworkProxyState, NetworkProxyStatus } from '../networkProxy';
import type { LinuxDoLevelProfile } from '../sources/sourceGateway';
import type { LoginNavigationRequest } from '../appTypes';
import type { DevAnonymousOverrides, SessionSite, SiteSessionViewModels } from '../siteSessionState';
import type { UserProfile } from '../types';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, ExpandablePanel, MenuButton } from '../components/AppControls';
import {
  AppearancePanel,
  BackupRestorePanel,
  LinuxDoVerifyPanel,
  LinuxDoLevelPanel,
  NodeSeekLoginPanel,
  YaohuoLoginPanel
} from './more/MorePanels';
import { NetworkProxyModal } from './more/NetworkProxyModal';
import { createPersonalCenterItems } from './more/personalCenterItems';
export const MoreScreen = memo(function MoreScreen({
  checking,
  appUpdateBusy,
  appUpdateDownloading,
  appUpdateDownloadProgress,
  appUpdateInfo,
  appUpdateMessage,
  loginState,
  loadingLoginPage,
  loadingYaohuoLoginPage,
  linuxDoLevelBusy,
  linuxDoLevelError,
  linuxDoLevelProfile,
  nodeImageApiKeyBusy,
  nodeImageApiKeySaved,
  nodeSeekWebViewUserAgent,
  settings,
  showLoginPanel,
  showYaohuoLoginPanel,
  showLinuxDoPanel,
  showNetworkProxyPanel,
  showSettingsPanel,
  statusBusy,
  styles,
  backupBusy,
  diagnosticBusy,
  theme,
  webViewRef,
  yaohuoLoginState,
  yaohuoLoginPrompt,
  yaohuoWebViewRef,
  sessionViewModels,
  devAnonymousAvailable,
  devAnonymousOverrides,
  networkProxyActiveProfile,
  networkProxyApplyError,
  networkProxyApplyStatus,
  networkProxyState,
  networkProxySummary,
  webViewBlockMessage,
  onRefreshAccountStatus,
  onOpenUser,
  onCheckAppUpdate,
  onDownloadAppUpdate,
  onCheckIn,
  onCheckLogin,
  onRememberNodeSeekCookies,
  onAuthorizeNodeImageApiKey,
  onSaveNodeImageApiKey,
  onClearNodeImageApiKey,
  onCheckYaohuoLogin,
  onRefreshLinuxDoLevel,
  onClearLogin,
  onClearYaohuoLogin,
  handleNodeSeekLoginNavigation,
  handleYaohuoLoginNavigation,
  onHandleLoginMessage,
  onNodeSeekLoginWebViewState,
  onYaohuoLoginWebViewState,
  onExportBackupFile,
  onExportDiagnosticLog,
  onImportBackupFile,
  onSetLoadingLoginPage,
  onSetLoadingYaohuoLoginPage,
  onShowLoginPanelChange,
  onShowYaohuoLoginPanelChange,
  onShowLinuxDoPanelChange,
  onShowNetworkProxyPanelChange,
  onShowSettingsPanelChange,
  onToggleDevAnonymousOverride,
  onDeleteNetworkProxyProfile,
  onSelectNetworkProxyProfile,
  onSetNetworkProxyEnabled,
  onTestNetworkProxyProfile,
  onUpsertNetworkProxyProfile,
  onUpdateSettings
}: {
  checking: boolean;
  appUpdateBusy: boolean;
  appUpdateDownloading: boolean;
  appUpdateDownloadProgress: AppUpdateDownloadProgress | null;
  appUpdateInfo: AppUpdateInfo | null;
  appUpdateMessage: string;
  loginState: string;
  loadingLoginPage: boolean;
  loadingYaohuoLoginPage: boolean;
  linuxDoLevelBusy: boolean;
  linuxDoLevelError: string;
  linuxDoLevelProfile: LinuxDoLevelProfile | null;
  nodeImageApiKeyBusy: boolean;
  nodeImageApiKeySaved: boolean;
  nodeSeekWebViewUserAgent: string;
  settings: ReaderSettings;
  showLoginPanel: boolean;
  showYaohuoLoginPanel: boolean;
  showLinuxDoPanel: boolean;
  showNetworkProxyPanel: boolean;
  showSettingsPanel: boolean;
  statusBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  backupBusy: boolean;
  diagnosticBusy: boolean;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  yaohuoLoginState: string;
  yaohuoLoginPrompt: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  sessionViewModels: SiteSessionViewModels;
  devAnonymousAvailable: boolean;
  devAnonymousOverrides: DevAnonymousOverrides;
  networkProxyActiveProfile: NetworkProxyProfile | null;
  networkProxyApplyError: string;
  networkProxyApplyStatus: string;
  networkProxyState: NetworkProxyState;
  networkProxySummary: string;
  webViewBlockMessage: string;
  onRefreshAccountStatus: (options?: { silent?: boolean }) => void;
  onOpenUser: (user: UserProfile) => void;
  onCheckAppUpdate: () => void;
  onDownloadAppUpdate: () => void;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onRememberNodeSeekCookies: (options?: { silent?: boolean }) => Promise<boolean>;
  onAuthorizeNodeImageApiKey: () => void;
  onSaveNodeImageApiKey: (value: string) => void;
  onClearNodeImageApiKey: () => void;
  onCheckYaohuoLogin: () => void;
  onRefreshLinuxDoLevel: () => void;
  onClearLogin: () => void;
  onClearYaohuoLogin: () => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onNodeSeekLoginWebViewState: (state: 'start' | 'ready' | 'error' | 'renderer-gone') => void;
  onYaohuoLoginWebViewState: (state: 'start' | 'ready' | 'error' | 'renderer-gone') => void;
  onExportBackupFile: () => void;
  onExportDiagnosticLog: () => void;
  onImportBackupFile: () => void;
  onSetLoadingLoginPage: (value: boolean) => void;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
  onShowNetworkProxyPanelChange: (value: boolean) => void;
  onShowSettingsPanelChange: (value: boolean) => void;
  onToggleDevAnonymousOverride: (site: SessionSite) => void;
  onDeleteNetworkProxyProfile: (id: string) => Promise<void>;
  onSelectNetworkProxyProfile: (id: string) => Promise<void>;
  onSetNetworkProxyEnabled: (enabled: boolean) => Promise<void>;
  onTestNetworkProxyProfile: (profile: NetworkProxyProfile) => Promise<NetworkProxyStatus>;
  onUpsertNetworkProxyProfile: (profile: NetworkProxyProfile) => Promise<void>;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const [backupExpanded, setBackupExpanded] = useState(false);
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const [accountExpanded, setAccountExpanded] = useState(false);
  const [personalCenterExpanded, setPersonalCenterExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [levelExpanded, setLevelExpanded] = useState(false);
  const nodeSeekSession = sessionViewModels.nodeseek;
  const linuxDoSession = sessionViewModels.linuxdo;
  const yaohuoSession = sessionViewModels.yaohuo;
  const personalCenterItems = createPersonalCenterItems(sessionViewModels);
  const personalCenterReadyCount = personalCenterItems.filter((item) => item.canOpen).length;
  const updateNotes = appUpdateInfo?.notes.trim();
  const appUpdateStatus = appUpdateMessage === `当前版本 ${CURRENT_APP_VERSION}` || (appUpdateInfo && appUpdateMessage === `发现新版 ${appUpdateInfo.version}`) ? '' : appUpdateMessage;
  const appUpdateProgressWidth = appUpdateDownloadProgress && appUpdateDownloadProgress.percent !== null ? `${appUpdateDownloadProgress.percent}%` as `${number}%` : null;
  const appVersionMeta = appUpdateInfo
    ? `当前版本 ${CURRENT_APP_VERSION} · 最新版本 ${appUpdateInfo.version}`
    : `多网站第三方客户端 · 当前版本 ${CURRENT_APP_VERSION}`;
  const devAnonymousActiveCount = (devAnonymousOverrides.nodeseek ? 1 : 0) + (devAnonymousOverrides.yaohuo ? 1 : 0) + (devAnonymousOverrides.linuxdo ? 1 : 0);
  const devAnonymousMeta = devAnonymousActiveCount ? `已开启 ${devAnonymousActiveCount} 项` : '临时匿名 · 不删除 Cookie';
  useEffect(() => {
    if (showLoginPanel || showYaohuoLoginPanel || showLinuxDoPanel) {
      setAccountExpanded(true);
    }
  }, [showLinuxDoPanel, showLoginPanel, showYaohuoLoginPanel]);
  useEffect(() => {
    if (levelExpanded && linuxDoSession.canWrite && !linuxDoLevelProfile && !linuxDoLevelBusy && !linuxDoLevelError) {
      onRefreshLinuxDoLevel();
    }
  }, [levelExpanded, linuxDoLevelBusy, linuxDoLevelError, linuxDoLevelProfile, linuxDoSession.canWrite, onRefreshLinuxDoLevel]);
  const levelMeta = !linuxDoSession.canWrite
    ? '登录后查看'
    : linuxDoLevelBusy
      ? '读取中'
      : linuxDoLevelProfile
        ? `LV ${linuxDoLevelProfile.currentLevel}${linuxDoLevelProfile.targetLevel !== null ? ` → LV ${linuxDoLevelProfile.targetLevel}` : ''}`
        : linuxDoLevelError || '点击读取';
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>更多</Text>
      <View style={styles.groupList}>
        <View style={styles.menuButton}>
          <View style={styles.menuIcon}>
            <Activity size={19} color={theme.primary} strokeWidth={1.8} />
          </View>
          <View style={styles.flex}>
            <View style={styles.actions}>
              <Text style={styles.menuLabel}>关于阅坛</Text>
              {appUpdateInfo ? <Text style={styles.updateBadge}>有新版本</Text> : null}
            </View>
            <Text style={styles.meta}>{appVersionMeta}</Text>
          </View>
        </View>
        <View style={styles.actions}>
          {appUpdateInfo ? (
            <>
              <AppButton variant="primary" label={appUpdateDownloading ? '下载中' : '下载并安装'} styles={styles} disabled={appUpdateBusy || appUpdateDownloading} onPress={onDownloadAppUpdate} />
              <AppButton tiny label={appUpdateBusy ? '检查中' : '检查更新'} styles={styles} disabled={appUpdateBusy || appUpdateDownloading} onPress={onCheckAppUpdate} />
            </>
          ) : (
            <AppButton tiny label={appUpdateBusy ? '检查中' : '检查更新'} styles={styles} disabled={appUpdateBusy} onPress={onCheckAppUpdate} />
          )}
        </View>
        {appUpdateDownloadProgress ? (
          <View style={styles.updateProgressBox}>
            <View style={styles.updateProgressHeader}>
              <Text style={styles.updateProgressTitle}>{appUpdateDownloadProgress.title}</Text>
              {appUpdateDownloadProgress.percentLabel ? <Text style={styles.updateProgressPercent}>{appUpdateDownloadProgress.percentLabel}</Text> : null}
            </View>
            {appUpdateProgressWidth ? (
              <View style={styles.updateProgressTrack}>
                <View style={[styles.updateProgressFill, { width: appUpdateProgressWidth }]} />
              </View>
            ) : null}
            <Text style={styles.updateProgressMeta}>{appUpdateDownloadProgress.sizeLabel}</Text>
          </View>
        ) : null}
        {appUpdateStatus && !appUpdateDownloadProgress ? <Text style={styles.meta}>{appUpdateStatus}</Text> : null}
        {appUpdateInfo && updateNotes ? <Text style={styles.meta}>{updateNotes}</Text> : null}
      </View>
      <ExpandablePanel
        quiet
        title="个人中心"
        meta={personalCenterReadyCount ? `已识别 ${personalCenterReadyCount}/3 · 当前登录账号主页` : '未识别当前账号'}
        icon={User}
        expanded={personalCenterExpanded}
        styles={styles}
        theme={theme}
        onExpandedChange={setPersonalCenterExpanded}
      >
        {personalCenterItems.map((item) => (
          <MenuButton
            key={item.source}
            disabled={!item.canOpen}
            icon={User}
            label={item.label}
            value={item.canOpen ? `${item.value} · 我的主页` : item.value}
            styles={styles}
            theme={theme}
            onPress={() => {
              if (item.user) {
                onOpenUser(item.user);
              }
            }}
          />
        ))}
        <View style={styles.stack}>
          <AppButton label={statusBusy ? '刷新中' : '刷新账号状态'} styles={styles} disabled={statusBusy} onPress={() => onRefreshAccountStatus()} />
        </View>
      </ExpandablePanel>
      <ExpandablePanel
        quiet
        title="账号与验证"
        meta={`NodeSeek ${nodeSeekSession.summaryLabel} · 妖火 ${yaohuoSession.summaryLabel} · linux.do ${linuxDoSession.summaryLabel}`}
        icon={LogIn}
        expanded={accountExpanded}
        styles={styles}
        theme={theme}
        onExpandedChange={setAccountExpanded}
      >
        <NodeSeekLoginPanel
          checking={checking}
          nodeSeekSession={nodeSeekSession}
          nodeImageApiKeyBusy={nodeImageApiKeyBusy}
          nodeImageApiKeySaved={nodeImageApiKeySaved}
          accountExpanded={accountExpanded}
          loginState={loginState}
          loadingLoginPage={loadingLoginPage}
          nodeSeekWebViewUserAgent={nodeSeekWebViewUserAgent}
          showLoginPanel={showLoginPanel}
          styles={styles}
          theme={theme}
          webViewRef={webViewRef}
          webViewBlockMessage={webViewBlockMessage}
          onCheckIn={onCheckIn}
          onCheckLogin={onCheckLogin}
          onAuthorizeNodeImageApiKey={onAuthorizeNodeImageApiKey}
          onSaveNodeImageApiKey={onSaveNodeImageApiKey}
          onClearNodeImageApiKey={onClearNodeImageApiKey}
          onClearLogin={onClearLogin}
          onHandleLoginMessage={onHandleLoginMessage}
          onWebViewState={onNodeSeekLoginWebViewState}
          handleNodeSeekLoginNavigation={handleNodeSeekLoginNavigation}
          onRememberNodeSeekCookies={onRememberNodeSeekCookies}
          onSetLoadingLoginPage={onSetLoadingLoginPage}
          onShowLoginPanelChange={onShowLoginPanelChange}
        />
        <YaohuoLoginPanel
          checking={checking}
          yaohuoSession={yaohuoSession}
          accountExpanded={accountExpanded}
          loadingYaohuoLoginPage={loadingYaohuoLoginPage}
          showYaohuoLoginPanel={showYaohuoLoginPanel}
          styles={styles}
          theme={theme}
          yaohuoLoginState={yaohuoLoginState}
          yaohuoLoginPrompt={yaohuoLoginPrompt}
          yaohuoWebViewRef={yaohuoWebViewRef}
          webViewBlockMessage={webViewBlockMessage}
          onCheckYaohuoLogin={onCheckYaohuoLogin}
          onClearYaohuoLogin={onClearYaohuoLogin}
          handleYaohuoLoginNavigation={handleYaohuoLoginNavigation}
          onWebViewState={onYaohuoLoginWebViewState}
          onSetLoadingYaohuoLoginPage={onSetLoadingYaohuoLoginPage}
          onShowYaohuoLoginPanelChange={onShowYaohuoLoginPanelChange}
        />
        <LinuxDoVerifyPanel
          linuxDoSession={linuxDoSession}
          showLinuxDoPanel={showLinuxDoPanel}
          styles={styles}
          theme={theme}
          onShowLinuxDoPanelChange={onShowLinuxDoPanelChange}
        />
        <MenuButton icon={Activity} label="linux.do 等级" value={levelMeta} expanded={levelExpanded} styles={styles} theme={theme} onPress={() => setLevelExpanded((value) => !value)} />
        {levelExpanded ? (
          <LinuxDoLevelPanel
            busy={linuxDoLevelBusy}
            error={linuxDoLevelError}
            linuxDoSession={linuxDoSession}
            profile={linuxDoLevelProfile}
            styles={styles}
            theme={theme}
            onOpenLogin={() => onShowLinuxDoPanelChange(true)}
            onRefresh={onRefreshLinuxDoLevel}
          />
        ) : null}
      </ExpandablePanel>
      <View style={styles.groupList}>
        <MenuButton
          icon={Server}
          label="服务器代理"
          value={networkProxySummary}
          styles={styles}
          theme={theme}
          onPress={() => onShowNetworkProxyPanelChange(true)}
        />
      </View>
      <NetworkProxyModal
        activeProfile={networkProxyActiveProfile}
        applyError={networkProxyApplyError}
        applyStatus={networkProxyApplyStatus}
        proxyState={networkProxyState}
        styles={styles}
        theme={theme}
        visible={showNetworkProxyPanel}
        onClose={() => onShowNetworkProxyPanelChange(false)}
        onDeleteProfile={onDeleteNetworkProxyProfile}
        onSelectProfile={onSelectNetworkProxyProfile}
        onSetEnabled={onSetNetworkProxyEnabled}
        onTestProfile={onTestNetworkProxyProfile}
        onUpsertProfile={onUpsertNetworkProxyProfile}
      />
      {devAnonymousAvailable ? (
        <ExpandablePanel
          quiet
          title="测试工具"
          meta={devAnonymousMeta}
          icon={Wrench}
          expanded={toolsExpanded}
          styles={styles}
          theme={theme}
          onExpandedChange={setToolsExpanded}
        >
          <View style={styles.stack}>
            <Text style={styles.meta}>只影响本次运行，不删除 Cookie。重启后恢复。</Text>
            <View style={styles.actions}>
              <AppButton tiny variant={devAnonymousOverrides.nodeseek ? 'primary' : 'ghost'} label="NodeSeek" styles={styles} onPress={() => onToggleDevAnonymousOverride('nodeseek')} />
              <AppButton tiny variant={devAnonymousOverrides.yaohuo ? 'primary' : 'ghost'} label="妖火" styles={styles} onPress={() => onToggleDevAnonymousOverride('yaohuo')} />
              <AppButton tiny variant={devAnonymousOverrides.linuxdo ? 'primary' : 'ghost'} label="linux.do" styles={styles} onPress={() => onToggleDevAnonymousOverride('linuxdo')} />
            </View>
          </View>
        </ExpandablePanel>
      ) : null}
      <ExpandablePanel
        quiet
        title="问题诊断"
        meta={diagnosticBusy ? '正在生成' : '生成脱敏日志并分享'}
        icon={Bug}
        expanded={diagnosticExpanded}
        styles={styles}
        theme={theme}
        onExpandedChange={setDiagnosticExpanded}
      >
        <View style={styles.stack}>
          <Text style={styles.meta}>日志只保存在本机并经过脱敏。显示问题请同时附截图；特定内容解析异常请附原帖链接。</Text>
          <AppButton
            label={diagnosticBusy ? '正在生成' : '生成并分享诊断日志'}
            styles={styles}
            disabled={diagnosticBusy}
            onPress={onExportDiagnosticLog}
          />
        </View>
      </ExpandablePanel>
      <ExpandablePanel
        quiet
        title="备份 / 恢复"
        meta={backupBusy ? '处理中' : '文件导出和恢复'}
        icon={DatabaseBackup}
        expanded={backupExpanded}
        styles={styles}
        theme={theme}
        onExpandedChange={setBackupExpanded}
      >
        <BackupRestorePanel
          backupBusy={backupBusy}
          styles={styles}
          onExportBackupFile={onExportBackupFile}
          onImportBackupFile={onImportBackupFile}
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
        <AppearancePanel
          settings={settings}
          showSettingsPanel={showSettingsPanel}
          styles={styles}
          onUpdateSettings={onUpdateSettings}
        />
      </ExpandablePanel>
    </View>
  );
});
