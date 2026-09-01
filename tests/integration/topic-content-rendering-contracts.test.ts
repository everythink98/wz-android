import { describe, expect, it } from 'vitest';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import type { Reply } from '@/domain/forum/models';
import {
  compileForumContent,
  prepareForumContentHtml,
  requirePreparedForumContent
} from '@/domain/forum/topicContentSplit';
import { INLINE_FORUM_IMAGE_TAG } from '@/domain/forum/forumContentMedia';
import { imagePreviewDescriptorsForReplies } from '@/features/topic/model/replyListModel';
import { prepareLinuxDoContent } from '@/sources/linuxdo/parser';
import {
  imagePreviewItemAt,
  imagePreviewListFromCatalog,
  prepareImagePreviewCatalog,
  projectImagePreviewCatalog
} from '@/platform/media/imagePreviewCatalog';

function previewCatalog(
  descriptors: Parameters<typeof prepareImagePreviewCatalog>[0],
  contentWidth: number,
  pixelRatio: number,
  mediaContext?: Parameters<typeof projectImagePreviewCatalog>[1]
) {
  return projectImagePreviewCatalog(prepareImagePreviewCatalog(descriptors, contentWidth, pixelRatio), mediaContext);
}

describe('topic content rendering contracts', () => {
  it('isolates block formulas while keeping inline formulas in text flow and copy text', () => {
    const prepared = prepareLinuxDoContent(
      '<p>before</p><div class="math">x^2 + y^2</div><p>after <span class="math">z^2</span></p>',
      [],
      { role: 'reply' }
    ).preparedContent;
    const rows = requirePreparedForumContent(prepared, prepared.contentHtml, {
      role: 'reply',
      source: 'linuxdo'
    }).rows;

    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      html: expect.stringContaining('<forum-math-block>x^2 + y^2</forum-math-block>'),
      type: 'richText'
    });
    expect(rows[2]).toMatchObject({
      html: expect.stringContaining('<p>after <forum-math-inline>z^2</forum-math-inline></p>'),
      type: 'richText'
    });
    expect(JSON.parse(rows[1]!.selectionToken)).toEqual({
      owners: [],
      prefix: [
        { kind: 'media', text: 'x^2 + y^2' },
        { kind: 'separator', text: '\n' }
      ],
      version: 1
    });
    expect(JSON.parse(rows[2]!.selectionToken).owners[0]).toMatchObject({
      tape: [{ at: 'after '.length, text: 'z^2' }],
      text: 'after '
    });
  });

  it('keeps sanitized unsafe lazy candidates out of the active preview catalog', () => {
    const compilation = compileForumContent({
      html: sanitizeContentHtml(
        '<img src="/safe.png" data-original="javascript:x.png">',
        'https://linux.do/t/example/1'
      ),
      role: 'reply',
      source: 'linuxdo'
    });

    expect(previewCatalog(compilation.previewImages, 300, 2).items).toEqual([
      {
        displayUri: 'https://linux.do/safe.png',
        originalUri: 'https://linux.do/safe.png'
      }
    ]);
  });

  it('does not reparse decoded image labels or expand their media budget', () => {
    const compilation = compileForumContent({
      html: '<p><img src="https://cdn.example.com/photo.jpg" alt="&lt;img src=x onerror=boom&gt;"></p>',
      role: 'reply',
      source: 'linuxdo'
    });
    const html = compilation.rows.flatMap((row) => ('html' in row ? [row.html] : [])).join('');

    expect(compilation.previewImages).toHaveLength(1);
    expect(compilation.rows.reduce((count, row) => count + row.networkMediaCount, 0)).toBe(1);
    expect(html).toContain('&lt;img src=x onerror=boom&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('keeps an untrusted external face-path image in the ordinary preview catalog', () => {
    const source = 'https://cdn.example.com/face/photo.jpg';
    const compilation = compileForumContent({
      html: `<p><img src="${source}" alt="photo"></p>`,
      role: 'reply',
      source: 'yaohuo'
    });

    expect(compilation.previewImages).toEqual([expect.objectContaining({ source })]);
  });

  it('keeps the preview catalog and authored image placement stable when dimensions load', () => {
    const urls = ['https://i.imgur.com/first.png', 'https://i.imgur.com/second.png'];
    const rawHtml = `<p>${urls.map((url) => `<img class="embedded_image" src="${url}">`).join('')}</p>`;
    const row = compileForumContent({ html: rawHtml, role: 'reply', source: 'v2ex' }).rows.find(
      (candidate) => candidate.type === 'richText'
    );
    expect(row?.type).toBe('richText');
    if (!row || row.type !== 'richText') throw new Error('Expected a rendered HTML row.');

    expect(
      previewCatalog(
        compileForumContent({ html: rawHtml, role: 'reply', source: 'v2ex' }).previewImages,
        360,
        2
      ).items.map((item) => item.originalUri)
    ).toEqual(urls);
    expect(row.html).toContain(`<${INLINE_FORUM_IMAGE_TAG}`);
    expect(
      previewCatalog(
        compileForumContent({ html: rawHtml, role: 'reply', source: 'v2ex' }).previewImages,
        360,
        2
      ).items.map((item) => item.originalUri)
    ).toEqual(urls);
  });

  it('publishes a complete 2000-image preview catalog from the compiler output', () => {
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
    const catalog = previewCatalog(compilation.previewImages, 360, 2);
    const preview = imagePreviewListFromCatalog(catalog, urls[1_380], 'nodeseek');
    const duplicateCatalog = previewCatalog([...compilation.previewImages, compilation.previewImages[0]!], 360, 2);

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

  it('preserves source reply body and signature order independently of list presentation', () => {
    const replies: Reply[] = [
      {
        author: 'first',
        contentHtml: '<img src="https://img.example/reply-1.webp">',
        preparedContent: prepareForumContentHtml('<img src="https://img.example/reply-1.webp">', {
          role: 'reply',
          source: 'nodeseek'
        }),
        createdAt: '2026-08-14T00:00:00.000Z',
        signatureHtml: '<img src="https://img.example/signature-1.webp">',
        preparedSignature: prepareForumContentHtml('<img src="https://img.example/signature-1.webp">', {
          role: 'signature',
          source: 'nodeseek'
        })
      },
      {
        author: 'second',
        contentHtml: '<img src="https://img.example/reply-2.webp">',
        preparedContent: prepareForumContentHtml('<img src="https://img.example/reply-2.webp">', {
          role: 'reply',
          source: 'nodeseek'
        }),
        createdAt: '2026-08-14T00:01:00.000Z'
      }
    ];

    const catalog = previewCatalog(imagePreviewDescriptorsForReplies(replies, 'nodeseek'), 360, 2);

    expect(catalog.items.map((item) => item.originalUri)).toEqual([
      'https://img.example/reply-1.webp',
      'https://img.example/signature-1.webp',
      'https://img.example/reply-2.webp'
    ]);
  });
});
