import {
  decodeHtml,
  escapeQuotedHtmlTagDelimiters,
  FORUM_VIDEO_STICKER_TAG,
  isAllowedDataImageUrl,
  parseHtml,
  textContentFromHtml
} from './localHtml';
import {
  FORUM_MEDIA_IDENTITY_HEADER,
  FORUM_MEDIA_SOURCE_HEADER,
  forumMediaIdentityHeaderValue,
  forumMediaSourceHeaderValue,
  type ForumMediaRequestContext
} from './mediaRequestContext';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from './nodeseekSession';
import { linkDiagnosticRefs } from './diagnostics';

export type ImageRequestOptions = {
  mediaContext: ForumMediaRequestContext;
  nodeSeekUserAgent?: string;
};

export type ImageSourceOptions = ImageRequestOptions & {
  baseSource?: unknown;
};

export type ImageDisplayCandidateKind = 'src' | 'srcset' | 'data-src' | 'data-original';

export interface ImageDisplaySize {
  width: number;
  height: number;
}

export interface ImagePreviewItem {
  displayUri: string;
  originalUri: string;
  displaySize?: ImageDisplaySize;
}

export interface ImagePreviewList {
  contentSource: ForumMediaRequestContext['contentSource'];
  items: ImagePreviewItem[];
  index: number;
}

export interface ImagePreviewCatalog {
  items: ImagePreviewItem[];
  itemIndexBySourceUrl: Record<string, number>;
}

export const FORUM_STICKER_TAG = 'forum-sticker';
export const FORUM_STICKER_ROW_TAG = 'forum-sticker-row';
export const FORUM_INLINE_MEDIA_LINE_TAG = 'forum-inline-media-line';
export const INLINE_FORUM_IMAGE_TAG = 'forum-inline-image';

const FORUM_STICKER_MEDIA_PATTERN = new RegExp(`<${FORUM_STICKER_TAG}\\b|<${FORUM_VIDEO_STICKER_TAG}\\b`, 'i');
const FORUM_VIDEO_STICKER_ELEMENT_PATTERN = new RegExp(
  `<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>[\\s\\S]*?<\\/${FORUM_VIDEO_STICKER_TAG}>`,
  'gi'
);
const FORUM_VIDEO_STICKER_OPEN_PATTERN = new RegExp(`<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>`, 'gi');
const DISPLAY_CANDIDATE_KIND_ATTR = 'data-forum-display-candidate-kind';
const ORIGINAL_IMAGE_SOURCE_ATTR = 'data-forum-original-src';
const STICKER_ROW_ATTR = 'data-forum-sticker-row';
const INLINE_EMOJI_MAX_SIZE = 24;
const INLINE_STICKER_DEFAULT_SIZE = 48;
const INLINE_STICKER_MAX_SIZE = 64;
const STICKER_ROW_DEFAULT_SIZE = 100;
const STICKER_ROW_MAX_SIZE = 160;
const STICKER_ROW_CONTENT_WIDTH_RATIO = 0.55;
const STICKER_ROW_DISPLAY_MAX_SIZE = 100;

const IMAGE_REQUEST_HEADER_HOSTS = ['v2ex.com', 'linux.do', 'nodeseek.com', '111666.best'];

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

export function isInlineForumImage(attributes: Record<string, string | undefined>) {
  return isInlineForumImageAttributes(attributes);
}

export function shouldMarkLoadedImageInline(
  attributes: Record<string, string | undefined>,
  width: number,
  height: number
) {
  const maxDimension = Math.max(safeImageDimension(width), safeImageDimension(height));
  return maxDimension > 0 && maxDimension <= INLINE_EMOJI_MAX_SIZE && isV2exEmbeddedImageAttributes(attributes);
}

export function markInlineSizedImageHtml(html: string, url: string) {
  const target = normalizeImagePreviewUrl(url);
  if (!target) {
    return html;
  }
  try {
    const root = parseHtml(html);
    let changed = false;
    root.querySelectorAll('img').forEach((image) => {
      const src = attributeValue(image.attributes, 'src');
      if (normalizeImagePreviewUrl(src) !== target) {
        return;
      }
      if (typeof image.setAttribute === 'function') {
        image.setAttribute('data-forum-inline-sized', 'true');
      } else {
        image.attributes['data-forum-inline-sized'] = 'true';
      }
      changed = true;
    });
    return changed ? root.toString() : html;
  } catch {
    return html;
  }
}

