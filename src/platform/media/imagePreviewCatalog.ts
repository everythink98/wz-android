import { isAllowedDataImageUrl, parseHtml } from '@/domain/forum/html';
import {
  DISPLAY_CANDIDATE_KIND_ATTR,
  forumImageAttributesFromText as imageAttributesFromText,
  forumImageAttributeValue as attributeValue,
  forumImageTagName as safeTagName,
  isInlineForumImage as isInlineForumImageAttributes,
  isInlineForumImageUrl,
  ORIGINAL_IMAGE_SOURCE_ATTR,
  parseForumImageDimension as parseImageDimension,
  type ParsedForumImageNode
} from '@/domain/forum/forumContentMedia';
import { linkDiagnosticRefs } from '@/platform/diagnostics/diagnosticPolicy';
import type { ForumMediaRequestContext } from './mediaRequestContext';
import { imageRequestHeadersForUrl, isHttpOrHttpsUrl, normalizeImagePreviewUrl } from './imageRequestSource';
import {
  normalizeMediaReferrerPolicy,
  type MediaReferrerContext,
  type MediaReferrerPolicy
} from '@/domain/forum/mediaReferrer';

export type ImageDisplayCandidateKind = 'src' | 'srcset' | 'data-src' | 'data-original';

export interface ImageDisplaySize {
  width: number;
  height: number;
}

export interface ImagePreviewItem {
  displayUri: string;
  originalUri: string;
  displaySize?: ImageDisplaySize;
  referrerPolicy?: MediaReferrerPolicy;
}

export interface ImagePreviewList {
  contentSource: ForumMediaRequestContext['contentSource'];
  items: ImagePreviewItem[];
  index: number;
  referrer?: MediaReferrerContext;
}

export interface ImagePreviewCatalog {
  items: ImagePreviewItem[];
  itemIndexBySourceUrl: Record<string, number>;
  mediaContext?: ForumMediaRequestContext;
}

const MAX_BODY_IMAGE_PIXEL_WIDTH = 2048;

export function extractImageUrlsFromHtml(html: string): string[] {
  return extractImagePreviewEntriesFromHtml(html).map((entry) => entry.item.originalUri);
}

function extractImagePreviewEntriesFromHtml(html: string, contentWidth = 0, pixelRatio = 1): ImagePreviewEntry[] {
  try {
    const root = parseHtml(html);
    return root
      .querySelectorAll('img')
      .filter((image) => !isInlineForumImageAttributes(image.attributes))
      .map((image) => imagePreviewEntryFromImage(image, contentWidth, pixelRatio))
      .filter((entry): entry is ImagePreviewEntry => Boolean(entry));
  } catch {
    const entries: ImagePreviewEntry[] = [];
    const imagePattern = /<img\b([^>]*)>/gi;
    let match = imagePattern.exec(html);
    while (match) {
      const attributes = imageAttributesFromText(match[1] || '');
      const entry = !isInlineForumImageAttributes(attributes)
        ? imagePreviewEntryFromAttributes(attributes, '', contentWidth, pixelRatio)
        : null;
      if (entry) {
        entries.push(entry);
      }
      match = imagePattern.exec(html);
    }
    return entries;
  }
}

