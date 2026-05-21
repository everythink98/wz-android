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
});
