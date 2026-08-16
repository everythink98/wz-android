import type { TNode, TRenderEngine } from 'react-native-render-html';
import {
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG,
  INLINE_FORUM_IMAGE_TAG,
  isInlineForumImage
} from '@/domain/forum/forumContentMedia';
import {
  resolveForumContentSegmentHtml,
  type ForumContentAncestorFrame,
  type ForumContentSelectableRegion
} from '@/domain/forum/topicContentSplit';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { inlineForumImageDisplaySize } from '@/platform/media/inlineMedia';
import { contentBoundaryForContinuation } from './htmlStyles';

export type ForumSelectionStyle = {
  alignItems?: string;
  alignSelf?: string;
  backgroundColor?: string;
  borderBottomColor?: string;
  borderBottomLeftRadius?: number;
  borderBottomRightRadius?: number;
  borderBottomWidth?: number;
  borderColor?: string;
  borderLeftColor?: string;
  borderLeftWidth?: number;
  borderRadius?: number;
  borderRightColor?: string;
  borderRightWidth?: number;
  borderTopColor?: string;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderTopWidth?: number;
  borderWidth?: number;
  color?: string;
  columnGap?: number;
  flexDirection?: string;
  flexWrap?: string;
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: string;
  fontWeight?: string;
  gap?: number;
  lineHeight?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  rowGap?: number;
  textAlign?: string;
  textDecorationLine?: string;
};

export type ForumSelectionRun = {
  href?: string;
  style: ForumSelectionStyle;
  text: string;
  type: 'run';
};

export type ForumSelectionInlineMedia = {
  height: number;
  slot: number;
  type: 'media';
  width: number;
};

export type ForumSelectionTextPart = ForumSelectionInlineMedia | ForumSelectionRun;

export type ForumSelectionNode =
  | {
      children: ForumSelectionNode[];
      layout: 'column' | 'flow' | 'row';
      style: ForumSelectionStyle;
      tag?: string;
      type: 'block';
    }
  | {
      children: ForumSelectionNode[];
      marker: string;
      markerWidth: number;
      style: ForumSelectionStyle;
      type: 'listItem';
    }
  | {
      height: number;
      slot: number;
      style: ForumSelectionStyle;
      type: 'media';
      width: number;
    }
  | {
      style: ForumSelectionStyle;
      type: 'rule';
    }
  | {
      copyBreakAfter?: boolean;
      parts: ForumSelectionTextPart[];
      style: ForumSelectionStyle;
      type: 'text';
    }
  | {
      columns: number;
      initialOffset: number;
      rows: {
        cells: {
          children: ForumSelectionNode[];
          colSpan: number;
          header: boolean;
          rowSpan: number;
          style: ForumSelectionStyle;
          text: string;
        }[];
      }[];
      scrollKey: string;
      semanticContinuation: 'first' | 'last' | 'middle' | 'only';
      semanticId: string;
      type: 'table';
    };

export type ForumSelectionMedia = {
  display: 'block' | 'inline';
  height?: number;
  tnode: TNode;
  width?: number;
};

export type ForumSelectionDocument = { nodes: ForumSelectionNode[] };

type BuildOptions = {
  contentWidth: number;
  engine: TRenderEngine;
  fontScale: number;
  inlineSizedImageUrls: Readonly<Record<string, boolean | undefined>>;
  isInlineSizedImage?: (
    url: string,
    referrerPolicy: MediaReferrerPolicy | undefined,
    identities: Readonly<Record<string, boolean | undefined>>
  ) => boolean;
  region: ForumContentSelectableRegion;
  tableOffsets: Readonly<Record<string, number | undefined>>;
  tableScrollKeys: Readonly<Record<string, string | undefined>>;
  trimTrailingBlockSpacing: boolean;
};

type TranslationContext = {
  contentWidth: number;
  fontScale: number;
  media: ForumSelectionMedia[];
};

type EngineStyleSamples = {
  blockquote: ForumSelectionStyle;
  li: ForumSelectionStyle;
  ol: ForumSelectionStyle;
  td: ForumSelectionStyle;
  th: ForumSelectionStyle;
  ul: ForumSelectionStyle;
};

