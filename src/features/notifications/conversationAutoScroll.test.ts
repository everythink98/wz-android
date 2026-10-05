import { describe, expect, it } from 'vitest';
import { createConversationAutoScrollController } from './conversationAutoScroll';

describe('conversation auto scroll', () => {
  it('follows initial async content growth until the user takes control', () => {
    const controller = createConversationAutoScrollController();

    expect(controller.contentChanged('')).toBe(false);
    expect(controller.contentChanged('message-1')).toBe(true);
    expect(controller.contentChanged('message-1')).toBe(true);
    expect(controller.contentChanged('message-1:message-2')).toBe(true);

    controller.userScrolled();

    expect(controller.contentChanged('message-1')).toBe(false);
    expect(controller.contentChanged('message-1:message-2')).toBe(false);
    expect(controller.contentChanged('')).toBe(false);
  });

  it('resumes following near the bottom and stops when scrolling away again', () => {
    const controller = createConversationAutoScrollController();

    controller.userScrolled();
    controller.viewportChanged(81);
    expect(controller.contentChanged('message-1')).toBe(false);

    controller.viewportChanged(80);
    expect(controller.contentChanged('message-1:message-2')).toBe(true);

    controller.viewportChanged(120);
    expect(controller.contentChanged('message-1:message-2:message-3')).toBe(false);

    controller.viewportChanged(0);
    expect(controller.contentChanged('message-1:message-2:message-3')).toBe(true);
    expect(controller.contentChanged('')).toBe(false);

    controller.userScrolled();
    expect(controller.contentChanged('message-1:message-2:message-3:message-4')).toBe(false);
  });
});
