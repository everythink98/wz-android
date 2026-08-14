import { describe, expect, it } from 'vitest';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import type { Reply } from '@/domain/forum/models';
import { compileForumContent, resolveForumContentRowHtml } from '@/domain/forum/topicContentSplit';
import { INLINE_FORUM_IMAGE_TAG } from '@/domain/forum/forumContentMedia';
import { imagePreviewDescriptorsForReplies } from '@/features/topic/model/replyListModel';
import {
  createImagePreviewCatalog,
  createImagePreviewCatalogFromDescriptors,
  imagePreviewItemAt,
  imagePreviewListFromCatalog
} from '@/platform/media/imagePreviewCatalog';

describe('topic content rendering contracts', () => {
  it('[REG-TOPIC-030] keeps sanitized unsafe lazy candidates out of the active preview catalog', () => {
    const rendered = compileForumContent({
      html: sanitizeContentHtml(
        '<img src="/safe.png" data-original="javascript:x.png">',
        'https://linux.do/t/example/1'
      ),
      role: 'reply',
      source: 'linuxdo'
    }).rows.flatMap((row) => ('html' in row ? [row.html] : []));

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
      (candidate) => candidate.type === 'richText'
    );
    expect(row?.type).toBe('richText');
    if (!row || row.type !== 'richText') throw new Error('Expected a rendered HTML row.');

    expect(createImagePreviewCatalog([rawHtml], 360, 2).items.map((item) => item.originalUri)).toEqual(urls);
    expect(resolveForumContentRowHtml(row, { [urls[0]]: true })).toContain(`<${INLINE_FORUM_IMAGE_TAG}`);
    expect(createImagePreviewCatalog([rawHtml], 360, 2).items.map((item) => item.originalUri)).toEqual(urls);
  });

  it('[REG-TOPIC-096] publishes a complete 2000-image preview catalog from the compiler output', () => {
    const urls = Array.from({ length: 2_000 }, (_, index) => `https://img.example/${index}.webp`);
    const compilation = compileForumContent({
      html: [
        '<img class="emoji" width="20" height="20" src="https://img.example/emoji.webp">',
        `<a class="lightbox" href="https://img.example/original.webp"><img src="${urls[0]}" srcset="https://img.example/0-640.webp 640w, https://img.example/0-1280.webp 1280w" data-src="https://img.example/0-lazy.webp" data-original="https://img.example/0-data-original.webp" width="640" height="360" referrerpolicy="no-referrer"></a>`,
        ...urls.slice(1).map((url) => `<img src="${url}">`)
      ].join(''),
      role: 'opening',
      source: 'nodeseek'
    });
    const catalog = createImagePreviewCatalogFromDescriptors(compilation.previewImages, 360, 2);
    const preview = imagePreviewListFromCatalog(catalog, urls[1_380], 'nodeseek');
    const duplicateCatalog = createImagePreviewCatalogFromDescriptors(
      [...compilation.previewImages, compilation.previewImages[0]!],
      360,
      2
    );

    expect(catalog.items).toHaveLength(2_000);
    expect(catalog.items.map((item) => item.originalUri)).toEqual([
      'https://img.example/original.webp',
      ...urls.slice(1)
    ]);
    expect(duplicateCatalog.items).toHaveLength(2_000);
    expect(catalog.items[0]).toEqual({
      displaySize: { height: 360, width: 640 },
      displayUri: 'https://img.example/0-1280.webp',
      originalUri: 'https://img.example/original.webp',
      referrerPolicy: 'no-referrer'
    });
    expect(
      imagePreviewListFromCatalog(catalog, 'https://img.example/0-lazy.webp', 'nodeseek', undefined, 'no-referrer')
        .index
    ).toBe(0);
    expect(
      imagePreviewListFromCatalog(catalog, 'https://img.example/0-640.webp', 'nodeseek', undefined, 'no-referrer').index
    ).toBe(0);
    expect(preview.index).toBe(1_380);
    expect(preview.items).toBe(catalog.items);
    expect(preview.items[preview.index]?.originalUri).toBe(urls[1_380]);
    expect(imagePreviewItemAt(preview, preview.index)?.originalUri).toBe(urls[1_380]);
  });

  it('[REG-TOPIC-096] preserves source reply body and signature order independently of list presentation', () => {
    const replies: Reply[] = [
      {
        author: 'first',
        contentHtml: '<img src="https://img.example/reply-1.webp">',
        createdAt: '2026-08-14T00:00:00.000Z',
        signatureHtml: '<img src="https://img.example/signature-1.webp">'
      },
      {
        author: 'second',
        contentHtml: '<img src="https://img.example/reply-2.webp">',
        createdAt: '2026-08-14T00:01:00.000Z'
      }
    ];

    const catalog = createImagePreviewCatalogFromDescriptors(
      imagePreviewDescriptorsForReplies(replies, 'nodeseek'),
      360,
      2
    );

    expect(catalog.items.map((item) => item.originalUri)).toEqual([
      'https://img.example/reply-1.webp',
      'https://img.example/signature-1.webp',
      'https://img.example/reply-2.webp'
    ]);
  });
});
