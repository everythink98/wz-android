import { createContext, type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView } from 'react-native';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useIsFocused, useScrollToTop } from '@react-navigation/native';
import type { ReaderData, ReaderDataMutationReason } from '@/domain/reader/readerData';
import type {
  AccountCenterCommand,
  AccountCredentialFillAttempt,
  XiaoyinsiAuthPhase
} from '@/domain/session/accountCenter';
import {
  nodeSeekUserIdForSession,
  type SessionSite,
  type SiteSessionViewModels
} from '@/domain/session/siteSessionState';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import type { Screen } from '@/ui/navigation/types';
import type { useAppUpdateRuntime } from '@/platform/update/useAppUpdateRuntime';
import type { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import type { LinuxDoLevelProfile } from '@/sources/readGateway';
import type { XiaoyinsiPendingAuthorization } from '@/sources/xiaoyinsi/auth';
import type { XiaoyinsiLevelProfile } from '@/sources/xiaoyinsi/account';
import type { CredentialSummaries } from './accountCenter';
import { MoreScreen } from './MoreScreen';
import { ReadingSettingsScreen } from './ReadingSettingsScreen';
import { useBackupStatusController } from './useBackupStatusController';
import { useDiagnosticLogController } from './useDiagnosticLogController';
import { useReaderSettingsController } from './useReaderSettingsController';

type MoreAccountRuntime = {
  read: {
    accountSessionViewModels: SiteSessionViewModels;
    statusBusy: boolean;
  };
  center: {
    account: {
      checkYaohuoCookie: () => unknown;
      clearLogin: () => unknown;
      clearYaohuoLogin: () => unknown;
      handleLoginMessage: (event: WebViewMessageEvent) => void;
      linuxDoLevelBusy: boolean;
      linuxDoLevelError: string;
      linuxDoLevelProfile: LinuxDoLevelProfile | null;
      recordNodeSeekLoginWebViewState: (
        state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout',
        attempt?: number
      ) => void;
      recordYaohuoLoginWebViewState: (
        state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout',
        attempt?: number
      ) => void;
      refreshLinuxDoLevel: () => unknown;
    };
    checking: boolean;
    checkIn: () => unknown;
    credentials: {
      credentialFillAttempt: AccountCredentialFillAttempt | null;
      credentialLoginSite: SessionSite | null;
      credentialSummaries: CredentialSummaries;
      handleCredentialLoginFormMessage: (event: WebViewMessageEvent) => boolean;
      pendingCredentialFillSite: SessionSite | null;
    };
    handleAccountCenterCommand: (command: AccountCenterCommand) => void | Promise<void>;
    nodeImage: {
      key: {
        authorize: () => unknown;
        busy: boolean;
        clear: () => unknown;
        save: (value: string) => unknown;
        saved: boolean;
      };
    };
    webLoginUserId: number | null;
    xiaoyinsiAuth: {
      beginAuthorization: () => unknown;
      cancelAuthorization: () => unknown;
      message: string;
      openAuthorizationBrowser: () => unknown;
      pending: XiaoyinsiPendingAuthorization | null;
      phase: XiaoyinsiAuthPhase;
      revokeAuthorization: () => unknown;
      secondsRemaining: number;
    };
    xiaoyinsiLevel: {
      levelBusy: boolean;
      levelError: string;
      levelProfile: XiaoyinsiLevelProfile | null;
      refreshLevel: () => unknown;
    };
  };
  hosts: {
    changeNodeSeekLoginPanel: (visible: boolean) => void;
    changeYaohuoLoginPanel: (visible: boolean) => void;
    checkNodeSeekLoginAndRetry: () => unknown;
    closePanels: () => void;
    loadingLoginPage: boolean;
    loadingYaohuoLoginPage: boolean;
    setLoadingLoginPage: (value: boolean) => void;
    setLoadingYaohuoLoginPage: (value: boolean) => void;
    showLinuxDoPanel: boolean;
    showLoginPanel: boolean;
    showYaohuoLoginPanel: boolean;
    webViewRef: RefObject<WebView | null>;
    yaohuoLoginPrompt: string;
    yaohuoWebViewRef: RefObject<WebView | null>;
  };
};

export type MoreRouteRuntimeValue = {
  account: MoreAccountRuntime;
  diagnostics: {
    getCurrentScreen: () => Screen;
    metadata: Parameters<typeof useDiagnosticLogController>[0]['metadata'];
  };
  loginNavigation: Record<'nodeseek' | 'yaohuo', (request: LoginNavigationRequest) => boolean>;
  notify: (message: string) => void;
  proxy: ReturnType<typeof useNetworkProxyRuntime>;
  reader: {
    commit: (reason: ReaderDataMutationReason, updater: (current: ReaderData) => ReaderData) => void;
    data: ReaderData;
    dataRef: { current: ReaderData };
    replace: (reason: ReaderDataMutationReason, value: ReaderData) => Promise<void>;
    waitForSave: () => Promise<void>;
  };
  update: ReturnType<typeof useAppUpdateRuntime>;
};

const MoreRouteRuntimeContext = createContext<MoreRouteRuntimeValue | null>(null);

export function MoreRouteRuntimeProvider({ children, value }: { children: ReactNode; value: MoreRouteRuntimeValue }) {
  return <MoreRouteRuntimeContext.Provider value={value}>{children}</MoreRouteRuntimeContext.Provider>;
}

function useMoreRouteRuntime() {
  const runtime = useContext(MoreRouteRuntimeContext);
  if (!runtime) throw new Error('MoreRouteRuntimeProvider is required');
  return runtime;
}

export function MoreRoute() {
  const runtime = useMoreRouteRuntime();
  const active = useIsFocused();
  const scrollRef = useRef<ScrollView | null>(null);
  const [showNetworkProxyPanel, setShowNetworkProxyPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  useScrollToTop(scrollRef);
  const { updateSettings } = useReaderSettingsController({ commitReaderData: runtime.reader.commit });
  const { backupBusy, exportBackupFile, importBackupFile } = useBackupStatusController({
    notify: runtime.notify,
    readerDataRef: runtime.reader.dataRef,
    replaceReaderData: runtime.reader.replace,
    waitForReaderDataSave: runtime.reader.waitForSave
  });
  const { diagnosticBusy, exportDiagnosticLogFile } = useDiagnosticLogController({
    getCurrentScreen: runtime.diagnostics.getCurrentScreen,
    metadata: runtime.diagnostics.metadata,
    notify: runtime.notify
  });
  const {
    account,
    checking,
    checkIn,
    credentials,
    handleAccountCenterCommand,
    nodeImage,
    webLoginUserId,
    xiaoyinsiAuth,
    xiaoyinsiLevel
  } = runtime.account.center;
  const hosts = runtime.account.hosts;
  const proxy = runtime.proxy;
  const update = runtime.update;
  const sessionViewModels = runtime.account.read.accountSessionViewModels;

  useEffect(() => {
    if (active) return;
    hosts.closePanels();
    setShowNetworkProxyPanel(false);
    setShowSettingsPanel(false);
  }, [active, hosts]);
  useEffect(() => {
    if (!active || !showSettingsPanel) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setShowSettingsPanel(false);
      return true;
    });
    return () => subscription.remove();
  }, [active, showSettingsPanel]);

  return (
    <MoreScreen
      checking={checking}
      appUpdateBusy={update.appUpdateBusy}
      appUpdateDownloading={update.appUpdateDownloading}
      appUpdateDownloadProgress={update.appUpdateDownloadProgress}
      appUpdateInfo={update.appUpdateInfo}
      appUpdateMessage={update.appUpdateMessage}
      credentialFillAttempt={credentials.credentialFillAttempt}
      credentialLoginSite={credentials.credentialLoginSite}
      credentialSummaries={credentials.credentialSummaries}
      loadingLoginPage={hosts.loadingLoginPage}
      loadingYaohuoLoginPage={hosts.loadingYaohuoLoginPage}
      linuxDoLevelBusy={account.linuxDoLevelBusy}
      linuxDoLevelError={account.linuxDoLevelError}
      linuxDoLevelProfile={account.linuxDoLevelProfile}
      xiaoyinsiLevelBusy={xiaoyinsiLevel.levelBusy}
      xiaoyinsiLevelError={xiaoyinsiLevel.levelError}
      xiaoyinsiLevelProfile={xiaoyinsiLevel.levelProfile}
      nodeImageApiKeyBusy={nodeImage.key.busy}
      nodeImageApiKeySaved={nodeImage.key.saved}
      nodeSeekUserId={nodeSeekUserIdForSession(sessionViewModels.nodeseek, webLoginUserId)}
      scrollRef={scrollRef}
      settings={runtime.reader.data.settings}
      showLoginPanel={hosts.showLoginPanel}
      showYaohuoLoginPanel={hosts.showYaohuoLoginPanel}
      showLinuxDoPanel={hosts.showLinuxDoPanel}
      showNetworkProxyPanel={showNetworkProxyPanel}
      showSettingsPanel={showSettingsPanel}
      statusBusy={runtime.account.read.statusBusy}
      backupBusy={backupBusy}
      diagnosticBusy={diagnosticBusy}
      webViewRef={hosts.webViewRef}
      pendingCredentialFillSite={credentials.pendingCredentialFillSite}
      yaohuoLoginPrompt={hosts.yaohuoLoginPrompt}
      yaohuoWebViewRef={hosts.yaohuoWebViewRef}
      sessionViewModels={sessionViewModels}
      networkProxyActiveProfile={proxy.activeProfile}
      networkProxyApplyError={proxy.applyError}
      networkProxyApplyStatus={proxy.applyStatus}
      networkProxyState={proxy.proxyState}
      networkProxySummary={proxy.summary}
      webViewBlockMessage={proxy.webViewBlockMessage}
      xiaoyinsiAuth={{
        message: xiaoyinsiAuth.message,
        pending: xiaoyinsiAuth.pending,
        phase: xiaoyinsiAuth.phase,
        secondsRemaining: xiaoyinsiAuth.secondsRemaining,
        onBegin: () => void xiaoyinsiAuth.beginAuthorization(),
        onCancel: () => void xiaoyinsiAuth.cancelAuthorization(),
        onOpenBrowser: () => void xiaoyinsiAuth.openAuthorizationBrowser(),
        onRevoke: () => void xiaoyinsiAuth.revokeAuthorization()
      }}
      onAccountCenterCommand={handleAccountCenterCommand}
      onCheckAppUpdate={update.checkAppUpdate}
      onDownloadAppUpdate={update.downloadAppUpdate}
      onCheckIn={checkIn}
      onCheckLogin={() => void hosts.checkNodeSeekLoginAndRetry()}
      onAuthorizeNodeImageApiKey={() => void nodeImage.key.authorize()}
      onSaveNodeImageApiKey={(value) => void nodeImage.key.save(value)}
      onClearNodeImageApiKey={() => void nodeImage.key.clear()}
      onCheckYaohuoLogin={() => void account.checkYaohuoCookie()}
      onRefreshLinuxDoLevel={() => void account.refreshLinuxDoLevel()}
      onRefreshXiaoyinsiLevel={() => void xiaoyinsiLevel.refreshLevel()}
      onClearLogin={() => void account.clearLogin()}
      onClearYaohuoLogin={() => void account.clearYaohuoLogin()}
      handleNodeSeekLoginNavigation={runtime.loginNavigation.nodeseek}
      handleYaohuoLoginNavigation={runtime.loginNavigation.yaohuo}
      onHandleLoginMessage={account.handleLoginMessage}
      onNodeSeekLoginWebViewState={account.recordNodeSeekLoginWebViewState}
      onYaohuoLoginWebViewState={account.recordYaohuoLoginWebViewState}
      onExportBackupFile={exportBackupFile}
      onExportDiagnosticLog={exportDiagnosticLogFile}
      onImportBackupFile={importBackupFile}
      onSetLoadingLoginPage={hosts.setLoadingLoginPage}
      onSetLoadingYaohuoLoginPage={hosts.setLoadingYaohuoLoginPage}
      onShowLoginPanelChange={hosts.changeNodeSeekLoginPanel}
      onShowYaohuoLoginPanelChange={hosts.changeYaohuoLoginPanel}
      onLoginFormMessage={credentials.handleCredentialLoginFormMessage}
      onShowNetworkProxyPanelChange={setShowNetworkProxyPanel}
      onShowSettingsPanelChange={setShowSettingsPanel}
      onDeleteNetworkProxyProfile={proxy.deleteProxyProfile}
      onSelectNetworkProxyProfile={proxy.selectProxyProfile}
      onSetNetworkProxyEnabled={proxy.setProxyEnabled}
      onTestNetworkProxyProfile={proxy.testProxyProfile}
      onUpsertNetworkProxyProfile={proxy.upsertProxyProfile}
      onUpdateSettings={updateSettings}
    />
  );
}

export function ReadingSettingsRoute() {
  const runtime = useMoreRouteRuntime();
  const { updateSettings } = useReaderSettingsController({ commitReaderData: runtime.reader.commit });
  return <ReadingSettingsScreen settings={runtime.reader.data.settings} onUpdateSettings={updateSettings} />;
}
