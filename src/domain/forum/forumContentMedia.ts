import {
  decodeHtml,
  escapeHtmlFully,
  escapeQuotedHtmlTagDelimiters,
  FORUM_VIDEO_STICKER_TAG,
  isAllowedDataImageUrl,
  parseHtml,
  textContentFromHtml
} from './html';
import { isNodeSeekHost } from './sourceCatalog';
import { normalizeMediaReferrerPolicy, type MediaReferrerPolicy } from './mediaReferrer';

export const FORUM_STICKER_TAG = 'forum-sticker';
export const FORUM_STICKER_ROW_TAG = 'forum-sticker-row';
export const FORUM_INLINE_MEDIA_LINE_TAG = 'forum-inline-media-line';
export const INLINE_FORUM_IMAGE_TAG = 'forum-inline-image';
export const FORUM_DYNAMIC_INLINE_IMAGE_TAG = 'forum-dynamic-inline-image';
export const FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE = 'data-wz-dynamic-inline-image';
export const DISPLAY_CANDIDATE_KIND_ATTR = 'data-forum-display-candidate-kind';
export const ORIGINAL_IMAGE_SOURCE_ATTR = 'data-forum-original-src';
export const INLINE_EMOJI_MAX_SIZE = 24;

export type DynamicInlineImageDescriptor = {
  id: string;
  referrerPolicy?: MediaReferrerPolicy;
  url: string;
};

export type ForumImagePreviewDescriptor = {
  readonly dataOriginal?: string;
  readonly dataSource?: string;
  readonly displayCandidateKind?: 'data-original' | 'data-src' | 'src';
  readonly height?: string;
  readonly lightboxOriginal?: string;
  readonly originalSource?: string;
  readonly referrerPolicy?: MediaReferrerPolicy;
  readonly source: string;
  readonly sourceSet?: string;
  readonly width?: string;
};

export type ParsedForumImageNode = {
  tagName: string;
  rawTagName?: string | null;
  attributes: Record<string, string | undefined>;
  rawAttributes?: Record<string, string | null>;
  classNames?: string;
  innerHTML?: string;
  getAttribute?: (name: string) => string | undefined;
  set_content?: (content: string) => void;
  setAttribute?: (name: string, value: string) => void;
  removeAttribute?: (name: string) => void;
  replaceWith?: (content: string) => void;
  querySelectorAll?: (selector: string) => ParsedForumImageNode[];
  childNodes?: unknown[];
  parentNode?: unknown;
  parent?: unknown;
};

type ForumContentMediaRoot = ReturnType<typeof parseHtml>;

