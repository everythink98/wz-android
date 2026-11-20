import { isAllowedDataImageUrl } from '@/domain/forum/html';
import {
  fallbackForumBodyImageSource,
  selectImageOriginalSource,
  forumImageAttributeValue as attributeValue,
  isInlineForumImageUrl,
  parseSrcsetCandidates,
  bestSrcsetImageUrlFromCandidates,
  parseForumImageDimension as parseImageDimension,
  type ForumImagePreviewDescriptor
} from '@/domain/forum/forumContentMedia';
import { linkDiagnosticRefs } from '@/platform/diagnostics/diagnosticPolicy';
import type { ForumMediaRequestContext } from './mediaRequestContext';
import { createImageRequestReferrerResolver, isHttpOrHttpsUrl, normalizeImagePreviewUrl } from './imageRequestSource';
import {
  normalizeMediaReferrerPolicy,
  type MediaReferrerContext,
  type MediaReferrerPolicy
} from '@/domain/forum/mediaReferrer';

type ImageDisplayCandidateKind = 'src' | 'srcset' | 'data-src' | 'data-original';

export interface ImageDisplaySize {
  width: number;
  height: number;
}

export type OpenImagePreview = (
  url: string,
  displaySize?: ImageDisplaySize,
  renderedPosterUri?: string,
  referrerPolicy?: MediaReferrerPolicy,
  originalUri?: string
) => void;

export interface ImagePreviewItem {
  alt?: string;
  readingOrigin?: { topicId: string; floor: number };
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
  indexForUrl: (url: string, referrerPolicy?: MediaReferrerPolicy, originalUri?: string) => number | undefined;
  referrer?: MediaReferrerContext;
}

type ImagePreviewEntry = {
  item: ImagePreviewItem;
  aliases: string[];
};

export interface PreparedImagePreviewCatalog {
  readonly contentWidth: number;
  readonly pixelRatio: number;
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

export function pictureLinkOpensPreview(href: string, image: Record<string, string>, lightbox: boolean) {
  if (!isAllowedActiveImageSource(href)) return false;
  if (
    lightbox ||
    isPreviewableImageUrl(href) ||
    href === image.src ||
    href === image['data-src'] ||
    href === selectImageOriginalSource(image)
  )
    return true;
  return srcsetImageUrlsFromCandidates(parseSrcsetCandidates(image.srcset || '')).includes(href);
}

export function prepareImagePreviewCatalog(
  descriptors: readonly ForumImagePreviewDescriptor[],
  contentWidth: number,
  pixelRatio: number,
  previous?: PreparedImagePreviewCatalog
): PreparedImagePreviewCatalog {
  const retained =
    previous?.contentWidth === contentWidth && previous.pixelRatio === pixelRatio
      ? new Map(previous.entries.map((entry) => [entry.descriptor, entry]))
      : undefined;
  return {
    contentWidth,
    pixelRatio,
    entries: descriptors.map(
      (descriptor) =>
        retained?.get(descriptor) || {
          descriptor,
          entry: imagePreviewEntryFromDescriptor(descriptor, contentWidth, pixelRatio)
        }
    )
  };
}

function imagePreviewEntryFromDescriptor(
  descriptor: ForumImagePreviewDescriptor,
  contentWidth: number,
  pixelRatio: number
): ImagePreviewEntry | null {
  const sourceSet = String(descriptor.sourceSet || '');
  const sourceSetCandidates = parseSrcsetCandidates(sourceSet);
  const displaySize = imageDisplaySize(descriptor.width, descriptor.height);
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
    descriptor.originalSource,
    descriptor.dataOriginal,
    bestSrcsetImageUrlFromCandidates(sourceSetCandidates, isAllowedPreviewImageSource),
    descriptor.dataSource,
    displayUri,
    descriptor.source
  ]);
  if (!originalUri) return null;
  const aliases = [
    displayUri || originalUri,
    originalUri,
    descriptor.lightboxOriginal,
    descriptor.originalSource,
    ...srcsetImageUrlsFromCandidates(sourceSetCandidates),
    descriptor.dataOriginal,
    descriptor.dataSource,
    descriptor.source
  ];
  return {
    item: {
      displayUri: displayUri || originalUri,
      originalUri,
      ...(descriptor.alt ? { alt: descriptor.alt } : {}),
      ...(descriptor.readingOrigin ? { readingOrigin: descriptor.readingOrigin } : {}),
      ...(displaySize ? { displaySize } : {}),
      ...(descriptor.referrerPolicy ? { referrerPolicy: descriptor.referrerPolicy } : {})
    },
    aliases: [
      ...new Set(aliases.map((url) => normalizeImagePreviewUrl(url || '')).filter(isPreparedPreviewImageSource))
    ]
  };
}

