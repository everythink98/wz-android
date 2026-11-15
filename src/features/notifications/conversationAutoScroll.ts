type ConversationAutoScrollController = {
  contentChanged: (contentKey: string) => boolean;
  userScrolled: () => void;
  viewportChanged: (distanceFromEnd: number) => void;
  reset: () => void;
  observesViewport: () => boolean;
};

// A viewport getter can reset observation before the admitted event finishes.
type ConversationFollowPhase = 'initial-following' | 'initial-reader-controlled' | 'following' | 'reader-controlled';

export function createConversationAutoScrollController(): ConversationAutoScrollController {
  let phase: ConversationFollowPhase = 'initial-following';

  return {
    contentChanged(contentKey) {
      return Boolean(contentKey) && (phase === 'initial-following' || phase === 'following');
    },
    userScrolled() {
      phase = 'reader-controlled';
    },
    viewportChanged(distanceFromEnd) {
      const away = distanceFromEnd > 80;
      const observing = phase === 'following' || phase === 'reader-controlled';
      phase = away
        ? observing
          ? 'reader-controlled'
          : 'initial-reader-controlled'
        : observing
          ? 'following'
          : 'initial-following';
    },
    reset() {
      phase = 'initial-following';
    },
    observesViewport() {
      return phase === 'following' || phase === 'reader-controlled';
    }
  };
}
