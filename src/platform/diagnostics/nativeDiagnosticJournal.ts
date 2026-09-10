import { NativeModules } from 'react-native';
import appConfig from '../../../app.json';

type NativeDiagnosticModule = {
  buildId?: unknown;
  processSessionId?: unknown;
  appendBatch?: (lines: string) => Promise<void>;
  persistCrashSync?: (lines: string) => boolean;
  snapshot?: () => Promise<unknown>;
  recordStartupPhase?: (phase: string) => void;
};

export function nativeDiagnosticJournal(): NativeDiagnosticModule | undefined {
  return NativeModules.DiagnosticsModule as NativeDiagnosticModule | undefined;
}

export function diagnosticBuildContext() {
  const module = nativeDiagnosticJournal();
  return {
    appVersion: appConfig.expo.version,
    versionCode: appConfig.expo.android.versionCode,
    ...(typeof module?.buildId === 'string' && /^[a-f0-9]{32}$/.test(module.buildId)
      ? { buildId: module.buildId }
      : {}),
    ...(typeof module?.processSessionId === 'string' && /^process-[a-f0-9]{32}$/.test(module.processSessionId)
      ? { processSessionId: module.processSessionId }
      : {})
  };
}

export type DiagnosticJournalSnapshot = {
  status: 'available' | 'unavailable' | 'failed' | 'timeout';
  jsLines: string;
  nativeLines: string;
  crashLines: string;
  health: Record<string, number | boolean>;
};

export async function readDiagnosticJournal(): Promise<DiagnosticJournalSnapshot> {
  const empty = { jsLines: '', nativeLines: '', crashLines: '', health: {} };
  const module = nativeDiagnosticJournal();
  if (!module?.snapshot) return { ...empty, status: 'unavailable' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      module.snapshot(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 5_000);
      })
    ]);
    if (result === null) return { ...empty, status: 'timeout' };
    if (!result || typeof result !== 'object') return { ...empty, status: 'failed' };
    const raw = result as Record<string, unknown>;
    const health: Record<string, number | boolean> = {};
    const counts = [
      'droppedCount',
      'rotationCount',
      'expiredSegmentCount',
      'writeFailureCount',
      'readFailureCount'
    ] as const;
    const source = raw.health && typeof raw.health === 'object' ? (raw.health as Record<string, unknown>) : {};
    health.available = source.available === true;
    for (const key of ['queueDroppedCount', 'crashWriteFailureCount', 'crashReadFailureCount']) {
      const value = source[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) health[key] = value;
    }
    for (const channel of ['js', 'native']) {
      const values = source[channel];
      if (!values || typeof values !== 'object') continue;
      for (const key of counts) {
        const value = (values as Record<string, unknown>)[key];
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
          health[`${channel}${key[0].toUpperCase()}${key.slice(1)}`] = value;
      }
    }
    return {
      status: source.available === true ? 'available' : 'failed',
      jsLines: typeof raw.jsLines === 'string' ? raw.jsLines : '',
      nativeLines: typeof raw.nativeLines === 'string' ? raw.nativeLines : '',
      crashLines: typeof raw.crashLines === 'string' ? raw.crashLines : '',
      health
    };
  } catch {
    return { ...empty, status: 'failed' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
