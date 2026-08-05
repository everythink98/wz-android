import { describe, expect, it } from '@jest/globals';
import { HTMLContentModel } from 'react-native-render-html';
import { FORUM_STICKER_TAG } from '@/platform/media/inlineMedia';
import { HTML_CUSTOM_ELEMENT_MODELS } from '@/features/topic/rendering/htmlElementModels';

describe('topic HTML element models', () => {
  it('[REG-TOPIC-066] keeps full-size stickers out of native text-line layout', () => {
    expect(HTML_CUSTOM_ELEMENT_MODELS[FORUM_STICKER_TAG].contentModel).toBe(HTMLContentModel.block);
  });
});
