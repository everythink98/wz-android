import { withTrackedDomParse, withTrackedParseHtml } from '../../../tests/helpers/trackedParseHtml';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLinuxDoCategories, getLinuxDoFeed, resetLinuxDoCategoryCacheForTests } from './reader';

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  });
}

function topic(index: number) {
  return {
    id: index,
    slug: `topic-${index}`,
    title: `Topic ${index}`,
    created_at: '2026-08-15T00:00:00.000Z',
    posts_count: 1
  };
}

describe('linux.do reader', () => {
  beforeEach(() => resetLinuxDoCategoryCacheForTests());

  it('[REG-PERF-017][REG-TOPIC-115] keeps an author-deleted opening placeholder with one DOM parse', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      const openingMarker = 'data-content-marker="linuxdo-opening-once"';
      const replyMarker = 'data-content-marker="linuxdo-reply-once"';
      const fetcher = vi.fn(async () =>
        json({
          id: 2780439,
          title: '发个红包，爱你们各位佬',
          slug: 'prepared-topic',
          created_at: '2026-08-15T00:00:00.000Z',
          bumped_at: '2026-08-15T00:01:00.000Z',
          posts_count: 2,
          categories: [],
          post_stream: {
            stream: [1, 2],
            posts: [
              {
                id: 1,
                username: 'alice',
                cooked: `<p ${openingMarker}>（话题已被作者删除）</p>`,
                created_at: '2026-08-15T00:00:00.000Z',
                post_number: 1,
                user_deleted: true,
                deleted_at: null
              },
              {
                id: 2,
                username: 'bob',
                cooked: `<p ${replyMarker}>回复</p>`,
                created_at: '2026-08-15T00:01:00.000Z',
                post_number: 2
              }
            ]
          }
        })
      );

      const [{ getLinuxDoTopic }, { requirePreparedForumContent }] = await Promise.all([
        import('./reader'),
        import('@/domain/forum/topicContentSplit')
      ]);
      const topic = await getLinuxDoTopic('2780439', { fetcher });
      const reply = topic.replies[0];

      expect(topic).toMatchObject({
        id: '2780439',
        title: '发个红包，爱你们各位佬',
        contentHtml: expect.stringContaining('话题已被作者删除')
      });
      expect(
        requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
          role: 'opening',
          source: 'linuxdo',
          topicId: topic.id
        }).rows
      ).not.toHaveLength(0);
      expect(
        requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
          role: 'reply',
          source: 'linuxdo'
        }).rows
      ).not.toHaveLength(0);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(openingMarker))).toHaveLength(1);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(replyMarker))).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  it('[REG-TOPIC-115] rejects an author-deleted opening without renderable content', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 2780439,
        title: '发个红包，爱你们各位佬',
        slug: 'deleted-topic',
        created_at: '2026-08-15T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1],
          posts: [
            {
              id: 1,
              username: 'alice',
              cooked: '',
              created_at: '2026-08-15T00:00:00.000Z',
              post_number: 1,
              user_deleted: true,
              deleted_at: null
            }
          ]
        }
      })
    );
    const { getLinuxDoTopic } = await import('./reader');

    await expect(getLinuxDoTopic('2780439', { fetcher })).rejects.toThrow('linux.do 主题正文解析失败');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('[REG-TOPIC-115] prepares a media-only author-deleted opening with one DOM parse', async () => {
    await withTrackedDomParse(async (trackedParseHtml) => {
      const openingMarker = 'data-content-marker="linuxdo-deleted-media-once"';
      const fetcher = vi.fn(async () =>
        json({
          id: 2780439,
          title: '发个红包，爱你们各位佬',
          slug: 'deleted-topic',
          created_at: '2026-08-15T00:00:00.000Z',
          posts_count: 1,
          post_stream: {
            stream: [1],
            posts: [
              {
                id: 1,
                username: 'alice',
                cooked: `<img ${openingMarker} src="https://cdn.example/deleted.webp">`,
                created_at: '2026-08-15T00:00:00.000Z',
                post_number: 1,
                user_deleted: true,
                deleted_at: null
              }
            ]
          }
        })
      );
      const [{ getLinuxDoTopic }, { requirePreparedForumContent }] = await Promise.all([
        import('./reader'),
        import('@/domain/forum/topicContentSplit')
      ]);

      const topic = await getLinuxDoTopic('2780439', { fetcher });
      const plan = requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
        role: 'opening',
        source: 'linuxdo',
        topicId: topic.id
      });

      expect(plan.previewImages).toEqual([expect.objectContaining({ source: 'https://cdn.example/deleted.webp' })]);
      expect(plan.rows.some((row) => row.networkMediaCount > 0)).toBe(true);
      expect(trackedParseHtml.mock.calls.filter(([value]) => String(value).includes(openingMarker))).toHaveLength(1);
    });
  });

  it('[REG-PERF-016] trusts the server cursor instead of probing one extra list page', async () => {
    const fetcher = vi.fn(async () =>
      json({
        topic_list: {
          topics: Array.from({ length: 30 }, (_, index) => topic(index + 1)),
          more_topics_url: '/latest?order=created&page=1'
        }
      })
    );

    const result = await getLinuxDoFeed({ fetcher, limit: 30 });

    expect(result.items).toHaveLength(30);
    expect(result).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('[REG-PERF-016] shares one category request across catalog and feed in the same read scope', async () => {
    const fetcher = vi.fn(async (input: string) =>
      input.includes('/site.json')
        ? json({ category_list: { categories: [{ id: 5, name: 'Performance', slug: 'performance' }] } })
        : json({
            topic_list: {
              topics: [{ ...topic(1), category_id: 5 }]
            }
          })
    );

    const [categories, feed] = await Promise.all([
      getLinuxDoCategories({ categoryCacheScope: 'public:omit', fetcher }),
      getLinuxDoFeed({ categoryCacheScope: 'public:omit', fetcher, limit: 1 })
    ]);
    const cachedCategories = await getLinuxDoCategories({ categoryCacheScope: 'public:omit', fetcher });

    expect(categories.items).toEqual([expect.objectContaining({ id: '5', name: 'Performance' })]);
    expect(cachedCategories.items).toEqual(categories.items);
    expect(feed.items).toEqual([expect.objectContaining({ category: 'Performance' })]);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/site.json'))).toHaveLength(1);
  });

  it('[REG-PERF-016] replaces category metadata when the read scope changes', async () => {
    let siteRequest = 0;
    const fetcher = vi.fn(async () => {
      siteRequest += 1;
      return json({
        category_list: {
          categories: [{ id: 5, name: siteRequest === 1 ? 'Account A' : 'Account B', slug: 'private' }]
        }
      });
    });

    const accountA = await getLinuxDoCategories({ categoryCacheScope: 'authenticated:1', fetcher });
    const accountB = await getLinuxDoCategories({ categoryCacheScope: 'authenticated:2', fetcher });

    expect(accountA.items[0]?.name).toBe('Account A');
    expect(accountB.items[0]?.name).toBe('Account B');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
