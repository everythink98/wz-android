import { parseHtml } from '@/domain/forum/html';
import {
  isForumStickerImage,
  isInlineForumImage,
  ORIGINAL_IMAGE_SOURCE_ATTR,
  type ForumImagePreviewDescriptor
} from '@/domain/forum/forumContentMedia';
import { normalizeMediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import type { NotificationDetail } from '@/domain/notifications/models';

export function notificationImagePreviewDescriptors(detail: NotificationDetail | undefined, baseUrl: string) {
  const descriptors: ForumImagePreviewDescriptor[] = [];
  const resolve = (value: string | undefined) => {
    if (!value) return undefined;
    try {
      return new URL(value, baseUrl).href;
    } catch {
      return value;
    }
  };
  for (const html of [detail?.contentHtml, ...(detail?.messages?.map((message) => message.contentHtml) || [])]) {
    if (!html) continue;
    for (const image of parseHtml(html).querySelectorAll('img, forum-sticker')) {
      const attributes = image.attributes;
      if (image.rawTagName !== 'forum-sticker' && !isForumStickerImage(attributes) && isInlineForumImage(attributes))
        continue;
      descriptors.push({
        source: resolve(attributes.src) || '',
        sourceSet: attributes.srcset,
        dataSource: resolve(attributes['data-src']),
        dataOriginal: resolve(attributes['data-original']),
        originalSource: resolve(attributes[ORIGINAL_IMAGE_SOURCE_ATTR]),
        lightboxOriginal: resolve(image.closest('a.lightbox')?.getAttribute('href')),
        width: attributes.width,
        height: attributes.height,
        referrerPolicy: normalizeMediaReferrerPolicy(attributes.referrerpolicy)
      });
    }
  }
  return descriptors;
}
