import { HTMLContentModel, HTMLElementModel, defaultHTMLElementModels } from 'react-native-render-html';
import {
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG,
  INLINE_FORUM_IMAGE_TAG
} from '@/platform/media/inlineMedia';
import {
  FORUM_LINK_CARD_TAG,
  FORUM_TERMINAL_REPORT_TAG,
  FORUM_TERMINAL_TAB_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG
} from '@/domain/forum/html';
import { FORUM_REPLY_REFERENCE_TAG } from '@/domain/forum/topicContentHtml';
import { NODESEEK_POLL_PLACEHOLDER_TAG } from '@/sources/nodeseek/polls';

export const HTML_CUSTOM_ELEMENT_MODELS = {
  details: defaultHTMLElementModels.details.extend({
    contentModel: HTMLContentModel.mixed
  }),
  summary: defaultHTMLElementModels.summary.extend({
    contentModel: HTMLContentModel.mixed
  }),
  [INLINE_FORUM_IMAGE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: INLINE_FORUM_IMAGE_TAG,
    contentModel: HTMLContentModel.textual,
    isOpaque: true
  }),
  [FORUM_STICKER_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_STICKER_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: true
  }),
  [FORUM_STICKER_ROW_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_STICKER_ROW_TAG,
    contentModel: HTMLContentModel.mixed,
    isOpaque: false
  }),
  [FORUM_INLINE_MEDIA_LINE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_INLINE_MEDIA_LINE_TAG,
    contentModel: HTMLContentModel.mixed,
    isOpaque: false
  }),
  [FORUM_REPLY_REFERENCE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_REPLY_REFERENCE_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: true
  }),
  [NODESEEK_POLL_PLACEHOLDER_TAG]: HTMLElementModel.fromCustomModel({
    tagName: NODESEEK_POLL_PLACEHOLDER_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: true
  }),
  [FORUM_LINK_CARD_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_LINK_CARD_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: true
  }),
  [FORUM_TERMINAL_REPORT_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_TERMINAL_REPORT_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: false
  }),
  [FORUM_TERMINAL_TAB_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_TERMINAL_TAB_TAG,
    contentModel: HTMLContentModel.block,
    isOpaque: false
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
