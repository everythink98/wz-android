import { describe, expect, it, vi } from 'vitest';
import { parseHtml } from './html';
import { domNodeCount } from '../../../tests/helpers/domNodeCount';
import { withTrackedParseHtml } from '../../../tests/helpers/trackedParseHtml';
import {
  compileForumContent,
  prepareReplyContent,
  prepareTopicContent,
  requirePreparedForumContent,
  type CompiledForumContent,
  type CompiledForumContentRow,
  type ForumContentAncestorFrame
} from './topicContentSplit';
import { topicOpeningPostAsReply } from './quotedPosts';

function renderedContentRows(compilation: Pick<CompiledForumContent, 'rows'>) {
  return compilation.rows.filter((row): row is Extract<CompiledForumContentRow, { html: string }> => 'html' in row);
}

function imageUrlsInPlannedRow(row: { html?: string }) {
  return parseHtml(row.html || '')
    .querySelectorAll('img')
    .map((image) => image.getAttribute('src'));
}

function planForumContent(html: string | undefined, source: 'linuxdo' | 'nodeseek' = 'nodeseek'): { rows: any[] } {
  const compilation = compileForumContent({ html, role: 'opening', source });
  return {
    rows: compilation.rows.flatMap<any>((row) => {
      if (row.type === 'poll' || row.type === 'quote') return [];
      const { type: _type, ...plannedRow } = row;
      if ('src' in plannedRow) {
        const { src: _src, ...htmlRow } = plannedRow;
        return [htmlRow];
      }
      return [plannedRow];
    })
  };
}

function logicalSliceForTag(
  row: CompiledForumContentRow,
  kind: 'blockquote' | 'callout' | 'details' | 'list' | 'listItem'
) {
  return row.ancestorFrames.find((frame) => frame.kind === kind);
}

function withoutCompilerBindings(html: string) {
  return html.replace(/\s+data-wz-node="[^"]*"/g, '');
}

function maxElementDepth(html: string) {
  const body = parseHtml(`<body>${html}</body>`).querySelector('body');
  type TestNode = { childNodes?: TestNode[] };
  const pending = (body?.childNodes || []).map((node) => ({ depth: 1, node: node as TestNode }));
  let maxDepth = 0;
  while (pending.length) {
    const current = pending.pop()!;
    maxDepth = Math.max(maxDepth, current.depth);
    const children = current.node.childNodes || [];
    children.forEach((node) => pending.push({ depth: current.depth + 1, node }));
  }
  return maxDepth;
}

function rawHtmlStructure(html: string) {
  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
  ]);
  const stack: string[] = [];
  const tagPattern = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;
  let domNodes = 0;
  let maxDepth = 0;
  let balanced = true;
  let consumedLength = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    if (html.slice(consumedLength, match.index).trim()) domNodes += 1;
    const tagName = match[1].toLowerCase();
    consumedLength = tagPattern.lastIndex;
    if (match[0].startsWith('</')) {
      if (stack.at(-1) !== tagName) {
        balanced = false;
      } else {
        stack.pop();
      }
      continue;
    }
    domNodes += 1;
    if (!voidTags.has(tagName) && !/\/\s*>$/.test(match[0])) {
      stack.push(tagName);
      maxDepth = Math.max(maxDepth, stack.length);
    }
  }
  if (html.slice(consumedLength).trim()) domNodes += 1;
  return { balanced: balanced && stack.length === 0, domNodes, maxDepth };
}

function parsedBalancedTable(html: string) {
  const root = parseHtml(html);
  const table = root.querySelector('table');
  expect(table).toBeTruthy();
  expect(table?.toString()).toBe(html);
  expect(table?.querySelectorAll('tbody')).toHaveLength(1);
  return table!;
}

