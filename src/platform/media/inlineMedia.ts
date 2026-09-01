import {
  INLINE_EMOJI_MAX_SIZE,
  forumImageAttributeValue as attributeValue,
  isBoundedInlineForumImage,
  isForumStickerImage as isForumStickerImageAttributes,
  isInlineForumImage as isInlineForumImageAttributes,
  knownForumStickerSourceDimensions,
  parseForumImageDimension as parseImageDimension
} from '@/domain/forum/forumContentMedia';
import type { ImageDisplaySize } from './imagePreviewCatalog';

const STICKER_ROW_ATTR = 'data-forum-sticker-row';
const INLINE_STICKER_DEFAULT_SIZE = 48;
const INLINE_STICKER_MAX_SIZE = 64;
const STICKER_ROW_DEFAULT_SIZE = 100;
const STICKER_ROW_MAX_SIZE = 160;
const STICKER_ROW_CONTENT_WIDTH_RATIO = 0.55;
const STICKER_DISPLAY_MAX_SIZE = 100;
const INLINE_ATTACHMENT_HORIZONTAL_INSET = 2;
const BOUNDED_INLINE_IMAGE_MAX_SIZE = 100;

export function inlineForumImageDisplaySize(
  attributes: Record<string, string | undefined>,
  scale = 1,
  contentWidth = 0,
  naturalDimensions?: ImageDisplaySize
) {
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const isSticker = isForumStickerImageAttributes(attributes);
  const isSemanticInlineImage = isInlineForumImageAttributes(attributes);
  const isBoundedInlineImage = isBoundedInlineForumImage(attributes);
  const isStickerRow = /^true$/i.test(attributeValue(attributes, STICKER_ROW_ATTR));
  const naturalWidth = safeImageDimension(naturalDimensions?.width || 0);
  const naturalHeight = safeImageDimension(naturalDimensions?.height || 0);
  const hasNaturalDimensions = naturalWidth > 0 && naturalHeight > 0;
  if (!isSticker && (!isSemanticInlineImage || isBoundedInlineImage)) {
    let displayWidth =
      width ||
      (height && hasNaturalDimensions ? (height * naturalWidth) / naturalHeight : 0) ||
      naturalWidth ||
      height ||
      (isBoundedInlineImage ? BOUNDED_INLINE_IMAGE_MAX_SIZE : 20);
    let displayHeight =
      height ||
      (width && hasNaturalDimensions ? (width * naturalHeight) / naturalWidth : 0) ||
      naturalHeight ||
      width ||
      (isBoundedInlineImage ? BOUNDED_INLINE_IMAGE_MAX_SIZE : 20);
    const contentMaxWidth = Number.isFinite(contentWidth) && contentWidth > 4 ? contentWidth - 4 : displayWidth;
    const maxWidth = isBoundedInlineImage ? Math.min(BOUNDED_INLINE_IMAGE_MAX_SIZE, contentMaxWidth) : contentMaxWidth;
    if (displayWidth > maxWidth) {
      const ratio = maxWidth / displayWidth;
      displayWidth *= ratio;
      displayHeight *= ratio;
    }
    const maxDimension = Math.max(displayWidth, displayHeight);
    if (isBoundedInlineImage && maxDimension > BOUNDED_INLINE_IMAGE_MAX_SIZE) {
      const ratio = BOUNDED_INLINE_IMAGE_MAX_SIZE / maxDimension;
      displayWidth *= ratio;
      displayHeight *= ratio;
    }
    return { width: Math.max(1, Math.round(displayWidth)), height: Math.max(1, Math.round(displayHeight)) };
  }
  const usesNaturalDimensions = !width && !height && hasNaturalDimensions;
  const knownDimensions =
    hasNaturalDimensions && (!width || !height)
      ? { width: naturalWidth, height: naturalHeight }
      : knownForumStickerSourceDimensions(attributes);
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
      : usesNaturalDimensions
        ? STICKER_DISPLAY_MAX_SIZE
        : INLINE_STICKER_MAX_SIZE
    : isSemanticInlineImage
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
  const scaledMaxDimension = Math.max(displayWidth, displayHeight);
  if (usesNaturalDimensions && scaledMaxDimension > STICKER_DISPLAY_MAX_SIZE) {
    const ratio = STICKER_DISPLAY_MAX_SIZE / scaledMaxDimension;
    displayWidth *= ratio;
    displayHeight *= ratio;
  }
  if (isStickerRow && Number.isFinite(contentWidth) && contentWidth > 0) {
    const rowMaxSize = Math.max(64, contentWidth * STICKER_ROW_CONTENT_WIDTH_RATIO);
    const rowMaxDimension = Math.min(STICKER_DISPLAY_MAX_SIZE, rowMaxSize);
    const rowDimension = Math.max(displayWidth, displayHeight);
    if (rowDimension > rowMaxDimension) {
      const ratio = rowMaxDimension / rowDimension;
      displayWidth *= ratio;
      displayHeight *= ratio;
    }
  }
  return { width: Math.round(displayWidth), height: Math.round(displayHeight) };
}

export function inlineForumImageAttachmentSize(
  attributes: Record<string, string | undefined>,
  scale = 1,
  contentWidth = 0,
  naturalDimensions?: ImageDisplaySize
) {
  const displaySize = inlineForumImageDisplaySize(attributes, scale, contentWidth, naturalDimensions);
  return {
    height: displaySize.height,
    width: displaySize.width + INLINE_ATTACHMENT_HORIZONTAL_INSET * 2
  };
}

export function inlineForumImageAlignmentStyle(
  attributes: Record<string, string | undefined>,
  scale = 1,
  lineHeight = 0
) {
  if (!isInlineForumImageAttributes(attributes)) return {};
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

function safeImageDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeImageScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
