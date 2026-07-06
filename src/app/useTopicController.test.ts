import { describe, expect, it } from 'vitest';
import { replyCountAfterNewReplySubmit } from '../androidFeatureHelpers';

describe('topic controller helpers', () => {
  it('increments visible reply count after a new reply submit', () => {
    expect(replyCountAfterNewReplySubmit(0, 1)).toBe(1);
    expect(replyCountAfterNewReplySubmit(100, 30)).toBe(101);
    expect(replyCountAfterNewReplySubmit(1, 3)).toBe(3);
  });
});
