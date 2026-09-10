import { File, Paths } from 'expo-file-system';
import { safeFileName } from '@/platform/storage/backupFiles';
import { beginDiagnosticTrace, finishDiagnosticTrace, setDiagnosticWriter } from './diagnostics';
import {
  normalizeNativeReadNetworkDiagnosticEvents,
  readNativeReadNetworkDiagnosticLines
} from './nativeReadNetworkDiagnostics';
import { diagnosticBuildContext, nativeDiagnosticJournal, readDiagnosticJournal } from './nativeDiagnosticJournal';
import { installDiagnosticExceptionHandlers } from './diagnosticRuntime';

const MAX_LOG_BYTES = 1024 * 1024;
const CURRENT_LOG_NAME = 'forum-reader-diagnostic-current.jsonl';
const PREVIOUS_LOG_NAME = 'forum-reader-diagnostic-previous.jsonl';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_PENDING_BYTES = 128 * 1024;

export type DiagnosticSessionStatus =
  | 'anonymous'
  | 'verified'
  | 'logged-in'
  | 'verification-required'
  | 'verifying'
  | 'authorizing'
  | 'expired'
  | 'unknown';

export type DiagnosticExportMetadata = {
  androidApiLevel?: number;
  appVersion: string;
  currentScreen?: 'feed' | 'search' | 'library' | 'more' | 'topic' | 'user';
  deviceModel?: string;
  expoVersion?: string;
  fontScale?: number;
  linuxDoSession?: DiagnosticSessionStatus;
  nodeSeekSession?: DiagnosticSessionStatus;
  proxyEnabled?: boolean;
  reactNativeVersion?: string;
  screenHeight?: number;
  screenWidth?: number;
  theme?: 'light' | 'dark';
  versionCode: number;
  yaohuoSession?: DiagnosticSessionStatus;
};

let writerInstalled = false;
let flushScheduled = false;
let pendingLogLines: Uint8Array[] = [];
let pendingBytes = 0;
let nativeWrites: Promise<void> = Promise.resolve();
let nativeWriting = false;
let inFlightNativeLines = '';
let queuedNativeBytes = 0;
let droppedCount = 0;
let writeFailureCount = 0;
let rotationCount = 0;
let activeLogHandle: {
  handle: {
    close: () => void;
    offset: number | null;
    writeBytes: (bytes: Uint8Array) => void;
  };
  uri: string;
} | null = null;

function logFile(name: string) {
  return new File(Paths.cache, name);
}

function closeActiveLogHandle() {
  const active = activeLogHandle;
  activeLogHandle = null;
  if (!active) {
    return;
  }
  try {
    active.handle.close();
  } catch {
    // Closing diagnostics must never change app behavior.
  }
}

function rotateIfNeeded(incomingBytes: number) {
  const current = logFile(CURRENT_LOG_NAME);
  if (!current.exists || current.size + incomingBytes <= MAX_LOG_BYTES) {
    return current;
  }
  closeActiveLogHandle();
  const previous = logFile(PREVIOUS_LOG_NAME);
  if (previous.exists) {
    previous.delete();
  }
  current.moveSync(previous);
  rotationCount += 1;
  return logFile(CURRENT_LOG_NAME);
}

function writeDiagnosticLogBytes(bytes: Uint8Array) {
  const current = rotateIfNeeded(bytes.byteLength);
  if (!current.exists) {
    closeActiveLogHandle();
    current.create();
  }
  if (!activeLogHandle || activeLogHandle.uri !== current.uri) {
    closeActiveLogHandle();
    const handle = current.open();
    handle.offset = current.size;
    activeLogHandle = { handle, uri: current.uri };
  }
  activeLogHandle.handle.writeBytes(bytes);
}

