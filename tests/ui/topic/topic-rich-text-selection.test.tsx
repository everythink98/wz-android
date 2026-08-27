import { describe, expect, it } from '@jest/globals';
import React from 'react';
import RenderHTML from 'react-native-render-html';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { compileForumContent } from '@/domain/forum/topicContentSplit';
import { buildHtmlRenderingStyles } from '@/features/topic/rendering/htmlStyles';
import { createTheme } from '@/ui/theme/tokens';
import { render } from '../render';

describe('topic rich-text selection', () => {
  it('[REG-TOPIC-130] renders NodeSeek native s markup with a visible strike', async () => {
    const settings = createEmptyReaderData().settings;
    const styles = buildHtmlRenderingStyles({ settings, theme: createTheme(settings) });
    const row = compileForumContent({
      html: '<p><s>**<em>555555</em></s></p>',
      role: 'reply',
      source: 'nodeseek'
    }).rows[0];
    if (!row || !('html' in row)) throw new Error('Expected one rich-text row.');
    const screen = await render(
      <RenderHTML
        baseStyle={styles.htmlBaseStyle}
        classesStyles={styles.htmlClassesStyles}
        contentWidth={320}
        ignoredStyles={styles.htmlIgnoredStyles}
        source={{ html: row.html }}
        tagsStyles={styles.htmlTagsStyles}
      />
    );

    expect(screen.getByText('555555')).toHaveStyle({ textDecorationLine: 'line-through' });
  });

  it.failing('[REG-TOPIC-100] keeps an unsplit post selectable across text and table rows', async () => {
    const { rows } = compileForumContent({
      html:
        '<p>自己换机了，这台闲置，剩余时间平价出。不带面板账号，只交付 root，到期即止</p>' +
        '<h3>配置</h3>' +
        '<table><tbody><tr><td>CPU</td><td>1 核</td></tr></tbody></table>' +
        '<p>表格后的说明</p>',
      role: 'opening',
      source: 'nodeseek'
    });

    expect(rows.map((row) => row.type)).toEqual(['richText', 'table', 'richText']);
    expect(rows.every((row) => row.part === 'only')).toBe(true);

    const screen = await render(
      <>
        {rows.map((row) =>
          'html' in row ? (
            <RenderHTML
              key={`${row.semanticId}:${row.segmentIndex}`}
              contentWidth={320}
              defaultTextProps={{ selectable: true }}
              source={{ html: row.html }}
            />
          ) : null
        )}
      </>
    );
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
});