const ENGINE_STYLE_SAMPLES = new WeakMap<TRenderEngine, EngineStyleSamples>();

const NUMBER_STYLE_KEYS = [
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
  'borderRightWidth',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderTopWidth',
  'borderWidth',
  'columnGap',
  'fontSize',
  'gap',
  'lineHeight',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'rowGap'
] as const;

const STRING_STYLE_KEYS = [
  'alignItems',
  'alignSelf',
  'backgroundColor',
  'borderBottomColor',
  'borderColor',
  'borderLeftColor',
  'borderRightColor',
  'borderTopColor',
  'color',
  'flexDirection',
  'flexWrap',
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'textAlign',
  'textDecorationLine'
] as const;

function selectionStyle(value: Readonly<Record<string, unknown>>): ForumSelectionStyle {
  const result: Record<string, string | number> = {};
  NUMBER_STYLE_KEYS.forEach((key) => {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) result[key] = candidate;
  });
  STRING_STYLE_KEYS.forEach((key) => {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate) result[key] = candidate;
    else if (key === 'fontWeight' && typeof candidate === 'number' && Number.isFinite(candidate)) {
      result[key] = String(candidate);
    }
  });
  return result as ForumSelectionStyle;
}

function layoutFor(style: ForumSelectionStyle): 'column' | 'flow' | 'row' {
  if (style.flexDirection !== 'row') return 'column';
  return style.flexWrap === 'wrap' ? 'flow' : 'row';
}

function hrefForNode(node: TNode) {
  for (let current: TNode | null = node; current; current = current.parent) {
    if (current.tagName === 'a' && current.attributes.href) return current.attributes.href;
  }
  return undefined;
}

function isMediaNode(node: TNode) {
  return node.tagName === 'img' || node.tagName === INLINE_FORUM_IMAGE_TAG || node.tagName === FORUM_STICKER_TAG;
}

function isInlineMediaNode(node: TNode) {
  if (!isMediaNode(node)) return false;
  if (node.tagName === INLINE_FORUM_IMAGE_TAG) return true;
  if (node.parent?.tagName === FORUM_INLINE_MEDIA_LINE_TAG || node.parent?.tagName === FORUM_STICKER_ROW_TAG)
    return true;
  return isInlineForumImage(node.attributes);
}

function containsOnlyLineBreaks(node: TNode): boolean {
  if (node.tagName === 'br') return true;
  return node.children.length > 0 && node.children.every(containsOnlyLineBreaks);
}

function isRedundantBlockMediaBreak(children: readonly TNode[], index: number) {
  if (!children[index] || !containsOnlyLineBreaks(children[index])) return false;
  let first = index;
  let last = index;
  while (children[first - 1] && containsOnlyLineBreaks(children[first - 1])) first -= 1;
  while (children[last + 1] && containsOnlyLineBreaks(children[last + 1])) last += 1;
  if (index !== first) return false;
  return [children[first - 1], children[last + 1]].some(
    (node) => node && isMediaNode(node) && !isInlineMediaNode(node)
  );
}

function appendMedia(
  node: TNode,
  context: TranslationContext,
  display: 'block' | 'inline'
): { height?: number; slot: number; width?: number } {
  const size =
    display === 'inline'
      ? inlineForumImageDisplaySize(node.attributes, context.fontScale, context.contentWidth)
      : { height: Math.max(1, Math.round(context.contentWidth * 0.75)), width: Math.max(1, context.contentWidth) };
  const slot = context.media.length;
  context.media.push({ display, tnode: node, ...size });
  return { slot, ...size };
}

function textParts(node: TNode, context: TranslationContext): ForumSelectionTextPart[] {
  if (node.tagName === 'br') {
    return [{ style: contextTextStyle(node), text: '\n', type: 'run' }];
  }
  if (isMediaNode(node) && isInlineMediaNode(node)) {
    const media = appendMedia(node, context, 'inline');
    return [{ height: media.height!, slot: media.slot, type: 'media', width: media.width! }];
  }
  if (node.type === 'text') {
    const text = node.tagName === 'br' ? '\n' : node.data;
    return text ? [{ href: hrefForNode(node), style: selectionStyle(node.getNativeStyles()), text, type: 'run' }] : [];
  }
  return node.children.flatMap((child) => textParts(child, context));
}

