import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import {
  type NavigationProp,
  type RouteProp,
  useFocusEffect,
  useIsFocused,
  useNavigation,
  useRoute,
  useScrollToTop
} from '@react-navigation/native';

import { MoreScreen } from './MoreScreen';

import { ReadingSettingsScreen } from './ReadingSettingsScreen';
import { useBackupStatusController } from './useBackupStatusController';
import { useDiagnosticLogController } from './useDiagnosticLogController';
import { useReaderSettingsController } from './useReaderSettingsController';
import { useCloseOnBack } from './useCloseOnBack';

import type { MainTabParamList } from '@/ui/navigation/appRouteTypes';
import type { LibraryTab } from '@/domain/forum/feed';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { useMoreRouteRuntime } from './MoreRouteRuntime';

export { MoreRouteRuntimeProvider, type MoreRouteRuntimeValue } from './MoreRouteRuntime';

export function MoreRoute() {
  const runtime = useMoreRouteRuntime();
  const active = useIsFocused();
  const navigation = useNavigation<NavigationProp<MainTabParamList, 'more'>>();
  const route = useRoute<RouteProp<MainTabParamList, 'more'>>();
  const scrollRef = useRef<ScrollView | null>(null);
  const [contentSourcesExpanded, setContentSourcesExpanded] = useState(false);
  const [showNetworkProxyPanel, setShowNetworkProxyPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  useScrollToTop(scrollRef);
  const { updateSettings } = useReaderSettingsController({ commitReaderData: runtime.reader.commit });
  const { backupOperation, exportBackupFile, importBackupFile } = useBackupStatusController({
    notify: runtime.notify,
    importBackup: runtime.reader.importBackup,
    exportBackup: runtime.reader.exportBackup
  });
  const { diagnosticBusy, exportDiagnosticLogFile } = useDiagnosticLogController({
    getCurrentScreen: runtime.diagnostics.getCurrentScreen,
    metadata: runtime.diagnostics.metadata,
    notify: runtime.notify
  });
  const proxy = runtime.proxy;
  const update = runtime.update;
  const closeAccountSurfaces = useLatestCallback(runtime.account.surfaces.closeAll);

  useEffect(() => {
    if (!active || route.params?.intent !== 'manage-content-sources') return;
    setContentSourcesExpanded(true);
    // The tab router applies nested params after this commit, so a synchronous clear is overwritten.
    const frame = requestAnimationFrame(() => navigation.replaceParams({}));
    return () => cancelAnimationFrame(frame);
  }, [active, navigation, route.params?.intent]);
  useFocusEffect(
    useCallback(
      () => () => {
        closeAccountSurfaces();
        setShowNetworkProxyPanel(false);
      },
      [closeAccountSurfaces]
    )
  );
  useCloseOnBack(active && showSettingsPanel, setShowSettingsPanel);

  const whenFocused = useCallback(
    <Args extends unknown[], Result>(operation: (...args: Args) => Result) =>
      (...args: Args) => {
        if (navigation.isFocused()) return operation(...args);
      },
    [navigation]
  );
  const account = useMemo<typeof runtime.account>(() => {
    const { center } = runtime.account;
    return {
      ...runtime.account,
      active: active && runtime.account.active,
      center: {
        ...center,
        openCredits: whenFocused(center.openCredits),
        openLinuxDoCredit: whenFocused(center.openLinuxDoCredit),
        command: whenFocused(center.command),
        nodeImageKey: {
          ...center.nodeImageKey,
          authorize: whenFocused(center.nodeImageKey.authorize),
          clear: whenFocused(center.nodeImageKey.clear),
          save: whenFocused(center.nodeImageKey.save)
        },
        nodeSeek: {
          ...center.nodeSeek,
          checkIn: whenFocused(center.nodeSeek.checkIn)
        }
      }
    };
  }, [active, runtime.account, whenFocused]);
  const utilities = useMemo(
    () => ({
      library: {
        open: (tab?: LibraryTab) => {
          if (navigation.isFocused()) runtime.library.open(tab);
        }
      },
      backup: {
        recovery: runtime.reader.status === 'recovery',
        operation: backupOperation,
        exportFile: whenFocused(exportBackupFile),
        importFile: whenFocused(importBackupFile)
      },
      diagnostics: {
        busy: diagnosticBusy,
        exportLog: whenFocused(exportDiagnosticLogFile)
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
    }),
    [
      runtime.library,
      navigation,
      runtime.reader.status,
      runtime.reader.data.settings,
      backupOperation,
      exportBackupFile,
      importBackupFile,
      diagnosticBusy,
      exportDiagnosticLogFile,
      proxy,
      showNetworkProxyPanel,
      showSettingsPanel,
      updateSettings,
      whenFocused
    ]
  );

  return (
    <MoreScreen
      account={account}
      contentSourcesExpanded={contentSourcesExpanded}
      scrollRef={scrollRef}
      update={{
        phase: update.phase,
        artifact: update.artifact,
        restoreFailed: update.restoreFailed,
        progress: update.appUpdateDownloadProgress,
        info: update.appUpdateInfo,
        message: update.appUpdateMessage,
        check: update.checkAppUpdate,
        start: update.startAppUpdateDownload,
        pause: update.pauseAppUpdateDownload,
        resume: update.resumeAppUpdateDownload,
        install: whenFocused(update.installAppUpdate)
      }}
      utilities={utilities}
      onContentSourcesExpandedChange={setContentSourcesExpanded}
    />
  );
}

export function ReadingSettingsRoute() {
  const runtime = useMoreRouteRuntime();
  const { updateSettings } = useReaderSettingsController({ commitReaderData: runtime.reader.commit });
  return <ReadingSettingsScreen settings={runtime.reader.data.settings} onUpdateSettings={updateSettings} />;
}
