import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEmptyReaderData } from './readerData';
import { loadReaderData, saveReaderData } from './readerDataStore';

vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store
  };
});

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      __store: store
    }
  };
});

const secureStore = SecureStore as typeof SecureStore & { __store: Map<string, string> };
const asyncStorage = AsyncStorage as typeof AsyncStorage & { __store: Map<string, string> };

describe('reader data store', () => {
  beforeEach(() => {
    secureStore.__store.clear();
    asyncStorage.__store.clear();
    vi.clearAllMocks();
  });

  it('saves reader data in AsyncStorage instead of SecureStore', async () => {
    const data = createEmptyReaderData();

    await saveReaderData(data);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('reader-data', JSON.stringify(data));
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('migrates old SecureStore reader data into AsyncStorage without touching NodeSeek cookies', async () => {
    const data = createEmptyReaderData();
    secureStore.__store.set('reader-data', JSON.stringify(data));
    secureStore.__store.set('nodeseek-cookie-header', 'session=secret');

    await expect(loadReaderData()).resolves.toEqual(data);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('reader-data', JSON.stringify(data));
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('reader-data');
    expect(secureStore.__store.get('nodeseek-cookie-header')).toBe('session=secret');
  });

  it('falls back to old SecureStore reader data when AsyncStorage data is damaged', async () => {
    const data = createEmptyReaderData();
    asyncStorage.__store.set('reader-data', '{bad json');
    secureStore.__store.set('reader-data', JSON.stringify(data));

    await expect(loadReaderData()).resolves.toEqual(data);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('reader-data', JSON.stringify(data));
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('reader-data');
  });
});
