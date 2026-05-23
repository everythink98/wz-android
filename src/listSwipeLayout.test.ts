import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');

describe('Android topic list swipe layout', () => {
  it('uses swipe actions for feed, search, and library topic rows', () => {
    expect(appSource).toContain("kind: 'favorite'");
    expect(appSource).toContain("kind: 'delete'");
    expect(appSource).toContain('swipeAction={favoriteSwipeAction}');
    expect(appSource).toContain('swipeAction={bulkMode ? undefined : deleteSwipeAction}');
  });

  it('does not keep a permanent favorite button in the topic list row footer', () => {
    expect(appSource).not.toContain('topicMarks');
    expect(appSource).not.toContain('toggleFavoritePress');
    expect(appSource).not.toContain('label={readerState.favorite ?');
    expect(appSource).not.toContain('topicInlineAction');
    expect(appSource).not.toContain('topicMetaPressable');
  });

  it('keeps topic row metadata as passive reading information', () => {
    expect(appSource).toContain('const metaParts = [');
    expect(appSource).toContain("readerState.favorite ? '已收藏' : ''");
    expect(appSource).toContain("readerState.tracked ? '追踪命中' : ''");
  });

  it('does not make the full swipe row transparent when a topic is marked read', () => {
    expect(appSource).not.toMatch(/styles\.topicCard,\s*readerState\.read && styles\.topicCardRead,/);
    expect(appSource).toContain('style={[styles.topicCardPressable, readerState.read && styles.topicCardRead]}');
    expect(appSource).toContain('style={[styles.topicMetaRow, readerState.read && styles.topicCardRead]}');
  });
});