function joinedBytes(chunks: Uint8Array[], byteLength: number) {
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

async function appendNativeBatch(append: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      append(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('diagnostic write timeout')), 5_000);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function flushPendingDiagnosticLines() {
  flushScheduled = false;
  if (nativeWriting) return;
  const pending = pendingLogLines;
  pendingLogLines = [];
  pendingBytes = 0;
  const native = nativeDiagnosticJournal();
  if (native?.appendBatch && pending.length) {
    const lines = decoder.decode(
      joinedBytes(
        pending,
        pending.reduce((sum, bytes) => sum + bytes.byteLength, 0)
      )
    );
    const byteCount = pending.reduce((sum, bytes) => sum + bytes.byteLength, 0);
    queuedNativeBytes += byteCount;
    nativeWriting = true;
    inFlightNativeLines = lines;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      writeFailureCount += 1;
    }, 5_000);
    // A watchdog cannot cancel the bridge call; only its real settlement releases this slot.
    nativeWrites = Promise.resolve()
      .then(() => native.appendBatch!(lines))
      .catch(() => {
        if (!timedOut) writeFailureCount += 1;
        droppedCount += pending.length;
      })
      .finally(() => {
        clearTimeout(timeout);
        queuedNativeBytes -= byteCount;
        nativeWriting = false;
        inFlightNativeLines = '';
        if (pendingLogLines.length) flushPendingDiagnosticLines();
      });
    return;
  }
  try {
    let batch: Uint8Array[] = [];
    let batchBytes = 0;
    const writeBatch = () => {
      if (!batchBytes) {
        return;
      }
      writeDiagnosticLogBytes(joinedBytes(batch, batchBytes));
      batch = [];
      batchBytes = 0;
    };
    for (const bytes of pending) {
      if (bytes.byteLength > MAX_LOG_BYTES) {
        continue;
      }
      if (batchBytes + bytes.byteLength > MAX_LOG_BYTES) {
        writeBatch();
      }
      batch.push(bytes);
      batchBytes += bytes.byteLength;
    }
    writeBatch();
  } catch {
    writeFailureCount += 1;
    droppedCount += pending.length;
    closeActiveLogHandle();
    // A failed batch is dropped so logging cannot create retry pressure on the app.
  }
}

function scheduleDiagnosticFlush() {
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(flushPendingDiagnosticLines);
  } else {
    setTimeout(flushPendingDiagnosticLines, 0);
  }
}

export function appendDiagnosticLogLine(line: string) {
  try {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.schemaVersion === 1 && typeof event.traceId === 'string') {
        line = `${JSON.stringify({ ...event, ...diagnosticBuildContext() })}\n`;
        if (event.isFatal === true) {
          try {
            const lastStages = inFlightNativeLines + decoder.decode(joinedBytes(pendingLogLines, pendingBytes));
            if (nativeDiagnosticJournal()?.persistCrashSync?.(lastStages + line) === false) writeFailureCount += 1;
          } catch {
            writeFailureCount += 1;
          }
        }
      }
    } catch {
      /* Compatibility writer callers may provide a damaged legacy line. */
    }
    const bytes = encoder.encode(line.endsWith('\n') ? line : `${line}\n`);
    // Keep the JS->Native queue bounded even while native storage is unavailable.
    const limit = nativeDiagnosticJournal()?.appendBatch ? MAX_PENDING_BYTES : 3 * MAX_LOG_BYTES;
    if (bytes.byteLength + pendingBytes + queuedNativeBytes > limit) {
      droppedCount += 1;
      return;
    }
    pendingLogLines.push(bytes);
    pendingBytes += bytes.byteLength;
    scheduleDiagnosticFlush();
  } catch {
    // Diagnostic persistence must never change app behavior.
  }
}

