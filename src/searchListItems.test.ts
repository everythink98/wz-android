import { describe, expect, it } from 'vitest';
import { buildSearchListItems, searchCategoryOptions, type SearchGroup } from './searchListItems';
import type { Topic } from './types';

function topic(id: string, source: Topic['source'], category = '默认'): Topic {
  return {
    source,
    id,
    title: `topic ${id}`,
    author: 'user',
    category,
    categoryId: category.toLowerCase(),
    url: `https://example.com/${id}`,
    createdAt: '2026-05-27T00:00:00.000Z',
    replyCount: 0
  };
}

describe('Android search list items', () => {
  it('puts remote group topics into virtualized list items', () => {
    const groups: SearchGroup[] = [{
      source: 'linuxdo',
      label: 'linux.do',
      items: [topic('1', 'linuxdo'), topic('2', 'linuxdo')],
      hasMore: true,
      nextPage: 2
    }];

    const items = buildSearchListItems({
      busy: false,
      expandedGroups: { linuxdo: true },
      filteredResults: [],
      groups,
      query: 'test',
      remote: true
    });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'topic', 'topic', 'groupLoadMore']);
    expect(items.filter((item) => item.type === 'topic')).toHaveLength(2);
  });

  it('does not include group topics when the group is collapsed', () => {
    const groups: SearchGroup[] = [{
      source: 'linuxdo',
      label: 'linux.do',
      items: [topic('1', 'linuxdo')]
    }];

    const items = buildSearchListItems({
      busy: false,
      expandedGroups: { linuxdo: false },
      filteredResults: [],
      groups,
      query: 'test',
      remote: true
    });

    expect(items.map((item) => item.type)).toEqual(['groupHeader']);
  });

  it('builds category filters from merged search results', () => {
    const options = searchCategoryOptions([
      topic('1', 'linuxdo', '开发'),
      topic('2', 'linuxdo', '开发'),
      topic('3', 'v2ex', '问与答')
    ]);

    expect(options).toEqual([
      { value: 'linuxdo:开发', label: 'linux.do · 开发 2' },
      { value: 'v2ex:问与答', label: 'V2EX · 问与答 1' }
    ]);
  });
});
