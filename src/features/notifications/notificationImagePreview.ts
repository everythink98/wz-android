import { parseHtml } from '@/domain/forum/html';
import {
  isForumStickerImage,
  isInlineForumImage,
  ORIGINAL_IMAGE_SOURCE_ATTR,
  selectImageOriginalSource,
  type ForumImagePreviewDescriptor
} from '@/domain/forum/forumContentMedia';
import { normalizeMediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import type { NotificationDetail } from '@/domain/notifications/models';

function resolveImageUrl(value: string | undefined, baseUrl: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

export function notificationImageOriginalSource(
  attributes: Record<string, string>,
  lightboxHref: string | undefined,
  baseUrl: string | undefined
) {
  return selectImageOriginalSource(
    {
      ...attributes,
      [ORIGINAL_IMAGE_SOURCE_ATTR]: resolveImageUrl(attributes[ORIGINAL_IMAGE_SOURCE_ATTR], baseUrl),
      'data-original': resolveImageUrl(attributes['data-original'], baseUrl),
      'data-src': resolveImageUrl(attributes['data-src'], baseUrl),
      src: resolveImageUrl(attributes.src, baseUrl)
    },
    resolveImageUrl(lightboxHref, baseUrl)
  );
}

export function notificationImagePreviewDescriptors(detail: NotificationDetail | undefined, baseUrl: string) {
  const descriptors: ForumImagePreviewDescriptor[] = [];
  for (const html of [detail?.contentHtml, ...(detail?.messages?.map((message) => message.contentHtml) || [])]) {
    if (!html) continue;
    for (const image of parseHtml(html).querySelectorAll('img, forum-sticker')) {
      const attributes = image.attributes;
      if (image.rawTagName !== 'forum-sticker' && !isForumStickerImage(attributes) && isInlineForumImage(attributes))
        continue;
      descriptors.push({
        source: resolveImageUrl(attributes.src, baseUrl) || '',
        sourceSet: attributes.srcset,
        dataSource: resolveImageUrl(attributes['data-src'], baseUrl),
        dataOriginal: resolveImageUrl(attributes['data-original'], baseUrl),
        originalSource: resolveImageUrl(attributes[ORIGINAL_IMAGE_SOURCE_ATTR], baseUrl),
        lightboxOriginal: resolveImageUrl(image.closest('a.lightbox')?.getAttribute('href'), baseUrl),
        width: attributes.width,
        height: attributes.height,
        referrerPolicy: normalizeMediaReferrerPolicy(attributes.referrerpolicy)
      });
    }
  }
  return descriptors;
}