function replyReferenceNode(node: TNode): ForumSelectionNode | null {
  if (node.tagName !== 'forum-reply-reference') return null;
  const mention = node.attributes['data-mention'] || '';
  const floor = node.attributes['data-floor'] || '';
  if (!mention && !floor) return null;
  const sample = contextTextStyle(node);
  const parts: ForumSelectionTextPart[] = [{ style: sample, text: '回复 ', type: 'run' }];
  if (mention) {
    parts.push({ href: node.attributes['data-user-href'] || undefined, style: sample, text: mention, type: 'run' });
  }
  if (mention && floor) parts.push({ style: sample, text: ' · ', type: 'run' });
  if (floor) {
    parts.push({ href: node.attributes['data-floor-href'] || undefined, style: sample, text: floor, type: 'run' });
  }
  return { parts, style: sample, type: 'text' };
}

function contextTextStyle(node: TNode) {
  for (let current: TNode | null = node.parent; current; current = current.parent) {
    const style = selectionStyle(current.getNativeStyles());
    if (style.fontSize || style.lineHeight || style.color) return style;
  }
  return {};
}

function orderedMarker(node: TNode, index: number) {
  const explicit = Number.parseInt(node.attributes.value || '', 10);
  if (Number.isFinite(explicit)) return explicit;
  const start = Number.parseInt(node.parent?.attributes.start || '', 10);
  return (Number.isFinite(start) ? start : 1) + index;
}

function translateList(node: TNode, context: TranslationContext): ForumSelectionNode {
  const ordered = node.tagName === 'ol';
  const style = selectionStyle(node.getNativeStyles());
  const markerWidth = style.paddingLeft || Math.round(34 * context.fontScale);
  delete style.paddingLeft;
  let itemIndex = 0;
  const children = node.children.flatMap<ForumSelectionNode>((child) => {
    if (child.tagName !== 'li') return translateNode(child, context);
    const marker = ordered ? `${orderedMarker(child, itemIndex)}.` : '•';
    itemIndex += 1;
    return [
      {
        children: translateChildren(child, context),
        marker,
        markerWidth,
        style: selectionStyle(child.getNativeStyles()),
        type: 'listItem'
      }
    ];
  });
  return {
    children: collapseMargins(children),
    layout: 'column',
    style,
    tag: node.tagName || undefined,
    type: 'block'
  };
}

function translateChildren(node: TNode, context: TranslationContext) {
  const result: ForumSelectionNode[] = [];
  let pendingParts: ForumSelectionTextPart[] = [];
  let pendingStyle: ForumSelectionStyle = {};
  const flush = () => {
    if (!pendingParts.length) return;
    result.push({ parts: pendingParts, style: pendingStyle, type: 'text' });
    pendingParts = [];
    pendingStyle = {};
  };
  node.children.forEach((child, index) => {
    if (isRedundantBlockMediaBreak(node.children, index)) {
      const remainingBreaks = textParts(child, context).slice(1);
      if (!remainingBreaks.length) return;
      if (!pendingParts.length) pendingStyle = selectionStyle(child.getNativeStyles());
      pendingParts.push(...remainingBreaks);
      return;
    }
    if (
      child.tagName === 'br' ||
      child.type === 'phrasing' ||
      child.type === 'text' ||
      (isMediaNode(child) && isInlineMediaNode(child))
    ) {
      if (!pendingParts.length) pendingStyle = selectionStyle(child.getNativeStyles());
      pendingParts.push(...textParts(child, context));
      return;
    }
    flush();
    result.push(...translateNode(child, context));
  });
  flush();
  return collapseMargins(result);
}

