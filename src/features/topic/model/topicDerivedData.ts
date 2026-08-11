import type { Reply } from '@/domain/forum/models';
import { extractImageUrlsFromHtml } from '@/platform/media/imagePreviewCatalog';
import { markInlineSizedImageHtml } from '@/platform/media/inlineMedia';
import { parseHtml } from '@/domain/forum/html';
import { forumImageAttributeValue } from '@/domain/forum/forumContentMedia';
import { normalizeMediaReferrerPolicy, type MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';

export type InlineSizedImageUrlMap = Record<string, true>;

interface TopicImageDeriverOptions {
  cacheLimit?: number;
  extractImageUrls?: (html: string) => string[];
  markInlineSizedImageHtml?: (html: string, url: string) => string;
  requestIdentityForImage?: (url: string, referrerPolicy?: MediaReferrerPolicy) => string;
}

export interface TopicImageDeriver {
  imageUrlsForHtml: (html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) => string[];
  isInlineSizedImage: (
    url: string,
    referrerPolicy: MediaReferrerPolicy | undefined,
    inlineSizedImageUrls: Readonly<Record<string, boolean | undefined>>
  ) => boolean;
  markInlineSizedImages: (html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) => string;
}

function htmlContainsImageUrl(html: string, url: string) {
  return html.includes(url) || html.includes(url.replace(/&/g, '&amp;'));
}

function inlineSizedImageUrlsForHtml(html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) {
  if (!/<img\b/i.test(html)) {
    return [];
  }
  return Object.keys(inlineSizedImageUrls)
    .filter((identity) => htmlContainsImageUrl(html, identity.split('\u0000', 1)[0]))
    .sort();
}

function markInlineSizedImagesByIdentity(
  html: string,
  inlineSizedImageUrls: InlineSizedImageUrlMap,
  requestIdentityForImage: NonNullable<TopicImageDeriverOptions['requestIdentityForImage']>
) {
  try {
    const root = parseHtml(html);
    let changed = false;
    root.querySelectorAll('img').forEach((image) => {
      const url = forumImageAttributeValue(image.attributes, 'src');
      const referrerPolicy = normalizeMediaReferrerPolicy(forumImageAttributeValue(image.attributes, 'referrerpolicy'));
      if (!url || !inlineSizedImageUrls[requestIdentityForImage(url, referrerPolicy)]) return;
      image.setAttribute('data-forum-inline-sized', 'true');
      changed = true;
    });
    return changed ? root.toString() : html;
  } catch {
    return html;
  }
}

export function inlineSizedImageSignatureForHtml(html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) {
  return inlineSizedImageUrlsForHtml(html, inlineSizedImageUrls).join('\n');
}

export function replyHtmlWithSignature(reply: Pick<Reply, 'contentHtml' | 'signatureHtml'>) {
  return `${reply.contentHtml}\n${reply.signatureHtml || ''}`;
}

export function inlineSizedImageSignatureForReply(
  reply: Pick<Reply, 'contentHtml' | 'signatureHtml'>,
  inlineSizedImageUrls: InlineSizedImageUrlMap
) {
  return inlineSizedImageSignatureForHtml(replyHtmlWithSignature(reply), inlineSizedImageUrls);
}

export function sameInlineSizedImagesForReply(
  previousReply: Pick<Reply, 'contentHtml' | 'signatureHtml'>,
  nextReply: Pick<Reply, 'contentHtml' | 'signatureHtml'>,
  previousUrls: InlineSizedImageUrlMap,
  nextUrls: InlineSizedImageUrlMap
) {
  return (
    previousReply === nextReply &&
    (previousUrls === nextUrls ||
      inlineSizedImageSignatureForReply(previousReply, previousUrls) ===
        inlineSizedImageSignatureForReply(nextReply, nextUrls))
  );
}

function inlineSizedImageCacheKey(html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) {
  const urls = inlineSizedImageUrlsForHtml(html, inlineSizedImageUrls);
  return urls.length ? `${html}\n__inline__\n${urls.join('\n')}` : html;
}

function rememberCacheValue<T>(cache: Map<string, T>, key: string, value: T, limit: number) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size > limit) {
    cache.delete(cache.keys().next().value!);
  }
}

export function createTopicImageDeriver(options: TopicImageDeriverOptions = {}): TopicImageDeriver {
  const extractImages = options.extractImageUrls || extractImageUrlsFromHtml;
  const markInlineImage = options.markInlineSizedImageHtml || markInlineSizedImageHtml;
  const requestIdentityForImage = options.requestIdentityForImage;
  const cacheLimit = Math.max(1, Math.floor(options.cacheLimit || 200));
  const markedHtmlCache = new Map<string, string>();
  const imageUrlsCache = new Map<string, string[]>();

  const markInlineSizedImages = (html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) => {
    const cacheKey = inlineSizedImageCacheKey(html, inlineSizedImageUrls);
    const cached = markedHtmlCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const marked = requestIdentityForImage
      ? markInlineSizedImagesByIdentity(html, inlineSizedImageUrls, requestIdentityForImage)
      : inlineSizedImageUrlsForHtml(html, inlineSizedImageUrls).reduce(
          (current, url) => markInlineImage(current, url),
          html
        );
    rememberCacheValue(markedHtmlCache, cacheKey, marked, cacheLimit);
    return marked;
  };

  return {
    imageUrlsForHtml: (html, inlineSizedImageUrls) => {
      const marked = markInlineSizedImages(html, inlineSizedImageUrls);
      const cached = imageUrlsCache.get(marked);
      if (cached) {
        return cached;
      }
      const urls = extractImages(marked);
      rememberCacheValue(imageUrlsCache, marked, urls, cacheLimit);
      return urls;
    },
    isInlineSizedImage: (url, referrerPolicy, inlineSizedImageUrls) =>
      Boolean(
        inlineSizedImageUrls[
          requestIdentityForImage ? requestIdentityForImage(url, referrerPolicy) : normalizeImageIdentityUrl(url)
        ]
      ),
    markInlineSizedImages
  };
}

function normalizeImageIdentityUrl(url: string) {
  return url.trim();
}

export function filterRepliesWithImages(
  replies: Reply[],
  inlineSizedImageUrls: InlineSizedImageUrlMap,
  deriver: TopicImageDeriver
) {
  return replies.filter(
    (reply) => deriver.imageUrlsForHtml(replyHtmlWithSignature(reply), inlineSizedImageUrls).length > 0
  );
}
