import { describe, expect, it, vi } from 'vitest';
import { emptyTopicDraft, type CreateTopicInput, type YaohuoTopicKind } from '@/domain/forum/topicComposer';
import { createYaohuoTopic, loadYaohuoTopicCreationContext } from './topicCreation';

const paths: Record<YaohuoTopicKind, string> = {
  normal: 'book_view_add',
  gift: 'book_view_sendmoney',
  poll: 'book_view_addvote',
  resources: 'book_view_addurl',
  files: 'book_view_addfile'
};
function input(kind: YaohuoTopicKind = 'normal'): CreateTopicInput {
  return {
    draft: {
      ...emptyTopicDraft('yaohuo', 'one'),
      source: 'yaohuo',
      title: '合法发帖标题',
      categoryId: '213',
      kind,
      reward: '1000',
      gift: { total: '2000', perPerson: '200' },
      poll: { options: ['甲', '乙', '丙'], giftEnabled: true, total: '2000', perPerson: '200' },
      resources: [
        { title: '资源一', url: 'https://example.com/a', size: '1MB', extension: 'zip', description: '备注一' },
        { title: '资源二', url: 'https://example.com/b', size: '', extension: '', description: '' }
      ],
      attachments: [
        {
          id: 'one',
          uri: 'file:///cache/test.zip',
          name: 'test.zip',
          mimeType: 'application/zip',
          size: 20,
          kind: 'yaohuo-file',
          status: 'queued',
          description: '文件说明'
        }
      ]
    },
    body: '合法正文第一行\n合法正文第二行超过字数限制'
  };
}
function form(kind: YaohuoTopicKind, action = `/bbs/${paths[kind]}.aspx`, categoryId = '213') {
  return `<form method="post" action="${action}" ${kind === 'files' ? 'enctype="multipart/form-data"' : ''}>
    <input name="action" type="hidden" value="gomod"><input name="classid" type="hidden" value="${categoryId}">
    <input name="siteid" type="hidden" value="1000"><input name="__CSRFToken" type="hidden" value="fresh-token"><input name="request_id" type="hidden" value="request-once">
    <input name="freerule1" type="hidden" value="0"><input name="book_title" minlength="5" maxlength="50"><textarea name="book_content" minlength="15"></textarea>
    ${kind === 'files' ? '<input type="file" accept=".zip,.png" multiple>' : ''}<button type="submit" name="g">发布</button></form>`;
}

