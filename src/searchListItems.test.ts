import { describe, expect, it } from 'vitest';
import { buildSearchListItems, type SearchGroup } from './searchListItems';
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
      expandedGroups: { linuxdo: true },
      groups
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
      expandedGroups: { linuxdo: false },
      groups
    });

    expect(items.map((item) => item.type)).toEqual(['groupHeader']);
  });

});
