import { isAllowedDataImageUrl } from '@/domain/forum/html';
import {
  DISPLAY_CANDIDATE_KIND_ATTR,
  forumImageAttributeValue as attributeValue,
  isInlineForumImageUrl,
  ORIGINAL_IMAGE_SOURCE_ATTR,
  parseSrcsetCandidates,
  parseForumImageDimension as parseImageDimension,
  type ForumImagePreviewDescriptor
} from '@/domain/forum/forumContentMedia';
import { linkDiagnosticRefs } from '@/platform/diagnostics/diagnosticPolicy';
import type { ForumMediaRequestContext } from './mediaRequestContext';
import {
  createImageRequestReferrerResolver,
  imageRequestHeadersForUrl,
  isHttpOrHttpsUrl,
  normalizeImagePreviewUrl
} from './imageRequestSource';
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
  itemOverride?: ImagePreviewItem;
  itemOverrideIndex?: number;
  referrer?: MediaReferrerContext;
}

export interface ImagePreviewCatalog {
  items: ImagePreviewItem[];
  itemIndexBySourceUrl: Record<string, number>;
  mediaContext?: ForumMediaRequestContext;
}

type ImagePreviewEntry = {
  item: ImagePreviewItem;
  sourceUrls: string[];
};

export interface PreparedImagePreviewCatalog {
  readonly entries: readonly {
    readonly descriptor: ForumImagePreviewDescriptor;
    readonly entry: ImagePreviewEntry | null;
  }[];
}

const MAX_BODY_IMAGE_PIXEL_WIDTH = 2048;

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

export function prepareImagePreviewCatalog(
  descriptors: readonly ForumImagePreviewDescriptor[],
  contentWidth: number,
  pixelRatio: number
): PreparedImagePreviewCatalog {
  return {
    entries: descriptors.map((descriptor) => ({
      descriptor,
      entry: imagePreviewEntryFromDescriptor(descriptor, contentWidth, pixelRatio)
    }))
  };
}

export function projectImagePreviewCatalog(
  prepared: PreparedImagePreviewCatalog,
  mediaContext?: ForumMediaRequestContext,
  isInlineSizedImage?: (url: string, referrerPolicy?: MediaReferrerPolicy) => boolean
): ImagePreviewCatalog {
  return createImagePreviewCatalogFromEntries(
    prepared.entries.flatMap(({ descriptor, entry }) =>
      entry && !isInlineSizedImage?.(descriptor.source, descriptor.referrerPolicy)
        ? [{ ...entry, item: { ...entry.item } }]
        : []
    ),
    mediaContext
  );
}

function imagePreviewEntryFromDescriptor(
  descriptor: ForumImagePreviewDescriptor,
  contentWidth: number,
  pixelRatio: number
): ImagePreviewEntry | null {
  const sourceSet = String(descriptor.sourceSet || '');
  const sourceSetCandidates = parseSrcsetCandidates(sourceSet);
  const displaySize = imageDisplaySizeFromDescriptor(descriptor);
  const displayUri = firstPreparedPreviewImageSource([
    selectResponsiveSrcsetImageUrlFromCandidates(sourceSetCandidates, contentWidth, pixelRatio),
    descriptor.source,
    descriptor.dataSource,
    descriptor.dataOriginal,
    descriptor.originalSource,
    descriptor.lightboxOriginal
  ]);
  const originalUri = firstPreparedPreviewImageSource([
    descriptor.lightboxOriginal,
    descriptor.dataOriginal,
    bestSrcsetImageUrlFromCandidates(sourceSetCandidates),
    descriptor.dataSource,
    displayUri,
    descriptor.source,
    descriptor.originalSource
  ]);
  if (!originalUri) return null;
  const sourceUrls = uniqueStrings(
    [
      descriptor.lightboxOriginal,
      ...srcsetImageUrlsFromCandidates(sourceSetCandidates),
      descriptor.dataOriginal,
      descriptor.dataSource,
      descriptor.source
    ]
      .map((url) => normalizeImagePreviewUrl(url || ''))
      .filter(isPreparedPreviewImageSource)
  );
  return {
    item: {
      displayUri: displayUri || originalUri,
      originalUri,
      ...(displaySize ? { displaySize } : {}),
      ...(descriptor.referrerPolicy ? { referrerPolicy: descriptor.referrerPolicy } : {})
    },
    sourceUrls
  };
}