export function isPreviewableImageUrl(url: unknown): boolean {
  const clean = typeof url === 'string' ? url.trim() : '';
  if (!clean) {
    return false;
  }
  if (isInlineForumImageUrl(clean)) {
    return false;
  }
  if (/^data:image\//i.test(clean)) {
    return isAllowedDataImageUrl(clean);
  }
  if (/[/?&]api\/image-proxy(?:[/?#&=]|$)/i.test(clean) || /\/api\/image-proxy(?:[?#/]|$)/i.test(clean)) {
    return true;
  }
  return /\.(?:apng|avif|bmp|gif|heic|heif|jpe?g|png|webp)(?:[?#].*)?$/i.test(clean);
}

export function createImagePreviewCatalog(
  htmlParts: string[],
  contentWidth: number,
  pixelRatio: number,
  mediaContext?: ForumMediaRequestContext
): ImagePreviewCatalog {
  const itemIndexBySourceUrl: Record<string, number> = {};
  const entries = htmlParts.flatMap((html) => extractImagePreviewEntriesFromHtml(html, contentWidth, pixelRatio));
  const items: ImagePreviewItem[] = [];
  const itemIndexByOriginalUri = new Map<string, number>();
  entries.forEach((entry) => {
    const originalUri = normalizeImagePreviewUrl(entry.item.originalUri);
    const aliases = [entry.item.displayUri, originalUri, ...entry.sourceUrls]
      .map(normalizeImagePreviewUrl)
      .filter(Boolean);
    linkDiagnosticRefs('media', aliases);
    const originalIdentity = previewRequestIdentity(originalUri, entry.item.referrerPolicy, mediaContext);
    let itemIndex = itemIndexByOriginalUri.get(originalIdentity);
    if (itemIndex === undefined) {
      itemIndex = items.length;
      itemIndexByOriginalUri.set(originalIdentity, itemIndex);
      items.push(entry.item);
    }
    aliases.forEach((url) => {
      itemIndexBySourceUrl[previewRequestIdentity(url, entry.item.referrerPolicy, mediaContext)] = itemIndex;
    });
  });
  return { items, itemIndexBySourceUrl, ...(mediaContext ? { mediaContext } : {}) };
}

export function imagePreviewListFromCatalog(
  catalog: ImagePreviewCatalog,
  tappedUrl: string,
  contentSource: ForumMediaRequestContext['contentSource'],
  tappedDisplaySize?: ImageDisplaySize,
  tappedReferrerPolicy?: MediaReferrerPolicy
): ImagePreviewList {
  const tapped = normalizeImagePreviewUrl(tappedUrl);
  const referrerPolicy = normalizeMediaReferrerPolicy(tappedReferrerPolicy);
  const tappedIdentity = previewRequestIdentity(tapped, referrerPolicy, catalog.mediaContext);
  const mappedIndex = Object.prototype.hasOwnProperty.call(catalog.itemIndexBySourceUrl, tappedIdentity)
    ? catalog.itemIndexBySourceUrl[tappedIdentity]
    : undefined;
  const tappedUri = isAllowedActiveImageSource(tapped) && !isInlineForumImageUrl(tapped) ? tapped : '';
  const displaySize =
    tappedDisplaySize &&
    Number.isFinite(tappedDisplaySize.width) &&
    Number.isFinite(tappedDisplaySize.height) &&
    tappedDisplaySize.width > 0 &&
    tappedDisplaySize.height > 0
      ? tappedDisplaySize
      : undefined;
  const items = [...catalog.items];
  let index = mappedIndex;
  if (index !== undefined && tappedUri && items[index]) {
    items[index] = {
      ...items[index],
      displayUri: tappedUri,
      ...(displaySize ? { displaySize } : {}),
      ...(referrerPolicy ? { referrerPolicy } : {})
    };
  }
  if (index === undefined && tappedUri) {
    index = items.findIndex((item) => item.originalUri === tappedUri && item.referrerPolicy === referrerPolicy);
    if (index < 0) {
      index = items.length;
      items.push({
        displayUri: tappedUri,
        originalUri: tappedUri,
        ...(displaySize ? { displaySize } : {}),
        ...(referrerPolicy ? { referrerPolicy } : {})
      });
    }
  }
  if (index === undefined || index < 0) {
    return {
      contentSource,
      items: [],
      index: 0,
      ...(catalog.mediaContext?.referrer ? { referrer: catalog.mediaContext.referrer } : {})
    };
  }
  return {
    contentSource,
    items,
    index,
    ...(catalog.mediaContext?.referrer ? { referrer: catalog.mediaContext.referrer } : {})
  };
}

function previewRequestIdentity(
  url: string,
  referrerPolicy?: MediaReferrerPolicy,
  mediaContext?: ForumMediaRequestContext
) {
  if (!mediaContext?.referrer) return url;
  const referrer = imageRequestHeadersForUrl(url, { mediaContext, referrerPolicy })?.Referer || 'none';
  return `${url}\u0000referrer:${referrer}`;
}

type ImagePreviewEntry = {
  item: ImagePreviewItem;
  sourceUrls: string[];
};

export function imagePreviewEntryFromImage(
  image: ParsedForumImageNode,
  contentWidth = 0,
  pixelRatio = 1
): ImagePreviewEntry | null {
  return imagePreviewEntryFromAttributes(image.attributes, lightboxHrefForImage(image), contentWidth, pixelRatio);
}

function imagePreviewEntryFromAttributes(
  attributes: Record<string, string | undefined>,
  linkedUrl = '',
  contentWidth = 0,
  pixelRatio = 1
): ImagePreviewEntry | null {
  const displaySource = selectImageDisplaySource(attributes, contentWidth, pixelRatio);
  const referrerPolicy = normalizeMediaReferrerPolicy(attributeValue(attributes, 'referrerpolicy'));
  const sourceUrls = uniqueStrings(
    [
      linkedUrl,
      ...srcsetImageUrls(attributeValue(attributes, 'srcset')),
      attributeValue(attributes, 'data-original'),
      attributeValue(attributes, 'data-src'),
      attributeValue(attributes, 'src')
    ].filter((url) => isAllowedPreviewImageSource(url) && !isKnownPlaceholderImageUrl(normalizeImagePreviewUrl(url)))
  );
  const originalUri = firstAllowedPreviewImageSource([
    linkedUrl,
    attributeValue(attributes, 'data-original'),
    bestSrcsetImageUrl(attributeValue(attributes, 'srcset')),
    attributeValue(attributes, 'data-src'),
    displaySource?.uri || '',
    attributeValue(attributes, 'src')
  ]);
  if (!originalUri) {
    return null;
  }
  return {
    item: {
      displayUri: displaySource?.uri || originalUri,
      originalUri,
      ...(displaySource?.displaySize ? { displaySize: displaySource.displaySize } : {}),
      ...(referrerPolicy ? { referrerPolicy } : {})
    },
    sourceUrls
  };
}

export function selectImageDisplaySource(
  attributes: Record<string, string | undefined>,
  contentWidth: number,
  pixelRatio: number
): { uri: string; candidateKind: ImageDisplayCandidateKind; displaySize?: ImageDisplaySize } | null {
  const displaySize = imageDisplaySizeFromAttributes(attributes);
  const srcsetUri = selectResponsiveSrcsetImageUrl(attributeValue(attributes, 'srcset'), contentWidth, pixelRatio);
  if (srcsetUri) {
    return { uri: srcsetUri, candidateKind: 'srcset', ...(displaySize ? { displaySize } : {}) };
  }
  return fallbackBodyImageSource(attributes);
}

export function selectImageOriginalSource(attributes: Record<string, string | undefined>) {
  return firstAllowedPreviewImageSource([
    attributeValue(attributes, ORIGINAL_IMAGE_SOURCE_ATTR),
    attributeValue(attributes, 'data-original'),
    bestSrcsetImageUrl(attributeValue(attributes, 'srcset')),
    attributeValue(attributes, 'data-src'),
    attributeValue(attributes, 'src')
  ]);
}

export function fallbackBodyImageSource(
  attributes: Record<string, string | undefined>
): { uri: string; candidateKind: Exclude<ImageDisplayCandidateKind, 'srcset'>; displaySize?: ImageDisplaySize } | null {
  const displaySize = imageDisplaySizeFromAttributes(attributes);
  const src = normalizeImagePreviewUrl(attributeValue(attributes, 'src'));
  if (isAllowedActiveImageSource(src) && !isKnownPlaceholderImageUrl(src)) {
    const preservedKind = (['data-src', 'data-original'] as const).find(
      (candidateKind) =>
        attributeValue(attributes, DISPLAY_CANDIDATE_KIND_ATTR) === candidateKind &&
        normalizeImagePreviewUrl(attributeValue(attributes, candidateKind)) === src
    );
    return { uri: src, candidateKind: preservedKind || 'src', ...(displaySize ? { displaySize } : {}) };
  }
  for (const candidateKind of ['data-src', 'data-original'] as const) {
    const uri = normalizeImagePreviewUrl(attributeValue(attributes, candidateKind));
    if (isAllowedActiveImageSource(uri) && !isKnownPlaceholderImageUrl(uri)) {
      return { uri, candidateKind, ...(displaySize ? { displaySize } : {}) };
    }
  }
  return null;
}

function imageDisplaySizeFromAttributes(attributes: Record<string, string | undefined>): ImageDisplaySize | undefined {
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function isKnownPlaceholderImageUrl(url: string) {
  const clean = normalizeImagePreviewUrl(url);
  if (
    /^data:image\/gif;base64,R0lGODlhAQABA/i.test(clean) ||
    /^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/i.test(clean)
  ) {
    return true;
  }
  try {
    const basename = new URL(clean).pathname.split('/').pop() || '';
    return /^(?:blank|spacer|transparent)(?:[-_.@].*)?\.(?:gif|png|webp)$/i.test(basename);
  } catch {
    return false;
  }
}

function isAllowedPreviewImageSource(url: string) {
  const clean = normalizeImagePreviewUrl(url);
  return (
    Boolean(clean) &&
    (isHttpOrHttpsUrl(clean) || clean.startsWith('/') || clean.startsWith('//') || isPreviewableImageUrl(clean)) &&
    (!/^data:image\//i.test(clean) || isAllowedDataImageUrl(clean))
  );
}

function isAllowedActiveImageSource(url: string) {
  const clean = normalizeImagePreviewUrl(url);
  return isHttpOrHttpsUrl(clean) || isAllowedDataImageUrl(clean);
}

function firstAllowedPreviewImageSource(urls: string[]) {
  return (
    urls
      .map((url) => normalizeImagePreviewUrl(url))
      .find((url) => isAllowedActiveImageSource(url) && !isKnownPlaceholderImageUrl(url)) || ''
  );
}

function splitSrcsetCandidates(srcset: string) {
  const candidates: string[] = [];
  let current = '';
  let dataUrlCommaSeen = false;
  for (const char of String(srcset || '')) {
    if (char === ',') {
      if (current.trim().toLowerCase().startsWith('data:') && !dataUrlCommaSeen) {
        current += char;
        dataUrlCommaSeen = true;
        continue;
      }
      candidates.push(current);
      current = '';
      dataUrlCommaSeen = false;
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    candidates.push(current);
  }
  return candidates;
}

function srcsetImageUrls(srcset: string) {
  return splitSrcsetCandidates(srcset)
    .map((candidate) => (candidate.trim().split(/\s+/)[0] || '').trim())
    .filter(isAllowedPreviewImageSource);
}

type ResponsiveSrcsetCandidate = {
  uri: string;
  kind: 'w' | 'x';
  value: number;
};

function selectResponsiveSrcsetImageUrl(srcset: string, contentWidth: number, pixelRatio: number) {
  const rawCandidates = splitSrcsetCandidates(srcset);
  if (!rawCandidates.length || !Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    return '';
  }
  const candidates: ResponsiveSrcsetCandidate[] = [];
  for (const candidate of rawCandidates) {
    const parts = candidate.trim().split(/\s+/);
    if (parts.length !== 2) {
      return '';
    }
    const uri = normalizeImagePreviewUrl(parts[0]);
    const descriptor = parts[1];
    const width = descriptor.match(/^(\d+(?:\.\d+)?)w$/i);
    const density = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
    const kind = width ? 'w' : density ? 'x' : '';
    const value = Number(width?.[1] || density?.[1] || 0);
    if (!kind || !Number.isFinite(value) || value <= 0 || !isAllowedActiveImageSource(uri)) {
      return '';
    }
    candidates.push({ uri, kind, value });
  }
  const kind = candidates[0]?.kind;
  if (!kind || candidates.some((candidate) => candidate.kind !== kind)) {
    return '';
  }
  if (kind === 'w' && (!Number.isFinite(contentWidth) || contentWidth <= 0)) {
    return '';
  }
  const target = kind === 'w' ? Math.min(contentWidth * pixelRatio, MAX_BODY_IMAGE_PIXEL_WIDTH) : pixelRatio;
  const sorted = [...candidates].sort((left, right) => left.value - right.value);
  return (sorted.find((candidate) => candidate.value >= target) || sorted[sorted.length - 1])?.uri || '';
}

function bestSrcsetImageUrl(srcset: string) {
  let bestUrl = '';
  let bestScore = -1;
  splitSrcsetCandidates(srcset).forEach((candidate, index) => {
    const parts = candidate.trim().split(/\s+/);
    const url = String(parts.shift() || '').trim();
    if (!isAllowedPreviewImageSource(url)) {
      return;
    }
    const descriptor = parts[0] || '';
    const width = descriptor.match(/^(\d+(?:\.\d+)?)w$/i);
    const density = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
    const score = width ? Number(width[1]) : density ? Number(density[1]) * 100 : index;
    if (score >= bestScore) {
      bestUrl = url;
      bestScore = score;
    }
  });
  return bestUrl;
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (item && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function lightboxHrefForImage(image: { parentNode?: unknown; parent?: unknown }) {
  let current = image.parentNode || image.parent;
  while (current && typeof current === 'object') {
    const element = current as {
      tagName?: string;
      rawTagName?: string | null;
      classNames?: string;
      attributes?: Record<string, string | undefined>;
      parentNode?: unknown;
      parent?: unknown;
    };
    const tagName = safeTagName(element);
    const className = String(element.classNames || element.attributes?.class || '');
    if (tagName === 'a' && /(^|\s)lightbox(\s|$)/i.test(className)) {
      return attributeValue(element.attributes || {}, 'href');
    }
    if (/(^|\s)lightbox-wrapper(\s|$)/i.test(className)) {
      return '';
    }
    current = element.parentNode || element.parent;
  }
  return '';
}
