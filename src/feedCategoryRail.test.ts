import { describe, expect, it } from 'vitest';
import { feedCategoryItems, feedLinuxDoFilterItems, feedReadingFilterItems, shouldAllowFeedRemotePagination, shouldLoadCategoriesForSource, shouldUseReadingFilter } from './feedCategoryRail';
import type { Category } from './types';

const categories: Category[] = [
  { source: 'v2ex', id: 'apple', name: 'Apple' },
  { source: 'nodeseek', id: 'daily', name: '日常' },
  { source: 'yaohuo', id: '177', name: '妖火茶馆' }
];

describe('Android feed category rail', () => {
  it('keeps only the common reading filters for the all feed', () => {
    expect(shouldUseReadingFilter('all')).toBe(true);
    expect(feedReadingFilterItems.map((item) => item.label)).toEqual([
      '全部',
      '未读',
      '已读',
      '收藏'
    ]);
  });

  it('keeps linux.do list filters to the original category-page choices', () => {
    expect(feedLinuxDoFilterItems).toEqual([
      { value: 'latest', label: '最新' },
      { value: 'hot', label: '热门' },
      { value: 'new-all', label: '新·所有' },
      { value: 'new-topics', label: '新·话题' },
      { value: 'new-replies', label: '新·回复' }
    ]);
  });

  it('shows real source categories for a single source feed', () => {
    expect(shouldUseReadingFilter('yaohuo')).toBe(false);
    expect(feedCategoryItems(categories, 'yaohuo')).toEqual([
      { value: '', label: '全部' },
      { value: '177', label: '妖火茶馆' }
    ]);
  });

  it('does not leak categories across sources', () => {
    expect(feedCategoryItems(categories, 'nodeseek')).toEqual([
      { value: '', label: '全部' },
      { value: 'daily', label: '日常' }
    ]);
  });

  it('requests a source category refresh only until that source has categories', () => {
    expect(shouldLoadCategoriesForSource(categories, 'linuxdo')).toBe(true);
    expect(shouldLoadCategoriesForSource([...categories, { source: 'linuxdo', id: '4', name: '开发调优' }], 'linuxdo')).toBe(false);
    expect(shouldLoadCategoriesForSource(categories, 'all')).toBe(false);
  });

  it('keeps all-feed reading filters local so they cannot trigger remote pagination loops', () => {
    expect(shouldAllowFeedRemotePagination('all', 'all')).toBe(true);
    expect(shouldAllowFeedRemotePagination('all', 'unread')).toBe(false);
    expect(shouldAllowFeedRemotePagination('all', 'read')).toBe(false);
    expect(shouldAllowFeedRemotePagination('all', 'favorite')).toBe(false);
    expect(shouldAllowFeedRemotePagination('nodeseek', 'all')).toBe(true);
    expect(shouldAllowFeedRemotePagination('nodeseek', 'favorite')).toBe(true);
  });
});
