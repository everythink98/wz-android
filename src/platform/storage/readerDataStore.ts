import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createEmptyReaderData,
  readerDataVersion,
  sanitizeReaderData,
  sanitizeReaderSettings,
  type ReaderData,
  type ReaderSettings
} from '@/domain/reader/readerData';
import { assertBackupJsonSize } from '@/domain/reader/readerBackup';
import { isRecord } from '@/domain/forum/html';
import { createTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';

const READER_DATA_STORAGE_KEY = 'reader-data';
const READER_SETTINGS_STORAGE_KEY = 'reader-settings';
const READER_STORAGE_LOAD_TIMEOUT_MS = 3_000;
let lastSettingsLoadResult = '';

function recordSettingsLoad(trace: DiagnosticTrace, outcome: DiagnosticOutcome, fields: DiagnosticFields) {
  const result = `${outcome}:${fields.state}:${fields.reason || ''}`;
  if (lastSettingsLoadResult === result) return;
  lastSettingsLoadResult = result;
  finishDiagnosticTrace(trace, outcome, { store: 'reader-settings', ...fields });
}

function settingsFromStorage(parsed: unknown, fallback: ReaderSettings) {
  try {
    return isRecord(parsed) ? sanitizeReaderSettings(parsed) : fallback;
  } catch {
    return fallback;
  }
}

async function readStoredSettings() {
  const trace = createTrace('reader-data', 'load-settings');
  let reading = true;
  try {
    const raw = await readStorageItem(READER_SETTINGS_STORAGE_KEY, '阅读设置读取超时。');
    reading = false;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const valid = isRecord(parsed);
    recordSettingsLoad(trace, raw && !valid ? 'partial' : raw ? 'success' : 'noop', {
      state: raw ? (valid ? 'restored' : 'fallback') : 'missing',
      ...(raw && !valid ? { reason: 'invalid_response' } : {})
    });
    return parsed;
  } catch (error) {
    recordSettingsLoad(trace, 'partial', {
      state: 'fallback',
      reason: reading
        ? normalizeDiagnosticReason(error) === 'timeout'
          ? 'timeout'
          : 'storage_error'
        : 'invalid_response'
    });
    return null;
  }
}

function readStorageItem(key: string, timeoutMessage: string) {
  return new Promise<string | null>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      complete();
    };
    timeout = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), READER_STORAGE_LOAD_TIMEOUT_MS);
    try {
      void AsyncStorage.getItem(key).then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error))
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export async function loadReaderData() {
  const trace = createTrace('reader-data', 'restore');
  const defaultSettings = createEmptyReaderData().settings;
  let reading = true;
  try {
    const [raw, rawSettings] = await Promise.all([
      readStorageItem(READER_DATA_STORAGE_KEY, '本机资料读取超时；为防止覆盖，未自动重置。'),
      readStoredSettings()
    ]);
    reading = false;
    let clean: ReaderData;
    if (!raw) {
      clean = createEmptyReaderData();
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('本机资料已损坏；为防止覆盖，未自动重置。');
      }
      if (!isRecord(parsed) || parsed.version !== readerDataVersion) {
        throw new Error('本机资料版本不受支持；为防止覆盖，未自动重置。');
      }
      clean = sanitizeReaderData(parsed);
    }
    const result = {
      ...clean,
      settings: settingsFromStorage(rawSettings, {
        ...clean.settings,
        contentSources: defaultSettings.contentSources
      })
    };
    finishDiagnosticTrace(trace, raw === null ? 'noop' : raw ? 'success' : 'partial', {
      state: raw === null ? 'missing' : raw ? 'restored' : 'fallback',
      hasStoredData: raw !== null,
      ...(raw === '' ? { reason: 'invalid_response' } : {})
    });
    return result;
  } catch (error) {
    finishDiagnosticTrace(trace, 'failure', {
      state: reading ? 'recovery-mode' : 'invalid',
      reason: reading
        ? normalizeDiagnosticReason(error) === 'timeout'
          ? 'timeout'
          : 'storage_error'
        : 'invalid_response'
    });
    throw error;
  }
}

export async function loadReaderSettings() {
  const fallback = createEmptyReaderData().settings;
  try {
    return settingsFromStorage(await readStoredSettings(), fallback);
  } catch {
    return fallback;
  }
}

export async function saveReaderSettings(settings: ReaderSettings) {
  await AsyncStorage.setItem(READER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export async function saveCleanReaderData(
  clean: ReaderData,
  previousJson?: string | null,
  cleanJson = JSON.stringify(clean)
) {
  const json = cleanJson;
  assertBackupJsonSize(json);
  if (json !== previousJson) {
    const previousSettings = await AsyncStorage.getItem(READER_SETTINGS_STORAGE_KEY);
    await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, json);
    try {
      await saveReaderSettings(clean.settings);
    } catch (error) {
      const rollbackResults = await Promise.allSettled([
        previousJson == null
          ? AsyncStorage.removeItem(READER_DATA_STORAGE_KEY)
          : AsyncStorage.setItem(READER_DATA_STORAGE_KEY, previousJson),
        previousSettings == null
          ? AsyncStorage.removeItem(READER_SETTINGS_STORAGE_KEY)
          : AsyncStorage.setItem(READER_SETTINGS_STORAGE_KEY, previousSettings)
      ]);
      const rollbackErrors = rollbackResults.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
      if (rollbackErrors.length) {
        throw new AggregateError([error, ...rollbackErrors], '本机资料保存失败，且无法恢复先前快照。');
      }
      throw error;
    }
  }
  return clean;
}
