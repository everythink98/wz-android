import { describe, expect, it } from 'vitest';
import { createConversationAutoScrollController } from './conversationAutoScroll';

describe('conversation auto scroll', () => {
  it('follows initial async content growth until the user takes control', () => {
    const controller = createConversationAutoScrollController();

    expect(controller.contentChanged('message-1')).toBe(true);
    expect(controller.contentChanged('message-1')).toBe(true);

    controller.userScrolled();

    expect(controller.contentChanged('message-1')).toBe(false);
    expect(controller.contentChanged('message-1:message-2')).toBe(true);
    expect(controller.contentChanged('')).toBe(false);
  });
});
