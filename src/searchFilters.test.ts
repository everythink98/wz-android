import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SEARCH_FILTERS,
  buildDiscourseSearchQuery,
  discourseSearchFilterError,
  filterSearchResponseItems,
  searchFilterSummary
} from '@/searchFilters';
import type { Category } from '@/domain/forum/models';

const categories: Category[] = [
  { source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' },
  { source: 'xiaoyinsi', id: '9', name: '闲聊', slug: 'chat' },
  { source: 'nodeseek', id: 'daily', name: '日常' },
  { source: 'yaohuo', id: '177', name: '妖火茶馆' }
];

describe('Android search site filters', () => {
  it('summarizes default and selected site filters for the compact entry', () => {
    expect(searchFilterSummary('linuxdo', DEFAULT_SEARCH_FILTERS.linuxdo, categories)).toBe('默认');
    expect(
      searchFilterSummary(
        'linuxdo',
        {
          ...DEFAULT_SEARCH_FILTERS.linuxdo,
          scope: 'title',
          category: '4',
          tags: ['人工智能'],
          username: 'alice',
          timeRange: 'week',
          order: 'latest'
        },
        categories
      )
    ).toBe('标题 · 开发调优 · 人工智能 · alice · 7天 · 最新');
    expect(
      searchFilterSummary(
        'nodeseek',
        {
          source: 'nodeseek',
          category: 'daily',
          sort: 'postTime'
        },
        categories
      )
    ).toBe('日常 · 新帖子');
    expect(searchFilterSummary('yaohuo', { source: 'yaohuo', category: '177' }, categories)).toBe('妖火茶馆');
  });

  it('builds a real Discourse search query for linux.do filters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T10:00:00+08:00'));
    try {
      expect(
        buildDiscourseSearchQuery(
          'AI',
          {
            ...DEFAULT_SEARCH_FILTERS.linuxdo,
            scope: 'title',
            category: '4',
            tags: ['人工智能'],
            username: 'alice',
            timeRange: 'week',
            order: 'latest'
          },
          categories
        )
      ).toBe('AI in:title category:4 tags:人工智能 @alice after:2026-06-04 order:latest');
    } finally {
      vi.useRealTimers();
    }
  });

  it('REG-SEARCH-001 builds linux.do advanced filters from selected values', () => {
    expect(
      buildDiscourseSearchQuery(
        'AI',
        {
          source: 'linuxdo',
          scope: 'title',
          category: '4',
          tags: ['人工智能', '快问快答'],
          tagMatch: 'all',
          username: 'alice',
          visited: ['seen', 'bookmarks', 'likes', 'posted', 'created'],
          status: 'solved',
          timeRange: 'all',
          dateRelation: 'before',
          date: '2026-07-01',
          minPosts: 2,
          maxPosts: 20,
          minViews: 100,
          maxViews: 1000,
          siteExtension: { source: 'linuxdo', expertResponse: true },
          order: 'latest'
        },
        categories
      )
    ).toBe(
      'AI in:title category:4 tags:人工智能+快问快答 in:seen in:bookmarks in:likes in:posted in:created status:solved @alice before:2026-07-01 min_posts:2 max_posts:20 min_views:100 max_views:1000 with:category_expert_response order:latest'
    );
  });

  it('uses comma for any-tag matching and lets an exact date override the quick range', () => {
    expect(
      buildDiscourseSearchQuery(
        'AI',
        {
          ...DEFAULT_SEARCH_FILTERS.linuxdo,
          tags: ['人工智能', '快问快答'],
          tagMatch: 'any',
          timeRange: 'week',
          dateRelation: 'after',
          date: '2026-07-01'
        },
        categories
      )
    ).toBe('AI tags:人工智能,快问快答 after:2026-07-01');
  });

  it.each(['open', 'closed', 'public', 'archived', 'noreplies', 'single_user', 'solved', 'unsolved'] as const)(
    'builds the linux.do %s status token',
    (status) => {
      expect(buildDiscourseSearchQuery('AI', { ...DEFAULT_SEARCH_FILTERS.linuxdo, status }, categories)).toBe(
        `AI status:${status}`
      );
    }
  );

  it('rejects invalid linux.do dates and numeric ranges before applying', () => {
    expect(
      discourseSearchFilterError({
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        date: '2026-02-30'
      })
    ).toBe('请选择有效日期');
    expect(
      discourseSearchFilterError({
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        minPosts: 20,
        maxPosts: 2
      })
    ).toBe('帖子数最小值不能大于最大值');
    expect(
      discourseSearchFilterError({
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        minViews: 100,
        maxViews: 1000
      })
    ).toBe('');
    expect(
      discourseSearchFilterError({
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        minViews: -1
      })
    ).toBe('帖子数和浏览量必须是非负整数');
    expect(
      discourseSearchFilterError({
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        maxPosts: 1.5
      })
    ).toBe('帖子数和浏览量必须是非负整数');
    expect(
      discourseSearchFilterError({
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        minViews: 1000,
        maxViews: 100
      })
    ).toBe('浏览量最小值不能大于最大值');
  });

  it('builds the standard Discourse advanced filters confirmed by the 小隐寺 search UI', () => {
    expect(
      buildDiscourseSearchQuery(
        '寺内',
        {
          ...DEFAULT_SEARCH_FILTERS.xiaoyinsi,
          scope: 'title',
          category: '9',
          tags: ['公告', '反馈'],
          tagMatch: 'all',
          visited: ['seen', 'bookmarks'],
          status: 'solved',
          username: 'alice',
          dateRelation: 'before',
          date: '2026-07-01',
          minPosts: 1,
          maxPosts: 20,
          minViews: 10,
          maxViews: 200,
          order: 'latest'
        },
        categories
      )
    ).toBe(
      '寺内 in:title category:9 tags:公告+反馈 in:seen in:bookmarks status:solved @alice before:2026-07-01 min_posts:1 max_posts:20 min_views:10 max_views:200 order:latest'
    );
  });

  it('[REG-XIAOYINSI-006] keeps child-category results returned by a 小隐寺 parent-category search', () => {
    const items = [
      { title: '父分类主题', categoryId: '4' },
      { title: '子分类主题', categoryId: '15' }
    ];

    expect(filterSearchResponseItems(items, { ...DEFAULT_SEARCH_FILTERS.xiaoyinsi, category: '4' }, '主题')).toEqual(
      items
    );
  });
});
