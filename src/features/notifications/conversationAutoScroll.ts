export type ConversationAutoScrollController = {
  contentChanged: (conversationKey: string) => boolean;
  userScrolled: () => void;
};

export function createConversationAutoScrollController(): ConversationAutoScrollController {
  let activeConversationKey = '';
  let userControlsPosition = false;

  return {
    contentChanged(conversationKey) {
      if (!conversationKey) return false;
      if (activeConversationKey !== conversationKey) {
        activeConversationKey = conversationKey;
        userControlsPosition = false;
      }
      return !userControlsPosition;
    },
    userScrolled() {
      userControlsPosition = true;
    }
  };
}