export function inlineForumImageDisplaySize(
  attributes: Record<string, string | undefined>,
  scale = 1,
  contentWidth = 0
) {
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const isSticker = isForumStickerImageAttributes(attributes);
  const isStickerRow = /^true$/i.test(attributeValue(attributes, STICKER_ROW_ATTR));
  const knownDimensions = knownForumStickerSourceDimensions(attributes);
  const fallbackSize = isSticker ? (isStickerRow ? STICKER_ROW_DEFAULT_SIZE : INLINE_STICKER_DEFAULT_SIZE) : 20;
  let displayWidth =
    width ||
    (height && knownDimensions ? (height * knownDimensions.width) / knownDimensions.height : 0) ||
    knownDimensions?.width ||
    height ||
    fallbackSize;
  let displayHeight =
    height ||
    (width && knownDimensions ? (width * knownDimensions.height) / knownDimensions.width : 0) ||
    knownDimensions?.height ||
    width ||
    fallbackSize;
  const maxSize = isSticker
    ? isStickerRow
      ? STICKER_ROW_MAX_SIZE
      : INLINE_STICKER_MAX_SIZE
    : isInlineForumImageAttributes(attributes)
      ? INLINE_EMOJI_MAX_SIZE
      : INLINE_STICKER_MAX_SIZE;
  const minSize = 12;
  const maxDimension = Math.max(displayWidth, displayHeight);
  if (maxDimension > maxSize) {
    const ratio = maxSize / maxDimension;
    displayWidth *= ratio;
    displayHeight *= ratio;
  }
  const minDimension = Math.max(displayWidth, displayHeight);
  if (minDimension < minSize) {
    const ratio = minSize / Math.max(minDimension, 1);
    displayWidth *= ratio;
    displayHeight *= ratio;
  }
  const safeScale = safeImageScale(scale);
  displayWidth *= safeScale;
  displayHeight *= safeScale;
  if (isStickerRow && Number.isFinite(contentWidth) && contentWidth > 0) {
    const rowMaxSize = Math.max(64, contentWidth * STICKER_ROW_CONTENT_WIDTH_RATIO);
    const rowMaxDimension = Math.min(STICKER_ROW_DISPLAY_MAX_SIZE, rowMaxSize);
    const rowDimension = Math.max(displayWidth, displayHeight);
    if (rowDimension > rowMaxDimension) {
      const ratio = rowMaxDimension / rowDimension;
      displayWidth *= ratio;
      displayHeight *= ratio;
    }
  }
  return {
    width: Math.round(displayWidth),
    height: Math.round(displayHeight)
  };
}

export function inlineForumImageAlignmentStyle(
  attributes: Record<string, string | undefined>,
  scale = 1,
  lineHeight = 0
) {
  if (!isInlineForumImageAttributes(attributes)) {
    return {};
  }
  const safeScale = safeImageScale(scale);
  const displaySize = inlineForumImageDisplaySize(attributes, safeScale);
  const resolvedLineHeight =
    Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : Math.round(16 * safeScale * 1.62);
  const translateY = Math.max(0, Math.round((resolvedLineHeight - displaySize.height) / 2));
  const classNames = (attributes.class || '').split(/\s+/);
  const isAvatar =
    classNames.includes('avatar') ||
    classNames.includes('user-avatar') ||
    /\/user_avatar\//i.test(attributes.src || '');
  return {
    ...(isAvatar ? { marginRight: Math.round(6 * safeScale) } : {}),
    ...(translateY > 0 ? { transform: [{ translateY }] } : {})
  };
}

export function flowInlineImagesInMixedParagraphs(html: string) {
  if (!/<(?:aside|img)\b/i.test(html) && !FORUM_STICKER_MEDIA_PATTERN.test(html)) {
    return html;
  }
  try {
    const root = parseHtml(html);
    upgradeBlockImageSources(root);
    upgradeForumStickerMedia(root);
    root.querySelectorAll('p').forEach((paragraph) => {
      flowImagesInMixedContainer(paragraph);
    });
    flowQuoteTitleAvatars(root);
    flowImagesInMixedContainer(root, true);
    return root.toString();
  } catch {
    return html;
  }
}

