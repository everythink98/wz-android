import { HTMLContentModel, HTMLElementModel, defaultHTMLElementModels } from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { INLINE_FORUM_IMAGE_TAG } from '@/domain/forum/forumContentMedia';
import {
  FORUM_AUDIO_TAG,
  FORUM_LINK_CARD_TAG,
  FORUM_MATH_BLOCK_TAG,
  FORUM_MATH_INLINE_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG
} from '@/domain/forum/html';
import { FORUM_REPLY_REFERENCE_TAG } from '@/domain/forum/topicContentHtml';
import { NODESEEK_STARDUST_PLACEHOLDER_TAG } from '@/sources/nodeseek/stardustMarkup';
import { FORUM_STICKER_ELEMENT_MODELS } from '@/ui/content/forumStickerElementModels';
import { lineHeightMultiplier } from '@/ui/theme/tokens';

const LEGACY_FONT_SIZE_FACTORS = [undefined, 0.625, 0.8125, 1, 1.125, 1.5, 2, 3] as const;

export function createHtmlCustomElementModels(lineHeight: ReaderSettings['lineHeight']) {
  const legacyFontLineHeight = lineHeightMultiplier(lineHeight);
  return {
    details: defaultHTMLElementModels.details.extend({
      contentModel: HTMLContentModel.mixed
    }),
    summary: defaultHTMLElementModels.summary.extend({
      contentModel: HTMLContentModel.mixed
    }),
    font: HTMLElementModel.fromCustomModel({
      tagName: 'font',
      contentModel: HTMLContentModel.textual,
      getMixedUAStyles({ attributes }) {
        const size = attributes.size?.trim() || '';
        const color = attributes.color?.trim();
        const fontSizeFactor = /^[1-7]$/.test(size) ? LEGACY_FONT_SIZE_FACTORS[Number(size)] : undefined;
        return {
          ...(color ? { color } : {}),
          ...(fontSizeFactor
            ? {
                fontSize: `${fontSizeFactor}em`,
                // RNRH parses relative line-height at runtime, but its public type only exposes RN's numeric form.
                lineHeight: `${Number((fontSizeFactor * legacyFontLineHeight).toFixed(4))}em` as unknown as number
              }
            : {})
        };
      }
    }),
    [INLINE_FORUM_IMAGE_TAG]: HTMLElementModel.fromCustomModel({
      tagName: INLINE_FORUM_IMAGE_TAG,
      contentModel: HTMLContentModel.textual,
      isOpaque: true
    }),
    ...FORUM_STICKER_ELEMENT_MODELS,
    [FORUM_REPLY_REFERENCE_TAG]: HTMLElementModel.fromCustomModel({
      tagName: FORUM_REPLY_REFERENCE_TAG,
      contentModel: HTMLContentModel.block,
      isOpaque: true
    }),
    [NODESEEK_STARDUST_PLACEHOLDER_TAG]: HTMLElementModel.fromCustomModel({
      tagName: NODESEEK_STARDUST_PLACEHOLDER_TAG,
      contentModel: HTMLContentModel.block,
      isOpaque: true
    }),
    [FORUM_LINK_CARD_TAG]: HTMLElementModel.fromCustomModel({
      tagName: FORUM_LINK_CARD_TAG,
      contentModel: HTMLContentModel.block,
      isOpaque: true
    }),
    [FORUM_MATH_BLOCK_TAG]: HTMLElementModel.fromCustomModel({
      tagName: FORUM_MATH_BLOCK_TAG,
      contentModel: HTMLContentModel.block,
      isOpaque: true
    }),
    [FORUM_MATH_INLINE_TAG]: HTMLElementModel.fromCustomModel({
      tagName: FORUM_MATH_INLINE_TAG,
      contentModel: HTMLContentModel.textual,
      isOpaque: true
    }),
    [FORUM_AUDIO_TAG]: HTMLElementModel.fromCustomModel({
      tagName: FORUM_AUDIO_TAG,
      contentModel: HTMLContentModel.block,
      isOpaque: true
    }),
    [FORUM_VIDEO_STICKER_TAG]: HTMLElementModel.fromCustomModel({
      tagName: FORUM_VIDEO_STICKER_TAG,
      contentModel: HTMLContentModel.block,
      isOpaque: true
    }),
    [FORUM_VIDEO_TAG]: HTMLElementModel.fromCustomModel({
      tagName: FORUM_VIDEO_TAG,
      contentModel: HTMLContentModel.block,
      isOpaque: true
    }),
    iframe: HTMLElementModel.fromCustomModel({
      tagName: 'iframe',
      contentModel: HTMLContentModel.block,
      isOpaque: true
    })
  };
}
