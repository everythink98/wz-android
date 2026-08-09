import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { safeFileName } from '@/platform/storage/backupFiles';
import { recordDiagnosticError, setDiagnosticWriter } from './diagnostics';
import { readNativeReadNetworkDiagnosticLines } from './nativeReadNetworkDiagnostics';

const MAX_LOG_BYTES = 1024 * 1024;
const CURRENT_LOG_NAME = 'forum-reader-diagnostic-current.jsonl';
const PREVIOUS_LOG_NAME = 'forum-reader-diagnostic-previous.jsonl';
const ERROR_HANDLER_MARK = '__forumReaderDiagnosticHandler';
const encoder = new TextEncoder();

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
  xiaoyinsiSession?: DiagnosticSessionStatus;
};

type GlobalErrorHandler = ((error: unknown, isFatal?: boolean) => void) & {
  [ERROR_HANDLER_MARK]?: true;
};

type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

let writerInstalled = false;
let flushScheduled = false;
let pendingLogLines: Uint8Array[] = [];
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
  current.move(previous);
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

function flushPendingDiagnosticLines() {
  flushScheduled = false;
  const pending = pendingLogLines;
  pendingLogLines = [];
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
    const bytes = encoder.encode(line.endsWith('\n') ? line : `${line}\n`);
    pendingLogLines.push(bytes);
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
  return JSON.stringify({
    type: 'diagnostic-metadata',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
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
    xiaoyinsiSession: safeSessionStatus(metadata.xiaoyinsiSession),
    proxyEnabled: metadata.proxyEnabled === true
  });
}

async function readLog(name: string) {
  const file = logFile(name);
  return file.exists ? file.text() : '';
}

function mergeDiagnosticLinesChronologically(...contents: string[]) {
  return contents
    .flatMap((content) => content.split('\n'))
    .filter(Boolean)
    .map((line, index) => {
      let time = Number.NEGATIVE_INFINITY;
      try {
        const parsed = JSON.parse(line) as { time?: unknown };
        if (typeof parsed.time === 'string') {
          const candidate = Date.parse(parsed.time);
          if (Number.isFinite(candidate)) time = candidate;
        }
      } catch {
        // Persisted lines are already privacy-filtered; keep a damaged line in its stable oldest position.
      }
      return { index, line, time };
    })
    .sort((left, right) => left.time - right.time || left.index - right.index)
    .map(({ line }) => line)
    .join('\n');
}

export async function exportDiagnosticLog(metadata: DiagnosticExportMetadata) {
  flushPendingDiagnosticLines();
  closeActiveLogHandle();
  const [previous, current, nativeReadNetwork] = await Promise.all([
    readLog(PREVIOUS_LOG_NAME),
    readLog(CURRENT_LOG_NAME),
    readNativeReadNetworkDiagnosticLines()
  ]);
  const temporary = new File(Paths.cache, safeFileName('forum-reader-diagnostic', 'txt'));
  try {
    temporary.create({ overwrite: true });
    const diagnosticLines = mergeDiagnosticLinesChronologically(previous, current, nativeReadNetwork);
    temporary.write(`${metadataLine(metadata)}\n${diagnosticLines}${diagnosticLines ? '\n' : ''}`);
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

function installGlobalErrorHandler() {
  try {
    const errorUtils = (globalThis as typeof globalThis & { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    if (!errorUtils) {
      return;
    }
    const originalHandler = errorUtils.getGlobalHandler();
    if (originalHandler?.[ERROR_HANDLER_MARK]) {
      return;
    }
    const handler: GlobalErrorHandler = (error, isFatal) => {
      try {
        recordDiagnosticError('app', 'js-error', error);
        flushPendingDiagnosticLines();
      } catch {
        // The original React Native handler must always run.
      }
      originalHandler?.(error, isFatal);
    };
    handler[ERROR_HANDLER_MARK] = true;
    errorUtils.setGlobalHandler(handler);
  } catch {
    // Diagnostics must not make startup fail.
  }
}

export function initializeDiagnosticFileLogging() {
  if (!writerInstalled) {
    try {
      setDiagnosticWriter(appendDiagnosticLogLine);
      writerInstalled = true;
    } catch {
      // Diagnostics must not make startup fail.
    }
  }
  installGlobalErrorHandler();
}
