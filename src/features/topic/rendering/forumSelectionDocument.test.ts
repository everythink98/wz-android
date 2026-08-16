import { describe, expect, it, vi } from 'vitest';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { compileForumContent } from '@/domain/forum/topicContentSplit';
import { forumSelectionTestEngine } from '../../../../tests/helpers/forumSelectionEngine';
import { buildForumSelectionDocument, type ForumSelectionNode } from './forumSelectionDocument';

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1
  }
}));

vi.mock('react-native-render-html', async () => import('@native-html/transient-render-engine'));

function allNodes(nodes: readonly ForumSelectionNode[]): ForumSelectionNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.type === 'block' || node.type === 'listItem' ? allNodes(node.children) : []),
    ...(node.type === 'table' ? node.rows.flatMap((row) => row.cells.flatMap((cell) => allNodes(cell.children))) : [])
  ]);
}

function textFromNodes(nodes: readonly ForumSelectionNode[]) {
  return allNodes(nodes)
    .flatMap((node) =>
      node.type === 'text' ? node.parts.flatMap((part) => (part.type === 'run' ? [part.text] : [])) : []
    )
    .join('');
}

function firstRun(node: ForumSelectionNode | undefined) {
  if (!node) return undefined;
  return allNodes([node])
    .flatMap((candidate) => (candidate.type === 'text' ? candidate.parts : []))
    .find((part) => part.type === 'run');
}