export function isHttpOrHttpsUrl(url: unknown): boolean {
  const clean = typeof url === 'string' ? url.trim() : '';
  if (!clean) {
    return false;
  }
  try {
    const protocol = new URL(clean).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeImagePreviewUrl(url: string): string {
  const clean = String(url || '').trim();
  if (/^(?:https?:|data:)/i.test(clean)) {
    return clean;
  }
  if (clean.startsWith('//')) {
    return `https:${clean}`;
  }
  return clean;
}

export function imageRequestHeadersForUrl(
  url: unknown,
  options: ImageRequestOptions
): Record<string, string> | undefined {
  const clean = normalizeImagePreviewUrl(typeof url === 'string' ? url : '');
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    const headers: Record<string, string> = {
      [FORUM_MEDIA_IDENTITY_HEADER]: forumMediaIdentityHeaderValue(options?.mediaContext),
      [FORUM_MEDIA_SOURCE_HEADER]: forumMediaSourceHeaderValue(options?.mediaContext)
    };
    if (!isKnownForumImageHost(parsed.hostname)) {
      return headers;
    }
    Object.assign(headers, {
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      Referer: parsed.origin
    });
    if (isNodeSeekHost(parsed.hostname)) {
      const userAgent = String(options?.nodeSeekUserAgent || '').trim() || DEFAULT_NODESEEK_ANDROID_USER_AGENT;
      if (userAgent) {
        headers['User-Agent'] = userAgent;
      }
    }
    return headers;
  } catch {
    return undefined;
  }
}

export function imageSourceFromUrl(url: string, options: ImageSourceOptions) {
  const clean = normalizeImagePreviewUrl(url);
  const source = options?.baseSource;
  const base: Record<string, unknown> =
    source && typeof source === 'object' && !Array.isArray(source)
      ? { ...(source as Record<string, unknown>), uri: clean }
      : { uri: clean };
  const mediaSessionIdentity = options?.mediaContext?.sessionIdentity || '';
  if (mediaSessionIdentity && /^https?:\/\//i.test(clean)) {
    base.cacheKey = `${mediaSessionIdentity}:${clean}`;
  }
  const headers = imageRequestHeadersForUrl(clean, options);
  if (!headers) {
    return base;
  }
  return {
    ...base,
    headers: {
      ...(base.headers && typeof base.headers === 'object' && !Array.isArray(base.headers) ? base.headers : {}),
      ...headers
    }
  };
}

export function dataImageFileFromUrl(url: unknown): { base64: string; extension: string } | null {
  const clean = typeof url === 'string' ? url.trim() : '';
  const match = clean.match(/^data:image\/(png|jpe?g|gif|webp|avif);base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  const type = match[1].toLowerCase();
  const extension = type === 'jpeg' ? 'jpg' : type.split('+')[0];
  const base64 = match[2].trim();
  return base64 ? { base64, extension } : null;
}

export function createImagePreviewCatalog(
  htmlParts: string[],
  contentWidth: number,
  pixelRatio: number
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
    let itemIndex = itemIndexByOriginalUri.get(originalUri);
    if (itemIndex === undefined) {
      itemIndex = items.length;
      itemIndexByOriginalUri.set(originalUri, itemIndex);
      items.push(entry.item);
    }
    aliases.forEach((url) => {
      itemIndexBySourceUrl[url] = itemIndex;
    });
  });
  return { items, itemIndexBySourceUrl };
}

export function imagePreviewListFromCatalog(
  catalog: ImagePreviewCatalog,
  tappedUrl: string,
  contentSource: ForumMediaRequestContext['contentSource'],
  tappedDisplaySize?: ImageDisplaySize
): ImagePreviewList {
  const tapped = normalizeImagePreviewUrl(tappedUrl);
  const mappedIndex = Object.prototype.hasOwnProperty.call(catalog.itemIndexBySourceUrl, tapped)
    ? catalog.itemIndexBySourceUrl[tapped]
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
      ...(displaySize ? { displaySize } : {})
    };
  }
  if (index === undefined && tappedUri) {
    index = items.findIndex((item) => item.originalUri === tappedUri);
    if (index < 0) {
      index = items.length;
      items.push({ displayUri: tappedUri, originalUri: tappedUri, ...(displaySize ? { displaySize } : {}) });
    }
  }
  if (index === undefined || index < 0) {
    return { contentSource, items: [], index: 0 };
  }
  return { contentSource, items, index };
}

type ImagePreviewEntry = {
  item: ImagePreviewItem;
  sourceUrls: string[];
};

