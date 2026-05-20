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
    return sanitizeReaderData(JSON.parse(raw));
  } catch {
    return migrateSecureStoreReaderData();
  }
}

export async function saveReaderData(data: ReaderData) {
  const clean = sanitizeReaderData(data);
  await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

async function migrateSecureStoreReaderData() {
  const raw = await SecureStore.getItemAsync(READER_DATA_STORAGE_KEY);
  if (!raw) {
    return createEmptyReaderData();
  }

  try {
    const clean = sanitizeReaderData(JSON.parse(raw));
    await AsyncStorage.setItem(READER_DATA_STORAGE_KEY, JSON.stringify(clean));
    await SecureStore.deleteItemAsync(READER_DATA_STORAGE_KEY);
    return clean;
  } catch {
    return createEmptyReaderData();
  }
}
