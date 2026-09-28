import { Buffer } from 'buffer';
import type { TopicCreationSource } from '@/domain/forum/topicComposer';
import { prepareRequestToSend, type Fetcher } from '@/platform/network/request';

export type TopicProofOutcome = 'success' | 'rejected' | 'unconfirmed' | 'network-error' | 'enqueued';
export const TOPIC_PROOF_SOURCES: TopicCreationSource[] = ['nodeseek', 'linuxdo', 'yaohuo'];
export const topicProofTitle = (source: TopicCreationSource) => `Local ${source} topic proof`;
export const topicProofBody = (source: TopicCreationSource) =>
  `Local ${source} draft. This content never reaches a server.`;
const yaohuoPaths = [
  'book_view_add',
  'book_view_sendmoney',
  'book_view_addvote',
  'book_view_addurl',
  'book_view_addfile'
].map((name) => `/bbs/${name}.aspx`);

// The real adapters own request construction and response parsing. Unmatched transport
// never falls back to fetch, including unexpected reads, uploads or poll creation.
export function createTopicProofTransport(outcome: TopicProofOutcome, allowUploads = false) {
  const writes: { source: TopicCreationSource; path: string; method: string; fields: Record<string, number> }[] = [];
  const reads: string[] = [];
  let blockedRequests = 0;
  let uploads = 0;
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(input);
    const method = init?.method || 'GET';
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (allowUploads && method === 'POST' && url.origin === 'https://linux.do' && url.pathname === '/uploads.json') {
      prepareRequestToSend(init);
      uploads++;
      return json({ url: `https://example.invalid/proof-${uploads}.png` });
    }
    if (method === 'GET') {
      reads.push(`${url.origin}${url.pathname}`);
      if (url.origin === 'https://www.nodeseek.com' && url.pathname === '/new-discussion') {
        const config = Buffer.from(
          JSON.stringify({ user: { rank: 2 }, allCategory: [{ key: 'tech', cn_text: '技术' }] })
        ).toString('base64');
        return new Response(`<script>decode('${config}')</script>`);
      }
      if (url.origin === 'https://linux.do') {
        if (url.pathname === '/session/csrf') return json({ csrf: 'synthetic-only' });
        if (url.pathname === '/session/current.json')
          return json({
            current_user: { id: 42, username: 'proof', trust_level: allowUploads ? 0 : 2, can_create_poll: true }
          });
        if (url.pathname === '/site.json')
          return json({
            categories: [{ id: 4, name: '技术', permission: 1 }],
            site_settings: {
              min_topic_title_length: 6,
              max_topic_title_length: 255,
              min_first_post_length: 20,
              max_post_length: 64000,
              authorized_extensions: 'jpg|png|pdf',
              max_image_size_kb: 4096,
              max_attachment_size_kb: 4096,
              max_tags_per_topic: 8,
              post_voting_enabled: true,
              poll_enabled: true,
              poll_minimum_trust_level_to_create: 1
            }
          });
        if (url.pathname === '/latest') return new Response('<html></html>');
        if (url.pathname === '/tags/filter/search') return json({ results: [] });
      }
      if (url.origin === 'https://www.yaohuo.me') {
        if (url.pathname === '/wapindex.aspx' && url.searchParams.get('classid') === '206')
          return new Response('<title>快速发帖</title><a href="/bbs/book_view_add.aspx?classid=213">悬赏问答</a>');
        if (yaohuoPaths.includes(url.pathname) && url.searchParams.get('classid') === '213')
          return new Response(`<form method="post" action="${url.pathname}" ${url.pathname.endsWith('addfile.aspx') ? 'enctype="multipart/form-data"' : ''}>
          <input type="hidden" name="action" value="gomod"><input type="hidden" name="classid" value="213">
          <input type="hidden" name="__CSRFToken" value="synthetic-only"><input type="hidden" name="request_id" value="proof-only">
          <input type="hidden" name="freerule1" value="0"><input name="book_title" minlength="5" maxlength="50"><textarea name="book_content" minlength="15"></textarea>
          ${url.pathname.endsWith('addfile.aspx') ? '<input name="book_file" type="file" accept=".txt,.zip,.png" multiple>' : ''}
          <button name="g" type="submit">发布</button></form>${yaohuoPaths.map((path) => `<a href="${path}?classid=213">类型</a>`).join('')}`);
      }
    }
    const source =
      method === 'POST'
        ? url.origin === 'https://www.nodeseek.com' && url.pathname === '/api/content/new-discussion'
          ? 'nodeseek'
          : url.origin === 'https://linux.do' && url.pathname === '/posts'
            ? 'linuxdo'
            : url.origin === 'https://www.yaohuo.me' && yaohuoPaths.includes(url.pathname)
              ? 'yaohuo'
              : null
        : null;
    if (!source) {
      blockedRequests++;
      throw new Error(`Unmatched topic proof request: ${method} ${url.origin}${url.pathname}`);
    }
    prepareRequestToSend(init);
    const fields: Record<string, number> = {};
    if (source === 'yaohuo') {
      const names =
        typeof init?.body === 'string'
          ? [...new URLSearchParams(init.body).keys()]
          : (init?.body as FormData & { getParts(): { fieldName: string }[] }).getParts().map((part) => part.fieldName);
      for (const name of names) if (!/csrf|request_id/i.test(name)) fields[name] = (fields[name] || 0) + 1;
    }
    writes.push({ source, path: url.pathname, method, fields });
    if (outcome === 'network-error') throw new Error('Mock connection lost after dispatch');
    if (outcome === 'rejected')
      return source === 'yaohuo'
        ? new Response('<div class="tip">发帖失败：Mock 拒绝</div>', { status: 422 })
        : json({ success: false, errors: ['Mock rejected'], message: 'Mock rejected' }, 422);
    if (outcome === 'unconfirmed')
      return new Response(source === 'linuxdo' ? '{"action":"enqueued"}' : '<html>Unconfirmed result</html>');
    if (outcome === 'enqueued')
      return source === 'linuxdo'
        ? json({ action: 'enqueued', success: true })
        : new Response('<div class="tip">发表成功，等待审核</div>');
    if (source === 'nodeseek') return json({ success: true, redirect: '/post-123-1' });
    if (source === 'linuxdo') return json({ post: { id: 101, topic_id: 123, post_number: 1, username: 'proof' } });
    return new Response('<div class="tip">发表成功！<a href="/bbs-123.html">查看帖子</a></div>');
  };
  return {
    fetcher,
    writes,
    reads,
    get uploads() {
      return uploads;
    },
    get blockedRequests() {
      return blockedRequests;
    }
  };
}
