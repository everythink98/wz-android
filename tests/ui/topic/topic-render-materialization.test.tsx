import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { render } from '../render';
import { parseHtml } from '@/domain/forum/html';
import { compileForumContent, resolveForumContentRowHtml } from '@/domain/forum/topicContentSplit';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';

jest.mock('react-native-render-html', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    RenderHTMLSource: ({ contentWidth, source }: { contentWidth: number; source: { html: string } }) =>
      ReactModule.createElement(NativeView, {
        accessibilityHint: source.html,
        style: { width: contentWidth },
        testID: 'render-html-source'
      })
  };
});

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

function renderedHtml(view: Awaited<ReturnType<typeof render>>) {
  return view.getByTestId('render-html-source').props.accessibilityHint as string;
}

describe('render-ready forum content rows', () => {
  it('[REG-PERF-010] forwards compiler-owned HTML to RenderHTMLSource without a post-compile wrapper or rewrite', async () => {
    const [row] = compileForumContent({
      html: '<p>already <forum-inline-image src="https://cdn.example/smile.png">smile</forum-inline-image></p>',
      role: 'reply',
      source: 'nodeseek'
    }).rows;
    if (!row || row.type !== 'richText') throw new Error('Expected one rich-text row.');
    const view = await render(<TopicContentBlock contentWidth={360} row={row} trimTrailingBlockSpacing />);

    expect(renderedHtml(view)).toBe(row.html);
  });

  it('[REG-PERF-010] budgets the compact presentation shell in the final RenderHTMLSource HTML', async () => {
    const compilation = compileForumContent({
      html: Array.from({ length: 40 }, (_, index) => `<p>node-${index}</p>`).join(''),
      role: 'reply',
      source: 'v2ex'
    });
    const rows = compilation.rows.filter((row) => row.type === 'richText');

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const view = await render(<TopicContentBlock contentWidth={360} row={row} />);
      const source = renderedHtml(view);
      expect(source).toBe(row.html);
      expect(domNodeCount(source)).toBeLessThanOrEqual(80);
      await view.unmount();
    }
  });

  it('[REG-PERF-010] compiles NodeSeek reply references and sticker expansion before row budgeting', async () => {
    const compilation = compileForumContent({
      html: '<p><a href="/member?t=alice">@alice</a> <a href="/post-123-1#2">#2</a> hello <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" alt="ac01"></p>',
      role: 'reply',
      source: 'nodeseek'
    });
    const row = compilation.rows.find((candidate) => candidate.type === 'richText');
    expect(row?.type).toBe('richText');
    if (!row || row.type !== 'richText') return;

    const view = await render(<TopicContentBlock contentWidth={360} row={row} />);
    const source = renderedHtml(view);

    expect(row.html).toContain('<forum-reply-reference');
    expect(row.html).toContain('<forum-inline-media-line>');
    expect(source).toBe(row.html);
    expect(domNodeCount(source)).toBeLessThanOrEqual(80);
  });

  it('[REG-PERF-010] keeps a dynamic V2EX image in compiler-owned bounded variants without rewriting the row', async () => {
    const imageUrl = 'https://i.imgur.com/dynamic.png';
    const compilation = compileForumContent({
      html: `<p>before <img class="embedded_image" src="${imageUrl}"> after</p>`,
      role: 'reply',
      source: 'v2ex'
    });
    const row = compilation.rows.find((candidate) => candidate.type === 'richText');
    expect(row?.type).toBe('richText');
    if (!row || row.type !== 'richText') return;

    const unknownView = await render(
      <TopicContentBlock contentWidth={360} html={resolveForumContentRowHtml(row, {})} row={row} />
    );
    const learnedView = await render(
      <TopicContentBlock contentWidth={360} html={resolveForumContentRowHtml(row, { [imageUrl]: true })} row={row} />
    );

    expect(renderedHtml(unknownView)).toBe(row.html);
    expect(renderedHtml(learnedView)).toContain('<forum-inline-image');
    expect(renderedHtml(learnedView)).not.toContain('<img class="embedded_image"');
  });
});
