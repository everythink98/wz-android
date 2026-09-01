import { TRenderEngine, type TNode } from '@native-html/transient-render-engine';
import { describe, expect, it, vi } from 'vitest';
import { HTMLContentModel } from 'react-native-render-html';
import { FORUM_STICKER_TAG } from '@/domain/forum/forumContentMedia';
import { FORUM_AUDIO_TAG } from '@/domain/forum/html';
import { createHtmlCustomElementModels } from './htmlElementModels';

vi.mock('react-native-render-html', async () => vi.importActual('@native-html/transient-render-engine'));

function renderedText(node: TNode): string {
  return node.type === 'text' ? node.data : node.children.map(renderedText).join('');
}

function nodesWithTag(node: TNode, tagName: string): TNode[] {
  return [node, ...node.children.flatMap((child) => nodesWithTag(child, tagName))].filter(
    (candidate) => candidate.tagName === tagName
  );
}

describe('topic HTML element models', () => {
  it('keeps full-size stickers out of native text-line layout', () => {
    expect(createHtmlCustomElementModels('standard')[FORUM_STICKER_TAG].contentModel).toBe(HTMLContentModel.block);
  });

  it('keeps native audio as one opaque block island', () => {
    expect(createHtmlCustomElementModels('standard')[FORUM_AUDIO_TAG]).toMatchObject({
      contentModel: HTMLContentModel.block,
      isOpaque: true
    });
  });

  it('keeps legacy font-tagged topic text in the rendered reading order', () => {
    const engine = new TRenderEngine({
      customizeHTMLModels(models) {
        return { ...models, ...createHtmlCustomElementModels('standard') };
      }
    });
    const tree = engine.buildTTree(
      '<p>开始<font size="5"><b>前言</b></font>' +
        '<font color="magenta">将严格控制灌水！</font>' +
        '<font size="5"><b>一、免责条款</b></font>结束</p>'
    );

    expect(renderedText(tree)).toBe('开始前言将严格控制灌水！一、免责条款结束');
  });

  it('keeps legacy font size and color in rendered styles', () => {
    const engine = new TRenderEngine({
      cssProcessorConfig: {
        inlinePropertiesWhitelist: ['color', 'fontWeight', 'fontStyle', 'textAlign', 'textDecorationLine']
      },
      customizeHTMLModels(models) {
        return { ...models, ...createHtmlCustomElementModels('standard') };
      },
      stylesConfig: { baseStyle: { fontSize: 16 }, enableUserAgentStyles: true }
    });
    const tree = engine.buildTTree(
      '<p><font size="5">前言</font><font size="6">论坛总规则</font>' +
        '<font size="99" color="magenta">将严格控制灌水！</font>' +
        '<font color="darkgreen">新规则</font><font color="darkred">版规说明</font></p>'
    );
    const fontNodes = nodesWithTag(tree, 'font');

    expect(fontNodes.map((node) => node.attributes)).toEqual([
      { size: '5' },
      { size: '6' },
      { size: '99', color: 'magenta' },
      { color: 'darkgreen' },
      { color: 'darkred' }
    ]);
    expect(fontNodes.map((node) => node.getNativeStyles())).toEqual([
      expect.objectContaining({ fontSize: 24, lineHeight: 36 }),
      expect.objectContaining({ fontSize: 32, lineHeight: 48 }),
      expect.objectContaining({ color: 'magenta' }),
      expect.objectContaining({ color: 'darkgreen' }),
      expect.objectContaining({ color: 'darkred' })
    ]);
  });

  it.each([
    ['compact', 33.6, 44.8],
    ['standard', 36, 48],
    ['loose', 40.8, 54.4]
  ] as const)('scales legacy font line height with %s reading spacing', (lineHeight, size5, size6) => {
    const engine = new TRenderEngine({
      customizeHTMLModels(models) {
        return { ...models, ...createHtmlCustomElementModels(lineHeight) };
      },
      stylesConfig: { baseStyle: { fontSize: 16 }, enableUserAgentStyles: true }
    });
    const tree = engine.buildTTree('<p><font size="5">前言</font><font size="6">论坛总规则</font></p>');

    expect(nodesWithTag(tree, 'font').map((node) => node.getNativeStyles())).toEqual([
      expect.objectContaining({ fontSize: 24, lineHeight: size5 }),
      expect.objectContaining({ fontSize: 32, lineHeight: size6 })
    ]);
  });
});