export function projectImagePreviewCatalog(
  prepared: PreparedImagePreviewCatalog,
  mediaContext?: ForumMediaRequestContext
): ImagePreviewCatalog {
  const itemIndexBySourceUrl = new Map<string, number>();
  const items: ImagePreviewItem[] = [];
  const itemIndexByOriginalUri = new Map<string, number>();
  const requestIdentityCache = new Map<string, string>();
  const referrerForUrl = mediaContext?.referrer ? createImageRequestReferrerResolver(mediaContext) : undefined;
  const requestIdentity = (url: string, referrerPolicy?: MediaReferrerPolicy) =>
    referrerForUrl ? `${url}\u0000referrer:${referrerForUrl(url, referrerPolicy) || 'none'}` : url;
  const registerIdentity = (url: string, referrerPolicy?: MediaReferrerPolicy) => {
    if (!referrerForUrl) return url;
    const key = `${url}\u0000${referrerPolicy || ''}`;
    const cached = requestIdentityCache.get(key);
    if (cached) return cached;
    const identity = requestIdentity(url, referrerPolicy);
    requestIdentityCache.set(key, identity);
    return identity;
  };
  for (const { entry } of prepared.entries) {
    if (!entry) continue;
    const { aliases, item } = entry;
    linkDiagnosticRefs('media', aliases);
    const originalIdentity = registerIdentity(item.originalUri, item.referrerPolicy);
    let itemIndex = itemIndexByOriginalUri.get(originalIdentity);
    if (itemIndex === undefined) {
      itemIndex = items.length;
      itemIndexByOriginalUri.set(originalIdentity, itemIndex);
      items.push({ ...item });
    } else if (
      items[itemIndex].readingOrigin?.topicId !== item.readingOrigin?.topicId ||
      items[itemIndex].readingOrigin?.floor !== item.readingOrigin?.floor
    ) {
      // A shared image cannot identify which post the user opened it from.
      items[itemIndex] = { ...items[itemIndex], readingOrigin: undefined };
    }
    for (const url of aliases) itemIndexBySourceUrl.set(registerIdentity(url, item.referrerPolicy), itemIndex);
  }
  return {
    items,
    indexForUrl: (url, policy, originalUri) => {
      if (originalUri) return itemIndexByOriginalUri.get(requestIdentity(originalUri, policy));
      const identity = requestIdentity(url, policy);
      return itemIndexByOriginalUri.get(identity) ?? itemIndexBySourceUrl.get(identity);
    },
    ...(mediaContext?.referrer ? { referrer: mediaContext.referrer } : {})
  };
}

