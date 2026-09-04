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

it('makes explicit V2EX floors navigable without changing mention text or copy order', () => {
  const compilation = compileForumContent({
    html: '<p>@<a href="https://www.v2ex.com/member/Pipecraft">Pipecraft</a> #6 and @bob # 105.</p>',
    source: 'v2ex',
    role: 'reply',
    topicId: '945124'
  });
  const root = parseHtml(
    renderedContentRows(compilation)
      .map((row) => row.html)
      .join('')
  );
  expect(root.textContent).toBe('@Pipecraft #6 and @bob # 105.');
  expect(root.querySelectorAll('a').map((link) => link.getAttribute('href'))).toEqual([
    'https://www.v2ex.com/member/Pipecraft',
    'https://www.v2ex.com/t/945124',
    'https://www.v2ex.com/member/bob',
    'https://www.v2ex.com/t/945124'
  ]);
  expect(
    root
      .querySelectorAll('a')
      .map((link) => [
        link.textContent,
        link.getAttribute('data-forum-reply-floor'),
        link.getAttribute('data-forum-reply-author')
      ])
  ).toEqual([
    ['@Pipecraft', undefined, undefined],
    ['#6', '6', 'Pipecraft'],
    ['@bob', undefined, undefined],
    ['# 105', '105', 'bob']
  ]);
});

it('does not trust source navigation attributes when parsing falls back', async () => {
  await withTrackedParseHtml(async (trackedParseHtml) => {
    trackedParseHtml.mockImplementation(() => {
      throw new Error('parser unavailable');
    });
    const { compileForumContent: compileWithFallback } = await import('./topicContentSplit');
    const rows = renderedContentRows(
      compileWithFallback({
        html: '<a class="forum-floor-link" href="https://www.v2ex.com/t/945124" data-forum-reply-floor="6" DATA-FORUM-REPLY-AUTHOR=alice>untrusted</a>',
        role: 'reply',
        source: 'v2ex',
        topicId: '945124'
      })
    );
    expect(rows.map((row) => row.html).join('')).not.toMatch(/data-forum-reply-/i);
    expect(rows.map((row) => row.html).join('')).toContain('untrusted');
  });
});

it('does not infer V2EX targets from code, quoted examples, invalid floors or forged attributes', () => {
  const compilation = compileForumContent({
    html:
      '<p>@alice #0 @bob #1.5 @carol #9007199254740992 #6 @plain</p>' +
      '<pre>@alice #6</pre><blockquote>@alice #6</blockquote>' +
      '<p><code>@alice #6</code><a href="https://example.com" data-forum-reply-floor="6" data-forum-reply-author="alice">#6</a></p>',
    source: 'v2ex',
    role: 'reply',
    topicId: '945124'
  });
  const html = renderedContentRows(compilation)
    .map((row) => row.html)
    .join('');
  expect(html).not.toContain('data-forum-reply-');
  expect(parseHtml(html).textContent).toContain('@alice #0 @bob #1.5 @carol #9007199254740992 #6 @plain');
  const withoutTopic = compileForumContent({ html: '<p>@alice #6</p>', source: 'v2ex', role: 'reply' });
  expect(renderedContentRows(withoutTopic)[0].html).not.toContain('data-forum-reply-');
});

it('binds reused V2EX reply plans to their owning topic', () => {
  const topic = {
    id: '101',
    source: 'v2ex' as const,
    author: 'alice',
    title: 'References',
    createdAt: '',
    url: 'https://www.v2ex.com/t/101',
    contentHtml: '<p>opening</p>',
    replies: [{ author: 'bob', contentHtml: '<p>@alice #6</p>', createdAt: '' }]
  };
  const first = prepareTopicContent(topic);
  const repeated = prepareTopicContent(first);
  expect(repeated).toBe(first);
  const second = prepareTopicContent({ ...first, id: '202', url: 'https://www.v2ex.com/t/202' });
  const firstRows = requirePreparedForumContent(first.replies[0].preparedContent, first.replies[0].contentHtml);
  const secondRows = requirePreparedForumContent(second.replies[0].preparedContent, second.replies[0].contentHtml);
  expect(renderedContentRows(firstRows)[0].html).toContain('https://www.v2ex.com/t/101');
  expect(renderedContentRows(secondRows)[0].html).toContain('https://www.v2ex.com/t/202');
});