describe('Android topic content splitting', () => {
  it('keeps pure block-image paragraphs in bounded rich-text rows', () => {
    const urls = Array.from({ length: 9 }, (_, index) => `https://img.example/${index}.webp`);
    const pure = compileForumContent({
      html: `<p>${urls.map((url) => `<img src="${url}" alt="image">`).join('')}</p>`,
      role: 'opening',
      source: 'nodeseek'
    });
    const mixed = compileForumContent({
      html: '<p>caption <img src="https://img.example/mixed.webp" alt="mixed"></p>',
      role: 'opening',
      source: 'nodeseek'
    });
    const lightbox = compileForumContent({
      html: '<p><a class="lightbox" href="https://img.example/original.webp"><img src="https://img.example/thumb.webp" alt="lightbox"></a></p>',
      role: 'opening',
      source: 'nodeseek'
    });

    expect(pure.rows.map((row) => row.type)).toEqual(['richText', 'richText', 'richText']);
    expect(pure.rows.flatMap((row) => ('html' in row ? urls.filter((url) => row.html.includes(url)) : []))).toEqual(
      urls
    );
    expect(pure.rows.map((row) => ('html' in row ? row.html.match(/<img\b/g)?.length || 0 : 0))).toEqual([4, 4, 1]);
    expect(pure.previewImages.map((image) => image.source)).toEqual(urls);
    expect(mixed.rows.map((row) => row.type)).toEqual(['richText']);
    expect(lightbox.rows).toEqual([
      expect.objectContaining({
        type: 'richText',
        html: expect.stringContaining('https://img.example/original.webp')
      })
    ]);
  });

  it('does not reuse an opening plan when the opening post becomes quoted reply content', () => {
    const contentHtml =
      '<aside class="quote" data-post="8" data-topic="77" data-username="bob"><div class="title">bob:</div><blockquote>preview</blockquote></aside>';
    const topic = prepareTopicContent({
      source: 'linuxdo',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://linux.do/t/topic/42',
      createdAt: '2026-08-15T00:00:00.000Z',
      contentHtml,
      replies: []
    });
    const openingPlan = requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
      role: 'opening',
      source: topic.source,
      topicId: topic.id
    });

    const quotedReply = prepareReplyContent(topicOpeningPostAsReply(topic), topic.source);
    const quotedPlan = requirePreparedForumContent(quotedReply.preparedContent, quotedReply.contentHtml, {
      role: 'reply',
      source: topic.source
    });

    expect(openingPlan.rows.map((row) => row.type)).toEqual(['quote']);
    expect(quotedReply.preparedContent).not.toBe(topic.preparedContent);
    expect(quotedPlan.rows.length).toBeGreaterThan(0);
    expect(quotedPlan.rows.every((row) => row.type === 'richText')).toBe(true);
  });

  it('compiles nested opening quotes and polls into ordered typed parent rows', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<section><p>before</p><div><aside class="quote" data-post="8" data-topic="77" data-username="bob"><div class="title">bob:</div><blockquote>preview</blockquote></aside></div><p>after</p></section>' +
      '<forum-discourse-poll name="choice"></forum-discourse-poll><p>end</p>';

    const compilation = compileForumContent({
      html,
      polls: [poll],
      role: 'opening',
      source: 'linuxdo',
      topicId: '77'
    });

    expect(compilation.rows.map((row) => row.type)).toEqual(['richText', 'quote', 'richText', 'poll', 'richText']);
    expect(compilation.rows[1]).toMatchObject({
      type: 'quote',
      quote: {
        author: { label: 'bob', username: 'bob' },
        preview: 'preview',
        reference: { postNumber: 8, source: 'linuxdo', topicId: '77' }
      }
    });
    expect(compilation.rows[3]).toEqual(expect.objectContaining({ poll, type: 'poll' }));
  });

  it('lifts a nested poll marker to its original parent-row position', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<section><p>before</p><div><forum-discourse-poll name="choice"></forum-discourse-poll></div><p>after</p></section>';

    const compilation = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' });

    expect(compilation.rows.map((row) => row.type)).toEqual(['richText', 'poll', 'richText']);
    expect(compilation.rows[0]?.type === 'richText' ? withoutCompilerBindings(compilation.rows[0].html) : '').toBe(
      '<div class="forum-reply-content"><section><p>before</p></section></div>'
    );
    expect(compilation.rows[1]).toMatchObject({ poll, type: 'poll' });
    expect(compilation.rows[2]?.type === 'richText' ? withoutCompilerBindings(compilation.rows[2].html) : '').toBe(
      '<div class="forum-reply-content"><section><p>after</p></section></div>'
    );
  });

  it('compiles NodeSeek opening and reply polls at their marker position', () => {
    const poll = { id: '3028', options: [{ id: 'a', label: 'A' }] };
    const html = '<p>投票前</p><forum-nodeseek-poll id="3028"></forum-nodeseek-poll><p>投票后</p>';

    for (const role of ['opening', 'reply'] as const) {
      const rows = compileForumContent({ html, polls: [poll], role, source: 'nodeseek' }).rows;

      expect(rows.map((row) => row.type)).toEqual(['richText', 'poll', 'richText']);
      expect(rows[1]).toMatchObject({ poll, type: 'poll' });
    }
  });

  it('preserves poll order when a typed marker appears inside a table cell', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<p>before</p><table><tbody><tr><td>cell-before<forum-discourse-poll name="choice"></forum-discourse-poll>cell-after</td></tr></tbody></table><p>end</p>';

    const compilation = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' });
    const orderedContent = compilation.rows.map((row) =>
      row.type === 'poll'
        ? 'POLL'
        : row.type === 'quote'
          ? 'QUOTE'
          : 'html' in row
            ? parseHtml(row.html).text
            : 'text' in row
              ? row.text
              : ''
    );

    expect(compilation.rows.map((row) => row.type)).toEqual(['richText', 'richText', 'poll', 'richText', 'richText']);
    expect(orderedContent).toEqual(['before', 'cell-before', 'POLL', 'cell-after', 'end']);
  });

  it('fail-closes an opaque island instead of moving its typed marker to the end', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<p>before</p><forum-link-card href="https://example.com"><span>island-before</span><forum-discourse-poll name="choice"></forum-discourse-poll><span>island-after</span></forum-link-card><p>after</p>';

    const compilation = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' });
    const orderedContent = compilation.rows.map((row) =>
      row.type === 'poll'
        ? 'POLL'
        : row.type === 'quote'
          ? 'QUOTE'
          : 'html' in row
            ? parseHtml(row.html).text
            : 'text' in row
              ? row.text
              : ''
    );

    expect(compilation.rows.map((row) => row.type)).toEqual(['richText', 'richText', 'poll', 'richText']);
    expect(orderedContent).toEqual(['before', '内容过于复杂，请在原站查看。', 'POLL', 'after']);
    expect(renderedContentRows(compilation).every((row) => !row.html.includes('forum-link-card'))).toBe(true);
  });

  it('preserves ancestor identity, disclosure, and ordered-list continuation around typed rows', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<details id="panel" name="shared" open><summary>Title</summary><ol id="steps" start="7"><li id="entry">before<forum-discourse-poll name="choice"></forum-discourse-poll>after</li><li>tail</li></ol></details>';

    const rows = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' }).rows;
    expect(rows.map((row) => row.type)).toEqual(['disclosureHeader', 'richText', 'poll', 'richText', 'richText']);
    expect(rows[0]).toMatchObject({
      defaultExpanded: true,
      disclosureKind: 'details',
      part: 'first',
      semanticId: 'node-0',
      titleLabel: 'Title'
    });
    expect(rows.slice(1).map((row) => row.ancestorFrames.map((frame) => `${frame.kind}:${frame.semanticId}`))).toEqual([
      ['details:node-0', 'list:node-0.1', 'listItem:node-0.1.0'],
      ['details:node-0', 'list:node-0.1', 'listItem:node-0.1.0'],
      ['details:node-0', 'list:node-0.1', 'listItem:node-0.1.0'],
      ['details:node-0', 'list:node-0.1', 'listItem:node-0.1.1']
    ]);
    expect(rows.flatMap((row) => ('html' in row ? [parseHtml(row.html).text] : [])).join('')).toContain(
      'beforeaftertail'
    );
    expect(rows.every((row) => !('html' in row) || !row.html.includes('data-wz-'))).toBe(true);
  });

  it('keeps one disclosure group when both sides of a typed row need further planning', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const images = (prefix: string) =>
      Array.from({ length: 5 }, (_, index) => `<img src="https://img.example/${prefix}-${index}.webp">`).join('');
    const html = `<details id="panel"><summary>Title</summary><p>${images(
      'before'
    )}</p><forum-discourse-poll name="choice"></forum-discourse-poll><p>${images('after')}</p></details>`;

    const rows = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' }).rows;
    expect(rows.map((row) => row.type)).toEqual([
      'disclosureHeader',
      'richText',
      'richText',
      'poll',
      'richText',
      'richText'
    ]);
    expect(rows[0]).toMatchObject({ defaultExpanded: false, semanticId: 'node-0', type: 'disclosureHeader' });
    expect(rows.slice(1).map((row) => row.ancestorFrames.find((frame) => frame.kind === 'details'))).toEqual([
      expect.objectContaining({ part: 'middle', semanticId: 'node-0' }),
      expect.objectContaining({ part: 'middle', semanticId: 'node-0' }),
      expect.objectContaining({ part: 'middle', semanticId: 'node-0' }),
      expect.objectContaining({ part: 'middle', semanticId: 'node-0' }),
      expect.objectContaining({ part: 'last', semanticId: 'node-0' })
    ]);
  });

  it('projects a native video with its poster and Referrer policy', () => {
    const compilation = compileForumContent({
      html: '<forum-video src="https://media.example/video.mp4" poster="https://media.example/poster.webp" referrerpolicy="no-referrer"></forum-video>',
      role: 'reply',
      source: 'yaohuo'
    });

    expect(compilation.rows).toEqual([
      expect.objectContaining({
        poster: 'https://media.example/poster.webp',
        referrerPolicy: 'no-referrer',
        src: 'https://media.example/video.mp4',
        type: 'video'
      })
    ]);
  });

  it('keeps native video rows ordered around a typed poll marker', () => {
    const poll = { name: 'choice', options: [{ id: 'yes', label: 'Yes' }] };
    const compilation = compileForumContent({
      html: '<forum-video src="https://media.example/before.mp4"></forum-video><forum-discourse-poll name="choice"></forum-discourse-poll><forum-video src="https://media.example/after.mp4"></forum-video>',
      polls: [poll],
      role: 'reply',
      source: 'linuxdo'
    });

    expect(compilation.rows.map((row) => row.type)).toEqual(['video', 'poll', 'video']);
    expect(compilation.rows.flatMap((row) => (row.type === 'video' ? [row.src] : []))).toEqual([
      'https://media.example/before.mp4',
      'https://media.example/after.mp4'
    ]);
  });

  it('keeps adjacent native videos as separate atomic semantic rows', () => {
    const compilation = compileForumContent({
      html: Array.from(
        { length: 5 },
        (_, index) => `<forum-video src="https://media.example/${index}.mp4"></forum-video>`
      ).join(''),
      role: 'opening',
      source: 'linuxdo'
    });

    expect(compilation.rows.map((row) => row.type)).toEqual(Array.from({ length: 5 }, () => 'video'));
    expect(compilation.rows.flatMap((row) => (row.type === 'video' ? [row.src] : []))).toEqual(
      Array.from({ length: 5 }, (_, index) => `https://media.example/${index}.mp4`)
    );
  });

  it('preserves 1000 alternating text and poll rows', () => {
    const poll = { name: 'choice', options: [{ id: 'yes', label: 'Yes' }] };
    const html = Array.from(
      { length: 1_000 },
      (_, index) => `<span>part-${index}</span><forum-discourse-poll name="choice"></forum-discourse-poll>`
    ).join('');

    const compilation = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' });

    expect(compilation.rows).toHaveLength(2_000);
    expect(compilation.rows.filter((row) => row.type === 'richText')).toHaveLength(1_000);
    expect(compilation.rows.filter((row) => row.type === 'poll')).toHaveLength(1_000);
  });

  it('bounds over-deep opening quote candidates', () => {
    const html = `${'<aside>'.repeat(1_000)}body${'</aside>'.repeat(1_000)}`;

    const compilation = compileForumContent({
      html,
      role: 'opening',
      source: 'linuxdo',
      topicId: '42'
    });
    const rows = renderedContentRows(compilation);

    expect(compilation.rows.every((row) => row.type === 'richText')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.every((row) => maxElementDepth(row.html) <= 64)).toBe(true);
  });

  it('keeps a 2000-image paragraph ordered while bounding every planned row', () => {
    const sourceUrls = Array.from({ length: 2000 }, (_, index) => `https://img.example/${index}.webp`);
    const html = `<p>${sourceUrls.map((src, index) => `<img src="${src}" alt="image-${index}">`).join('')}</p>`;

    const plan = planForumContent(html);
    const rows = plan.rows;
    const plannedUrls = rows.flatMap(imageUrlsInPlannedRow);

    expect(rows).toHaveLength(500);
    expect(rows.every((row) => imageUrlsInPlannedRow(row).length <= 4)).toBe(true);
    expect(plannedUrls).toEqual(sourceUrls);
  });

  it('budgets every rendered forum sticker source while keeping text-only sticker labels local', () => {
    const sourceUrls = Array.from({ length: 9 }, (_, index) => `https://img.example/sticker-${index}.webp`);
    const html = `<forum-sticker-row>${sourceUrls
      .map((src, index) => `<forum-sticker src="${src}" alt="sticker-${index}">sticker-${index}</forum-sticker>`)
      .join('')}<forum-sticker alt="local-emoji">local-emoji</forum-sticker></forum-sticker-row>`;

    const plan = planForumContent(html);
    const plannedUrls = plan.rows.flatMap((row) =>
      parseHtml(row.html)
        .querySelectorAll('forum-sticker')
        .map((sticker) => sticker.getAttribute('src'))
        .filter((src): src is string => Boolean(src))
    );

    expect(plan.rows).toHaveLength(3);
    expect(
      plan.rows.every(
        (row) =>
          parseHtml(row.html)
            .querySelectorAll('forum-sticker')
            .filter((sticker) => sticker.getAttribute('src')).length <= 4
      )
    ).toBe(true);
    expect(plannedUrls).toEqual(sourceUrls);
    expect(plan.rows.map((row) => parseHtml(row.html).text).join('')).toContain('local-emoji');
  });

  it('budgets every canonical inline-image source without charging a text-only label', () => {
    const sourceUrls = Array.from({ length: 9 }, (_, index) => `https://img.example/emoji-${index}.webp`);
    const html = `<forum-inline-media-line>${sourceUrls
      .map(
        (src, index) =>
          `<forum-inline-image class="emoji" width="20" height="20" src="${src}" alt="emoji-${index}">emoji-${index}</forum-inline-image>`
      )
      .join(
        ''
      )}<forum-inline-image class="emoji" alt="local-emoji">local-emoji</forum-inline-image></forum-inline-media-line>`;

    const plan = planForumContent(html);
    const plannedUrls = plan.rows.flatMap((row) =>
      parseHtml(row.html)
        .querySelectorAll('forum-inline-image')
        .map((image) => image.getAttribute('src'))
        .filter((src): src is string => Boolean(src))
    );

    expect(plan.rows).toHaveLength(3);
    expect(
      plan.rows.every(
        (row) =>
          parseHtml(row.html)
            .querySelectorAll('forum-inline-image')
            .filter((image) => image.getAttribute('src')).length <= 4
      )
    ).toBe(true);
    expect(plannedUrls).toEqual(sourceUrls);
    expect(plan.rows.map((row) => parseHtml(row.html).text).join('')).toContain('local-emoji');
  });

  it('preserves ordinary safe HTML as one unchanged row', () => {
    const html = '<p class="message">ordinary <strong>formatted</strong> content</p>';

    expect(planForumContent(html)).toEqual({
      rows: [
        {
          ancestorFrames: [],
          html,
          keySuffix: 'node-0:0',
          networkMediaCount: 0,
          part: 'only',
          segmentIndex: 0,
          semanticId: 'node-0'
        }
      ]
    });
  });

  it('preserves an ordinary table byte-for-byte', () => {
    const html =
      '<table class="comparison"><tbody><tr><th>Name</th><th>Value</th></tr><tr><td>Alpha</td><td>1</td></tr></tbody></table>';

    const plan = planForumContent(html);

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.html).toBe(html);
    expect(plan.rows[0]?.part).toBe('only');
  });

  it('keeps oversized code in one complete semantic owner', () => {
    const sourceLines = Array.from({ length: 240 }, (_, index) => `line-${index + 1}:${'x'.repeat(90)}\n`);
    const rows = compileForumContent({
      html: `<pre>${sourceLines.join('')}</pre>`,
      role: 'reply',
      source: 'linuxdo'
    }).rows;
    const codeRows = rows.filter(
      (row): row is Extract<CompiledForumContentRow, { type: 'codeBlock' }> => row.type === 'codeBlock'
    );

    expect(codeRows).toHaveLength(1);
    expect(codeRows[0]).toMatchObject({
      copyText: sourceLines.join(''),
      part: 'only',
      segmentIndex: 0,
      semanticId: 'node-0',
      text: sourceLines.join('')
    });
  });

  it('keeps a standalone block code element as one typed owner without stealing inline code', () => {
    const blockText = Array.from({ length: 240 }, (_, index) => `block-${index + 1}\n`).join('');
    for (const role of ['opening', 'reply'] as const) {
      const blockRows = compileForumContent({
        html: `<code>${blockText}</code>`,
        role,
        source: 'linuxdo'
      }).rows;
      expect(blockRows).toHaveLength(1);
      expect(blockRows[0]).toMatchObject({
        copyText: blockText,
        part: 'only',
        segmentIndex: 0,
        text: blockText,
        type: 'codeBlock'
      });
    }
    const inlineRows = compileForumContent({
      html: '<p>before <code>inline</code> after</p>',
      role: 'reply',
      source: 'linuxdo'
    }).rows;

    expect(inlineRows).toHaveLength(1);
    expect(inlineRows[0]).toMatchObject({ type: 'richText' });
  });

  it('compiles one semantic code block before planning physical rows', () => {
    const sourceLines = Array.from(
      { length: 52 },
      (_, index) => `<span data-line="${index + 1}">line-${String(index + 1).padStart(2, '0')}</span>\n`
    );

    const compilation = compileForumContent({
      html: `<pre>${sourceLines.join('')}</pre>`,
      role: 'reply',
      source: 'linuxdo'
    });

    expect(compilation.rows).toHaveLength(1);
    expect(compilation.rows[0]).toMatchObject({
      ancestorFrames: [],
      part: 'only',
      segmentIndex: 0,
      semanticId: 'node-0',
      type: 'codeBlock'
    });
    expect((compilation.rows[0] as { text?: string }).text).toBe(
      sourceLines.map((line) => parseHtml(line).text).join('')
    );
  });

  it('preserves nested code highlighting, line breaks, and escaped literals', () => {
    const [row] = compileForumContent({
      html: '<pre><code><span style="color: #34d399">&lt;tag&gt;</span><br>next</code></pre>',
      role: 'reply',
      source: 'linuxdo'
    }).rows;

    expect(row).toMatchObject({ copyText: '<tag>\nnext', text: '<tag>\nnext', type: 'codeBlock' });
    if (row?.type !== 'codeBlock') throw new Error('Expected one semantic code block.');
    expect(row.runs.map(({ text }) => text).join('')).toBe('<tag>\nnext');
    expect(row.runs).toContainEqual({ style: { color: '#34d399' }, text: '<tag>' });
  });

  it('carries every nested semantic ancestor without HTML bindings', () => {
    const sourceLines = Array.from(
      { length: 52 },
      (_, index) => `<span data-line="${index + 1}">nested-line-${String(index + 1).padStart(2, '0')}</span>\n`
    );
    const sourceTableRows = Array.from(
      { length: 18 },
      (_, index) => `<tr><td>row-${index + 1}</td><td>value-${index + 1}</td></tr>`
    );
    const html =
      '<details><summary>Nested structure</summary>' +
      '<blockquote data-forum-callout="true" data-forum-callout-type="warning">' +
      '<div class="forum-callout-title forum-callout-tone-warning">Warning</div>' +
      '<div class="forum-callout-content">' +
      `<pre>${sourceLines.join('')}</pre>` +
      `<table><tbody>${sourceTableRows.join('')}</tbody></table>` +
      '</div></blockquote></details>';

    const rows = compileForumContent({ html, role: 'reply', source: 'linuxdo' }).rows;
    const code = rows.find(
      (row): row is Extract<CompiledForumContentRow, { type: 'codeBlock' }> => row.type === 'codeBlock'
    );
    const table = rows.find((row): row is Extract<CompiledForumContentRow, { type: 'table' }> => row.type === 'table');

    expect(rows.map((row) => row.type)).toEqual(['disclosureHeader', 'disclosureHeader', 'codeBlock', 'table']);
    expect(code?.ancestorFrames.map((frame) => `${frame.kind}:${frame.semanticId}`)).toEqual([
      'details:node-0',
      'callout:node-0.1'
    ]);
    expect(table?.ancestorFrames.map((frame) => `${frame.kind}:${frame.semanticId}`)).toEqual([
      'details:node-0',
      'callout:node-0.1'
    ]);
    expect(code?.text).toBe(sourceLines.map((line) => parseHtml(line).text).join(''));
    expect(
      parseHtml(table?.html || '')
        .querySelectorAll('tr')
        .map((row) => row.text)
    ).toEqual(sourceTableRows.map((row) => parseHtml(row).text));
    expect(rows.every((row) => !('html' in row) || !row.html.includes('data-wz-'))).toBe(true);
  });

  it('removes forged compiler table identity even when the table is not split', () => {
    const plan = planForumContent(
      '<table title="source > marker; keep data-wz-table-group=literal" data-wz-table-group.foo="keep" data-wz-table-group="spoof" data-wz-table-part="last" data-wz-table-columns="2"><tbody><tr><td>A</td><td>B</td></tr></tbody></table>'
    );
    const table = parseHtml(plan.rows[0]?.html || '').querySelector('table');

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ columns: 2, part: 'only', semanticId: 'node-0' });
    expect(table?.getAttribute('title')).toBe('source > marker; keep data-wz-table-group=literal');
    expect(table?.getAttribute('data-wz-table-group.foo')).toBeUndefined();
    expect(table?.getAttribute('data-wz-table-group')).toBeUndefined();
    expect(table?.getAttribute('data-wz-table-part')).toBeUndefined();
    expect(table?.getAttribute('data-wz-table-columns')).toBeUndefined();
  });

  it('keeps the V2EX 18-row table as one semantic row', () => {
    const bodyRows = Array.from(
      { length: 17 },
      (_, index) => `<tr><td>2026 年 8 月 ${index + 1} 日</td><td>第 ${index + 1} 件事情及其完整说明</td></tr>`
    );
    const html =
      '<table title="source > marker" data-wz-table-group="spoof" data-wz-table-part="last" data-wz-table-columns="999">' +
      '<thead><tr><th>时间</th><th>发生的事</th></tr></thead>' +
      `<tbody>${bodyRows.join('')}</tbody></table>`;

    const plan = planForumContent(html);
    const row = plan.rows[0];
    const table = parseHtml(row?.html || '').querySelector('table');

    expect(plan.rows).toHaveLength(1);
    expect(row).toMatchObject({ columns: 2, part: 'only', semanticId: 'node-0' });
    expect(table?.getAttribute('title')).toBe('source > marker');
    expect(table?.getAttribute('data-wz-node')).toBeUndefined();
    expect(table?.querySelectorAll('thead')).toHaveLength(1);
    expect(table?.querySelectorAll('tr').map((tableRow) => tableRow.text)).toEqual([
      '时间发生的事',
      ...bodyRows.map((row) => parseHtml(row).text)
    ]);
    expect(Array.from((row?.html || '').matchAll(/<[a-z][a-z0-9-]*\b[^>]*>/gi))).toHaveLength(57);
    expect((row?.html || '').length).toBeLessThanOrEqual(16_384);
  });

  it('caps a logical table column model at the existing DOM-node budget', () => {
    const bodyRows = Array.from(
      { length: 20 },
      (_, index) => `<tr><td colspan="80">row ${index + 1}</td><td colspan="80">value</td></tr>`
    );

    const plan = planForumContent(`<table><tbody>${bodyRows.join('')}</tbody></table>`);

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows.map((row) => row.columns)).toEqual(Array.from({ length: plan.rows.length }, () => 80));
    expect(new Set(plan.rows.map((row) => row.semanticId))).toEqual(new Set(['node-0']));
  });

  it('groups a multi-row table only at complete tr boundaries', () => {
    const sourceUrls = Array.from({ length: 9 }, (_, index) => `https://img.example/table-row-${index}.webp`);
    const sourceRows = sourceUrls.map(
      (src, index) => `<tr data-row="${index}"><td>Row ${index}</td><td><img src="${src}"></td></tr>`
    );
    const html = `<table><tbody>${sourceRows.join('')}</tbody></table>`;

    const plan = planForumContent(html);
    const tables = plan.rows.map((row) => parsedBalancedTable(row.html));

    expect(plan.rows).toHaveLength(3);
    expect(tables.map((table) => table.querySelectorAll('tr').length)).toEqual([4, 4, 1]);
    expect(tables.flatMap((table) => table.querySelectorAll('tr').map((row) => row.toString()))).toEqual(sourceRows);
    expect(
      plan.rows.flatMap((row) =>
        'html' in row
          ? parseHtml(row.html)
              .querySelectorAll('img')
              .map((image) => image.getAttribute('src'))
          : []
      )
    ).toEqual(sourceUrls);
    expect(plan.rows.every((row) => parseHtml(row.html).querySelectorAll('img').length <= 4)).toBe(true);
    expect(plan.rows.every((row) => domNodeCount(row.html) <= 80)).toBe(true);
    expect(plan.rows.every((row) => maxElementDepth(row.html) <= 64)).toBe(true);
    expect(plan.rows.every((row) => row.html.length <= 16_384)).toBe(true);
  });

  it('never splits an active rowspan-connected table region', () => {
    const connectedRows = [
      '<tr><td rowspan="4">connected</td><td><img src="https://img.example/rowspan-0.webp"></td></tr>',
      ...Array.from(
        { length: 3 },
        (_, index) => `<tr><td><img src="https://img.example/rowspan-${index + 1}.webp"></td></tr>`
      )
    ];
    const independentRows = Array.from(
      { length: 4 },
      (_, index) => `<tr><td>independent-${index}</td><td><img src="https://img.example/after-${index}.webp"></td></tr>`
    );

    const plan = planForumContent(`<table><tbody>${[...connectedRows, ...independentRows].join('')}</tbody></table>`);
    const renderedRowGroups = plan.rows.map((row) =>
      parseHtml(row.html)
        .querySelectorAll('tr')
        .map((tableRow) => tableRow.toString())
    );

    expect(renderedRowGroups).toEqual([connectedRows, independentRows]);
    expect(new Set(plan.rows.map((row) => row.semanticId))).toEqual(new Set(['node-0']));
    expect(plan.rows.map((row) => row.part)).toEqual(['first', 'last']);
  });

  it('fail-closes one table row that cannot be split safely', () => {
    const sourceUrls = Array.from({ length: 9 }, (_, index) => `https://img.example/table-cell-${index}.webp`);
    const html = `<table><tbody><tr id="oversized-row"><td class="label">One logical row</td><td class="media">${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}</td></tr></tbody></table>`;

    const plan = planForumContent(html);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.html).toBe('<p>内容过于复杂，请在原站查看。</p>');
    expect(plan.rows[0]?.html).not.toContain('oversized-row');
    expect(plan.rows[0]?.html).not.toContain(sourceUrls[0]);
  });

  it('keeps every terminal report tab when its code body exceeds one physical row budget', () => {
    const tabs = Array.from({ length: 4 }, (_, tabIndex) => ({
      id: `tab-${tabIndex}`,
      text: Array.from(
        { length: 24 },
        (_, lineIndex) =>
          `<span style="color: rgb(${tabIndex + 1}, ${lineIndex + 1}, 8)">tab-${tabIndex}-line-${lineIndex}</span>`
      ).join('<br>')
    }));
    const html = `<forum-terminal-report>${tabs
      .map(
        (tab) =>
          `<forum-terminal-tab title="${tab.id}"><div class="forum-terminal-code">${tab.text}</div></forum-terminal-tab>`
      )
      .join('')}</forum-terminal-report>`;

    const rows = compileForumContent({ html, role: 'opening', source: 'nodeseek' }).rows;

    expect(rows[0]).toMatchObject({
      defaultTabId: 'node-0-tab-0',
      semanticId: 'node-0',
      tabs: tabs.map((tab, index) => ({ id: `node-0-tab-${index}`, title: tab.id })),
      type: 'terminalReportHeader'
    });
    expect(rows.slice(1).every((row) => row.type === 'codeBlock')).toBe(true);
    expect(
      rows
        .slice(1)
        .map((row) => (row.type === 'codeBlock' ? row.text : ''))
        .join('')
    ).toContain('tab-3-line-23');
    expect(rows.slice(1).map((row) => row.ancestorFrames.find((frame) => frame.kind === 'terminalTab'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reportSemanticId: 'node-0', tabId: 'node-0-tab-0' }),
        expect.objectContaining({ reportSemanticId: 'node-0', tabId: 'node-0-tab-3' })
      ])
    );
    expect(rows.some((row) => 'html' in row && row.html.includes('内容过于复杂'))).toBe(false);
  });

  it('recursively preserves mixed semantic rows inside every terminal tab', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<forum-terminal-report>' +
      '<forum-terminal-tab title="Mixed">' +
      '<p>intro<img src="https://img.example/report.webp"></p>' +
      '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>' +
      '<details open><summary>More</summary><pre>plain code</pre><forum-discourse-poll name="choice"></forum-discourse-poll></details>' +
      '</forum-terminal-tab>' +
      '<forum-terminal-tab title="Terminal"><div class="forum-terminal-code"><span style="color: #00ff00; background-color: #000087">done</span></div></forum-terminal-tab>' +
      '</forum-terminal-report>';

    const rows = compileForumContent({ html, polls: [poll], role: 'opening', source: 'linuxdo' }).rows;

    expect(rows.map((row) => row.type)).toEqual([
      'terminalReportHeader',
      'richText',
      'table',
      'disclosureHeader',
      'codeBlock',
      'poll',
      'codeBlock'
    ]);
    expect(rows.slice(1).every((row) => row.ancestorFrames.some((frame) => frame.kind === 'terminalTab'))).toBe(true);
    expect(rows.find((row) => row.type === 'richText')?.networkMediaCount).toBe(1);
    expect(rows.find((row) => row.type === 'table')).toMatchObject({ columns: 2, part: 'only' });
    expect(rows.find((row) => row.type === 'poll')).toMatchObject({ poll, type: 'poll' });
    expect(rows.find((row) => row.type === 'poll')?.ancestorFrames.map((frame) => frame.kind)).toEqual([
      'terminalTab',
      'details'
    ]);
    expect(rows.at(-1)).toMatchObject({
      runs: [expect.objectContaining({ style: { backgroundColor: '#000087', color: '#00ff00' }, text: 'done' })],
      type: 'codeBlock',
      variant: 'terminal'
    });
  });

  it('keeps long terminal code in one full-copy owner', () => {
    const lines = Array.from({ length: 240 }, (_, index) => `line-${index + 1}:${'x'.repeat(90)}`);
    const html = `<forum-terminal-report><forum-terminal-tab title="Long"><div class="forum-terminal-code">${lines.join(
      '<br>'
    )}</div></forum-terminal-tab></forum-terminal-report>`;

    const codeRows = compileForumContent({ html, role: 'opening', source: 'nodeseek' }).rows.filter(
      (row): row is Extract<CompiledForumContentRow, { type: 'codeBlock' }> => row.type === 'codeBlock'
    );

    expect(codeRows).toHaveLength(1);
    expect(codeRows[0]).toMatchObject({
      copyText: lines.join('\n'),
      part: 'only',
      segmentIndex: 0,
      text: lines.join('\n'),
      variant: 'terminal'
    });
  });

  it('keeps terminal code beyond the old text budget with sibling tabs', () => {
    const html =
      '<forum-terminal-report>' +
      `<forum-terminal-tab title="Unsafe"><div class="forum-terminal-code">${'x'.repeat(
        13_000
      )}</div></forum-terminal-tab>` +
      '<forum-terminal-tab title="Safe"><div class="forum-terminal-code">safe result</div></forum-terminal-tab>' +
      '</forum-terminal-report>';

    const rows = compileForumContent({ html, role: 'opening', source: 'nodeseek' }).rows;

    expect(rows[0]).toMatchObject({
      tabs: [
        { id: 'node-0-tab-0', title: 'Unsafe' },
        { id: 'node-0-tab-1', title: 'Safe' }
      ],
      type: 'terminalReportHeader'
    });
    expect(rows[1]).toMatchObject({
      copyText: 'x'.repeat(13_000),
      part: 'only',
      segmentIndex: 0,
      text: 'x'.repeat(13_000),
      type: 'codeBlock',
      variant: 'terminal'
    });
    expect(rows[1]?.ancestorFrames).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'terminalTab', tabId: 'node-0-tab-0' })])
    );
    expect(rows[2]).toMatchObject({ text: 'safe result', type: 'codeBlock', variant: 'terminal' });
    expect(rows[2]?.ancestorFrames).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'terminalTab', tabId: 'node-0-tab-1' })])
    );
  });

  it('bounds individual headers and unexpected children without deleting the report', () => {
    const tabs = Array.from(
      { length: 90 },
      (_, index) =>
        `<forum-terminal-tab title="${index === 0 ? 'x'.repeat(13_000) : `Tab ${index + 1}`}"><div class="forum-terminal-code">body ${index + 1}</div></forum-terminal-tab>`
    );
    const html = `<forum-terminal-report>${tabs[0]}<aside>unexpected</aside>${tabs.slice(1).join('')}</forum-terminal-report>`;

    const rows = compileForumContent({ html, role: 'opening', source: 'nodeseek' }).rows;
    const headers = rows.filter(
      (row): row is Extract<CompiledForumContentRow, { type: 'terminalReportHeader' }> =>
        row.type === 'terminalReportHeader'
    );

    expect(headers.length).toBeGreaterThan(1);
    expect(headers.flatMap((header) => header.tabs)).toHaveLength(90);
    expect(headers.flatMap((header) => header.tabs)[0]?.title).toBe('Tab 1');
    expect(rows.some((row) => row.type === 'codeBlock' && row.text === 'body 90')).toBe(true);
    expect(rows.filter((row) => 'html' in row && row.html === '<p>内容过于复杂，请在原站查看。</p>')).toHaveLength(1);
  });

  it('bounds hostile nesting without losing ordered media', () => {
    const sourceUrls = Array.from({ length: 20 }, (_, index) => `https://img.example/deep-${index}.webp`);
    const html = `${'<div class="nested">'.repeat(96)}${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}${'</div>'.repeat(96)}`;

    const rows = planForumContent(html).rows;
    const plannedUrls = rows.flatMap((row) =>
      parseHtml(row.html)
        .querySelectorAll('img')
        .map((image) => image.getAttribute('src'))
    );

    expect(rows.every((row) => parseHtml(row.html).querySelectorAll('img').length <= 4)).toBe(true);
    expect(rows.every((row) => maxElementDepth(row.html) <= 64)).toBe(true);
    expect(plannedUrls).toEqual(sourceUrls);
  });

  it('keeps parser fallback output bounded and ordered', async () => {
    const sourceUrls = Array.from({ length: 20 }, (_, index) => `https://img.example/fallback-${index}.webp`);
    const html = `${'<div class="fallback-nested">'.repeat(96)}${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}${'</div>'.repeat(96)}`;
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');

      const compilation = compileWithFallback({ html, role: 'signature', source: 'nodeseek' });
      const rows = renderedContentRows(compilation);
      const plannedUrls = rows.flatMap((row) =>
        parseHtml(row.html)
          .querySelectorAll('img')
          .map((image) => image.getAttribute('src'))
      );

      expect(rows).toHaveLength(5);
      expect(rows.every((row) => parseHtml(row.html).querySelectorAll('img').length <= 4)).toBe(true);
      expect(rows.every((row) => maxElementDepth(row.html) <= 64)).toBe(true);
      expect(plannedUrls).toEqual(sourceUrls);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('keeps preview descriptors when parser fallback is used', async () => {
    await withTrackedParseHtml(async (trackedParseHtml) => {
      trackedParseHtml.mockImplementation(() => {
        throw new Error('parser unavailable');
      });
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');
      const compilation = compileWithFallback({
        html: [
          '<img class="emoji" width="20" height="20" src="https://img.example/emoji.webp">',
          '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-src="https://img.example/lazy.webp" referrerpolicy="no-referrer">'
        ].join(''),
        role: 'opening',
        source: 'nodeseek'
      });

      expect(compilation.previewImages).toEqual([
        expect.objectContaining({ referrerPolicy: 'no-referrer', source: 'https://img.example/lazy.webp' })
      ]);
    });
  });

  it('fail-closes every unsafe row in a multi-fragment parser fallback', async () => {
    const sourceUrls = Array.from({ length: 5 }, (_, index) => `https://img.example/malformed-${index}.webp`);
    const html = `<div>${'<i>'.repeat(1_000)}${sourceUrls.map((src) => `<img src="${src}">`).join('')}</div>`;
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');

      const compilation = compileWithFallback({ html, role: 'signature', source: 'nodeseek' });
      const rows = renderedContentRows(compilation);
      const structures = rows.map((row) => rawHtmlStructure(row.html));
      const retainedUrls = rows.flatMap((row) =>
        Array.from(row.html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi), (match) => match[1])
      );

      expect(rows.length).toBeGreaterThan(1);
      expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
      expect(structures.every(({ balanced }) => balanced)).toBe(true);
      expect(structures.every(({ domNodes }) => domNodes <= 80)).toBe(true);
      expect(structures.every(({ maxDepth }) => maxDepth <= 64)).toBe(true);
      expect(rows.every((row) => row.networkMediaCount <= 4)).toBe(true);
      expect(rows.every((row) => Array.from(row.html.matchAll(/<img\b/gi)).length <= 4)).toBe(true);
      expect(rows[0]?.html).toContain('内容过于复杂');
      expect(retainedUrls).toEqual(sourceUrls);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('keeps a media-free rich-text subtree in one owner beyond old budgets', () => {
    const text = '正文'.repeat(9000);
    const html = `<div>${Array.from({ length: 160 }, (_, index) => `<span>${index}</span>`).join('')}<p>${text}</p></div>`;

    const rows = planForumContent(html).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.part).toBe('only');
    expect(rows[0]?.html).toBe(html);
    expect(parseHtml(rows[0].html).text).toContain(text);
  });

  it('does not cut a continuous rich-text owner at a serialized-size budget', () => {
    const html = `<div data-note="${'a'.repeat(9_000)}"><span>${'b'.repeat(9_000)}</span></div>`;

    const rows = planForumContent(html).rows;

    expect(rows).toHaveLength(1);
    expect(parseHtml(rows[0].html).text).toBe('b'.repeat(9_000));
  });

  it('keeps oversized continuous text and its Unicode graphemes in one owner', () => {
    const visibleText = `${'a'.repeat(11_999)}👩‍💻&tail${'b'.repeat(4_500)}`;
    const html = `<p>${visibleText.replace('&', '&amp;')}</p>`;

    const rows = planForumContent(html).rows;
    expect(rows).toHaveLength(1);
    expect(parseHtml(rows[0].html).text).toBe(visibleText);
    expect(rows[0]?.part).toBe('only');
  });

  it('splits a mixed subtree only at discrete media boundaries', () => {
    const leading = '前'.repeat(13_000);
    const trailing = '后'.repeat(13_000);
    const rows = planForumContent(
      `<div><p>${leading}</p><img src="https://img.example/discrete.webp"><h2>${trailing}</h2></div>`
    ).rows;

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.networkMediaCount)).toEqual([0, 1, 0]);
    expect(rows.map((row) => parseHtml(row.html).text)).toEqual([leading, '', trailing]);
  });

  it('keeps an anchor identity only on the first continuation row', () => {
    const html = `<div id="target" name="target">${Array.from(
      { length: 12 },
      (_, index) => `<img src="https://img.example/${index}.webp">`
    ).join('')}</div>`;

    const rows = planForumContent(html).rows;

    expect(rows).toHaveLength(3);
    expect(rows[0].html).toContain('id="target"');
    expect(rows[0].html).toContain('name="target"');
    expect(rows.slice(1).every((row) => !/\s(?:id|name)="target"/.test(row.html))).toBe(true);
  });

  it('continues ordered-list numbering across planned rows', () => {
    const html = `<ol start="3">${Array.from(
      { length: 9 },
      (_, index) => `<li>item ${index}<img src="https://img.example/list-${index}.webp"></li>`
    ).join('')}</ol>`;

    const rows = planForumContent(html).rows;

    expect(rows).toHaveLength(9);
    expect(
      rows.map(
        (row) => row.ancestorFrames.find((frame: ForumContentAncestorFrame) => frame.kind === 'listItem')?.marker
      )
    ).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(
      new Set(
        rows.map(
          (row) => row.ancestorFrames.find((frame: ForumContentAncestorFrame) => frame.kind === 'list')?.semanticId
        )
      )
    ).toEqual(new Set(['node-0']));
  });

  it('keeps one logical ordered-list item number across its media continuations', () => {
    const sourceUrls = Array.from({ length: 10 }, (_, index) => `https://img.example/list-continuation-${index}.webp`);
    const html = `<ol start="3"><li id="first-item">${sourceUrls
      .slice(0, 9)
      .map((src) => `<img src="${src}">`)
      .join('')}</li><li id="second-item"><img src="${sourceUrls[9]}"></li></ol>`;

    const rows = planForumContent(html).rows;
    const itemFrames = rows.map((row) =>
      row.ancestorFrames.find((frame: ForumContentAncestorFrame) => frame.kind === 'listItem')
    );

    expect(rows).toHaveLength(4);
    expect(itemFrames.map((frame) => frame?.marker)).toEqual([3, 3, 3, 4]);
    expect(itemFrames.map((frame) => frame?.part)).toEqual(['first', 'middle', 'last', 'only']);
    expect(new Set(itemFrames.slice(0, 3).map((frame) => frame?.semanticId))).toEqual(new Set(['node-0.0']));
    expect(rows.every((row) => !row.html.includes('data-wz-'))).toBe(true);
    expect(rows.flatMap(imageUrlsInPlannedRow)).toEqual(sourceUrls);
  });

  it('gives oversized details fragments one stable group and unique part semantics', () => {
    const sourceUrls = Array.from({ length: 9 }, (_, index) => `https://img.example/details-${index}.webp`);
    const html = `<details id="details-anchor" name="details-name" data-wz-details-group="spoof" data-wz-details-part="last"><summary>Stable summary</summary><p>${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}</p></details>`;

    const plan = planForumContent(html);
    expect(plan.rows).toHaveLength(4);
    expect(plan.rows[0]).toMatchObject({
      defaultExpanded: false,
      part: 'first',
      semanticId: 'node-0',
      titleLabel: 'Stable summary'
    });
    const slices = plan.rows.slice(1).map((row) => logicalSliceForTag(row, 'details'));
    expect(slices.map((slice) => slice?.semanticId)).toEqual(['node-0', 'node-0', 'node-0']);
    expect(slices.map((slice) => slice?.part)).toEqual(['middle', 'middle', 'last']);
    expect(plan.rows.every((row) => !('html' in row) || !row.html.includes('data-wz-'))).toBe(true);
    expect(plan.rows.flatMap(imageUrlsInPlannedRow)).toEqual(sourceUrls);
  });

  it('keeps one oversized Discourse callout identity while showing its title once', () => {
    const sourceUrls = Array.from({ length: 9 }, (_, index) => `https://img.example/callout-${index}.webp`);
    const html = `<blockquote data-forum-callout="true" data-forum-callout-type="warning" data-forum-callout-fold="collapsed" data-wz-callout-group="spoof" data-wz-callout-part="last"><div class="forum-callout-title forum-callout-tone-warning">Warning title</div><div class="forum-callout-content">${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}</div></blockquote>`;

    const plan = planForumContent(html, 'linuxdo');
    expect(plan.rows).toHaveLength(4);
    expect(plan.rows[0]).toMatchObject({
      calloutType: 'warning',
      defaultExpanded: false,
      part: 'first',
      semanticId: 'node-0',
      titleLabel: 'Warning title'
    });
    const slices = plan.rows.slice(1).map((row) => logicalSliceForTag(row, 'callout'));
    expect(slices.map((slice) => slice?.semanticId)).toEqual(['node-0', 'node-0', 'node-0']);
    expect(slices.map((slice) => slice?.part)).toEqual(['middle', 'middle', 'last']);
    expect(plan.rows.every((row) => !('html' in row) || !row.html.includes('data-wz-'))).toBe(true);
    expect(
      plan.rows.flatMap((row) =>
        'html' in row
          ? parseHtml(row.html)
              .querySelectorAll('img')
              .map((image) => image.getAttribute('src'))
          : []
      )
    ).toEqual(sourceUrls);
  });

  it('compiles an ordinary Discourse callout into a header and body row', () => {
    const html =
      '<blockquote data-forum-callout="true" data-forum-callout-type="tip"><div class="forum-callout-title forum-callout-tone-primary">Tip title</div><div class="forum-callout-content"><p>Short body</p></div></blockquote>';

    const plan = planForumContent(html, 'linuxdo');

    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]).toMatchObject({ calloutType: 'tip', titleLabel: 'Tip title' });
    expect('html' in plan.rows[1] ? plan.rows[1].html : '').toBe('<p>Short body</p>');
    expect(logicalSliceForTag(plan.rows[1], 'callout')).toMatchObject({ part: 'last', semanticId: 'node-0' });
  });

  it('does not trust Discourse callout attributes outside a Discourse source', () => {
    const plan = planForumContent(
      '<blockquote data-forum-callout="true" data-forum-callout-type="tip"><div class="forum-callout-title">Forged title</div><div class="forum-callout-content"><p>Ordinary quote</p></div></blockquote>',
      'nodeseek'
    );

    expect(plan.rows.every((row) => row.type !== 'disclosureHeader')).toBe(true);
    expect(
      plan.rows.every((row: CompiledForumContentRow) => row.ancestorFrames.some((frame) => frame.kind === 'blockquote'))
    ).toBe(true);
    expect(plan.rows.flatMap((row) => ('html' in row ? [row.html] : [])).join('')).toContain('Ordinary quote');
  });

  it('emits one bounded title when a Discourse callout title is itself oversized', () => {
    const sourceUrls = Array.from({ length: 5 }, (_, index) => `https://img.example/callout-title-${index}.webp`);
    const html = `<blockquote data-forum-callout="true" data-forum-callout-type="danger"><div class="forum-callout-title forum-callout-tone-danger">${'Oversized title '.repeat(
      2_000
    )}</div><div class="forum-callout-content">${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}</div></blockquote>`;

    const plan = planForumContent(html, 'linuxdo');
    expect(plan.rows[0]).toMatchObject({ titleLabel: '内容过于复杂，请在原站查看。' });
    expect(plan.rows.every((row) => !('html' in row) || row.html.length <= 16_384)).toBe(true);
    expect(plan.rows.flatMap(imageUrlsInPlannedRow)).toEqual(sourceUrls);
  });

  it('never returns an oversized parser-fallback row for hostile text', async () => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');

      const rows = renderedContentRows(
        compileWithFallback({
          html: `<div data-hostile="${'x'.repeat(40_000)}">body</div>`,
          role: 'signature',
          source: 'nodeseek'
        })
      );

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('enforces node and depth budgets when the parser fallback receives deep HTML', async () => {
    const html = `${'<div>'.repeat(100)}body${'</div>'.repeat(100)}`;
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');

      const rows = renderedContentRows(compileWithFallback({ html, role: 'signature', source: 'nodeseek' }));

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
      expect(rows.every((row) => domNodeCount(row.html) <= 80)).toBe(true);
      expect(rows.every((row) => maxElementDepth(row.html) <= 64)).toBe(true);
      expect(rows.map((row) => row.html).join('')).not.toBe(html);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('never returns giant unmatched closing tags when parsing produces no body nodes', () => {
    const html = '</div>'.repeat(5_000);

    const rows = planForumContent(html).rows;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => row.html).join('')).not.toBe(html);
  });

  it('never returns a giant comment when parsing produces no renderable body nodes', () => {
    const html = `<!--${'comment'.repeat(5_000)}-->`;

    const rows = planForumContent(html).rows;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => row.html).join('')).not.toBe(html);
  });

  it('does not restore a giant trailing comment discarded after safe parsed content', () => {
    const html = `<p>safe body</p><!--${'comment'.repeat(5_000)}-->`;

    const rows = planForumContent(html).rows;

    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => row.html).join('')).toBe('<p>safe body</p>');
  });

  it('does not restore giant trailing closing tags discarded after safe parsed content', () => {
    const html = `<p>safe body</p>${'</div>'.repeat(5_000)}`;

    const rows = planForumContent(html).rows;

    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => row.html).join('')).toBe('<p>safe body</p>');
  });

  it.each(['forum-video', 'video'])('counts a %s source and poster as two potential network media', (tag) => {
    const plan = planForumContent(
      `<${tag} src="https://media.example/demo.mp4" poster="https://media.example/poster.webp"></${tag}>`
    );

    expect(plan.rows[0]?.networkMediaCount).toBe(2);
  });

  it.each(['forum-video', 'video'])('counts a %s source and poster in parser fallback media budgets', async (tag) => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');

      const plan = compileWithFallback({
        html: `<${tag} src="https://media.example/demo.mp4" poster="https://media.example/poster.webp"></${tag}>`,
        role: 'signature',
        source: 'nodeseek'
      });

      expect(renderedContentRows(plan)[0]?.networkMediaCount).toBe(2);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('keeps forum sticker sources bounded in parser fallback rows', async () => {
    const sourceUrls = Array.from({ length: 5 }, (_, index) => `https://img.example/fallback-sticker-${index}.webp`);
    const html = `<forum-sticker-row>${sourceUrls
      .map((src) => `<forum-sticker src="${src}">sticker</forum-sticker>`)
      .join('')}<forum-sticker>local emoji</forum-sticker></forum-sticker-row>`;
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');

      const plan = compileWithFallback({ html, role: 'signature', source: 'nodeseek' });
      const rows = renderedContentRows(plan);
      const plannedUrls = rows.flatMap((row) =>
        Array.from(row.html.matchAll(/<forum-sticker\b[^>]*\bsrc="([^"]+)"[^>]*>/gi), (match) => match[1])
      );

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.networkMediaCount <= 4)).toBe(true);
      expect(plannedUrls).toEqual(sourceUrls);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('keeps canonical inline-image sources bounded in parser fallback rows', async () => {
    const sourceUrls = Array.from({ length: 5 }, (_, index) => `https://img.example/fallback-emoji-${index}.webp`);
    const html = `<forum-inline-media-line>${sourceUrls
      .map((src) => `<forum-inline-image class="emoji" width="20" height="20" src="${src}">emoji</forum-inline-image>`)
      .join('')}<forum-inline-image class="emoji">local emoji</forum-inline-image></forum-inline-media-line>`;
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');

      const plan = compileWithFallback({ html, role: 'signature', source: 'nodeseek' });
      const rows = renderedContentRows(plan);
      const plannedUrls = rows.flatMap((row) =>
        Array.from(row.html.matchAll(/<forum-inline-image\b[^>]*\bsrc="([^"]+)"[^>]*>/gi), (match) => match[1])
      );

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.networkMediaCount <= 4)).toBe(true);
      expect(plannedUrls).toEqual(sourceUrls);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('counts unquoted link-card artwork in parser fallback media budgets', async () => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');

      const plan = compileWithFallback({
        html: '<forum-link-card href=https://example.com icon-src=https://cdn.example/icon.webp image-src=https://cdn.example/card.webp></forum-link-card>',
        role: 'signature',
        source: 'nodeseek'
      });

      expect(renderedContentRows(plan)[0]?.networkMediaCount).toBe(2);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('detects standalone playable video blocks for native rendering', () => {
    expect(
      compileForumContent({
        html: '<forum-video src="https://yaohuo.me/uploads/demo.mp4"></forum-video>',
        role: 'reply',
        source: 'yaohuo'
      }).rows
    ).toEqual([expect.objectContaining({ src: 'https://yaohuo.me/uploads/demo.mp4', type: 'video' })]);
  });

  it('rejects whitespace-wrapped standalone video policies', () => {
    const [video] = compileForumContent({
      html: '<forum-video src="https://media.example/video.mp4" referrerpolicy=" unsafe-url "></forum-video>',
      role: 'reply',
      source: 'yaohuo'
    }).rows;

    expect(video).not.toHaveProperty('referrerPolicy');
  });

  it('preserves a standalone video poster in parser fallback rows', async () => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');

      expect(
        compileWithFallback({
          html: '<forum-video src="https://media.example/video.mp4" poster="https://media.example/poster.webp"></forum-video>',
          role: 'reply',
          source: 'yaohuo'
        }).rows
      ).toEqual([
        expect.objectContaining({
          poster: 'https://media.example/poster.webp',
          src: 'https://media.example/video.mp4',
          type: 'video'
        })
      ]);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('rejects whitespace-wrapped standalone video policies in parser fallback', async () => {
    vi.resetModules();
    vi.doMock('./html', () => ({
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_TERMINAL_REPORT_TAG: 'forum-terminal-report',
      FORUM_VIDEO_STICKER_TAG: 'forum-video-sticker',
      FORUM_VIDEO_TAG: 'forum-video',
      parseHtml: () => {
        throw new Error('parser unavailable');
      }
    }));
    try {
      const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');
      const [video] = compileWithFallback({
        html: '<forum-video src="https://media.example/video.mp4" referrerpolicy=" unsafe-url "></forum-video>',
        role: 'reply',
        source: 'yaohuo'
      }).rows;

      expect(video).not.toHaveProperty('referrerPolicy');
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('keeps a native video atomic without swallowing adjacent rich text', () => {
    expect(
      compileForumContent({
        html: '<p>before</p><forum-video src="https://yaohuo.me/uploads/demo.mp4"></forum-video>',
        role: 'reply',
        source: 'yaohuo'
      }).rows.map((row) => row.type)
    ).toEqual(['richText', 'video']);
  });
});
