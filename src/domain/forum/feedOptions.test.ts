import { describe, expect, it } from 'vitest';
import {
  feedCategoryItems,
  feedDiscourseFilterItems,
  feedFilterItems,
  feedFilterLabel,
  feedReadingFilterItems,
  shouldAllowFeedRemotePagination,
  shouldLoadCategoriesForSource,
  shouldUseFeedFilter,
  shouldUseReadingFilter
} from './feedOptions';
import type { Category } from './models';

const categories: Category[] = [
  { source: 'v2ex', id: 'apple', name: 'Apple' },
  { source: 'nodeseek', id: 'daily', name: '日常' },
  { source: 'yaohuo', id: '177', name: '妖火茶馆' }
];

describe('Android feed category rail', () => {
  it('keeps only the common reading filters for the all feed', () => {
    expect(shouldUseReadingFilter('all')).toBe(true);
    expect(feedReadingFilterItems.map((item) => item.label)).toEqual(['全部', '未读', '已读', '收藏']);
  });

  it('offers one portable list-filter model to every Discourse source', () => {
    expect(feedDiscourseFilterItems).toEqual([
      { value: 'latest', label: '最新' },
      { value: 'hot', label: '热门' },
      { value: 'new-all', label: '新·所有' },
      { value: 'new-topics', label: '新·话题' },
      { value: 'new-replies', label: '新·回复' }
    ]);
    expect(feedFilterItems('linuxdo')).toEqual(feedDiscourseFilterItems);
    expect(shouldUseFeedFilter('linuxdo')).toBe(true);
  });

  it('shows only real list filters for sources that support them', () => {
    expect(shouldUseFeedFilter('nodeseek', '')).toBe(true);
    expect(shouldUseFeedFilter('nodeseek', 'daily')).toBe(false);
    expect(feedFilterItems('nodeseek')).toEqual([
      { value: 'postTime', label: '新帖子' },
      { value: 'replyTime', label: '新评论' }
    ]);
    expect(feedFilterLabel('nodeseek', 'replyTime')).toBe('新评论');

    expect(shouldUseFeedFilter('v2ex', '')).toBe(true);
    expect(shouldUseFeedFilter('v2ex', 'qna')).toBe(false);
    expect(feedFilterItems('v2ex')).toEqual([
      { value: 'all', label: '全部' },
      { value: 'latest', label: '最新' },
      { value: 'hot', label: '最热' }
    ]);
    expect(feedFilterLabel('v2ex', 'hot')).toBe('最热');

    expect(shouldUseFeedFilter('yaohuo', '')).toBe(false);
    expect(feedFilterItems('yaohuo')).toEqual([]);
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
    expect(
      shouldLoadCategoriesForSource([...categories, { source: 'linuxdo', id: '4', name: '开发调优' }], 'linuxdo')
    ).toBe(false);
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
