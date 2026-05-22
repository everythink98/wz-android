import { describe, expect, it } from 'vitest';
import { createEmptyReaderData } from './readerData';
import { exportReaderBackupJson, importReaderBackupJson } from './readerBackup';

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
});
