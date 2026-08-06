import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { getReplies, getReply, getTopic } from './sourceRead';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';

describe('source topic read', () => {
  it('marks NodeSeek topic and reply reads as foreground browser work', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 101,
          title: 'NodeSeek topic',
          comments: [
            { commentId: 100, poster: { name: 'alice' }, markdown: '正文' },
            { commentId: 101, poster: { name: 'bob' }, markdown: '回复' }
          ]
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => new Response(`<script>${payload}</script>`));

    await getTopic({ source: 'nodeseek', id: '101', fetcher });
    await getReplies({ source: 'nodeseek', id: '101', order: 'oldest', position: { kind: 'start' }, fetcher });

    const calls = fetcher.mock.calls as unknown as [string, RequestInit?][];
    for (const [, init] of calls) {
      expect(browserFetchIntentFromInit(init)).toMatchObject({
        owner: 'topic',
        priority: 'foreground'
      });
    }
  });

  it('keeps single quoted-floor reads on linux.do public JSON endpoints', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/t/42.json')) {
        return new Response(
          JSON.stringify({
            id: 42,
            title: 'linux.do',
            created_at: '2026-05-20T00:00:00.000Z',
            post_stream: {
              stream: [100, 101],
              posts: [
                {
                  id: 101,
                  post_number: 2,
                  username: 'bob',
                  cooked: '<p>quoted</p>',
                  created_at: '2026-05-20T00:01:00.000Z'
                }
              ]
            }
          })
        );
      }
      return new Response(JSON.stringify({ post_stream: { posts: [] } }));
    });

    const reply = await getReply({ source: 'linuxdo', id: '42', floor: 2, fetcher });

    expect(reply).toMatchObject({ author: 'bob', floor: 2 });
    expect(fetcher.mock.calls[0][0]).toBe('https://linux.do/t/42.json');
  });

  it('does not return a different linux.do post when the quoted floor is missing', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/t/42.json')) {
        return new Response(
          JSON.stringify({
            id: 42,
            title: 'linux.do',
            created_at: '2026-05-20T00:00:00.000Z',
            post_stream: {
              stream: [100, 101],
              posts: []
            }
          })
        );
      }
      return new Response(
        JSON.stringify({
          post_stream: {
            posts: [
              {
                id: 101,
                post_number: 99,
                username: 'wrong',
                cooked: '<p>wrong</p>',
                created_at: '2026-05-20T00:01:00.000Z'
              }
            ]
          }
        })
      );
    });

    await expect(getReply({ source: 'linuxdo', id: '42', floor: 2, fetcher })).rejects.toThrow('引用楼层未找到');
  });
});
