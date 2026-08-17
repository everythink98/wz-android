import { describe, expect, it } from 'vitest';
import { HTMLContentModel, HTMLElementModel, TRenderEngine, type TNode } from '@native-html/transient-render-engine';
import { parseHtml } from './html';
import { INLINE_FORUM_IMAGE_TAG } from './forumContentMedia';
import { compileForumContent, resolveForumContentRowHtml } from './topicContentSplit';

function renderedRow(html: string) {
  const row = compileForumContent({ html, role: 'reply', source: 'v2ex' }).rows.find(
    (candidate) => candidate.type === 'richText'
  );
  expect(row?.type).toBe('richText');
  if (!row || row.type !== 'richText') throw new Error('Expected a rendered HTML row.');
  return row;
}

function allTNodes(root: TNode) {
  const result: TNode[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    result.push(current);
    pending.push(...current.children);
  }
  return result;
}

function metrics(html: string) {
  const body = parseHtml(`<body>${html}</body>`).querySelector('body');
  const pending = (body?.childNodes || []).map((node) => ({ depth: 1, node }));
  let depth = 0;
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    nodes += 1;
    depth = Math.max(depth, current.depth);
    pending.push(...(current.node.childNodes || []).map((node) => ({ depth: current.depth + 1, node })));
  }
  const media = body?.querySelectorAll(`img, ${INLINE_FORUM_IMAGE_TAG}`).length || 0;
  return { chars: html.length, depth, media, nodes };
}

describe('render-ready dynamic forum image variants', () => {
  const engine = new TRenderEngine({
    customizeHTMLModels(models) {
      return {
        ...models,
        [INLINE_FORUM_IMAGE_TAG]: HTMLElementModel.fromCustomModel({
          tagName: INLINE_FORUM_IMAGE_TAG,
          contentModel: HTMLContentModel.textual,
          isOpaque: true
        })
      };
    }
  });

  it('[REG-PERF-010] fixes the RNRH content model before TTree generation for unknown and learned sizes', () => {
    const url = 'https://i.imgur.com/dynamic.png';
    const row = renderedRow(`<p>before <img class="embedded_image" src="${url}" alt="dynamic"> after</p>`);
    const unknownHtml = resolveForumContentRowHtml(row, {});
    const learnedHtml = resolveForumContentRowHtml(row, { [url]: true });
    const unknownNodes = allTNodes(engine.buildTTree(unknownHtml));
    const learnedNodes = allTNodes(engine.buildTTree(learnedHtml));
    const unknownImage = unknownNodes.find((node) => node.tagName === 'img');
    const learnedImage = learnedNodes.find((node) => node.tagName === INLINE_FORUM_IMAGE_TAG);

    expect(unknownImage?.type).toBe('block');
    expect(learnedImage?.type).toBe('text');
    expect(learnedImage?.parent?.tagName).toBe('p');
    expect(learnedHtml.indexOf('before')).toBeLessThan(learnedHtml.indexOf(`<${INLINE_FORUM_IMAGE_TAG}`));
    expect(learnedHtml.indexOf(`</${INLINE_FORUM_IMAGE_TAG}>`)).toBeLessThan(learnedHtml.indexOf('after'));
    expect(unknownHtml).not.toContain('data-wz-dynamic-inline-image');
    expect(learnedHtml).not.toContain('data-wz-dynamic-inline-image');
  });

  it('[REG-PERF-010] resolves every bounded four-image presentation state', () => {
    const urls = Array.from({ length: 4 }, (_, index) => `https://i.imgur.com/bounded-${index}.png`);
    const row = renderedRow(
      `<p>${urls
        .map((url, index) => `before-${index}<img class="embedded_image" src="${url}" alt="dynamic-${index}">`)
        .join('')}after</p>`
    );
    const variants = Array.from({ length: 16 }, (_, mask) =>
      resolveForumContentRowHtml(
        row,
        Object.fromEntries(urls.flatMap((url, index) => (mask & (1 << index) ? [[url, true]] : [])))
      )
    );

    expect(row.rendering).not.toHaveProperty('variants');
    expect(new Set(variants)).toHaveLength(16);
    variants.forEach((html) => {
      const variantMetrics = metrics(html);
      expect(variantMetrics.chars).toBeLessThanOrEqual(16_384);
      expect(variantMetrics.depth).toBeLessThanOrEqual(64);
      expect(variantMetrics.media).toBeLessThanOrEqual(4);
      expect(variantMetrics.nodes).toBeLessThanOrEqual(80);
    });
  });

  it('[REG-PERF-010] keeps the compiled presentation variants in raw source order', () => {
    const urls = ['https://i.imgur.com/first.png', 'https://i.imgur.com/second.png'];
    const rawHtml = `<p>${urls.map((url) => `<img class="embedded_image" src="${url}">`).join('')}</p>`;
    const row = renderedRow(rawHtml);
    const resolved = resolveForumContentRowHtml(row, { [urls[0]]: true });

    expect(resolved).toContain(`<${INLINE_FORUM_IMAGE_TAG}`);
    expect(resolved.indexOf(urls[0])).toBeLessThan(resolved.indexOf(urls[1]));
  });

  it('[REG-TOPIC-078] resolves duplicate URLs independently by their final Referer identity', () => {
    const url = 'https://i.imgur.com/shared-policy.png';
    const row = renderedRow(
      `<p><img class="embedded_image" src="${url}" referrerpolicy="no-referrer"><img class="embedded_image" src="${url}" referrerpolicy="origin"></p>`
    );
    const noReferrerIdentity = `${url}\u0000referrer:none`;
    const resolved = resolveForumContentRowHtml(row, { [noReferrerIdentity]: true }, (src, policy, identities) =>
      Boolean(identities[`${src}\u0000referrer:${policy === 'no-referrer' ? 'none' : 'origin'}`])
    );

    expect(resolved.match(new RegExp(`<${INLINE_FORUM_IMAGE_TAG}\\b`, 'g'))).toHaveLength(1);
    expect(resolved.match(/<img\b/g)).toHaveLength(1);
    expect(resolved).toContain('referrerpolicy="no-referrer"');
    expect(resolved).toContain('referrerpolicy="origin"');
  });
});
