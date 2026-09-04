import { describe, expect, it, vi } from 'vitest';
import { createEmptyReaderData, toggleFavorite } from '@/domain/reader/readerData';
import { sortLibraryRecords } from './libraryFilters';

describe('library time ordering', () => {
  it('parses saved times once per record and keeps tie order and record references', () => {
    const base = toggleFavorite(createEmptyReaderData(), {
      source: 'v2ex',
      id: '1',
      title: 'one',
      author: 'a',
      url: 'https://www.v2ex.com/t/1',
      createdAt: '2026-01-01T00:00:00Z',
      replyCount: 0
    }).favorites['v2ex:1'];
    const records = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        String(index),
        { ...base, savedAt: index % 2 ? '2026-08-01T00:00:00Z' : '2026-08-02T00:00:00Z' }
      ])
    );
    const parse = vi.spyOn(Date, 'parse');
    try {
      const sorted = sortLibraryRecords(records);
      expect(parse).toHaveBeenCalledTimes(100);
      expect(sorted[0]).toBe(records['0']);
      expect(sorted[1]).toBe(records['2']);
      expect(sorted[50]).toBe(records['1']);
    } finally {
      parse.mockRestore();
    }
  });
});