const STICKER_ROW_ATTR = 'data-forum-sticker-row';
const INLINE_STICKER_MAX_SIZE = 64;
const FORUM_STICKER_MEDIA_PATTERN = new RegExp(`<${FORUM_STICKER_TAG}\\b|<${FORUM_VIDEO_STICKER_TAG}\\b`, 'i');
const FORUM_VIDEO_STICKER_ELEMENT_PATTERN = new RegExp(
  `<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>[\\s\\S]*?<\\/${FORUM_VIDEO_STICKER_TAG}>`,
  'gi'
);
const FORUM_VIDEO_STICKER_OPEN_PATTERN = new RegExp(`<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>`, 'gi');
const INLINE_FORUM_IMAGE_URL_MARKERS = new Set([
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

type ForumImageUrlAnalysis = {
  readonly allowed: boolean;
  readonly hostname: string;
  readonly inline: boolean;
  readonly normalized: string;
  readonly pathname: string;
  readonly placeholder: boolean;
};

type ForumImageUrlResolver = (value: string) => ForumImageUrlAnalysis;
type ForumImageNodeAttributeResolver = (node: ParsedForumImageNode) => Record<string, string | undefined>;

const EMPTY_FORUM_IMAGE_URL_ANALYSIS: ForumImageUrlAnalysis = {
  allowed: false,
  hostname: '',
  inline: false,
  normalized: '',
  pathname: '',
  placeholder: false
};

function analyzeNormalizedForumImageUrl(normalized: string): ForumImageUrlAnalysis {
  if (!normalized) return EMPTY_FORUM_IMAGE_URL_ANALYSIS;
  let parsed: URL | null = null;
  try {
    parsed = new URL(normalized);
  } catch {
    // Relative and invalid sources stay inactive, but their path markers remain useful for emoji layout.
  }
  const protocol = parsed?.protocol.toLowerCase() || '';
  const hostname = parsed?.hostname.toLowerCase() || '';
  const pathname = parsed?.pathname || normalized.split(/[?#]/)[0];
  const pathParts = pathname.split('/').map((part) => part.toLowerCase());
  const basename = pathname.split('/').pop() || '';
  return {
    allowed: isAllowedDataImageUrl(normalized) || protocol === 'http:' || protocol === 'https:',
    hostname,
    inline:
      Boolean(parsed?.hostname.toLowerCase().includes('twemoji')) ||
      pathParts.some((part) => INLINE_FORUM_IMAGE_URL_MARKERS.has(part)),
    normalized,
    pathname,
    placeholder:
      /^data:image\/gif;base64,R0lGODlhAQABA/i.test(normalized) ||
      /^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/i.test(normalized) ||
      /^(?:blank|spacer|transparent)(?:[-_.@].*)?\.(?:gif|png|webp)$/i.test(basename)
  };
}

function analyzeForumImageUrl(value: string) {
  return analyzeNormalizedForumImageUrl(normalizeForumImageUrl(value));
}

function createForumImageUrlResolver(): ForumImageUrlResolver {
  const analyses = new Map<string, ForumImageUrlAnalysis>();
  return (value) => {
    const normalized = normalizeForumImageUrl(value);
    if (!normalized) return EMPTY_FORUM_IMAGE_URL_ANALYSIS;
    const cached = analyses.get(normalized);
    if (cached) return cached;
    const analysis = analyzeNormalizedForumImageUrl(normalized);
    analyses.set(normalized, analysis);
    return analysis;
  };
}

function forumImageNodeAttributes(node: ParsedForumImageNode) {
  if (!node.getAttribute || !node.rawAttributes) return node.attributes || {};
  return Object.fromEntries(Object.keys(node.rawAttributes).map((name) => [name, node.getAttribute?.(name)])) as Record<
    string,
    string | undefined
  >;
}

function createForumImageNodeAttributeResolver(): ForumImageNodeAttributeResolver {
  const attributesByNode = new Map<ParsedForumImageNode, Record<string, string | undefined>>();
  return (node) => {
    const cached = attributesByNode.get(node);
    if (cached) return cached;
    const attributes = forumImageNodeAttributes(node);
    attributesByNode.set(node, attributes);
    return attributes;
  };
}

function nearestForumImageAncestor(node: ParsedForumImageNode, tagName: string) {
  let current = node.parentNode || node.parent;
  while (current && typeof current === 'object') {
    const element = current as ParsedForumImageNode;
    if (forumImageTagName(element) === tagName) return element;
    current = element.parentNode || element.parent;
  }
  return null;
}

function appendIndexedNode(
  index: Map<ParsedForumImageNode, ParsedForumImageNode[]>,
  owner: ParsedForumImageNode | null,
  node: ParsedForumImageNode
) {
  if (!owner) return;
  const entries = index.get(owner);
  if (entries) entries.push(node);
  else index.set(owner, [node]);
}

export function normalizeForumContentMediaNodes(
  root: ForumContentMediaRoot,
  { dynamicV2exImages = false }: { dynamicV2exImages?: boolean } = {}
) {
  const resolveImageUrl = createForumImageUrlResolver();
  const resolveNodeAttributes = createForumImageNodeAttributeResolver();
  const isInlineImage = (attributes: Record<string, string | undefined>) =>
    isInlineForumImage(attributes, resolveImageUrl);
  const images: ParsedForumImageNode[] = [];
  const imagesByParagraph = new Map<ParsedForumImageNode, ParsedForumImageNode[]>();
  const paragraphs: ParsedForumImageNode[] = [];
  const stickerParagraphs = new Set<ParsedForumImageNode>();
  const quoteAsides: ParsedForumImageNode[] = [];
  const divsByAside = new Map<ParsedForumImageNode, ParsedForumImageNode[]>();
  root.querySelectorAll('*').forEach((node) => {
    const parsedNode = node as ParsedForumImageNode;
    const tagName = forumImageTagName(parsedNode);
    if (tagName === FORUM_DYNAMIC_INLINE_IMAGE_TAG) parsedNode.tagName = 'span';
    const rawAttributes = parsedNode.rawAttributes || parsedNode.attributes;
    if (Object.prototype.hasOwnProperty.call(rawAttributes, FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE)) {
      parsedNode.removeAttribute?.(FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE);
    }
    if (tagName === 'img') {
      images.push(parsedNode);
      const paragraph = nearestForumImageAncestor(parsedNode, 'p');
      appendIndexedNode(imagesByParagraph, paragraph, parsedNode);
      if (paragraph && isForumStickerImage(resolveNodeAttributes(parsedNode))) stickerParagraphs.add(paragraph);
    }
    if (tagName === 'p') paragraphs.push(parsedNode);
    if (tagName === FORUM_STICKER_TAG || tagName === FORUM_VIDEO_STICKER_TAG) {
      const paragraph = nearestForumImageAncestor(parsedNode, 'p');
      if (paragraph) stickerParagraphs.add(paragraph);
    }
    if (tagName === 'aside') quoteAsides.push(parsedNode);
    if (tagName === 'div') {
      appendIndexedNode(divsByAside, nearestForumImageAncestor(parsedNode, 'aside'), parsedNode);
    }
  });
  const previewImages = upgradeBlockImageSources(images, resolveImageUrl, resolveNodeAttributes);
  upgradeForumStickerParagraphs([...stickerParagraphs], resolveImageUrl);
  paragraphs.forEach((paragraph) => {
    flowImagesInMixedContainer(
      paragraph as ParsedForumImageNode,
      false,
      isInlineImage,
      imagesByParagraph.get(paragraph) || [],
      isInlineImage,
      resolveNodeAttributes
    );
  });
  flowQuoteTitleAvatars(quoteAsides, divsByAside, resolveNodeAttributes);
  flowImagesInMixedContainer(
    root as unknown as ParsedForumImageNode,
    true,
    isInlineImage,
    undefined,
    isInlineImage,
    resolveNodeAttributes
  );
  return {
    dynamicInlineImages: dynamicV2exImages ? markDynamicV2exInlineImageNodes(images, resolveNodeAttributes) : [],
    previewImages
  };
}

export function normalizeForumStickerMediaHtml(html: string) {
  if (!/<img\b/i.test(html) && !FORUM_STICKER_MEDIA_PATTERN.test(html)) return html;
  try {
    const root = parseHtml(html);
    return upgradeForumStickerMedia(root, createForumImageUrlResolver()) ? root.toString() : html;
  } catch {
    return html;
  }
}

export function forumImageAttributeValue(attributes: Record<string, string | undefined>, name: string) {
  return String(attributes[name] || attributes[name.toLowerCase()] || '').trim();
}

export function parseForumImageDimension(value: string) {
  const match = value.match(/^\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function forumImageAttributesFromText(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = pattern.exec(value);
  while (match) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] || match[3] || match[4] || '');
    match = pattern.exec(value);
  }
  return attributes;
}

export function forumImagePreviewDescriptorsFromHtmlFallback(html: string): ForumImagePreviewDescriptor[] {
  const descriptors: ForumImagePreviewDescriptor[] = [];
  const resolveImageUrl = createForumImageUrlResolver();
  const imagePattern = /<img\b([^>]*)>/gi;
  let match = imagePattern.exec(html);
  while (match) {
    try {
      const attributes = forumImageAttributesFromText(match[1] || '');
      if (!isInlineForumImage(attributes, resolveImageUrl)) {
        const descriptor = forumImagePreviewDescriptorFromAttributes(attributes, '', resolveImageUrl);
        if (descriptor) descriptors.push(descriptor);
      }
    } catch {
      return descriptors;
    }
    match = imagePattern.exec(html);
  }
  return descriptors;
}

export function forumImageTagName(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const element = value as { rawTagName?: string | null; tagName?: string };
  return String(element.rawTagName || element.tagName || '').toLowerCase();
}

export function isV2exEmbeddedForumImage(attributes: Record<string, string | undefined>) {
  return /(^|\s)embedded_image(\s|$)/i.test(forumImageAttributeValue(attributes, 'class'));
}

export function isForumStickerImage(attributes: Record<string, string | undefined>) {
  const className = forumImageAttributeValue(attributes, 'class');
  return (
    /(^|\s)sticker(\s|$)/i.test(className) ||
    isForumStickerLabel(forumImageAttributeValue(attributes, 'title')) ||
    isForumStickerLabel(forumImageAttributeValue(attributes, 'alt'))
  );
}

export function isInlineForumImage(
  attributes: Record<string, string | undefined>,
  resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl
) {
  const className = forumImageAttributeValue(attributes, 'class');
  const src = forumImageAttributeValue(attributes, 'src');
  const title = forumImageAttributeValue(attributes, 'title');
  const alt = forumImageAttributeValue(attributes, 'alt');
  const role = forumImageAttributeValue(attributes, 'role');
  const width = parseForumImageDimension(forumImageAttributeValue(attributes, 'width'));
  const height = parseForumImageDimension(forumImageAttributeValue(attributes, 'height'));
  const hasSmallSize = (width > 0 && width <= 64) || (height > 0 && height <= 64);
  const hasTinyExplicitSize = width > 0 && height > 0 && Math.max(width, height) <= INLINE_EMOJI_MAX_SIZE;
  const classMarksEmoji = /(^|\s)(emoji|emoticon|smiley|twemoji)(\s|$)/i.test(className);
  const classMarksSticker = /(^|\s)sticker(\s|$)/i.test(className);
  const classMarksAvatar = /(^|\s)(avatar|user-avatar)(\s|$)/i.test(className);
  const runtimeMarksInlineSized = /^true$/i.test(forumImageAttributeValue(attributes, 'data-forum-inline-sized'));
  const urlMarksEmoji = resolveImageUrl(src).inline;
  const urlMarksAvatar = /(^|\/)user_avatar\//i.test(src);
  const titleMarksEmoji = isForumEmojiLabel(title);
  const altMarksEmoji = isForumEmojiLabel(alt);
  const labelMarksSticker = isForumStickerImage(attributes);
  const hasEmojiMarker =
    classMarksEmoji || classMarksSticker || urlMarksEmoji || /^emoji$/i.test(role) || titleMarksEmoji || altMarksEmoji;
  return (
    runtimeMarksInlineSized ||
    labelMarksSticker ||
    (isV2exEmbeddedForumImage(attributes) && hasTinyExplicitSize) ||
    (hasEmojiMarker && (hasSmallSize || !width || !height || classMarksEmoji || urlMarksEmoji)) ||
    ((classMarksAvatar || urlMarksAvatar) && hasSmallSize)
  );
}

export function isForumAvatarImage(attributes: Record<string, string | undefined>) {
  const className = forumImageAttributeValue(attributes, 'class');
  const src = forumImageAttributeValue(attributes, 'src');
  const width = parseForumImageDimension(forumImageAttributeValue(attributes, 'width'));
  const height = parseForumImageDimension(forumImageAttributeValue(attributes, 'height'));
  const hasSmallSize = (width > 0 && width <= 64) || (height > 0 && height <= 64);
  return hasSmallSize && (/(^|\s)(avatar|user-avatar)(\s|$)/i.test(className) || /(^|\/)user_avatar\//i.test(src));
}

function markDynamicV2exInlineImageNodes(
  images: readonly ParsedForumImageNode[],
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  const descriptors: DynamicInlineImageDescriptor[] = [];
  images.forEach((image) => {
    if (forumImageTagName(image) !== 'img') return;
    const attributes = resolveNodeAttributes(image);
    if (!isV2exEmbeddedForumImage(attributes) || isInsideLightboxImage(image, resolveNodeAttributes)) return;
    const url = normalizeForumImageUrl(forumImageAttributeValue(attributes, 'src'));
    if (!url) return;
    const id = String(descriptors.length);
    const label =
      forumImageAttributeValue(attributes, 'alt') ||
      forumImageAttributeValue(attributes, 'title') ||
      forumImageAttributeValue(attributes, 'src') ||
      'image';
    image.tagName = FORUM_DYNAMIC_INLINE_IMAGE_TAG;
    image.setAttribute?.(FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE, id);
    image.set_content?.(label);
    const referrerPolicy = normalizeMediaReferrerPolicy(attributes.referrerpolicy);
    descriptors.push({ id, url, ...(referrerPolicy ? { referrerPolicy } : {}) });
  });
  return descriptors;
}

function upgradeBlockImageSources(
  images: readonly ParsedForumImageNode[],
  resolveImageUrl: ForumImageUrlResolver,
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  const descriptors: ForumImagePreviewDescriptor[] = [];
  images.forEach((image) => {
    const attributes = resolveNodeAttributes(image);
    if (isInlineForumImage(attributes, resolveImageUrl)) return;
    const displaySource = fallbackForumBodyImageSource(attributes, resolveImageUrl);
    const originalUri = originalForumImageSource(image, attributes, resolveImageUrl, resolveNodeAttributes);
    if (originalUri && originalUri !== displaySource?.uri) {
      image.setAttribute?.(ORIGINAL_IMAGE_SOURCE_ATTR, originalUri);
      attributes[ORIGINAL_IMAGE_SOURCE_ATTR] = originalUri;
    }
    if (displaySource?.uri && forumImageAttributeValue(attributes, 'src') !== displaySource.uri) {
      image.setAttribute?.(DISPLAY_CANDIDATE_KIND_ATTR, displaySource.candidateKind);
      image.setAttribute?.('src', displaySource.uri);
      attributes[DISPLAY_CANDIDATE_KIND_ATTR] = displaySource.candidateKind;
      attributes.src = displaySource.uri;
    }
    const descriptor = forumImagePreviewDescriptorFromAttributes(
      attributes,
      lightboxHrefForForumImage(image, resolveNodeAttributes),
      resolveImageUrl,
      displaySource
    );
    if (descriptor) {
      descriptors.push(descriptor);
    }
  });
  return descriptors;
}

function forumImagePreviewDescriptorFromAttributes(
  attributes: Record<string, string | undefined>,
  lightboxOriginal = '',
  resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl,
  preparedFallbackSource: ReturnType<typeof fallbackForumBodyImageSource> | undefined = undefined
): ForumImagePreviewDescriptor | null {
  const fallbackSource = preparedFallbackSource || fallbackForumBodyImageSource(attributes, resolveImageUrl);
  const source = resolveImageUrl(fallbackSource?.uri || forumImageAttributeValue(attributes, 'src')).normalized;
  const sourceSet = forumImageAttributeValue(attributes, 'srcset');
  const dataSource = resolveImageUrl(forumImageAttributeValue(attributes, 'data-src')).normalized;
  const dataOriginal = resolveImageUrl(forumImageAttributeValue(attributes, 'data-original')).normalized;
  const originalSource = resolveImageUrl(forumImageAttributeValue(attributes, ORIGINAL_IMAGE_SOURCE_ATTR)).normalized;
  const normalizedLightboxOriginal = resolveImageUrl(lightboxOriginal).normalized;
  const width = forumImageAttributeValue(attributes, 'width');
  const height = forumImageAttributeValue(attributes, 'height');
  const referrerPolicy = normalizeMediaReferrerPolicy(forumImageAttributeValue(attributes, 'referrerpolicy'));
  const displayCandidateKind = forumImageAttributeValue(attributes, DISPLAY_CANDIDATE_KIND_ATTR);
  if (!source && !sourceSet && !dataSource && !dataOriginal && !originalSource && !normalizedLightboxOriginal) {
    return null;
  }
  return {
    source,
    ...(sourceSet ? { sourceSet } : {}),
    ...(dataSource ? { dataSource } : {}),
    ...(dataOriginal ? { dataOriginal } : {}),
    ...(originalSource ? { originalSource } : {}),
    ...(normalizedLightboxOriginal ? { lightboxOriginal: normalizedLightboxOriginal } : {}),
    ...(displayCandidateKind === 'src' ||
    displayCandidateKind === 'data-src' ||
    displayCandidateKind === 'data-original'
      ? { displayCandidateKind }
      : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(referrerPolicy ? { referrerPolicy } : {})
  };
}

function fallbackForumBodyImageSource(
  attributes: Record<string, string | undefined>,
  resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl
) {
  const src = resolveImageUrl(forumImageAttributeValue(attributes, 'src'));
  if (src.allowed && !src.placeholder) {
    const preservedKind = (['data-src', 'data-original'] as const).find(
      (candidateKind) =>
        forumImageAttributeValue(attributes, DISPLAY_CANDIDATE_KIND_ATTR) === candidateKind &&
        resolveImageUrl(forumImageAttributeValue(attributes, candidateKind)).normalized === src.normalized
    );
    return { uri: src.normalized, candidateKind: preservedKind || ('src' as const) };
  }
  for (const candidateKind of ['data-src', 'data-original'] as const) {
    const uri = resolveImageUrl(forumImageAttributeValue(attributes, candidateKind));
    if (uri.allowed && !uri.placeholder) return { uri: uri.normalized, candidateKind };
  }
  return null;
}

function originalForumImageSource(
  image: ParsedForumImageNode,
  attributes: Record<string, string | undefined> = forumImageNodeAttributes(image),
  resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl,
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  const linkedUrl = lightboxHrefForForumImage(image, resolveNodeAttributes);
  return firstAllowedForumImageSource(
    [
      linkedUrl,
      forumImageAttributeValue(attributes, 'data-original'),
      bestForumSrcsetImageUrl(forumImageAttributeValue(attributes, 'srcset'), resolveImageUrl),
      forumImageAttributeValue(attributes, 'data-src'),
      forumImageAttributeValue(attributes, 'src')
    ],
    resolveImageUrl
  );
}

function firstAllowedForumImageSource(values: string[], resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl) {
  for (const value of values) {
    const analysis = resolveImageUrl(value);
    if (analysis.allowed && !analysis.placeholder) return analysis.normalized;
  }
  return '';
}

function bestForumSrcsetImageUrl(srcset: string, resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl) {
  let bestUrl = '';
  let bestScore = -1;
  parseSrcsetCandidates(srcset).forEach((candidate, index) => {
    const parts = candidate.trim().split(/\s+/);
    const url = String(parts.shift() || '').trim();
    if (!resolveImageUrl(url).allowed) return;
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

export function parseSrcsetCandidates(srcset: string) {
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
  if (current.trim()) candidates.push(current);
  return candidates;
}

function normalizeForumImageUrl(value: string) {
  const clean = String(value || '').trim();
  return clean.startsWith('//') ? `https:${clean}` : clean;
}

function lightboxHrefForForumImage(
  image: ParsedForumImageNode,
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  let current = image.parentNode || image.parent;
  while (current && typeof current === 'object') {
    const element = current as ParsedForumImageNode;
    const tagName = forumImageTagName(element);
    const attributes = resolveNodeAttributes(element);
    const className = String(element.classNames || attributes.class || '');
    if (tagName === 'a' && /(^|\s)lightbox(\s|$)/i.test(className)) {
      return forumImageAttributeValue(attributes, 'href');
    }
    if (/(^|\s)lightbox-wrapper(\s|$)/i.test(className)) return '';
    current = element.parentNode || element.parent;
  }
  return '';
}

function paragraphHasTextOutsideImages(html: string) {
  const withoutImages = escapeQuotedHtmlTagDelimiters(html).replace(/<img\b[^>]*>/gi, ' ');
  return textContentFromHtml(withoutImages).length > 0;
}

function quoteTitleTextNode(
  title: ParsedForumImageNode,
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  return (
    title.querySelectorAll?.('div').find((node) => {
      const className = String(resolveNodeAttributes(node).class || '');
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

function quoteTitleAvatarUsername(
  title: ParsedForumImageNode,
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  const avatar = title.querySelectorAll?.('img').find((node) => isForumAvatarImage(resolveNodeAttributes(node)));
  return avatar ? usernameFromForumAvatarUrl(forumImageAttributeValue(resolveNodeAttributes(avatar), 'src')) : '';
}

function addQuoteTitleUsername(
  aside: ParsedForumImageNode,
  title: ParsedForumImageNode,
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  const attributes = resolveNodeAttributes(aside);
  const username =
    forumImageAttributeValue(attributes, 'data-username') ||
    forumImageAttributeValue(attributes, 'data-display-name') ||
    quoteTitleAvatarUsername(title, resolveNodeAttributes);
  if (!username) return;
  const target = quoteTitleTextNode(title, resolveNodeAttributes);
  const titleText = textContentFromHtml(target.innerHTML || '').trim();
  if (
    titleText.toLowerCase().startsWith(`${username.toLowerCase()}:`) ||
    /quote-title__username/i.test(target.innerHTML || '')
  ) {
    return;
  }
  target.innerHTML = `<strong class="quote-title__username">${escapeHtmlFully(username)}</strong><span class="quote-title__separator"> · </span>${target.innerHTML || ''}`;
}

function flowQuoteTitleAvatars(
  asides: readonly ParsedForumImageNode[],
  divsByAside: ReadonlyMap<ParsedForumImageNode, readonly ParsedForumImageNode[]>,
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  asides.forEach((aside) => {
    const className = String(resolveNodeAttributes(aside).class || '');
    if (!/(^|\s)quote(\s|$)/i.test(className)) return;
    (divsByAside.get(aside) || []).forEach((container) => {
      const containerClass = String(resolveNodeAttributes(container).class || '');
      if (/(^|\s)quote-title__text-content(\s|$)/i.test(containerClass)) container.tagName = 'span';
      if (/(^|\s)title(\s|$)/i.test(containerClass)) {
        addQuoteTitleUsername(aside, container, resolveNodeAttributes);
        flowImagesInMixedContainer(
          container,
          true,
          isForumAvatarImage,
          undefined,
          isInlineForumImage,
          resolveNodeAttributes
        );
      }
    });
  });
}

function flowImagesInMixedContainer(
  container: ParsedForumImageNode,
  directOnly = false,
  shouldFlowImage: (attributes: Record<string, string | undefined>) => boolean = isInlineForumImage,
  indexedImages?: readonly ParsedForumImageNode[],
  isInlineImage: (attributes: Record<string, string | undefined>) => boolean = isInlineForumImage,
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  const images =
    indexedImages || (directOnly ? directChildImages(container) : container.querySelectorAll?.('img') || []);
  const flowableImages = images
    .map((image) => ({ attributes: resolveNodeAttributes(image), image }))
    .filter(({ attributes }) => shouldFlowImage(attributes));
  if (!flowableImages.length) return;
  if (
    !paragraphHasTextOutsideImages(container.innerHTML || '') &&
    !flowableImages.every(({ attributes }) => isInlineImage(attributes))
  ) {
    return;
  }
  flowableImages.forEach(({ attributes, image }) => {
    if (isInsideLightboxImage(image, resolveNodeAttributes)) return;
    const label =
      forumImageAttributeValue(attributes, 'alt') ||
      forumImageAttributeValue(attributes, 'title') ||
      forumImageAttributeValue(attributes, 'src') ||
      'image';
    image.tagName = INLINE_FORUM_IMAGE_TAG;
    if (typeof image.set_content === 'function') image.set_content(label);
    else image.innerHTML = label;
  });
}

function upgradeForumStickerMedia(
  root: { querySelectorAll?: (selector: string) => ParsedForumImageNode[] },
  resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl
) {
  return upgradeForumStickerParagraphs(root.querySelectorAll?.('p') || [], resolveImageUrl);
}

function upgradeForumStickerParagraphs(
  paragraphs: readonly ParsedForumImageNode[],
  resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl
) {
  let changed = false;
  paragraphs.forEach((paragraph) => {
    const html = paragraph.innerHTML || '';
    if (!/<img\b/i.test(html) && !FORUM_STICKER_MEDIA_PATTERN.test(html)) return;
    const replacementHtml = stickerRowHtmlFromParagraph(html, resolveImageUrl);
    if (replacementHtml && typeof paragraph.replaceWith === 'function') {
      paragraph.replaceWith(replacementHtml);
      changed = true;
    }
  });
  return changed;
}

function stickerRowHtmlFromParagraph(html: string, resolveImageUrl: ForumImageUrlResolver) {
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
      const splitHtml = splitLargeStickerMediaFromTextHtml(piece, resolveImageUrl);
      if (splitHtml) {
        changed = true;
        return splitHtml;
      }
      const inlineMediaLineHtml = inlineStickerMediaLineHtml(piece, resolveImageUrl);
      if (inlineMediaLineHtml) {
        changed = true;
        return inlineMediaLineHtml;
      }
      const inlineHtml = inlineMixedStickerMediaHtml(piece);
      if (inlineHtml !== piece) changed = true;
      return `<p>${inlineHtml}</p>`;
    })
    .join('');
  return changed ? result : '';
}

function splitLargeStickerMediaFromTextHtml(html: string, resolveImageUrl: ForumImageUrlResolver) {
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
    if (!rowItems.length) return;
    result.push(`<${FORUM_STICKER_ROW_TAG}>${rowItems.join(' ')}</${FORUM_STICKER_ROW_TAG}>`);
    rowItems.length = 0;
  };
  const flushInlineBuffer = () => {
    const inlineHtml = inlineMixedStickerMediaHtml(inlineBuffer).trim();
    inlineBuffer = '';
    if (!inlineHtml) return;
    flushRowItems();
    result.push(inlineStickerMediaLineHtml(inlineHtml, resolveImageUrl) || `<p>${inlineHtml}</p>`);
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
  if (!changed) return '';
  flushInlineBuffer();
  flushRowItems();
  return changed ? result.join('') : '';
}

function inlineStickerMediaLineHtml(html: string, resolveImageUrl: ForumImageUrlResolver) {
  let changed = false;
  const lineHtml = html.replace(/<img\b([^>]*)>/gi, (match, attributesText: string) => {
    const attributes = forumImageAttributesFromText(attributesText);
    if (!shouldWrapStickerMediaInOwnLine(attributes, resolveImageUrl)) return match;
    changed = true;
    return stickerImageHtml(attributesText, attributes);
  });
  return changed ? `<${FORUM_INLINE_MEDIA_LINE_TAG}>${lineHtml}</${FORUM_INLINE_MEDIA_LINE_TAG}>` : '';
}

function shouldWrapStickerMediaInOwnLine(
  attributes: Record<string, string | undefined>,
  resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl
) {
  if (!isForumStickerImage(attributes)) return false;
  const width = parseForumImageDimension(forumImageAttributeValue(attributes, 'width'));
  const height = parseForumImageDimension(forumImageAttributeValue(attributes, 'height'));
  const explicitDimension = Math.max(width, height);
  if (explicitDimension)
    return explicitDimension > INLINE_EMOJI_MAX_SIZE && explicitDimension <= INLINE_STICKER_MAX_SIZE;
  const knownDimensions = knownForumStickerSourceDimensions(attributes, resolveImageUrl);
  return Math.max(knownDimensions?.width || 0, knownDimensions?.height || 0, 48) > INLINE_EMOJI_MAX_SIZE;
}

function stickerMediaAttributesFromHtml(html: string) {
  const videoMatch = html.match(new RegExp(`^<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>`, 'i'));
  const imageMatch = html.match(/^<img\b([^>]*)>/i);
  return forumImageAttributesFromText(videoMatch?.[1] || imageMatch?.[1] || '');
}

function shouldSplitStickerMediaElementFromText(html: string, attributes: Record<string, string | undefined>) {
  return (
    (new RegExp(`^<${FORUM_VIDEO_STICKER_TAG}\\b`, 'i').test(html) || isForumStickerImage(attributes)) &&
    shouldSplitStickerMediaFromText(attributes)
  );
}

function shouldSplitStickerMediaFromText(attributes: Record<string, string | undefined>) {
  const width = parseForumImageDimension(forumImageAttributeValue(attributes, 'width'));
  const height = parseForumImageDimension(forumImageAttributeValue(attributes, 'height'));
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
    if (!isForumStickerImage(forumImageAttributesFromText(attributesText))) return match;
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
      const attributes = forumImageAttributesFromText(attributesText);
      if (!isForumStickerImage(attributes)) return match;
      const label =
        forumImageAttributeValue(attributes, 'alt') ||
        forumImageAttributeValue(attributes, 'title') ||
        forumImageAttributeValue(attributes, 'src') ||
        'sticker';
      const rowAttributes = stickerRowAttributesText(attributesText);
      return `<${FORUM_STICKER_TAG}${rowAttributes ? ` ${rowAttributes}` : ''}>${escapeHtmlFully(label)}</${FORUM_STICKER_TAG}>`;
    });
}

function stickerImageHtml(attributesText: string, attributes: Record<string, string | undefined>) {
  const label =
    forumImageAttributeValue(attributes, 'alt') ||
    forumImageAttributeValue(attributes, 'title') ||
    forumImageAttributeValue(attributes, 'src') ||
    'sticker';
  const clean = attributesText
    .trim()
    .replace(/\/\s*$/, '')
    .trim();
  return `<${FORUM_STICKER_TAG}${clean ? ` ${clean}` : ''}>${escapeHtmlFully(label)}</${FORUM_STICKER_TAG}>`;
}

function inlineMixedStickerMediaHtml(html: string) {
  return html.replace(FORUM_VIDEO_STICKER_ELEMENT_PATTERN, (match, attributesText: string) => {
    const attributes = forumImageAttributesFromText(attributesText);
    const fallbackSrc = forumImageAttributeValue(attributes, 'data-fallback-src');
    if (!fallbackSrc) return match;
    const label =
      forumImageAttributeValue(attributes, 'alt') ||
      forumImageAttributeValue(attributes, 'title') ||
      fallbackSrc ||
      'sticker';
    return `<${FORUM_STICKER_TAG} ${stickerFallbackAttributesText(attributes, fallbackSrc)}>${escapeHtmlFully(label)}</${FORUM_STICKER_TAG}>`;
  });
}

function stickerFallbackAttributesText(attributes: Record<string, string | undefined>, src: string) {
  const names = ['class', 'alt', 'title', 'width', 'height', 'referrerpolicy'];
  return [
    `src="${escapeHtmlFully(src)}"`,
    ...names.map((name) => {
      const value = forumImageAttributeValue(attributes, name);
      return value ? `${name}="${escapeHtmlFully(value)}"` : '';
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
  if (new RegExp(`(^|\\s)${STICKER_ROW_ATTR}\\s*=`, 'i').test(clean)) return clean;
  return [clean, `${STICKER_ROW_ATTR}="true"`].filter(Boolean).join(' ');
}

function directChildImages(container: { childNodes?: unknown[] }) {
  return (container.childNodes || []).filter(
    (child): child is ParsedForumImageNode => forumImageTagName(child) === 'img'
  );
}

function isInsideLightboxImage(
  image: { parentNode?: unknown; parent?: unknown },
  resolveNodeAttributes: ForumImageNodeAttributeResolver = forumImageNodeAttributes
) {
  let current = image.parentNode || image.parent;
  while (current && typeof current === 'object') {
    const element = current as ParsedForumImageNode;
    const tagName = forumImageTagName(element);
    const className = String(element.classNames || resolveNodeAttributes(element).class || '');
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

export function knownForumStickerSourceDimensions(
  attributes: Record<string, string | undefined>,
  resolveImageUrl: ForumImageUrlResolver = analyzeForumImageUrl
) {
  const path =
    nodeSeekStaticImagePath(forumImageAttributeValue(attributes, 'src'), resolveImageUrl) ||
    nodeSeekStaticImagePath(forumImageAttributeValue(attributes, 'data-fallback-src'), resolveImageUrl);
  if (!path) return null;
  if (/^\/static\/image\/sticker\/ac\//i.test(path)) return { width: 150, height: 130 };
  if (/^\/static\/image\/sticker\/emoji\//i.test(path)) return { width: 100, height: 100 };
  if (/^\/static\/image\/smiley\/xhj\d{3}\.(?:png|gif|webp|apng)$/i.test(path)) return { width: 120, height: 99 };
  return null;
}

function nodeSeekStaticImagePath(value: string, resolveImageUrl: ForumImageUrlResolver) {
  const analysis = resolveImageUrl(value);
  if (!analysis.normalized) return '';
  if (isNodeSeekHost(analysis.hostname)) {
    return analysis.pathname;
  }
  return !analysis.hostname && analysis.pathname.startsWith('/static/image/') ? analysis.pathname : '';
}

function isForumEmojiLabel(value: string) {
  return /^:[a-z0-9_+.-]+:$/i.test(value) || isForumStickerLabel(value);
}

function isForumStickerLabel(value: string) {
  return /^xhj\d{3}$/i.test(value.trim());
}

export function isInlineForumImageUrl(url: string) {
  return analyzeForumImageUrl(url).inline;
}
