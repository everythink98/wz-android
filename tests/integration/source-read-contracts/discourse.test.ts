import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCategories, getFeed } from '@/sources/feedRead';
import { searchTopics } from '@/sources/searchRead';
import { getReplies, getReply, getTopic } from '@/sources/sourceRead';
import { isLinuxDoCloudflareError } from '@/sources/errors';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { getLinuxDoCurrentUserProfile, getLinuxDoUserProfile } from '@/sources/linuxdo/account';
import { searchLinuxDoSemantic, searchLinuxDoTags, searchLinuxDoUsers } from '@/sources/linuxdo/search';
import { requirePreparedForumContent } from '@/domain/forum/topicContentSplit';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
import { DEFAULT_SEARCH_FILTERS } from '@/domain/forum/searchFilters';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({ NativeModules: {} }));

import { json, routeFetcher } from './fixtures';

function testLinuxDoAccess() {
  return { authenticated: true, userAgent: 'LinuxDo WebView UA' };
}

describe('Android local sources', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('reads linux.do author trust levels from list and topic post data', async () => {
    const fetcher = routeFetcher([
      [
        '/latest.json',
        json({
          topic_list: {
            topics: [
              {
                id: 42,
                title: 'linux.do list topic',
                slug: 'linux-list-topic',
                created_at: '2026-05-20T00:00:00.000Z',
                posts_count: 1,
                posters: [{ user_id: 7, description: 'Original Poster' }],
                notification_level: 1
              }
            ]
          },
          users: [{ id: 7, username: 'alice', trust_level: 4 }]
        })
      ],
      [
        '/t/42.json',
        json({
          id: 42,
          title: 'linux.do detail topic',
          slug: 'linux-detail-topic',
          created_at: '2026-05-20T00:00:00.000Z',
          posts_count: 2,
          notification_level: 1,
          post_stream: {
            posts: [
              {
                id: 100,
                post_number: 1,
                username: 'alice',
                trust_level: 4,
                cooked: '<p>body</p>',
                created_at: '2026-05-20T00:00:00.000Z'
              },
              {
                id: 101,
                post_number: 2,
                username: 'bob',
                trust_level: 2,
                cooked: '<p>reply</p>',
                created_at: '2026-05-20T00:01:00.000Z'
              }
            ]
          }
        })
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const feed = await getFeed({ source: 'linuxdo', fetcher });
    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(feed.items[0].authorLevelLabel).toBe('Lv4');
    expect(topic.authorLevelLabel).toBe('Lv4');
    expect(topic.replies[0].authorLevelLabel).toBe('Lv2');
  });

  it('renders the available linux.do subset when hydration omits one stream post', async () => {
    const fetcher = routeFetcher([
      [
        '/posts.json',
        json({
          post_stream: {
            posts: [
              {
                id: 32,
                post_number: 32,
                username: 'reply 32',
                cooked: '<p>32</p>',
                created_at: '2026-05-20T00:32:00.000Z'
              }
            ]
          }
        })
      ],
      [
        /.*/,
        json({
          id: 42,
          title: 'linux.do topic',
          created_at: '2026-05-20T00:00:00.000Z',
          post_stream: {
            stream: Array.from({ length: 40 }, (_, index) => index + 1),
            posts: [{ id: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' }]
          }
        })
      ]
    ]);

    const replies = await getReplies({
      source: 'linuxdo',
      id: '42',
      order: 'oldest',
      position: { kind: 'cursor', page: 16, offset: 30 },
      limit: 2,
      fetcher
    });
    expect(replies.items.map((reply) => reply.floor)).toEqual([32]);
    expect(replies).toMatchObject({
      completeness: 'partial',
      currentPage: 16,
      currentOffset: 30,
      nextPage: 17,
      nextOffset: 32,
      hasMore: true,
      totalCount: 39
    });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://linux.do/t/42.json',
      expect.stringContaining('https://linux.do/t/42/posts.json')
    ]);
  });

  it('advances the linux.do topic seed by consumed source rows', async () => {
    const topic = await getTopic({
      source: 'linuxdo',
      id: '42',
      fetcher: vi.fn(async () =>
        json({
          id: 42,
          title: 'linux.do topic',
          created_at: '2026-05-20T00:00:00.000Z',
          posts_count: 5,
          post_stream: {
            stream: [1, 2, 3, 4, 5],
            posts: [
              { id: 1, post_number: 1, username: 'op', cooked: '<p>body</p>', created_at: null },
              { id: 2, post_number: 2, username: 'first', cooked: '', created_at: null },
              {},
              { id: 4, post_number: 4, username: 'last', cooked: '', created_at: null }
            ]
          }
        })
      )
    });

    expect(topic.replies.map(({ commentId }) => commentId)).toEqual([2, 4]);
    expect(topic).toMatchObject({ replyCompleteness: 'partial', replyNextOffset: 3 });
  });

  it('rejects an explicit wrong linux.do topic identity before projecting replies', async () => {
    await expect(
      getReplies({
        source: 'linuxdo',
        id: '42',
        order: 'oldest',
        position: { kind: 'start' },
        fetcher: vi.fn(async () => json({ id: 99, post_stream: { stream: [1], posts: [] } }))
      })
    ).rejects.toThrow('主题身份不一致');
  });

  it('uses the linux.do post ID when an exact target supplies one', async () => {
    const target = { id: 101, post_number: 2, username: '', cooked: '', created_at: null };

    await expect(
      getReplies({
        source: 'linuxdo',
        id: '42',
        order: 'oldest',
        position: { kind: 'target', target: { commentId: 999, floor: 2 } },
        fetcher: vi.fn(async () => json({ id: 42, post_stream: { stream: [1, 101], posts: [target] } }))
      })
    ).rejects.toThrow('目标楼层未找到');
  });

  it('maps linux.do Discourse polls from topic JSON', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 42,
        title: 'linux.do poll topic',
        slug: 'linux-poll-topic',
        created_at: '2026-06-03T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1001],
          posts: [
            {
              id: 1001,
              username: 'alice',
              cooked: [
                '<p>投票前</p>',
                '<div class="poll" data-poll-name="poll"><ul><li>原始方案 A</li><li>原始方案 B</li></ul><div class="poll-info">0 投票人</div></div>',
                '<p>投票后</p>',
                '<iframe src="https://embed.reddit.com/r/OpenAI/comments/abc123/topic/?embed=true"></iframe>'
              ].join(''),
              created_at: '2026-06-03T00:00:00.000Z',
              post_number: 1,
              polls: [
                {
                  id: 88,
                  name: 'poll',
                  title: '选择方向',
                  type: 'multiple',
                  status: 'open',
                  public: true,
                  voters: 2,
                  min: 2,
                  max: 3,
                  options: [
                    { id: 'a1', html: '方案 A', votes: 0 },
                    { id: 'b2', html: '方案 B', votes: 4 },
                    { id: 'c3', html: '方案 C', votes: null }
                  ]
                }
              ],
              polls_votes: {
                poll: ['b2']
              }
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(topic.polls).toEqual([
      {
        id: '88',
        name: 'poll',
        postId: '1001',
        title: '选择方向',
        public: true,
        closed: false,
        multiple: true,
        participantCount: 2,
        min: 2,
        max: 3,
        voted: true,
        options: [
          { id: 'a1', label: '方案 A', count: 0, selected: false },
          { id: 'b2', label: '方案 B', count: 4, selected: true },
          { id: 'c3', label: '方案 C', selected: false }
        ]
      }
    ]);
    expect(topic.contentHtml).toContain('<forum-discourse-poll name="poll"></forum-discourse-poll>');
    expect(topic.contentHtml).not.toContain('原始方案 A');
    expect(topic.contentHtml).not.toContain('0 投票人');
    expect(topic.contentHtml).toContain('<forum-link-card');
    expect(topic.contentHtml).toContain('href="https://www.reddit.com/r/OpenAI/comments/abc123/topic/"');
    expect(topic.contentHtml).not.toContain('嵌入内容 · embed.reddit.com');
    expect(
      requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
        polls: topic.polls,
        role: 'opening',
        source: 'linuxdo',
        topicId: topic.id
      }).rows.map((row) => row.type)
    ).toEqual(['richText', 'poll', 'richText', 'richText']);
  });

  it('lets a queued Back cancellation win before Topic DOM parsing', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () =>
      json({
        id: 44,
        title: 'cancel before parse',
        slug: 'cancel-before-parse',
        created_at: '2026-06-03T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1001],
          posts: [
            {
              id: 1001,
              username: 'alice',
              cooked: '<p>ordinary safe body</p>',
              created_at: '2026-06-03T00:00:00.000Z',
              post_number: 1
            }
          ]
        }
      })
    );

    const pending = getTopic({ source: 'linuxdo', id: '44', fetcher, signal: controller.signal });
    setTimeout(() => controller.abort(), 0);

    await expect(pending).rejects.toThrow('请求已取消');
  });

  it('maps linux.do Discourse polls from reply posts', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 43,
        title: 'linux.do reply poll topic',
        slug: 'linux-reply-poll-topic',
        created_at: '2026-06-03T00:00:00.000Z',
        posts_count: 2,
        post_stream: {
          stream: [1001, 1002],
          posts: [
            {
              id: 1001,
              username: 'alice',
              cooked: '<p>正文</p>',
              created_at: '2026-06-03T00:00:00.000Z',
              post_number: 1
            },
            {
              id: 1002,
              username: 'bob',
              cooked:
                '<p>回复投票前</p><div class="poll" data-poll-name="reply-poll"><p>原始回复选项</p></div><p>回复投票后</p>',
              created_at: '2026-06-03T00:01:00.000Z',
              post_number: 2,
              polls: [
                {
                  id: 89,
                  name: 'reply-poll',
                  title: '回复里的评分',
                  type: 'number',
                  status: 'open',
                  options: [
                    { id: '1', html: '1 分', votes: 2 },
                    { id: '2', html: '2 分', votes: 3 }
                  ]
                }
              ]
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '43', fetcher });

    expect(topic.replies[0].polls).toEqual([
      {
        id: '89',
        name: 'reply-poll',
        postId: '1002',
        title: '回复里的评分',
        type: 'number',
        closed: false,
        multiple: false,
        readonly: true,
        voted: false,
        options: [
          { id: '1', label: '1 分', count: 2, selected: false },
          { id: '2', label: '2 分', count: 3, selected: false }
        ]
      }
    ]);
    expect(topic.replies[0].contentHtml).not.toContain('原始回复选项');
    expect(
      requirePreparedForumContent(topic.replies[0].preparedContent, topic.replies[0].contentHtml, {
        polls: topic.replies[0].polls,
        role: 'reply',
        source: 'linuxdo'
      }).rows.map((row) => row.type)
    ).toEqual(['richText', 'poll', 'richText']);
  });

  it('keeps linux.do tags and topic status markers from Discourse lists', async () => {
    const fetcher = vi.fn(async () =>
      json({
        topic_list: {
          topics: [
            {
              id: 406,
              title: 'linux.do solved tagged topic',
              slug: 'linux-status-topic',
              category_id: 4,
              created_at: '2026-06-04T00:00:00.000Z',
              bumped_at: '2026-06-04T00:10:00.000Z',
              posts_count: 2,
              closed: true,
              archived: true,
              pinned: true,
              slow_mode_seconds: 300,
              has_accepted_answer: true,
              tags: [{ name: '人工智能' }, { name: '快问快答' }]
            }
          ]
        },
        categories: [{ id: 4, name: '开发调优' }]
      })
    );

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '406',
      tags: ['人工智能', '快问快答'],
      closed: true,
      archived: true,
      pinned: true,
      solved: true,
      slowModeSeconds: 300
    });
  });

  it('uses linux.do unicode titles from Discourse JSON across lists and detail', async () => {
    const displayTitle = '🫥完辣，ai又来抢饭碗啦，装机仔下岗';
    const rawTitle = ':dotted_line_face:完辣，ai又来抢饭碗啦，装机仔下岗';
    const fetcher = routeFetcher([
      [
        '/t/2438917.json',
        json({
          id: 2438917,
          title: rawTitle,
          unicode_title: displayTitle,
          slug: 'topic',
          created_at: '2026-06-20T11:15:45.437Z',
          posts_count: 1,
          post_stream: {
            stream: [19367641],
            posts: [
              {
                id: 19367641,
                post_number: 1,
                username: 'chancat',
                cooked: '<p>body</p>',
                created_at: '2026-06-20T11:15:45.437Z'
              }
            ]
          }
        })
      ],
      [
        /.*/,
        json({
          topic_list: {
            topics: [
              {
                id: 2438917,
                title: rawTitle,
                unicode_title: displayTitle,
                slug: 'topic',
                created_at: '2026-06-20T11:15:45.437Z',
                bumped_at: '2026-06-20T11:15:45.437Z',
                posts_count: 1
              }
            ]
          },
          users: []
        })
      ]
    ]);

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });
    const topic = await getTopic({ source: 'linuxdo', id: '2438917', fetcher });

    expect(feed.items[0].title).toBe(displayTitle);
    expect(topic.title).toBe(displayTitle);
  });

  it('decodes linux.do numeric title entities when unicode_title is missing', async () => {
    const fetcher = routeFetcher([
      [
        '/t/2438918.json',
        json({
          id: 2438918,
          title: '&#129765;完辣，ai又来抢饭碗啦，装机仔下岗',
          slug: 'topic',
          created_at: '2026-06-20T11:15:45.437Z',
          posts_count: 1,
          post_stream: {
            stream: [19367642],
            posts: [
              {
                id: 19367642,
                post_number: 1,
                username: 'chancat',
                cooked: '<p>body</p>',
                created_at: '2026-06-20T11:15:45.437Z'
              }
            ]
          }
        })
      ],
      [
        /.*/,
        json({
          topic_list: {
            topics: [
              {
                id: 2438918,
                title: '&#129765;完辣，ai又来抢饭碗啦，装机仔下岗',
                slug: 'topic',
                created_at: '2026-06-20T11:15:45.437Z',
                bumped_at: '2026-06-20T11:15:45.437Z',
                posts_count: 1
              }
            ]
          },
          users: []
        })
      ]
    ]);

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });
    const topic = await getTopic({ source: 'linuxdo', id: '2438918', fetcher });

    expect(feed.items[0].title).toBe('🫥完辣，ai又来抢饭碗啦，装机仔下岗');
    expect(topic.title).toBe('🫥完辣，ai又来抢饭碗啦，装机仔下岗');
  });

  it('keeps linux.do accepted answers and special reply markers from topic JSON', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 407,
        title: 'linux.do accepted answer topic',
        slug: 'linux-accepted-answer-topic',
        created_at: '2026-06-04T00:00:00.000Z',
        posts_count: 2,
        closed: true,
        pinned: true,
        slow_mode_seconds: 120,
        tags: [{ name: '人工智能' }],
        accepted_answers: [
          {
            id: 2002,
            post_number: 2,
            username: 'bob'
          }
        ],
        post_stream: {
          stream: [2001, 2002],
          posts: [
            {
              id: 2001,
              post_number: 1,
              username: 'alice',
              cooked: '<p>body</p>',
              created_at: '2026-06-04T00:00:00.000Z',
              reactions: [
                { id: 'heart', count: 2 },
                { id: 'laughing', count: 1 }
              ],
              boosts: [{ id: 7 }]
            },
            {
              id: 2002,
              post_number: 2,
              username: 'bob',
              cooked: '<p>answer</p>',
              created_at: '2026-06-04T00:02:00.000Z',
              accepted_answer: true,
              wiki: true,
              hidden: true,
              post_type: 2,
              action_code: 'closed.enabled',
              needs_category_expert_approval: true,
              post_folding_status: { status: 'folded' },
              reactions: [{ id: 'distorted_face', count: 3 }],
              boosts: [{ id: 9 }, { id: 10 }]
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '407', fetcher });

    expect(topic).toMatchObject({
      tags: ['人工智能'],
      closed: true,
      pinned: true,
      solved: true,
      acceptedAnswerFloor: 2,
      slowModeSeconds: 120,
      reactionSummary: [
        { id: 'heart', count: 2 },
        { id: 'laughing', count: 1 }
      ],
      siteExtension: { boostCount: 1 }
    });
    expect(topic.replies[0]).toMatchObject({
      acceptedAnswer: true,
      wiki: true,
      hidden: true,
      folded: true,
      systemAction: true,
      actionCode: 'closed.enabled',
      reactionSummary: [{ id: 'distorted_face', count: 3 }],
      siteExtension: { boostCount: 2, needsApproval: true }
    });
  });

  it('uses linux.do boost_count when the boosts array is empty', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 408,
        title: 'linux.do boost fallback topic',
        slug: 'linux-boost-fallback-topic',
        created_at: '2026-06-04T00:00:00.000Z',
        posts_count: 2,
        post_stream: {
          stream: [2011, 2012],
          posts: [
            {
              id: 2011,
              post_number: 1,
              username: 'alice',
              cooked: '<p>body</p>',
              created_at: '2026-06-04T00:00:00.000Z',
              boosts: [],
              boost_count: 4
            },
            {
              id: 2012,
              post_number: 2,
              username: 'bob',
              cooked: '<p>reply</p>',
              created_at: '2026-06-04T00:02:00.000Z',
              boosts: [],
              boost_count: 5
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '408', fetcher });

    expect(topic.siteExtension).toEqual({ boostCount: 4 });
    expect(topic.replies[0].siteExtension).toEqual({ boostCount: 5 });
  });

  it('requests linux.do latest feed by creation time', async () => {
    const fetcher = vi.fn(async () =>
      json({
        topic_list: {
          topics: []
        },
        users: []
      })
    );

    await getFeed({ source: 'linuxdo', limit: 2, fetcher });

    expect((fetcher.mock.calls as unknown as [string][])[0]?.[0]).toBe(
      'https://linux.do/latest.json?order=created&ascending=false'
    );
  });

  it('stops linux.do feed pagination when an empty page still advertises more topics', async () => {
    const fetcher = vi.fn(async (_input: string) => {
      if (fetcher.mock.calls.length > 1) {
        throw new Error('unexpected second linux.do feed request');
      }
      return json({
        topic_list: {
          topics: [],
          more_topics_url: '/latest.json?page=1'
        },
        users: []
      });
    });

    const feed = await getFeed({ source: 'linuxdo', limit: 2, fetcher });

    expect(feed).toMatchObject({ items: [], hasMore: false, nextPage: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requests linux.do feed filters with category scoped to the same list', async () => {
    const cases = [
      { filter: 'latest', path: '/latest.json', subset: null, order: 'created', ascending: 'false' },
      { filter: 'hot', path: '/hot.json', subset: null, order: null, ascending: null },
      { filter: 'new-all', path: '/new.json', subset: null, order: null, ascending: null },
      { filter: 'new-topics', path: '/new.json', subset: 'topics', order: null, ascending: null },
      { filter: 'new-replies', path: '/new.json', subset: 'replies', order: null, ascending: null }
    ] as const;
    const fetcher = vi.fn(async () =>
      json({
        topic_list: {
          topics: [
            {
              id: 500,
              title: 'linux.do filtered topic',
              slug: 'linux-filtered-topic',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ]
        },
        users: []
      })
    );

    for (const item of cases) {
      await getFeed({ source: 'linuxdo', category: '11', feedFilter: item.filter, limit: 1, fetcher });
    }

    const urls = (fetcher.mock.calls as unknown as [string][]).map(([input]) => new URL(input));
    expect(urls.map((url) => url.pathname)).toEqual(cases.map((item) => item.path));
    urls.forEach((url, index) => {
      expect(url.searchParams.get('category')).toBe('11');
      expect(url.searchParams.get('subset')).toBe(cases[index].subset);
      expect(url.searchParams.get('order')).toBe(cases[index].order ?? null);
      expect(url.searchParams.get('ascending')).toBe(cases[index].ascending ?? null);
    });
  });

  it('maps linux.do feed category ids through site categories before showing rows', async () => {
    const fetcher = routeFetcher([
      [
        '/site.json',
        json({
          categories: [{ id: 4, name: '开发调优' }]
        })
      ],
      [
        /.*/,
        json({
          topic_list: {
            topics: [
              {
                id: 404,
                title: 'linux.do mapped category',
                slug: 'mapped-category',
                category_id: 4,
                created_at: '2026-05-21T00:00:00.000Z',
                bumped_at: '2026-05-21T00:00:00.000Z',
                posts_count: 1
              }
            ]
          },
          users: []
        })
      ]
    ]);

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      categoryId: '4',
      category: '开发调优'
    });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/site.json');
  });

  it('maps linux.do topic category ids through site categories before showing details', async () => {
    const fetcher = routeFetcher([
      [
        '/site.json',
        json({
          categories: [{ id: 4, name: '开发调优' }]
        })
      ],
      [
        /.*/,
        json({
          id: 404,
          title: 'linux.do mapped detail category',
          slug: 'mapped-detail-category',
          category_id: 4,
          created_at: '2026-05-21T00:00:00.000Z',
          posts_count: 1,
          post_stream: {
            stream: [1],
            posts: [
              {
                id: 1,
                post_number: 1,
                username: 'alice',
                cooked: '<p>body</p>',
                created_at: '2026-05-21T00:00:00.000Z'
              }
            ]
          }
        })
      ]
    ]);

    const topic = await getTopic({ source: 'linuxdo', id: '404', fetcher });

    expect(topic).toMatchObject({
      categoryId: '4',
      category: '开发调优'
    });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/site.json');
  });

  it('labels linux.do feed topics without a category as uncategorized', async () => {
    const fetcher = vi.fn(async () =>
      json({
        topic_list: {
          topics: [
            {
              id: 405,
              title: 'linux.do uncategorized',
              slug: 'uncategorized',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ]
        },
        users: []
      })
    );

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      categoryId: undefined,
      category: '未分类'
    });
  });

  it('does not expose linux.do uncategorized as a category tab option', async () => {
    const fetcher = vi.fn(async () =>
      json({
        categories: [
          {
            id: 1,
            name: '未分类',
            slug: 'uncategorized'
          },
          {
            id: 2,
            name: '技术',
            slug: 'tech'
          },
          {
            id: 4,
            name: '开发调优',
            slug: 'dev',
            description_text: '只用于原站说明',
            parent_category_id: 2,
            topic_count: 88,
            read_restricted: true
          }
        ]
      })
    );

    const categories = await getCategories({ source: 'linuxdo', fetcher });

    expect(categories.items).toHaveLength(2);
    expect(categories.items.find((category) => category.id === '4')).toEqual({
      source: 'linuxdo',
      id: '4',
      name: '开发调优',
      slug: 'dev',
      parentId: '2',
      parentSlug: 'tech',
      topicCount: 88,
      readRestricted: true
    });
  });

  it('preserves explicit zero statistics for a new linux.do user', async () => {
    const fetcher = vi.fn(async () =>
      json({
        user_summary: {
          topic_count: 0,
          reply_count: 0,
          post_count: 0,
          user: { id: 7, username: 'newbie', name: 'Newbie' }
        },
        topics: []
      })
    );

    const profile = await getLinuxDoUserProfile('newbie', 'newbie', {
      cursorType: 'topics',
      fetcher
    });

    expect(profile).toMatchObject({ topicCount: 0, replyCount: 0, postCount: 0 });
  });

  it('opens a linux.do reply near-post as one anchored window', async () => {
    const stream = Array.from({ length: 120 }, (_, index) => 1000 + index);
    const posts = Array.from({ length: 20 }, (_, index) => {
      const floor = 81 + index;
      return {
        id: stream[floor - 1],
        post_number: floor,
        username: floor === 90 ? 'target' : `user-${floor}`,
        cooked: `<p>reply ${floor}</p>`,
        created_at: '2026-08-05T00:00:00.000Z',
        can_edit: false
      };
    });
    const fetcher = vi.fn(async (input: string) => {
      expect(new URL(input).pathname).toBe('/t/900/90.json');
      return json({ chunk_size: 20, post_stream: { posts, stream } });
    });

    const replies = await getReplies({
      source: 'linuxdo',
      id: '900',
      order: 'oldest',
      position: { kind: 'target', target: { floor: 90 } },
      limit: 30,
      discourseAuth: testLinuxDoAccess(),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(replies).toMatchObject({
      currentPage: 3,
      currentOffset: 79,
      previousPage: 2,
      previousOffset: 49,
      hasMore: true,
      nextPage: 4,
      nextOffset: 99,
      totalCount: 119
    });
    expect(replies.items).toContainEqual(expect.objectContaining({ floor: 90, author: 'target' }));
  });

  it('reads only the linux.do stream tail IDs and then the adjacent older IDs', async () => {
    const stream = Array.from({ length: 46 }, (_, index) => 1000 + index);
    const requestedPostIds: string[][] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/t/901.json') {
        return json({ post_stream: { stream, posts: [] } });
      }
      if (url.pathname === '/t/901/posts.json') {
        const ids = url.searchParams.getAll('post_ids[]');
        requestedPostIds.push(ids);
        return json({
          post_stream: {
            posts: ids.map((id) => ({
              id: Number(id),
              post_number: Number(id) - 999,
              username: `user-${id}`,
              cooked: `<p>${id}</p>`,
              created_at: '2026-08-05T00:00:00.000Z'
            }))
          }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const tail = await getReplies({
      source: 'linuxdo',
      id: '901',
      order: 'newest',
      position: { kind: 'start' },
      limit: 10,
      discourseAuth: testLinuxDoAccess(),
      fetcher
    });
    const older = await getReplies({
      source: 'linuxdo',
      id: '901',
      order: 'newest',
      position: { kind: 'cursor', page: tail.nextPage!, offset: tail.nextOffset ?? null },
      limit: 10,
      discourseAuth: testLinuxDoAccess(),
      fetcher
    });

    expect(requestedPostIds).toEqual([
      ['1041', '1042', '1043', '1044', '1045'],
      ['1031', '1032', '1033', '1034', '1035', '1036', '1037', '1038', '1039', '1040']
    ]);
    expect(tail.items.map((reply) => reply.floor)).toEqual([46, 45, 44, 43, 42]);
    expect(tail).toMatchObject({ currentPage: 5, previousPage: null, nextPage: 4, nextOffset: 30 });
    expect(older.items.map((reply) => reply.floor)).toEqual([41, 40, 39, 38, 37, 36, 35, 34, 33, 32]);
  });

  it('resolves later linux.do reply pages from the current server stream', async () => {
    let topicJsonCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/posts.json')) {
        if (!input.includes('40') || !input.includes('50')) {
          throw new Error(`stale reply stream request: ${input}`);
        }
        return json({
          post_stream: {
            posts: [
              {
                id: 40,
                post_number: 4,
                username: 'reply 4',
                cooked: '<p>4</p>',
                created_at: '2026-05-20T00:04:00.000Z'
              },
              {
                id: 50,
                post_number: 5,
                username: 'reply 5',
                cooked: '<p>5</p>',
                created_at: '2026-05-20T00:05:00.000Z'
              }
            ]
          }
        });
      }
      topicJsonCalls += 1;
      return json({
        id: 900,
        title: 'linux.do topic',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: 5,
        post_stream: {
          stream: topicJsonCalls === 1 ? [1, 2, 3, 4, 5] : [1, 2, 3, 40, 50],
          posts: [
            { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
            { id: 2, post_number: 2, username: 'reply 2', cooked: '<p>2</p>', created_at: '2026-05-20T00:02:00.000Z' },
            { id: 3, post_number: 3, username: 'reply 3', cooked: '<p>3</p>', created_at: '2026-05-20T00:03:00.000Z' }
          ]
        }
      });
    });

    const topic = await getTopic({ source: 'linuxdo', id: '900', fetcher });
    const replies = await getReplies({
      source: 'linuxdo',
      id: '900',
      order: 'oldest',
      position: {
        kind: 'cursor',
        page: topic.replyNextPage ?? 2,
        offset: topic.replyNextOffset ?? null
      },
      limit: 2,
      fetcher
    });

    expect(replies.items.map((item) => item.floor)).toEqual([4, 5]);
    expect(fetcher.mock.calls.filter((call) => String(call[0]).includes('/t/900.json'))).toHaveLength(2);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/t/900/posts.json');
  });

  it('keeps a linux.do topic-body quote preview and loads its cross-topic complete post separately', async () => {
    const fetcher = routeFetcher([
      [
        '/t/920.json',
        json({
          id: 920,
          title: 'Referenced topic',
          created_at: '2026-05-20T00:00:00.000Z',
          posts_count: 1,
          post_stream: {
            stream: [11],
            posts: [
              {
                id: 11,
                post_number: 1,
                username: 'alice',
                cooked: '<p>Complete cross-topic first paragraph.</p><p>Complete cross-topic second paragraph.</p>',
                created_at: '2026-05-20T00:00:00.000Z'
              }
            ]
          }
        })
      ],
      [
        /.*/,
        json({
          id: 910,
          title: 'Topic with external quote',
          created_at: '2026-05-20T00:00:00.000Z',
          posts_count: 1,
          post_stream: {
            stream: [1],
            posts: [
              {
                id: 1,
                post_number: 1,
                username: 'bob',
                cooked:
                  '<aside data-post="1" class="quote" data-topic="920" data-username="alice"><blockquote><p>Short cross-topic preview.</p></blockquote></aside><p>Topic body</p>',
                created_at: '2026-05-20T00:00:00.000Z'
              }
            ]
          }
        })
      ]
    ]);

    const topic = await getTopic({ source: 'linuxdo', id: '910', fetcher });
    const completePost = await getReply({ source: 'linuxdo', id: '920', floor: 1, fetcher });

    expect(topic.contentHtml).toContain('data-topic="920"');
    expect(topic.contentHtml).toContain('Short cross-topic preview.');
    expect(topic.contentHtml).not.toContain('Complete cross-topic second paragraph.');
    expect(completePost.contentHtml).toBe(
      '<p>Complete cross-topic first paragraph.</p><p>Complete cross-topic second paragraph.</p>'
    );
  });

  it('keeps a linux.do reply quote preview and loads the same-topic complete post separately', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 910,
        title: 'linux.do quoted author',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: 2,
        post_stream: {
          stream: [1, 2],
          posts: [
            {
              id: 1,
              post_number: 1,
              username: 'alice',
              cooked: '<p>Complete post first paragraph.</p><p>Complete post second paragraph.</p>',
              created_at: '2026-05-20T00:00:00.000Z'
            },
            {
              id: 2,
              post_number: 2,
              username: 'bob',
              cooked:
                '<aside data-post="1" class="quote" data-topic="910" data-username="alice"><blockquote><p>Short preview.</p></blockquote></aside><p>Reply</p>',
              created_at: '2026-05-20T00:02:00.000Z'
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '910', fetcher });
    const completePost = await getReply({ source: 'linuxdo', id: '910', floor: 1, fetcher });

    expect(topic.replies[0]).toMatchObject({
      quotedPosts: [
        {
          reference: { source: 'linuxdo', topicId: '910', postNumber: 1 },
          author: { label: 'alice', username: 'alice' },
          preview: 'Short preview.'
        }
      ],
      contentHtml: '<p>Reply</p>'
    });
    expect(completePost.contentHtml).toBe(
      '<p>Complete post first paragraph.</p><p>Complete post second paragraph.</p>'
    );
  });

  it('keeps a linux.do reply quote target topic instead of treating it as a local floor', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 2685882,
        title: 'Topic with cross-topic reply quote',
        created_at: '2026-07-31T00:00:00.000Z',
        posts_count: 2,
        post_stream: {
          stream: [1, 2],
          posts: [
            {
              id: 1,
              post_number: 7,
              username: 'local',
              cooked: '<p>Wrong local floor.</p>',
              created_at: '2026-07-31T00:00:00.000Z'
            },
            {
              id: 2,
              post_number: 8,
              username: 'bob',
              cooked:
                '<aside data-post="7" class="quote" data-topic="2679944" data-username="alice"><div class="title"><div class="quote-title__text-content"><a href="https://linux.do/t/topic/2679944/7">Referenced topic</a></div></div><blockquote><p>Cross-topic preview.</p></blockquote></aside><p>Reply body.</p>',
              created_at: '2026-07-31T00:02:00.000Z'
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '2685882', fetcher });

    expect(topic.replies[0]).toMatchObject({
      floor: 8,
      contentHtml: '<p>Reply body.</p>',
      quotedPosts: [
        {
          reference: { source: 'linuxdo', topicId: '2679944', postNumber: 7 },
          author: { label: 'alice', username: 'alice' },
          preview: 'Cross-topic preview.',
          topicTitle: 'Referenced topic',
          topicUrl: 'https://linux.do/t/topic/2679944/7'
        }
      ]
    });
  });

  it('keeps linux.do reply quote author names from quote avatar URLs', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 911,
        title: 'linux.do quoted author avatar',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: 2,
        post_stream: {
          stream: [1, 2],
          posts: [
            { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
            {
              id: 2,
              post_number: 2,
              username: 'bob',
              cooked:
                '<aside data-post="1" class="quote" data-topic="911"><div class="title"><img alt="" width="24" height="24" src="https://cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png" class="avatar"><div class="quote-title__text-content"><a href="https://linux.do/t/topic/911/1">Quoted topic</a></div></div><blockquote><p>Original text</p></blockquote></aside><p>Reply</p>',
              created_at: '2026-05-20T00:02:00.000Z'
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '911', fetcher });

    expect(topic.replies[0].quotedPosts).toEqual([
      {
        reference: { source: 'linuxdo', topicId: '911', postNumber: 1 },
        author: { label: 'alice' },
        preview: 'Original text',
        topicTitle: 'Quoted topic',
        topicUrl: 'https://linux.do/t/topic/911/1'
      }
    ]);
  });

  it('refreshes linux.do reply stream when reloading the first reply page', async () => {
    let topicJsonCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (String(input).includes('/posts.json')) {
        const url = new URL(String(input));
        const postIds = url.searchParams.getAll('post_ids[]');
        return json({
          post_stream: {
            posts: postIds.map((id) => ({
              id: Number(id),
              post_number: Number(id),
              username: `reply ${id}`,
              cooked: `<p>${id}</p>`,
              created_at: `2026-05-20T00:0${id}:00.000Z`
            }))
          }
        });
      }
      topicJsonCalls += 1;
      return json({
        id: 9901,
        title: 'linux.do refresh replies',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: topicJsonCalls === 1 ? 2 : 3,
        post_stream: {
          stream: topicJsonCalls === 1 ? [1, 2] : [1, 2, 3],
          posts: [
            { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
            { id: 2, post_number: 2, username: 'reply 2', cooked: '<p>2</p>', created_at: '2026-05-20T00:02:00.000Z' }
          ]
        }
      });
    });

    await getTopic({ source: 'linuxdo', id: '9901', fetcher });
    const replies = await getReplies({
      source: 'linuxdo',
      id: '9901',
      order: 'oldest',
      position: { kind: 'start' },
      limit: 30,
      fetcher
    });

    expect(replies.items.map((item) => item.floor)).toEqual([2, 3]);
    expect(fetcher.mock.calls.filter((call) => String(call[0]).includes('/t/9901.json'))).toHaveLength(2);
  });

  it('maps linux.do logged-in post state onto topic and reply actions', async () => {
    const fetcher = routeFetcher([
      [
        '/posts/1002.json',
        json({
          id: 1002,
          post_number: 2,
          username: 'bob',
          cooked: '<p>reply</p>',
          raw: 'reply raw',
          created_at: '2026-05-20T00:01:00.000Z',
          can_edit: true,
          can_delete: true
        })
      ],
      [
        /.*/,
        json({
          id: 900,
          title: 'linux.do logged in topic',
          slug: 'linux-do-logged-in-topic',
          created_at: '2026-05-20T00:00:00.000Z',
          posts_count: 2,
          views: 10,
          bookmarked: true,
          bookmark_id: 700,
          post_stream: {
            stream: [1001, 1002],
            posts: [
              {
                id: 1001,
                post_number: 1,
                username: 'alice',
                cooked: '<p>topic</p>',
                created_at: '2026-05-20T00:00:00.000Z',
                like_count: 3,
                actions_summary: [{ id: 2, acted: true, can_act: false }]
              },
              {
                id: 1002,
                post_number: 2,
                username: 'bob',
                cooked: '<p>reply</p>',
                created_at: '2026-05-20T00:01:00.000Z',
                can_edit: true,
                like_count: 1,
                can_delete: true,
                actions_summary: [{ id: 2, acted: false, can_act: true }]
              }
            ]
          }
        })
      ]
    ]);

    const topic = await getTopic({ source: 'linuxdo', id: '900', fetcher });

    expect(topic).toMatchObject({
      commentId: 1001,
      liked: true,
      likeCount: 3,
      canLike: false,
      bookmarked: true,
      bookmarkId: 700
    });
    expect(topic.replies[0]).toMatchObject({
      commentId: 1002,
      liked: false,
      likeCount: 1,
      canLike: true,
      canDelete: true,
      canEdit: true,
      contentMarkdown: 'reply raw'
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('marks own linux.do posts unlikable while keeping other posts likable', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 902,
        title: 'linux.do own post like permissions',
        slug: 'linux-do-own-post-like-permissions',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: 3,
        views: 10,
        post_stream: {
          stream: [2101, 2102, 2103],
          posts: [
            {
              id: 2101,
              post_number: 1,
              username: 'everythink',
              cooked: '<p>topic</p>',
              created_at: '2026-05-20T00:00:00.000Z',
              yours: true,
              actions_summary: [{ id: 2, acted: false, can_act: true }]
            },
            {
              id: 2102,
              post_number: 2,
              username: 'everythink',
              cooked: '<p>own reply</p>',
              created_at: '2026-05-20T00:01:00.000Z',
              yours: true,
              actions_summary: [{ id: 2, acted: false, can_act: true }]
            },
            {
              id: 2103,
              post_number: 3,
              username: 'alice',
              cooked: '<p>other reply</p>',
              created_at: '2026-05-20T00:02:00.000Z',
              actions_summary: [{ id: 2, acted: false, can_act: true }]
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '902', fetcher });

    expect(topic).toMatchObject({ commentId: 2101, canLike: false });
    expect(topic.replies[0]).toMatchObject({ commentId: 2102, canLike: false });
    expect(topic.replies[1]).toMatchObject({ commentId: 2103, canLike: true });
  });

  it('omits linux.do replies that the original site marks as deleted', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 901,
        title: 'linux.do deleted reply topic',
        slug: 'linux-do-deleted-reply-topic',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: 3,
        views: 10,
        post_stream: {
          stream: [2001, 2002, 2003],
          posts: [
            {
              id: 2001,
              post_number: 1,
              username: 'alice',
              cooked: '<p>topic</p>',
              created_at: '2026-05-20T00:00:00.000Z'
            },
            {
              id: 2002,
              post_number: 2,
              username: 'bob',
              cooked: '<p>visible reply</p>',
              created_at: '2026-05-20T00:01:00.000Z'
            },
            {
              id: 2003,
              post_number: 3,
              username: 'everythink',
              cooked: '<p>(帖子已被作者删除)</p>',
              created_at: '2026-05-20T00:02:00.000Z',
              deleted_at: '2026-05-20T00:03:00.000Z',
              user_deleted: true
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '901', fetcher });

    expect(topic.replies).toHaveLength(1);
    expect(topic.replies[0]).toMatchObject({
      commentId: 2002,
      contentHtml: expect.stringContaining('visible reply')
    });
  });

  it('refuses anonymous linux.do adapter search and never falls back after expiry', async () => {
    const anonymousFetcher = vi.fn();

    await expect(searchTopics({ source: 'linuxdo', query: 'codex', fetcher: anonymousFetcher })).rejects.toMatchObject({
      kind: 'login-required',
      source: 'linuxdo'
    });
    expect(anonymousFetcher).not.toHaveBeenCalled();

    const expiredFetcher = routeFetcher([
      ['linux.do/session/csrf.json', json({ csrf: 'csrf-token' })],
      ['linux.do/search?', new Response('', { status: 401 })]
    ]);
    await expect(
      searchTopics({
        source: 'linuxdo',
        query: 'codex',
        fetcher: expiredFetcher,
        discourseAuth: testLinuxDoAccess(),
        linuxDoAuthenticated: true
      })
    ).rejects.toThrow();
    expect(expiredFetcher.mock.calls.every(([input]) => new URL(String(input)).hostname === 'linux.do')).toBe(true);
  });
  it('keeps empty linux.do search responses empty instead of falling back to latest topics', async () => {
    const fetcher = routeFetcher([
      ['linux.do/session/csrf.json', json({ csrf: 'csrf-token' })],
      ['linux.do/search?', json({ topics: [], posts: [] })],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'fallback keyword',
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });

    expect(search.items).toEqual([]);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://linux.do/search');
    expect(calls).not.toContain('https://linux.do/latest.json');
  });

  it('maps Discourse first-post authors and paginates results', async () => {
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = new URL(input);
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('q')).toBe('keyword');
      expect(url.searchParams.get('page')).toBe('1');
      expect(url.searchParams.has('type_filter')).toBe(false);
      return json({
        grouped_search_result: { more_full_page_results: false },
        topics: [501, 502, 503].map((id) => ({
          id,
          title: `linux result ${id} keyword`,
          slug: `linux-result-${id}`,
          created_at: '2026-05-21T00:00:00.000Z',
          bumped_at: '2026-05-21T00:00:00.000Z',
          posts_count: 1
        })),
        posts: [501, 502, 503].map((id) => ({
          id: id + 1000,
          topic_id: id,
          post_number: 1,
          username: `author-${id}`,
          avatar_template: `/user_avatar/linux.do/author-${id}/{size}/1.png`,
          blurb: `matching post ${id}`
        })),
        users: []
      });
    });

    const first = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      limit: 1,
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });
    const second = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      page: first.nextPage ?? 2,
      limit: 1,
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });

    expect(first.items).toEqual([
      expect.objectContaining({
        id: '501',
        author: 'author-501',
        authorAvatar: 'https://linux.do/user_avatar/linux.do/author-501/96/1.png'
      })
    ]);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['502']);
    const searchCalls = fetcher.mock.calls
      .map((call) => new URL(String(call[0])))
      .filter((url) => url.pathname === '/search');
    expect(searchCalls.map((url) => url.searchParams.get('page'))).toEqual(['1', '1']);
  });

  it('does not treat Cloudflare marker text inside Discourse JSON as a challenge', async () => {
    const fetcher = routeFetcher([
      ['linux.do/session/csrf.json', json({ csrf: 'csrf-token' })],
      [
        'linux.do/search?',
        json({
          grouped_search_result: { more_full_page_results: false },
          topics: [
            {
              id: 506,
              title: 'cf-turnstile integration notes',
              slug: 'cf-turnstile-integration-notes',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ],
          posts: [
            {
              id: 1506,
              topic_id: 506,
              post_number: 1,
              username: 'author-506',
              blurb: 'ordinary discussion about challenge-platform behavior'
            }
          ],
          users: []
        })
      ]
    ]);

    const result = await searchTopics({
      source: 'linuxdo',
      query: 'cf-turnstile',
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: '506',
        title: 'cf-turnstile integration notes'
      })
    ]);
  });

  it('keeps linux.do reply matches without claiming the reply author is the OP', async () => {
    const fetcher = routeFetcher([
      ['linux.do/session/csrf.json', json({ csrf: 'csrf-token' })],
      [
        'linux.do/search?',
        json({
          grouped_search_result: { more_full_page_results: false },
          topics: [
            {
              id: 504,
              title: 'reply-only match',
              slug: 'reply-only-match',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:01:00.000Z',
              posts_count: 2,
              posters: [],
              last_poster_username: 'last-replier'
            },
            {
              id: 505,
              title: 'reply match with topic creator',
              slug: 'reply-match-with-topic-creator',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:01:00.000Z',
              posts_count: 2,
              posters: [],
              last_poster_username: 'another-last-replier',
              details: {
                created_by: {
                  username: 'topic-owner',
                  avatar_template: '/user_avatar/linux.do/topic-owner/{size}/1.png'
                }
              }
            }
          ],
          posts: [
            {
              topic_id: 504,
              post_number: 2,
              username: 'reply-author',
              avatar_template: '/user_avatar/linux.do/reply-author/{size}/1.png',
              blurb: 'matching reply'
            },
            {
              topic_id: 505,
              post_number: 2,
              username: 'another-reply-author',
              avatar_template: '/user_avatar/linux.do/another-reply-author/{size}/1.png',
              blurb: 'another matching reply'
            }
          ],
          users: []
        })
      ]
    ]);

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'reply-only',
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });

    expect(search.items).toEqual([
      expect.objectContaining({
        id: '504',
        author: '',
        excerpt: 'matching reply'
      }),
      expect.objectContaining({
        id: '505',
        author: 'topic-owner',
        excerpt: 'another matching reply'
      })
    ]);
    expect(sourceDiagnosticSummary(search)).toMatchObject({
      candidateCount: 2,
      validCount: 2,
      droppedCount: 0,
      isParseEmpty: false
    });
  });

  it('keeps official linux.do search results even when they do not contain the full query text', async () => {
    const fetcher = routeFetcher([
      [
        'linux.do/search?',
        json({
          grouped_search_result: { more_full_page_results: false },
          topics: [
            {
              id: 901,
              title: '国产安卓手机免root跳过原生esim认证申请giffgaff卡',
              slug: 'android-esim-giffgaff',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            },
            {
              id: 902,
              title: '怎么把别的手机收的短信转发到我的手机上？',
              slug: 'sms-forward',
              created_at: '2026-05-20T00:00:00.000Z',
              bumped_at: '2026-05-20T00:00:00.000Z',
              posts_count: 1
            }
          ],
          posts: [{ topic_id: 902, blurb: '官方搜索认为这个话题相关。' }],
          users: []
        })
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const search = await searchTopics({
      source: 'linuxdo',
      query: '安卓手机免',
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['901', '902']);
  });

  it('matches the official linux.do search request from the logged-in page', async () => {
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === '/session/csrf.json') {
        return json({ csrf: 'csrf-token' });
      }
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('q')).toBe('keyword');
      expect(url.searchParams.get('page')).toBe('1');
      expect(url.searchParams.has('type_filter')).toBe(false);
      return json({
        topics: [
          {
            id: 605,
            title: 'linux latest keyword',
            slug: 'linux-latest-keyword',
            created_at: '2026-05-21T00:00:00.000Z',
            bumped_at: '2026-05-21T00:00:00.000Z',
            posts_count: 1
          }
        ],
        users: []
      });
    });

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['605']);
    const calls = fetcher.mock.calls.map((call) => String(call[0])).join('\n');
    expect(calls).toContain('https://linux.do/search');
    expect(calls).not.toContain('https://linux.do/discourse-ai/embeddings/semantic-search');
    const searchCall = fetcher.mock.calls.find((call) => new URL(String(call[0])).pathname === '/search');
    const init = searchCall?.[1];
    expect(init).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Discourse-Present': 'true',
          Referer: 'https://linux.do/search?expanded=true&q=keyword',
          'X-CSRF-Token': 'csrf-token',
          'X-Requested-With': 'XMLHttpRequest'
        })
      })
    );
  });

  it('maps linux.do search result category ids through site categories', async () => {
    const fetcher = routeFetcher([
      [
        'linux.do/search?',
        json({
          topics: [
            {
              id: 701,
              title: 'linux category keyword',
              slug: 'linux-category-keyword',
              category_id: 4,
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ],
          users: []
        })
      ],
      [
        'linux.do/site.json',
        json({
          categories: [
            {
              id: 4,
              name: '开发调优',
              slug: 'dev'
            }
          ]
        })
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });

    expect(search.items[0]).toMatchObject({
      id: '701',
      categoryId: '4',
      category: '开发调优'
    });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/site.json');
  });

  it('keeps linux.do search results in the official relevance order', async () => {
    const fetcher = routeFetcher([
      [
        'linux.do/search?',
        json({
          topics: [
            {
              id: 801,
              title: 'linux older keyword',
              slug: 'linux-older-keyword',
              created_at: '2026-05-20T00:00:00.000Z',
              bumped_at: '2026-05-28T00:00:00.000Z',
              posts_count: 1
            },
            {
              id: 802,
              title: 'linux newer keyword',
              slug: 'linux-newer-keyword',
              created_at: '2026-05-22T00:00:00.000Z',
              bumped_at: '2026-05-22T00:00:00.000Z',
              posts_count: 1
            }
          ],
          users: []
        })
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['801', '802']);
  });

  it('sends gateway-supplied linux.do login access when searching', async () => {
    const fetcher = routeFetcher([
      ['/session/csrf.json', json({ csrf: 'csrf-token' })],
      [
        '/search?',
        json({
          topics: [
            {
              id: 601,
              title: 'linux logged in keyword',
              slug: 'linux-logged-in-keyword',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ],
          users: []
        })
      ],
      [
        /.*/,
        () => {
          throw new Error(`unexpected ${input} ${JSON.stringify(init)}`);
        }
      ]
    ]);

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      fetcher,
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['601']);
    const [input, init] = fetcher.mock.calls.find((call) => new URL(String(call[0])).pathname === '/search') || [];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('keyword');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('type_filter')).toBe(false);
    expect(init).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Discourse-Logged-In': 'true',
          Referer: 'https://linux.do/search?expanded=true&q=keyword',
          'User-Agent': 'LinuxDo WebView UA',
          'X-CSRF-Token': 'csrf-token',
          'X-Requested-With': 'XMLHttpRequest'
        })
      })
    );
    expect(init?.headers).not.toHaveProperty('Cookie');
  });

  it('marks visible linux.do reads ahead of background account refresh', async () => {
    const visibleFetcher = vi.fn(async (input: string) =>
      new URL(input).pathname === '/site.json' ? json({ categories: [] }) : json({ topic_list: { topics: [] } })
    );
    const accountFetcher = vi.fn(async () =>
      json({
        current_user: { id: 42, username: 'alice', name: 'Alice' }
      })
    );

    await getFeed({ source: 'linuxdo', fetcher: visibleFetcher });
    await getCategories({ source: 'linuxdo', fetcher: visibleFetcher });
    await getLinuxDoCurrentUserProfile({ fetcher: accountFetcher });

    const visibleIntents = (visibleFetcher.mock.calls as unknown as [string, RequestInit?][]).map(([, init]) =>
      browserFetchIntentFromInit(init)
    );
    const accountIntent = browserFetchIntentFromInit(
      (accountFetcher.mock.calls as unknown as [string, RequestInit?][])[0]?.[1]
    );

    expect(visibleIntents).toEqual([
      { owner: 'feed', priority: 'foreground' },
      { owner: 'feed', priority: 'foreground' }
    ]);
    expect(accountIntent).toEqual({ owner: 'account', priority: 'background' });
  });

  it('passes linux.do site filters through Discourse search syntax', async () => {
    const fetcher = vi.fn(async (input: string) =>
      input.includes('/session/csrf.json') ? json({ csrf: 'csrf-token' }) : json({ topics: [], posts: [] })
    );

    await searchTopics({
      source: 'linuxdo',
      query: 'AI',
      discourseAuth: testLinuxDoAccess(),
      linuxDoAuthenticated: true,
      categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
      filter: {
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        scope: 'title',
        category: '4',
        tags: ['人工智能'],
        username: 'alice',
        timeRange: 'all',
        order: 'latest'
      },
      fetcher
    });

    const url = new URL(
      (fetcher.mock.calls as unknown as [string][]).find((call) => new URL(call[0]).pathname === '/search')?.[0] || ''
    );
    expect(url.searchParams.get('q')).toBe('AI in:title category:4 tags:人工智能 @alice order:latest');
  });

  it('tags linux.do Cloudflare topic errors so the app can open verification', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<html><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );

    const error = await getTopic({ source: 'linuxdo', id: '123', fetcher }).catch((caught) => caught);

    expect(isLinuxDoCloudflareError(error)).toBe(true);
    expect(error).toMatchObject({
      message: 'linux.do 需要完成 Cloudflare 验证',
      source: 'linuxdo',
      reason: 'cloudflare'
    });
  });

  it('reports non-JSON linux.do HTTP errors with the HTTP status', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<html>upstream unavailable</html>', {
          status: 503,
          headers: { 'content-type': 'text/html' }
        })
    );

    await expect(getFeed({ source: 'linuxdo', fetcher })).rejects.toThrow('HTTP 503');
  });

  it('reports malformed linux.do JSON with a readable message', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<html>not json</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
    );

    await expect(getFeed({ source: 'linuxdo', fetcher })).rejects.toThrow('linux.do 返回内容格式不正确');
  });

  it('loads selectable linux.do tags with category and current selections', async () => {
    const fetcher = vi.fn(async () =>
      json({
        results: [
          { id: '人工智能', name: '人工智能', count: 12 },
          { id: '快问快答', name: '快问快答', count: 3 }
        ]
      })
    );

    const tags = await searchLinuxDoTags({
      query: '人',
      categoryId: '4',
      selectedTags: ['快问快答'],
      limit: 20,
      fetcher,
      linuxDoAccess: testLinuxDoAccess()
    });

    expect(tags).toEqual([
      { name: '人工智能', topicCount: 12 },
      { name: '快问快答', topicCount: 3 }
    ]);
    const url = new URL(String((fetcher.mock.calls as unknown as [string][])[0]?.[0]));
    expect(url.pathname).toBe('/tags/filter/search');
    expect(url.searchParams.get('q')).toBe('人');
    expect(url.searchParams.get('categoryId')).toBe('4');
    expect(url.searchParams.getAll('selected_tags[]')).toEqual(['快问快答']);
    expect(url.searchParams.get('limit')).toBe('8');
    expect(url.searchParams.has('filterForInput')).toBe(false);
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Discourse-Logged-In': 'true',
          'User-Agent': 'LinuxDo WebView UA'
        })
      })
    );
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]?.headers).not.toHaveProperty('Cookie');
  });

  it('loads selectable linux.do authors without groups', async () => {
    const fetcher = vi.fn(async () =>
      json({
        users: [
          { id: 7, username: 'alice', name: 'Alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1.png' }
        ],
        groups: [{ id: 2, name: 'staff' }]
      })
    );

    const users = await searchLinuxDoUsers({
      term: 'ali',
      categoryId: '4',
      limit: 20,
      fetcher,
      linuxDoAccess: testLinuxDoAccess()
    });

    expect(users).toEqual([
      {
        id: '7',
        username: 'alice',
        displayName: 'Alice',
        avatar: 'https://linux.do/user_avatar/linux.do/alice/96/1.png'
      }
    ]);
    const url = new URL(String((fetcher.mock.calls as unknown as [string][])[0]?.[0]));
    expect(url.pathname).toBe('/u/search/users');
    expect(url.searchParams.get('term')).toBe('ali');
    expect(url.searchParams.get('include_groups')).toBe('false');
    expect(url.searchParams.get('category_id')).toBe('4');
    expect(url.searchParams.get('limit')).toBe('20');
  });

  it('loads linux.do semantic results with an AI marker', async () => {
    const fetcher = vi.fn(async () =>
      json({
        topics: [
          {
            id: 88,
            title: 'AI semantic result',
            slug: 'ai-semantic-result',
            created_at: '2026-07-17T00:00:00.000Z',
            bumped_at: '2026-07-17T00:00:00.000Z',
            posts_count: 2
          }
        ],
        posts: [{ topic_id: 88, blurb: '[!important]+ semantic match' }],
        users: []
      })
    );

    const result = await searchLinuxDoSemantic('AI tags:人工智能', {
      fetcher,
      linuxDoAccess: testLinuxDoAccess()
    });

    expect(result.items).toEqual([
      expect.objectContaining({ id: '88', excerpt: 'semantic match', isAiGenerated: true })
    ]);
    expect(result.hasMore).toBe(false);
    expect(result.nextPage).toBeNull();
    const url = new URL(String((fetcher.mock.calls as unknown as [string][])[0]?.[0]));
    expect(url.pathname).toBe('/discourse-ai/embeddings/semantic-search');
    expect(url.searchParams.get('q')).toBe('AI tags:人工智能');
  });

  it('keeps a zero-result linux.do semantic response distinct from an API failure', async () => {
    const fetcher = vi.fn(async () => json({ topics: [], posts: [], users: [] }));

    const result = await searchLinuxDoSemantic('nothing', {
      fetcher,
      linuxDoAccess: testLinuxDoAccess()
    });

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual({});
    expect(result.hasMore).toBe(false);
  });

  it.each([403, 404, 429])('preserves HTTP %s from the linux.do semantic endpoint', async (status) => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [`HTTP ${status}`] }), {
          status,
          headers: { 'content-type': 'application/json' }
        })
    );

    await expect(
      searchLinuxDoSemantic('AI', {
        fetcher,
        linuxDoAccess: testLinuxDoAccess()
      })
    ).rejects.toMatchObject({ status });
  });

  it('preserves a network failure from the linux.do semantic endpoint', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      searchLinuxDoSemantic('AI', {
        fetcher,
        linuxDoAccess: testLinuxDoAccess()
      })
    ).rejects.toThrow('network down');
  });
});
