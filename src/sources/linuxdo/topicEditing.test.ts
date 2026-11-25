import { describe, expect, it, vi } from 'vitest';
import { createTopicEditTransport } from '../../../tests/helpers/topicEditingTransport';
import { draftFromTopicEdit } from '@/domain/forum/topicComposer';
import { withRequestBeforeSend } from '@/platform/network/request';
import { editLinuxDoTopic, loadLinuxDoTopicEditContext } from './topicEditing';

describe('linux.do own opening edits', () => {
  it.each([false, true])('classifies transport rejection before the PUT with saved metadata = %s', async (metadata) => {
    const transport = createTopicEditTransport('linuxdo');
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'linuxdo:42' };
    const context = await loadLinuxDoTopicEditContext(options);
    const draft = { ...draftFromTopicEdit(context), ...(metadata ? { title: '新标题' } : {}), body: '新正文' };
    const fetcher: typeof transport.fetcher = (url, init) => {
      if (url.endsWith('/posts/789.json') && init?.method === 'PUT') {
        let ready = true;
        return withRequestBeforeSend(
          (input, request) => {
            ready = false;
            return transport.fetcher(input, request);
          },
          () => {
            if (!ready) throw new Error('账号已切换');
          }
        )(url, init);
      }
      return transport.fetcher(url, init);
    };
    const result = await editLinuxDoTopic({ ...options, fetcher, context, draft, checkpoint: async () => {} });
    expect(transport.writes()).toHaveLength(metadata ? 1 : 0);
    expect(result).toMatchObject({ status: metadata ? 'partial' : 'rejected' });
  });

  it.each([{ categoryId: '5' }, { tags: [{ name: '旧格式' }, { id: 12, name: '技术' }] }])(
    'reports concurrent removal of a legacy tag before validation when changing %j',
    async (change) => {
      const transport = createTopicEditTransport('linuxdo');
      const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'linuxdo:42' };
      const base = await loadLinuxDoTopicEditContext(options);
      const draft = {
        ...draftFromTopicEdit({ ...base, original: { ...base.original, tags: [{ name: '旧格式' }] } }),
        ...change
      };
      const result = await editLinuxDoTopic({ ...options, context: base, draft, checkpoint: async () => {} });
      expect(result).toMatchObject({ status: 'conflict', latest: { tags: base.original.tags } });
      expect(transport.writes()).toHaveLength(0);
    }
  );
  it('matches the author username from the account identity, even when a different account has that numeric ID', async () => {
    const transport = createTopicEditTransport('linuxdo');
    const fetcher: typeof transport.fetcher = async (url, init) => {
      const response = await transport.fetcher(url, init);
      return url.endsWith('/posts/789.json')
        ? Response.json({ ...(await response.json()), user_id: 42, username: 'Author' })
        : response;
    };
    const options = { fetcher, userAgent: 'test', topicId: '123' };
    await expect(loadLinuxDoTopicEditContext({ ...options, identityKey: 'linuxdo:author' })).resolves.toHaveProperty(
      'postId',
      789
    );
    await expect(loadLinuxDoTopicEditContext({ ...options, identityKey: 'linuxdo:42' })).rejects.toThrow('本人');
  });

  it('keeps existing string tags during a category edit while still refusing unknown tags', async () => {
    const transport = createTopicEditTransport('linuxdo');
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'linuxdo:42' };
    const base = await loadLinuxDoTopicEditContext(options);
    const context = { ...base, original: { ...base.original, tags: [{ name: '已有' }] } };
    const draft = { ...draftFromTopicEdit(context), categoryId: '5' };
    const edit = (value: typeof draft) =>
      editLinuxDoTopic({ ...options, context, draft: value, checkpoint: async () => {} });
    expect(await edit({ ...draft, tags: [{ name: 'unknown' }] } as typeof draft)).toHaveProperty('status', 'rejected');
    expect(await edit(draft)).toHaveProperty('status', 'saved');
  });

  it('retains the checkpoint and marks a challenge on the body as needing verification', async () => {
    const transport = createTopicEditTransport('linuxdo');
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'linuxdo:42' };
    const context = await loadLinuxDoTopicEditContext(options);
    transport.respond((path) =>
      path === '/posts/789.json'
        ? new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } })
        : undefined
    );
    const result = await editLinuxDoTopic({
      ...options,
      draft: { ...draftFromTopicEdit(context), title: '新标题', body: '新正文' },
      context,
      checkpoint: async () => {}
    });
    expect(result).toMatchObject({ status: 'partial', confirmed: { title: '新标题' }, verificationRequired: true });
    expect(transport.writes()).toHaveLength(2);
  });

  it('holds the body PUT until the confirmed metadata checkpoint finishes', async () => {
    const transport = createTopicEditTransport('linuxdo');
    const context = await loadLinuxDoTopicEditContext({
      ...transport,
      userAgent: 'test',
      topicId: '123',
      identityKey: 'linuxdo:42'
    });
    vi.useFakeTimers();
    const pending = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const draft = { ...draftFromTopicEdit(context), title: '新标题', body: '新正文' };
    let checkpoints = 0;
    const result = editLinuxDoTopic({
      ...transport,
      userAgent: 'test',
      context,
      draft,
      checkpoint: async () => {
        if (++checkpoints === 1) {
          entered.resolve();
          await pending.promise;
        }
      }
    });
    try {
      await entered.promise;
      expect(transport.writes().map((row) => row.path)).toEqual(['/t/-/123.json']);
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.writes().map((row) => row.path)).toEqual(['/t/-/123.json']);
      pending.resolve();
      expect(await result).toMatchObject({ status: 'saved', confirmed: { title: draft.title, body: draft.body } });
      expect(transport.writes().map((row) => row.path)).toEqual(['/t/-/123.json', '/posts/789.json']);
    } finally {
      pending.resolve();
      await Promise.allSettled([result]);
      vi.useRealTimers();
    }
  });

  it('retains confirmed metadata as partial when the body is rejected before dispatch', async () => {
    const transport = createTopicEditTransport('linuxdo');
    const context = await loadLinuxDoTopicEditContext({
      ...transport,
      userAgent: 'test',
      topicId: '123',
      identityKey: 'linuxdo:42'
    });
    const draft = { ...draftFromTopicEdit(context), title: '新标题', body: '新正文' };
    const fetcher = vi.fn(transport.fetcher).mockImplementation(async (url, init) => {
      if (new URL(url).pathname === '/session/csrf' && transport.writes().length > 0)
        throw new Error('body preparation failed');
      return transport.fetcher(url, init);
    });
    const result = await editLinuxDoTopic({
      ...transport,
      fetcher,
      userAgent: 'test',
      context,
      draft,
      checkpoint: async () => {}
    });
    expect(result).toMatchObject({ status: 'partial', confirmed: { title: draft.title } });
    expect(transport.writes().map((row) => row.path)).toEqual(['/t/-/123.json']);
  });

  it('retains both confirmed receipts as unknown when the body checkpoint cannot be persisted', async () => {
    const transport = createTopicEditTransport('linuxdo');
    const context = await loadLinuxDoTopicEditContext({
      ...transport,
      userAgent: 'test',
      topicId: '123',
      identityKey: 'linuxdo:42'
    });
    const draft = { ...draftFromTopicEdit(context), title: '新标题', body: '新正文' };
    let checkpoints = 0;
    const result = await editLinuxDoTopic({
      ...transport,
      userAgent: 'test',
      context,
      draft,
      checkpoint: async () => {
        if (++checkpoints === 2) throw new Error('body checkpoint failed');
      }
    });
    expect(result).toMatchObject({ status: 'unknown', confirmed: { title: draft.title, body: draft.body } });
    expect(transport.writes().map((row) => row.path)).toEqual(['/t/-/123.json', '/posts/789.json']);
  });

  it('does not expose private messages through the main-topic editing entry', async () => {
    const transport = createTopicEditTransport('linuxdo');
    await expect(
      loadLinuxDoTopicEditContext({
        userAgent: 'test',
        topicId: '123',
        identityKey: 'linuxdo:42',
        fetcher: async (url, init) => {
          const response = await transport.fetcher(url, init);
          return url.endsWith('/t/123.json')
            ? Response.json({ ...(await response.json()), archetype: 'private_message' })
            : response;
        }
      })
    ).rejects.toThrow('私信');
    expect(transport.writes()).toHaveLength(0);
  });

  it('stops stale tag-only edits before dispatch when the preflight sees external changes', async () => {
    const transport = createTopicEditTransport('linuxdo');
    transport.state.canEditTopic = false;
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'linuxdo:42' };
    const baseline = await loadLinuxDoTopicEditContext(options);
    const draft = { ...draftFromTopicEdit(baseline), tags: [] };
    transport.state.tags = [{ id: 25, name: '外部修改' }];
    const context = await loadLinuxDoTopicEditContext(options);
    expect(await editLinuxDoTopic({ ...options, draft, context, checkpoint: async () => {} })).toMatchObject({
      status: 'conflict',
      latest: { tags: transport.state.tags }
    });
    expect(transport.writes()).toHaveLength(0);
  });

  it('uses the first post id, preserves exact raw text and separates topic and body permissions', async () => {
    const transport = createTopicEditTransport('linuxdo');
    transport.state.canEditBody = false;
    const context = await loadLinuxDoTopicEditContext({
      ...transport,
      userAgent: 'test',
      topicId: '123',
      identityKey: 'linuxdo:42'
    });
    expect(context).toMatchObject({
      postId: 789,
      original: { body: transport.state.body },
      permissions: { title: true, body: false, tags: true }
    });
    transport.state.owner = '84';
    await expect(
      loadLinuxDoTopicEditContext({ ...transport, userAgent: 'test', topicId: '123', identityKey: 'linuxdo:42' })
    ).rejects.toThrow('本人');
    expect(transport.writes()).toHaveLength(0);
  });

  it('checkpoints metadata before body and retries only unfinished changes after a rejection', async () => {
    const transport = createTopicEditTransport('linuxdo');
    const context = await loadLinuxDoTopicEditContext({
      ...transport,
      userAgent: 'test',
      topicId: '123',
      identityKey: 'linuxdo:42'
    });
    const draft = { ...draftFromTopicEdit(context), title: '新的主帖标题', body: '更新的主帖正文' };
    transport.respond((path) =>
      path === '/posts/789.json' ? Response.json({ errors: ['正文拒绝'] }, { status: 422 }) : undefined
    );
    const checkpoints: unknown[] = [];
    const result = await editLinuxDoTopic({
      ...transport,
      userAgent: 'test',
      context,
      draft,
      checkpoint: async (fields) => {
        checkpoints.push(fields);
        expect(transport.writes().filter((row) => row.path === '/posts/789.json')).toHaveLength(0);
      }
    });
    expect(result).toMatchObject({ status: 'partial', confirmed: { title: draft.title } });
    expect(checkpoints).toEqual([{ title: draft.title }]);
    expect(JSON.parse(transport.writes()[0]!.body!)).toEqual({
      title: draft.title,
      original_title: context.original.title
    });
    expect(JSON.parse(transport.writes()[1]!.body!)).toEqual({
      post: { raw: draft.body, original_text: context.original.body }
    });
    transport.respond(undefined);
    const retry = { ...draft, edit: { ...draft.edit!, original: { ...draft.edit!.original, ...result.confirmed } } };
    expect(
      await editLinuxDoTopic({ ...transport, userAgent: 'test', context, draft: retry, checkpoint: async () => {} })
    ).toHaveProperty('status', 'saved');
    expect(transport.writes().map((row) => row.path)).toEqual(['/t/-/123.json', '/posts/789.json', '/posts/789.json']);
  });

  it('sends only tags with tag-only permission and does not write unchanged body', async () => {
    const transport = createTopicEditTransport('linuxdo');
    transport.state.canEditTopic = false;
    transport.state.canEditBody = false;
    const context = await loadLinuxDoTopicEditContext({
      ...transport,
      userAgent: 'test',
      topicId: '123',
      identityKey: 'linuxdo:42'
    });
    const draft = {
      ...draftFromTopicEdit(context),
      source: 'linuxdo' as const,
      tags: [],
      postVoting: false,
      appliedTemplate: ''
    };
    expect(
      await editLinuxDoTopic({ ...transport, userAgent: 'test', context, draft, checkpoint: async () => {} })
    ).toHaveProperty('status', 'saved');
    expect(transport.writes()).toMatchObject([{ path: '/t/123/tags' }]);
  });

  it.each([409, 500])('keeps HTTP %s conflicts or unknown results without retrying', async (status) => {
    const transport = createTopicEditTransport('linuxdo');
    const context = await loadLinuxDoTopicEditContext({
      ...transport,
      userAgent: 'test',
      topicId: '123',
      identityKey: 'linuxdo:42'
    });
    transport.respond(() => Response.json({ errors: ['changed'] }, { status }));
    const result = await editLinuxDoTopic({
      ...transport,
      userAgent: 'test',
      context,
      draft: { ...draftFromTopicEdit(context), body: '更改内容' },
      checkpoint: async () => {}
    });
    expect(result.status).toBe(status === 409 ? 'conflict' : 'unknown');
    expect(transport.writes()).toHaveLength(1);
  });

  it('stops before body if the metadata receipt cannot be persisted', async () => {
    const transport = createTopicEditTransport('linuxdo');
    const context = await loadLinuxDoTopicEditContext({
      ...transport,
      userAgent: 'test',
      topicId: '123',
      identityKey: 'linuxdo:42'
    });
    const result = await editLinuxDoTopic({
      ...transport,
      userAgent: 'test',
      context,
      draft: { ...draftFromTopicEdit(context), title: '新标题', body: '新正文' },
      checkpoint: async () => {
        throw new Error('disk full');
      }
    });
    expect(result.status).toBe('unknown');
    expect(transport.writes()).toHaveLength(1);
  });
});
