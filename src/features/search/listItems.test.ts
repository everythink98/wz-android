import { describe, expect, it } from 'vitest';
import { buildSearchListItems, searchGroupEmptyText, type SearchGroup } from './listItems';
import type { Topic } from '@/domain/forum/models';

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
  it('uses a two-topic non-paginating preview for the all-source overview', () => {
    const groups: SearchGroup[] = [
      {
        source: 'v2ex',
        label: 'V2EX',
        items: [topic('v1', 'v2ex'), topic('v2', 'v2ex'), topic('v3', 'v2ex')],
        hasMore: true,
        nextPage: 2
      },
      {
        source: 'linuxdo',
        label: 'linux.do',
        items: [topic('l1', 'linuxdo'), topic('l2', 'linuxdo'), topic('l3', 'linuxdo')],
        hasMore: true,
        nextPage: 2
      },
      {
        source: 'nodeseek',
        label: 'NodeSeek',
        items: [topic('n1', 'nodeseek'), topic('n2', 'nodeseek'), topic('n3', 'nodeseek')],
        hasMore: true,
        nextPage: 2
      },
      {
        source: 'yaohuo',
        label: '妖火',
        items: [topic('y1', 'yaohuo'), topic('y2', 'yaohuo'), topic('y3', 'yaohuo')],
        hasMore: true,
        nextPage: 2
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'overview' });

    expect(items.filter((item) => item.type === 'groupHeader').map((item) => item.group.source)).toEqual([
      'v2ex',
      'linuxdo',
      'nodeseek',
      'yaohuo'
    ]);
    expect(items.filter((item) => item.type === 'topic').map((item) => item.topic.id)).toEqual([
      'v1',
      'v2',
      'l1',
      'l2',
      'n1',
      'n2',
      'y1',
      'y2'
    ]);
    expect(items.some((item) => item.type === 'groupLoadMore')).toBe(false);
    expect(items[0]).toMatchObject({ type: 'groupHeader', meta: '已载入 3 条' });
  });

  it('renders the full source list and pagination sentinel without a group header', () => {
    const groups: SearchGroup[] = [
      {
        source: 'linuxdo',
        label: 'linux.do',
        items: [topic('1', 'linuxdo'), topic('2', 'linuxdo')],
        hasMore: true,
        nextPage: 2
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'source' });

    expect(items.map((item) => item.type)).toEqual(['topic', 'topic', 'groupLoadMore']);
    expect(items.filter((item) => item.type === 'topic')).toHaveLength(2);
  });

  it('keeps source auth notices visible instead of treating them as empty results', () => {
    const groups: SearchGroup[] = [
      {
        source: 'nodeseek',
        label: 'NodeSeek',
        items: [],
        authNotice: {
          kind: 'login-required',
          message: '未登录搜索，结果可能不完整。',
          tone: 'warning'
        }
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'overview' });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupAuthNotice', 'groupEmpty']);
    expect(items[1]).toMatchObject({
      type: 'groupAuthNotice',
      group: { authNotice: { message: '未登录搜索，结果可能不完整。', tone: 'warning' } }
    });
  });

  it('shows an unsettled source notice without an empty terminal state', () => {
    const groups: SearchGroup[] = [
      {
        source: 'nodeseek',
        label: 'NodeSeek',
        items: [],
        settled: false,
        authNotice: {
          kind: 'verification-required',
          message: 'NodeSeek 登录状态待确认，已暂停新请求和写入。',
          tone: 'warning'
        }
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'overview' });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupAuthNotice']);
    expect(items[0]).toMatchObject({ type: 'groupHeader', meta: '等待账号状态' });
  });

  it('[REG-SEARCH-017] shows an enabled unsettled request as loading', () => {
    const items = buildSearchListItems({
      groups: [
        {
          source: 'v2ex',
          label: 'V2EX',
          items: [],
          settled: false,
          loading: true
        }
      ],
      mode: 'overview'
    });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupLoading']);
    expect(items[0]).toMatchObject({ type: 'groupHeader', meta: '搜索中' });
  });

  it('keeps neutral auth notices out of source result bodies', () => {
    const groups: SearchGroup[] = [
      {
        source: 'nodeseek',
        label: 'NodeSeek',
        items: [],
        authNotice: {
          kind: 'logged-in',
          message: '已登录搜索。',
          tone: 'neutral'
        }
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'overview' });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupEmpty']);
    expect(items[0]).toMatchObject({ type: 'groupHeader', meta: '已载入 0 条' });
    expect(searchGroupEmptyText(groups[0])).toBe('NodeSeek 没有匹配结果');
  });

  it('renders an auth notice instead of an ordinary error when the same message is also the error', () => {
    const groups: SearchGroup[] = [
      {
        source: 'yaohuo',
        label: '妖火',
        items: [],
        authNotice: {
          kind: 'login-required',
          message: '妖火需要登录后使用此功能。',
          tone: 'warning'
        },
        error: '妖火需要登录后使用此功能。',
        errorKind: 'login-required'
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'overview' });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupAuthNotice']);
    expect(items[0]).toMatchObject({ type: 'groupHeader', meta: '需登录' });
  });

  it('keeps non-neutral auth notices visible when a separate source error also happens', () => {
    const groups: SearchGroup[] = [
      {
        source: 'nodeseek',
        label: 'NodeSeek',
        items: [],
        authNotice: {
          kind: 'login-required',
          message: '未登录搜索，结果可能不完整。',
          tone: 'warning'
        },
        error: '请求超时，请稍后重试'
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'overview' });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupAuthNotice', 'groupError']);
    expect(items[0]).toMatchObject({ type: 'groupHeader', meta: '请求失败' });
  });

  it('REG-SEARCH-002 keeps loaded topics visible when the next page fails', () => {
    const groups: SearchGroup[] = [
      {
        source: 'v2ex',
        label: 'V2EX',
        items: [topic('1', 'v2ex')],
        error: '第 2 页请求失败',
        hasMore: true,
        nextPage: 2
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'source' });

    expect(items.map((item) => item.type)).toEqual(['topic', 'groupError']);
    expect(items[0]).toMatchObject({ type: 'topic', topic: { id: '1' } });
  });

  it('keeps a first-page partial failure on the whole-source error path', () => {
    const groups: SearchGroup[] = [
      {
        source: 'v2ex',
        label: 'V2EX',
        items: [topic('1', 'v2ex')],
        error: '首屏请求失败',
        hasMore: false,
        nextPage: null
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'source' });

    expect(items.map((item) => item.type)).toEqual(['groupError']);
  });

  it('labels verification-required search groups separately from login limits', () => {
    const groups: SearchGroup[] = [
      {
        source: 'nodeseek',
        label: 'NodeSeek',
        items: [],
        authNotice: {
          kind: 'verification-required',
          message: 'NodeSeek 要求额外操作',
          tone: 'warning'
        },
        error: 'NodeSeek 要求额外操作',
        errorKind: 'verification-required'
      }
    ];

    const items = buildSearchListItems({ groups, mode: 'overview' });

    expect(items.map((item) => item.type)).toEqual(['groupHeader', 'groupAuthNotice']);
    expect(items[0]).toMatchObject({ type: 'groupHeader', meta: '需验证' });
  });
});
