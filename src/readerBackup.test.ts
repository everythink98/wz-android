import { describe, expect, it } from 'vitest';
import { createEmptyReaderData, topicKey } from './readerData';
import { exportReaderBackupJson, importReaderBackupJson } from './readerBackup';
import type { Topic } from './types';

describe('reader JSON backup', () => {
  it('exports sanitized reader data without sensitive fields', () => {
    const data = {
      ...createEmptyReaderData(),
      nodeseekCookie: 'secret',
      token: 'secret',
      sidyaohuo: 'secret'
    };

    const json = exportReaderBackupJson(data);

    expect(JSON.parse(json).version).toBe(1);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('nodeseekCookie');
    expect(json).not.toContain('sidyaohuo');
  });

  it('imports JSON and merges it with local reader data', () => {
    const local = createEmptyReaderData();
    const remote = createEmptyReaderData();
    remote.savedSearches = [{ id: 'all:test', source: 'all', query: 'test', savedAt: '2026-05-20T00:00:00.000Z' }];

    const merged = importReaderBackupJson(local, JSON.stringify(remote));

    expect(merged.savedSearches).toHaveLength(1);
    expect(merged.savedSearches[0].query).toBe('test');
  });

  it('keeps yaohuo reader records in local JSON backups', () => {
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
});