describe('Yaohuo topic creation', () => {
  it('discovers posting categories from the quick-post directory before opening a category form', async () => {
    const categories = [
      { id: '177', name: '版块甲' },
      { id: '213', name: '版块乙' }
    ];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      if (url === 'https://www.yaohuo.me/wapindex.aspx?classid=206')
        return new Response(
          '<title>快速发帖</title>' +
            categories.map(({ id, name }) => `<a href="/bbs/book_view_add.aspx?classid=${id}">${name}</a>`).join('') +
            '<a href="/bbs/book_view_add.aspx?classid=177">重复入口</a>' +
            '<a href="/bbs/book_list.aspx?classid=2">浏览版块</a>' +
            '<a href="https://evil.test/bbs/book_view_add.aspx?classid=1">外站</a>'
        );
      if (url.includes('book_view_addurl'))
        return new Response(
          form('resources', undefined, '177') + '<a href="/bbs/book_view_addfile.aspx?classid=177">本地上传</a>'
        );
      if (url.includes('book_view_addfile')) return new Response(form('files', undefined, '177'));
      return new Response(
        form('normal', undefined, '177') +
          ['gift', 'poll', 'resources']
            .map((kind) => `<a href="/bbs/${paths[kind as YaohuoTopicKind]}.aspx?classid=177">类型</a>`)
            .join('')
      );
    });
    expect(await loadYaohuoTopicCreationContext({ fetcher, userAgent: 'test' })).toMatchObject({
      categories,
      kinds: ['normal', 'gift', 'poll', 'resources', 'files'],
      allowedFileExtensions: ['zip', 'png'],
      titleMin: 5,
      titleMax: 50,
      bodyMin: 15
    });
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname + new URL(url).search)).toEqual([
      '/wapindex.aspx?classid=206',
      '/bbs/book_view_add.aspx?classid=177',
      '/bbs/book_view_addurl.aspx?classid=177&num=1',
      '/bbs/book_view_addfile.aspx?classid=177'
    ]);
  });

  it.each(['normal', 'gift', 'poll', 'resources'] as const)(
    'refreshes the %s form and sends only active fields, retaining repeated names',
    async (kind) => {
      const fetcher = vi.fn(
        async (_url: string, init?: RequestInit) =>
          new Response(
            init?.method === 'GET' ? form(kind) : '<div class="tip">发表成功！<a href="/bbs-12.html">查看帖子</a></div>'
          )
      );
      expect(await createYaohuoTopic({ input: input(kind), fetcher, userAgent: 'test' })).toMatchObject({
        status: 'posted',
        topic: { id: '12' }
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      const [url, init] = fetcher.mock.calls[1]!;
      expect(url).toBe(`https://www.yaohuo.me/bbs/${paths[kind]}.aspx`);
      const fields = new URLSearchParams(String(init?.body));
      expect(fields.get('__CSRFToken')).toBe('fresh-token');
      expect(fields.get('book_content')).toContain('\r\n');
      expect(fields.get('classid')).toBe('213');
      expect(fields.has('book_file')).toBe(false);
      if (kind === 'normal') {
        expect(fields.get('sendmoney')).toBe('1000');
        expect(fields.has('freemoney')).toBe(false);
      }
      if (kind === 'gift') {
        expect(fields.get('freemoney')).toBe('2000');
        expect(fields.get('freerule2')).toBe('200');
      }
      if (kind === 'poll') {
        expect(fields.getAll('vote')).toEqual(['甲', '乙', '丙']);
        expect(fields.get('num')).toBe('3');
      }
      if (kind === 'resources') {
        expect(fields.getAll('file_title')).toEqual(['资源一', '资源二']);
        expect(fields.getAll('file_url')).toHaveLength(2);
        expect(fields.get('num')).toBe('2');
      }
    }
  );

  it('uploads files only with final multipart publication and preserves per-file descriptions', async () => {
    const fetcher = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(init?.method === 'GET' ? form('files') : '<div class="tip">发表成功！</div>')
    );
    expect(await createYaohuoTopic({ input: input('files'), fetcher, userAgent: 'test' })).toHaveProperty(
      'status',
      'posted'
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    const init = fetcher.mock.calls[1]![1];
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
    const fields = init?.body as FormData;
    expect(fields.getAll('book_file')).toHaveLength(1);
    expect(fields.get('book_file_info')).toBe('文件说明');
    expect(fields.get('request_id')).toBe('request-once');
    expect(fields.get('num')).toBe('1');
  });

  it.each([
    ['<a href="/bbs-12.html">其他帖子</a>', 'unknown'],
    ['<div class="tip">妖晶不足</div>', 'rejected'],
    ['<div class="tip">发表成功，但发生错误，等待审核</div>', 'rejected'],
    ['<div class="tip">发表成功，等待审核</div>', 'enqueued']
  ])('requires explicit outcome evidence in a submission response', async (html, status) => {
    const fetcher = vi.fn(
      async (_url: string, init?: RequestInit) => new Response(init?.method === 'GET' ? form('normal') : html)
    );
    expect(await createYaohuoTopic({ input: input(), fetcher, userAgent: 'test' })).toHaveProperty('status', status);
  });

  it.each([408, 409])('keeps HTTP %s unknown unless a posting tip explicitly rejects publication', async (status) => {
    for (const [html, expected] of [
      ['Request timed out', 'unknown'],
      ['<div class="tip">妖晶不足</div>', 'rejected']
    ] as const) {
      const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'GET' ? new Response(form('normal')) : new Response(html, { status })
      );
      expect(await createYaohuoTopic({ input: input(), fetcher, userAgent: 'test' })).toHaveProperty(
        'status',
        expected
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it('does not send if the fresh form changes origin or category', async () => {
    for (const html of [
      form('normal', 'https://evil.test/bbs/book_view_add.aspx'),
      form('normal').replace('value="213"', 'value="999"')
    ]) {
      const fetcher = vi.fn(async () => new Response(html));
      await expect(createYaohuoTopic({ input: input(), fetcher, userAgent: 'test' })).rejects.toThrow('匹配');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
