export type ConversationAutoScrollController = {
  contentChanged: (contentKey: string) => boolean;
  userScrolled: () => void;
  viewportChanged: (distanceFromEnd: number) => void;
};

export function createConversationAutoScrollController(): ConversationAutoScrollController {
  let userControlsPosition = false;

  return {
    contentChanged(contentKey) {
      return Boolean(contentKey) && !userControlsPosition;
    },
    userScrolled() {
      userControlsPosition = true;
    },
    viewportChanged(distanceFromEnd) {
      userControlsPosition = distanceFromEnd > 80;
    }
  };
}
