import { describe, expect, it } from 'vitest';
import { safeFileName } from './backupFiles';
import { createEmptyReaderData, topicKey } from './readerData';
import { MAX_BACKUP_JSON_CHARS, exportReaderBackupJson, importReaderBackupJson } from './readerBackup';
import type { Topic } from './types';

describe('reader JSON backup', () => {
  it('exports sanitized current reader data without sensitive fields', () => {
    const data = {
      ...createEmptyReaderData(),
      nodeseekCookie: 'secret',
      token: 'secret',
      sidyaohuo: 'secret'
    };

    const json = exportReaderBackupJson(data);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(2);
    expect(parsed).not.toHaveProperty('later');
    expect(parsed).not.toHaveProperty('subscriptions');
    expect(parsed.deletedRecords).not.toHaveProperty('subscriptions');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('nodeseekCookie');
    expect(json).not.toContain('sidyaohuo');
  });

  it('imports only current Android backup format', () => {
    const local = createEmptyReaderData();
    const remote = createEmptyReaderData();
    remote.settings.theme = 'dark';

    const imported = importReaderBackupJson(local, JSON.stringify(remote));

    expect(imported.settings.theme).toBe('dark');
    expect(imported.version).toBe(2);
  });

  it('rejects non-current backup versions', () => {
    const local = createEmptyReaderData();
    local.settings.theme = 'dark';
    const oldBackup = {
      version: 1,
      favorites: {},
      history: {},
      later: {},
      progress: {},
      subscriptions: {},
      savedSearches: [{ id: 'all:test', source: 'all', query: 'test', savedAt: '2026-05-20T00:00:00.000Z' }]
    };

    expect(() => importReaderBackupJson(local, JSON.stringify(oldBackup))).toThrow('备份格式不兼容');
  });

  it('rejects backup JSON that is too large to import safely', () => {
    expect(() => importReaderBackupJson(createEmptyReaderData(), ' '.repeat(MAX_BACKUP_JSON_CHARS + 1))).toThrow('备份文件过大');
  });

  it('strips sensitive fields before importing current backups', () => {
    const local = createEmptyReaderData();
    const remote = {
      ...createEmptyReaderData(),
      settings: {
        ...createEmptyReaderData().settings,
        theme: 'dark',
        nodeseekCookie: 'secret'
      },
      nodeseekCookie: 'secret'
    };

    const imported = importReaderBackupJson(local, JSON.stringify(remote));

    expect(imported.settings.theme).toBe('dark');
    expect(JSON.stringify(imported)).not.toContain('secret');
  });

  it('imports current backups using only active Android fields', () => {
    const local = createEmptyReaderData();
    const remote = {
      ...createEmptyReaderData(),
      subscriptions: {
        'v2ex:create': { source: 'v2ex', id: 'create', name: '分享创造', subscribedAt: '2026-05-20T00:00:00.000Z' }
      },
      deletedRecords: {
        ...createEmptyReaderData().deletedRecords,
        subscriptions: { 'v2ex:create': '2026-05-20T01:00:00.000Z' }
      },
      settings: {
        ...createEmptyReaderData().settings,
        trackedKeywords: ['linux'],
        blockedKeywords: ['广告'],
        blockedUsers: ['spammer'],
        blockedCategories: ['v2ex:create']
      }
    };

    const imported = importReaderBackupJson(local, JSON.stringify(remote));

    expect(imported).not.toHaveProperty('subscriptions');
    expect(imported.deletedRecords).not.toHaveProperty('subscriptions');
    expect(imported.settings).not.toHaveProperty('trackedKeywords');
    expect(imported.settings).not.toHaveProperty('blockedKeywords');
    expect(imported.settings).not.toHaveProperty('blockedUsers');
    expect(imported.settings).not.toHaveProperty('blockedCategories');
  });

  it('keeps yaohuo reader records in current local JSON backups', () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '1',
      title: '妖火帖子',
      author: 'alice',
      category: '妖火茶馆',
      url: 'https://yaohuo.me/bbs-1.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 1
    };
    const data = createEmptyReaderData();
    data.favorites[topicKey(topic)] = { topic, savedAt: '2026-05-20T00:00:00.000Z' };

    const backup = JSON.parse(exportReaderBackupJson(data));

    expect(backup.favorites[topicKey(topic)]?.topic.title).toBe('妖火帖子');
  });

  it('builds deterministic safe file names', () => {
    expect(safeFileName('forum reader backup', 'json', 1234)).toBe('forum-reader-backup-1234.json');
    expect(safeFileName('***', 'json', 1234)).toBe('forum-reader-1234.json');
  });
});
