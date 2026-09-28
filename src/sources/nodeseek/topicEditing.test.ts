import { describe, expect, it } from 'vitest';
import { createTopicEditTransport } from '../../../tests/helpers/topicEditingTransport';
import { draftFromTopicEdit } from '@/domain/forum/topicComposer';
import { editNodeSeekTopic, loadNodeSeekTopicEditContext } from './topicEditing';

describe('NodeSeek own opening edits', () => {
  it('loads original markdown and sends the discussion id and editable fields without category', async () => {
    const transport = createTopicEditTransport('nodeseek');
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'nodeseek:42' };
    const context = await loadNodeSeekTopicEditContext(options);
    expect(context).toMatchObject({
      original: { body: transport.state.body },
      permissions: { categoryId: false },
      rules: { ranks: [0, 1, 2, 255] }
    });
    const draft = { ...draftFromTopicEdit(context), title: '新的主帖标题' };
    expect(await editNodeSeekTopic({ ...options, draft })).toHaveProperty('status', 'saved');
    expect(JSON.parse(transport.writes()[0]!.body!)).toEqual({
      title: draft.title,
      content: context.original.body,
      postId: 123,
      mode: 'edit-discussion',
      rank: 0
    });
  });

  it('rejects another author and detects changed originals before dispatch', async () => {
    const transport = createTopicEditTransport('nodeseek');
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'nodeseek:42' };
    const context = await loadNodeSeekTopicEditContext(options);
    const draft = { ...draftFromTopicEdit(context), title: '本机修改' };
    transport.state.body = '别处修改';
    expect(await editNodeSeekTopic({ ...options, draft })).toMatchObject({
      status: 'conflict',
      latest: { body: '别处修改' }
    });
    transport.state.owner = '84';
    await expect(loadNodeSeekTopicEditContext(options)).rejects.toThrow('本人');
    expect(transport.writes()).toHaveLength(0);
  });

  it.each([200, 408, 409, 500])('does not mistake ambiguous HTTP %s for a safe retry or success', async (status) => {
    const transport = createTopicEditTransport('nodeseek');
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'nodeseek:42' };
    const context = await loadNodeSeekTopicEditContext(options);
    transport.respond(() => Response.json({}, { status }));
    expect(
      await editNodeSeekTopic({ ...options, draft: { ...draftFromTopicEdit(context), title: '新标题' } })
    ).toHaveProperty('status', 'unknown');
    expect(transport.writes()).toHaveLength(1);
  });
});
