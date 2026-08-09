import { describe, expect, it, vi } from 'vitest';
import { HTMLContentModel } from 'react-native-render-html';
import { FORUM_STICKER_TAG } from '@/domain/forum/forumContentMedia';
import { HTML_CUSTOM_ELEMENT_MODELS } from './htmlElementModels';

vi.mock('react-native-render-html', () => {
  const extend = (model: unknown) => model;
  return {
    HTMLContentModel: { block: 'block', mixed: 'mixed', textual: 'textual' },
    HTMLElementModel: { fromCustomModel: (model: unknown) => model },
    defaultHTMLElementModels: { details: { extend }, summary: { extend } }
  };
});

describe('topic HTML element models', () => {
  it('[REG-TOPIC-066] keeps full-size stickers out of native text-line layout', () => {
    expect(HTML_CUSTOM_ELEMENT_MODELS[FORUM_STICKER_TAG].contentModel).toBe(HTMLContentModel.block);
  });
});
