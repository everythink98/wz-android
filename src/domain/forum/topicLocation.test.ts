import { describe, expect, it } from 'vitest';
import type { ReplyLocationTarget, Source, TopicDetail } from './models';
import { resolveTopicLocation, topicLocationForReply } from './topicLocation';

const topic: TopicDetail = {
  source: 'linuxdo',
  id: '42',
  title: 'Topic',
  author: 'Alice',
  authorId: 'alice',
  url: 'https://linux.do/t/42',
  createdAt: '',
  contentHtml: '',
  replies: [],
  commentId: 100
};

describe('topic navigation intent', () => {
  it.each<Source>(['linuxdo', 'nodeseek', 'v2ex', 'yaohuo'])(
    'keeps %s ordinary opens and explicit openings distinct',
    (source) => {
      expect(resolveTopicLocation({ ...topic, source }, undefined)).toBeUndefined();
      expect(resolveTopicLocation({ ...topic, source }, { kind: 'opening' })).toEqual({ kind: 'opening' });
      expect(topicLocationForReply(source, { floor: 1 })).toEqual(
        source === 'linuxdo' ? { kind: 'opening' } : { kind: 'reply', target: { floor: 1 } }
      );
      expect(topicLocationForReply(source, { floor: 6, pageHint: 2 })).toEqual({
        kind: 'reply',
        target: { floor: 6, pageHint: 2 }
      });
    }
  );

  it('resolves a confirmed opening ID while preserving ID precedence and author checks', () => {
    expect(resolveTopicLocation(topic, { kind: 'reply', target: { commentId: 100 } })).toEqual({ kind: 'opening' });
    expect(
      resolveTopicLocation(topic, {
        kind: 'reply',
        target: { commentId: 100, floor: 99, expectedAuthorUsername: 'ALICE' }
      })
    ).toEqual({ kind: 'opening' });
    for (const target of [
      { commentId: 101, floor: 1 },
      { commentId: 100, expectedAuthorUsername: 'bob' },
      { floor: 1, expectedAuthorUsername: '' }
    ]) {
      expect(resolveTopicLocation(topic, { kind: 'reply', target })).toEqual({ kind: 'reply', target });
    }
    expect(resolveTopicLocation(null, { kind: 'reply', target: { commentId: 100 } })).toEqual({
      kind: 'reply',
      target: { commentId: 100 }
    });
  });

  it.each<ReplyLocationTarget>([
    { floor: 0 },
    { floor: -1 },
    { floor: 1.5 },
    { floor: NaN },
    { floor: Infinity },
    { floor: 9007199254740992 },
    { floor: 1, commentId: 0 },
    { pageHint: 1 },
    {}
  ])('does not reinterpret invalid or incomplete identities as the opening post: %j', (target) => {
    expect(topicLocationForReply('linuxdo', target, topic)).toEqual({ kind: 'reply', target });
  });
});
