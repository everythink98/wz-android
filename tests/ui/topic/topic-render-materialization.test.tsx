import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '../render';
import { domNodeCount } from '../../helpers/domNodeCount';
import { compileForumContent } from '@/domain/forum/topicContentSplit';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import type { ForumSelectionDocument, ForumSelectionNode } from '@/features/topic/rendering/forumSelectionDocument';

jest.mock('react-native-render-html', () => {
  const actual = jest.requireActual('react-native-render-html') as typeof import('react-native-render-html');
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  const { forumSelectionTestEngine: testEngine } =
    require('../../helpers/forumSelectionEngine') as typeof import('../../helpers/forumSelectionEngine');
  return {
    ...actual,
    RenderHTMLSource: ({ contentWidth, source }: { contentWidth: number; source: { html: string } }) => {
      testEngine.buildTTree(source.html);
      return ReactModule.createElement(NativeView, {
        accessibilityHint: source.html,
        style: { width: contentWidth },
        testID: 'render-html-source'
      });
    },
    TNodeRenderer: ({ tnode }: { tnode: { attributes: Readonly<Record<string, string>>; tagName?: string } }) =>
      ReactModule.createElement(NativeView, {
        accessibilityHint: JSON.stringify({ attributes: tnode.attributes, tagName: tnode.tagName }),
        testID: 'render-tnode'
      }),
    useAmbientTRenderEngine: () => testEngine
  };
});

const { forumSelectionTestEngine: selectionEngine } = jest.requireActual(
  '../../helpers/forumSelectionEngine'
) as typeof import('../../helpers/forumSelectionEngine');

function renderedTNode(view: Awaited<ReturnType<typeof render>>) {
  return JSON.parse(view.getByTestId('render-tnode').props.accessibilityHint as string) as {
    attributes: Record<string, string>;
    tagName: string;
  };
}

function nativeContent(view: Awaited<ReturnType<typeof render>>) {
  return JSON.parse(
    view.getByTestId('native-forum-selection-surface').props.content as string
  ) as ForumSelectionDocument;
}

function allNodes(nodes: readonly ForumSelectionNode[]): ForumSelectionNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.type === 'block' || node.type === 'listItem' ? allNodes(node.children) : []),
    ...(node.type === 'table' ? node.rows.flatMap((row) => row.cells.flatMap((cell) => allNodes(cell.children))) : [])
  ]);
}

function nativeText(document: ForumSelectionDocument) {
  return allNodes(document.nodes)
    .flatMap((node) =>
      node.type === 'text'
        ? [
            ...node.parts.flatMap((part) => (part.type === 'run' ? [part.text] : [])),
            ...(node.copyBreakAfter ? ['\n'] : [])
          ]
        : []
    )
    .join('');
}

describe('render-ready forum content regions', () => {
  it('[REG-PERF-019] builds one tree for a media region and reuses its media nodes after height changes', async () => {
    const [region] = compileForumContent({
      html: `<p>${Array.from({ length: 4 }, (_, index) => `<img src="https://cdn.example/${index}.png">`).join(
        ''
      )}</p>`,
      role: 'reply',
      source: 'nodeseek'
    }).regions;
    if (!region || region.kind !== 'selectable') throw new Error('Expected one selectable region.');
    const buildTTree = jest.spyOn(selectionEngine, 'buildTTree');
    try {
      const view = await render(<TopicContentBlock contentWidth={360} region={region} trimTrailingBlockSpacing />);

      expect(buildTTree).toHaveBeenCalledTimes(1);
      expect(view.queryAllByTestId('render-html-source')).toHaveLength(0);
      expect(view.getAllByTestId('render-tnode')).toHaveLength(4);
      expect(JSON.stringify(nativeContent(view))).not.toContain('"html":');

      const surface = view.getByTestId('native-forum-selection-surface');
      await act(async () =>
        surface.props.onContentSizeChange({ nativeEvent: { height: 960, layoutKey: surface.props.layoutKey } })
      );
      expect(buildTTree).toHaveBeenCalledTimes(1);
    } finally {
      buildTTree.mockRestore();
    }
  });

  it('[REG-PERF-010] keeps every materialized native region inside the compiler DOM budget', async () => {
    const compilation = compileForumContent({
      html: Array.from({ length: 40 }, (_, index) => `<p>node-${index}</p>`).join(''),
      role: 'reply',
      source: 'v2ex'
    });
    const regions = compilation.regions.filter((region) => region.kind === 'selectable');

    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      const view = await render(<TopicContentBlock contentWidth={360} region={region} />);
      expect(region.segments.every((segment) => !('html' in segment) || domNodeCount(segment.html) <= 80)).toBe(true);
      expect(JSON.stringify(nativeContent(view))).not.toContain('"html":');
      await view.unmount();
    }
  });

  it('[REG-PERF-010] compiles NodeSeek reply references and sticker expansion before row budgeting', async () => {
    const compilation = compileForumContent({
      html: '<p><a href="/member?t=alice">@alice</a> <a href="/post-123-1#2">#2</a> hello <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" alt="ac01"></p>',
      role: 'reply',
      source: 'nodeseek'
    });
    const region = compilation.regions.find((candidate) => candidate.kind === 'selectable');
    expect(region?.kind).toBe('selectable');
    if (!region || region.kind !== 'selectable') return;

    const view = await render(<TopicContentBlock contentWidth={360} region={region} />);
    const document = nativeContent(view);
    const nodes = allNodes(document.nodes);

    expect(region.segments[0]?.html).toContain('<forum-reply-reference');
    expect(region.segments[0]?.html).toContain('<forum-inline-media-line>');
    expect(nativeText(document)).toContain('回复 @alice · #2\nhello');
    expect(nodes.some((node) => node.type === 'text' && node.parts.some((part) => part.type === 'media'))).toBe(true);
    expect(JSON.stringify(document)).not.toContain('"html":');
  });

  it('[REG-PERF-010] keeps a dynamic V2EX image in compiler-owned bounded variants without rewriting the row', async () => {
    const imageUrl = 'https://i.imgur.com/dynamic.png';
    const compilation = compileForumContent({
      html: `<p>before <img class="embedded_image" src="${imageUrl}"> after</p>`,
      role: 'reply',
      source: 'v2ex'
    });
    const region = compilation.regions.find((candidate) => candidate.kind === 'selectable');
    expect(region?.kind).toBe('selectable');
    if (!region || region.kind !== 'selectable') return;

    const unknownView = await render(<TopicContentBlock contentWidth={360} region={region} />);
    const learnedView = await render(
      <TopicContentBlock contentWidth={360} inlineSizedImageUrls={{ [imageUrl]: true }} region={region} />
    );

    expect(renderedTNode(unknownView)).toMatchObject({
      attributes: { class: 'embedded_image', src: imageUrl },
      tagName: 'img'
    });
    expect(renderedTNode(learnedView)).toMatchObject({
      attributes: { src: imageUrl },
      tagName: 'forum-inline-image'
    });
  });
});