function createImagePreviewCatalogFromEntries(
  entries: readonly ImagePreviewEntry[],
  mediaContext?: ForumMediaRequestContext
): ImagePreviewCatalog {
  const itemIndexBySourceUrl: Record<string, number> = {};
  const items: ImagePreviewItem[] = [];
  const itemIndexByOriginalUri = new Map<string, number>();
  const requestIdentityCache = new Map<string, string>();
  const referrerForUrl = mediaContext?.referrer ? createImageRequestReferrerResolver(mediaContext) : undefined;
  const requestIdentity = (url: string, referrerPolicy?: MediaReferrerPolicy) => {
    const key = `${url}\u0000${referrerPolicy || ''}`;
    const cached = requestIdentityCache.get(key);
    if (cached) return cached;
    const identity = previewRequestIdentity(url, referrerPolicy, mediaContext, referrerForUrl);
    requestIdentityCache.set(key, identity);
    return identity;
  };
  entries.forEach((entry) => {
    const originalUri = normalizeImagePreviewUrl(entry.item.originalUri);
    const aliases = uniqueStrings(
      [entry.item.displayUri, originalUri, ...entry.sourceUrls].map(normalizeImagePreviewUrl).filter(Boolean)
    );
    linkDiagnosticRefs('media', aliases);
    const originalIdentity = requestIdentity(originalUri, entry.item.referrerPolicy);
    let itemIndex = itemIndexByOriginalUri.get(originalIdentity);
    if (itemIndex === undefined) {
      itemIndex = items.length;
      itemIndexByOriginalUri.set(originalIdentity, itemIndex);
      items.push(entry.item);
    }
    aliases.forEach((url) => {
      itemIndexBySourceUrl[requestIdentity(url, entry.item.referrerPolicy)] = itemIndex;
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
  let items = catalog.items;
  let index = mappedIndex;
  let itemOverride: ImagePreviewItem | undefined;
  if (index !== undefined && tappedUri && items[index]) {
    itemOverride = imagePreviewItemOverride(items[index], tappedUri, displaySize, referrerPolicy);
  }
  if (index === undefined && tappedUri) {
    index = items.findIndex((item) => item.originalUri === tappedUri && item.referrerPolicy === referrerPolicy);
    if (index < 0) {
      index = items.length;
      items = [
        ...items,
        {
          displayUri: tappedUri,
          originalUri: tappedUri,
          ...(displaySize ? { displaySize } : {}),
          ...(referrerPolicy ? { referrerPolicy } : {})
        }
      ];
    } else {
      itemOverride = imagePreviewItemOverride(items[index], tappedUri, displaySize, referrerPolicy);
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
    ...(itemOverride ? { itemOverride, itemOverrideIndex: index } : {}),
    ...(catalog.mediaContext?.referrer ? { referrer: catalog.mediaContext.referrer } : {})
  };
}

export function imagePreviewItemAt(preview: ImagePreviewList, index: number) {
  return preview.itemOverrideIndex === index && preview.itemOverride ? preview.itemOverride : preview.items[index];
}

function imagePreviewItemOverride(
  item: ImagePreviewItem,
  displayUri: string,
  displaySize?: ImageDisplaySize,
  referrerPolicy?: MediaReferrerPolicy
) {
  const changesDisplaySize = Boolean(
    displaySize && (displaySize.width !== item.displaySize?.width || displaySize.height !== item.displaySize?.height)
  );
  if (
    displayUri === item.displayUri &&
    !changesDisplaySize &&
    (!referrerPolicy || referrerPolicy === item.referrerPolicy)
  ) {
    return undefined;
  }
  return {
    ...item,
    displayUri,
    ...(displaySize ? { displaySize } : {}),
    ...(referrerPolicy ? { referrerPolicy } : {})
  };
}

function previewRequestIdentity(
  url: string,
  referrerPolicy?: MediaReferrerPolicy,
  mediaContext?: ForumMediaRequestContext,
  referrerForUrl?: (url: string, referrerPolicy?: MediaReferrerPolicy) => string | undefined
) {
  if (!mediaContext?.referrer) return url;
  const referrer =
    (referrerForUrl
      ? referrerForUrl(url, referrerPolicy)
      : imageRequestHeadersForUrl(url, { mediaContext, referrerPolicy })?.Referer) || 'none';
  return `${url}\u0000referrer:${referrer}`;
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

function imageDisplaySizeFromDescriptor(descriptor: ForumImagePreviewDescriptor): ImageDisplaySize | undefined {
  const width = parseImageDimension(descriptor.width || '');
  const height = parseImageDimension(descriptor.height || '');
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function isPreparedPreviewImageSource(url: string) {
  const clean = normalizeImagePreviewUrl(url);
  return !isKnownPlaceholderImageUrl(clean) && (/^https?:\/\//i.test(clean) || isAllowedDataImageUrl(clean));
}

function firstPreparedPreviewImageSource(urls: readonly (string | undefined)[]) {
  return urls.map((url) => normalizeImagePreviewUrl(url || '')).find(isPreparedPreviewImageSource) || '';
}

function isKnownPlaceholderImageUrl(url: string) {
  const clean = normalizeImagePreviewUrl(url);
  if (
    /^data:image\/gif;base64,R0lGODlhAQABA/i.test(clean) ||
    /^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/i.test(clean)
  ) {
    return true;
  }
  const basename = clean.split(/[?#]/)[0].split('/').pop() || '';
  return /^(?:blank|spacer|transparent)(?:[-_.@].*)?\.(?:gif|png|webp)$/i.test(basename);
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

function srcsetImageUrlsFromCandidates(candidates: readonly string[]) {
  return candidates
    .map((candidate) => (candidate.trim().split(/\s+/)[0] || '').trim())
    .filter(isAllowedPreviewImageSource);
}

type ResponsiveSrcsetCandidate = {
  uri: string;
  kind: 'w' | 'x';
  value: number;
};

function selectResponsiveSrcsetImageUrl(srcset: string, contentWidth: number, pixelRatio: number) {
  return selectResponsiveSrcsetImageUrlFromCandidates(parseSrcsetCandidates(srcset), contentWidth, pixelRatio);
}

function selectResponsiveSrcsetImageUrlFromCandidates(
  rawCandidates: readonly string[],
  contentWidth: number,
  pixelRatio: number
) {
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
  return bestSrcsetImageUrlFromCandidates(parseSrcsetCandidates(srcset));
}

function bestSrcsetImageUrlFromCandidates(candidates: readonly string[]) {
  let bestUrl = '';
  let bestScore = -1;
  candidates.forEach((candidate, index) => {
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
