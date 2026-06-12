import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SEARCH_FILTERS,
  buildLinuxDoSearchQuery,
  searchFilterSummary
} from './searchFilters';
import type { Category } from './types';

const categories: Category[] = [
  { source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' },
  { source: 'nodeseek', id: 'daily', name: '日常' },
  { source: 'yaohuo', id: '177', name: '妖火茶馆' }
];

describe('Android search site filters', () => {
  it('summarizes default and selected site filters for the compact entry', () => {
    expect(searchFilterSummary('linuxdo', DEFAULT_SEARCH_FILTERS.linuxdo, categories)).toBe('默认');
    expect(searchFilterSummary('linuxdo', {
      source: 'linuxdo',
      scope: 'title',
      category: '4',
      tags: '人工智能',
      username: 'alice',
      timeRange: 'week',
      order: 'latest'
    }, categories)).toBe('标题 · 开发调优 · 人工智能 · alice · 7天 · 最新');
    expect(searchFilterSummary('nodeseek', {
      source: 'nodeseek',
      category: 'daily',
      sort: 'postTime'
    }, categories)).toBe('日常 · 新帖子');
    expect(searchFilterSummary('yaohuo', { source: 'yaohuo', category: '177' }, categories)).toBe('妖火茶馆');
  });

  it('builds a real Discourse search query for linux.do filters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T10:00:00+08:00'));
    try {
      expect(buildLinuxDoSearchQuery('AI', {
        source: 'linuxdo',
        scope: 'title',
        category: '4',
        tags: '人工智能',
        username: 'alice',
        timeRange: 'week',
        order: 'latest'
      }, categories)).toBe('AI in:title category:dev tags:人工智能 @alice after:2026-06-04 order:latest');
    } finally {
      vi.useRealTimers();
    }
  });
});
