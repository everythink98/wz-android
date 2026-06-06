import { memo, type RefObject, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Activity, DatabaseBackup, LogIn, Settings } from 'lucide-react-native';
import type { ReaderSettings } from '../readerData';
import type { LinuxDoLevelProfile } from '../linuxdoLevel';
import type { HealthDetail, LoginNavigationRequest } from '../appTypes';
import type { SiteSessionViewModels } from '../siteSessionState';
import { createStyles, type ReaderTheme } from '../theme';
import { ExpandablePanel, InfoRow, MenuButton } from '../components/AppControls';
import {
  MemoizedAppearancePanel,
  MemoizedBackupRestorePanel,
  MemoizedLinuxDoVerifyPanel,
  MemoizedNodeSeekLoginPanel,
  MemoizedStatusCheckPanel,
  MemoizedYaohuoLoginPanel,
  LinuxDoLevelPanel
} from './more/MorePanels';
function MoreScreen({
  checking,
  healthDetails,
  healthSummary,
  loginState,
  loadingLoginPage,
  loadingYaohuoLoginPage,
  linuxDoLevelBusy,
  linuxDoLevelError,
  linuxDoLevelProfile,
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
  yaohuoLoginState,
  yaohuoWebViewRef,
  sessionViewModels,
  onCheckHealth,
  onCheckIn,
  onCheckLogin,
  onRememberNodeSeekCookies,
  onCheckYaohuoLogin,
  onRefreshLinuxDoLevel,
  onClearLogin,
  onClearYaohuoLogin,
  handleNodeSeekLoginNavigation,
  handleYaohuoLoginNavigation,
  onHandleLoginMessage,
  onImportBackup,
  onExportBackup,
  onExportBackupFile,
  onImportBackupFile,
  onBackupJsonChange,
  onSetLoadingLoginPage,
  onSetLoadingYaohuoLoginPage,
  onShowLoginPanelChange,
  onShowYaohuoLoginPanelChange,
  onShowLinuxDoPanelChange,
  onShowSettingsPanelChange,
  onUpdateSettings
}: {
  checking: boolean;
  healthDetails: HealthDetail[];
  healthSummary: string;
  loginState: string;
  loadingLoginPage: boolean;
  loadingYaohuoLoginPage: boolean;
  linuxDoLevelBusy: boolean;
  linuxDoLevelError: string;
  linuxDoLevelProfile: LinuxDoLevelProfile | null;
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
  yaohuoLoginState: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  sessionViewModels: SiteSessionViewModels;
  onCheckHealth: () => void;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onRememberNodeSeekCookies: (options?: { silent?: boolean }) => Promise<boolean>;
  onCheckYaohuoLogin: () => void;
  onRefreshLinuxDoLevel: () => void;
  onClearLogin: () => void;
  onClearYaohuoLogin: () => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onExportBackupFile: () => void;
  onImportBackupFile: () => void;
  onBackupJsonChange: (value: string) => void;
  onSetLoadingLoginPage: (value: boolean) => void;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
  onShowSettingsPanelChange: (value: boolean) => void;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const [backupExpanded, setBackupExpanded] = useState(false);
  const [accountExpanded, setAccountExpanded] = useState(false);
  const [levelExpanded, setLevelExpanded] = useState(false);
  const [statusExpanded, setStatusExpanded] = useState(false);
  const nodeSeekSession = sessionViewModels.nodeseek;
  const linuxDoSession = sessionViewModels.linuxdo;
  const yaohuoSession = sessionViewModels.yaohuo;
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
        <InfoRow icon={Activity} label="关于" value="Android 本机阅读器" styles={styles} theme={theme} />
      </View>
      <ExpandablePanel
        quiet
        title="账号与验证"
        meta={`NodeSeek ${nodeSeekSession.statusLabel} · 妖火 ${yaohuoSession.statusLabel} · linux.do ${linuxDoSession.summaryLabel}`}
        icon={LogIn}
        expanded={accountExpanded}
        styles={styles}
        theme={theme}
        onExpandedChange={setAccountExpanded}
      >
        <MemoizedNodeSeekLoginPanel
          checking={checking}
          nodeSeekSession={nodeSeekSession}
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
          yaohuoSession={yaohuoSession}
          accountExpanded={accountExpanded}
          loadingYaohuoLoginPage={loadingYaohuoLoginPage}
          showYaohuoLoginPanel={showYaohuoLoginPanel}
          styles={styles}
          theme={theme}
          yaohuoLoginState={yaohuoLoginState}
          yaohuoWebViewRef={yaohuoWebViewRef}
          onCheckYaohuoLogin={onCheckYaohuoLogin}
          onClearYaohuoLogin={onClearYaohuoLogin}
          handleYaohuoLoginNavigation={handleYaohuoLoginNavigation}
          onSetLoadingYaohuoLoginPage={onSetLoadingYaohuoLoginPage}
          onShowYaohuoLoginPanelChange={onShowYaohuoLoginPanelChange}
        />
        <MemoizedLinuxDoVerifyPanel
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

export const MemoizedMoreScreen = memo(MoreScreen);
