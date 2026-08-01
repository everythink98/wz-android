import { describe, expect, it } from 'vitest';
import { safeFileName } from '@/platform/storage/backupFiles';
import { createEmptyReaderData, topicKey } from './readerData';
import { MAX_BACKUP_JSON_BYTES, exportReaderBackupJson, importReaderBackupJson } from './readerBackup';
import type { Topic } from '@/domain/forum/models';

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

    expect(json).not.toContain('\n');
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
    expect(() => importReaderBackupJson(createEmptyReaderData(), ' '.repeat(MAX_BACKUP_JSON_BYTES + 1))).toThrow(
      '备份文件过大'
    );
  });

  it('uses UTF-8 bytes instead of string length for import size checks', () => {
    expect(() =>
      importReaderBackupJson(createEmptyReaderData(), '界'.repeat(Math.ceil(MAX_BACKUP_JSON_BYTES / 3) + 1))
    ).toThrow('备份文件过大');
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

  it('[REG-DATA-006] canonicalizes record links and removes every portable URL credential', () => {
    const topic: Topic = {
      source: 'nodeseek',
      id: '42',
      title: '安全备份',
      author: 'alice',
      authorId: '7',
      authorAvatar: 'https://user:pass@cdn.example.com/avatar.png?X-Amz-Signature=fake-amz#profile',
      authorUrl: 'https://user:pass@www.nodeseek.com/space/7?unknown_credential=fake-author#profile',
      url: 'https://user:pass@www.nodeseek.com/post-42-9?unknown_credential=fake-topic#reply',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 1
    };
    const remote = createEmptyReaderData();
    remote.favorites[topicKey(topic)] = {
      topic,
      savedAt: '2026-05-20T00:00:00.000Z'
    };
    remote.followedUsers['linuxdo:88'] = {
      user: {
        source: 'linuxdo',
        id: '88',
        username: 'alice',
        displayName: 'Alice',
        avatar: 'https://user:pass@cdn.example.com/user.png?Signature=fake-user#profile',
        url: 'https://user:pass@linux.do/u/wrong?unknown_credential=fake-profile#profile',
        topics: []
      },
      followedAt: '2026-05-20T00:00:00.000Z'
    };

    const exported = JSON.parse(exportReaderBackupJson(remote));
    const imported = importReaderBackupJson(createEmptyReaderData(), JSON.stringify(remote));

    for (const data of [exported, imported]) {
      const clean = data.favorites[topicKey(topic)]?.topic;
      expect(clean?.url).toBe('https://www.nodeseek.com/post-42-1');
      expect(clean?.authorUrl).toBe('https://www.nodeseek.com/space/7');
      expect(clean?.authorAvatar).toBe('https://cdn.example.com/avatar.png');
      expect(data.followedUsers['linuxdo:88']?.user.url).toBe('https://linux.do/u/alice');
      expect(data.followedUsers['linuxdo:88']?.user.avatar).toBe('https://cdn.example.com/user.png');
      expect(JSON.stringify(clean)).not.toContain('fake-');
      expect(JSON.stringify(data.followedUsers)).not.toContain('fake-');
      expect(data.version).toBe(2);
    }
  });

  it('builds deterministic safe file names', () => {
    expect(safeFileName('forum reader backup', 'json', 1234)).toBe('forum-reader-backup-1234.json');
    expect(safeFileName('***', 'json', 1234)).toBe('forum-reader-1234.json');
  });
});