function translateNode(node: TNode, context: TranslationContext): ForumSelectionNode[] {
  const reference = replyReferenceNode(node);
  if (reference) return [reference];
  if (isMediaNode(node)) {
    if (isInlineMediaNode(node)) {
      const parts = textParts(node, context);
      return parts.length ? [{ parts, style: selectionStyle(node.getNativeStyles()), type: 'text' }] : [];
    }
    const media = appendMedia(node, context, 'block');
    return [
      {
        height: media.height!,
        slot: media.slot,
        style: selectionStyle(node.getNativeStyles()),
        type: 'media',
        width: media.width!
      }
    ];
  }
  if (node.type === 'document' || node.tagName === 'body') return translateChildren(node, context);
  if (node.type === 'empty') return [];
  if (node.type === 'phrasing' || node.type === 'text') {
    const parts = textParts(node, context);
    return parts.length ? [{ parts, style: selectionStyle(node.getNativeStyles()), type: 'text' }] : [];
  }
  if (node.tagName === 'hr') return [{ style: selectionStyle(node.getNativeStyles()), type: 'rule' }];
  if (node.tagName === 'ul' || node.tagName === 'ol') return [translateList(node, context)];
  const style = selectionStyle(node.getNativeStyles());
  return [
    {
      children: translateChildren(node, context),
      layout: layoutFor(style),
      style,
      tag: node.tagName || undefined,
      type: 'block'
    }
  ];
}

function marginTopAfterCollapse(previousBottom: number, currentTop: number) {
  if (previousBottom < 0 && currentTop < 0) return Math.min(previousBottom, currentTop) - previousBottom;
  if (previousBottom < 0 || currentTop < 0) return currentTop;
  return previousBottom > currentTop ? 0 : currentTop - previousBottom;
}

function nodeStyle(node: ForumSelectionNode) {
  return node.type === 'table' ? undefined : node.style;
}

function collapseMargins(nodes: ForumSelectionNode[]) {
  return nodes.map((node, index) => {
    if (!index) return node;
    const previousStyle = nodeStyle(nodes[index - 1]);
    const currentStyle = nodeStyle(node);
    if (typeof previousStyle?.marginBottom !== 'number' || typeof currentStyle?.marginTop !== 'number') return node;
    return {
      ...node,
      style: { ...currentStyle, marginTop: marginTopAfterCollapse(previousStyle.marginBottom, currentStyle.marginTop) }
    };
  });
}

function continuationStyle(style: ForumSelectionStyle, frame: ForumContentAncestorFrame) {
  if (frame.semanticContinuation === 'only') return style;
  const first = frame.semanticContinuation === 'first';
  const last = frame.semanticContinuation === 'last';
  const radius = Math.max(
    style.borderRadius || 0,
    style.borderTopLeftRadius || 0,
    style.borderTopRightRadius || 0,
    style.borderBottomLeftRadius || 0,
    style.borderBottomRightRadius || 0
  );
  const width = Math.max(
    style.borderWidth || 0,
    style.borderTopWidth || 0,
    style.borderRightWidth || 0,
    style.borderBottomWidth || 0,
    style.borderLeftWidth || 0
  );
  return {
    ...style,
    borderBottomLeftRadius: last ? radius : 0,
    borderBottomRightRadius: last ? radius : 0,
    borderBottomWidth: last ? width : 0,
    borderLeftWidth: style.borderLeftWidth ?? width,
    borderRadius: 0,
    borderRightWidth: style.borderRightWidth ?? width,
    borderTopLeftRadius: first ? radius : 0,
    borderTopRightRadius: first ? radius : 0,
    borderTopWidth: first ? width : 0,
    marginBottom: first || frame.semanticContinuation === 'middle' ? 0 : style.marginBottom,
    marginTop: last || frame.semanticContinuation === 'middle' ? 0 : style.marginTop
  };
}

function findTag(root: TNode, tag: string): TNode | undefined {
  if (root.tagName === tag) return root;
  for (const child of root.children) {
    const match = findTag(child, tag);
    if (match) return match;
  }
  return undefined;
}

