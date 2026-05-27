import { describe, expect, it } from 'vitest';
import { safeFileName } from './backupFiles';

describe('Android backup file helpers', () => {
  it('builds deterministic safe file names', () => {
    expect(safeFileName('forum reader backup', 'json', 1234)).toBe('forum-reader-backup-1234.json');
    expect(safeFileName('***', 'json', 1234)).toBe('forum-reader-1234.json');
  });
});