function imagePreviewEntryFromImage(
  image: ParsedImageNode,
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
      ...(displaySource?.displaySize ? { displaySize: displaySource.displaySize } : {})
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

function fallbackBodyImageSource(
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
  const target = kind === 'w' ? contentWidth * pixelRatio : pixelRatio;
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

function decodeHtmlAttribute(value: unknown): string {
  return typeof value === 'string' ? decodeHtml(value) : '';
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

function imageAttributesFromText(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = pattern.exec(value);
  while (match) {
    attributes[match[1].toLowerCase()] = decodeHtmlAttribute(match[2] || match[3] || match[4] || '');
    match = pattern.exec(value);
  }
  return attributes;
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphHasTextOutsideImages(html: string) {
  const withoutImages = escapeQuotedHtmlTagDelimiters(html).replace(/<img\b[^>]*>/gi, ' ');
  return textContentFromHtml(withoutImages).length > 0;
}

type ParsedImageNode = {
  tagName: string;
  attributes: Record<string, string | undefined>;
  innerHTML?: string;
  set_content?: (content: string) => void;
  setAttribute?: (name: string, value: string) => void;
  replaceWith?: (content: string) => void;
  querySelectorAll?: (selector: string) => ParsedImageNode[];
  parentNode?: unknown;
  parent?: unknown;
};

function quoteTitleTextNode(title: ParsedImageNode) {
  return (
    title.querySelectorAll?.('div').find((node) => {
      const className = String(node.attributes?.class || '');
      return /(^|\s)quote-title__text-content(\s|$)/i.test(className);
    }) || title
  );
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function usernameFromForumAvatarUrl(value: string) {
  const clean = value.trim();
  const match =
    clean.match(/(?:^|\/)user_avatar\/(?:[^/?#]+\/)?([^/?#]+)\/\d+(?:\/|$)/i) ||
    clean.match(/(?:^|\/)letter_avatar\/([^/?#]+)\/\d+(?:\/|$)/i);
  return match ? decodePathSegment(match[1]).trim() : '';
}

function quoteTitleAvatarUsername(title: ParsedImageNode) {
  const avatar = title.querySelectorAll?.('img').find((node) => isForumAvatarImageAttributes(node.attributes));
  return avatar ? usernameFromForumAvatarUrl(attributeValue(avatar.attributes, 'src')) : '';
}

function addQuoteTitleUsername(aside: ParsedImageNode, title: ParsedImageNode) {
  const username =
    attributeValue(aside.attributes, 'data-username') ||
    attributeValue(aside.attributes, 'data-display-name') ||
    quoteTitleAvatarUsername(title);
  if (!username) {
    return;
  }
  const target = quoteTitleTextNode(title);
  const titleText = textContentFromHtml(target.innerHTML || '').trim();
  if (
    titleText.toLowerCase().startsWith(`${username.toLowerCase()}:`) ||
    /quote-title__username/i.test(target.innerHTML || '')
  ) {
    return;
  }
  target.innerHTML = `<strong class="quote-title__username">${escapeHtmlText(username)}</strong><span class="quote-title__separator"> · </span>${target.innerHTML || ''}`;
}

function flowQuoteTitleAvatars(root: { querySelectorAll?: (selector: string) => ParsedImageNode[] }) {
  root.querySelectorAll?.('aside').forEach((aside) => {
    const className = String(aside.attributes?.class || '');
    if (!/(^|\s)quote(\s|$)/i.test(className)) {
      return;
    }
    aside.querySelectorAll?.('div').forEach((container) => {
      const containerClass = String(container.attributes?.class || '');
      if (/(^|\s)quote-title__text-content(\s|$)/i.test(containerClass)) {
        container.tagName = 'span';
      }
      if (/(^|\s)title(\s|$)/i.test(containerClass)) {
        addQuoteTitleUsername(aside, container);
        flowImagesInMixedContainer(container, true, isForumAvatarImageAttributes);
      }
    });
  });
}

function flowImagesInMixedContainer(
  container: { innerHTML?: string; querySelectorAll?: (selector: string) => ParsedImageNode[]; childNodes?: unknown[] },
  directOnly = false,
  shouldFlowImage: (attributes: Record<string, string | undefined>) => boolean = isInlineForumImageAttributes
) {
  const images = directOnly ? directChildImages(container) : container.querySelectorAll?.('img') || [];
  const flowableImages = images.filter((image) => shouldFlowImage(image.attributes));
  if (!flowableImages.length) {
    return;
  }
  if (
    !paragraphHasTextOutsideImages(container.innerHTML || '') &&
    !flowableImages.every((image) => isInlineForumImageAttributes(image.attributes))
  ) {
    return;
  }
  flowableImages.forEach((image) => {
    if (isInsideLightboxImage(image)) {
      return;
    }
    const label =
      attributeValue(image.attributes, 'alt') ||
      attributeValue(image.attributes, 'title') ||
      attributeValue(image.attributes, 'src') ||
      'image';
    image.tagName = INLINE_FORUM_IMAGE_TAG;
    if (typeof image.set_content === 'function') {
      image.set_content(label);
    } else {
      image.innerHTML = label;
    }
  });
}

function upgradeForumStickerMedia(root: { querySelectorAll?: (selector: string) => ParsedImageNode[] }) {
  root.querySelectorAll?.('p').forEach((paragraph) => {
    const html = paragraph.innerHTML || '';
    if (!/<img\b/i.test(html) && !FORUM_STICKER_MEDIA_PATTERN.test(html)) {
      return;
    }
    const replacementHtml = stickerRowHtmlFromParagraph(html);
    if (replacementHtml && typeof paragraph.replaceWith === 'function') {
      paragraph.replaceWith(replacementHtml);
    }
  });
}

function stickerRowHtmlFromParagraph(html: string) {
  const normalizedHtml = escapeQuotedHtmlTagDelimiters(html);
  const pieces = normalizedHtml
    .split(/<br\s*\/?>/i)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const sourcePieces = pieces.length ? pieces : [normalizedHtml.trim()].filter(Boolean);
  let changed = false;
  const result = sourcePieces
    .map((piece) => {
      if (isStickerMediaOnlyHtml(piece)) {
        changed = true;
        return `<${FORUM_STICKER_ROW_TAG}>${stickerRowMediaHtml(piece)}</${FORUM_STICKER_ROW_TAG}>`;
      }
      const splitHtml = splitLargeStickerMediaFromTextHtml(piece);
      if (splitHtml) {
        changed = true;
        return splitHtml;
      }
      const inlineMediaLineHtml = inlineStickerMediaLineHtml(piece);
      if (inlineMediaLineHtml) {
        changed = true;
        return inlineMediaLineHtml;
      }
      const inlineHtml = inlineMixedStickerMediaHtml(piece);
      if (inlineHtml !== piece) {
        changed = true;
      }
      return `<p>${inlineHtml}</p>`;
    })
    .join('');
  return changed ? result : '';
}

function splitLargeStickerMediaFromTextHtml(html: string) {
  const result: string[] = [];
  const rowItems: string[] = [];
  const mediaPattern = new RegExp(
    `(<${FORUM_VIDEO_STICKER_TAG}\\b[^>]*>[\\s\\S]*?<\\/${FORUM_VIDEO_STICKER_TAG}>|<img\\b[^>]*>)`,
    'gi'
  );
  let inlineBuffer = '';
  let cursor = 0;
  let changed = false;

  const flushRowItems = () => {
    if (!rowItems.length) {
      return;
    }
    result.push(`<${FORUM_STICKER_ROW_TAG}>${rowItems.join(' ')}</${FORUM_STICKER_ROW_TAG}>`);
    rowItems.length = 0;
  };
  const flushInlineBuffer = () => {
    const inlineHtml = inlineMixedStickerMediaHtml(inlineBuffer).trim();
    inlineBuffer = '';
    if (!inlineHtml) {
      return;
    }
    flushRowItems();
    result.push(`<p>${inlineHtml}</p>`);
  };

  let match = mediaPattern.exec(html);
  while (match) {
    inlineBuffer += html.slice(cursor, match.index);
    const mediaHtml = match[0];
    const attributes = stickerMediaAttributesFromHtml(mediaHtml);
    if (shouldSplitStickerMediaElementFromText(mediaHtml, attributes)) {
      flushInlineBuffer();
      rowItems.push(stickerRowMediaHtml(mediaHtml).trim());
      changed = true;
    } else {
      inlineBuffer += mediaHtml;
    }
    cursor = mediaPattern.lastIndex;
    match = mediaPattern.exec(html);
  }
  inlineBuffer += html.slice(cursor);
  flushInlineBuffer();
  flushRowItems();
  return changed ? result.join('') : '';
}

function inlineStickerMediaLineHtml(html: string) {
  let changed = false;
  const lineHtml = html.replace(/<img\b([^>]*)>/gi, (match, attributesText: string) => {
    const attributes = imageAttributesFromText(attributesText);
    if (!shouldWrapStickerMediaInOwnLine(attributes)) {
      return match;
    }
    changed = true;
    return stickerImageHtml(attributesText, attributes);
  });
  return changed ? `<${FORUM_INLINE_MEDIA_LINE_TAG}>${lineHtml}</${FORUM_INLINE_MEDIA_LINE_TAG}>` : '';
}

function shouldWrapStickerMediaInOwnLine(attributes: Record<string, string | undefined>) {
  if (!isForumStickerImageAttributes(attributes)) {
    return false;
  }
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const explicitDimension = Math.max(width, height);
  if (explicitDimension) {
    return explicitDimension > INLINE_EMOJI_MAX_SIZE && explicitDimension <= INLINE_STICKER_MAX_SIZE;
  }
  const knownDimensions = knownForumStickerSourceDimensions(attributes);
  const maxDimension = Math.max(knownDimensions?.width || 0, knownDimensions?.height || 0, INLINE_STICKER_DEFAULT_SIZE);
  return maxDimension > INLINE_EMOJI_MAX_SIZE;
}

function stickerMediaAttributesFromHtml(html: string) {
  const videoMatch = html.match(new RegExp(`^<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>`, 'i'));
  const imageMatch = html.match(/^<img\b([^>]*)>/i);
  return imageAttributesFromText(videoMatch?.[1] || imageMatch?.[1] || '');
}

function shouldSplitStickerMediaElementFromText(html: string, attributes: Record<string, string | undefined>) {
  const isVideoSticker = new RegExp(`^<${FORUM_VIDEO_STICKER_TAG}\\b`, 'i').test(html);
  if (isVideoSticker) {
    return shouldSplitStickerMediaFromText(attributes);
  }
  return isForumStickerImageAttributes(attributes) && shouldSplitStickerMediaFromText(attributes);
}

function shouldSplitStickerMediaFromText(attributes: Record<string, string | undefined>) {
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  return Math.max(width, height) > INLINE_STICKER_MAX_SIZE;
}

function isStickerMediaOnlyHtml(html: string) {
  const withoutStickerMedia = removeStickerMediaHtml(html);
  return (
    withoutStickerMedia.hasSticker &&
    textContentFromHtml(withoutStickerMedia.html).trim() === '' &&
    !/<img\b/i.test(withoutStickerMedia.html) &&
    !FORUM_STICKER_MEDIA_PATTERN.test(withoutStickerMedia.html)
  );
}

function removeStickerMediaHtml(html: string) {
  let hasSticker = false;
  const withoutVideoStickers = html.replace(FORUM_VIDEO_STICKER_ELEMENT_PATTERN, () => {
    hasSticker = true;
    return ' ';
  });
  const withoutStickerImages = withoutVideoStickers.replace(/<img\b([^>]*)>/gi, (match, attributesText: string) => {
    const attributes = imageAttributesFromText(attributesText);
    if (!isForumStickerImageAttributes(attributes)) {
      return match;
    }
    hasSticker = true;
    return ' ';
  });
  return { hasSticker, html: withoutStickerImages };
}

function stickerRowMediaHtml(html: string) {
  return html
    .replace(FORUM_VIDEO_STICKER_OPEN_PATTERN, (_match, attributesText: string) => {
      const attributes = stickerRowAttributesText(attributesText);
      return `<${FORUM_VIDEO_STICKER_TAG}${attributes ? ` ${attributes}` : ''}>`;
    })
    .replace(/<img\b([^>]*)>/gi, (match, attributesText: string) => {
      const attributes = imageAttributesFromText(attributesText);
      if (!isForumStickerImageAttributes(attributes)) {
        return match;
      }
      const label =
        attributeValue(attributes, 'alt') ||
        attributeValue(attributes, 'title') ||
        attributeValue(attributes, 'src') ||
        'sticker';
      const rowAttributes = stickerRowAttributesText(attributesText);
      return `<${FORUM_STICKER_TAG}${rowAttributes ? ` ${rowAttributes}` : ''}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
    });
}

function stickerImageHtml(attributesText: string, attributes: Record<string, string | undefined>) {
  const label =
    attributeValue(attributes, 'alt') ||
    attributeValue(attributes, 'title') ||
    attributeValue(attributes, 'src') ||
    'sticker';
  const clean = attributesText
    .trim()
    .replace(/\/\s*$/, '')
    .trim();
  return `<${FORUM_STICKER_TAG}${clean ? ` ${clean}` : ''}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
}

function inlineMixedStickerMediaHtml(html: string) {
  return html.replace(FORUM_VIDEO_STICKER_ELEMENT_PATTERN, (match, attributesText: string) => {
    const attributes = imageAttributesFromText(attributesText);
    const fallbackSrc = attributeValue(attributes, 'data-fallback-src');
    if (!fallbackSrc) {
      return match;
    }
    const label = attributeValue(attributes, 'alt') || attributeValue(attributes, 'title') || fallbackSrc || 'sticker';
    const stickerAttributes = stickerFallbackAttributesText(attributes, fallbackSrc);
    return `<${FORUM_STICKER_TAG}${stickerAttributes ? ` ${stickerAttributes}` : ''}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
  });
}

function stickerFallbackAttributesText(attributes: Record<string, string | undefined>, src: string) {
  const names = ['class', 'alt', 'title', 'width', 'height'];
  return [
    `src="${escapeHtmlText(src)}"`,
    ...names.map((name) => {
      const value = attributeValue(attributes, name);
      return value ? `${name}="${escapeHtmlText(value)}"` : '';
    })
  ]
    .filter(Boolean)
    .join(' ');
}

function stickerRowAttributesText(value: string) {
  const clean = value
    .trim()
    .replace(/\/\s*$/, '')
    .trim();
  if (new RegExp(`(^|\\s)${STICKER_ROW_ATTR}\\s*=`, 'i').test(clean)) {
    return clean;
  }
  return [clean, `${STICKER_ROW_ATTR}="true"`].filter(Boolean).join(' ');
}

function upgradeBlockImageSources(root: { querySelectorAll?: (selector: string) => ParsedImageNode[] }) {
  root.querySelectorAll?.('img').forEach((image) => {
    if (isInlineForumImageAttributes(image.attributes)) {
      return;
    }
    const displaySource = fallbackBodyImageSource(image.attributes);
    const originalUri = imagePreviewEntryFromImage(image)?.item.originalUri;
    if (originalUri && originalUri !== displaySource?.uri) {
      if (typeof image.setAttribute === 'function') {
        image.setAttribute(ORIGINAL_IMAGE_SOURCE_ATTR, originalUri);
      } else {
        image.attributes[ORIGINAL_IMAGE_SOURCE_ATTR] = originalUri;
      }
    }
    if (displaySource?.uri && attributeValue(image.attributes, 'src') !== displaySource.uri) {
      if (typeof image.setAttribute === 'function') {
        image.setAttribute(DISPLAY_CANDIDATE_KIND_ATTR, displaySource.candidateKind);
        image.setAttribute('src', displaySource.uri);
      } else {
        image.attributes[DISPLAY_CANDIDATE_KIND_ATTR] = displaySource.candidateKind;
        image.attributes.src = displaySource.uri;
      }
    }
  });
}

function directChildImages(container: { childNodes?: unknown[] }) {
  return (container.childNodes || []).filter((child): child is ParsedImageNode => safeTagName(child) === 'img');
}

function isInsideLightboxImage(image: { parentNode?: unknown; parent?: unknown }) {
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
    if (
      (tagName === 'a' && /(^|\s)lightbox(\s|$)/i.test(className)) ||
      /(^|\s)lightbox-wrapper(\s|$)/i.test(className)
    ) {
      return true;
    }
    current = element.parentNode || element.parent;
  }
  return false;
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

function safeTagName(value: unknown) {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const element = value as { rawTagName?: string | null; tagName?: string };
  return String(element.rawTagName || element.tagName || '').toLowerCase();
}

function attributeValue(attributes: Record<string, string | undefined>, name: string) {
  return String(attributes[name] || attributes[name.toLowerCase()] || '').trim();
}

function isInlineForumImageAttributes(attributes: Record<string, string | undefined>) {
  const className = attributeValue(attributes, 'class');
  const src = attributeValue(attributes, 'src');
  const title = attributeValue(attributes, 'title');
  const alt = attributeValue(attributes, 'alt');
  const role = attributeValue(attributes, 'role');
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const hasSmallSize = (width > 0 && width <= 64) || (height > 0 && height <= 64);
  const hasTinyExplicitSize = width > 0 && height > 0 && Math.max(width, height) <= INLINE_EMOJI_MAX_SIZE;
  const classMarksEmoji = /(^|\s)(emoji|emoticon|smiley|twemoji)(\s|$)/i.test(className);
  const classMarksSticker = /(^|\s)sticker(\s|$)/i.test(className);
  const classMarksAvatar = /(^|\s)(avatar|user-avatar)(\s|$)/i.test(className);
  const runtimeMarksInlineSized = /^true$/i.test(attributeValue(attributes, 'data-forum-inline-sized'));
  const urlMarksEmoji = isInlineForumImageUrl(src);
  const urlMarksAvatar = /(^|\/)user_avatar\//i.test(src);
  const titleMarksEmoji = isForumEmojiLabel(title);
  const altMarksEmoji = isForumEmojiLabel(alt);
  const labelMarksSticker = isForumStickerImageAttributes(attributes);
  const hasEmojiMarker =
    classMarksEmoji || classMarksSticker || urlMarksEmoji || /^emoji$/i.test(role) || titleMarksEmoji || altMarksEmoji;
  return (
    runtimeMarksInlineSized ||
    labelMarksSticker ||
    (isV2exEmbeddedImageAttributes(attributes) && hasTinyExplicitSize) ||
    (hasEmojiMarker && (hasSmallSize || !width || !height || classMarksEmoji || urlMarksEmoji)) ||
    ((classMarksAvatar || urlMarksAvatar) && hasSmallSize)
  );
}

function isV2exEmbeddedImageAttributes(attributes: Record<string, string | undefined>) {
  return /(^|\s)embedded_image(\s|$)/i.test(attributeValue(attributes, 'class'));
}

function isForumStickerImageAttributes(attributes: Record<string, string | undefined>) {
  const className = attributeValue(attributes, 'class');
  return (
    /(^|\s)sticker(\s|$)/i.test(className) ||
    isForumStickerLabel(attributeValue(attributes, 'title')) ||
    isForumStickerLabel(attributeValue(attributes, 'alt'))
  );
}

function knownForumStickerSourceDimensions(attributes: Record<string, string | undefined>) {
  const path =
    nodeSeekStaticImagePath(attributeValue(attributes, 'src')) ||
    nodeSeekStaticImagePath(attributeValue(attributes, 'data-fallback-src'));
  if (!path) {
    return null;
  }
  if (/^\/static\/image\/sticker\/ac\//i.test(path)) {
    return { width: 150, height: 130 };
  }
  if (/^\/static\/image\/sticker\/emoji\//i.test(path)) {
    return { width: 100, height: 100 };
  }
  if (/^\/static\/image\/sticker\/xhj\//i.test(path)) {
    return { width: 48, height: 48 };
  }
  if (/^\/static\/image\/smiley\/xhj\d{3}\.(?:png|gif|webp|apng)$/i.test(path)) {
    return { width: 120, height: 99 };
  }
  return null;
}

function nodeSeekStaticImagePath(value: string) {
  const clean = value.trim();
  if (!clean) {
    return '';
  }
  try {
    const parsed = new URL(clean, 'https://www.nodeseek.com');
    if (!isNodeSeekHost(parsed.hostname)) {
      return '';
    }
    return parsed.pathname;
  } catch {
    return clean.startsWith('/static/image/') ? clean.split(/[?#]/)[0] : '';
  }
}

function isForumEmojiLabel(value: string) {
  return /^:[a-z0-9_+.-]+:$/i.test(value) || isForumStickerLabel(value);
}

function isForumStickerLabel(value: string) {
  return /^xhj\d{3}$/i.test(value.trim());
}

function isForumAvatarImageAttributes(attributes: Record<string, string | undefined>) {
  const className = attributeValue(attributes, 'class');
  const src = attributeValue(attributes, 'src');
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const hasSmallSize = (width > 0 && width <= 64) || (height > 0 && height <= 64);
  return hasSmallSize && (/(^|\s)(avatar|user-avatar)(\s|$)/i.test(className) || /(^|\/)user_avatar\//i.test(src));
}

function isInlineForumImageUrl(url: string) {
  const markers = new Set([
    'emoji',
    'emojis',
    'emoticon',
    'emoticons',
    'emotion',
    'emotions',
    'face',
    'faces',
    'smiley',
    'smilies',
    'twemoji'
  ]);
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase().includes('twemoji')) {
      return true;
    }
    return parsed.pathname.split('/').some((part) => markers.has(part.toLowerCase()));
  } catch {
    return url
      .split(/[?#]/)[0]
      .split('/')
      .some((part) => markers.has(part.toLowerCase()));
  }
}

function parseImageDimension(value: string) {
  const match = value.match(/^\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function safeImageDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeImageScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function isKnownForumImageHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return IMAGE_REQUEST_HEADER_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

function isNodeSeekHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'nodeseek.com' || normalized.endsWith('.nodeseek.com');
}
