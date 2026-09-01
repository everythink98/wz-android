import { TRenderEngine, type TNode } from '@native-html/transient-render-engine';
import { describe, expect, it, vi } from 'vitest';

import { FORUM_MATH_BLOCK_TAG, FORUM_MATH_INLINE_TAG } from '@/domain/forum/html';
import { forumMathSource } from './forumMathSource';
import { createHtmlCustomElementModels } from './htmlElementModels';

vi.mock('react-native-render-html', async () => vi.importActual('@native-html/transient-render-engine'));

function allNodes(node: TNode): TNode[] {
  return [node, ...node.children.flatMap(allNodes)];
}

describe('forum formula renderer source', () => {
  it('reads TeX from the real opaque RNRH block and textual node shapes', () => {
    const engine = new TRenderEngine({
      customizeHTMLModels(models) {
        return { ...models, ...createHtmlCustomElementModels('standard') };
      }
    });
    const nodes = allNodes(
      engine.buildTTree(
        `<${FORUM_MATH_BLOCK_TAG}>x^2 + y^2</${FORUM_MATH_BLOCK_TAG}>` +
          `<p>before <${FORUM_MATH_INLINE_TAG}>z^2</${FORUM_MATH_INLINE_TAG}> after</p>`
      )
    );
    const block = nodes.find((node) => node.tagName === FORUM_MATH_BLOCK_TAG);
    const inline = nodes.find((node) => node.tagName === FORUM_MATH_INLINE_TAG);

    expect(block?.children).toHaveLength(0);
    expect(forumMathSource(block!)).toBe('x^2 + y^2');
    expect(forumMathSource(inline!)).toBe('z^2');
  });
});
