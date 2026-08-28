import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFeed } from '@/sources/feedRead';
import { searchTopics } from '@/sources/searchRead';
import { getReplies, getTopic } from '@/sources/sourceRead';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({ NativeModules: {} }));

import { html, json, routeFetcher } from './fixtures';

describe('Android local sources', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('reads V2EX Pro labels from the topic API and origin reply badges', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 810,
            title: 'V2EX Pro topic',
            url: 'https://www.v2ex.com/t/810',
            created: 1780000000,
            replies: 1,
            member: { username: 'neo', pro: 1 },
            content_rendered: '<p>detail body</p>'
          }
        ])
      ],
      [
        '/api/replies/show.json',
        json([
          {
            id: 7001,
            member: { username: 'alice', pro: true },
            content_rendered: '<p>first reply</p>',
            created: 1780000100
          }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/810' },
        html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":1}
            ]}
          </script>
          <div id="r_7001" class="cell">
            <img class="avatar" src="//cdn.v2ex.com/alice.png" />
            <span class="no">1</span>
            <strong><a href="/member/alice" class="dark">alice</a></strong>
            <div class="badges"><div class="badge pro">PRO</div></div>
            <div class="reply_content">first reply</div>
          </div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '810', fetcher });

    expect(topic.authorLevelLabel).toBe('Pro');
    expect(topic.replies[0].authorLevelLabel).toBe('Pro');
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=810&page=1'
    );
  });

  it('reads V2EX public JSON, HTML pages, topic detail, and SOV2EX search directly', async () => {
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/?tab=all' },
        html(
          '<div class="cell item"><a href="/member/neo"><img class="avatar" src="//cdn.v2ex.com/a.png" alt="neo"></a><span class="item_title"><a class="topic-link" href="/t/121#reply3">V2EX latest</a></span><span class="topic_info"><a class="node" href="/go/create">分享创造</a> &nbsp;•&nbsp; <strong><a href="/member/neo">neo</a></strong> &nbsp;•&nbsp; <span title="2026-05-28 20:35:00 +08:00"></span></span><td width="70" align="right"><a href="/t/121#reply3" class="count_livid">3</a></td></div><a href="/recent">更多新主题</a>'
        )
      ],
      [
        '/api/topics/latest.json',
        json([
          {
            id: 121,
            title: 'V2EX latest',
            url: 'https://www.v2ex.com/t/121',
            created: 1780000000,
            last_touched: 1780000100,
            replies: 3,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo', avatar_normal: '//cdn.v2ex.com/a.png' },
            content: 'latest body'
          }
        ])
      ],
      [
        '/recent?p=2',
        html(
          '<div class="cell"><a class="topic-link" href="/t/122#reply1">V2EX page 2</a><a class="node" href="/go/create">分享创造</a><a href="/member/bob">bob</a><span title="2026-05-20 10:00:00"></span><a class="count_livid">1</a></div><a href="/recent?p=3">下一页</a>'
        )
      ],
      [
        '/api/topics/show.json',
        json([
          {
            id: 121,
            title: 'V2EX detail',
            url: 'https://www.v2ex.com/t/121',
            created: 1780000000,
            replies: 1,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo' },
            content_rendered: '<p>detail</p>'
          }
        ])
      ],
      [
        '/api/replies/show.json',
        json([{ member: { username: 'bob' }, content_rendered: '<p>reply</p>', created: 1780000200 }])
      ],
      [
        'sov2ex.com',
        json({
          hits: {
            hits: [
              {
                _source: { id: 121, title: 'V2EX search', member: 'neo', created: '2026-05-20T00:00:00', replies: 1 },
                highlight: { title: ['V2EX search'] }
              }
            ]
          }
        })
      ],
      [/.*/, json({})]
    ]);

    const first = await getFeed({ source: 'v2ex', fetcher });
    const second = await getFeed({ source: 'v2ex', page: 2, fetcher });
    const topic = await getTopic({ source: 'v2ex', id: '121', fetcher });
    const replies = await getReplies({
      source: 'v2ex',
      id: '121',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });
    const search = await searchTopics({ source: 'v2ex', query: 'V2EX', fetcher });

    expect(first.items[0]).toMatchObject({ id: '121', categoryId: 'create' });
    expect(second.items[0]).toMatchObject({ id: '122', author: 'bob' });
    expect(topic.contentHtml).toContain('detail');
    expect(replies.items[0]).toMatchObject({ author: 'bob', floor: 1 });
    expect(search.items[0]).toMatchObject({ id: '121', title: 'V2EX search' });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(
      /\/api\/feed|http:\/\/10\.0\.2\.2|http:\/\/127\.0\.0\.1:3000/
    );
  });

  it('reads the V2EX all feed from the origin all tab instead of the latest API', async () => {
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/?tab=all' },
        html(`
          <div class="cell item">
            <a href="/member/alice"><img class="avatar" src="//cdn.v2ex.com/a.png" alt="alice"></a>
            <span class="item_title"><a class="topic-link" href="/t/801#reply2">V2EX all active topic</a></span>
            <span class="topic_info">
              <a class="node" href="/go/qna">问与答</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 08:30:00 +08:00">Just Now</span> &nbsp;•&nbsp;
              Lastly replied by <strong><a href="/member/bob">bob</a></strong>
            </span>
            <td width="70" align="right"><a href="/t/801#reply2" class="count_livid">2</a></td>
          </div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const feed = await getFeed({ source: 'v2ex', limit: 1, fetcher });

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['https://www.v2ex.com/?tab=all']);
    expect(feed.items[0]).toMatchObject({
      id: '801',
      title: 'V2EX all active topic',
      author: 'alice',
      categoryId: 'qna',
      replyCount: 2,
      lastReplyAt: '2026-05-29T00:30:00.000Z'
    });
  });

  it('reads the V2EX latest feed from the origin recent page', async () => {
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/recent?p=1' },
        html(`
          <div class="cell">
            <span class="item_title"><a class="topic-link" href="/t/821#reply0">V2EX recent topic</a></span>
            <span class="topic_info">
              <a class="node" href="/go/qna">问与答</a> &nbsp;•&nbsp;
              <a href="/member/alice">alice</a> &nbsp;•&nbsp;
              <span title="2026-05-29 09:30:00">Just Now</span>
            </span>
          </div>
          <a href="/recent?p=2">下一页</a>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const feed = await getFeed({ source: 'v2ex', feedFilter: 'latest', limit: 1, fetcher });

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['https://www.v2ex.com/recent?p=1']);
    expect(feed.items[0]).toMatchObject({
      id: '821',
      title: 'V2EX recent topic'
    });
    expect(feed.hasMore).toBe(true);
    expect(feed.nextPage).toBe(2);
  });

  it('reads the V2EX hot feed as a finite origin tab', async () => {
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/?tab=hot' },
        html(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/822#reply8">V2EX hot topic</a></span>
            <span class="topic_info">
              <a class="node" href="/go/qna">问与答</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 10:30:00 +08:00">Just Now</span>
            </span>
            <td width="70" align="right"><a href="/t/822#reply8" class="count_livid">8</a></td>
          </div>
          <a href="/recent">更多新主题</a>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const feed = await getFeed({ source: 'v2ex', feedFilter: 'hot', limit: 1, fetcher });

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['https://www.v2ex.com/?tab=hot']);
    expect(feed.items[0]).toMatchObject({
      id: '822',
      title: 'V2EX hot topic',
      replyCount: 8
    });
    expect(feed.hasMore).toBe(false);
    expect(feed.nextPage).toBeNull();
  });

  it('ignores malformed V2EX node links without dropping the topic', async () => {
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/?tab=all' },
        html(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/813#reply0">V2EX malformed node</a></span>
            <span class="topic_info">
              <a class="node" href="/go/%E0%A4%A">坏节点</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 08:30:00 +08:00">Just Now</span>
            </span>
          </div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const feed = await getFeed({ source: 'v2ex', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '813',
      title: 'V2EX malformed node',
      category: '坏节点'
    });
    expect(feed.items[0].categoryId).toBeUndefined();
  });

  it('treats V2EX HTML times without a zone as China time', async () => {
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/?tab=all' },
        html(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/812#reply0">V2EX unzoned time</a></span>
            <span class="topic_info">
              <a class="node" href="/go/create">分享创造</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 08:30:00">Just Now</span>
            </span>
          </div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const feed = await getFeed({ source: 'v2ex', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '812',
      lastReplyAt: '2026-05-29T00:30:00.000Z'
    });
  });

  it('uses the V2EX topic reply badge instead of vote counts in HTML lists', async () => {
    const fetcher = routeFetcher([
      [
        '/go/create?p=1',
        html(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/802#reply357">V2EX voted topic</a></span>
            <span class="topic_info">
              <div class="votes"><a class="count_orange">1</a></div>
              <a class="node" href="/go/create">分享创造</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 08:20:00 +08:00">10 mins ago</span>
            </span>
            <td width="70" align="right"><a href="/t/802#reply357" class="count_livid">357</a></td>
          </div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const feed = await getFeed({ source: 'v2ex', category: 'create', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '802',
      replyCount: 357
    });
  });

  it('does not let stale V2EX last_touched predate topic creation on Android', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 701,
            title: 'Fresh V2EX topic',
            url: 'https://www.v2ex.com/t/701',
            created: 1780000500,
            last_touched: 1780000000,
            replies: 0,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo' }
          }
        ])
      ],
      ['/api/replies/show.json', json([])],
      [
        { exact: 'https://www.v2ex.com/t/701' },
        html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":0}
            ]}
          </script>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '701', fetcher });

    expect(topic).toMatchObject({
      createdAt: '2026-05-28T20:35:00.000Z',
      lastReplyAt: '2026-05-28T20:35:00.000Z',
      replyCount: 0,
      replies: [],
      replyHasMore: false,
      replyNextPage: null
    });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=701&page=1'
    );
  });

  it('enriches V2EX topic details from the origin HTML without login-only actions', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 810,
            title: 'V2EX enriched detail',
            url: 'https://www.v2ex.com/t/810',
            created: 1780000000,
            last_touched: 1780000200,
            replies: 1,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ])
      ],
      [
        '/api/replies/show.json',
        json([
          { id: 7001, member: { username: 'alice' }, content_rendered: '<p>first reply</p>', created: 1780000100 },
          {
            id: 7002,
            member: { username: 'neo' },
            content_rendered: '@<a href="/member/alice">alice</a> answer',
            created: 1780000200
          }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/810' },
        html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ViewAction","userInteractionCount":743},
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":2}
            ]}
          </script>
          <div id="topic_810_votes" class="votes">
            <a href="javascript:" onclick="upVoteTopic(810);" class="vote">▲ 27</a>
            <a href="javascript:" onclick="downVoteTopic(810);" class="vote">▼</a>
          </div>
          <a href="/tag/开户" class="tag">开户</a>
          <a href="/tag/券商" class="tag"><span></span> 券商</a>
          <div class="subtle">
            <span class="fade">Supplement 1 &nbsp;·&nbsp; <span title="2026-05-28 10:24:10 +08:00">23h ago</span></span>
            <div class="topic_content"><p>补充正文 <img src="/supplement.svg" /></p></div>
          </div>
          <div id="r_7001" class="cell"><img class="avatar" src="//cdn.v2ex.com/alice.png"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><span class="ago" title="2026-05-28 10:01:40 +08:00">1h ago</span><div class="reply_content">first reply</div></div>
          <div id="r_7002" class="cell"><img class="avatar" src="//cdn.v2ex.com/neo.png"><span class="no">2</span><strong><a href="/member/neo">neo</a></strong><span class="ago" title="2026-05-28 10:03:20 +08:00">1h ago</span><span class="small fade"><img src="/static/img/heart_20250818.png" alt="heart"> 2</span><div class="reply_content">@<a href="/member/alice">alice</a> answer</div></div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '810', fetcher });

    expect(topic.replyCount).toBe(2);
    expect(topic.viewCount).toBe(743);
    expect(topic.upvoteCount).toBe(27);
    expect(topic.tags).toEqual(['开户', '券商']);
    expect(topic.contentHtml).toContain('补充 1');
    expect(topic.contentHtml).toContain('补充正文');
    expect(topic.contentHtml).toContain('https://www.v2ex.com/supplement.svg');
    expect(topic.replies[0]).toMatchObject({ commentId: 7001, floor: 1 });
    expect(topic.replies[1]).toMatchObject({
      author: 'neo',
      commentId: 7002,
      floor: 2,
      replyTarget: { author: { name: 'alice', username: 'alice' } },
      thanksCount: 2
    });
  });

  it('trusts a complete V2EX origin reply snapshot over stale public JSON caches', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 817,
            title: 'V2EX active reply race',
            url: 'https://www.v2ex.com/t/817',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ])
      ],
      [
        '/api/replies/show.json',
        json([
          { id: 8201, member: { username: 'alice' }, content_rendered: '<p>first stale reply</p>' },
          { id: 8202, member: { username: 'bob' }, content_rendered: '<p>second stale reply</p>' }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/817' },
        html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":3}
            ]}
          </script>
          <div id="r_8201" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first current reply</div></div>
          <div id="r_8202" class="cell"><span class="no">2</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second current reply</div></div>
          <div id="r_8203" class="cell"><span class="no">3</span><strong><a href="/member/carol">carol</a></strong><div class="reply_content">third current reply</div></div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '817', fetcher });

    expect(topic.replyCount).toBe(3);
    expect(topic.replies.map(({ commentId, floor }) => [commentId, floor])).toEqual([
      [8201, 1],
      [8202, 2],
      [8203, 3]
    ]);
    expect(sourceDiagnosticSummary(topic)).toMatchObject({ parserVariant: 'html-topic', partialErrorCount: 0 });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=817&page=1'
    );
  });

  it('exposes V2EX body and usable first-page rows without reading linked pages in the Topic query', async () => {
    const rows = (firstFloor: number, lastFloor: number) =>
      Array.from({ length: lastFloor - firstFloor + 1 }, (_, index) => firstFloor + index)
        .map(
          (floor) => `
            <div id="r_${92000 + floor}" class="cell">
              <span class="no">${floor}</span>
              <strong><a href="/member/user-${floor}">user-${floor}</a></strong>
              <div class="reply_content">reply ${floor}</div>
            </div>
          `
        )
        .join('');
    let pageCalls = 0;
    let replyApiCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 1232881,
            title: 'V2EX reply snapshot race',
            url: 'https://www.v2ex.com/t/1232881',
            created: 1780000000,
            replies: 105,
            member: { username: 'neo' },
            content_rendered: '<p>body remains available</p>'
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        replyApiCalls += 1;
        throw new Error('public replies API must not run during the topic read');
      }
      if (input === 'https://www.v2ex.com/t/1232881') {
        return html(`
          <script type="application/ld+json">{"commentCount":106,"interactionStatistic":[{"interactionType":"https://schema.org/ReplyAction","userInteractionCount":106}]}</script>
          ${rows(1, 100)}
          <a href="?p=2">2</a>
        `);
      }
      if (input === 'https://www.v2ex.com/t/1232881?p=2') {
        pageCalls += 1;
        throw new Error('the topic read must not wait for page two');
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '1232881', fetcher });

    expect(topic.contentHtml).toContain('body remains available');
    expect(topic.replyCount).toBe(106);
    expect(topic.replies.map(({ floor }) => floor)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    expect(topic).toMatchObject({ replyCompleteness: 'complete', replyHasMore: true, replyNextPage: 2 });
    expect(sourceDiagnosticSummary(topic)).toMatchObject({ parserVariant: 'html-topic' });
    expect(pageCalls).toBe(0);
    expect(replyApiCalls).toBe(0);
  });

  it('reads a linked V2EX page only when its cursor is requested and preserves its retry', async () => {
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/t/1233404' },
        html(`
          <script type="application/ld+json">{"commentCount":147}</script>
          <div id="r_93401" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <a href="?p=2">2</a>
        `)
      ],
      [
        { exact: 'https://www.v2ex.com/t/1233404?p=2' },
        () => {
          throw new Error('page two unavailable');
        }
      ]
    ]);

    const firstPage = await getReplies({
      source: 'v2ex',
      id: '1233404',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });
    expect(firstPage).toMatchObject({
      completeness: 'partial',
      currentPage: 1,
      hasMore: true,
      nextPage: 2,
      totalCount: 147
    });
    await expect(
      getReplies({
        source: 'v2ex',
        id: '1233404',
        order: 'oldest',
        position: { kind: 'cursor', page: 2, offset: null },
        replyCount: 147,
        fetcher
      })
    ).rejects.toThrow('page two unavailable');
  });

  it('keeps every parsed V2EX page row when a later declaration changes', async () => {
    const rows = (firstFloor: number, lastFloor: number) =>
      Array.from({ length: lastFloor - firstFloor + 1 }, (_, index) => firstFloor + index)
        .map(
          (floor) => `
            <div id="r_${93000 + floor}" class="cell">
              <span class="no">${floor}</span>
              <strong><a href="/member/user-${floor}">user-${floor}</a></strong>
              <div class="reply_content">reply ${floor}</div>
            </div>
          `
        )
        .join('');
    const declaration = (count: number) => `
      <script type="application/ld+json">{"commentCount":${count},"interactionStatistic":[{"interactionType":"https://schema.org/ReplyAction","userInteractionCount":${count}}]}</script>
    `;
    const fetcher = routeFetcher([
      [{ exact: 'https://www.v2ex.com/t/1232881' }, html(`${declaration(106)}${rows(1, 100)}<a href="?p=2">2</a>`)],
      [{ exact: 'https://www.v2ex.com/t/1232881?p=2' }, html(`${declaration(105)}${rows(101, 105)}`)],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const firstPage = await getReplies({
      source: 'v2ex',
      id: '1232881',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });
    const replies = await getReplies({
      source: 'v2ex',
      id: '1232881',
      order: 'oldest',
      position: { kind: 'cursor', page: 2, offset: null },
      replyCount: firstPage.totalCount,
      fetcher
    });

    expect(firstPage.items.map(({ floor }) => floor)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    expect(firstPage).toMatchObject({ completeness: 'complete', nextPage: 2, totalCount: 106 });
    expect(replies.items.map(({ floor }) => floor)).toEqual(Array.from({ length: 5 }, (_, index) => index + 101));
    expect(replies).toMatchObject({ completeness: 'partial', totalCount: 106 });
  });

  it.each([
    { declaration: '<script type="application/ld+json">{"commentCount":1}</script>', name: 'stale-low' },
    { declaration: '', name: 'missing' }
  ])('follows an explicit V2EX page link when the first declaration is $name', async ({ declaration }) => {
    let pageCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/t/827') {
        return html(`
            ${declaration}
            <div id="r_8271" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
            <a href="?p=2">2</a>
          `);
      }
      if (input === 'https://www.v2ex.com/t/827?p=2') {
        pageCalls += 1;
        return html(`
            <script type="application/ld+json">{"commentCount":101}</script>
            <div id="r_8272" class="cell"><span class="no">101</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second</div></div>
          `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const firstPage = await getReplies({
      source: 'v2ex',
      id: '827',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });

    expect(pageCalls).toBe(0);
    expect(firstPage.items.map(({ commentId }) => commentId)).toEqual([8271]);
    expect(firstPage).toMatchObject({ hasMore: true, nextPage: 2 });

    const secondPage = await getReplies({
      source: 'v2ex',
      id: '827',
      order: 'oldest',
      position: { kind: 'cursor', page: 2, offset: null },
      replyCount: firstPage.totalCount,
      fetcher
    });
    expect(pageCalls).toBe(1);
    expect(secondPage.items.map(({ commentId }) => commentId)).toEqual([8272]);
  });

  it('keeps distinct V2EX comment IDs that claim the same floor', async () => {
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/t/828' },
        html(`
          <script type="application/ld+json">{"commentCount":2}</script>
          <div id="r_8281" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <div id="r_8282" class="cell"><span class="no">1</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second</div></div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const replies = await getReplies({
      source: 'v2ex',
      id: '828',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });

    expect(replies.items.map(({ commentId, floor }) => ({ commentId, floor }))).toEqual([
      { commentId: 8281, floor: 1 },
      { commentId: 8282, floor: 1 }
    ]);
    expect(replies).toMatchObject({ completeness: 'partial', totalCount: 2 });
  });

  it('exposes each explicitly linked V2EX page as one reply window', async () => {
    const rows = (firstFloor: number, lastFloor: number) =>
      Array.from({ length: lastFloor - firstFloor + 1 }, (_, index) => firstFloor + index)
        .map(
          (floor) => `
            <div id="r_${90000 + floor}" class="cell">
              <span class="no">${floor}</span>
              <strong><a href="/member/user-${floor}">user-${floor}</a></strong>
              <div class="reply_content">reply ${floor}</div>
            </div>
          `
        )
        .join('');
    let replyApiCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 1231874,
            title: 'V2EX paged replies',
            url: 'https://www.v2ex.com/t/1231874',
            created: 1780000000,
            replies: 107,
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        replyApiCalls += 1;
        throw new Error('public replies API must not run');
      }
      if (input === 'https://www.v2ex.com/t/1231874') {
        return html(`
          <script type="application/ld+json">{"commentCount":107,"interactionStatistic":[{"interactionType":"https://schema.org/ReplyAction","userInteractionCount":107}]}</script>
          ${rows(1, 100)}
          <a href="?p=2">2</a>
        `);
      }
      if (input === 'https://www.v2ex.com/t/1231874?p=2') {
        return html(`
          <script type="application/ld+json">{"commentCount":107,"interactionStatistic":[{"interactionType":"https://schema.org/ReplyAction","userInteractionCount":107}]}</script>
          ${rows(101, 107)}
          <a href="?p=1">1</a>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '1231874', fetcher });

    expect(topic.replyCount).toBe(107);
    expect(topic.replies).toHaveLength(100);
    expect(topic).toMatchObject({ replyCompleteness: 'complete', replyHasMore: true, replyNextPage: 2 });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain('https://www.v2ex.com/t/1231874?p=2');

    fetcher.mockClear();
    const replies = await getReplies({
      source: 'v2ex',
      id: '1231874',
      order: 'oldest',
      position: { kind: 'cursor', page: 2, offset: null },
      replyCount: topic.replyCount,
      fetcher
    });

    expect(replies.items.map(({ floor }) => floor)).toEqual(Array.from({ length: 7 }, (_, index) => index + 101));
    expect(replies).toMatchObject({
      completeness: 'complete',
      currentPage: 2,
      previousPage: 1,
      hasMore: false,
      nextPage: null,
      totalCount: 107
    });
    expect(replyApiCalls).toBe(0);
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual(['https://www.v2ex.com/t/1231874?p=2']);

    fetcher.mockClear();
    const newestReplies = await getReplies({
      source: 'v2ex',
      id: '1231874',
      order: 'newest',
      position: { kind: 'start' },
      replyCount: topic.replyCount,
      fetcher
    });
    expect(newestReplies.items.map(({ floor }) => floor)).toEqual(Array.from({ length: 7 }, (_, index) => 107 - index));
    expect(newestReplies).toMatchObject({ currentPage: 2, hasMore: true, nextPage: 1, totalCount: 107 });
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      'https://www.v2ex.com/t/1231874',
      'https://www.v2ex.com/t/1231874?p=2'
    ]);

    fetcher.mockClear();
    const targetReplies = await getReplies({
      source: 'v2ex',
      id: '1231874',
      order: 'oldest',
      position: { kind: 'target', target: { floor: 105 } },
      replyCount: topic.replyCount,
      fetcher
    });
    expect(targetReplies.items.map(({ floor }) => floor)).toEqual(Array.from({ length: 7 }, (_, index) => index + 101));
    expect(targetReplies).toMatchObject({ currentPage: 2, previousPage: 1, hasMore: false, nextPage: null });
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      'https://www.v2ex.com/t/1231874',
      'https://www.v2ex.com/t/1231874?p=2'
    ]);
  });

  it.each([
    {
      name: 'a changed reply declaration on page two',
      firstLink: '/t/1231875?p=2',
      secondCount: 108,
      secondFloors: Array.from({ length: 7 }, (_, index) => index + 101),
      expectedSecondFloors: Array.from({ length: 7 }, (_, index) => index + 101),
      expectedPageCalls: 1
    },
    {
      name: 'a missing floor after the explicit links are exhausted',
      firstLink: '/t/1231875?p=2',
      secondCount: 107,
      secondFloors: [101, 102, 103, 104, 106, 107],
      expectedSecondFloors: [101, 102, 103, 104, 106, 107],
      expectedPageCalls: 1
    },
    {
      name: 'a duplicate floor and comment id across pages',
      firstLink: '/t/1231875?p=2',
      secondCount: 107,
      secondFloors: [100, 102, 103, 104, 105, 106, 107],
      expectedSecondFloors: [102, 103, 104, 105, 106, 107],
      expectedPageCalls: 1
    },
    {
      name: 'an external pagination link',
      firstLink: 'https://example.com/t/1231875?p=2',
      secondCount: 107,
      secondFloors: Array.from({ length: 7 }, (_, index) => index + 101),
      expectedSecondFloors: Array.from({ length: 7 }, (_, index) => index + 101),
      expectedPageCalls: 0
    }
  ])('keeps every unique parsed row for $name without using the replies API', async (scenario) => {
    const rows = (floors: number[]) =>
      floors
        .map(
          (floor) => `
            <div id="r_${91000 + floor}" class="cell">
              <span class="no">${floor}</span>
              <strong><a href="/member/user-${floor}">user-${floor}</a></strong>
              <div class="reply_content">reply ${floor}</div>
            </div>
          `
        )
        .join('');
    let replyApiCalls = 0;
    let pageCalls = 0;
    const declaration = (count: number) => `
      <script type="application/ld+json">{"commentCount":${count},"interactionStatistic":[{"interactionType":"https://schema.org/ReplyAction","userInteractionCount":${count}}]}</script>
    `;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 1231875,
            title: 'V2EX invalid paged replies',
            url: 'https://www.v2ex.com/t/1231875',
            created: 1780000000,
            replies: 107,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        replyApiCalls += 1;
        return json([]);
      }
      if (input === 'https://www.v2ex.com/t/1231875') {
        return html(`
          ${declaration(107)}
          ${rows(Array.from({ length: 100 }, (_, index) => index + 1))}
          <a href="${scenario.firstLink}">2</a>
        `);
      }
      if (input === 'https://www.v2ex.com/t/1231875?p=2') {
        pageCalls += 1;
        return html(`${declaration(scenario.secondCount)}${rows(scenario.secondFloors)}`);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '1231875', fetcher });
    expect(topic.replies).toHaveLength(100);
    expect(topic.replyHasMore).toBe(scenario.expectedPageCalls === 1);

    const firstPage = await getReplies({
      source: 'v2ex',
      id: '1231875',
      order: 'oldest',
      position: { kind: 'start' },
      replyCount: topic.replyCount,
      fetcher
    });
    const firstPageFloors = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(firstPage.items.map(({ floor }) => floor)).toEqual(firstPageFloors);
    expect(replyApiCalls).toBe(0);
    expect(pageCalls).toBe(0);

    if (scenario.expectedPageCalls) {
      const secondPage = await getReplies({
        source: 'v2ex',
        id: '1231875',
        order: 'oldest',
        position: { kind: 'cursor', page: 2, offset: null },
        replyCount: topic.replyCount,
        fetcher
      });
      expect(secondPage.items.map(({ floor }) => floor)).toEqual(scenario.expectedSecondFloors);
      expect(secondPage).toMatchObject({ completeness: 'partial', totalCount: 107 });
      expect(pageCalls).toBe(1);
    } else {
      expect(firstPage).toMatchObject({ completeness: 'partial', hasMore: false, nextPage: null, totalCount: 107 });
    }
  });

  it('keeps valid V2EX rows around a malformed node', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 820,
            title: 'V2EX malformed reply node',
            url: 'https://www.v2ex.com/t/820',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' }
          }
        ])
      ],
      [
        '/api/replies/show.json',
        json([
          { id: 7501, member: { username: 'alice' }, content_rendered: '<p>first</p>' },
          { id: 7503, member: { username: 'carol' }, content_rendered: '<p>third</p>' }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/820' },
        html(`
          <script type="application/ld+json">
            {"commentCount":2,"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":2}
            ]}
          </script>
          <div id="r_7501" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <div id="r_7502" class="cell"><span class="no">2</span></div>
          <div id="r_7503" class="cell"><span class="no">3</span><strong><a href="/member/carol">carol</a></strong><div class="reply_content">third</div></div>
          <div id="r_invalid" class="cell"><span class="no">4</span><div class="reply_content"><p>&nbsp;</p></div></div>
          <div id="r_author" class="cell"><span class="no">5</span><strong><a href="/member/dave">dave</a></strong><div class="reply_content"><p>&nbsp;</p></div></div>
          <div id="r_image" class="cell"><span class="no">6</span><div class="reply_content"><img src="/static/reply.png"></div></div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '820', fetcher });
    expect(topic).toMatchObject({
      replies: [
        expect.objectContaining({ commentId: 7501, floor: 1 }),
        expect.objectContaining({ commentId: 7502, floor: 2 }),
        expect.objectContaining({ commentId: 7503, floor: 3 }),
        expect.objectContaining({ author: 'dave', floor: 5 }),
        expect.objectContaining({ floor: 6 })
      ],
      replyCount: undefined,
      replyCompleteness: 'partial',
      replyHasMore: false
    });
    const refreshed = await getReplies({
      source: 'v2ex',
      id: '820',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });
    expect(refreshed.items.map(({ floor }) => floor)).toEqual([1, 2, 3, 5, 6]);
    expect(refreshed).toMatchObject({ completeness: 'partial', totalCount: undefined });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=820&page=1'
    );
  });

  it('accepts a self-consistent V2EX commentCount-only reply snapshot', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 821,
            title: 'V2EX commentCount reply snapshot',
            url: 'https://www.v2ex.com/t/821',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' }
          }
        ])
      ],
      [
        '/api/replies/show.json',
        () => {
          throw new Error('public replies API must not run');
        }
      ],
      [
        { exact: 'https://www.v2ex.com/t/821' },
        html(`
          <script type="application/ld+json">{"commentCount":"3"}</script>
          <div id="r_7601" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <div id="r_7602" class="cell"><span class="no">2</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second</div></div>
          <div id="r_7603" class="cell"><span class="no">3</span><strong><a href="/member/carol">carol</a></strong><div class="reply_content">third</div></div>
        `)
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '821', fetcher });

    expect(topic.replyCount).toBe(3);
    expect(topic.replies.map(({ floor }) => floor)).toEqual([1, 2, 3]);
    expect(sourceDiagnosticSummary(topic)).toMatchObject({ parserVariant: 'html-topic' });
  });

  it('keeps rows with conflicting V2EX declarations', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 822,
            title: 'V2EX conflicting reply declarations',
            url: 'https://www.v2ex.com/t/822',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' }
          }
        ])
      ],
      ['/api/replies/show.json', json([])],
      [
        { exact: 'https://www.v2ex.com/t/822' },
        html(`
          <script type="application/ld+json">
            {"commentCount":3,"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":2}
            ]}
          </script>
          <div id="r_7701" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <div id="r_7702" class="cell"><span class="no">2</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second</div></div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '822', fetcher });
    expect(topic.replies.map(({ floor }) => floor)).toEqual([1, 2]);
    expect(topic.replyHasMore).toBe(false);
    expect(topic.replyCount).toBe(2);
    const replies = await getReplies({
      source: 'v2ex',
      id: '822',
      order: 'oldest',
      position: { kind: 'start' },
      replyCount: topic.replyCount,
      fetcher
    });
    expect(replies.items.map(({ floor }) => floor)).toEqual([1, 2]);
    expect(replies).toMatchObject({ completeness: 'partial', totalCount: 2 });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=822&page=1'
    );
  });

  it('keeps a V2EX reply collection shorter than the declared count', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 816,
            title: 'V2EX reply race',
            url: 'https://www.v2ex.com/t/816',
            created: 1780000000,
            replies: 3,
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ])
      ],
      [
        '/api/replies/show.json',
        json([
          { id: 8101, member: { username: 'alice' }, content_rendered: '<p>first</p>', created: 1780000100 },
          { id: 8102, member: { username: 'bob' }, content_rendered: '<p>second</p>', created: 1780000200 }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/816' },
        html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":3}
            ]}
          </script>
          <div id="r_8101" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <div id="r_8102" class="cell"><span class="no">2</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second</div></div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '816', fetcher });
    expect(topic.replies.map(({ floor }) => floor)).toEqual([1, 2]);
    expect(topic.replyHasMore).toBe(false);
    const replies = await getReplies({
      source: 'v2ex',
      id: '816',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });
    expect(replies.items.map(({ floor }) => floor)).toEqual([1, 2]);
    expect(replies).toMatchObject({ completeness: 'partial', totalCount: 3 });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=816&page=1'
    );
  });

  it('keeps the V2EX thanks count when an icon attribute contains a quoted greater-than sign', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 815,
            title: 'V2EX quoted icon attribute',
            url: 'https://www.v2ex.com/t/815',
            created: 1780000000,
            replies: 1,
            member: { username: 'neo' }
          }
        ])
      ],
      ['/api/replies/show.json', json([])],
      [
        { exact: 'https://www.v2ex.com/t/815' },
        html(`
          <div id="r_8015" class="cell">
            <span class="no">1</span>
            <span class="small fade"><img title="1 > 0" src="/static/img/heart.png"> 2</span>
            <div class="reply_content">reply</div>
          </div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '815', fetcher });

    expect(topic.replies[0]).toMatchObject({ commentId: 8015, thanksCount: 2 });
  });

  it('ignores malformed V2EX reply target links without dropping replies', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 814,
            title: 'V2EX malformed reply target',
            url: 'https://www.v2ex.com/t/814',
            created: 1780000000,
            replies: 1,
            member: { username: 'neo' }
          }
        ])
      ],
      ['/api/replies/show.json', json([])],
      [
        { exact: 'https://www.v2ex.com/t/814' },
        html(
          '<div id="r_8001" class="cell"><span class="no">1</span><div class="reply_content">@<a href="/member/%E0%A4%A">bad</a> reply</div></div>'
        )
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '814', fetcher });

    expect(topic.replies[0]).toMatchObject({ commentId: 8001, floor: 1 });
    expect(topic.replies[0].replyTarget).toBeUndefined();
  });

  it('uses a complete legacy V2EX HTML reply collection without the replies API', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 811,
            title: 'V2EX fallback detail',
            url: 'https://www.v2ex.com/t/811',
            created: 1780000000,
            replies: 2,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ])
      ],
      [
        '/api/replies/show.json',
        () => {
          throw new Error('请求超时，请稍后重试');
        }
      ],
      [
        { exact: 'https://www.v2ex.com/t/811' },
        html(`
          <div id="r_7101" class="cell">
            <img class="avatar" src="//cdn.v2ex.com/a.png" />
            <span class="no">1</span>
            <strong><a href="/member/alice" class="dark">alice</a></strong>
            <span class="ago" title="2026-05-28 10:01:40 +08:00">1h ago</span>
            <div class="reply_content">first html reply</div>
          </div>
          <div id="r_7102" class="cell">
            <img class="avatar" src="//cdn.v2ex.com/b.png" />
            <span class="no">2</span>
            <strong><a href="/member/bob" class="dark">bob</a></strong>
            <span class="ago" title="2026-05-28 10:03:20 +08:00">1h ago</span>
            <span class="small">3 thanks</span>
            <div class="reply_content">@<a href="/member/alice">alice</a> second html reply</div>
          </div>
        `)
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '811', fetcher });

    expect(topic.replyCount).toBe(2);
    expect(topic.replies).toHaveLength(2);
    expect(topic.replies[0]).toMatchObject({
      author: 'alice',
      authorAvatar: 'https://cdn.v2ex.com/a.png',
      commentId: 7101,
      contentHtml: expect.stringContaining('first html reply'),
      floor: 1
    });
    expect(topic.replies[1]).toMatchObject({
      author: 'bob',
      commentId: 7102,
      floor: 2,
      replyTarget: { author: { name: 'alice', username: 'alice' } },
      thanksCount: 3
    });
    expect(sourceDiagnosticSummary(topic)).toMatchObject({
      parserVariant: 'html-topic-fallback',
      partialErrorCount: 0
    });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=811&page=1'
    );
  });

  it('falls back to the V2EX replies API only after the origin HTML request fails', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 812,
            title: 'V2EX API fallback detail',
            url: 'https://www.v2ex.com/t/812',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/812' },
        () => {
          throw new Error('origin HTML unavailable');
        }
      ],
      [
        '/api/replies/show.json',
        json([
          {
            id: 7201,
            member: { username: 'alice' },
            content_rendered: '<p>first API reply</p>',
            created: 1780000100
          },
          {
            id: 7202,
            member: { username: 'bob' },
            content_rendered: '<p>second API reply</p>',
            created: 1780000200
          }
        ])
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '812', fetcher });

    expect(topic).toMatchObject({ replies: [], replyHasMore: false });
    expect(topic.replyCount).toBe(2);

    const replies = await getReplies({
      source: 'v2ex',
      id: '812',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });

    expect(replies.totalCount).toBe(2);
    expect(replies.items.map(({ author, commentId, floor }) => ({ author, commentId, floor }))).toEqual([
      { author: 'alice', commentId: 7201, floor: 1 },
      { author: 'bob', commentId: 7202, floor: 2 }
    ]);
    expect(sourceDiagnosticSummary(replies)).toMatchObject({
      parserVariant: 'api-topic-fallback',
      partialErrorCount: 1
    });
    expect(fetcher.mock.calls.map(([input]) => input)).toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=812&page=1'
    );
  });

  it('confirms an empty V2EX API fallback after the origin HTML request fails', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 818,
            title: 'V2EX empty API fallback',
            url: 'https://www.v2ex.com/t/818',
            created: 1780000000,
            replies: 0,
            member: { username: 'neo' }
          }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/818' },
        () => {
          throw new Error('origin HTML unavailable');
        }
      ],
      ['/api/replies/show.json', json([])]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '818', fetcher });

    expect(topic).toMatchObject({ replies: [], replyHasMore: false });
    expect(topic.replyCount).toBe(0);

    const replies = await getReplies({
      source: 'v2ex',
      id: '818',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });

    expect(replies).toMatchObject({ totalCount: 0, items: [], hasMore: false, nextPage: null });
    expect(sourceDiagnosticSummary(replies)).toMatchObject({
      parserVariant: 'api-topic-fallback',
      partialErrorCount: 1
    });
    expect(fetcher.mock.calls.map(([input]) => input)).toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=818&page=1'
    );
  });

  it('keeps a nonempty V2EX API fallback against a stale zero count', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 823,
            title: 'V2EX stale zero topic count',
            url: 'https://www.v2ex.com/t/823',
            created: 1780000000,
            replies: 0,
            member: { username: 'neo' }
          }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/823' },
        () => {
          throw new Error('origin HTML unavailable');
        }
      ],
      [
        '/api/replies/show.json',
        json([{ id: 7801, member: { username: 'alice' }, content_rendered: '<p>newer reply</p>' }])
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '823', fetcher });
    expect(topic).toMatchObject({ replies: [], replyHasMore: false });
    const replies = await getReplies({
      source: 'v2ex',
      id: '823',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });
    expect(replies.items.map(({ commentId }) => commentId)).toEqual([7801]);
    expect(replies).toMatchObject({ completeness: 'partial', totalCount: undefined });
  });

  it('keeps usable HTML rows when a stale API count says empty', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 819,
            title: 'V2EX empty API fallback with legacy HTML',
            url: 'https://www.v2ex.com/t/819',
            created: 1780000000,
            replies: 0,
            member: { username: 'neo' }
          }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/819' },
        html(`
          <div id="r_7401" class="cell">
            <span class="no">1</span>
            <strong><a href="/member/alice">alice</a></strong>
            <div class="reply_content">unproven HTML reply</div>
          </div>
        `)
      ],
      ['/api/replies/show.json', json([])],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '819', fetcher });

    expect(topic.replies.map(({ floor }) => floor)).toEqual([1]);
    expect(topic).toMatchObject({ replyHasMore: false, replyNextPage: null });
    expect(topic.replyCount).toBeUndefined();
    fetcher.mockClear();

    const replies = await getReplies({
      source: 'v2ex',
      id: '819',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });

    expect(replies.items.map(({ floor }) => floor)).toEqual([1]);
    expect(replies).toMatchObject({ completeness: 'partial', totalCount: undefined, hasMore: false, nextPage: null });
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual(['https://www.v2ex.com/t/819']);
    expect(sourceDiagnosticSummary(replies)).toMatchObject({
      parserVariant: 'html-topic-partial',
      partialErrorCount: 0
    });
  });

  it('keeps an incomplete V2EX replies API fallback', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 813,
            title: 'V2EX incomplete API fallback',
            url: 'https://www.v2ex.com/t/813',
            created: 1780000000,
            replies: 3,
            member: { username: 'neo' }
          }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/813' },
        () => {
          throw new Error('origin HTML unavailable');
        }
      ],
      [
        '/api/replies/show.json',
        json([
          { id: 7301, member: { username: 'alice' }, content_rendered: '<p>first</p>' },
          { id: 7302, member: { username: 'bob' }, content_rendered: '<p>second</p>' }
        ])
      ]
    ]);

    const topic = await getTopic({ source: 'v2ex', id: '813', fetcher });
    expect(topic).toMatchObject({ replies: [], replyHasMore: false });
    const replies = await getReplies({
      source: 'v2ex',
      id: '813',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });
    expect(replies.items.map(({ floor }) => floor)).toEqual([1, 2]);
    expect(replies).toMatchObject({ completeness: 'partial', totalCount: 3 });
  });

  it('drops an empty API record without declaring the remaining row complete', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 824,
            title: 'V2EX malformed API reply',
            url: 'https://www.v2ex.com/t/824',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' }
          }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/824' },
        () => {
          throw new Error('origin HTML unavailable');
        }
      ],
      [
        '/api/replies/show.json',
        json([{ id: 7901, member: { username: 'alice' }, content_rendered: '<p>usable</p>' }, {}])
      ]
    ]);

    const replies = await getReplies({
      source: 'v2ex',
      id: '824',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });

    expect(replies.items.map(({ commentId, floor }) => ({ commentId, floor }))).toEqual([
      { commentId: 7901, floor: 1 }
    ]);
    expect(replies).toMatchObject({ completeness: 'partial', totalCount: 2 });
  });

  it('keeps identified empty and image-only API replies', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        json([
          {
            id: 826,
            title: 'V2EX empty markup reply',
            url: 'https://www.v2ex.com/t/826',
            created: 1780000000,
            replies: 4,
            member: { username: 'neo' }
          }
        ])
      ],
      [
        { exact: 'https://www.v2ex.com/t/826' },
        () => {
          throw new Error('origin HTML unavailable');
        }
      ],
      [
        '/api/replies/show.json',
        json([
          { id: 7961, member: { username: 'alice' }, content_rendered: '<p>usable</p>' },
          { id: 7962, content_rendered: '<p>   </p>' },
          { id: 7963, content_rendered: '<p>&nbsp;</p>' },
          { id: 7964, content_rendered: '<p><img src="/static/reply.png"></p>' }
        ])
      ]
    ]);

    const replies = await getReplies({
      source: 'v2ex',
      id: '826',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });

    expect(replies.items.map(({ commentId, floor }) => ({ commentId, floor }))).toEqual([
      { commentId: 7961, floor: 1 },
      { commentId: 7962, floor: 2 },
      { commentId: 7963, floor: 3 },
      { commentId: 7964, floor: 4 }
    ]);
    expect(replies).toMatchObject({ completeness: 'complete', totalCount: 4 });
  });

  it('keeps usable HTML rows when the topic API fallback fails', async () => {
    const fetcher = routeFetcher([
      [
        '/api/topics/show.json',
        () => {
          throw new Error('topic API unavailable');
        }
      ],
      [
        { exact: 'https://www.v2ex.com/t/825' },
        html(`
          <div id="r_7951" class="cell">
            <span class="no">1</span>
            <strong><a href="/member/alice">alice</a></strong>
            <div class="reply_content">usable HTML reply</div>
          </div>
        `)
      ],
      [
        '/api/replies/show.json',
        () => {
          throw new Error('replies API must not run');
        }
      ]
    ]);

    const replies = await getReplies({
      source: 'v2ex',
      id: '825',
      order: 'oldest',
      position: { kind: 'start' },
      fetcher
    });

    expect(replies.items.map(({ commentId, floor }) => ({ commentId, floor }))).toEqual([
      { commentId: 7951, floor: 1 }
    ]);
    expect(replies).toMatchObject({ completeness: 'partial', totalCount: undefined });
  });

  it('keeps V2EX all feed pagination open through the recent HTML list', async () => {
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/?tab=all' },
        html(`
          <div class="cell item"><a class="topic-link" href="/t/501#reply0">V2EX all first</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:05:00 +08:00"></span></div>
          <div class="cell item"><a class="topic-link" href="/t/500#reply0">V2EX all second</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:04:00 +08:00"></span></div>
          <div class="cell item"><a class="topic-link" href="/t/499#reply0">V2EX all third</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:03:00 +08:00"></span></div>
          <a href="/recent">更多新主题</a>
        `)
      ],
      [
        '/recent?p=1',
        html(`
          <div class="cell"><a class="topic-link" href="/t/501#reply1">V2EX all first duplicate</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:05:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/500#reply1">V2EX all second duplicate</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:04:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/499#reply1">V2EX all third duplicate</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:03:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/498#reply1">V2EX recent first</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:02:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/497#reply1">V2EX recent second</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:01:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/496#reply1">V2EX recent third</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:00:00"></span></div>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const first = await getFeed({ source: 'v2ex', limit: 3, fetcher });
    const second = await getFeed({ source: 'v2ex', page: first.nextPage ?? 2, limit: 3, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['501', '500', '499']);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['498', '497', '496']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('does not skip V2EX recent items after the all tab default page', async () => {
    const item = (id: number, title: string, time: string) => `
      <div class="cell item">
        <a class="topic-link" href="/t/${id}#reply0">${title}</a>
        <a class="node" href="/go/create">分享创造</a>
        <strong><a href="/member/neo">neo</a></strong>
        <span title="${time} +08:00"></span>
      </div>
    `;
    const fetcher = routeFetcher([
      [
        { exact: 'https://www.v2ex.com/?tab=all' },
        html(
          `${Array.from({ length: 20 }, (_, index) => item(900 - index, `all ${index}`, `2026-05-20 00:${String(59 - index).padStart(2, '0')}:00`)).join('')}<a href="/recent">更多新主题</a>`
        )
      ],
      [
        { exact: 'https://www.v2ex.com/recent?p=1' },
        html(
          `${Array.from({ length: 20 }, (_, index) => item(850 - index, `recent p1 ${index}`, `2026-05-20 00:${String(39 - index).padStart(2, '0')}:00`)).join('')}<a href="/recent?p=2">下一页</a>`
        )
      ],
      [
        { exact: 'https://www.v2ex.com/recent?p=2' },
        html(
          `${Array.from({ length: 20 }, (_, index) => item(800 - index, `recent p2 ${index}`, `2026-05-19 23:${String(59 - index).padStart(2, '0')}:00`)).join('')}<a href="/recent?p=3">下一页</a>`
        )
      ],
      [
        { exact: 'https://www.v2ex.com/recent?p=3' },
        html(
          Array.from({ length: 20 }, (_, index) =>
            item(700 - index, `recent p3 ${index}`, `2026-05-19 22:${String(59 - index).padStart(2, '0')}:00`)
          ).join('')
        )
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const first = await getFeed({ source: 'v2ex', limit: 30, fetcher });
    const second = await getFeed({
      source: 'v2ex',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 30,
      fetcher
    });

    expect(first.items).toHaveLength(20);
    expect(second.items.map((topic) => topic.id).slice(0, 3)).toEqual(['850', '849', '848']);
    expect(fetcher.mock.calls.map((call) => call[0])).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('reads V2EX search hits when SOV2EX returns a top-level hits array', async () => {
    const fetcher = vi.fn(async () =>
      json({
        total: 1,
        hits: [
          {
            _source: {
              id: 934576,
              title: 'GPT search result',
              member: 'neo',
              created: '2026-05-20T00:00:00',
              replies: 2
            },
            highlight: { title: ['GPT search result'] }
          }
        ]
      })
    );

    const search = await searchTopics({ source: 'v2ex', query: 'gpt', fetcher });

    expect(search.items[0]).toMatchObject({ source: 'v2ex', id: '934576', title: 'GPT search result' });
  });

  it('passes V2EX search pages through SOV2EX offsets', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      const from = url.searchParams.get('from');
      return json({
        hits: {
          total: { value: 2 },
          hits: [
            {
              _source: {
                id: from === '0' ? 934576 : 934577,
                title: from === '0' ? 'GPT first V2EX result' : 'GPT second V2EX result',
                member: 'neo',
                created: '2026-05-20T00:00:00',
                replies: 2
              }
            }
          ]
        }
      });
    });

    const first = await searchTopics({ source: 'v2ex', query: 'gpt', limit: 1, fetcher });
    const second = await searchTopics({ source: 'v2ex', query: 'gpt', page: first.nextPage ?? 2, limit: 1, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['934576']);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['934577']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('from=1');
    expect(calls).toContain('sort=sumup');
    expect(calls).toContain('version=1.0.1');
  });

  it('passes V2EX relevance and time sorting through real SOV2EX parameters', async () => {
    const fetcher = vi.fn(async () => json({ hits: [] }));

    await searchTopics({ source: 'v2ex', query: 'gpt', sort: 'relevance', fetcher });
    await searchTopics({ source: 'v2ex', query: 'gpt', sort: 'time', fetcher });

    expect(fetcher.mock.calls.length).toBe(2);
    const calls = fetcher.mock.calls as unknown as [string, unknown?][];
    const relevanceCall = calls[0];
    const timeCall = calls[1];
    expect(relevanceCall).toBeTruthy();
    expect(timeCall).toBeTruthy();
    const relevanceUrl = new URL(relevanceCall?.[0] || '');
    const timeUrl = new URL(timeCall?.[0] || '');
    expect(relevanceUrl.searchParams.get('sort')).toBe('sumup');
    expect(relevanceUrl.searchParams.get('order')).toBeNull();
    expect(timeUrl.searchParams.get('sort')).toBe('created');
    expect(timeUrl.searchParams.get('order')).toBe('0');
  });

  it('passes V2EX site filters through real SOV2EX parameters', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T10:00:00+08:00'));
    const fetcher = vi.fn(async () => json({ hits: [] }));
    try {
      await searchTopics({
        source: 'v2ex',
        query: 'gpt',
        filter: {
          source: 'v2ex',
          sort: 'time',
          node: 'qna',
          username: 'neo',
          operator: 'and',
          timeRange: 'week'
        },
        fetcher
      });
    } finally {
      vi.useRealTimers();
    }

    const url = new URL((fetcher.mock.calls as unknown as [string][])[0]?.[0] || '');
    expect(url.searchParams.get('sort')).toBe('created');
    expect(url.searchParams.get('order')).toBe('0');
    expect(url.searchParams.get('node')).toBe('qna');
    expect(url.searchParams.get('username')).toBe('neo');
    expect(url.searchParams.get('operator')).toBe('and');
    expect(url.searchParams.get('gte')).toBe(String(Math.floor(new Date('2026-06-04T02:00:00.000Z').getTime() / 1000)));
  });
});
