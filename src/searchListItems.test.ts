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

  it('keeps source auth notices visible instead of treating them as empty results', () => {
    const groups: SearchGroup[] = [{
      source: 'nodeseek',
      label: 'NodeSeek',
      items: [],
      authNotice: {
        message: '未登录搜索，结果可能不完整。',
        tone: 'warning'
      }
    }];

    const items = buildSearchListItems({
      expandedGroups: { nodeseek: true },
      groups
    });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupAuthNotice', 'groupEmpty']);
    expect(items[1]).toMatchObject({ type: 'groupAuthNotice', group: { authNotice: { message: '未登录搜索，结果可能不完整。', tone: 'warning' } } });
  });

  it('renders an auth notice instead of an ordinary error when the same message is also the error', () => {
    const groups: SearchGroup[] = [{
      source: 'yaohuo',
      label: '妖火',
      items: [],
      authNotice: {
        message: '妖火需要登录后使用此功能。',
        tone: 'warning'
      },
      error: '妖火需要登录后使用此功能。'
    }];

    const items = buildSearchListItems({
      expandedGroups: { yaohuo: true },
      groups
    });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupAuthNotice']);
    expect(items[0]).toMatchObject({ type: 'groupHeader', meta: '受限' });
  });

  it('keeps non-neutral auth notices visible when a separate source error also happens', () => {
    const groups: SearchGroup[] = [{
      source: 'nodeseek',
      label: 'NodeSeek',
      items: [],
      authNotice: {
        message: '未登录搜索，结果可能不完整。',
        tone: 'warning'
      },
      error: '请求超时，请稍后重试'
    }];

    const items = buildSearchListItems({
      expandedGroups: { nodeseek: true },
      groups
    });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupAuthNotice', 'groupError']);
    expect(items[0]).toMatchObject({ type: 'groupHeader', meta: '读取失败' });
  });

});
