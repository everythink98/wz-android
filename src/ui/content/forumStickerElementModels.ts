import { HTMLContentModel, HTMLElementModel } from 'react-native-render-html';
import {
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG
} from '@/domain/forum/forumContentMedia';

export const FORUM_STICKER_ELEMENT_MODELS = {
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
  })
};