export function imagePreviewListFromCatalog(
  catalog: ImagePreviewCatalog,
  tappedUrl: string,
  contentSource: ForumMediaRequestContext['contentSource'],
  tappedDisplaySize?: ImageDisplaySize,
  tappedReferrerPolicy?: MediaReferrerPolicy,
  knownOriginalUri?: string
): ImagePreviewList {
  const tapped = normalizeImagePreviewUrl(tappedUrl);
  const referrerPolicy = normalizeMediaReferrerPolicy(tappedReferrerPolicy);
  const original = normalizeImagePreviewUrl(knownOriginalUri || '');
  const originalUri = isAllowedActiveImageSource(original) && !isInlineForumImageUrl(original) ? original : undefined;
  const index = catalog.indexForUrl(tapped, referrerPolicy, originalUri);
  const tappedUri = isAllowedActiveImageSource(tapped) && !isInlineForumImageUrl(tapped) ? tapped : '';
  const displaySize =
    tappedDisplaySize &&
    Number.isFinite(tappedDisplaySize.width) &&
    Number.isFinite(tappedDisplaySize.height) &&
    tappedDisplaySize.width > 0 &&
    tappedDisplaySize.height > 0
      ? tappedDisplaySize
      : undefined;
  const scope = { contentSource, ...(catalog.referrer ? { referrer: catalog.referrer } : {}) };
  if (index !== undefined) {
    const itemOverride =
      tappedUri && imagePreviewItemOverride(catalog.items[index], tappedUri, displaySize, referrerPolicy);
    return {
      ...scope,
      items: catalog.items,
      index,
      ...(itemOverride ? { itemOverride, itemOverrideIndex: index } : {})
    };
  }
  if (!tappedUri) return { ...scope, items: [], index: 0 };
  return {
    ...scope,
    index: catalog.items.length,
    items: [
      ...catalog.items,
      {
        displayUri: tappedUri,
        originalUri: originalUri || tappedUri,
        ...(displaySize ? { displaySize } : {}),
        ...(referrerPolicy ? { referrerPolicy } : {})
      }
    ]
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

export function selectImageDisplaySource(
  attributes: Record<string, string | undefined>,
  contentWidth: number,
  pixelRatio: number
): { uri: string; candidateKind: ImageDisplayCandidateKind; displaySize?: ImageDisplaySize } | null {
  const displaySize = imageDisplaySize(attributeValue(attributes, 'width'), attributeValue(attributes, 'height'));
  const srcsetUri = selectResponsiveSrcsetImageUrlFromCandidates(
    parseSrcsetCandidates(attributeValue(attributes, 'srcset')),
    contentWidth,
    pixelRatio
  );
  if (srcsetUri) {
    return { uri: srcsetUri, candidateKind: 'srcset', ...(displaySize ? { displaySize } : {}) };
  }
  const fallback = fallbackForumBodyImageSource(attributes);
  return fallback && { ...fallback, ...(displaySize ? { displaySize } : {}) };
}

function imageDisplaySize(rawWidth = '', rawHeight = ''): ImageDisplaySize | undefined {
  const width = parseImageDimension(rawWidth);
  const height = parseImageDimension(rawHeight);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function isPreparedPreviewImageSource(clean: string) {
  return !isKnownPlaceholderImageUrl(clean) && (/^https?:\/\//i.test(clean) || isAllowedDataImageUrl(clean));
}

function firstPreparedPreviewImageSource(urls: readonly (string | undefined)[]) {
  for (const url of urls) {
    const clean = normalizeImagePreviewUrl(url || '');
    if (isPreparedPreviewImageSource(clean)) return clean;
  }
  return '';
}

function isKnownPlaceholderImageUrl(clean: string) {
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

function selectResponsiveSrcsetImageUrlFromCandidates(
  rawCandidates: readonly string[],
  contentWidth: number,
  pixelRatio: number
) {
  if (!rawCandidates.length || !Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    return '';
  }
  let best: ResponsiveSrcsetCandidate | undefined;
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
    if (
      !kind ||
      !Number.isFinite(value) ||
      value <= 0 ||
      !isAllowedActiveImageSource(uri) ||
      (best && best.kind !== kind)
    ) {
      return '';
    }
    if (kind === 'w' && (!Number.isFinite(contentWidth) || contentWidth <= 0)) {
      return '';
    }
    const target = kind === 'w' ? Math.min(contentWidth * pixelRatio, MAX_BODY_IMAGE_PIXEL_WIDTH) : pixelRatio;
    // Keep the first smallest covering candidate, or the last largest undersized candidate.
    if (!best || (best.value < target ? value >= best.value : value >= target && value < best.value)) {
      best = { uri, kind, value };
    }
  }
  return best?.uri || '';
}
