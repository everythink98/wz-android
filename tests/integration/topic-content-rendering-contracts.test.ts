import { describe, expect, it } from 'vitest';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import { compileForumContent, resolveForumContentRowHtml } from '@/domain/forum/topicContentSplit';
import { INLINE_FORUM_IMAGE_TAG } from '@/domain/forum/forumContentMedia';
import { createImagePreviewCatalog } from '@/platform/media/imagePreviewCatalog';

describe('topic content rendering contracts', () => {
  it('[REG-TOPIC-030] keeps sanitized unsafe lazy candidates out of the active preview catalog', () => {
    const rendered = compileForumContent({
      html: sanitizeContentHtml(
        '<img src="/safe.png" data-original="javascript:x.png">',
        'https://linux.do/t/example/1'
      ),
      role: 'reply',
      source: 'linuxdo'
    }).rows.flatMap((row) => (row.type === 'html' ? [row.html] : []));

    expect(createImagePreviewCatalog(rendered, 300, 2).items).toEqual([
      {
        displayUri: 'https://linux.do/safe.png',
        originalUri: 'https://linux.do/safe.png'
      }
    ]);
  });

  it('[REG-PERF-010] keeps the preview catalog on raw source order while presentation variants change', () => {
    const urls = ['https://i.imgur.com/first.png', 'https://i.imgur.com/second.png'];
    const rawHtml = `<p>${urls.map((url) => `<img class="embedded_image" src="${url}">`).join('')}</p>`;
    const row = compileForumContent({ html: rawHtml, role: 'reply', source: 'v2ex' }).rows.find(
      (candidate) => candidate.type === 'html'
    );
    expect(row?.type).toBe('html');
    if (!row || row.type !== 'html') throw new Error('Expected a rendered HTML row.');

    expect(createImagePreviewCatalog([rawHtml], 360, 2).items.map((item) => item.originalUri)).toEqual(urls);
    expect(resolveForumContentRowHtml(row, { [urls[0]]: true })).toContain(`<${INLINE_FORUM_IMAGE_TAG}`);
    expect(createImagePreviewCatalog([rawHtml], 360, 2).items.map((item) => item.originalUri)).toEqual(urls);
  });
});
