import { describe, expect, it } from 'vitest';
import { replyComposerHasNoReplyAfter, replyComposerListIndex } from './topicScreenHelpers';

describe('topic screen helpers', () => {
  it('finds the reply composer wherever the topic list inserted it', () => {
    expect(replyComposerListIndex([
      { type: 'replyControls' },
      { type: 'replyComposer' },
      { type: 'reply' }
    ])).toBe(1);

    expect(replyComposerListIndex([
      { type: 'replyControls' },
      { type: 'reply' },
      { type: 'replyComposer' },
      { type: 'reply' }
    ])).toBe(2);

    expect(replyComposerListIndex([
      { type: 'replyControls' },
      { type: 'reply' }
    ])).toBeNull();
  });

  it('detects whether the reply composer has real replies after it', () => {
    expect(replyComposerHasNoReplyAfter([
      { type: 'replyControls' },
      { type: 'replyComposer' },
      { type: 'emptyReplies' }
    ])).toBe(true);

    expect(replyComposerHasNoReplyAfter([
      { type: 'replyControls' },
      { type: 'replyComposer' },
      { type: 'reply' }
    ])).toBe(false);
  });
});