function engineStyleSamples(engine: TRenderEngine) {
  const cached = ENGINE_STYLE_SAMPLES.get(engine);
  if (cached) return cached;
  const sample = engine.buildTTree(
    '<blockquote>x</blockquote><ul><li>x</li></ul><ol><li>x</li></ol>' +
      '<table><tbody><tr><th>x</th><td>x</td></tr></tbody></table>'
  );
  const styles = {
    blockquote: selectionStyle(findTag(sample, 'blockquote')?.getNativeStyles() || {}),
    li: selectionStyle(findTag(sample, 'li')?.getNativeStyles() || {}),
    ol: selectionStyle(findTag(sample, 'ol')?.getNativeStyles() || {}),
    td: selectionStyle(findTag(sample, 'td')?.getNativeStyles() || {}),
    th: selectionStyle(findTag(sample, 'th')?.getNativeStyles() || {}),
    ul: selectionStyle(findTag(sample, 'ul')?.getNativeStyles() || {})
  };
  ENGINE_STYLE_SAMPLES.set(engine, styles);
  return styles;
}

function wrapFrames(
  nodes: ForumSelectionNode[],
  frames: readonly ForumContentAncestorFrame[],
  engine: TRenderEngine,
  fontScale: number
) {
  const materializedFrames = frames.filter(
    (frame) => frame.kind === 'blockquote' || frame.kind === 'list' || frame.kind === 'listItem'
  );
  if (!materializedFrames.length) return nodes;
  const styles = engineStyleSamples(engine);
  return [...materializedFrames].reverse().reduce<ForumSelectionNode[]>((children, frame) => {
    if (frame.kind === 'blockquote') {
      return [
        {
          children,
          layout: 'column',
          style: continuationStyle(styles.blockquote, frame),
          tag: 'blockquote',
          type: 'block'
        }
      ];
    }
    if (frame.kind === 'listItem') {
      return [
        {
          children,
          marker:
            frame.semanticContinuation === 'first' || frame.semanticContinuation === 'only'
              ? frame.marker === undefined
                ? '•'
                : `${frame.marker}.`
              : '',
          markerWidth: Math.round(34 * fontScale),
          style: {
            ...styles.li,
            marginBottom:
              frame.semanticContinuation === 'last' || frame.semanticContinuation === 'only'
                ? styles.li.marginBottom
                : 0
          },
          type: 'listItem'
        }
      ];
    }
    if (frame.kind === 'list') {
      const style = { ...(frame.ordered ? styles.ol : styles.ul) };
      const markerWidth = style.paddingLeft || Math.round(34 * fontScale);
      delete style.paddingLeft;
      const adjustedChildren = children.map((child) => (child.type === 'listItem' ? { ...child, markerWidth } : child));
      return [
        {
          children: adjustedChildren,
          layout: 'column',
          style: {
            ...style,
            marginBottom:
              frame.semanticContinuation === 'first' || frame.semanticContinuation === 'middle'
                ? 0
                : style.marginBottom,
            marginTop:
              frame.semanticContinuation === 'middle' || frame.semanticContinuation === 'last' ? 0 : style.marginTop
          },
          tag: frame.ordered ? 'ol' : 'ul',
          type: 'block'
        }
      ];
    }
    return children;
  }, nodes);
}

function trimEdge(nodes: ForumSelectionNode[], edge: 'leading' | 'trailing'): ForumSelectionNode[] {
  const index = edge === 'leading' ? 0 : nodes.length - 1;
  const node = nodes[index];
  if (!node) return nodes;
  const key = edge === 'leading' ? 'marginTop' : 'marginBottom';
  const style = nodeStyle(node);
  let next = node;
  if (typeof style?.[key] === 'number') {
    next = { ...node, style: { ...style, [key]: 0 } } as ForumSelectionNode;
  } else if (node.type === 'block' || node.type === 'listItem') {
    next = { ...node, children: trimEdge(node.children, edge) };
  }
  if (next === node) return nodes;
  const result = [...nodes];
  result[index] = next;
  return result;
}

function addCopyBreakToLastText(node: ForumSelectionNode): [ForumSelectionNode, boolean] {
  if (node.type === 'text') return [{ ...node, copyBreakAfter: true }, true];
  if (node.type === 'block' || node.type === 'listItem') {
    const [children, changed] = addCopyBreakToLastTextInNodes(node.children);
    return changed ? [{ ...node, children }, true] : [node, false];
  }
  if (node.type === 'table') {
    for (let rowIndex = node.rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
      const row = node.rows[rowIndex];
      for (let cellIndex = row.cells.length - 1; cellIndex >= 0; cellIndex -= 1) {
        const cell = row.cells[cellIndex];
        const [children, changed] = addCopyBreakToLastTextInNodes(cell.children);
        if (!changed) continue;
        const rows = node.rows.map((candidateRow, candidateRowIndex) =>
          candidateRowIndex === rowIndex
            ? {
                ...candidateRow,
                cells: candidateRow.cells.map((candidateCell, candidateCellIndex) =>
                  candidateCellIndex === cellIndex ? { ...candidateCell, children } : candidateCell
                )
              }
            : candidateRow
        );
        return [{ ...node, rows }, true];
      }
    }
  }
  return [node, false];
}

