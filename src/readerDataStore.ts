import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createEmptyReaderData,
  readerDataVersion,
  sanitizeReaderData,
  type ReaderData
} from './readerData';

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
  const clean = sanitizeReaderData(parsed);
  const serialized = JSON.stringify(clean);
  if (serialized !== raw) {
    await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, serialized);
  }
  return clean;
}

export async function saveCleanReaderData(clean: ReaderData) {
  await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export async function saveReaderData(data: ReaderData) {
  return saveCleanReaderData(sanitizeReaderData(data));
}
