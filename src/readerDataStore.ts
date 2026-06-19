import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEmptyReaderData, sanitizeReaderData, type ReaderData } from './readerData';

const READER_DATA_STORAGE_KEY = 'reader-data';
const READER_DATA_CORRUPT_BACKUP_STORAGE_KEY = 'reader-data-corrupt-backup';

export async function loadReaderData() {
  const raw = await AsyncStorage.getItem(READER_DATA_STORAGE_KEY);
  if (!raw) {
    return createEmptyReaderData();
  }
  try {
    const clean = sanitizeReaderData(JSON.parse(raw));
    if (JSON.stringify(clean) !== raw) {
      await AsyncStorage.setItem(READER_DATA_CORRUPT_BACKUP_STORAGE_KEY, raw);
      await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
    }
    return clean;
  } catch {
    const clean = createEmptyReaderData();
    await AsyncStorage.setItem(READER_DATA_CORRUPT_BACKUP_STORAGE_KEY, raw);
    await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }
}

export async function saveCleanReaderData(clean: ReaderData) {
  await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export async function saveReaderData(data: ReaderData) {
  return saveCleanReaderData(sanitizeReaderData(data));
}
