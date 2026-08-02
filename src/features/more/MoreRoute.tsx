import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView } from 'react-native';
import { useIsFocused, useScrollToTop } from '@react-navigation/native';
import type { ReaderData, ReaderDataMutationReason } from '@/domain/reader/readerData';
import type { Screen } from '@/ui/navigation/types';
import type { useAppUpdateRuntime } from '@/platform/update/useAppUpdateRuntime';
import type { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import { MoreScreen } from './MoreScreen';
import { ReadingSettingsScreen } from './ReadingSettingsScreen';
import { useBackupStatusController } from './useBackupStatusController';
import { useDiagnosticLogController } from './useDiagnosticLogController';
import { useReaderSettingsController } from './useReaderSettingsController';
import type { MoreAccountCapabilities } from './components/MoreAccountPanel';

export type MoreRouteRuntimeValue = {
  account: MoreAccountCapabilities;
  diagnostics: {
    getCurrentScreen: () => Screen;
    metadata: Parameters<typeof useDiagnosticLogController>[0]['metadata'];
  };
  notify: (message: string) => void;
  proxy: Pick<
    ReturnType<typeof useNetworkProxyRuntime>,
    | 'activeProfile'
    | 'applyError'
    | 'applyStatus'
    | 'deleteProxyProfile'
    | 'proxyState'
    | 'selectProxyProfile'
    | 'setProxyEnabled'
    | 'summary'
    | 'testProxyProfile'
    | 'upsertProxyProfile'
  >;
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
  const proxy = runtime.proxy;
  const update = runtime.update;
  const closeAccountSurfaces = runtime.account.surfaces.closeAll;

  useEffect(() => {
    if (active) return;
    closeAccountSurfaces();
    setShowNetworkProxyPanel(false);
    setShowSettingsPanel(false);
  }, [active, closeAccountSurfaces]);
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
      account={runtime.account}
      scrollRef={scrollRef}
      update={{
        busy: update.appUpdateBusy,
        downloading: update.appUpdateDownloading,
        progress: update.appUpdateDownloadProgress,
        info: update.appUpdateInfo,
        message: update.appUpdateMessage,
        check: update.checkAppUpdate,
        download: update.downloadAppUpdate
      }}
      utilities={{
        backup: {
          busy: backupBusy,
          exportFile: exportBackupFile,
          importFile: importBackupFile
        },
        diagnostics: {
          busy: diagnosticBusy,
          exportLog: exportDiagnosticLogFile
        },
        proxy: {
          activeProfile: proxy.activeProfile,
          applyError: proxy.applyError,
          applyStatus: proxy.applyStatus,
          state: proxy.proxyState,
          summary: proxy.summary,
          visible: showNetworkProxyPanel,
          close: () => setShowNetworkProxyPanel(false),
          open: () => setShowNetworkProxyPanel(true),
          deleteProfile: proxy.deleteProxyProfile,
          selectProfile: proxy.selectProxyProfile,
          setEnabled: proxy.setProxyEnabled,
          testProfile: proxy.testProxyProfile,
          upsertProfile: proxy.upsertProxyProfile
        },
        settings: {
          value: runtime.reader.data.settings,
          visible: showSettingsPanel,
          changeVisible: setShowSettingsPanel,
          update: updateSettings
        }
      }}
    />
  );
}

export function ReadingSettingsRoute() {
  const runtime = useMoreRouteRuntime();
  const { updateSettings } = useReaderSettingsController({ commitReaderData: runtime.reader.commit });
  return <ReadingSettingsScreen settings={runtime.reader.data.settings} onUpdateSettings={updateSettings} />;
}