function safeLabel(value: string | undefined, fallback = 'unknown') {
  const raw = String(value || '').trim();
  if (/[\\/?=&:#]|cookie|token|password|secret|authorization|session|csrf|sid/i.test(raw)) {
    return fallback;
  }
  const clean = raw
    .replace(/[^A-Za-z0-9 ._()+-]/g, '')
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

function safeInteger(value: number | undefined, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Math.min(Number(value), maximum) : 0;
}

function safeDimension(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.min(Math.round(Number(value)), 100_000) : 0;
}

function safeFontScale(value: number | undefined) {
  return Number.isFinite(value) && Number(value) >= 0.5 && Number(value) <= 3 ? Number(value) : 1;
}

function safeSessionStatus(value: DiagnosticSessionStatus | undefined): DiagnosticSessionStatus {
  return value === 'anonymous' ||
    value === 'verified' ||
    value === 'logged-in' ||
    value === 'verification-required' ||
    value === 'verifying' ||
    value === 'authorizing' ||
    value === 'expired'
    ? value
    : 'unknown';
}

function safeScreen(value: DiagnosticExportMetadata['currentScreen']) {
  return value === 'feed' ||
    value === 'search' ||
    value === 'library' ||
    value === 'more' ||
    value === 'topic' ||
    value === 'user'
    ? value
    : 'unknown';
}

function metadataLine(metadata: DiagnosticExportMetadata) {
  const { buildId, processSessionId } = diagnosticBuildContext();
  return JSON.stringify({
    type: 'diagnostic-metadata',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(buildId ? { buildId } : {}),
    ...(processSessionId ? { processSessionId } : {}),
    platform: 'android',
    appVersion: safeLabel(metadata.appVersion),
    versionCode: safeInteger(metadata.versionCode, 1_000_000_000),
    androidApiLevel: safeInteger(metadata.androidApiLevel, 999),
    deviceModel: safeLabel(metadata.deviceModel),
    reactNativeVersion: safeLabel(metadata.reactNativeVersion),
    expoVersion: safeLabel(metadata.expoVersion),
    screenWidth: safeDimension(metadata.screenWidth),
    screenHeight: safeDimension(metadata.screenHeight),
    theme: metadata.theme === 'dark' ? 'dark' : 'light',
    fontScale: safeFontScale(metadata.fontScale),
    currentScreen: safeScreen(metadata.currentScreen),
    nodeSeekSession: safeSessionStatus(metadata.nodeSeekSession),
    linuxDoSession: safeSessionStatus(metadata.linuxDoSession),
    yaohuoSession: safeSessionStatus(metadata.yaohuoSession),
    proxyEnabled: metadata.proxyEnabled === true
  });
}

async function readLog(name: string) {
  const file = logFile(name);
  return file.exists ? file.text() : '';
}

function mergeDiagnosticLinesChronologically(contents: string[]) {
  let damagedLineCount = 0;
  const lines = contents
    .flatMap((content) => content.split('\n'))
    .filter(Boolean)
    .flatMap((line, index) => {
      let time = Number.NEGATIVE_INFINITY;
      try {
        const parsed = JSON.parse(line) as { time?: unknown };
        if (typeof parsed.time === 'string') {
          const candidate = Date.parse(parsed.time);
          if (Number.isFinite(candidate)) time = candidate;
        }
      } catch {
        damagedLineCount += 1;
        return [];
      }
      return [{ index, line, time }];
    })
    .sort((left, right) => left.time - right.time || left.index - right.index)
    .map(({ line }) => line);
  return { lines: [...new Set(lines)], damagedLineCount };
}

function sourceCoverage(content: string, status: string) {
  const merged = mergeDiagnosticLinesChronologically([content]);
  const times = merged.lines.flatMap((line) => {
    const event = JSON.parse(line) as { time?: unknown };
    return typeof event.time === 'string' && Number.isFinite(Date.parse(event.time)) ? [event.time] : [];
  });
  return {
    status: merged.damagedLineCount && status === 'available' ? 'partial' : status,
    eventCount: merged.lines.length,
    damagedLineCount: merged.damagedLineCount,
    ...(times.length ? { firstEventAt: times[0], lastEventAt: times.at(-1) } : {})
  };
}

export async function exportDiagnosticLog(metadata: DiagnosticExportMetadata) {
  flushPendingDiagnosticLines();
  closeActiveLogHandle();
  let writerStatus = 'settled';
  try {
    await appendNativeBatch(async () => {
      while (nativeWriting) await nativeWrites;
    });
  } catch {
    writerStatus = 'timeout';
  }
  const [previous, current, journal] = await Promise.allSettled([
    readLog(PREVIOUS_LOG_NAME),
    readLog(CURRENT_LOG_NAME),
    readDiagnosticJournal()
  ]);
  const legacyReadFailures = [previous, current].filter((result) => result.status === 'rejected').length;
  const persisted = journal.status === 'fulfilled' ? journal.value : undefined;
  let legacyNativeLines = '';
  let legacyNativeStatus = 'not-needed';
  if (persisted?.status !== 'available') {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        readNativeReadNetworkDiagnosticLines(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 5_000);
        })
      ]);
      legacyNativeLines = value || '';
      legacyNativeStatus = value === null ? 'timeout' : value === undefined ? 'unavailable' : 'available';
    } catch {
      legacyNativeStatus = 'failed';
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  const networkEvents: unknown[] = [];
  const nativeAppLines: string[] = [];
  let damagedNativeLines = 0;
  for (const line of (persisted?.nativeLines || '').split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.diagnosticKind === 'network') networkEvents.push(event);
      else nativeAppLines.push(line);
    } catch {
      damagedNativeLines += 1;
    }
  }
  const normalizedNetwork = normalizeNativeReadNetworkDiagnosticEvents(networkEvents).map((event) =>
    JSON.stringify(event)
  );
  const merged = mergeDiagnosticLinesChronologically([
    previous.status === 'fulfilled' ? previous.value : '',
    current.status === 'fulfilled' ? current.value : '',
    persisted?.jsLines || '',
    persisted?.crashLines || '',
    nativeAppLines.join('\n'),
    normalizedNetwork.join('\n'),
    legacyNativeLines
  ]);
  const timestamps = merged.lines.flatMap((line) => {
    const value = (JSON.parse(line) as { time?: unknown }).time;
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? [value] : [];
  });
  const coverage = JSON.stringify({
    type: 'diagnostic-coverage',
    schemaVersion: 1,
    writerStatus,
    journalStatus: persisted?.status || 'failed',
    legacyStatus: legacyReadFailures ? 'partial' : 'available',
    legacyNativeStatus,
    legacyReadFailures,
    ...(timestamps.length ? { firstEventAt: timestamps[0], lastEventAt: timestamps.at(-1) } : {}),
    eventCount: merged.lines.length,
    damagedLineCount: merged.damagedLineCount + damagedNativeLines,
    nativeRejectedEventCount: networkEvents.length - normalizedNetwork.length,
    droppedCount,
    writeFailureCount,
    rotationCount,
    ...persisted?.health,
    sources: {
      legacyPrevious: sourceCoverage(
        previous.status === 'fulfilled' ? previous.value : '',
        previous.status === 'fulfilled' ? 'available' : 'failed'
      ),
      legacyCurrent: sourceCoverage(
        current.status === 'fulfilled' ? current.value : '',
        current.status === 'fulfilled' ? 'available' : 'failed'
      ),
      js: sourceCoverage(
        persisted?.jsLines || '',
        persisted?.health.jsReadFailureCount ? 'partial' : persisted?.status || 'failed'
      ),
      native: sourceCoverage(
        [...nativeAppLines, ...normalizedNetwork].join('\n'),
        persisted?.health.nativeReadFailureCount || damagedNativeLines ? 'partial' : persisted?.status || 'failed'
      ),
      crash: sourceCoverage(
        persisted?.crashLines || '',
        persisted?.health.crashReadFailureCount ? 'partial' : persisted?.status || 'failed'
      ),
      legacyNative: sourceCoverage(legacyNativeLines, legacyNativeStatus)
    }
  });
  const temporary = new File(Paths.cache, safeFileName('forum-reader-diagnostic', 'txt'));
  // The metadata status is a local snapshot, not a fresh authentication result.
  const checks = merged.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(
      (event) => event.source === 'linuxdo' && event.operation === 'account-reconcile' && event.phase === 'finish'
    );
  const lastCheck = checks.at(-1);
  const accountSummary = JSON.stringify({
    type: 'diagnostic-account-summary',
    schemaVersion: 1,
    source: 'linuxdo',
    localSnapshot: safeSessionStatus(metadata.linuxDoSession),
    lastCheckResult:
      lastCheck?.state === 'confirmed' ? 'authenticated' : lastCheck?.state === 'anonymous' ? 'anonymous' : 'unknown',
    ...(lastCheck && typeof lastCheck.time === 'string' && Number.isFinite(Date.parse(lastCheck.time))
      ? { lastCheckAt: lastCheck.time }
      : {}),
    checkedInCurrentProcess: Boolean(
      lastCheck?.processSessionId && lastCheck.processSessionId === diagnosticBuildContext().processSessionId
    )
  });
  try {
    temporary.create({ overwrite: true });
    temporary.write(
      `${metadataLine(metadata)}\n${coverage}\n${accountSummary}\n${merged.lines.join('\n')}${merged.lines.length ? '\n' : ''}`
    );
    const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('当前设备不支持分享诊断日志。');
    }
    await Sharing.shareAsync(temporary.uri, {
      dialogTitle: '分享诊断日志',
      mimeType: 'text/plain'
    });
  } finally {
    try {
      if (temporary.exists) {
        temporary.delete();
      }
    } catch {
      // A failed cleanup must not replace the actual export result.
    }
  }
}

export function initializeDiagnosticFileLogging() {
  if (!writerInstalled) {
    try {
      setDiagnosticWriter(appendDiagnosticLogLine);
      writerInstalled = true;
      const trace = beginDiagnosticTrace('app', 'startup');
      finishDiagnosticTrace(trace, 'success');
    } catch {
      // Diagnostics must not make startup fail.
    }
  }
  installDiagnosticExceptionHandlers(flushPendingDiagnosticLines);
}
