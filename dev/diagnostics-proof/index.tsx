import '@/platform/diagnostics/diagnosticBootstrap';
import { registerRootComponent } from 'expo';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { diagnosticBuildContext, nativeDiagnosticJournal } from '@/platform/diagnostics/nativeDiagnosticJournal';
import { beginDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

// This entry is selected only by the isolated proof runner's temporary Gradle overlay.
function diagnosticProofJsFault(trace: DiagnosticTrace) {
  markDiagnosticStage(trace, 'apply', { state: 'applying' });
  throw new Error('PRIVATE_TEST_PAYLOAD');
}

function DiagnosticProofRenderer({ trace }: { trace: DiagnosticTrace }): never {
  markDiagnosticStage(trace, 'apply', { state: 'applying' });
  throw new Error('PRIVATE_TEST_PAYLOAD');
}

function diagnosticProofPromiseFault(trace: DiagnosticTrace) {
  markDiagnosticStage(trace, 'apply', { state: 'applying' });
  void Promise.reject(new Error('PRIVATE_TEST_PAYLOAD'));
}

function DiagnosticProofApp() {
  const [rendererFault, setRendererFault] = useState<DiagnosticTrace | null>(null);
  const [status, setStatus] = useState('Diagnostic proof ready');
  useEffect(() => {
    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = async () => {
      const url = await Linking.getInitialURL();
      const match = /^wzdiag:\/\/(js|renderer|promise|export)\/([a-f0-9]{32})$/.exec(url || '');
      if (!match || canceled) return;
      const [, mode, proofToken] = match;
      const pendingTrace = beginDiagnosticTrace('app', 'startup', { state: 'started' });
      const writeSnapshot = async (checkpoint: 'ready' | 'settled') => {
        const native = nativeDiagnosticJournal();
        if (!native?.snapshot) throw new Error('Diagnostic snapshot unavailable');
        const snapshot = await native.snapshot();
        if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid diagnostic snapshot');
        const file = new File(Paths.cache, 'diagnostic-proof.json');
        file.create({ overwrite: true });
        file.write(
          JSON.stringify({
            ...snapshot,
            ...diagnosticBuildContext(),
            pendingTraceId: pendingTrace.traceId,
            appSessionId: pendingTrace.appSessionId,
            mode,
            proofToken,
            checkpoint,
            isDev: __DEV__,
            isHermes: 'HermesInternal' in globalThis
          })
        );
        setStatus(`Diagnostic proof ${mode}: ${checkpoint}`);
      };
      if (mode === 'export') markDiagnosticStage(pendingTrace, 'apply', { state: 'applying' });
      await writeSnapshot('ready');
      if (mode === 'export' || canceled) return;
      timer = setTimeout(() => {
        if (mode === 'js') diagnosticProofJsFault(pendingTrace);
        if (mode === 'renderer') setRendererFault(pendingTrace);
        if (mode === 'promise') {
          diagnosticProofPromiseFault(pendingTrace);
          timer = setTimeout(() => {
            void writeSnapshot('settled');
          }, 3000); // Hermes gives ordinary Error rejections 2 seconds to acquire a handler.
        }
      }, 750);
    };
    void start().catch(() => setStatus('Diagnostic proof setup failed'));
    return () => {
      canceled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <View>
      <Text>{status}</Text>
      {rendererFault ? <DiagnosticProofRenderer trace={rendererFault} /> : null}
    </View>
  );
}

registerRootComponent(DiagnosticProofApp);
