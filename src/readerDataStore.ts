import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createEmptyReaderData,
  readerDataVersion,
  sanitizeReaderData,
  type ReaderData
} from './readerData';
import { assertBackupJsonSize } from './readerBackup';

const READER_DATA_STORAGE_KEY = 'reader-data';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export async function loadReaderData() {
  const raw = await AsyncStorage.getItem(READER_DATA_STORAGE_KEY);
  if (!raw) {
    return createEmptyReaderData();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('本机资料已损坏；为防止覆盖，未自动重置。');
  }
  if (!isRecord(parsed) || parsed.version !== readerDataVersion) {
    throw new Error('本机资料版本不受支持；为防止覆盖，未自动重置。');
  }
  return sanitizeReaderData(parsed);
}

export async function saveCleanReaderData(clean: ReaderData) {
  const sanitized = sanitizeReaderData(clean);
  const json = JSON.stringify(sanitized);
  assertBackupJsonSize(json);
  await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, json);
  return sanitized;
}
