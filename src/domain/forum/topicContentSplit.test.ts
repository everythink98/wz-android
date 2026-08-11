import { describe, expect, it, vi } from 'vitest';
import { parseHtml } from './html';
import { compileForumContent, type CompiledForumContent, type CompiledForumContentRow } from './topicContentSplit';

function renderedContentRows(compilation: Pick<CompiledForumContent, 'rows'>) {
  return compilation.rows.filter(
    (row): row is Extract<CompiledForumContentRow, { type: 'html' | 'video' }> =>
      row.type === 'html' || row.type === 'video'
  );
}

function planForumContent(html: string | undefined) {
  const compilation = compileForumContent({ html, role: 'opening', source: 'nodeseek' });
  return {
    rows: compilation.rows.flatMap((row) => {
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

function domNodeCount(html: string) {
  const body = parseHtml(`<body>${html}</body>`).querySelector('body');
  const pending = [...(body?.childNodes || [])];
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    count += 1;
    pending.push(...(current.childNodes || []));
  }
  return count;
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
  it('[REG-PERF-010] compiles nested opening quotes and polls into ordered typed parent rows', () => {
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

    expect(compilation.rows.map((row) => row.type)).toEqual(['html', 'quote', 'html', 'poll', 'html']);
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

  it('[REG-PERF-010] lifts a nested poll marker to its original parent-row position', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<section><p>before</p><div><forum-discourse-poll name="choice"></forum-discourse-poll></div><p>after</p></section>';

    const compilation = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' });

    expect(compilation.rows.map((row) => row.type)).toEqual(['html', 'poll', 'html']);
    expect(compilation.rows[0]).toMatchObject({
      html: '<div class="forum-reply-content"><section><p>before</p></section></div>',
      type: 'html'
    });
    expect(compilation.rows[1]).toMatchObject({ poll, type: 'poll' });
    expect(compilation.rows[2]).toMatchObject({
      html: '<div class="forum-reply-content"><section><p>after</p></section></div>',
      type: 'html'
    });
  });

  it('[REG-PERF-010] preserves poll order when a typed marker appears inside a table cell', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<p>before</p><table><tbody><tr><td>cell-before<forum-discourse-poll name="choice"></forum-discourse-poll>cell-after</td></tr></tbody></table><p>end</p>';

    const compilation = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' });
    const orderedContent = compilation.rows.map((row) =>
      row.type === 'poll' ? 'POLL' : row.type === 'quote' ? 'QUOTE' : parseHtml(row.html).text
    );

    expect(compilation.rows.map((row) => row.type)).toEqual(['html', 'poll', 'html']);
    expect(orderedContent).toEqual(['beforecell-before', 'POLL', 'cell-afterend']);
  });

  it('[REG-PERF-010] fail-closes an opaque island instead of moving its typed marker to the end', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<p>before</p><forum-link-card href="https://example.com"><span>island-before</span><forum-discourse-poll name="choice"></forum-discourse-poll><span>island-after</span></forum-link-card><p>after</p>';

    const compilation = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' });
    const orderedContent = compilation.rows.map((row) =>
      row.type === 'poll' ? 'POLL' : row.type === 'quote' ? 'QUOTE' : parseHtml(row.html).text
    );

    expect(compilation.rows.map((row) => row.type)).toEqual(['html', 'poll', 'html']);
    expect(orderedContent[0]).toContain('before内容过于复杂');
    expect(orderedContent[1]).toBe('POLL');
    expect(orderedContent[2]).toBe('after');
    expect(renderedContentRows(compilation).every((row) => !row.html.includes('forum-link-card'))).toBe(true);
  });

  it('[REG-PERF-010] preserves ancestor identity, disclosure, and ordered-list continuation around typed rows', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const html =
      '<details id="panel" name="shared" open><summary>Title</summary><ol id="steps" start="7"><li id="entry">before<forum-discourse-poll name="choice"></forum-discourse-poll>after</li><li>tail</li></ol></details>';

    const rows = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' }).rows;
    const htmlRows = rows.filter(
      (row): row is Extract<CompiledForumContentRow, { type: 'html' | 'video' }> =>
        row.type === 'html' || row.type === 'video'
    );
    const parsed = htmlRows.map((row) => parseHtml(row.html));

    expect(rows.map((row) => row.type)).toEqual(['html', 'poll', 'html']);
    expect(
      htmlRows
        .map((row) => row.html)
        .join('')
        .match(/\bid="panel"/g)
    ).toHaveLength(1);
    expect(
      htmlRows
        .map((row) => row.html)
        .join('')
        .match(/\bname="shared"/g)
    ).toHaveLength(1);
    expect(
      htmlRows
        .map((row) => row.html)
        .join('')
        .match(/\bid="steps"/g)
    ).toHaveLength(1);
    expect(
      htmlRows
        .map((row) => row.html)
        .join('')
        .match(/\bid="entry"/g)
    ).toHaveLength(1);
    expect(
      htmlRows
        .map((row) => row.html)
        .join('')
        .match(/<summary\b/g)
    ).toHaveLength(1);
    expect(parsed.map((root) => root.querySelector('details')?.getAttribute('data-wz-details-part'))).toEqual([
      'first',
      'last'
    ]);
    expect(
      new Set(parsed.map((root) => root.querySelector('details')?.getAttribute('data-wz-details-group'))).size
    ).toBe(1);
    expect(parsed.map((root) => root.querySelector('ol')?.getAttribute('start'))).toEqual(['7', '7']);
    expect(parsed[0]?.querySelectorAll('li').map((node) => node.getAttribute('value'))).toEqual(['7']);
    expect(parsed[1]?.querySelectorAll('li').map((node) => node.getAttribute('value'))).toEqual(['7', '8']);
    expect(parsed[1]?.querySelector('li')?.getAttribute('data-wz-list-continuation')).toBe('true');
  });

  it('[REG-PERF-010] keeps one disclosure group when both sides of a typed row need further planning', () => {
    const poll = { name: 'choice', options: [{ id: 'a', label: 'A' }] };
    const images = (prefix: string) =>
      Array.from({ length: 5 }, (_, index) => `<img src="https://img.example/${prefix}-${index}.webp">`).join('');
    const html = `<details id="panel"><summary>Title</summary><p>${images(
      'before'
    )}</p><forum-discourse-poll name="choice"></forum-discourse-poll><p>${images('after')}</p></details>`;

    const rows = compileForumContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' }).rows;
    const htmlRows = renderedContentRows({ rows });
    const details = htmlRows.map((row) => parseHtml(row.html).querySelector('details'));

    expect(rows.map((row) => row.type)).toEqual(['html', 'html', 'poll', 'html', 'html']);
    const detailGroups = new Set(details.map((node) => node?.getAttribute('data-wz-details-group')));
    expect(detailGroups.size).toBe(1);
    expect([...detailGroups][0]).toMatch(/^compile-/);
    expect(details.map((node) => node?.getAttribute('data-wz-details-part'))).toEqual([
      'first',
      'middle',
      'middle',
      'last'
    ]);
    expect(
      htmlRows
        .map((row) => row.html)
        .join('')
        .match(/\bid="panel"/g)
    ).toHaveLength(1);
    expect(
      htmlRows
        .map((row) => row.html)
        .join('')
        .match(/<summary\b/g)
    ).toHaveLength(1);
  });

  it('[REG-PERF-010] parses an ordinary native-video document exactly once', async () => {
    vi.resetModules();
    const actualHtml = await vi.importActual<typeof import('./html')>('./html');
    const trackedParseHtml = vi.fn(actualHtml.parseHtml);
    vi.doMock('./html', () => ({ ...actualHtml, parseHtml: trackedParseHtml }));
    try {
      const { compileForumContent: compileTrackedContent } = await import('./topicContentSplit');

      const compilation = compileTrackedContent({
        html: '<forum-video src="https://media.example/video.mp4"></forum-video>',
        role: 'reply',
        source: 'yaohuo'
      });

      expect(compilation.rows).toEqual([
        expect.objectContaining({ src: 'https://media.example/video.mp4', type: 'video' })
      ]);
      expect(trackedParseHtml).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('[REG-PERF-010] keeps native video rows ordered around a typed poll marker', () => {
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

  it('[REG-PERF-010] parses one hostile 2000-image document exactly once', async () => {
    vi.resetModules();
    const actualHtml = await vi.importActual<typeof import('./html')>('./html');
    const trackedParseHtml = vi.fn(actualHtml.parseHtml);
    vi.doMock('./html', () => ({ ...actualHtml, parseHtml: trackedParseHtml }));
    try {
      const { compileForumContent: compileTrackedContent } = await import('./topicContentSplit');
      const html = `<p>${Array.from(
        { length: 2_000 },
        (_, index) => `<img src="https://img.example/${index}.webp">`
      ).join('')}</p>`;

      const compilation = compileTrackedContent({ html, role: 'reply', source: 'nodeseek' });

      expect(compilation.rows).toHaveLength(500);
      expect(trackedParseHtml).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('[REG-PERF-010] parses one hostile document with 1000 typed markers exactly once', async () => {
    vi.resetModules();
    const actualHtml = await vi.importActual<typeof import('./html')>('./html');
    const trackedParseHtml = vi.fn(actualHtml.parseHtml);
    vi.doMock('./html', () => ({ ...actualHtml, parseHtml: trackedParseHtml }));
    try {
      const { compileForumContent: compileTrackedContent } = await import('./topicContentSplit');
      const poll = { name: 'choice', options: [{ id: 'yes', label: 'Yes' }] };
      const html = Array.from(
        { length: 1_000 },
        (_, index) => `<span>part-${index}</span><forum-discourse-poll name="choice"></forum-discourse-poll>`
      ).join('');

      const compilation = compileTrackedContent({ html, polls: [poll], role: 'reply', source: 'linuxdo' });

      expect(compilation.rows).toHaveLength(2_000);
      expect(compilation.rows.filter((row) => row.type === 'html')).toHaveLength(1_000);
      expect(compilation.rows.filter((row) => row.type === 'poll')).toHaveLength(1_000);
      expect(trackedParseHtml).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('[REG-PERF-010] bounds over-deep opening quote candidates in the single compiler parse', async () => {
    vi.resetModules();
    const actualHtml = await vi.importActual<typeof import('./html')>('./html');
    const trackedParseHtml = vi.fn(actualHtml.parseHtml);
    vi.doMock('./html', () => ({ ...actualHtml, parseHtml: trackedParseHtml }));
    try {
      const { compileForumContent: compileTrackedContent } = await import('./topicContentSplit');
      const html = `${'<aside>'.repeat(1_000)}body${'</aside>'.repeat(1_000)}`;

      const compilation = compileTrackedContent({
        html,
        role: 'opening',
        source: 'linuxdo',
        topicId: '42'
      });
      const rows = renderedContentRows(compilation);

      expect(trackedParseHtml).toHaveBeenCalledTimes(1);
      expect(compilation.rows.every((row) => row.type === 'html')).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
      expect(rows.every((row) => maxElementDepth(row.html) <= 64)).toBe(true);
    } finally {
      vi.doUnmock('./html');
      vi.resetModules();
    }
  });

  it('[REG-PERF-010] keeps a 2000-image paragraph ordered while bounding every planned row', () => {
    const sourceUrls = Array.from({ length: 2000 }, (_, index) => `https://img.example/${index}.webp`);
    const html = `<p>${sourceUrls.map((src, index) => `<img src="${src}" alt="image-${index}">`).join('')}</p>`;

    const plan = planForumContent(html);
    const rows = plan.rows;
    const plannedUrls = rows.flatMap((row) =>
      parseHtml(row.html)
        .querySelectorAll('img')
        .map((image) => image.getAttribute('src'))
    );

    expect(rows).toHaveLength(500);
    expect(rows.every((row) => parseHtml(row.html).querySelectorAll('img').length <= 4)).toBe(true);
    expect(plannedUrls).toEqual(sourceUrls);
  });

  it('[REG-PERF-010] budgets every rendered forum sticker source while keeping text-only sticker labels local', () => {
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

  it('[REG-PERF-010] budgets every canonical inline-image source without charging a text-only label', () => {
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

  it('[REG-PERF-010] preserves ordinary safe HTML as one unchanged row', () => {
    const html = '<p class="message">ordinary <strong>formatted</strong> content</p>';

    expect(planForumContent(html)).toEqual({
      rows: [
        {
          continuation: 'only',
          groupKey: 'block-0',
          html,
          keySuffix: 'block-0:0',
          networkMediaCount: 0
        }
      ]
    });
  });

  it('[REG-PERF-010] preserves an ordinary table byte-for-byte', () => {
    const html =
      '<table class="comparison"><tbody><tr><th>Name</th><th>Value</th></tr><tr><td>Alpha</td><td>1</td></tr></tbody></table>';

    const plan = planForumContent(html);

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.html).toBe(html);
    expect(plan.rows[0]?.continuation).toBe('only');
  });

  it('[REG-PERF-010] groups a multi-row table only at complete tr boundaries', () => {
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
        parseHtml(row.html)
          .querySelectorAll('img')
          .map((image) => image.getAttribute('src'))
      )
    ).toEqual(sourceUrls);
    expect(plan.rows.every((row) => parseHtml(row.html).querySelectorAll('img').length <= 4)).toBe(true);
    expect(plan.rows.every((row) => domNodeCount(row.html) <= 80)).toBe(true);
    expect(plan.rows.every((row) => maxElementDepth(row.html) <= 64)).toBe(true);
    expect(plan.rows.every((row) => row.html.length <= 16_384)).toBe(true);
  });

  it('[REG-PERF-010] splits one oversized tr only along its safe descendants', () => {
    const sourceUrls = Array.from({ length: 9 }, (_, index) => `https://img.example/table-cell-${index}.webp`);
    const html = `<table><tbody><tr id="oversized-row"><td class="label">One logical row</td><td class="media">${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}</td></tr></tbody></table>`;

    const plan = planForumContent(html);
    const tables = plan.rows.map((row) => parsedBalancedTable(row.html));
    const plannedRows = tables.map((table) => table.querySelectorAll('tr'));

    expect(plan.rows).toHaveLength(3);
    expect(plannedRows.map((rows) => rows.length)).toEqual([1, 1, 1]);
    expect(plannedRows.map((rows) => rows[0]?.getAttribute('id'))).toEqual(['oversized-row', undefined, undefined]);
    expect(tables.map((table) => table.querySelectorAll('td.label').length)).toEqual([1, 0, 0]);
    expect(tables.map((table) => table.querySelectorAll('img').length)).toEqual([4, 4, 1]);
    expect(
      plan.rows.flatMap((row) =>
        parseHtml(row.html)
          .querySelectorAll('img')
          .map((image) => image.getAttribute('src'))
      )
    ).toEqual(sourceUrls);
    expect(plan.rows.every((row) => domNodeCount(row.html) <= 80)).toBe(true);
    expect(plan.rows.every((row) => maxElementDepth(row.html) <= 64)).toBe(true);
    expect(plan.rows.every((row) => row.html.length <= 16_384)).toBe(true);
  });

  it('[REG-PERF-010] replaces one oversized interactive island instead of cloning it across rows', () => {
    const html = `<forum-terminal-report id="single-report">${Array.from(
      { length: 100 },
      (_, index) => `<forum-terminal-tab title="tab-${index}"><p>${'content '.repeat(40)}</p></forum-terminal-tab>`
    ).join('')}</forum-terminal-report>`;

    const plan = planForumContent(html);

    expect(plan.rows).toEqual([
      expect.objectContaining({
        html: '<p>内容过于复杂，请在原站查看。</p>',
        networkMediaCount: 0
      })
    ]);
    expect(plan.rows[0]?.html).not.toContain('forum-terminal-report');
    expect(plan.rows[0]?.html.length).toBeLessThanOrEqual(16_384);
  });

  it('[REG-PERF-010] bounds hostile nesting without losing ordered media', () => {
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

  it('[REG-PERF-010] keeps parser fallback output bounded and ordered', async () => {
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

  it('[REG-PERF-010] fail-closes every unsafe row in a multi-fragment parser fallback', async () => {
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

  it('[REG-PERF-010] enforces node and serialized-size budgets in addition to media count', () => {
    const text = '正文'.repeat(9000);
    const html = `<div>${Array.from({ length: 160 }, (_, index) => `<span>${index}</span>`).join('')}<p>${text}</p></div>`;

    const rows = planForumContent(html).rows;

    expect(rows.length).toBeGreaterThan(2);
    expect(rows.every((row) => domNodeCount(row.html) <= 80)).toBe(true);
    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => parseHtml(row.html).text).join('')).toContain(text);
  });

  it('[REG-PERF-010] never combines a large wrapper and child into an oversized row', () => {
    const html = `<div data-note="${'a'.repeat(9_000)}"><span>${'b'.repeat(9_000)}</span></div>`;

    const rows = planForumContent(html).rows;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => parseHtml(row.html).text).join('')).toBe('b'.repeat(9_000));
  });

  it('[REG-PERF-010] splits oversized text without breaking an entity or Unicode grapheme', () => {
    const visibleText = `${'a'.repeat(11_999)}👩‍💻&tail${'b'.repeat(4_500)}`;
    const html = `<p>${visibleText.replace('&', '&amp;')}</p>`;

    const rows = planForumContent(html).rows;
    const rowTexts = rows.map((row) => parseHtml(row.html).text);

    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rowTexts.join('')).toBe(visibleText);
    expect(rowTexts.every((text) => !/[\uD800-\uDBFF]$/.test(text) && !/^[\uDC00-\uDFFF]/.test(text))).toBe(true);
  });

  it('[REG-PERF-010] keeps an anchor identity only on the first continuation row', () => {
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

  it('[REG-PERF-010] continues ordered-list numbering across planned rows', () => {
    const html = `<ol start="3">${Array.from(
      { length: 9 },
      (_, index) => `<li>item ${index}<img src="https://img.example/list-${index}.webp"></li>`
    ).join('')}</ol>`;

    const rows = planForumContent(html).rows;

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => parseHtml(row.html).querySelector('ol')?.getAttribute('start'))).toEqual(['3', '7', '11']);
  });

  it('[REG-PERF-010] keeps one logical ordered-list item number across its media continuations', () => {
    const sourceUrls = Array.from({ length: 10 }, (_, index) => `https://img.example/list-continuation-${index}.webp`);
    const html = `<ol start="3"><li id="first-item">${sourceUrls
      .slice(0, 9)
      .map((src) => `<img src="${src}">`)
      .join('')}</li><li id="second-item"><img src="${sourceUrls[9]}"></li></ol>`;

    const rows = planForumContent(html).rows;
    const lists = rows.map((row) => parseHtml(row.html).querySelector('ol'));
    const listItems = lists.map((list) => list?.querySelectorAll('li') || []);

    expect(rows).toHaveLength(3);
    expect(lists.map((list) => list?.getAttribute('start'))).toEqual(['3', '3', '3']);
    expect(listItems.map((items) => items.map((item) => item.getAttribute('value')))).toEqual([
      ['3'],
      ['3'],
      ['3', '4']
    ]);
    expect(listItems.map((items) => items.map((item) => item.getAttribute('data-wz-list-continuation')))).toEqual([
      [undefined],
      ['true'],
      ['true', undefined]
    ]);
    expect(
      listItems
        .flat()
        .filter((item) => item.getAttribute('data-wz-list-continuation') === 'true')
        .every((item) => /list-style-type\s*:\s*none/i.test(item.getAttribute('style') || ''))
    ).toBe(true);
    expect(
      rows.flatMap((row) =>
        parseHtml(row.html)
          .querySelectorAll('img')
          .map((image) => image.getAttribute('src'))
      )
    ).toEqual(sourceUrls);
  });

  it('[REG-PERF-010] gives oversized details fragments one stable group and unique part semantics', () => {
    const sourceUrls = Array.from({ length: 9 }, (_, index) => `https://img.example/details-${index}.webp`);
    const html = `<details id="details-anchor" name="details-name" data-wz-details-group="spoof" data-wz-details-part="last"><summary>Stable summary</summary><p>${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}</p></details>`;

    const plan = planForumContent(html);
    const repeatedPlan = planForumContent(html);
    const details = plan.rows.map((row) => parseHtml(row.html).querySelector('details'));

    expect(plan.rows).toHaveLength(3);
    const group = details[0]?.getAttribute('data-wz-details-group');
    expect(group).toBeTruthy();
    expect(group).not.toBe('spoof');
    expect(details.map((node) => node?.getAttribute('data-wz-details-group'))).toEqual([group, group, group]);
    expect(
      repeatedPlan.rows.map((row) =>
        parseHtml(row.html).querySelector('details')?.getAttribute('data-wz-details-group')
      )
    ).toEqual([group, group, group]);
    expect(details.map((node) => node?.getAttribute('data-wz-details-part'))).toEqual(['first', 'middle', 'last']);
    expect(details.map((node) => node?.querySelectorAll('summary').length)).toEqual([1, 0, 0]);
    expect(details.map((node) => node?.getAttribute('id'))).toEqual(['details-anchor', undefined, undefined]);
    expect(details.map((node) => node?.getAttribute('name'))).toEqual(['details-name', undefined, undefined]);
    expect(
      plan.rows.flatMap((row) =>
        parseHtml(row.html)
          .querySelectorAll('img')
          .map((image) => image.getAttribute('src'))
      )
    ).toEqual(sourceUrls);
  });

  it('[REG-PERF-010] keeps one oversized Discourse callout identity while showing its title once', () => {
    const sourceUrls = Array.from({ length: 9 }, (_, index) => `https://img.example/callout-${index}.webp`);
    const html = `<blockquote data-forum-callout="true" data-forum-callout-type="warning" data-forum-callout-fold="collapsed" data-wz-callout-group="spoof" data-wz-callout-part="last"><div class="forum-callout-title forum-callout-tone-warning">Warning title</div><div class="forum-callout-content">${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}</div></blockquote>`;

    const plan = planForumContent(html);
    const repeatedPlan = planForumContent(html);
    const callouts = plan.rows.map((row) => parseHtml(row.html).querySelector('blockquote'));

    expect(plan.rows).toHaveLength(3);
    const group = callouts[0]?.getAttribute('data-wz-callout-group');
    expect(group).toBeTruthy();
    expect(group).not.toBe('spoof');
    expect(callouts.map((node) => node?.getAttribute('data-wz-callout-group'))).toEqual([group, group, group]);
    expect(
      repeatedPlan.rows.map((row) =>
        parseHtml(row.html).querySelector('blockquote')?.getAttribute('data-wz-callout-group')
      )
    ).toEqual([group, group, group]);
    expect(callouts.map((node) => node?.getAttribute('data-wz-callout-part'))).toEqual(['first', 'middle', 'last']);
    expect(callouts.map((node) => node?.getAttribute('data-forum-callout-type'))).toEqual([
      'warning',
      'warning',
      'warning'
    ]);
    expect(callouts.map((node) => node?.getAttribute('data-forum-callout-fold'))).toEqual([
      'collapsed',
      'collapsed',
      'collapsed'
    ]);
    expect(callouts.map((node) => node?.querySelectorAll('.forum-callout-title').length)).toEqual([1, 0, 0]);
    expect(
      plan.rows.flatMap((row) =>
        parseHtml(row.html)
          .querySelectorAll('img')
          .map((image) => image.getAttribute('src'))
      )
    ).toEqual(sourceUrls);
  });

  it('[REG-PERF-010] preserves an ordinary Discourse callout byte-for-byte', () => {
    const html =
      '<blockquote data-forum-callout="true" data-forum-callout-type="tip"><div class="forum-callout-title forum-callout-tone-primary">Tip title</div><div class="forum-callout-content"><p>Short body</p></div></blockquote>';

    const plan = planForumContent(html);

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.html).toBe(html);
    expect(plan.rows[0]?.continuation).toBe('only');
    expect(plan.rows[0]?.html).not.toContain('data-wz-callout-');
  });

  it('[REG-PERF-010] emits one bounded title when a Discourse callout title is itself oversized', () => {
    const sourceUrls = Array.from({ length: 5 }, (_, index) => `https://img.example/callout-title-${index}.webp`);
    const html = `<blockquote data-forum-callout="true" data-forum-callout-type="danger"><div class="forum-callout-title forum-callout-tone-danger">${'Oversized title '.repeat(
      2_000
    )}</div><div class="forum-callout-content">${sourceUrls
      .map((src) => `<img src="${src}">`)
      .join('')}</div></blockquote>`;

    const plan = planForumContent(html);
    const titleCounts = plan.rows.map((row) => parseHtml(row.html).querySelectorAll('.forum-callout-title').length);

    expect(titleCounts[0]).toBe(1);
    expect(titleCounts.reduce((total, count) => total + count, 0)).toBe(1);
    expect(parseHtml(plan.rows[0]?.html || '').querySelector('.forum-callout-title')?.text).toContain('内容过于复杂');
    expect(plan.rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(
      plan.rows.flatMap((row) =>
        parseHtml(row.html)
          .querySelectorAll('img')
          .map((image) => image.getAttribute('src'))
      )
    ).toEqual(sourceUrls);
  });

  it('[REG-PERF-010] never returns an oversized parser-fallback row for hostile text', async () => {
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

  it('[REG-PERF-010] enforces node and depth budgets when the parser fallback receives deep HTML', async () => {
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

  it('[REG-PERF-010] never returns giant unmatched closing tags when parsing produces no body nodes', () => {
    const html = '</div>'.repeat(5_000);

    const rows = planForumContent(html).rows;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => row.html).join('')).not.toBe(html);
  });

  it('[REG-PERF-010] never returns a giant comment when parsing produces no renderable body nodes', () => {
    const html = `<!--${'comment'.repeat(5_000)}-->`;

    const rows = planForumContent(html).rows;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => row.html).join('')).not.toBe(html);
  });

  it('[REG-PERF-010] does not restore a giant trailing comment discarded after safe parsed content', () => {
    const html = `<p>safe body</p><!--${'comment'.repeat(5_000)}-->`;

    const rows = planForumContent(html).rows;

    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => row.html).join('')).toBe('<p>safe body</p>');
  });

  it('[REG-PERF-010] does not restore giant trailing closing tags discarded after safe parsed content', () => {
    const html = `<p>safe body</p>${'</div>'.repeat(5_000)}`;

    const rows = planForumContent(html).rows;

    expect(rows.every((row) => row.html.length <= 16_384)).toBe(true);
    expect(rows.map((row) => row.html).join('')).toBe('<p>safe body</p>');
  });

  it.each(['forum-video', 'video'])(
    '[REG-PERF-010] counts a %s source and poster as two potential network media',
    (tag) => {
      const plan = planForumContent(
        `<${tag} src="https://media.example/demo.mp4" poster="https://media.example/poster.webp"></${tag}>`
      );

      expect(plan.rows[0]?.networkMediaCount).toBe(2);
    }
  );

  it.each(['forum-video', 'video'])(
    '[REG-PERF-010] counts a %s source and poster in parser fallback media budgets',
    async (tag) => {
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
    }
  );

  it('[REG-PERF-010] keeps forum sticker sources bounded in parser fallback rows', async () => {
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

  it('[REG-PERF-010] keeps canonical inline-image sources bounded in parser fallback rows', async () => {
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

  it('[REG-PERF-010] counts unquoted link-card artwork in parser fallback media budgets', async () => {
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

  it('does not treat mixed content as a standalone video block', () => {
    expect(
      compileForumContent({
        html: '<p>before</p><forum-video src="https://yaohuo.me/uploads/demo.mp4"></forum-video>',
        role: 'reply',
        source: 'yaohuo'
      }).rows.map((row) => row.type)
    ).toEqual(['html']);
  });
});
