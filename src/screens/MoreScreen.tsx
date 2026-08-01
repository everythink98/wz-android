import type { MoreScreenStyles } from '@/features/more/styles';
import { memo, type RefObject, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Activity, Bug, DatabaseBackup, Server, Settings } from 'lucide-react-native';
import { CURRENT_APP_VERSION, type AppUpdateDownloadProgress, type AppUpdateInfo } from '@/platform/update/appUpdate';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { NetworkProxyProfile, NetworkProxyState, NetworkProxyStatus } from '@/platform/network/networkProxy';
import type { LinuxDoLevelProfile } from '@/sources/readGateway';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import type { SessionSite, SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton, ExpandablePanel, MenuButton } from '@/ui/controls/AppControls';
import {
  AppearancePanel,
  BackupRestorePanel,
  LinuxDoLevelPanel,
  NodeSeekLoginPanel,
  YaohuoLoginPanel
} from '@/screens/more/MorePanels';
import { NetworkProxyModal } from '@/screens/more/NetworkProxyModal';
import { AccountCenterPanel, type AccountCenterCommand } from '@/screens/more/AccountCenterPanel';
import type { CredentialSummaries } from '@/screens/more/accountCenter';
import type { AccountCredentialFillAttempt } from '@/app/useAccountCredentialController';
import type { XiaoyinsiAuthPhase } from '@/app/useXiaoyinsiAuthController';
import type { XiaoyinsiPendingAuthorization } from '@/xiaoyinsiAuth';
import type { XiaoyinsiLevelProfile } from '@/localXiaoyinsi';
import { XiaoyinsiAuthPanel } from '@/screens/more/XiaoyinsiAuthPanel';

const moreScreenStyles = StyleSheet.create({
  accountFooterAction: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingTop: 4
  }
});

