import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const topicCardSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'components', 'TopicCard.tsx'), 'utf8');
const feedScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'FeedScreen.tsx'), 'utf8');
const searchScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'SearchScreen.tsx'), 'utf8');
const libraryScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'LibraryScreen.tsx'), 'utf8');
const listSource = [topicCardSource, feedScreenSource, searchScreenSource, libraryScreenSource].join('\n');

describe('Android topic list swipe layout', () => {
  it('uses swipe actions for feed, search, and library topic rows', () => {
    expect(listSource).toContain("kind: 'favorite'");
    expect(listSource).toContain("kind: 'delete'");
    expect(feedScreenSource).toContain('swipeAction={favoriteSwipeAction}');
    expect(searchScreenSource).toContain('swipeAction={favoriteSwipeAction}');
    expect(libraryScreenSource).toContain('swipeAction={bulkMode ? undefined : deleteSwipeAction}');
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
    expect(topicCardSource).toContain("readerState.tracked ? '追踪命中' : ''");
  });

  it('does not make the full swipe row transparent when a topic is marked read', () => {
    expect(topicCardSource).not.toMatch(/styles\.topicCard,\s*readerState\.read && styles\.topicCardRead,/);
    expect(topicCardSource).toContain('style={[styles.topicCardPressable, readerState.read && styles.topicCardRead]}');
    expect(topicCardSource).toContain('style={[styles.topicMetaRow, readerState.read && styles.topicCardRead]}');
  });
});
