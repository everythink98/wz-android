import { createContext, type ComponentProps, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView } from 'react-native';
import { useIsFocused, useScrollToTop } from '@react-navigation/native';
import type { ReaderData, ReaderDataMutationReason } from '@/domain/reader/readerData';
import type { Screen } from '@/ui/navigation/types';
import { MoreScreen, ReadingSettingsScreen } from './MoreScreen';
import { useBackupStatusController } from './useBackupStatusController';
import { useDiagnosticLogController } from './useDiagnosticLogController';
import { useReaderSettingsController } from './useReaderSettingsController';

type RouteLocalMoreProp =
  | 'scrollRef'
  | 'backupBusy'
  | 'diagnosticBusy'
  | 'showNetworkProxyPanel'
  | 'showSettingsPanel'
  | 'onExportBackupFile'
  | 'onExportDiagnosticLog'
  | 'onImportBackupFile'
  | 'onShowNetworkProxyPanelChange'
  | 'onShowSettingsPanelChange'
  | 'onUpdateSettings';

export type MoreRouteRuntimeValue = {
  closeAccountPanels: () => void;
  diagnostics: {
    getCurrentScreen: () => Screen;
    metadata: Parameters<typeof useDiagnosticLogController>[0]['metadata'];
  };
  notify: (message: string) => void;
  reader: {
    commit: (reason: ReaderDataMutationReason, updater: (current: ReaderData) => ReaderData) => void;
    dataRef: { current: ReaderData };
    replace: (reason: ReaderDataMutationReason, value: ReaderData) => Promise<void>;
    waitForSave: () => Promise<void>;
  };
  screen: Omit<ComponentProps<typeof MoreScreen>, RouteLocalMoreProp>;
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
  const { closeAccountPanels } = runtime;
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

  useEffect(() => {
    if (active) return;
    closeAccountPanels();
    setShowNetworkProxyPanel(false);
    setShowSettingsPanel(false);
  }, [active, closeAccountPanels]);
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
      {...runtime.screen}
      backupBusy={backupBusy}
      diagnosticBusy={diagnosticBusy}
      scrollRef={scrollRef}
      showNetworkProxyPanel={showNetworkProxyPanel}
      showSettingsPanel={showSettingsPanel}
      onExportBackupFile={exportBackupFile}
      onExportDiagnosticLog={exportDiagnosticLogFile}
      onImportBackupFile={importBackupFile}
      onShowNetworkProxyPanelChange={setShowNetworkProxyPanel}
      onShowSettingsPanelChange={setShowSettingsPanel}
      onUpdateSettings={updateSettings}
    />
  );
}

export function ReadingSettingsRoute() {
  const runtime = useMoreRouteRuntime();
  const { updateSettings } = useReaderSettingsController({ commitReaderData: runtime.reader.commit });
  return <ReadingSettingsScreen settings={runtime.screen.settings} onUpdateSettings={updateSettings} />;
}
