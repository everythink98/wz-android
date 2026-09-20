import { describe, expect, it } from 'vitest';
import { createEmptyReaderData, topicKey, userSummary } from './readerData';
import { MAX_BACKUP_JSON_BYTES, exportReaderBackupJson, parseReaderBackupJson } from './readerBackup';
import type { Topic } from '@/domain/forum/models';

describe('reader JSON backup', () => {
  it.each([undefined, 0, 12, -1, 1.2, '12'])(
    'exports only a trustworthy optional reply watermark %s',
    (replyWatermark) => {
      const data = createEmptyReaderData();
      data.history['nodeseek:1'] = {
        topic: {
          source: 'nodeseek',
          id: '1',
          title: 'topic',
          author: 'alice',
          url: 'https://www.nodeseek.com/post-1-1',
          createdAt: '2026-01-01T00:00:00Z',
          replyCount: 2,
          replyWatermark
        } as Topic,
        savedAt: '2026-01-02T00:00:00Z'
      };
      const exported = JSON.parse(exportReaderBackupJson(data));
      expect(exported.history['nodeseek:1'].topic.replyWatermark).toBe(
        typeof replyWatermark === 'number' && Number.isSafeInteger(replyWatermark) && replyWatermark >= 0
          ? replyWatermark
          : undefined
      );
      expect(exported.history['nodeseek:1'].topic.replyCount).toBe(2);
    }
  );
  it.each(['sidney', 'session-user', 'proxy-reader', 'token-owner'])(
    'preserves the %s identity and deletion key through export and parsing',
    (id) => {
      const user = { source: 'v2ex' as const, id, username: id, url: `https://www.v2ex.com/member/${id}`, topics: [] };
      const followed = createEmptyReaderData();
      followed.followedUsers[`v2ex:${id}`] = { user: userSummary(user), followedAt: '2026-01-01T00:00:00.000Z' };
      expect(parseReaderBackupJson(exportReaderBackupJson(followed))).toMatchObject({
        followedUsers: { [`v2ex:${id}`]: { user: { id } } }
      });

      const deleted = createEmptyReaderData();
      deleted.deletedRecords.followedUsers[`v2ex:${id}`] = '2026-01-02T00:00:00.000Z';
      expect(parseReaderBackupJson(exportReaderBackupJson(deleted))).toMatchObject({
        deletedRecords: { followedUsers: deleted.deletedRecords.followedUsers }
      });
    }
  );

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

  it('exports current content source preferences once in their configured order', () => {
    const remote = createEmptyReaderData();
    remote.settings.contentSources = [
      { source: 'linuxdo', enabled: false },
      { source: 'v2ex', enabled: true },
      { source: 'linuxdo', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true }
    ];

    const exported = JSON.parse(exportReaderBackupJson(remote));
    expect(exported.settings.contentSources).toEqual([
      { source: 'linuxdo', enabled: false },
      { source: 'v2ex', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true }
    ]);
  });

  it('rejects non-current backup versions', () => {
    const oldBackup = {
      version: 1,
      favorites: {},
      history: {},
      later: {},
      progress: {},
      subscriptions: {},
      savedSearches: [{ id: 'all:test', source: 'all', query: 'test', savedAt: '2026-05-20T00:00:00.000Z' }]
    };

    expect(() => parseReaderBackupJson(JSON.stringify(oldBackup))).toThrow('备份格式不兼容');
  });

  it('rejects backup JSON that is too large to import safely', () => {
    expect(() => parseReaderBackupJson(' '.repeat(MAX_BACKUP_JSON_BYTES + 1))).toThrow('备份文件过大');
  });

  it('uses UTF-8 bytes instead of string length for import size checks', () => {
    expect(() => parseReaderBackupJson('界'.repeat(Math.ceil(MAX_BACKUP_JSON_BYTES / 3) + 1))).toThrow('备份文件过大');
  });

  it('strips sensitive fields recursively while parsing current backups', () => {
    const remote = {
      ...createEmptyReaderData(),
      settings: {
        ...createEmptyReaderData().settings,
        theme: 'dark',
        nodeseekCookie: 'secret'
      },
      nodeseekCookie: 'secret'
    };

    const parsed = parseReaderBackupJson(JSON.stringify(remote));
    expect(parsed).toMatchObject({ settings: { theme: 'dark' } });
    expect(JSON.stringify(parsed)).not.toContain('secret');
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

  it('exports canonical record links without portable URL credentials', () => {
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
    const clean = exported.favorites[topicKey(topic)]?.topic;
    expect(clean?.url).toBe('https://www.nodeseek.com/post-42-1');
    expect(clean?.authorUrl).toBe('https://www.nodeseek.com/space/7');
    expect(clean?.authorAvatar).toBe('https://cdn.example.com/avatar.png');
    expect(exported.followedUsers['linuxdo:88']?.user.url).toBe('https://linux.do/u/alice');
    expect(exported.followedUsers['linuxdo:88']?.user.avatar).toBe('https://cdn.example.com/user.png');
    expect(JSON.stringify(clean)).not.toContain('fake-');
    expect(JSON.stringify(exported.followedUsers)).not.toContain('fake-');
    expect(exported.version).toBe(2);
  });
});
