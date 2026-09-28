import { describe, expect, it } from 'vitest';
import { createTopicEditTransport } from '../../../tests/helpers/topicEditingTransport';
import { draftFromTopicEdit } from '@/domain/forum/topicComposer';
import { editLinuxDoTopic, loadLinuxDoTopicEditContext } from './topicEditing';

describe('linux.do own opening edits', () => {
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
