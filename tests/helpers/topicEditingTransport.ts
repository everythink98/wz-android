import { Buffer } from 'buffer';
import type { TopicCreationSource } from '@/domain/forum/topicComposer';
import { prepareRequestToSend, type Fetcher } from '@/platform/network/request';

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

// This transport has no network fallback. It is shared by protocol, UI and isolated device proof.
export function createTopicEditTransport(source: TopicCreationSource, userId = '42') {
  const state = {
    title: '原有主帖标题',
    body: '  原始正文\n[custom]保留 &amp; 原文[/custom]\n',
    categoryId: '4',
    rank: 0,
    tags: [{ id: 12, name: '技术' }],
    owner: userId,
    canEditBody: true,
    canEditTopic: true,
    canEditTags: true
  };
  const requests: { path: string; method: string; body?: string }[] = [];
  let token = 0;
  let blockedRequests = 0;
  let reply: ((path: string, body: string) => Response | undefined | Promise<Response | undefined>) | undefined;
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(input);
    const expectedHost =
      source === 'linuxdo' ? 'linux.do' : source === 'nodeseek' ? 'www.nodeseek.com' : 'www.yaohuo.me';
    if (url.hostname !== expectedHost) {
      blockedRequests++;
      throw new Error('Unexpected source in isolated edit proof');
    }
    const request = prepareRequestToSend(init);
    const method = request?.method || 'GET';
    const body = String(request?.body || '');
    requests.push({ path: url.pathname, method, ...(method !== 'GET' ? { body } : {}) });
    if (method !== 'GET') {
      const override = await reply?.(url.pathname, body);
      if (override) return override;
      if (source === 'nodeseek' && url.pathname === '/api/content/edit-discussion') {
        const data = JSON.parse(body);
        Object.assign(state, { title: data.title, body: data.content, rank: data.rank });
        return json({ success: true });
      }
      if (source === 'linuxdo' && /^\/t\/(?:-\/)?123(?:\.json|\/tags)$/.test(url.pathname)) {
        const data = JSON.parse(body);
        if (data.title !== undefined) state.title = data.title;
        if (data.category_id !== undefined) state.categoryId = String(data.category_id);
        if (data.tags !== undefined) state.tags = data.tags;
        return json(
          data.tags
            ? { id: 123, title: state.title, tags: state.tags }
            : { basic_topic: { id: 123, title: state.title } }
        );
      }
      if (source === 'linuxdo' && url.pathname === '/posts/789.json') {
        state.body = JSON.parse(body).post.raw;
        return json({ post: { id: 789, raw: state.body } });
      }
      if (source === 'yaohuo' && url.pathname === '/bbs/book_view_mod.aspx') {
        const fields = new URLSearchParams(body);
        if (fields.get('token') !== `fixture-edit-token-${token}`)
          return new Response('<div class="tip">token错误</div>');
        state.title = fields.get('book_title')!;
        state.body = fields.get('book_content')!;
        return new Response('<div class="tip">修改成功！</div>');
      }
    } else {
      if (source === 'nodeseek' && url.pathname === '/post-123-1') {
        const data = {
          user: { id: userId, rank: 2 },
          postData: {
            postId: 123,
            title: state.title,
            category: 'tech',
            rank: state.rank,
            comments: [
              {
                floorIndex: 0,
                commentId: 789,
                markdown: state.body,
                poster: { id: state.owner, isMe: state.owner === userId }
              }
            ]
          }
        };
        return new Response(`<script>decode('${Buffer.from(JSON.stringify(data)).toString('base64')}')</script>`);
      }
      if (source === 'linuxdo') {
        if (url.pathname === '/t/123.json')
          return json({
            id: 123,
            title: state.title,
            category_id: Number(state.categoryId),
            tags: state.tags,
            details: { can_edit: state.canEditTopic, can_edit_tags: state.canEditTags },
            post_stream: { posts: [{ id: 789, post_number: 1 }] }
          });
        if (url.pathname === '/posts/789.json')
          return json({
            id: 789,
            post_number: 1,
            topic_id: 123,
            user_id: state.owner,
            raw: state.body,
            can_edit: state.canEditBody
          });
        if (url.pathname === '/site.json')
          return json({
            categories: [
              { id: 4, name: '技术', permission: 1 },
              { id: 5, name: '反馈', permission: 1, topic_template: '不要覆盖原文' }
            ]
          });
        if (url.pathname === '/session/current.json') return json({ current_user: { id: userId, trust_level: 2 } });
        if (url.pathname === '/session/csrf') return json({ csrf: 'fixture-csrf' });
        if (url.pathname === '/tags/filter/search') return json({ results: state.tags });
        if (url.pathname === '/latest')
          return new Response(
            `<script id="data-preloaded" type="application/json">${JSON.stringify({
              siteSettings: JSON.stringify({
                authorized_extensions: 'png|pdf',
                min_topic_title_length: 1,
                min_first_post_length: 1,
                max_post_length: 64000,
                max_tags_per_topic: 8,
                post_voting_enabled: true
              })
            })}</script>`
          );
      }
      if (source === 'yaohuo') {
        if (url.pathname === '/bbs-123.html')
          return new Response(
            `<div class="subtitle"><a href="/bbs/userinfo.aspx?userid=${state.owner}">本人</a></div><a href="/bbs/book_view_mod.aspx?action=go&id=123&classid=213&siteid=1000">修改帖子</a>`
          );
        if (url.pathname === '/bbs/book_view_mod.aspx') {
          token++;
          const escape = (text: string) =>
            text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
          return new Response(`<form method="post" action="/bbs/book_view_mod.aspx"><input name="book_title" maxlength="50" value="${escape(state.title)}"><textarea name="book_content">${escape(state.body)}</textarea>
            <input name="additionalReward" type="number">${Object.entries({
              action: 'go',
              id: '123',
              classid: '213',
              siteid: '1000',
              lpage: '1',
              token: `fixture-edit-token-${token}`
            })
              .map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`)
              .join('')}</form>`);
        }
      }
    }
    blockedRequests++;
    throw new Error(`Unexpected isolated edit request: ${method} ${url.pathname}`);
  };
  return {
    source,
    state,
    fetcher,
    requests,
    writes: () => requests.filter((row) => row.method !== 'GET'),
    blockedRequests: () => blockedRequests,
    respond: (response: typeof reply) => {
      reply = response;
    }
  };
}
