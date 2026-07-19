import { describe, expect, it } from 'vitest';

import { discourseEmojiUrlMapFromData, discourseReactionStats } from './discourseReactions';

describe('portable Discourse reaction presentation', () => {
  it('[REG-XIAOYINSI-017] renders reactions with the current site emoji catalog', () => {
    const item = {
      likeCount: 5,
      reactionSummary: [{ id: '+1', count: 2 }]
    };
    expect(discourseReactionStats(item, {
      heart: 'https://forum.xiaoyinsi.com/images/emoji/twitter/heart.png?v=15',
      '+1': 'https://forum.xiaoyinsi.com/images/emoji/twitter/+1.png?v=15'
    })).toEqual([
      {
        id: 'heart',
        label: 'heart',
        value: 5,
        imageUrl: 'https://forum.xiaoyinsi.com/images/emoji/twitter/heart.png?v=15'
      },
      {
        id: '+1',
        label: '+1',
        value: 2,
        imageUrl: 'https://forum.xiaoyinsi.com/images/emoji/twitter/+1.png?v=15'
      }
    ]);
  });

  it('parses a site-owned emoji catalog into absolute urls', () => {
    expect(discourseEmojiUrlMapFromData({
      custom: [
        { name: 'temple', url: '/uploads/default/original/temple.png?v=15' }
      ],
      people: [
        { name: '+1', url: '/images/emoji/twitter/+1.png?v=15' }
      ],
      ignored: { name: 'bad' }
    }, 'https://forum.xiaoyinsi.com')).toEqual({
      '+1': 'https://forum.xiaoyinsi.com/images/emoji/twitter/+1.png?v=15',
      temple: 'https://forum.xiaoyinsi.com/uploads/default/original/temple.png?v=15'
    });
  });

  it('falls back to a readable label when a reaction is absent from the catalog', () => {
    expect(discourseReactionStats({
      reactionSummary: [{ id: 'unknown_custom', count: 1 }]
    })).toEqual([{
      id: 'unknown_custom',
      label: 'unknown custom',
      value: 1
    }]);
  });
});
