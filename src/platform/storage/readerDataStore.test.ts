import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEmptyReaderData, topicKey } from '@/domain/reader/readerData';
import { MAX_BACKUP_JSON_BYTES } from '@/domain/reader/readerBackup';
import { loadReaderData, loadReaderSettings, saveCleanReaderData, saveReaderSettings } from './readerDataStore';
import type { Topic } from '@/domain/forum/models';

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

const defaultContentSources = [
  { source: 'v2ex', enabled: true },
  { source: 'linuxdo', enabled: true },
  { source: 'nodeseek', enabled: true },
  { source: 'yaohuo', enabled: true }
] as const;

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
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) => asyncStorage.__store.get(key) ?? null);
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      asyncStorage.__store.set(key, value);
    });
    vi.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => {
      asyncStorage.__store.delete(key);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves reader data in AsyncStorage instead of SecureStore', async () => {
    const data = createEmptyReaderData();

    await saveCleanReaderData(data);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('reader-data', JSON.stringify(data));
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('returns the same already-clean reader data object after saving', async () => {
    const data = createEmptyReaderData();

    const saved = await saveCleanReaderData(data);

    expect(saved).toBe(data);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('reader-data', JSON.stringify(data));
  });

  it('skips AsyncStorage writes when the clean JSON has not changed', async () => {
    const data = createEmptyReaderData();

    const saved = await saveCleanReaderData(data, JSON.stringify(data));

    expect(saved).toBe(data);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('persists settings without rewriting the full reader-data snapshot', async () => {
    const settings = { ...createEmptyReaderData().settings, theme: 'dark' as const };

    await saveReaderSettings(settings);

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('reader-settings', JSON.stringify(settings));
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith('reader-data', expect.any(String));
  });

  it('loads separately persisted settings over the full reader-data snapshot', async () => {
    const data = createEmptyReaderData();
    asyncStorage.__store.set('reader-data', JSON.stringify(data));
    asyncStorage.__store.set('reader-settings', JSON.stringify({ ...data.settings, theme: 'dark' }));

    await expect(loadReaderData()).resolves.toMatchObject({ settings: { theme: 'dark' } });
  });

  it('keeps a valid persisted content-source order and enabled set', async () => {
    const data = createEmptyReaderData();
    asyncStorage.__store.set('reader-data', JSON.stringify(data));
    asyncStorage.__store.set(
      'reader-settings',
      JSON.stringify({
        ...data.settings,
        contentSources: [
          { source: 'linuxdo', enabled: false },
          { source: 'v2ex', enabled: true },
          { source: 'nodeseek', enabled: true },
          { source: 'yaohuo', enabled: false }
        ]
      })
    );

    await expect(loadReaderData()).resolves.toMatchObject({
      settings: {
        contentSources: [
          { source: 'linuxdo', enabled: false },
          { source: 'v2ex', enabled: true },
          { source: 'nodeseek', enabled: true },
          { source: 'yaohuo', enabled: false }
        ]
      }
    });
  });

  it('loads headless settings only from the settings key and falls back safely', async () => {
    asyncStorage.__store.set('reader-settings', '{bad json');

    await expect(loadReaderSettings()).resolves.toEqual(createEmptyReaderData().settings);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('reader-settings');
    expect(AsyncStorage.getItem).not.toHaveBeenCalledWith('reader-data');
  });

  it('uses default settings when the headless settings key is missing', async () => {
    await expect(loadReaderSettings()).resolves.toEqual(createEmptyReaderData().settings);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('reader-settings');
  });

  it.each(['null', '[]', '"not settings"'])('uses default settings when the headless value is %s', async (raw) => {
    asyncStorage.__store.set('reader-settings', raw);

    await expect(loadReaderSettings()).resolves.toMatchObject({ contentSources: defaultContentSources });
  });

  it('uses default settings when the headless settings read rejects', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('settings storage unavailable'));

    await expect(loadReaderSettings()).resolves.toMatchObject({ contentSources: defaultContentSources });
  });

  it('uses default settings when the headless settings read never settles', async () => {
    vi.useFakeTimers();
    vi.mocked(AsyncStorage.getItem).mockReturnValueOnce(new Promise(() => undefined));
    const load = loadReaderSettings();

    await vi.runAllTimersAsync();

    await expect(load).resolves.toMatchObject({ contentSources: defaultContentSources });
  });

  it('ignores a settings value that resolves after the local-read deadline', async () => {
    vi.useFakeTimers();
    const stored = Promise.withResolvers<string | null>();
    vi.mocked(AsyncStorage.getItem).mockReturnValueOnce(stored.promise);
    const load = loadReaderSettings();

    await vi.runAllTimersAsync();
    const settled = await load;
    stored.resolve(
      JSON.stringify({
        ...createEmptyReaderData().settings,
        contentSources: [{ source: 'v2ex', enabled: false }]
      })
    );
    await Promise.resolve();

    expect(settled.contentSources).toEqual(defaultContentSources);
  });

  it('normalizes missing and invalid content source settings in headless reads', async () => {
    asyncStorage.__store.set('reader-settings', JSON.stringify({ theme: 'dark' }));

    await expect(loadReaderSettings()).resolves.toMatchObject({
      theme: 'dark',
      contentSources: [
        { source: 'v2ex', enabled: true },
        { source: 'linuxdo', enabled: true },
        { source: 'nodeseek', enabled: true },
        { source: 'yaohuo', enabled: true }
      ]
    });

    asyncStorage.__store.set('reader-settings', JSON.stringify({ contentSources: [{ source: 'v2ex', enabled: 1 }] }));

    await expect(loadReaderSettings()).resolves.toMatchObject({
      contentSources: [
        { source: 'v2ex', enabled: true },
        { source: 'linuxdo', enabled: true },
        { source: 'nodeseek', enabled: true },
        { source: 'yaohuo', enabled: true }
      ]
    });
  });

  it.each([
    ['missing', null],
    ['malformed', '{bad json'],
    ['non-object', '[]']
  ] as const)(
    'defaults content sources when reader-settings is %s without discarding reader data',
    async (_case, raw) => {
      const data = createEmptyReaderData();
      data.history[topicKey(topic)] = { topic, savedAt: '2026-05-20T00:00:00.000Z' };
      data.settings = {
        ...data.settings,
        theme: 'dark',
        contentSources: data.settings.contentSources.map((preference) => ({
          ...preference,
          enabled: preference.source !== 'linuxdo'
        }))
      };
      vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) =>
        key === 'reader-data' ? JSON.stringify(data) : raw
      );

      await expect(loadReaderData()).resolves.toMatchObject({
        history: data.history,
        settings: {
          theme: 'dark',
          contentSources: defaultContentSources
        }
      });
    }
  );

  it('defaults content sources when neither settings store has a valid preference field', async () => {
    const data = createEmptyReaderData();
    const raw = JSON.stringify({
      ...data,
      settings: { ...data.settings, theme: 'dark', contentSources: 'invalid' }
    });
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) => (key === 'reader-data' ? raw : null));

    await expect(loadReaderData()).resolves.toMatchObject({
      settings: { theme: 'dark', contentSources: defaultContentSources }
    });
  });

  it('keeps valid reader data and defaults content sources when the separate settings read rejects', async () => {
    const data = createEmptyReaderData();
    data.history[topicKey(topic)] = { topic, savedAt: '2026-05-20T00:00:00.000Z' };
    data.settings.contentSources[1] = { source: 'linuxdo', enabled: false };
    vi.mocked(AsyncStorage.getItem).mockImplementation((key) =>
      key === 'reader-data'
        ? Promise.resolve(JSON.stringify(data))
        : Promise.reject(new Error('settings storage unavailable'))
    );

    await expect(loadReaderData()).resolves.toMatchObject({
      history: data.history,
      settings: {
        contentSources: defaultContentSources
      }
    });
  });

  it('keeps valid reader data and defaults content sources when the separate settings read exceeds the local deadline', async () => {
    vi.useFakeTimers();
    const data = createEmptyReaderData();
    data.history[topicKey(topic)] = { topic, savedAt: '2026-05-20T00:00:00.000Z' };
    data.settings.contentSources[1] = { source: 'linuxdo', enabled: false };
    vi.mocked(AsyncStorage.getItem).mockImplementation((key) =>
      key === 'reader-data' ? Promise.resolve(JSON.stringify(data)) : new Promise(() => undefined)
    );
    const load = loadReaderData();

    await vi.runAllTimersAsync();

    await expect(load).resolves.toMatchObject({
      history: data.history,
      settings: {
        contentSources: defaultContentSources
      }
    });
  });

  it('restores the previous full snapshot when the paired settings write fails', async () => {
    const previous = createEmptyReaderData();
    const next = {
      ...previous,
      settings: { ...previous.settings, theme: 'dark' as const }
    };
    const previousJson = JSON.stringify(previous);
    const nextJson = JSON.stringify(next);
    asyncStorage.__store.set('reader-data', previousJson);
    asyncStorage.__store.set('reader-settings', JSON.stringify(previous.settings));
    let settingsWriteCount = 0;
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key: string, value: string) => {
      if (key === 'reader-settings' && ++settingsWriteCount === 1) {
        throw new Error('settings write failed');
      }
      asyncStorage.__store.set(key, value);
    });

    await expect(saveCleanReaderData(next, previousJson, nextJson)).rejects.toThrow('settings write failed');

    expect(asyncStorage.__store.get('reader-data')).toBe(previousJson);
    expect(asyncStorage.__store.get('reader-settings')).toBe(JSON.stringify(previous.settings));
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

  it('rejects when the reader-data read rejects even if settings can fall back', async () => {
    vi.mocked(AsyncStorage.getItem).mockImplementation((key) =>
      key === 'reader-data' ? Promise.reject(new Error('reader data unavailable')) : Promise.resolve(null)
    );

    await expect(loadReaderData()).rejects.toThrow('reader data unavailable');
  });

  it('rejects when the reader-data read never settles', async () => {
    vi.useFakeTimers();
    vi.mocked(AsyncStorage.getItem).mockImplementation((key) =>
      key === 'reader-data' ? new Promise(() => undefined) : Promise.resolve(null)
    );
    const load = expect(loadReaderData()).rejects.toThrow('本机资料读取超时');

    await vi.runAllTimersAsync();

    await load;
  });

  it('keeps a reader-data timeout settled after the storage promise resolves late', async () => {
    vi.useFakeTimers();
    const stored = Promise.withResolvers<string | null>();
    vi.mocked(AsyncStorage.getItem).mockImplementation((key) =>
      key === 'reader-data' ? stored.promise : Promise.resolve(null)
    );
    const outcome = loadReaderData().then(
      () => 'loaded',
      (error: Error) => error.message
    );

    await vi.runAllTimersAsync();
    expect(await outcome).toBe('本机资料读取超时；为防止覆盖，未自动重置。');
    stored.resolve(JSON.stringify(createEmptyReaderData()));
    await Promise.resolve();

    expect(await outcome).toBe('本机资料读取超时；为防止覆盖，未自动重置。');
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
