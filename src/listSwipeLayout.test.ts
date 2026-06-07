import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const topicCardSource = readProjectFile('src', 'components', 'TopicCard.tsx');
const feedScreenSource = readProjectFile('src', 'screens', 'FeedScreen.tsx');
const searchScreenSource = readProjectFile('src', 'screens', 'SearchScreen.tsx');
const libraryScreenSource = readProjectFile('src', 'screens', 'LibraryScreen.tsx');
const listSource = [topicCardSource, feedScreenSource, searchScreenSource, libraryScreenSource].join('\n');
const removedTrackedMark = `追${''}踪命中`;

describe('Android topic list swipe layout', () => {
  it('does not attach swipe actions to feed, search, or library topic rows', () => {
    expect(listSource).not.toContain('topicSwipeActionButton');
    expect(listSource).not.toContain('TopicSwipeActionConfig');
    expect(listSource).not.toContain('swipeAction=');
    expect(listSource).not.toContain('swipeOpenKey');
    expect(listSource).not.toContain('onSwipeActiveChange');
    expect(listSource).not.toContain('onSwipeOpen');
    expect(listSource).not.toContain('onSwipeClose');
  });

  it('does not keep a permanent favorite button in the topic list row footer', () => {
    expect(listSource).not.toContain('topicMarks');
    expect(listSource).not.toContain('toggleFavoritePress');
    expect(listSource).not.toContain('label={readerState.favorite ?');
    expect(listSource).not.toContain('topicInlineAction');
    expect(listSource).not.toContain('topicMetaPressable');
  });

  it('keeps topic row metadata as passive reading information', () => {
    expect(topicCardSource).toContain('const metaParts = [');
    expect(topicCardSource).toContain("readerState.favorite ? '已收藏' : ''");
    expect(topicCardSource).not.toContain(removedTrackedMark);
  });

  it('does not make the full topic row transparent when a topic is marked read', () => {
    expect(topicCardSource).not.toMatch(/styles\.topicCard,\s*readerState\.read && styles\.topicCardRead,/);
    expect(topicCardSource).toContain('style={[styles.topicCardPressable, readerState.read && styles.topicCardRead]}');
    expect(topicCardSource).toContain('style={[styles.topicMetaRow, readerState.read && styles.topicCardRead]}');
  });

  it('does not tint full topic rows for tracked keywords', () => {
    expect(topicCardSource).not.toContain('readerState.tracked && styles.topicCardTracked');
  });
});