describe('forum native selection document', () => {
  it('[REG-TOPIC-102] uses the configured RNRH tree as the only layout contract for every selectable content type', () => {
    const settings = createEmptyReaderData().settings;
    const compilation = compileForumContent({
      html:
        '<p>段落 <strong>粗体</strong><br><em>斜体</em> <a href="https://example.com">链接</a> <code>行内代码</code></p>' +
        '<h1>一级</h1><h2>二级</h2><h3>三级</h3><h4>四级</h4><h5>五级</h5><h6>六级</h6>' +
        '<ul><li>无序项</li></ul><ol start="3"><li>有序项</li></ol>' +
        '<blockquote><p>引用正文</p></blockquote><hr>' +
        '<p>图片前<img src="https://img.example/a.webp" alt="示例图">图片后</p>' +
        '<table><tbody><tr><th>项目</th><th>值</th></tr><tr><td>CPU</td><td>1 核</td></tr></tbody></table>' +
        '<p>表后正文</p>',
      role: 'opening',
      source: 'nodeseek'
    });
    expect(compilation.regions).toHaveLength(1);
    const region = compilation.regions[0];
    expect(region.kind).toBe('selectable');
    if (region.kind !== 'selectable') throw new Error('Expected one selectable region.');

    const result = buildForumSelectionDocument({
      contentWidth: 320,
      engine: forumSelectionTestEngine,
      fontScale: settings.fontScale,
      inlineSizedImageUrls: {},
      region,
      tableOffsets: {},
      tableScrollKeys: {},
      trimTrailingBlockSpacing: false
    });
    const nodes = allNodes(result.document.nodes);
    const blocks = nodes.filter(
      (node): node is Extract<ForumSelectionNode, { type: 'block' }> => node.type === 'block'
    );
    const runs = nodes.flatMap((node) =>
      node.type === 'text' ? node.parts.filter((part) => part.type === 'run') : []
    );

    expect(blocks.find((node) => node.tag === 'p')?.style).toMatchObject({ marginBottom: 10, marginTop: 0 });
    expect(firstRun(blocks.find((node) => node.tag === 'h1'))?.style).toMatchObject({ fontSize: 24, lineHeight: 32 });
    expect(firstRun(blocks.find((node) => node.tag === 'h6'))?.style).toMatchObject({ fontSize: 14, lineHeight: 21 });
    expect(blocks.find((node) => node.tag === 'blockquote')?.style).toMatchObject({
      borderBottomLeftRadius: 10,
      marginBottom: 12,
      paddingLeft: 14
    });
    expect(nodes.some((node) => node.type === 'listItem' && node.marker === '•')).toBe(true);
    expect(nodes.some((node) => node.type === 'listItem' && node.marker === '3.')).toBe(true);
    expect(nodes.some((node) => node.type === 'rule')).toBe(true);
    expect(nodes.some((node) => node.type === 'table')).toBe(true);
    expect(nodes.some((node) => node.type === 'media')).toBe(true);
    expect(runs.find((run) => run.text === '粗体')?.style).toMatchObject({ fontWeight: '700' });
    expect(runs.find((run) => run.text === '斜体')?.style).toMatchObject({ fontStyle: 'italic' });
    expect(runs.find((run) => run.text === '行内代码')?.style).toMatchObject({ fontFamily: 'monospace' });
    expect(runs.find((run) => run.text === '链接')?.href).toBe('https://example.com');
    expect(runs.some((run) => run.text === '\n')).toBe(true);
    expect(nodes.some((node) => node.type === 'text' && node.copyBreakAfter)).toBe(true);
    expect(textFromNodes(result.document.nodes)).toContain('图片前图片后');
    expect(textFromNodes(result.document.nodes)).toContain('项目值CPU1 核表后正文');
    expect(JSON.stringify(result.document)).not.toMatch(/"html"\s*:/);
    expect(result.media).toHaveLength(1);
    expect(result.media[0]).toMatchObject({ display: 'block' });
  });

  it('[REG-TOPIC-105] gives every bounded media region a non-zero first layout before native children report size', () => {
    const settings = createEmptyReaderData().settings;
    const compilation = compileForumContent({
      html: `<p>${Array.from({ length: 2000 }, (_, index) => `<img src="https://img.example/${index}.webp">`).join('')}</p>`,
      role: 'opening',
      source: 'nodeseek'
    });
    expect(compilation.regions).toHaveLength(500);
    const region = compilation.regions[0];
    if (region?.kind !== 'selectable') throw new Error('Expected a selectable media region.');

    const result = buildForumSelectionDocument({
      contentWidth: 320,
      engine: forumSelectionTestEngine,
      fontScale: settings.fontScale,
      inlineSizedImageUrls: {},
      region,
      tableOffsets: {},
      tableScrollKeys: {},
      trimTrailingBlockSpacing: false
    });
    const mediaNodes = allNodes(result.document.nodes).filter((node) => node.type === 'media');
    expect(mediaNodes).toHaveLength(4);
    expect(mediaNodes).toEqual(expect.arrayContaining([expect.objectContaining({ height: 240, width: 320 })]));
  });

  it('[REG-TOPIC-102] renders typed outer table cells without remapping nested descendants', () => {
    const settings = createEmptyReaderData().settings;
    const compilation = compileForumContent({
      html: '<table><tbody><tr><td>外层<table><tbody><tr><td>内层</td></tr></tbody></table></td><td>后一个</td></tr></tbody></table>',
      role: 'opening',
      source: 'nodeseek'
    });
    const region = compilation.regions[0];
    if (region?.kind !== 'selectable') throw new Error('Expected a selectable table region.');
    const tableSegment = region.segments.find(
      (segment): segment is Extract<(typeof region.segments)[number], { type: 'table' }> => segment.type === 'table'
    );
    if (!tableSegment) throw new Error('Expected a typed table segment.');
    const scrollKey = `opening\u0000${tableSegment.semanticId}`;

    const result = buildForumSelectionDocument({
      contentWidth: 320,
      engine: forumSelectionTestEngine,
      fontScale: settings.fontScale,
      inlineSizedImageUrls: {},
      region,
      tableOffsets: { [tableSegment.semanticId]: 37 },
      tableScrollKeys: { [tableSegment.semanticId]: scrollKey },
      trimTrailingBlockSpacing: false
    });
    const table = allNodes(result.document.nodes).find(
      (node): node is Extract<ForumSelectionNode, { type: 'table' }> => node.type === 'table'
    );

    expect(table?.rows[0]?.cells).toHaveLength(2);
    expect(table).toMatchObject({ initialOffset: 37, scrollKey });
    expect(textFromNodes(table?.rows[0]?.cells[0]?.children || [])).toContain('外层内层');
    expect(textFromNodes(table?.rows[0]?.cells[1]?.children || [])).toBe('后一个');
  });
});
