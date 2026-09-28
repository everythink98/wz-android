import { Buffer } from 'buffer';
import { describe, expect, it, vi } from 'vitest';
import { emptyTopicDraft, type CreateTopicInput } from '@/domain/forum/topicComposer';
import { createNodeSeekTopic, loadNodeSeekTopicCreationContext } from './topicCreation';
import { prepareRequestToSend, withRequestBeforeSend } from '@/platform/network/request';

function input(): CreateTopicInput {
  return {
    draft: {
      ...emptyTopicDraft('nodeseek', 'one'),
      source: 'nodeseek',
      rank: 1,
      title: '新主题',
      body: '原始正文',
      categoryId: 'tech'
    },
    body: '最终正文'
  };
}

describe('NodeSeek topic creation', () => {
  it('loads current account ranks and non-admin categories from the original form config', async () => {
    const config = Buffer.from(
      JSON.stringify({
        user: { rank: 2 },
        allCategory: [
          { key: 'tech', cn_text: '技术' },
          { key: 'admin', cn_text: '管理', adminOnly: true }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => new Response(`<script>decode('${config}')</script>`));
    expect(await loadNodeSeekTopicCreationContext({ fetcher, userAgent: 'test' })).toMatchObject({
      categories: [{ id: 'tech', name: '技术' }],
      ranks: [0, 1, 2, 255],
      insideFee: 5
    });
  });

  it('sends new-discussion JSON once and uses only an explicit success response', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ success: true, redirect: '/post-123-1' }))
    );
    const result = await createNodeSeekTopic({ input: input(), fetcher, userAgent: 'test' });
    expect(result).toMatchObject({ status: 'posted', topic: { id: '123', title: '新主题' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://www.nodeseek.com/api/content/new-discussion');
    expect(JSON.parse(String(init?.body))).toEqual({
      content: '最终正文',
      mode: 'new-discussion',
      title: '新主题',
      category: 'tech',
      rank: 1
    });
    expect(new Headers(init?.headers).get('csrf-token')).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
  });

  it.each([
    [{ success: true }, 'posted'],
    [{ success: false, message: '等级不足' }, 'rejected'],
    [{ success: true, errors: ['发帖失败'] }, 'rejected'],
    [{ redirect: '/post-123-1' }, 'unknown']
  ])('classifies authoritative and ambiguous responses without retrying', async (payload, status) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)));
    expect(await createNodeSeekTopic({ input: input(), fetcher, userAgent: 'test' })).toHaveProperty('status', status);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([408, 409])('keeps HTTP %s unknown unless the response explicitly rejects publication', async (status) => {
    for (const [payload, expected] of [
      [{}, 'unknown'],
      [{ success: false, message: '等级不足' }, 'rejected']
    ] as const) {
      const response = Response.json(payload, { status });
      const json = vi.spyOn(response, 'json');
      const clone = vi.spyOn(response, 'clone');
      const fetcher = vi.fn(async () => response);
      expect(await createNodeSeekTopic({ input: input(), fetcher, userAgent: 'test' })).toHaveProperty(
        'status',
        expected
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(json).toHaveBeenCalledTimes(1);
      expect(clone).not.toHaveBeenCalled();
    }
  });

  it('preserves transport-level server failures for the submission owner', async () => {
    const fetcher = vi.fn(async () => Response.json({}, { status: 500 }));
    await expect(createNodeSeekTopic({ input: input(), fetcher, userAgent: 'test' })).rejects.toMatchObject({
      status: 500,
      serverRejected: false
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not hide transport errors or infer success from HTML', async () => {
    const error = new Error('connection lost');
    await expect(
      createNodeSeekTopic({
        input: input(),
        fetcher: async () => {
          throw error;
        },
        userAgent: 'test'
      })
    ).rejects.toBe(error);
    expect(
      await createNodeSeekTopic({
        input: input(),
        fetcher: async () => new Response('<a href="/post-123-1">帖子</a>'),
        userAgent: 'test'
      })
    ).toHaveProperty('status', 'unknown');
  });

  it('preserves the final identity guard across a delayed transport and sends no request after revocation', async () => {
    let current = true;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];
    const dispatchState = { mayHaveSent: false };
    const fetcher = withRequestBeforeSend(
      async (url, init) => {
        await waiting;
        prepareRequestToSend(init);
        sent.push(url);
        return new Response('{"success":true}');
      },
      () => {
        if (!current) throw new Error('identity changed');
      },
      dispatchState
    );
    const pending = createNodeSeekTopic({ input: input(), fetcher, userAgent: 'test' });
    current = false;
    release();
    await expect(pending).rejects.toThrow('identity changed');
    expect(sent).toEqual([]);
    expect(dispatchState.mayHaveSent).toBe(false);
  });
});
