import type { Source } from '@/domain/forum/models';

// Shapes are copied from sourceUserRead's existing four-site parser evidence.
// Empty arrays and 503 responses below are explicit boundary/fault injection cases.
function userResponses(source: Source, empty: boolean) {
  switch (source) {
    case 'nodeseek':
      return {
        details: JSON.stringify({ success: true, detail: { member_id: 7, member_name: 'alice' } }),
        topics: JSON.stringify({ success: true, discussions: empty ? [] : [{ post_id: 101, title: '主题样本' }] }),
        replies: JSON.stringify({
          success: true,
          comments: empty ? [] : [{ post_id: 101, title: '主题样本', floor_id: 2, text: '回复样本' }]
        })
      };
    case 'linuxdo':
      return {
        details: JSON.stringify({ user_summary: { user: { id: 7, username: 'alice' } } }),
        nickname: JSON.stringify({ user: { id: 7, username: 'alice', name: 'Alice 昵称' } }),
        topics: JSON.stringify({
          topic_list: {
            topics: empty
              ? []
              : [{ id: 101, title: '主题样本', slug: 'sample', created_at: '2026-05-20T00:00:00Z', posts_count: 1 }]
          }
        }),
        replies: JSON.stringify({
          user_actions: empty
            ? []
            : [{ topic_id: 101, title: '主题样本', post_number: 2, post_id: 102, excerpt: '回复样本' }]
        })
      };
    case 'v2ex':
      return {
        details: JSON.stringify({ id: 7, username: 'alice' }),
        topics: empty
          ? '<main></main>'
          : '<div class="cell item"><a class="topic-link" href="/t/101">主题样本</a><span title="2026-05-20 10:00:00"></span></div>',
        replies: empty
          ? '<main></main>'
          : '<div class="dock_area">5 月 20 日回复了 alice 创建的主题 › <a href="/t/101#reply2">主题样本</a></div>'
      };
    case 'yaohuo':
      return {
        details:
          '<h1>alice</h1><a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub">帖子(1)</a><a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7">回复(1)</a>',
        topics: empty
          ? '<main></main>'
          : '<div class="listdata"><a href="/bbs-101.html?classid=177">主题样本</a>/alice/阅1/2026-05-20 10:30</div>',
        replies: empty
          ? '<main></main>'
          : '<div>alice (7) #2 回复样本。 2026-05-20 10:30 <a href="/bbs-101.html">查看</a></div>'
      };
  }
}

const activityEndpoints: Record<string, 'details' | 'nickname' | 'topics' | 'replies' | 'atom'> = {
  '/api/account/getInfo/7': 'details',
  '/api/content/list-discussions': 'topics',
  '/api/content/list-comments': 'replies',
  '/u/alice/summary.json': 'details',
  '/u/alice.json': 'nickname',
  '/topics/created-by/alice.json': 'topics',
  '/user_actions.json': 'replies',
  '/api/members/show.json': 'details',
  '/member/alice/topics': 'topics',
  '/member/alice/replies': 'replies',
  '/feed/member/alice.xml': 'atom',
  '/bbs/userinfo.aspx': 'details',
  '/bbs/book_list.aspx': 'topics',
  '/bbs/book_re_my.aspx': 'replies'
};

export function laneFor(url: string) {
  const path = new URL(url).pathname;
  const lane = activityEndpoints[path];
  if (!lane) throw new Error(`Unexpected user activity fixture path: ${path}`);
  return lane;
}

export function createUserActivityResponse(source: Source, empty: boolean) {
  const responses = userResponses(source, empty);
  return (url: string, failure?: 'topics' | 'replies') => {
    const lane = laneFor(url);
    if ((lane === 'atom' ? 'topics' : lane) === failure) return new Response('activity unavailable', { status: 503 });
    if (lane === 'atom') return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    return new Response(responses[lane]);
  };
}