function addCopyBreakToLastTextInNodes(nodes: readonly ForumSelectionNode[]): [ForumSelectionNode[], boolean] {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const [node, changed] = addCopyBreakToLastText(nodes[index]);
    if (!changed) continue;
    const result = [...nodes];
    result[index] = node;
    return [result, true];
  }
  return [[...nodes], false];
}

function withCopyBoundaries(nodes: readonly ForumSelectionNode[], separateSiblings: boolean): ForumSelectionNode[] {
  let result = nodes.map((node) => {
    if (node.type === 'block') {
      return { ...node, children: withCopyBoundaries(node.children, node.layout === 'column') };
    }
    if (node.type === 'listItem') {
      return { ...node, children: withCopyBoundaries(node.children, true) };
    }
    if (node.type === 'table') {
      let cellIndex = 0;
      const cellCount = node.rows.reduce((total, row) => total + row.cells.length, 0);
      return {
        ...node,
        rows: node.rows.map((row) => ({
          cells: row.cells.map((cell) => {
            let children = withCopyBoundaries(cell.children, true);
            if (cellIndex < cellCount - 1) [children] = addCopyBreakToLastTextInNodes(children);
            cellIndex += 1;
            return { ...cell, children };
          })
        }))
      };
    }
    return node;
  });
  if (!separateSiblings) return result;
  result = result.map((node, index) => (index < result.length - 1 ? addCopyBreakToLastText(node)[0] : node));
  return result;
}

export function buildForumSelectionDocument(options: BuildOptions) {
  const context: TranslationContext = {
    contentWidth: options.contentWidth,
    fontScale: options.fontScale,
    media: []
  };
  const nodes = options.region.segments.flatMap((segment, segmentIndex) => {
    const html = resolveForumContentSegmentHtml(segment, options.inlineSizedImageUrls, options.isInlineSizedImage);
    let segmentNodes: ForumSelectionNode[];
    if (segment.type === 'richText') {
      segmentNodes = translateNode(options.engine.buildTTree(html), context);
    } else {
      segmentNodes = [
        {
          columns: segment.columns,
          initialOffset: options.tableOffsets[segment.semanticId] || 0,
          rows: segment.tableRows.map((row) => ({
            cells: row.cells.map((cell) => ({
              children: translateNode(
                options.engine.buildTTree(
                  resolveForumContentSegmentHtml(cell, options.inlineSizedImageUrls, options.isInlineSizedImage)
                ),
                context
              ),
              colSpan: cell.colSpan,
              header: cell.header,
              rowSpan: cell.rowSpan,
              style: cell.header ? engineStyleSamples(options.engine).th : engineStyleSamples(options.engine).td,
              text: cell.text
            }))
          })),
          scrollKey: options.tableScrollKeys[segment.semanticId] || segment.semanticId,
          semanticContinuation: segment.semanticContinuation,
          semanticId: segment.semanticId,
          type: 'table'
        }
      ];
    }
    segmentNodes = wrapFrames(segmentNodes, segment.ancestorFrames, options.engine, options.fontScale);
    const boundary = contentBoundaryForContinuation(segment.semanticContinuation);
    if (boundary.trimLeading) segmentNodes = trimEdge(segmentNodes, 'leading');
    if (
      boundary.trimTrailing ||
      (options.trimTrailingBlockSpacing && segmentIndex === options.region.segments.length - 1)
    ) {
      segmentNodes = trimEdge(segmentNodes, 'trailing');
    }
    return segmentNodes;
  });
  return { document: { nodes: withCopyBoundaries(nodes, true) }, media: context.media };
}
