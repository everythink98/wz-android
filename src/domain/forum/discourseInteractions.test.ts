import { describe, expect, it } from 'vitest';
import { discourseBoostStats, discourseReactionPreview } from './discourseInteractions';

describe('Discourse boost limits', () => {
  it('switches a single current reaction and cancels only the selected reaction', () => {
    const post = { currentUserReaction: { id: 'heart', canUndo: true }, reactionSummary: [{ id: 'heart', count: 2 }] };
    const switched = discourseReactionPreview(post, 'bili_057', 'heart');
    expect(switched).toMatchObject({
      currentUserReaction: { id: 'bili_057', canUndo: true },
      reactionSummary: [
        { id: 'heart', count: 1 },
        { id: 'bili_057', count: 1 }
      ],
      liked: false
    });
    expect(discourseReactionPreview({ ...post, ...switched }, 'bili_057', 'heart')).toMatchObject({
      currentUserReaction: null,
      reactionSummary: [{ id: 'heart', count: 1 }]
    });
  });
  it('counts custom emoji shortcodes and Unicode clusters as visible characters', () => {
    expect(discourseBoostStats('前排 :bili_057: 👨‍👩‍👧‍👦 👍🏽 🇨🇳', ['bili_057'])).toEqual({
      length: 10,
      emojiCount: 4,
      valid: true
    });
    expect(discourseBoostStats('e\u0301'.repeat(16), [])).toEqual({ length: 16, emojiCount: 0, valid: true });
    expect(discourseBoostStats('好'.repeat(17), []).valid).toBe(false);
    expect(discourseBoostStats(':bili_057:'.repeat(6), ['bili_057']).valid).toBe(false);
    expect(discourseBoostStats('   ', []).valid).toBe(false);
    expect(discourseBoostStats(':unknown:', []).length).toBe(9);
  });
});
