import { describe, expect, it } from 'vitest';
import { replyComposerSelectionIndexFromPress } from './replyComposerSelection';

describe('reply composer selection', () => {
  it('keeps an empty reply at the start', () => {
    expect(replyComposerSelectionIndexFromPress({ content: '', inputWidth: 320, locationX: 20, locationY: 20 })).toBe(0);
  });

  it('places the cursor near the pressed character on a short line', () => {
    expect(replyComposerSelectionIndexFromPress({ content: 'abcdef', inputWidth: 320, locationX: 12, locationY: 20 })).toBe(0);
    expect(replyComposerSelectionIndexFromPress({ content: 'abcdef', inputWidth: 320, locationX: 28, locationY: 20 })).toBe(2);
    expect(replyComposerSelectionIndexFromPress({ content: 'abcdef', inputWidth: 320, locationX: 80, locationY: 20 })).toBe(6);
  });

  it('uses the pressed line for multiline replies', () => {
    expect(replyComposerSelectionIndexFromPress({ content: 'first\nsecond', inputWidth: 320, locationX: 12, locationY: 42 })).toBe(6);
    expect(replyComposerSelectionIndexFromPress({ content: 'first\nsecond', inputWidth: 320, locationX: 60, locationY: 42 })).toBe(12);
  });
});
