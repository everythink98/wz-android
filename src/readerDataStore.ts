import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEmptyReaderData, sanitizeReaderData, type ReaderData } from './readerData';

const READER_DATA_STORAGE_KEY = 'reader-data';

export async function loadReaderData() {
  const raw = await AsyncStorage.getItem(READER_DATA_STORAGE_KEY);
  if (!raw) {
    return createEmptyReaderData();
  }
  try {
    const clean = sanitizeReaderData(JSON.parse(raw));
    if (JSON.stringify(clean) !== raw) {
      await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
    }
    return clean;
  } catch {
    const clean = createEmptyReaderData();
    await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }
}

export async function saveReaderData(data: ReaderData) {
  const clean = sanitizeReaderData(data);
  await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}
