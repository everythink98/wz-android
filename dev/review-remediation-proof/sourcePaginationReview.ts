import { isRecord, parseHtml, sortTopicsByCreatedAt, sortTopicsByTime, toIsoString } from '@/domain/forum/html';
import { getFeed } from '@/sources/feedRead';
import { getLinuxDoUserTopics } from '@/sources/linuxdo/account';
import { getLinuxDoTopic } from '@/sources/linuxdo/reader';
import { getV2exFeed } from '@/sources/v2ex/reader';
import { searchV2ex } from '@/sources/v2ex/search';
import { parseYaohuoListHtml } from '@/sources/yaohuo/feedParser';
import { parseYaohuoTopicHtml } from '@/sources/yaohuo/topicParser';
import { parseYaohuoUserProfileDocument } from '@/sources/yaohuo/userParser';
import { check } from '../proofCheck';

export async function scopedAggregateFeedFixtureCursor(source: 'linuxdo' | 'v2ex', fixture: object) {
  const seed = await getFeed({
    source: 'all',
    includedSources: [source],
    limit: 1,
    discourseAuth: { userAgent: 'proof' },
    fetcher: async (input) => {
      if (source === 'v2ex') {
        return new Response(
          '<div class="cell item"><a class="topic-link" href="/t/101">Seed topic</a></div>' +
            '<a href="/recent">更多新主题</a>'
        );
      }
      const topics = new URL(input).searchParams.has('order')
        ? [101, 102].map((id) => ({
            id,
            title: `Seed ${id}`,
            slug: 'seed',
            posts_count: 1,
            created_at: '2026-10-01T00:00:00.000Z'
          }))
        : [];
      return new Response(JSON.stringify({ topic_list: { topics } }), {
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  check(seed.nextCursor, `Missing scoped ${source} aggregate fixture cursor`);
  const wire: unknown = JSON.parse(decodeURIComponent(seed.nextCursor));
  check(isRecord(wire) && typeof wire.bind === 'string', 'Missing aggregate fixture binding');
  return encodeURIComponent(JSON.stringify({ ...fixture, bind: wire.bind }));
}

export async function verifySourcePaginationReview() {
  const row = (id: number) =>
    `<div class="cell item"><a class="topic-link" href="/t/${id}">主题 ${id}</a><a class="node" href="/go/create">创造</a></div>`;
  const latest = {
    feedFilter: 'latest' as const,
    limit: 2,
    fetcher: async (input: string) => {
      const page = new URL(input).searchParams.get('p');
      check(page === '1' || page === '2', 'V2EX 请求了样本外的原站页');
      return new Response(
        page === '1' ? row(1) + row(2) + row(3) + '<a href="/recent?p=2">下一页</a>' : row(4) + row(5)
      );
    }
  };
  let result = await getV2exFeed(latest);
  const ids = result.items.map((topic) => topic.id);
  for (let index = 0; result.hasMore && index < 4; index++) {
    check(result.nextPage && result.nextCursor, 'V2EX 最新主题缺少下一页位置');
    result = await getV2exFeed({ ...latest, page: result.nextPage, cursor: result.nextCursor });
    ids.push(...result.items.map((topic) => topic.id));
  }
  check(ids.join(',') === '1,2,3,4,5' && !result.hasMore, 'V2EX 最新主题分页漏项或重复');
  const buffered = { source: 'v2ex', id: '8', title: '缓存主题', url: 'https://www.v2ex.com/t/8', createdAt: '' };
  const cursor = await scopedAggregateFeedFixtureCursor('v2ex', {
    buffers: { v2ex: [buffered, { ...buffered, source: 'yaohuo', id: '9' }, { ...buffered, id: '10', url: 42 }] },
    sourceCursors: { v2ex: 'orphan' }
  });
  const drained = await getFeed({
    source: 'all',
    includedSources: ['v2ex'],
    page: 2,
    cursor,
    fetcher: async () => {
      throw new Error('聚合页的缓存恢复发起了多余请求');
    }
  });
  check(
    drained.items.map((topic) => topic.id).join(',') === '8' && !drained.hasMore && !drained.nextCursor,
    '聚合页未正确保留缓存、核对来源并终止分页'
  );
  const empty = await searchV2ex('fixture', {
    page: 2,
    limit: 10,
    fetcher: async () => new Response(JSON.stringify({ hits: { total: 200, hits: [] } }))
  });
  check(!empty.items.length && !empty.hasMore && empty.nextPage === null, 'V2EX 空结果页继续承诺下一页');

  const profile = { source: 'linuxdo' as const, username: 'fixture', id: 'fixture', url: 'https://linux.do/u/fixture' };
  const pages: string[] = [];
  const linuxDo = {
    fetcher: async (input: string) => {
      const url = new URL(input);
      check(url.pathname === '/topics/created-by/fixture.json', 'linux.do 用户页读取了其他资源');
      const page = url.searchParams.get('page');
      check(page === '0' || page === '3', 'linux.do 用户页没有使用原站提供的页码');
      pages.push(page);
      return new Response(
        JSON.stringify({
          topic_list: {
            topics: [
              {
                id: 100 + Number(page),
                title: 'Topic',
                slug: 'topic',
                posts_count: 1,
                created_at: '2026-01-01T00:00:00Z'
              }
            ],
            more_topics_url: '/topics/created-by/fixture?page=3'
          }
        })
      );
    }
  };
  const first = await getLinuxDoUserTopics(profile, linuxDo);
  check(first.nextTopicsCursor === '3', 'linux.do 用户页没有保留明确的下一页');
  const last = await getLinuxDoUserTopics(profile, { ...linuxDo, cursor: first.nextTopicsCursor });
  check(
    pages.join(',') === '0,3' && last.topics[0]?.id === '103' && !last.hasMoreTopics && last.nextTopicsCursor === null,
    'linux.do 用户页重复加载同一个 continuation'
  );
  const restricted = await getLinuxDoTopic('123', {
    fetcher: async () => new Response(JSON.stringify({ errors: ['当前用户组不可查看该主题'] }), { status: 403 })
  });
  check(
    restricted.accessRequirement?.type === 'permission' && restricted.createdAt === '' && !restricted.lastReplyAt,
    'linux.do 受限主题补入了原站未提供的日期'
  );

  const title = '活动截止 2025-09-18 15:00';
  const listing = `<div class="listdata"><a href="/bbs-12.html">${title}</a>/火友/阅12</div>`;
  const opening = `<div class="content"><div class="Postinfo">[标题] ${title} (阅12)</div><div class="bbscontent">往期活动 [时间] 2024-01-31 10:00</div></div>`;
  const topics = [
    parseYaohuoListHtml(listing).items[0],
    parseYaohuoUserProfileDocument(parseHtml(listing), { id: '7', username: '火友' }).topics[0],
    parseYaohuoTopicHtml(opening, { id: '12' })
  ];
  check(
    topics.every((topic) => topic.title === title && topic.createdAt === '' && !topic.lastReplyAt),
    '妖火标题或正文中的日期被误作发帖时间'
  );
  const dated = parseYaohuoTopicHtml(opening.replace('(阅12)', '(阅12) [时间] 2026-03-01 10:00'), { id: '12' });
  check(dated.createdAt === '2026-03-01T02:00:00.000Z', '妖火未保留原站提供的发帖时间');
  check(toIsoString(9e18) === '', '超出日历范围的来源时间未保持未知');
  const samples = [{ createdAt: '2020-01-01' }, { createdAt: '' }, { createdAt: '2026-01-01' }];
  for (const sort of [sortTopicsByTime, sortTopicsByCreatedAt]) {
    check(
      sort(samples)
        .map((topic) => topic.createdAt)
        .join(',') === '2026-01-01,2020-01-01,',
      '未知日期打乱已知时间排序'
    );
  }
}
