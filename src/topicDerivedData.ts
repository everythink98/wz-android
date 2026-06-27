import type { Reply } from './types';
import { extractImageUrlsFromHtml, markInlineSizedImageHtml } from './htmlImages';

export type InlineSizedImageUrlMap = Record<string, true>;

interface TopicImageDeriverOptions {
  extractImageUrls?: (html: string) => string[];
  markInlineSizedImageHtml?: (html: string, url: string) => string;
}

export interface TopicImageDeriver {
  imageUrlsForHtml: (html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) => string[];
  markInlineSizedImages: (html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) => string;
}

function htmlContainsImageUrl(html: string, url: string) {
  return html.includes(url) || html.includes(url.replace(/&/g, '&amp;'));
}

function inlineSizedImageUrlsForHtml(html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) {
  if (!/<img\b/i.test(html)) {
    return [];
  }
  return Object.keys(inlineSizedImageUrls).filter((url) => htmlContainsImageUrl(html, url)).sort();
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

function inlineSizedImageCacheKey(html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) {
  const urls = inlineSizedImageUrlsForHtml(html, inlineSizedImageUrls);
  return urls.length ? `${html}\n__inline__\n${urls.join('\n')}` : html;
}

export function createTopicImageDeriver(options: TopicImageDeriverOptions = {}): TopicImageDeriver {
  const extractImages = options.extractImageUrls || extractImageUrlsFromHtml;
  const markInlineImage = options.markInlineSizedImageHtml || markInlineSizedImageHtml;
  const markedHtmlCache = new Map<string, string>();
  const imageUrlsCache = new Map<string, string[]>();

  const markInlineSizedImages = (html: string, inlineSizedImageUrls: InlineSizedImageUrlMap) => {
    const cacheKey = inlineSizedImageCacheKey(html, inlineSizedImageUrls);
    const cached = markedHtmlCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const marked = inlineSizedImageUrlsForHtml(html, inlineSizedImageUrls).reduce(
      (current, url) => markInlineImage(current, url),
      html
    );
    markedHtmlCache.set(cacheKey, marked);
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
      imageUrlsCache.set(marked, urls);
      return urls;
    },
    markInlineSizedImages
  };
}

export function filterRepliesWithImages(
  replies: Reply[],
  inlineSizedImageUrls: InlineSizedImageUrlMap,
  deriver: TopicImageDeriver
) {
  return replies.filter((reply) => deriver.imageUrlsForHtml(replyHtmlWithSignature(reply), inlineSizedImageUrls).length > 0);
}
