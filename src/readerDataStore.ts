import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEmptyReaderData, sanitizeReaderData, type ReaderData } from './readerData';

const READER_DATA_STORAGE_KEY = 'reader-data';

export async function loadReaderData() {
  const raw = await AsyncStorage.getItem(READER_DATA_STORAGE_KEY);
  if (!raw) {
    return migrateSecureStoreReaderData();
  }
  try {
    const clean = sanitizeReaderData(JSON.parse(raw));
    if (JSON.stringify(clean) !== raw) {
      await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
    }
    return clean;
  } catch {
    return migrateSecureStoreReaderData(true);
  }
}

export async function saveReaderData(data: ReaderData) {
  const clean = sanitizeReaderData(data);
  await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

async function migrateSecureStoreReaderData(persistEmpty = false) {
  const raw = await SecureStore.getItemAsync(READER_DATA_STORAGE_KEY);
  if (!raw) {
    const clean = createEmptyReaderData();
    if (persistEmpty) {
      await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
    }
    return clean;
  }

  try {
    const clean = sanitizeReaderData(JSON.parse(raw));
    await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
    await SecureStore.deleteItemAsync(READER_DATA_STORAGE_KEY);
    return clean;
  } catch {
    const clean = createEmptyReaderData();
    if (persistEmpty) {
      await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
    }
    return clean;
  }
}
