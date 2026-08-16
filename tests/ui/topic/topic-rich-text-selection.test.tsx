import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { compileForumContent } from '@/domain/forum/topicContentSplit';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import { buildTopicOpeningContent } from '@/features/topic/model/topicOpeningPresentation';
import { TopicSplitDisclosureScope } from '@/features/topic/rendering/TopicSplitDisclosure';
import { TopicTableScrollProvider } from '@/features/topic/rendering/topicTableRenderers';
import { prepareLinuxDoContent } from '@/sources/linuxdo/parser';
import { act, render } from '../render';

jest.mock('react-native-render-html', () => {
  const actual = jest.requireActual('react-native-render-html') as typeof import('react-native-render-html');
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  const { forumSelectionTestEngine } =
    require('../../helpers/forumSelectionEngine') as typeof import('../../helpers/forumSelectionEngine');
  return {
    ...actual,
    RenderHTMLSource: ({ contentWidth }: { contentWidth: number }) =>
      ReactModule.createElement(View, { style: { width: contentWidth } }),
    TNodeRenderer: () => ReactModule.createElement(View),
    useAmbientTRenderEngine: () => forumSelectionTestEngine
  };
});

describe('topic rich-text selection', () => {
  it('[REG-TOPIC-100] materializes text, title, table, and trailing text in one native selection surface', async () => {
    const compilation = compileForumContent({
      html:
        '<p>自己换机了，这台闲置，剩余时间平价出。不带面板账号，只交付 root，到期即止</p>' +
        '<h3>配置</h3>' +
        '<table><tbody><tr><td>CPU</td><td>1 核</td></tr></tbody></table>' +
        '<p>表格后的说明</p>',
      role: 'opening',
      source: 'nodeseek'
    });

    expect(compilation.regions).toHaveLength(1);
    const region = compilation.regions[0];
    expect(region.kind).toBe('selectable');
    if (region.kind !== 'selectable') throw new Error('Expected one selectable region.');
    expect(region.segments.map((segment) => segment.type)).toEqual(['richText', 'table', 'richText']);
    expect(region.segments.every((segment) => segment.semanticContinuation === 'only')).toBe(true);

    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          <TopicContentBlock contentWidth={320} region={region} />
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );
    expect(screen.getAllByTestId('native-forum-selection-surface')).toHaveLength(1);
    const selectableOwners = screen.container.queryAll((node) => {
      if (node.props.selectable !== true) return false;
      let parent = node.parent;
      while (parent) {
        if (parent.props.selectable === true) return false;
        parent = parent.parent;
      }
      return true;
    });
    expect(selectableOwners).toHaveLength(1);
  });

  it('[REG-TOPIC-100] treats media budgets and islands—not semantic continuation—as region boundaries', () => {
    const images = Array.from({ length: 9 }, (_, index) => `<img src="https://img.example/${index}.webp">`).join('');
    const media = compileForumContent({ html: `<p>before${images}after</p>`, role: 'opening', source: 'nodeseek' });
    expect(media.regions).toHaveLength(3);
    expect(media.regions.map((region) => region.networkMediaCount)).toEqual([4, 4, 1]);
    expect(
      media.regions.every(
        (region) =>
          region.kind === 'selectable' && region.segments.every((segment) => segment.semanticContinuation !== undefined)
      )
    ).toBe(true);

    const island = compileForumContent({
      html: '<p>before</p><pre><code>code</code></pre><p>after</p>',
      role: 'opening',
      source: 'linuxdo'
    });
    expect(island.regions.map((region) => region.kind)).toEqual(['selectable', 'island', 'selectable']);
  });

  it('[REG-TOPIC-105] gives FlashList a bounded first height and then follows every native height change', async () => {
    const [region] = compileForumContent({
      html: `<p>${Array.from({ length: 4 }, (_, index) => `<img src="https://img.example/${index}.webp">`).join('')}</p>`,
      role: 'opening',
      source: 'nodeseek'
    }).regions;
    if (!region || region.kind !== 'selectable') throw new Error('Expected one selectable media region.');

    const screen = await render(<TopicContentBlock contentWidth={320} region={region} />);
    let surface = screen.getByTestId('native-forum-selection-surface');
    expect(StyleSheet.flatten(surface.props.style)).toMatchObject({ height: 240 });

    const layoutKey = surface.props.layoutKey as string;
    await act(async () => surface.props.onContentSizeChange({ nativeEvent: { height: 960, layoutKey } }));
    surface = screen.getByTestId('native-forum-selection-surface');
    expect(StyleSheet.flatten(surface.props.style)).toMatchObject({ height: 960 });

    await act(async () => surface.props.onContentSizeChange({ nativeEvent: { height: 12, layoutKey } }));
    surface = screen.getByTestId('native-forum-selection-surface');
    expect(StyleSheet.flatten(surface.props.style)).toMatchObject({ height: 12 });

    await act(async () =>
      surface.props.onContentSizeChange({ nativeEvent: { height: 1, layoutKey: `${layoutKey}:stale` } })
    );
    expect(StyleSheet.flatten(screen.getByTestId('native-forum-selection-surface').props.style)).toMatchObject({
      height: 12
    });

    await screen.rerender(<TopicContentBlock contentWidth={360} region={region} />);
    surface = screen.getByTestId('native-forum-selection-surface');
    expect(surface.props.layoutKey).not.toBe(layoutKey);
    expect(StyleSheet.flatten(surface.props.style)).toMatchObject({ height: 270 });

    await act(async () => surface.props.onContentSizeChange({ nativeEvent: { height: 1, layoutKey } }));
    expect(StyleSheet.flatten(screen.getByTestId('native-forum-selection-surface').props.style)).toMatchObject({
      height: 270
    });
  });

  it('[REG-TOPIC-101] keeps LinuxDo pre/code intact through sanitize, compile, model, and renderer', async () => {
    const { preparedContent } = prepareLinuxDoContent(
      '<pre><code class="lang-auto">first line\nsecond line</code></pre>',
      [],
      { role: 'opening', topicId: '2762530' }
    );
    const opening = buildTopicOpeningContent({
      contentHtml: preparedContent.contentHtml,
      id: '2762530',
      polls: [],
      preparedContent,
      source: 'linuxdo'
    });
    const item = opening.contentItems[0];
    expect(item).toMatchObject({
      type: 'content',
      region: {
        kind: 'island',
        segment: { copyText: 'first line\nsecond line', text: 'first line\nsecond line', type: 'codeBlock' }
      }
    });
    if (!item || item.type !== 'content') throw new Error('Expected a rendered code island.');

    const screen = await render(<TopicContentBlock contentWidth={320} region={item.region} />);
    expect(screen.getAllByTestId('topic-code-frame')).toHaveLength(1);
    expect(screen.getByText('first line\nsecond line')).toBeTruthy();
    expect(screen.queryByTestId('native-forum-selection-surface')).toBeNull();
    expect(screen.queryByText(/<code/)).toBeNull();
  });
});
