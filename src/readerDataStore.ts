import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createEmptyReaderData,
  readerDataVersion,
  sanitizeReaderData,
  sanitizeReaderSettings,
  type ReaderData,
  type ReaderSettings
} from './readerData';
import { assertBackupJsonSize } from './readerBackup';

const READER_DATA_STORAGE_KEY = 'reader-data';
const READER_SETTINGS_STORAGE_KEY = 'reader-settings';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasMalformedReaderDataSection(value: Record<string, unknown>) {
  if (['favorites', 'history', 'followedUsers', 'deletedRecords'].some((key) => value[key] !== undefined && !isRecord(value[key]))) {
    return true;
  }
  const deletedRecords = value.deletedRecords;
  return isRecord(deletedRecords) && ['favorites', 'history', 'followedUsers']
    .some((key) => deletedRecords[key] !== undefined && !isRecord(deletedRecords[key]));
}

function readerDataSanitizationDroppedEntries(raw: Record<string, unknown>, clean: ReaderData) {
  for (const key of ['favorites', 'history', 'followedUsers'] as const) {
    const section = raw[key];
    if (isRecord(section) && Object.keys(section).length !== Object.keys(clean[key]).length) {
      return true;
    }
  }
  if (isRecord(raw.deletedRecords)) {
    for (const key of ['favorites', 'history', 'followedUsers'] as const) {
      const section = raw.deletedRecords[key];
      if (isRecord(section) && Object.keys(section).length !== Object.keys(clean.deletedRecords[key]).length) {
        return true;
      }
    }
  }
  return false;
}

function settingsFromStorage(raw: string | null, fallback: ReaderSettings) {
  if (!raw) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? sanitizeReaderSettings(parsed) : fallback;
  } catch {
    return fallback;
  }
}

export async function loadReaderData() {
  const [raw, rawSettings] = await Promise.all([
    AsyncStorage.getItem(READER_DATA_STORAGE_KEY),
    AsyncStorage.getItem(READER_SETTINGS_STORAGE_KEY)
  ]);
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
    if (hasMalformedReaderDataSection(parsed)) {
      throw new Error('本机资料已损坏；为防止覆盖，未自动重置。');
    }
    clean = sanitizeReaderData(parsed);
    if (readerDataSanitizationDroppedEntries(parsed, clean)) {
      throw new Error('本机资料已损坏；为防止覆盖，未自动重置。');
    }
  }
  return {
    ...clean,
    settings: settingsFromStorage(rawSettings, clean.settings)
  };
}

export async function saveReaderSettings(settings: ReaderSettings) {
  await AsyncStorage.setItem(READER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export async function saveCleanReaderData(clean: ReaderData, previousJson?: string | null, cleanJson = JSON.stringify(clean)) {
  const json = cleanJson;
  assertBackupJsonSize(json);
  if (json !== previousJson) {
    await Promise.all([
      AsyncStorage.setItem(READER_DATA_STORAGE_KEY, json),
      saveReaderSettings(clean.settings)
    ]);
  }
  return clean;
}
