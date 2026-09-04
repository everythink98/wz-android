import { describe, expect, it, vi } from 'vitest';
import {
  escapeHtmlAttribute,
  escapeHtmlFully,
  escapeHtmlText,
  hasRenderableHtmlContent,
  sortTopicsByTime,
  sortTopicsByCreatedAt
} from './html';

describe('topic timestamp ordering', () => {
  it.each([sortTopicsByTime, sortTopicsByCreatedAt])('parses each timestamp once and preserves stable ties', (sort) => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: index,
      createdAt: `2026-08-${String(((index * 7) % 28) + 1).padStart(2, '0')}T00:00:00Z`
    }));
    const parse = vi.spyOn(Date, 'parse');
    try {
      const sorted = sort(items);
      expect(parse).toHaveBeenCalledTimes(items.length);
      expect(sorted.slice(0, 3).map((item) => item.id)).toEqual([3, 7, 11]);
      expect(items[0].id).toBe(0);
      expect(
        sort([
          { id: 1, createdAt: '' },
          { id: 2, createdAt: 'invalid' }
        ]).map((item) => item.id)
      ).toEqual([1, 2]);
    } finally {
      parse.mockRestore();
    }
  });
});

describe('HTML escaping', () => {
  it.each([
    ['text', escapeHtmlText, '&amp;&lt;&gt;"\''],
    ['attribute', escapeHtmlAttribute, "&amp;&lt;&gt;&quot;'"],
    ['full', escapeHtmlFully, '&amp;&lt;&gt;&quot;&#39;']
  ] as const)('escapes the exact %s character matrix', (_name, escape, expected) => {
    expect(escape('&<>"\'')).toBe(expected);
    expect(escape('&amp;')).toBe('&amp;amp;');
  });

  it('keeps the existing empty-value conversion', () => {
    expect(escapeHtmlFully(0)).toBe('');
    expect(escapeHtmlFully(null)).toBe('');
  });
});

describe('HTML renderability', () => {
  it('keeps an audio-only detail post renderable before and after sanitization', () => {
    expect(hasRenderableHtmlContent('<audio src="https://media.example/song.mp3"></audio>')).toBe(true);
    expect(hasRenderableHtmlContent('<forum-audio src="https://media.example/song.mp3"></forum-audio>')).toBe(true);
  });
});
