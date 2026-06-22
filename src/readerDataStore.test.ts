import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEmptyReaderData, topicKey } from './readerData';
import { MAX_BACKUP_JSON_BYTES } from './readerBackup';
import { loadReaderData, saveCleanReaderData } from './readerDataStore';
import type { Topic } from './types';

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

const topic: Topic = {
  source: 'nodeseek',
  id: '723704',
  title: 'NodeSeek topic',
  author: 'alice',
  category: '日常',
  url: 'https://www.nodeseek.com/post-723704-1',
  createdAt: '2026-05-18T11:34:13.000Z',
  replyCount: 2
};

describe('reader data store', () => {
  beforeEach(() => {
    secureStore.__store.clear();
    asyncStorage.__store.clear();
    vi.clearAllMocks();
  });

  it('saves reader data in AsyncStorage instead of SecureStore', async () => {
    const data = createEmptyReaderData();

    await saveCleanReaderData(data);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('reader-data', JSON.stringify(data));
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('rejects oversized clean data before writing AsyncStorage', async () => {
    const data = createEmptyReaderData();
    const largeText = 'x'.repeat(4096);
    for (let index = 0; JSON.stringify(data).length < MAX_BACKUP_JSON_BYTES + 4096; index += 1) {
      const item: Topic = {
        ...topic,
        id: String(index),
        title: largeText,
        author: largeText,
        category: largeText,
        excerpt: largeText,
        url: `https://www.nodeseek.com/post-${index}-1?pad=${largeText.slice(0, 512)}`
      };
      data.history[topicKey(item)] = {
        topic: item,
        savedAt: new Date(Date.UTC(2026, 4, 20, 0, index)).toISOString()
      };
    }

    await expect(saveCleanReaderData(data)).rejects.toThrow('备份文件过大');

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('starts with clean Android reader data when AsyncStorage is empty', async () => {
    const oldData = createEmptyReaderData();
    secureStore.__store.set('reader-data', JSON.stringify(oldData));
    secureStore.__store.set('nodeseek-cookie-header', 'session=secret');

    await expect(loadReaderData()).resolves.toEqual(createEmptyReaderData());

    expect(SecureStore.getItemAsync).not.toHaveBeenCalledWith('reader-data');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith('reader-data');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(secureStore.__store.get('nodeseek-cookie-header')).toBe('session=secret');
  });

  it('preserves damaged AsyncStorage data instead of replacing it with empty data', async () => {
    asyncStorage.__store.set('reader-data', '{bad json');

    await expect(loadReaderData()).rejects.toThrow('本机资料已损坏');

    expect(asyncStorage.__store.get('reader-data')).toBe('{bad json');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('preserves unsupported reader data versions instead of replacing them with empty data', async () => {
    const raw = JSON.stringify({ ...createEmptyReaderData(), version: 1 });
    asyncStorage.__store.set('reader-data', raw);

    await expect(loadReaderData()).rejects.toThrow('本机资料版本不受支持');

    expect(asyncStorage.__store.get('reader-data')).toBe(raw);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('keeps valid sections without rewriting current-version data during load', async () => {
    const raw = JSON.stringify({
      ...createEmptyReaderData(),
      favorites: 'bad',
      history: {
        [topicKey(topic)]: {
          topic,
          savedAt: '2026-05-20T00:00:00.000Z'
        }
      }
    });
    asyncStorage.__store.set('reader-data', raw);

    const data = await loadReaderData();

    expect(data.history[topicKey(topic)]?.topic).toEqual(topic);
    expect(data.favorites).toEqual({});
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith('reader-data-corrupt-backup', raw);
  });
});
