import { createContext, useContext, type ReactNode } from 'react';
import type { ReaderState, ReaderCommand } from '@/domain/reader/readerRecordState';
import type { Screen } from '@/ui/navigation/types';
import type { useAppUpdateRuntime } from '@/platform/update/useAppUpdateRuntime';
import type { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import type { MoreUtilityCapabilities } from './components/MoreUtilityPanels';
import type { useDiagnosticLogController } from './useDiagnosticLogController';
import type { MoreAccountCapabilities } from './components/MoreAccountPanel';

export type MoreRouteRuntimeValue = {
  account: MoreAccountCapabilities;
  diagnostics: {
    getCurrentScreen: () => Screen;
    metadata: Parameters<typeof useDiagnosticLogController>[0]['metadata'];
  };
  notify: (message: string) => void;
  notifications: MoreUtilityCapabilities['notifications'];
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
    commit: (command: ReaderCommand) => void;
    data: ReaderState;
    dataRef: { current: ReaderState };
    importBackup: (json: string) => Promise<void>;
    exportBackup: () => Promise<string>;
  };
  update: ReturnType<typeof useAppUpdateRuntime>;
};

const MoreRouteRuntimeContext = createContext<MoreRouteRuntimeValue | null>(null);

export function MoreRouteRuntimeProvider({ children, value }: { children: ReactNode; value: MoreRouteRuntimeValue }) {
  return <MoreRouteRuntimeContext.Provider value={value}>{children}</MoreRouteRuntimeContext.Provider>;
}

export function useMoreRouteRuntime() {
  const runtime = useContext(MoreRouteRuntimeContext);
  if (!runtime) throw new Error('MoreRouteRuntimeProvider is required');
  return runtime;
}