function appearanceSummary(settings: ReaderSettings) {
  const themeLabel = settings.theme === 'dark' ? '深色' : '浅色';
  const densityLabel =
    settings.listDensity === 'compact' ? '紧凑密度' : settings.listDensity === 'loose' ? '宽松密度' : '标准密度';
  return `${themeLabel} · 字号 ${Math.round(settings.fontScale * 100)}% · ${densityLabel}`;
}
export const MoreScreen = memo(function MoreScreen({
  checking,
  appUpdateBusy,
  appUpdateDownloading,
  appUpdateDownloadProgress,
  appUpdateInfo,
  appUpdateMessage,
  credentialLoginSite,
  credentialFillAttempt,
  credentialSummaries,
  loadingLoginPage,
  loadingYaohuoLoginPage,
  linuxDoLevelBusy,
  linuxDoLevelError,
  linuxDoLevelProfile,
  xiaoyinsiLevelBusy,
  xiaoyinsiLevelError,
  xiaoyinsiLevelProfile,
  nodeImageApiKeyBusy,
  nodeImageApiKeySaved,
  nodeSeekUserId,
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
  pendingCredentialFillSite,
  yaohuoLoginPrompt,
  yaohuoWebViewRef,
  sessionViewModels,
  networkProxyActiveProfile,
  networkProxyApplyError,
  networkProxyApplyStatus,
  networkProxyState,
  networkProxySummary,
  webViewBlockMessage,
  xiaoyinsiAuth,
  onAccountCenterCommand,
  onCheckAppUpdate,
  onDownloadAppUpdate,
  onCheckIn,
  onCheckLogin,
  onAuthorizeNodeImageApiKey,
  onSaveNodeImageApiKey,
  onClearNodeImageApiKey,
  onCheckYaohuoLogin,
  onRefreshLinuxDoLevel,
  onRefreshXiaoyinsiLevel,
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
  onLoginFormMessage,
  onShowNetworkProxyPanelChange,
  onShowSettingsPanelChange,
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
  credentialLoginSite: SessionSite | null;
  credentialFillAttempt: AccountCredentialFillAttempt | null;
  credentialSummaries: CredentialSummaries;
  loadingLoginPage: boolean;
  loadingYaohuoLoginPage: boolean;
  linuxDoLevelBusy: boolean;
  linuxDoLevelError: string;
  linuxDoLevelProfile: LinuxDoLevelProfile | null;
  xiaoyinsiLevelBusy: boolean;
  xiaoyinsiLevelError: string;
  xiaoyinsiLevelProfile: XiaoyinsiLevelProfile | null;
  nodeImageApiKeyBusy: boolean;
  nodeImageApiKeySaved: boolean;
  nodeSeekUserId: number | null;
  settings: ReaderSettings;
  showLoginPanel: boolean;
  showYaohuoLoginPanel: boolean;
  showLinuxDoPanel: boolean;
  showNetworkProxyPanel: boolean;
  showSettingsPanel: boolean;
  statusBusy: boolean;
  styles: MoreScreenStyles;
  backupBusy: boolean;
  diagnosticBusy: boolean;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  pendingCredentialFillSite: SessionSite | null;
  yaohuoLoginPrompt: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  sessionViewModels: SiteSessionViewModels;
  networkProxyActiveProfile: NetworkProxyProfile | null;
  networkProxyApplyError: string;
  networkProxyApplyStatus: string;
  networkProxyState: NetworkProxyState;
  networkProxySummary: string;
  webViewBlockMessage: string;
  xiaoyinsiAuth: {
    message: string;
    pending: XiaoyinsiPendingAuthorization | null;
    phase: XiaoyinsiAuthPhase;
    secondsRemaining: number;
    onBegin: () => void;
    onCancel: () => void;
    onOpenBrowser: () => void;
    onRevoke: () => void;
  };
  onAccountCenterCommand: (command: AccountCenterCommand) => void | Promise<void>;
  onCheckAppUpdate: () => void;
  onDownloadAppUpdate: () => void;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onAuthorizeNodeImageApiKey: () => void;
  onSaveNodeImageApiKey: (value: string) => void;
  onClearNodeImageApiKey: () => void;
  onCheckYaohuoLogin: () => void;
  onRefreshLinuxDoLevel: () => void;
  onRefreshXiaoyinsiLevel: () => void;
  onClearLogin: () => void;
  onClearYaohuoLogin: () => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onNodeSeekLoginWebViewState: (
    state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout',
    attempt?: number
  ) => void;
  onYaohuoLoginWebViewState: (
    state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout',
    attempt?: number
  ) => void;
  onExportBackupFile: () => void;
  onExportDiagnosticLog: () => void;
  onImportBackupFile: () => void;
  onSetLoadingLoginPage: (value: boolean) => void;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onShowNetworkProxyPanelChange: (value: boolean) => void;
  onShowSettingsPanelChange: (value: boolean) => void;
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
  const [levelExpanded, setLevelExpanded] = useState(false);
  const [xiaoyinsiLevelExpanded, setXiaoyinsiLevelExpanded] = useState(false);
  const nodeSeekSession = sessionViewModels.nodeseek;
  const linuxDoSession = sessionViewModels.linuxdo;
  const yaohuoSession = sessionViewModels.yaohuo;
  const xiaoyinsiSession = sessionViewModels.xiaoyinsi;
  const updateNotes = appUpdateInfo?.notes.trim();
  const appUpdateStatus =
    appUpdateMessage === `当前版本 ${CURRENT_APP_VERSION}` ||
    (appUpdateInfo && appUpdateMessage === `发现新版 ${appUpdateInfo.version}`)
      ? ''
      : appUpdateMessage;
  const appUpdateProgressWidth =
    appUpdateDownloadProgress && appUpdateDownloadProgress.percent !== null
      ? (`${appUpdateDownloadProgress.percent}%` as `${number}%`)
      : null;
  const appVersionMeta = appUpdateInfo
    ? `当前版本 ${CURRENT_APP_VERSION} · 最新版本 ${appUpdateInfo.version}`
    : `多网站第三方客户端 · 当前版本 ${CURRENT_APP_VERSION}`;
  const xiaoyinsiAuthForcedOpen =
    xiaoyinsiAuth.phase === 'requesting' || xiaoyinsiAuth.phase === 'waiting' || xiaoyinsiAuth.phase === 'cleanup';
  const accountSessionViewModels =
    xiaoyinsiAuth.phase === 'cleanup'
      ? {
          ...sessionViewModels,
          xiaoyinsi: {
            ...xiaoyinsiSession,
            status: 'authorizing' as const,
            statusLabel: '待清理',
            summaryLabel: '本机清理未完成',
            cookieSummary: [],
            isVerified: false,
            isLoggedIn: false,
            isVerifying: true,
            canWrite: false,
            currentUser: undefined
          }
        }
      : sessionViewModels;
  useEffect(() => {
    if (showLoginPanel || showYaohuoLoginPanel || showLinuxDoPanel || xiaoyinsiAuthForcedOpen) {
      setAccountExpanded(true);
    }
  }, [showLinuxDoPanel, showLoginPanel, showYaohuoLoginPanel, xiaoyinsiAuthForcedOpen]);
  useEffect(() => {
    if (levelExpanded && linuxDoSession.canWrite && !linuxDoLevelProfile && !linuxDoLevelBusy && !linuxDoLevelError) {
      onRefreshLinuxDoLevel();
    }
  }, [
    levelExpanded,
    linuxDoLevelBusy,
    linuxDoLevelError,
    linuxDoLevelProfile,
    linuxDoSession.canWrite,
    onRefreshLinuxDoLevel
  ]);
  useEffect(() => {
    if (
      xiaoyinsiLevelExpanded &&
      xiaoyinsiSession.canWrite &&
      !xiaoyinsiLevelProfile &&
      !xiaoyinsiLevelBusy &&
      !xiaoyinsiLevelError
    ) {
      onRefreshXiaoyinsiLevel();
    }
  }, [
    onRefreshXiaoyinsiLevel,
    xiaoyinsiLevelBusy,
    xiaoyinsiLevelError,
    xiaoyinsiLevelExpanded,
    xiaoyinsiLevelProfile,
    xiaoyinsiSession.canWrite
  ]);
  const levelMeta = !linuxDoSession.canWrite
    ? '登录后查看'
    : linuxDoLevelBusy
      ? '读取中'
      : linuxDoLevelProfile
        ? `LV ${linuxDoLevelProfile.currentLevel}${linuxDoLevelProfile.targetLevel !== null ? ` → LV ${linuxDoLevelProfile.targetLevel}` : ''}`
        : linuxDoLevelError || '点击读取';
  const xiaoyinsiLevelMeta = !xiaoyinsiSession.canWrite
    ? '授权后查看'
    : xiaoyinsiLevelBusy
      ? '读取中'
      : xiaoyinsiLevelProfile
        ? `LV ${xiaoyinsiLevelProfile.currentLevel}${xiaoyinsiLevelProfile.targetLevel !== null ? ` → LV ${xiaoyinsiLevelProfile.targetLevel}` : ''}`
        : xiaoyinsiLevelError || '点击读取';
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
              <AppButton
                variant="primary"
                label={appUpdateDownloading ? '下载中' : '下载并安装'}
                styles={styles}
                disabled={appUpdateBusy || appUpdateDownloading}
                onPress={onDownloadAppUpdate}
              />
              <AppButton
                tiny
                label={appUpdateBusy ? '检查中' : '检查更新'}
                styles={styles}
                disabled={appUpdateBusy || appUpdateDownloading}
                onPress={onCheckAppUpdate}
              />
            </>
          ) : (
            <AppButton
              tiny
              label={appUpdateBusy ? '检查中' : '检查更新'}
              styles={styles}
              disabled={appUpdateBusy}
              onPress={onCheckAppUpdate}
            />
          )}
        </View>
        {appUpdateDownloadProgress ? (
          <View style={styles.updateProgressBox}>
            <View style={styles.updateProgressHeader}>
              <Text style={styles.updateProgressTitle}>{appUpdateDownloadProgress.title}</Text>
              {appUpdateDownloadProgress.percentLabel ? (
                <Text style={styles.updateProgressPercent}>{appUpdateDownloadProgress.percentLabel}</Text>
              ) : null}
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
      <AccountCenterPanel
        credentials={credentialSummaries}
        expanded={accountExpanded}
        forcedSite={
          showLoginPanel
            ? 'nodeseek'
            : showYaohuoLoginPanel
              ? 'yaohuo'
              : showLinuxDoPanel
                ? 'linuxdo'
                : xiaoyinsiAuthForcedOpen
                  ? 'xiaoyinsi'
                  : null
        }
        pendingFillSite={pendingCredentialFillSite}
        nodeSeekUserId={nodeSeekUserId}
        sessions={accountSessionViewModels}
        siteContent={{
          nodeseek: (
            <NodeSeekLoginPanel
              checking={checking}
              credentialAttempt={credentialFillAttempt?.site === 'nodeseek' ? credentialFillAttempt.attempt : 0}
              credentialFillPending={pendingCredentialFillSite === 'nodeseek'}
              credentialSaved={credentialSummaries.nodeseek.hasCredential}
              nodeSeekSession={nodeSeekSession}
              nodeImageApiKeyBusy={nodeImageApiKeyBusy}
              nodeImageApiKeySaved={nodeImageApiKeySaved}
              accountExpanded={accountExpanded}
              loginFormMode={credentialLoginSite === 'nodeseek'}
              loadingLoginPage={loadingLoginPage}
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
              onLoginFormMessage={onLoginFormMessage}
              onRequestCredentialFill={() => {
                void onAccountCenterCommand({ type: 'open-login-with-fill', site: 'nodeseek' });
              }}
              onWebViewState={onNodeSeekLoginWebViewState}
              handleNodeSeekLoginNavigation={handleNodeSeekLoginNavigation}
              onSetLoadingLoginPage={onSetLoadingLoginPage}
              onShowLoginPanelChange={onShowLoginPanelChange}
            />
          ),
          linuxdo: (
            <>
              <MenuButton
                nested
                icon={Activity}
                label="linux.do 等级"
                value={levelMeta}
                expanded={levelExpanded}
                styles={styles}
                theme={theme}
                onPress={() => setLevelExpanded((value) => !value)}
              />
              {levelExpanded ? (
                <LinuxDoLevelPanel
                  busy={linuxDoLevelBusy}
                  error={linuxDoLevelError}
                  siteSession={linuxDoSession}
                  profile={linuxDoLevelProfile}
                  styles={styles}
                  theme={theme}
                  onOpenLogin={() => {
                    void onAccountCenterCommand({ type: 'open-login', site: 'linuxdo' });
                  }}
                  onRefresh={onRefreshLinuxDoLevel}
                />
              ) : null}
            </>
          ),
          yaohuo: (
            <YaohuoLoginPanel
              checking={checking}
              credentialAttempt={credentialFillAttempt?.site === 'yaohuo' ? credentialFillAttempt.attempt : 0}
              credentialFillPending={pendingCredentialFillSite === 'yaohuo'}
              credentialSaved={credentialSummaries.yaohuo.hasCredential}
              yaohuoSession={yaohuoSession}
              accountExpanded={accountExpanded}
              loginFormMode={credentialLoginSite === 'yaohuo'}
              loadingYaohuoLoginPage={loadingYaohuoLoginPage}
              showYaohuoLoginPanel={showYaohuoLoginPanel}
              styles={styles}
              theme={theme}
              yaohuoLoginPrompt={yaohuoLoginPrompt}
              yaohuoWebViewRef={yaohuoWebViewRef}
              webViewBlockMessage={webViewBlockMessage}
              onCheckYaohuoLogin={onCheckYaohuoLogin}
              onClearYaohuoLogin={onClearYaohuoLogin}
              handleYaohuoLoginNavigation={handleYaohuoLoginNavigation}
              onLoginFormMessage={onLoginFormMessage}
              onRequestCredentialFill={() => {
                void onAccountCenterCommand({ type: 'open-login-with-fill', site: 'yaohuo' });
              }}
              onWebViewState={onYaohuoLoginWebViewState}
              onSetLoadingYaohuoLoginPage={onSetLoadingYaohuoLoginPage}
              onShowYaohuoLoginPanelChange={onShowYaohuoLoginPanelChange}
            />
          ),
          xiaoyinsi: (
            <>
              <XiaoyinsiAuthPanel
                message={xiaoyinsiAuth.message}
                pending={xiaoyinsiAuth.pending}
                phase={xiaoyinsiAuth.phase}
                secondsRemaining={xiaoyinsiAuth.secondsRemaining}
                session={xiaoyinsiSession}
                styles={styles}
                theme={theme}
                onBegin={xiaoyinsiAuth.onBegin}
                onCancel={xiaoyinsiAuth.onCancel}
                onOpenBrowser={xiaoyinsiAuth.onOpenBrowser}
                onRevoke={xiaoyinsiAuth.onRevoke}
              />
              <View
                testID={
                  xiaoyinsiLevelExpanded &&
                  xiaoyinsiSession.canWrite &&
                  !xiaoyinsiLevelBusy &&
                  (xiaoyinsiLevelProfile || xiaoyinsiLevelError)
                    ? 'xiaoyinsi-level-settled'
                    : undefined
                }
                style={[moreScreenStyles.accountFooterAction, { borderTopColor: theme.line }]}
              >
                <MenuButton
                  nested
                  icon={Activity}
                  label="查看等级"
                  value={xiaoyinsiLevelMeta}
                  expanded={xiaoyinsiLevelExpanded}
                  styles={styles}
                  theme={theme}
                  onPress={() => setXiaoyinsiLevelExpanded((value) => !value)}
                />
                {xiaoyinsiLevelExpanded ? (
                  <LinuxDoLevelPanel
                    busy={xiaoyinsiLevelBusy}
                    error={xiaoyinsiLevelError}
                    loginButtonLabel="授权登录"
                    loginMessage="需要先完成小隐寺授权，等级数据只使用 App 保存的 User API Key 读取。"
                    profile={xiaoyinsiLevelProfile}
                    siteSession={xiaoyinsiSession}
                    styles={styles}
                    theme={theme}
                    onOpenLogin={xiaoyinsiAuth.onBegin}
                    onRefresh={onRefreshXiaoyinsiLevel}
                  />
                ) : null}
              </View>
            </>
          )
        }}
        statusBusy={statusBusy}
        styles={styles}
        theme={theme}
        onCommand={onAccountCenterCommand}
        onExpandedChange={setAccountExpanded}
      />
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
          <Text style={styles.meta}>
            日志只保存在本机并经过脱敏。显示问题请同时附截图；特定内容解析异常请附原帖链接。
          </Text>
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
        meta={appearanceSummary(settings)}
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
