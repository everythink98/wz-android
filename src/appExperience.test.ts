import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');

describe('Android App experience guards', () => {
  it('shows loading and failure states inside image preview', () => {
    expect(appSource).toContain('imagePreviewLoading');
    expect(appSource).toContain('imagePreviewFailed');
    expect(appSource).toContain('onLoadStart={() =>');
    expect(appSource).toContain('onError={() =>');
  });

  it('keeps list item actions behind the swipe gesture instead of showing permanent icons', () => {
    expect(appSource).toContain('topicSwipeActionButton');
    expect(appSource).not.toContain('topicInlineAction');
    expect(appSource).not.toContain('topicMetaPressable');
  });

  it('uses more helpful empty messages for filtered feed lists', () => {
    expect(appSource).toContain('feedEmptyText');
    expect(appSource).toContain('当前筛选没有匹配主题');
  });

  it('loads additional feed pages automatically near the end of the list', () => {
    expect(appSource).toContain('onEndReachedThreshold={0.6}');
    expect(appSource).toContain('onEndReached={requestFeedLoadMore}');
    expect(appSource).toContain('shouldLoadMoreFeedFromScroll(event.nativeEvent)');
    expect(appSource).toContain('requestedFeedPageRef.current === nextPage');
  });

  it('shows loading instead of stale rows when resetting the feed list', () => {
    expect(appSource).toContain('clearItems = reset && !nocache');
    expect(appSource).toContain('if (!isLoadMore && reset && clearItems) {');
    expect(appSource).toContain('setFeedItems([]);');
    expect(appSource).toContain('setFeedHasMore(false);');
  });

  it('bypasses feed caches when switching source tabs or categories', () => {
    expect(appSource).toContain('source: feedSource, category: categoryFilter, nocache: true, clearItems: true');
  });

  it('bypasses feed caches when loading additional feed pages', () => {
    expect(appSource).toContain("onLoadMore={() => loadFeed({ page: feedPage + 1, cursor: feedSource === 'all' ? feedNextCursor : undefined, nocache: true })}");
  });

  it('allows reset feed requests to replace stale loads when switching source tabs or categories', () => {
    expect(appSource).toContain('if (feedLoadingRef.current && !reset) {');
    expect(appSource).not.toContain('feedLoadingRef.current && (!reset || nocache)');
  });

  it('uses concise update wording for refresh and sync feedback', () => {
    expect(appSource).toContain("notify('正在更新列表')");
    expect(appSource).toContain("successMessage: '列表已更新'");
    expect(appSource).toContain("notify('主题已更新')");
    expect(appSource).toContain("notify('同步已更新，本机和云端资料已合并')");
    expect(appSource).toContain("notify('同步已保存')");
    expect(appSource).toContain("notify('状态已更新')");
    expect(appSource).not.toContain('正在刷新，请稍候');
    expect(appSource).not.toContain('正在刷新主题');
    expect(appSource).not.toContain('主题已读取');
    expect(appSource).not.toContain('同步读取成功');
    expect(appSource).not.toContain('同步保存成功');
    expect(appSource).not.toContain('状态检查完成');
  });

  it('labels the saved-topics area as favorites in the bottom navigation and screen title', () => {
    expect(appSource).toContain("{ value: 'library', label: '收藏', icon: Star }");
    expect(appSource).toContain('<Text style={styles.sectionTitle}>收藏</Text>');
    expect(appSource).not.toContain("{ value: 'library', label: '书架', icon: BookMarked }");
    expect(appSource).not.toContain('<Text style={styles.sectionTitle}>书架</Text>');
  });

  it('shows a filled favorite icon without an active button shell on Android topic details', () => {
    expect(appSource).toContain("fill={active ? theme.primary : 'none'}");
    expect(appSource).toContain('active && !iconOnly && styles.buttonActive');
  });

  it('uses content-like placeholders for shared loading states instead of only a spinner', () => {
    expect(appSource).toContain('loadingPlaceholderStack');
    expect(appSource).toContain('loadingPlaceholderLine');
    expect(appSource).toContain('loadingPlaceholderLineShort');
    expect(appSource).toContain('loadingPlaceholderLineMuted');
    expect(appSource).toContain('Array.from({ length: 3 })');
  });

  it('marks topics with extra access requirements in Android lists and details', () => {
    expect(appSource).toContain('topic.accessRequirement?.label');
    expect(appSource).toContain('styles.topicAccessBadge');
    expect(appSource).toContain('item.accessRequirement?.label');
  });

  it('shows a bottom message when the feed cannot load more', () => {
    expect(appSource).toContain('已经到底了');
    expect(appSource).toContain('styles.endOfListText');
  });

});
