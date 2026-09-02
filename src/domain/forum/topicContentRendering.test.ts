import { describe, expect, it } from 'vitest';
import { HTMLContentModel, HTMLElementModel, TRenderEngine, type TNode } from '@native-html/transient-render-engine';
import { parseHtml } from './html';
import { FORUM_INLINE_MEDIA_LINE_TAG, INLINE_FORUM_IMAGE_TAG } from './forumContentMedia';
import { compileForumContent } from './topicContentSplit';

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

function renderedLogicalOwners(root: TNode) {
  const owners: string[] = [];
  const ownerText = (node: TNode): string => {
    if (node.tagName === INLINE_FORUM_IMAGE_TAG) return '';
    if (node.tagName === 'br') return '\n';
    if (node.type === 'text') return node.data;
    return node.children.map(ownerText).join('');
  };
  const visit = (node: TNode) => {
    if (node.tagName === FORUM_INLINE_MEDIA_LINE_TAG) {
      const text = ownerText(node);
      if (text) owners.push(text);
      return;
    }
    if (node.type === 'phrasing') {
      const text = ownerText(node);
      if (text) owners.push(text);
      return;
    }
    node.children.forEach(visit);
  };
  visit(root);
  return owners;
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

describe('render-ready forum image placement', () => {
  const engine = new TRenderEngine({
    customizeHTMLModels(models) {
      return {
        ...models,
        [INLINE_FORUM_IMAGE_TAG]: HTMLElementModel.fromCustomModel({
          tagName: INLINE_FORUM_IMAGE_TAG,
          contentModel: HTMLContentModel.textual,
          isOpaque: true
        }),
        [FORUM_INLINE_MEDIA_LINE_TAG]: HTMLElementModel.fromCustomModel({
          tagName: FORUM_INLINE_MEDIA_LINE_TAG,
          contentModel: HTMLContentModel.mixed,
          isOpaque: false
        })
      };
    }
  });

  it('keeps mixed images textual and projects standalone author lines through the block image owner', () => {
    const url = 'https://i.imgur.com/dynamic.png';
    const flowRow = renderedRow(`<p>before <img class="embedded_image" src="${url}" alt="dynamic"> after</p>`);
    const standaloneRow = renderedRow(`<p><img class="embedded_image" src="${url}" alt="dynamic"></p>`);
    const attachmentRow = renderedRow(
      `<figure><img class="embedded_image" src="${url}" alt="dynamic"><figcaption>caption</figcaption></figure>`
    );
    const flowHtml = flowRow.html;
    const standaloneHtml = standaloneRow.html;
    const attachmentHtml = attachmentRow.html;
    const flowImage = allTNodes(engine.buildTTree(flowHtml)).find((node) => node.tagName === INLINE_FORUM_IMAGE_TAG);
    const standaloneImage = allTNodes(engine.buildTTree(standaloneHtml)).find((node) => node.tagName === 'img');
    const attachmentImage = allTNodes(engine.buildTTree(attachmentHtml)).find((node) => node.tagName === 'img');

    expect(flowImage?.type).toBe('text');
    expect(standaloneImage?.type).toBe('block');
    expect(attachmentImage?.type).toBe('block');
    expect(flowHtml).not.toContain(FORUM_INLINE_MEDIA_LINE_TAG);
    expect(standaloneHtml).not.toContain(FORUM_INLINE_MEDIA_LINE_TAG);
    expect(attachmentHtml).toContain('<figure>');
    expect(flowHtml.indexOf('before')).toBeLessThan(flowHtml.indexOf(`<${INLINE_FORUM_IMAGE_TAG}`));
    expect(flowHtml.indexOf(`</${INLINE_FORUM_IMAGE_TAG}>`)).toBeLessThan(flowHtml.indexOf('after'));
  });

  it('keeps image selection owners stable when natural dimensions become known', () => {
    const url = 'https://i.imgur.com/selection-owner.png';
    const row = renderedRow(`<p>before<img class="embedded_image" src="${url}" alt="dynamic">after</p>`);
    const token = JSON.parse(row.selectionToken) as {
      owners: { tape: { text: string }[]; text: string }[];
    };

    expect(token.owners).toEqual([
      expect.objectContaining({ tape: [expect.objectContaining({ text: 'dynamic' })], text: 'beforeafter' })
    ]);
  });

  it('matches RNRH normal-flow whitespace across links, media, and explicit breaks', () => {
    const url = 'https://i.imgur.com/selection-whitespace.png';
    const row = renderedRow(
      `<p>before \r\n <a href="#target">linked \r\n text</a> \r\n ` +
        `<img class="embedded_image" src="${url}" alt="dynamic"> \r\n after<br>\r\nnext&nbsp;  value</p>`
    );
    const token = JSON.parse(row.selectionToken) as {
      owners: { tape: { at: number; text: string }[]; text: string }[];
    };

    const flowImage = allTNodes(engine.buildTTree(row.html)).find((node) => node.tagName === INLINE_FORUM_IMAGE_TAG);
    expect(flowImage?.parent?.tagName).toBe('p');
    expect(row.html).not.toContain(FORUM_INLINE_MEDIA_LINE_TAG);
    expect(token.owners).toEqual([
      {
        tape: [expect.objectContaining({ at: 'before linked text '.length, text: 'dynamic' })],
        text: 'before linked text  after\nnext\u00a0 value',
        trailing: [{ kind: 'separator', text: '\n' }]
      }
    ]);
  });

  it('keeps one explicit break before text and collapses a trailing break', () => {
    const row = renderedRow('<p>A<br>\r\n</p><p>B<br>\r\nC</p>');
    const token = JSON.parse(row.selectionToken) as { owners: { text: string }[] };

    expect(token.owners.map((owner) => owner.text)).toEqual(['A', 'B\nC']);
  });

  it('matches RNRH when a nested phrasing container ends with a collapsed break', () => {
    const row = renderedRow('<p>A<span>B<br></span>C</p>');
    const token = JSON.parse(row.selectionToken) as { owners: { text: string }[] };

    expect(token.owners.map((owner) => owner.text)).toEqual(['ABC']);
  });

  it('preserves preformatted code whitespace', () => {
    const html = '<pre><code>A  \r\n B</code></pre>';
    const row = compileForumContent({ html, role: 'reply', source: 'v2ex' }).rows.find(
      (candidate) => candidate.type === 'codeBlock'
    );
    expect(row?.type).toBe('codeBlock');
    if (!row || row.type !== 'codeBlock') throw new Error('Expected a code row.');
    const token = JSON.parse(row.selectionToken) as { owners: { text: string }[] };
    const preformattedEngine = new TRenderEngine({ stylesConfig: { enableUserAgentStyles: true } });

    expect(token.owners.map((owner) => owner.text)).toEqual(renderedLogicalOwners(preformattedEngine.buildTTree(html)));
    expect(token.owners.map((owner) => owner.text)).toEqual(['A  \r\n B']);
  });

  it('keeps a bounded four-image presentation independent of natural-size state', () => {
    const urls = Array.from({ length: 4 }, (_, index) => `https://i.imgur.com/bounded-${index}.png`);
    const row = renderedRow(
      `<p>${urls
        .map((url, index) => `before-${index}<img class="embedded_image" src="${url}" alt="dynamic-${index}">`)
        .join('')}after</p>`
    );
    const rowMetrics = metrics(row.html);
    expect(rowMetrics.chars).toBeLessThanOrEqual(16_384);
    expect(rowMetrics.depth).toBeLessThanOrEqual(64);
    expect(rowMetrics.media).toBeLessThanOrEqual(4);
    expect(rowMetrics.nodes).toBeLessThanOrEqual(80);
  });

  it('keeps the compiled presentation in raw source order', () => {
    const urls = ['https://i.imgur.com/first.png', 'https://i.imgur.com/second.png'];
    const rawHtml = `<p>${urls.map((url) => `<img class="embedded_image" src="${url}">`).join('')}</p>`;
    const row = renderedRow(rawHtml);
    expect(row.html).toContain(`<${INLINE_FORUM_IMAGE_TAG}`);
    expect(row.html.indexOf(urls[0])).toBeLessThan(row.html.indexOf(urls[1]));
  });

  it('keeps duplicate URLs at their authored positions regardless of Referer identity', () => {
    const url = 'https://i.imgur.com/shared-policy.png';
    const row = renderedRow(
      `<p><img class="embedded_image" src="${url}" referrerpolicy="no-referrer"><img class="embedded_image" src="${url}" referrerpolicy="origin"></p>`
    );
    expect(row.html.match(new RegExp(`<${INLINE_FORUM_IMAGE_TAG}\\b`, 'g'))).toHaveLength(2);
    expect(row.html.match(/<img\b/g)).toBeNull();
    expect(row.html).toContain('referrerpolicy="no-referrer"');
    expect(row.html).toContain('referrerpolicy="origin"');
  });
});