function selectionToken(row: CompiledForumContentRow) {
  return JSON.parse(row.selectionToken) as {
    owners: {
      tape: { at: number; text: string }[];
      text: string;
      trailing: { kind: 'media' | 'separator'; text: string }[];
    }[];
    prefix: { kind: 'media' | 'separator'; text: string }[];
    version: 1;
  };
}

function imageUrlsInPlannedRow(row: { html?: string }) {
  return parseHtml(row.html || '')
    .querySelectorAll('*')
    .filter((image) => ['img', 'forum-inline-image'].includes(image.rawTagName?.toLowerCase() || ''))
    .map((image) => image.getAttribute('src'));
}

function planForumContent(html: string | undefined, source: 'linuxdo' | 'nodeseek' = 'nodeseek'): { rows: any[] } {
  const compilation = compileForumContent({ html, role: 'opening', source });
  return {
    rows: compilation.rows.flatMap<any>((row) => {
      if (row.type === 'poll' || row.type === 'quote') return [];
      const { selectionToken: _selectionToken, type: _type, ...plannedRow } = row;
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
  type TestNode = { childNodes?: TestNode[]; rawTagName?: string };
  const pending = (body?.childNodes || []).map((node) => ({
    depth: (node as TestNode).rawTagName ? 1 : 0,
    node: node as TestNode
  }));
  let maxDepth = 0;
  while (pending.length) {
    const current = pending.pop()!;
    maxDepth = Math.max(maxDepth, current.depth);
    const children = current.node.childNodes || [];
    children.forEach((node) => pending.push({ depth: current.depth + (node.rawTagName ? 1 : 0), node }));
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
  it('keeps same-line image runs in bounded rich-text rows', () => {
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
    expect(pure.rows.map((row) => ('html' in row ? row.html.match(/<forum-inline-image\b/g)?.length || 0 : 0))).toEqual(
      [4, 4, 1]
    );
    expect(pure.previewImages.map((image) => image.source)).toEqual(urls);
    expect(mixed.rows.map((row) => row.type)).toEqual(['richText']);
    expect(lightbox.rows).toEqual([
      expect.objectContaining({
        type: 'richText',
        html: expect.stringContaining('https://img.example/original.webp')
      })
    ]);
  });

  it('keeps authored standalone image lines ordered across physical rows', () => {
    const urls = Array.from({ length: 5 }, (_, index) => `https://img.example/line-${index}.webp`);
    const compilation = compileForumContent({
      html: `<p>${urls.map((url, index) => `<img src="${url}" alt="图${index}">`).join('<br>')}</p>`,
      role: 'opening',
      source: 'nodeseek'
    });
    const imagesByRow = renderedContentRows(compilation).map((row) => parseHtml(row.html).querySelectorAll('img'));
    const mediaLabels = compilation.rows
      .map(selectionToken)
      .flatMap((token) => [
        ...token.prefix.filter((atom) => atom.kind === 'media').map((atom) => atom.text),
        ...token.owners.flatMap((owner) => [
          ...owner.tape.map((atom) => atom.text),
          ...owner.trailing.filter((atom) => atom.kind === 'media').map((atom) => atom.text)
        ])
      ]);

    expect(imagesByRow.map((images) => images.length)).toEqual([4, 1]);
    expect(imagesByRow.flat().map((image) => image.getAttribute('src'))).toEqual(urls);
    expect(imagesByRow.flat().map((image) => image.getAttribute('data-forum-flow-image-context'))).toEqual(
      Array(5).fill('standalone')
    );
    expect(mediaLabels).toEqual(['图0', '图1', '图2', '图3', '图4']);
    expect(compilation.previewImages.map((image) => image.source)).toEqual(urls);
  });

  it('keeps an unclassified Yaohuo reply image at its authored text position', () => {
    const text = '妈的，埃塞这边黑小子被中国人带坏了，天天加班，上帝也不见了，就是干，';
    const src = 'https://pic2.ziyuan.wang/user/v2jun/2024/12/FpZEifxiFGs1BWtHjFsk5tJJNKSE_8b6f63437539d.gif';
    const compilation = compileForumContent({
      html: `${text}<img src="${src}" class="ubbimg" referrerpolicy="no-referrer">`,
      role: 'reply',
      source: 'yaohuo'
    });
    const [row] = renderedContentRows(compilation);

    expect(row).toBeTruthy();
    const imageOffset = row!.html.indexOf('<forum-inline-image');
    expect(imageOffset).toBe(row!.html.indexOf(text) + text.length);
    expect(parseHtml(row!.html).querySelector('forum-inline-image')?.getAttribute('src')).toBe(src);
    expect(selectionToken(row!).owners.find((owner) => owner.text === text)?.tape).toEqual([
      { at: text.length, text: '' }
    ]);
  });

  it('uses the same authored-line image placement across topic roles and sources', () => {
    const roles = ['opening', 'reply', 'quoted-reply', 'accepted-answer', 'signature'] as const;
    const sources = ['linuxdo', 'nodeseek', 'v2ex', 'yaohuo'] as const;

    for (const role of roles) {
      for (const source of sources) {
        const compilation = compileForumContent({
          html:
            '<p>before<img src="https://img.example.com/mixed.png">after</p>' +
            '<p><span> \n <img data-forum-inline-sized="true" src="https://img.example.com/standalone.png"></span></p>' +
            '<p><img src="https://img.example.com/adjacent-a.png"><img src="https://img.example.com/adjacent-b.png"></p>',
          role,
          source
        });
        const html = renderedContentRows(compilation)
          .map((row) => row.html)
          .join('');
        const images = parseHtml(html).querySelectorAll('forum-inline-image, img');
        expect(html, `${source}/${role}`).toContain(
          'before<forum-inline-image src="https://img.example.com/mixed.png">https://img.example.com/mixed.png</forum-inline-image>after'
        );
        expect(
          images.map((image) => image.getAttribute('src')),
          `${source}/${role} order`
        ).toEqual([
          'https://img.example.com/mixed.png',
          'https://img.example.com/standalone.png',
          'https://img.example.com/adjacent-a.png',
          'https://img.example.com/adjacent-b.png'
        ]);
        expect(images.map((image) => image.getAttribute('data-forum-flow-image-context'))).toEqual([
          undefined,
          'standalone',
          undefined,
          undefined
        ]);
        expect(html).not.toContain('data-forum-inline-sized');
        expect(html).not.toContain('<forum-inline-media-line>');
        expect(compilation.previewImages.map((image) => image.source)).toEqual(
          images.map((image) => image.getAttribute('src'))
        );
      }
    }
  });

  it('conserves safe authored content across topic roles and sources while changing presentation', () => {
    const roles = ['opening', 'reply', 'quoted-reply', 'accepted-answer', 'signature'] as const;
    const sources = ['linuxdo', 'nodeseek', 'v2ex', 'yaohuo'] as const;
    const imageUrl = 'https://img.example.com/authored-flow.gif';
    const html =
      `<p>前文<a href="https://example.com/path">链接</a><img src="${imageUrl}"><mark>后文</mark></p>` +
      '<table><tbody><tr><td>表格内容</td></tr></tbody></table>' +
      '<pre><code>代码内容</code></pre>';

    for (const role of roles) {
      for (const source of sources) {
        const compilation = compileForumContent({ html, role, source });
        const renderedRows = renderedContentRows(compilation);
        const renderedHtml = renderedRows.map((row) => row.html).join('');
        const flowImage = parseHtml(renderedHtml).querySelector('forum-inline-image');
        const selectionText = compilation.rows
          .flatMap((row) => selectionToken(row).owners)
          .map((owner) => owner.text)
          .join('\n');

        expect(renderedRows.flatMap(imageUrlsInPlannedRow), `${source}/${role} image`).toEqual([imageUrl]);
        expect(flowImage?.text.trim(), `${source}/${role} fallback`).not.toBe('');
        expect(renderedHtml, `${source}/${role} link`).toContain('href="https://example.com/path"');
        expect(renderedHtml, `${source}/${role} mark`).toContain('<mark>后文</mark>');
        expect(compilation.rows.find((row) => row.type === 'table')?.html, `${source}/${role} table`).toContain(
          '表格内容'
        );
        expect(
          compilation.rows.find((row) => row.type === 'codeBlock'),
          `${source}/${role} code`
        ).toMatchObject({
          text: '代码内容'
        });
        for (const text of ['前文', '链接', '后文', '表格内容', '代码内容']) {
          expect(selectionText, `${source}/${role} selection`).toContain(text);
        }
      }
    }
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
    expect(selectionToken(compilation.rows[1])).toEqual({
      owners: [{ tape: [], text: 'preview', trailing: [{ kind: 'separator', text: '\n' }] }],
      prefix: [],
      version: 1
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

  it.each(['opening', 'reply', 'quoted-reply', 'accepted-answer'] as const)(
    'keeps native audio atomic and ordered in %s detail content',
    (role) => {
      const rows = renderedContentRows(
        compileForumContent({
          html: '<p>before</p><forum-audio src="https://media.example/song.mp3"><a href="https://media.example/song.mp3">open</a></forum-audio><p>after</p>',
          role,
          source: 'linuxdo'
        })
      );

      expect(rows).toHaveLength(3);
      expect(rows[0]?.html).toContain('before');
      expect(rows[1]?.html).toContain('<forum-audio src="https://media.example/song.mp3">');
      expect(rows[1]?.networkMediaCount).toBe(1);
      expect(rows[2]?.html).toContain('after');
    }
  );

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

  it('compiles one ordered UTF-16 selection tape without reparsing row HTML', () => {
    const rows = compileForumContent({
      html:
        '<p>A\ud83d\ude00e\u0301<img class="emoji" width="20" height="20" src="https://img.example/emoji.png" alt="笑">B' +
        '<img class="emoji" width="20" height="20" src="https://img.example/unlabelled.png"></p>' +
        '<h3>配置</h3>' +
        '<table><tbody><tr><th>CPU</th><th>规格</th></tr><tr><td>核心</td><td>1 核<img src="https://img.example/chip.png" title="芯片"></td></tr></tbody></table>' +
        '<forum-sticker-row><forum-sticker src="https://img.example/sticker.webp" title="贴纸">ignored</forum-sticker></forum-sticker-row>' +
        '<pre>const face = "\ud83d\ude00";\n</pre><p>尾声</p>',
      role: 'opening',
      source: 'nodeseek'
    }).rows;

    expect(rows.map((row) => row.type)).toEqual(['richText', 'table', 'richText', 'codeBlock', 'richText']);
    expect(selectionToken(rows[0])).toEqual({
      owners: [
        {
          tape: [
            { at: 5, text: '笑' },
            { at: 6, text: '' }
          ],
          text: 'A\ud83d\ude00e\u0301B',
          trailing: [{ kind: 'separator', text: '\n' }]
        },
        {
          tape: [],
          text: '配置',
          trailing: [{ kind: 'separator', text: '\n' }]
        }
      ],
      prefix: [],
      version: 1
    });
    expect(selectionToken(rows[1]).owners).toEqual([
      { tape: [], text: 'CPU', trailing: [{ kind: 'separator', text: '\t' }] },
      { tape: [], text: '规格', trailing: [{ kind: 'separator', text: '\n' }] },
      { tape: [], text: '核心', trailing: [{ kind: 'separator', text: '\t' }] },
      {
        tape: [{ at: 3, text: '芯片' }],
        text: '1 核',
        trailing: [{ kind: 'separator', text: '\n' }]
      }
    ]);
    expect(selectionToken(rows[2])).toEqual({
      owners: [],
      prefix: [
        { kind: 'media', text: '贴纸' },
        { kind: 'separator', text: '\n' }
      ],
      version: 1
    });
    expect(selectionToken(rows[3]).owners).toEqual([
      {
        tape: [],
        text: 'const face = "\ud83d\ude00";\n',
        trailing: [{ kind: 'separator', text: '\n' }]
      }
    ]);
    expect(selectionToken(rows[4]).owners).toEqual([
      { tape: [], text: '尾声', trailing: [{ kind: 'separator', text: '\n' }] }
    ]);
  });

  it('keeps the two visible newlines from three trailing breaks in one text owner', () => {
    const [row] = compileForumContent({
      html: '<p><font size="6">论坛总规则</font><br><br><br></p>',
      role: 'opening',
      source: 'yaohuo'
    }).rows;

    expect(selectionToken(row).owners[0]?.text).toBe('论坛总规则\n\n');
  });

  it('keeps a visible trailing newline inside nested legacy inline tags', () => {
    const [row] = compileForumContent({
      html: '<p><font size="6"><span>论坛总规则<br><br></span></font></p>',
      role: 'opening',
      source: 'yaohuo'
    }).rows;

    expect(selectionToken(row).owners[0]?.text).toBe('论坛总规则\n');
  });

  it('collapses only the final break at the root text owner boundary', () => {
    const [row] = compileForumContent({
      html: '普通规则正文<br><br>',
      role: 'opening',
      source: 'yaohuo'
    }).rows;

    expect(selectionToken(row).owners[0]?.text).toBe('普通规则正文\n');
  });

  it('collapses a break that becomes terminal only after physical row splitting', () => {
    const images = Array.from(
      { length: 5 },
      (_, index) => `<img src="https://img.example/${index}.webp" alt="图${index}">`
    );
    const rows = compileForumContent({
      html: `<div>正文${images.slice(0, 4).join('')}<br>${images[4]}尾声</div>`,
      role: 'opening',
      source: 'yaohuo'
    }).rows;

    expect(rows).toHaveLength(2);
    expect(rows[0] && 'html' in rows[0] ? rows[0].html : '').toMatch(/<br><\/div>$/);
    expect(selectionToken(rows[0]).owners[0]?.text).toBe('正文');
    expect(selectionToken(rows[1]).owners[0]?.text).toBe('尾声');
  });

  it('records inline and block formula source in the version 1 media tape', () => {
    const rows = compileForumContent({
      html:
        '<p>before <forum-math-inline>\\mathsf{A}</forum-math-inline> after</p>' +
        '<forum-math-block>x=1\\tag{1}</forum-math-block><p>end</p>',
      role: 'opening',
      source: 'linuxdo'
    }).rows;

    expect(selectionToken(rows[0])).toEqual({
      owners: [
        {
          tape: [{ at: 'before '.length, text: '\\mathsf{A}' }],
          text: 'before  after',
          trailing: [{ kind: 'separator', text: '\n' }]
        }
      ],
      prefix: [],
      version: 1
    });
    expect(selectionToken(rows[1])).toEqual({
      owners: [],
      prefix: [
        { kind: 'media', text: 'x=1\\tag{1}' },
        { kind: 'separator', text: '\n' }
      ],
      version: 1
    });
    expect(rows).toHaveLength(3);
    expect(selectionToken(rows[2])).toMatchObject({ owners: [{ text: 'end' }], version: 1 });
  });

  it('keeps inline sticker paragraphs as selection block boundaries', () => {
    const rows = compileForumContent({
      html:
        '<forum-inline-media-line>first <forum-sticker src="https://img.example/a.webp" alt="A">A</forum-sticker></forum-inline-media-line>' +
        '<forum-inline-media-line>second <forum-sticker src="https://img.example/b.webp" alt="B">B</forum-sticker></forum-inline-media-line>',
      role: 'opening',
      source: 'nodeseek'
    }).rows;
    const owners = rows.flatMap((row) => selectionToken(row).owners);
    expect(owners.map((owner) => owner.text)).toEqual(['first', 'second']);
    expect(owners[0]?.trailing).toContainEqual({ kind: 'separator', text: '\n' });
  });

  it('matches RNRH owner boundaries around block and opaque media', () => {
    const blockImageRows = compileForumContent({
      html: '<p>before<br><img src="https://img.example/block.webp" alt="插图"><br>after</p>',
      role: 'opening',
      source: 'nodeseek'
    }).rows;
    const stickerRows = compileForumContent({
      html:
        '<forum-sticker-row>\r\n <forum-sticker src="https://img.example/sticker.webp" title="贴纸">ignored</forum-sticker>' +
        ' \r\n <forum-sticker alt="本地表情">ignored fallback</forum-sticker>\r\n</forum-sticker-row>',
      role: 'opening',
      source: 'nodeseek'
    }).rows;
    const audioRows = compileForumContent({
      html: '<p>before</p><forum-audio src="https://media.example/song.mp3"><a href="https://media.example/song.mp3">fallback child</a></forum-audio><p>after</p>',
      role: 'opening',
      source: 'nodeseek'
    }).rows;

    const blockImage = selectionToken(blockImageRows[0]);
    expect(blockImage).toMatchObject({
      owners: [
        {
          tape: [{ at: 'before\n'.length, text: '插图' }],
          text: 'before\n',
          trailing: []
        },
        {
          tape: [],
          text: '\nafter',
          trailing: [{ kind: 'separator', text: '\n' }]
        }
      ],
      prefix: [],
      version: 1
    });
    expect(selectionToken(stickerRows[0])).toEqual({
      owners: [],
      prefix: [
        { kind: 'media', text: '贴纸' },
        { kind: 'media', text: '本地表情' },
        { kind: 'separator', text: '\n' }
      ],
      version: 1
    });
    expect(audioRows.map(selectionToken)).toEqual([
      { owners: [{ tape: [], text: 'before', trailing: [{ kind: 'separator', text: '\n' }] }], prefix: [], version: 1 },
      {
        owners: [],
        prefix: [
          { kind: 'media', text: '音频' },
          { kind: 'separator', text: '\n' }
        ],
        version: 1
      },
      { owners: [{ tape: [], text: 'after', trailing: [{ kind: 'separator', text: '\n' }] }], prefix: [], version: 1 }
    ]);
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
    expect(tables.flatMap((table) => table.querySelectorAll('tr').map((row) => row.getAttribute('data-row')))).toEqual(
      sourceUrls.map((_, index) => String(index))
    );
    expect(plan.rows.flatMap(imageUrlsInPlannedRow)).toEqual(sourceUrls);
    expect(plan.rows.every((row) => imageUrlsInPlannedRow(row).length <= 4)).toBe(true);
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
        .map((tableRow) => tableRow)
    );

    expect(renderedRowGroups.map((group) => group.map((row) => row.text))).toEqual([
      ['connected', '', '', ''],
      Array.from({ length: 4 }, (_, index) => `independent-${index}`)
    ]);
    expect(plan.rows.map((row) => imageUrlsInPlannedRow(row))).toEqual([
      Array.from({ length: 4 }, (_, index) => `https://img.example/rowspan-${index}.webp`),
      Array.from({ length: 4 }, (_, index) => `https://img.example/after-${index}.webp`)
    ]);
    expect(renderedRowGroups[0]?.[0]?.querySelector('td')?.getAttribute('rowspan')).toBe('4');
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

  it('keeps a compiler fallback notice inside the selection tape', () => {
    const [row] = compileForumContent({
      html: `<img src="https://img.example/oversized.webp" alt="${'x'.repeat(17_000)}">`,
      role: 'opening',
      source: 'nodeseek'
    }).rows;

    expect(row && 'html' in row ? row.html : '').toBe('<p>内容过于复杂，请在原站查看。</p>');
    expect(selectionToken(row)).toEqual({
      owners: [
        {
          tape: [],
          text: '内容过于复杂，请在原站查看。',
          trailing: [{ kind: 'separator', text: '\n' }]
        }
      ],
      prefix: [],
      version: 1
    });
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
    const plannedUrls = rows.flatMap(imageUrlsInPlannedRow);

    expect(rows.every((row) => imageUrlsInPlannedRow(row).length <= 4)).toBe(true);
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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

  it('keeps decoded text in selection owners when planning reaches the depth limit', () => {
    const html = `${'<div>'.repeat(66)}A &amp; B &copy; C${'</div>'.repeat(66)}`;
    const rows = compileForumContent({ html, role: 'opening', source: 'nodeseek' }).rows;
    const ownerText = rows
      .flatMap((row) => selectionToken(row).owners)
      .map((owner) => owner.text)
      .join('');
    expect(ownerText).toContain('A & B © C');
    expect(ownerText).not.toContain('&amp;');
    expect(ownerText).not.toContain('&copy;');
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
    expect(imageUrlsInPlannedRow(rows[1])).toEqual(['https://img.example/discrete.webp']);
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
    expect(plan.rows.flatMap((row) => ('html' in row ? imageUrlsInPlannedRow(row) : []))).toEqual(sourceUrls);
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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
      FORUM_AUDIO_TAG: 'forum-audio',
      FORUM_LINK_CARD_TAG: 'forum-link-card',
      FORUM_MATH_BLOCK_TAG: 'forum-math-block',
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
