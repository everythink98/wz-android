import { describe, expect, it } from 'vitest';
import { createTopicEditTransport } from '../../../tests/helpers/topicEditingTransport';
import { draftFromTopicEdit } from '@/domain/forum/topicComposer';
import { editYaohuoTopic, loadYaohuoTopicEditContext } from './topicEditing';

describe('Yaohuo own opening edits', () => {
  it('decodes form text exactly once so a body-only edit leaves entity literals in the title intact', async () => {
    const transport = createTopicEditTransport('yaohuo');
    transport.state.title = '示例 &amp; &lt; &quot;';
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'yaohuo:42' };
    const context = await loadYaohuoTopicEditContext(options);
    expect(context.original.title).toBe(transport.state.title);
    expect(
      await editYaohuoTopic({ ...options, draft: { ...draftFromTopicEdit(context), body: '只修改正文' } })
    ).toHaveProperty('status', 'saved');
    expect(new URLSearchParams(transport.writes()[0]!.body).get('book_title')).toBe(transport.state.title);
  });

  it('preserves raw UBB and obtains a fresh token without persisting it in context', async () => {
    const transport = createTopicEditTransport('yaohuo');
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'yaohuo:42' };
    const context = await loadYaohuoTopicEditContext(options);
    expect(context.original.body).toBe(transport.state.body);
    expect(JSON.stringify(context)).not.toContain('fixture-edit-token');
    const draft = { ...draftFromTopicEdit(context), title: '修改标题', additionalReward: '1000' };
    expect(await editYaohuoTopic({ ...options, draft })).toHaveProperty('status', 'saved');
    const fields = new URLSearchParams(transport.writes()[0]!.body);
    expect(fields.get('token')).toBe('fixture-edit-token-2');
    expect(fields.get('book_content')).toBe(context.original.body);
    expect(fields.get('additionalReward')).toBe('1000');
    expect(fields.get('id')).toBe('123');
  });

  it('checks ownership and conflicting raw content before saving', async () => {
    const transport = createTopicEditTransport('yaohuo');
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'yaohuo:42' };
    const draft = draftFromTopicEdit(await loadYaohuoTopicEditContext(options));
    transport.state.title = '另一处更改';
    expect(await editYaohuoTopic({ ...options, draft: { ...draft, body: '本机更改' } })).toHaveProperty(
      'status',
      'conflict'
    );
    transport.state.owner = '84';
    await expect(loadYaohuoTopicEditContext(options)).rejects.toThrow('本人');
    expect(transport.writes()).toHaveLength(0);
  });

  it('recognizes explicit rejection and does not infer reward payment from matching content', async () => {
    const transport = createTopicEditTransport('yaohuo');
    const options = { ...transport, userAgent: 'test', topicId: '123', identityKey: 'yaohuo:42' };
    const draft = draftFromTopicEdit(await loadYaohuoTopicEditContext(options));
    transport.respond(() => new Response('<div class="tip">余额不足</div>'));
    expect(await editYaohuoTopic({ ...options, draft: { ...draft, additionalReward: '1000' } })).toHaveProperty(
      'status',
      'rejected'
    );
    transport.respond(() => new Response('<html>跳转</html>'));
    expect(await editYaohuoTopic({ ...options, draft: { ...draft, additionalReward: '1000' } })).toHaveProperty(
      'status',
      'unknown'
    );
    expect(transport.writes()).toHaveLength(2);
  });

  it.each(['matching', 'changed', 'unavailable'] as const)(
    'uses one readback to resolve an ambiguous plain-edit receipt when the original is %s',
    async (readback) => {
      const transport = createTopicEditTransport('yaohuo');
      let posted = false;
      let reads = 0;
      const fetcher: typeof transport.fetcher = async (input, init) => {
        if (init?.method !== 'POST') {
          reads += 1;
          if (posted && readback === 'unavailable') throw new Error('readback unavailable');
        }
        return transport.fetcher(input, init);
      };
      const options = { fetcher, userAgent: 'test', topicId: '123', identityKey: 'yaohuo:42' };
      const draft = {
        ...draftFromTopicEdit(await loadYaohuoTopicEditContext(options)),
        body: '本机修改的完整原文\n[custom]保留[/custom]'
      };
      transport.respond((_path, body) => {
        posted = true;
        if (readback === 'matching') {
          const fields = new URLSearchParams(body);
          transport.state.title = fields.get('book_title')!;
          transport.state.body = fields.get('book_content')!;
        }
        return new Response('<html>正在跳转</html>');
      });

      const result = await editYaohuoTopic({ ...options, draft });

      expect(result.status).toBe(readback === 'matching' ? 'saved' : 'unknown');
      if (readback === 'matching') expect(result.message).toBe('已回读确认修改');
      expect(transport.writes()).toHaveLength(1);
      // Each edit context reads the topic and its current form; failed readback stops at its first read.
      expect(reads).toBe(readback === 'unavailable' ? 5 : 6);
    }
  );
});
