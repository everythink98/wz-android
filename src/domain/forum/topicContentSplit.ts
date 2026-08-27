import { HTMLElement } from 'node-html-parser';
import { sanitizeContentHtmlWithRoot } from './contentSanitizer';
import {
  FORUM_LINK_CARD_TAG,
  FORUM_TERMINAL_REPORT_TAG,
  FORUM_TERMINAL_TAB_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG,
  escapeHtmlAttribute,
  parseForumContentHtml
} from './html';
import {
  DISCOURSE_CALLOUT_ATTRIBUTE,
  DISCOURSE_CALLOUT_CONTENT_CLASS,
  DISCOURSE_CALLOUT_FOLD_ATTRIBUTE,
  DISCOURSE_CALLOUT_REGISTRY,
  DISCOURSE_CALLOUT_TITLE_CLASS,
  DISCOURSE_CALLOUT_TYPE_ATTRIBUTE,
  isDiscourseCalloutType,
  type DiscourseCalloutType
} from './callouts';
import type {
  PreparedForumContent,
  QuotedPostMetadata,
  RepliesResponse,
  Reply,
  Source,
  TopicDetail,
  TopicPoll
} from './models';
import { discourseQuotedPostMetadataFromNode } from './quotedPosts';
import { isDiscourseSource, sourceCatalog, type DiscourseSource } from './sourceCatalog';
import {
  markNodeSeekReplyReferenceNodes,
  normalizeForumUserMentionNodes,
  normalizeRenderableHtml
} from './topicContentHtml';
import { normalizeMediaReferrerPolicy, type MediaReferrerPolicy } from './mediaReferrer';
import {
  FORUM_DYNAMIC_INLINE_IMAGE_TAG,
  FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE,
  INLINE_FORUM_IMAGE_TAG,
  FORUM_STICKER_TAG,
  forumImagePreviewDescriptorsFromHtmlFallback,
  normalizeForumContentMediaNodes,
  type DynamicInlineImageDescriptor,
  type ForumImagePreviewDescriptor
} from './forumContentMedia';

const MAX_MEDIA_PER_PLANNED_ROW = 4;
const MAX_PLANNED_ELEMENT_DEPTH = 64;
const MAX_DOM_NODES_PER_PLANNED_ROW = 80;
const MAX_SERIALIZED_CHARS_PER_PLANNED_ROW = 16_384;
const MAX_UNSPLIT_TEXT_CHARS = 12_000;
const TARGET_TEXT_CHARS_PER_PLANNED_ROW = 2200;
const CONTENT_TOO_COMPLEX_NOTICE_HTML = '<p>内容过于复杂，请在原站查看。</p>';
const CONTENT_TOO_COMPLEX_SUMMARY_HTML = '<summary>内容过于复杂，请在原站查看。</summary>';
const CONTENT_TOO_COMPLEX_CALLOUT_TITLE_HTML = `<div class="${DISCOURSE_CALLOUT_TITLE_CLASS}">内容过于复杂，请在原站查看。</div>`;
const DISCOURSE_POLL_PLACEHOLDER_TAG = 'forum-discourse-poll';
export const NODESEEK_POLL_PLACEHOLDER_TAG = 'forum-nodeseek-poll';
const FORUM_INLINE_IMAGE_TAG = INLINE_FORUM_IMAGE_TAG;
export const FORUM_COMPACT_CONTENT_CLASS = 'forum-reply-content';

export function discoursePollPlaceholder(name: string) {
  return `<${DISCOURSE_POLL_PLACEHOLDER_TAG} name="${escapeHtmlAttribute(name)}"></${DISCOURSE_POLL_PLACEHOLDER_TAG}>`;
}

type ForumContentPlanRow = {
  continuation: 'only' | 'first' | 'middle' | 'last';
  groupKey: string;
  html: string;
  keySuffix: string;
  networkMediaCount: number;
};

export type ForumContentCompileRole = 'accepted-answer' | 'opening' | 'quoted-reply' | 'reply' | 'signature';

export type ForumContentMaterializationBudget = {
  readonly metrics: NodeMetrics | null;
  readonly regionCount: number;
};

export type ForumContentRendering = {
  readonly dynamicImages: readonly DynamicInlineImageDescriptor[];
  readonly template: string;
};

export type ForumContentPart = 'only' | 'first' | 'middle' | 'last';

type ForumContentFrameBase = {
  readonly part: ForumContentPart;
  readonly semanticId: string;
};

export type ForumContentAncestorFrame =
  | (ForumContentFrameBase & { readonly kind: 'blockquote' })
  | (ForumContentFrameBase & {
      readonly calloutType: DiscourseCalloutType;
      readonly defaultExpanded: boolean;
      readonly kind: 'callout';
    })
  | (ForumContentFrameBase & { readonly defaultExpanded: boolean; readonly kind: 'details' })
  | (ForumContentFrameBase & {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly start?: number;
    })
  | (ForumContentFrameBase & {
      readonly kind: 'listItem';
      readonly marker?: number;
    })
  | (ForumContentFrameBase & {
      readonly defaultTabId: string;
      readonly kind: 'terminalTab';
      readonly reportSemanticId: string;
      readonly tabId: string;
    });

export type ForumCodeTextStyle = {
  backgroundColor?: string;
  color?: string;
  fontStyle?: 'italic' | 'normal';
  fontWeight?: '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | 'bold' | 'normal';
  textDecorationLine?: 'line-through' | 'none' | 'underline' | 'underline line-through';
};

export type ForumCodeTextRun = {
  readonly style?: ForumCodeTextStyle;
  readonly text: string;
};

type ForumSemanticRowBase = {
  readonly ancestorFrames: readonly ForumContentAncestorFrame[];
  readonly keySuffix: string;
  readonly networkMediaCount: number;
  readonly part: ForumContentPart;
  readonly segmentIndex: number;
  readonly semanticId: string;
};

type ForumHtmlSemanticRowBase = ForumSemanticRowBase & {
  readonly html: string;
  readonly rendering?: ForumContentRendering;
};

export type CompiledForumContentRow =
  | (ForumHtmlSemanticRowBase & { readonly type: 'richText' })
  | (ForumHtmlSemanticRowBase & {
      readonly columns: number;
      readonly type: 'table';
    })
  | (ForumHtmlSemanticRowBase & {
      poster?: string;
      referrerPolicy?: MediaReferrerPolicy;
      src: string;
      type: 'video';
    })
  | (ForumSemanticRowBase & {
      readonly copyText?: string;
      readonly runs: readonly ForumCodeTextRun[];
      readonly text: string;
      readonly type: 'codeBlock';
      readonly variant?: 'terminal';
    })
  | (ForumSemanticRowBase & {
      readonly calloutType?: DiscourseCalloutType;
      readonly defaultExpanded: boolean;
      readonly disclosureKind: 'callout' | 'details';
      readonly hasBody: boolean;
      readonly titleHtml: string;
      readonly titleLabel: string;
      readonly type: 'disclosureHeader';
    })
  | (ForumSemanticRowBase & {
      readonly defaultTabId: string;
      readonly tabs: readonly { readonly id: string; readonly title: string }[];
      readonly type: 'terminalReportHeader';
    })
  | (ForumSemanticRowBase & { readonly poll: TopicPoll; readonly type: 'poll' })
  | (ForumSemanticRowBase & { readonly quote: QuotedPostMetadata; readonly type: 'quote' });

export type CompiledForumContent = {
  materializationBudget: ForumContentMaterializationBudget;
  previewImages: readonly ForumImagePreviewDescriptor[];
  rows: readonly CompiledForumContentRow[];
};

export type PreparedReply = Reply & {
  preparedContent: PreparedForumContent<CompiledForumContent>;
  preparedSignature?: PreparedForumContent<CompiledForumContent>;
};

export type PreparedTopicDetail = TopicDetail & {
  preparedContent: PreparedForumContent<CompiledForumContent>;
  replies: PreparedReply[];
};

export type PreparedRepliesResponse = RepliesResponse & { items: PreparedReply[] };

export const EMPTY_COMPILED_FORUM_CONTENT: CompiledForumContent = {
  materializationBudget: { metrics: null, regionCount: 0 },
  previewImages: [],
  rows: []
};

const PLANNED_ISLAND_TAGS = new Set(['iframe', FORUM_LINK_CARD_TAG, FORUM_VIDEO_STICKER_TAG, FORUM_VIDEO_TAG]);

function nodeTagName(node: unknown) {
  const record = node as { rawTagName?: unknown; tagName?: unknown };
  return String(record.rawTagName || record.tagName || '').toLowerCase();
}

function planningNodeHasContent(node: PlanningNode) {
  return Boolean(nodeTagName(node)) || node.toString().trim().length > 0;
}

type PlanningNode = {
  attributes?: Record<string, string | undefined>;
  childNodes?: PlanningNode[];
  getAttribute?: (name: string) => string | undefined;
  innerHTML?: string;
  rawAttrs?: unknown;
  rawText?: string;
  rawTagName?: unknown;
  parentNode?: PlanningNode | null;
  querySelector?: (selector: string) => PlanningNode | null;
  tagName?: unknown;
  text?: string;
  toString: () => string;
};

function sameCodeTextStyle(left: ForumCodeTextStyle | undefined, right: ForumCodeTextStyle | undefined) {
  return (
    left?.backgroundColor === right?.backgroundColor &&
    left?.color === right?.color &&
    left?.fontStyle === right?.fontStyle &&
    left?.fontWeight === right?.fontWeight &&
    left?.textDecorationLine === right?.textDecorationLine
  );
}

function codeTextStyle(node: PlanningNode, inherited: ForumCodeTextStyle | undefined) {
  const declarations = nodeAttribute(node, 'style')
    .split(';')
    .map((declaration) => declaration.split(':', 2).map((part) => part.trim().toLowerCase()))
    .filter((declaration): declaration is [string, string] => declaration.length === 2 && Boolean(declaration[1]));
  if (!declarations.length) return inherited;
  const style: ForumCodeTextStyle = { ...inherited };
  for (const [name, value] of declarations) {
    if (name === 'background-color') style.backgroundColor = value;
    else if (name === 'color') style.color = value;
    else if (name === 'font-style' && (value === 'italic' || value === 'normal')) style.fontStyle = value;
    else if (name === 'font-weight' && /^(?:bold|normal|[1-9]00)$/.test(value)) {
      style.fontWeight = value as ForumCodeTextStyle['fontWeight'];
    } else if (
      (name === 'text-decoration' || name === 'text-decoration-line') &&
      (value === 'line-through' || value === 'none' || value === 'underline' || value === 'underline line-through')
    ) {
      style.textDecorationLine = value;
    }
  }
  return Object.keys(style).length ? style : undefined;
}

function normalizedCodeRuns(node: PlanningNode) {
  const runs: ForumCodeTextRun[] = [];
  const append = (text: string, style: ForumCodeTextStyle | undefined) => {
    if (!text) return;
    const previous = runs.at(-1);
    if (previous && sameCodeTextStyle(previous.style, style)) {
      runs[runs.length - 1] = { ...previous, text: previous.text + text };
      return;
    }
    runs.push({ ...(style ? { style } : {}), text });
  };
  const visit = (current: PlanningNode, inherited: ForumCodeTextStyle | undefined) => {
    const tagName = nodeTagName(current);
    if (!tagName) {
      append(typeof current.text === 'string' ? current.text : current.toString(), inherited);
      return;
    }
    if (tagName === 'br') {
      append('\n', inherited);
      return;
    }
    const style = codeTextStyle(current, inherited);
    (current.childNodes || []).forEach((child) => visit(child, style));
  };
  visit(node, undefined);
  const text = runs.map((run) => run.text).join('');
  const expected = typeof node.text === 'string' ? node.text : text;
  return text === expected ? runs : [{ text: expected }];
}

function sourceSemanticNodes(nodes: readonly PlanningNode[], role: ForumContentCompileRole) {
  if (role === 'opening' || nodes.length !== 1) return nodes;
  const shell = nodes[0];
  const classes = nodeAttribute(shell, 'class').split(/\s+/);
  return nodeTagName(shell) === 'div' && classes.includes(FORUM_COMPACT_CONTENT_CLASS)
    ? (shell.childNodes || []).filter(planningNodeHasContent)
    : nodes;
}

type NodeMetrics = {
  domNodes: number;
  elementDepth: number;
  mediaSlots: number;
  serializedChars: number;
  textChars: number;
};

export function resolveForumContentRowHtml(
  row: Pick<Extract<CompiledForumContentRow, { html: string }>, 'html' | 'rendering'>,
  inlineSizedImageUrls: Readonly<Record<string, boolean | undefined>>,
  isInlineSizedImage: (
    url: string,
    referrerPolicy: MediaReferrerPolicy | undefined,
    identities: Readonly<Record<string, boolean | undefined>>
  ) => boolean = (url, _referrerPolicy, identities) => Boolean(identities[normalizeDynamicInlineImageUrl(url)])
) {
  if (!row.rendering) return row.html;
  const inlineIds = new Set(
    row.rendering.dynamicImages.flatMap((image) =>
      isInlineSizedImage(image.url, image.referrerPolicy, inlineSizedImageUrls) ? [image.id] : []
    )
  );
  const descriptorsById = new Map(row.rendering.dynamicImages.map((image) => [image.id, image] as const));
  DYNAMIC_INLINE_IMAGE_PATTERN.lastIndex = 0;
  return stripCompilerOwnedAttributes(
    row.rendering.template.replace(DYNAMIC_INLINE_IMAGE_PATTERN, (_tag, rawAttrs: string, label: string) => {
      const id = fallbackAttribute(rawAttrs, FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE);
      if (!descriptorsById.has(id)) return '';
      const publicAttrs = rawAttrsWithoutValue(rawAttrs, FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE);
      return inlineIds.has(id)
        ? `<${FORUM_INLINE_IMAGE_TAG}${publicAttrs ? ` ${publicAttrs}` : ''}>${label}</${FORUM_INLINE_IMAGE_TAG}>`
        : `<img${publicAttrs ? ` ${publicAttrs}` : ''}>`;
    })
  );
}

function createForumContentMaterializationBudget(metrics: NodeMetrics | null, regionCount: number) {
  return { metrics, regionCount };
}

function combinedNodeMetrics(metrics: readonly NodeMetrics[]) {
  return metrics.reduce<NodeMetrics>(
    (total, current) => ({
      domNodes: total.domNodes + current.domNodes,
      elementDepth: Math.max(total.elementDepth, current.elementDepth),
      mediaSlots: total.mediaSlots + current.mediaSlots,
      serializedChars: total.serializedChars + current.serializedChars,
      textChars: total.textChars + current.textChars
    }),
    { domNodes: 0, elementDepth: 0, mediaSlots: 0, serializedChars: 0, textChars: 0 }
  );
}

type HtmlFragment = {
  domNodes: number;
  html: string;
  mediaSlots: number;
  serializedChars: number;
  textChars: number;
};
type HtmlFragmentReserve = Pick<HtmlFragment, 'domNodes' | 'serializedChars'>;

const EMPTY_FRAGMENT_RESERVE: HtmlFragmentReserve = { domNodes: 0, serializedChars: 0 };

function combinedFragmentReserve(left: HtmlFragmentReserve, right: HtmlFragmentReserve): HtmlFragmentReserve {
  return {
    domNodes: left.domNodes + right.domNodes,
    serializedChars: left.serializedChars + right.serializedChars
  };
}

function fragmentFromMetrics(
  html: string,
  metrics: NodeMetrics,
  serializedChars = metrics.serializedChars
): HtmlFragment {
  return {
    domNodes: metrics.domNodes,
    html,
    mediaSlots: metrics.mediaSlots,
    serializedChars,
    textChars: metrics.textChars
  };
}

type TypedForumContentDirective = { type: 'poll'; poll?: TopicPoll } | { type: 'quote'; quote: QuotedPostMetadata };

type PlannedCompileSegment =
  | { type: 'html'; fragment: HtmlFragment }
  | { type: 'poll'; poll: TopicPoll }
  | { type: 'quote'; quote: QuotedPostMetadata };

function rawNodeAttribute(node: PlanningNode | null | undefined, name: string) {
  if (!node) return '';
  if (node.getAttribute) return String(node.getAttribute(name) || '');
  return String(node.attributes?.[name] || '');
}

function nodeAttribute(node: PlanningNode | null | undefined, name: string) {
  return rawNodeAttribute(node, name).trim();
}

function nodeHasAttribute(node: PlanningNode | null | undefined, name: string) {
  if (!node) return false;
  if (node.getAttribute) return node.getAttribute(name) !== undefined;
  return Boolean(node.attributes && Object.prototype.hasOwnProperty.call(node.attributes, name));
}

function tableColumnCount(node: PlanningNode) {
  let maximum = 0;
  const pending = [...(node.childNodes || [])];
  while (pending.length) {
    const current = pending.pop()!;
    const tagName = nodeTagName(current);
    if (tagName === 'table') continue;
    if (tagName === 'tr') {
      const columns = (current.childNodes || []).reduce((total, child) => {
        const cellTagName = nodeTagName(child);
        if (cellTagName !== 'td' && cellTagName !== 'th') return total;
        const rawSpan = nodeAttribute(child, 'colspan');
        const parsedSpan = /^\d+$/.test(rawSpan) ? Number.parseInt(rawSpan, 10) : 1;
        return total + Math.min(Math.max(parsedSpan, 1), MAX_DOM_NODES_PER_PLANNED_ROW);
      }, 0);
      maximum = Math.max(maximum, columns);
      continue;
    }
    pending.push(...(current.childNodes || []));
  }
  return Math.min(MAX_DOM_NODES_PER_PLANNED_ROW, Math.max(1, maximum));
}

function isPlannedDiscourseCallout(node: PlanningNode) {
  return (
    nodeTagName(node) === 'blockquote' &&
    nodeAttribute(node, DISCOURSE_CALLOUT_ATTRIBUTE) === 'true' &&
    isDiscourseCalloutType(nodeAttribute(node, DISCOURSE_CALLOUT_TYPE_ATTRIBUTE))
  );
}

function isDiscourseCalloutTitle(node: PlanningNode) {
  return (
    nodeTagName(node) === 'div' && nodeAttribute(node, 'class').split(/\s+/).includes(DISCOURSE_CALLOUT_TITLE_CLASS)
  );
}

function ownMediaSlots(node: PlanningNode) {
  const tagName = nodeTagName(node);
  if (tagName === 'video') {
    const nestedSource = node.querySelector?.('source');
    return (
      Number(Boolean(nodeAttribute(node, 'src') || nodeAttribute(nestedSource, 'src'))) +
      Number(Boolean(nodeAttribute(node, 'poster')))
    );
  }
  if (tagName === 'img' || tagName === 'audio' || tagName === 'iframe') {
    return 1;
  }
  if (tagName === FORUM_VIDEO_TAG) {
    return Number(Boolean(nodeAttribute(node, 'src'))) + Number(Boolean(nodeAttribute(node, 'poster')));
  }
  if (tagName === FORUM_VIDEO_STICKER_TAG) {
    return Number(Boolean(nodeAttribute(node, 'src'))) + Number(Boolean(nodeAttribute(node, 'data-fallback-src')));
  }
  if (tagName === FORUM_INLINE_IMAGE_TAG || tagName === FORUM_STICKER_TAG) {
    return Number(Boolean(nodeAttribute(node, 'src')));
  }
  if (tagName === FORUM_DYNAMIC_INLINE_IMAGE_TAG) {
    return Number(Boolean(nodeAttribute(node, 'src')));
  }
  if (tagName === FORUM_LINK_CARD_TAG) {
    return Number(Boolean(nodeAttribute(node, 'icon-src'))) + Number(Boolean(nodeAttribute(node, 'image-src')));
  }
  return 0;
}

function analyzeNodes(
  nodes: PlanningNode[],
  typedDirectiveFromNode: (node: PlanningNode) => TypedForumContentDirective | null = () => null
) {
  const metrics = new WeakMap<object, NodeMetrics>();
  const typedDirectives = new WeakMap<object, TypedForumContentDirective>();
  const containsSemantic = new WeakSet<object>();
  const containsTypedDirective = new WeakSet<object>();
  const pending = nodes.map((node) => ({ node, visited: false }));
  while (pending.length) {
    const current = pending.pop()!;
    if (!current.visited) {
      pending.push({ node: current.node, visited: true });
      const children = current.node.childNodes || [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: children[index], visited: false });
      }
      continue;
    }
    const children = current.node.childNodes || [];
    const childMetrics = children.map((child) => metrics.get(child)!);
    const tagName = nodeTagName(current.node);
    const text = tagName ? '' : current.node.toString();
    const ownSerialized = tagName ? tagName.length * 2 + String(current.node.rawAttrs || '').length + 5 : text.length;
    metrics.set(current.node, {
      domNodes: 1 + childMetrics.reduce((total, child) => total + child.domNodes, 0),
      elementDepth: tagName ? 1 + childMetrics.reduce((maximum, child) => Math.max(maximum, child.elementDepth), 0) : 0,
      mediaSlots: ownMediaSlots(current.node) + childMetrics.reduce((total, child) => total + child.mediaSlots, 0),
      serializedChars: ownSerialized + childMetrics.reduce((total, child) => total + child.serializedChars, 0),
      textChars: tagName ? childMetrics.reduce((total, child) => total + child.textChars, 0) : text.length
    });
    const typedDirective = typedDirectiveFromNode(current.node);
    if (typedDirective) typedDirectives.set(current.node, typedDirective);
    if (typedDirective || children.some((child) => containsTypedDirective.has(child))) {
      containsTypedDirective.add(current.node);
    }
    if (
      typedDirective ||
      tagName === 'pre' ||
      isBlockCodeNode(current.node) ||
      tagName === 'table' ||
      tagName === 'details' ||
      tagName === 'blockquote' ||
      tagName === 'ol' ||
      tagName === 'ul' ||
      tagName === FORUM_TERMINAL_REPORT_TAG ||
      tagName === FORUM_TERMINAL_TAB_TAG ||
      isTerminalCodeNode(current.node) ||
      PLANNED_ISLAND_TAGS.has(tagName) ||
      children.some((child) => containsSemantic.has(child))
    ) {
      containsSemantic.add(current.node);
    }
  }
  return { containsSemantic, containsTypedDirective, metrics, typedDirectives };
}

function metricsFitRow(
  metrics: NodeMetrics,
  preservedParentDepth = 0,
  reserved: HtmlFragmentReserve = EMPTY_FRAGMENT_RESERVE
) {
  return (
    reserved.domNodes + metrics.domNodes <= MAX_DOM_NODES_PER_PLANNED_ROW &&
    metrics.mediaSlots <= MAX_MEDIA_PER_PLANNED_ROW &&
    reserved.serializedChars + metrics.serializedChars <= MAX_SERIALIZED_CHARS_PER_PLANNED_ROW &&
    metrics.textChars <= MAX_UNSPLIT_TEXT_CHARS &&
    preservedParentDepth + metrics.elementDepth <= MAX_PLANNED_ELEMENT_DEPTH
  );
}

export function canCoalesceForumContentRows(budgets: readonly ForumContentMaterializationBudget[]) {
  const materializedBudgets = budgets.filter((budget) => budget.regionCount > 0);
  if (materializedBudgets.some((budget) => !budget.metrics)) return false;
  const metrics = combinedNodeMetrics(
    materializedBudgets.flatMap((budget) => (budget.metrics ? [budget.metrics] : []))
  );
  const regionCount = materializedBudgets.reduce((total, budget) => total + budget.regionCount, 0);
  return metricsFitRow(metrics) && (regionCount <= 1 || metrics.textChars <= TARGET_TEXT_CHARS_PER_PLANNED_ROW);
}

function fragmentFitsRow(fragment: HtmlFragment) {
  return (
    fragment.domNodes <= MAX_DOM_NODES_PER_PLANNED_ROW &&
    fragment.mediaSlots <= MAX_MEDIA_PER_PLANNED_ROW &&
    fragment.serializedChars <= MAX_SERIALIZED_CHARS_PER_PLANNED_ROW &&
    fragment.textChars <= MAX_UNSPLIT_TEXT_CHARS
  );
}

const FALLBACK_VOID_TAGS = new Set([
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

function fallbackStructureMetrics(html: string) {
  const stack: string[] = [];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;
  let consumedLength = 0;
  let domNodes = 0;
  let elementDepth = 0;
  let malformed = false;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(html))) {
    if (html.slice(consumedLength, match.index).trim()) domNodes += 1;
    const token = match[0];
    const tagName = (match[1] || '').toLowerCase();
    if (!tagName) {
      domNodes += 1;
    } else if (/^<\//.test(token)) {
      if (stack.at(-1) === tagName) {
        stack.pop();
      } else {
        malformed = true;
      }
    } else {
      domNodes += 1;
      if (!FALLBACK_VOID_TAGS.has(tagName) && !/\/\s*>$/.test(token)) {
        stack.push(tagName);
        elementDepth = Math.max(elementDepth, stack.length);
      }
    }
    consumedLength = tokenPattern.lastIndex;
  }
  if (html.slice(consumedLength).trim()) domNodes += 1;
  return { domNodes, elementDepth, malformed: malformed || stack.length > 0 };
}

function fallbackFragmentFitsRow(fragment: HtmlFragment) {
  if (!fragmentFitsRow(fragment)) return false;
  const structure = fallbackStructureMetrics(fragment.html);
  return (
    !structure.malformed &&
    structure.domNodes <= MAX_DOM_NODES_PER_PLANNED_ROW &&
    structure.elementDepth <= MAX_PLANNED_ELEMENT_DEPTH
  );
}

function previousCodePointStart(value: string, index: number) {
  if (index <= 0) return 0;
  return index >= 2 && /[\uD800-\uDBFF]/.test(value[index - 2]) && /[\uDC00-\uDFFF]/.test(value[index - 1])
    ? index - 2
    : index - 1;
}

function unsafeGraphemeContinuation(codePoint: number | undefined) {
  return (
    codePoint === 0x200d ||
    (codePoint !== undefined && codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint !== undefined && codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint !== undefined && codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint !== undefined && codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint !== undefined && codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint !== undefined && codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    (codePoint !== undefined && codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
    (codePoint !== undefined && codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

function safeTextSplitIndex(value: string, desiredIndex: number) {
  let index = Math.max(1, Math.min(desiredIndex, value.length));
  const lastEntityStart = value.lastIndexOf('&', index - 1);
  const lastEntityEnd = value.lastIndexOf(';', index - 1);
  if (lastEntityStart > lastEntityEnd) {
    const nextEntityEnd = value.indexOf(';', lastEntityStart + 1);
    if (nextEntityEnd >= index && nextEntityEnd - lastEntityStart <= 64) index = lastEntityStart;
  }
  while (index > 0 && index < value.length) {
    if (/[\uD800-\uDBFF]/.test(value[index - 1]) && /[\uDC00-\uDFFF]/.test(value[index])) {
      index -= 1;
      continue;
    }
    const nextCodePoint = value.codePointAt(index);
    const previousStart = previousCodePointStart(value, index);
    const previousCodePoint = value.codePointAt(previousStart);
    const splitRegionalPair =
      previousCodePoint !== undefined &&
      nextCodePoint !== undefined &&
      previousCodePoint >= 0x1f1e6 &&
      previousCodePoint <= 0x1f1ff &&
      nextCodePoint >= 0x1f1e6 &&
      nextCodePoint <= 0x1f1ff;
    if (unsafeGraphemeContinuation(nextCodePoint) || previousCodePoint === 0x200d || splitRegionalPair) {
      index = previousStart;
      continue;
    }
    break;
  }
  return Math.max(1, index);
}

function textFragments(text: string): HtmlFragment[] {
  if (text.length <= MAX_UNSPLIT_TEXT_CHARS) {
    return [{ domNodes: 1, html: text, mediaSlots: 0, serializedChars: text.length, textChars: text.length }];
  }
  const fragments: HtmlFragment[] = [];
  let remaining = text;
  while (remaining.length > MAX_UNSPLIT_TEXT_CHARS) {
    const candidate = remaining.slice(0, MAX_UNSPLIT_TEXT_CHARS);
    const whitespace = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '), candidate.lastIndexOf('\t'));
    const requestedSplitAt = whitespace > MAX_UNSPLIT_TEXT_CHARS / 2 ? whitespace + 1 : candidate.length;
    const splitAt = safeTextSplitIndex(remaining, requestedSplitAt);
    const html = remaining.slice(0, splitAt);
    fragments.push({ domNodes: 1, html, mediaSlots: 0, serializedChars: html.length, textChars: html.length });
    remaining = remaining.slice(splitAt);
  }
  if (remaining) {
    fragments.push({
      domNodes: 1,
      html: remaining,
      mediaSlots: 0,
      serializedChars: remaining.length,
      textChars: remaining.length
    });
  }
  return fragments;
}

function continuationRawAttrs(rawAttrs: string, index: number) {
  if (index === 0) return rawAttrs;
  return rawAttrs.replace(/(?:^|\s+)(?:id|name)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').trim();
}

function rawAttrsWithoutValue(rawAttrs: string, name: string) {
  return rawAttrs.replace(new RegExp(`(?:^|\\s+)${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'gi'), '').trim();
}

function rawAttrsWithValue(rawAttrs: string, name: string, value: string) {
  const withoutValue = rawAttrsWithoutValue(rawAttrs, name);
  return `${withoutValue}${withoutValue ? ' ' : ''}${name}="${value}"`;
}

function rawAttrsWithStyle(rawAttrs: string, declaration: string) {
  const current = fallbackAttribute(rawAttrs, 'style');
  const separator = current && !current.trimEnd().endsWith(';') ? '; ' : current ? ' ' : '';
  return rawAttrsWithValue(rawAttrs, 'style', `${current}${separator}${declaration}`);
}

function stripCompilerOwnedAttributes(html: string) {
  return html.replace(/<[a-z][a-z0-9-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) =>
    tag.replace(
      /"[^"]*"|'[^']*'|\s+(data-wz-[^\s=/>]+)(?=[\s=/>])(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi,
      (match, compilerOwnedName: string | undefined) => (compilerOwnedName ? '' : match)
    )
  );
}

function stripCompilerOwnedNodeAttributes(root: HTMLElement) {
  root.querySelectorAll('*').forEach((node) => {
    Object.keys(node.attributes).forEach((name) => {
      if (name.toLowerCase().startsWith('data-wz-')) node.removeAttribute(name);
    });
  });
}

function elementHtmlWithChildren(node: unknown, childrenHtml: string, rawAttrsOverride?: string) {
  const element = node as { rawAttrs?: unknown; rawTagName?: unknown; tagName?: unknown };
  const tagName = nodeTagName(element);
  const rawAttrs = rawAttrsOverride ?? String(element.rawAttrs || '').trim();
  return `<${tagName}${rawAttrs ? ` ${rawAttrs}` : ''}>${childrenHtml}</${tagName}>`;
}

function continuationFor(index: number, length: number): ForumContentPlanRow['continuation'] {
  if (length === 1) return 'only';
  if (index === 0) return 'first';
  return index === length - 1 ? 'last' : 'middle';
}

function generatedWrapperAttributeReserve(tagName: string, orderedListValue?: number) {
  return (tagName === 'ol' ? 32 : 0) + (tagName === 'li' && orderedListValue !== undefined ? 64 : 0);
}

const FALLBACK_MEDIA_TAG_PATTERN = new RegExp(
  `<(?:img|audio|video|iframe|${FORUM_VIDEO_TAG}|${FORUM_VIDEO_STICKER_TAG}|${FORUM_INLINE_IMAGE_TAG}|${FORUM_DYNAMIC_INLINE_IMAGE_TAG}|${FORUM_STICKER_TAG}|${FORUM_LINK_CARD_TAG})(?![a-z0-9-])[^>]*>`,
  'gi'
);

function rawFallbackAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, 'i'));
  return match?.[2] || match?.[3] || '';
}

function fallbackAttribute(tag: string, name: string) {
  return rawFallbackAttribute(tag, name).trim();
}

function fallbackMediaSlots(tag: string) {
  const tagName = tag.match(/^<\s*([a-z][a-z0-9-]*)/i)?.[1]?.toLowerCase() || '';
  if (tagName === 'video') {
    return 1 + Number(Boolean(fallbackAttribute(tag, 'poster')));
  }
  if (tagName === FORUM_LINK_CARD_TAG) {
    return Number(Boolean(fallbackAttribute(tag, 'icon-src'))) + Number(Boolean(fallbackAttribute(tag, 'image-src')));
  }
  if (tagName === FORUM_VIDEO_STICKER_TAG) {
    return (
      Number(Boolean(fallbackAttribute(tag, 'src'))) + Number(Boolean(fallbackAttribute(tag, 'data-fallback-src')))
    );
  }
  if (tagName === FORUM_VIDEO_TAG) {
    return Number(Boolean(fallbackAttribute(tag, 'src'))) + Number(Boolean(fallbackAttribute(tag, 'poster')));
  }
  if (
    tagName === FORUM_INLINE_IMAGE_TAG ||
    tagName === FORUM_DYNAMIC_INLINE_IMAGE_TAG ||
    tagName === FORUM_STICKER_TAG
  ) {
    return Number(Boolean(fallbackAttribute(tag, 'src')));
  }
  return 1;
}

function fallbackMediaFragments(html: string) {
  const fragments: HtmlFragment[] = [];
  let currentHtml = '';
  let currentMediaSlots = 0;
  let consumedLength = 0;
  FALLBACK_MEDIA_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FALLBACK_MEDIA_TAG_PATTERN.exec(html))) {
    const prefix = html.slice(consumedLength, match.index);
    const tag = match[0];
    const mediaSlots = fallbackMediaSlots(tag);
    currentHtml += prefix;
    if (currentHtml && currentMediaSlots > 0 && currentMediaSlots + mediaSlots > MAX_MEDIA_PER_PLANNED_ROW) {
      fragments.push({
        domNodes: currentMediaSlots + 1,
        html: currentHtml,
        mediaSlots: currentMediaSlots,
        serializedChars: currentHtml.length,
        textChars: currentHtml.replace(/<[^>]+>/g, '').length
      });
      currentHtml = '';
      currentMediaSlots = 0;
    }
    currentHtml += tag;
    currentMediaSlots += mediaSlots;
    consumedLength = FALLBACK_MEDIA_TAG_PATTERN.lastIndex;
  }
  currentHtml += html.slice(consumedLength);
  if (currentHtml) {
    fragments.push({
      domNodes: currentMediaSlots + 1,
      html: currentHtml,
      mediaSlots: currentMediaSlots,
      serializedChars: currentHtml.length,
      textChars: currentHtml.replace(/<[^>]+>/g, '').length
    });
  }
  return fragments;
}

function fallbackNoticeFragment(): HtmlFragment {
  return {
    domNodes: 2,
    html: CONTENT_TOO_COMPLEX_NOTICE_HTML,
    mediaSlots: 0,
    serializedChars: CONTENT_TOO_COMPLEX_NOTICE_HTML.length,
    textChars: 16
  };
}

function standaloneFallbackMediaHtml(tag: string) {
  const tagName = tag.match(/^<\s*([a-z][a-z0-9-]*)/i)?.[1]?.toLowerCase() || '';
  if (!tagName || FALLBACK_VOID_TAGS.has(tagName) || /\/\s*>$/.test(tag)) return tag;
  return `${tag}</${tagName}>`;
}

function failClosedFallbackFragments(fragment: HtmlFragment) {
  if (fallbackFragmentFitsRow(fragment)) return [fragment];
  const mediaFragments: HtmlFragment[] = [];
  FALLBACK_MEDIA_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FALLBACK_MEDIA_TAG_PATTERN.exec(fragment.html))) {
    const html = standaloneFallbackMediaHtml(match[0]);
    const mediaFragment = {
      domNodes: 1,
      html,
      mediaSlots: fallbackMediaSlots(match[0]),
      serializedChars: html.length,
      textChars: 0
    };
    if (fallbackFragmentFitsRow(mediaFragment)) mediaFragments.push(mediaFragment);
  }
  return packFragments([fallbackNoticeFragment(), ...mediaFragments]).map((candidate) =>
    fallbackFragmentFitsRow(candidate) ? candidate : fallbackNoticeFragment()
  );
}

function planForumContentFallback(clean: string): ForumContentPlanRow[] {
  const fragments = fallbackMediaFragments(clean);
  if (fragments.length <= 1) {
    const safe = Boolean(fragments[0] && fallbackFragmentFitsRow(fragments[0]));
    const safeHtml = safe ? clean : CONTENT_TOO_COMPLEX_NOTICE_HTML;
    const mediaSlots = safe ? fragments[0]?.mediaSlots || 0 : 0;
    return [
      {
        continuation: 'only',
        groupKey: 'block-0',
        html: safeHtml,
        keySuffix: 'block-0:0',
        networkMediaCount: mediaSlots
      }
    ];
  }
  const outer = clean.match(/^<([a-z][a-z0-9-]*)\b[^>]*>/i);
  const closing = outer ? clean.match(new RegExp(`</${outer[1]}\\s*>$`, 'i')) : null;
  const innerStart = outer?.[0].length || 0;
  const innerEnd = closing?.index ?? clean.length;
  const innerFragments = outer && closing ? fallbackMediaFragments(clean.slice(innerStart, innerEnd)) : fragments;
  const plannedFragments =
    outer && closing
      ? innerFragments.map((fragment) => ({
          domNodes: fragment.domNodes + 1,
          html: `${outer[0]}${fragment.html}${closing[0]}`,
          mediaSlots: fragment.mediaSlots,
          serializedChars: outer[0].length + fragment.serializedChars + closing[0].length,
          textChars: fragment.textChars
        }))
      : fragments;
  const safeFragments = plannedFragments.flatMap(failClosedFallbackFragments);
  return safeFragments.map((fragment, index) => {
    const mediaSlots = fragment.mediaSlots;
    return {
      continuation: continuationFor(index, safeFragments.length),
      groupKey: 'block-0',
      html: fragment.html,
      keySuffix: `block-0:${index}`,
      networkMediaCount: mediaSlots
    };
  });
}

function packFragments(fragments: HtmlFragment[], reserved: HtmlFragmentReserve = EMPTY_FRAGMENT_RESERVE) {
  const groups: HtmlFragment[] = [];
  let currentDomNodes = 0;
  let currentHtml = '';
  let currentMediaSlots = 0;
  let currentSerializedChars = 0;
  let currentTextChars = 0;
  fragments.forEach((fragment) => {
    const combined = {
      domNodes: reserved.domNodes + currentDomNodes + fragment.domNodes,
      html: currentHtml + fragment.html,
      mediaSlots: currentMediaSlots + fragment.mediaSlots,
      serializedChars: reserved.serializedChars + currentSerializedChars + fragment.serializedChars,
      textChars: currentTextChars + fragment.textChars
    };
    if (currentHtml && (!fragmentFitsRow(combined) || currentTextChars >= TARGET_TEXT_CHARS_PER_PLANNED_ROW)) {
      groups.push({
        domNodes: currentDomNodes,
        html: currentHtml,
        mediaSlots: currentMediaSlots,
        serializedChars: currentSerializedChars,
        textChars: currentTextChars
      });
      currentDomNodes = 0;
      currentHtml = '';
      currentMediaSlots = 0;
      currentSerializedChars = 0;
      currentTextChars = 0;
    }
    currentHtml += fragment.html;
    currentDomNodes += fragment.domNodes;
    currentMediaSlots += fragment.mediaSlots;
    currentSerializedChars += fragment.serializedChars;
    currentTextChars += fragment.textChars;
  });
  if (currentHtml) {
    groups.push({
      domNodes: currentDomNodes,
      html: currentHtml,
      mediaSlots: currentMediaSlots,
      serializedChars: currentSerializedChars,
      textChars: currentTextChars
    });
  }
  return groups;
}

function flattenDescendantsAtDepthLimit(node: PlanningNode, metrics: WeakMap<object, NodeMetrics>) {
  const fragments: HtmlFragment[] = [];
  const pending = [...(node.childNodes || [])].reverse();
  while (pending.length) {
    const current = pending.pop()!;
    const tagName = nodeTagName(current);
    if (!tagName) {
      fragments.push(...textFragments(current.toString()));
      continue;
    }
    if (ownMediaSlots(current) > 0 || !current.childNodes?.length) {
      const currentMetrics = metrics.get(current);
      if (currentMetrics && metricsFitRow(currentMetrics)) {
        fragments.push(fragmentFromMetrics(current.toString(), currentMetrics));
      } else {
        fragments.push(fallbackNoticeFragment());
      }
      continue;
    }
    const children = current.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return packFragments(fragments);
}

function continuousRichTextFragment(node: PlanningNode, metrics: NodeMetrics, preservedParentDepth: number) {
  if (metrics.mediaSlots !== 0 || preservedParentDepth + metrics.elementDepth > MAX_PLANNED_ELEMENT_DEPTH) return null;
  const tagName = nodeTagName(node);
  const rawAttrs = String(node.rawAttrs || '').trim();
  if (tagName && tagName.length * 2 + rawAttrs.length + 5 >= MAX_SERIALIZED_CHARS_PER_PLANNED_ROW) return null;
  const html = node.toString();
  return /^\s*(?:<(?:!--|!|\/)|&lt;!--|<p\b[^>]*>\s*&lt;!--)/i.test(html) ? null : fragmentFromMetrics(html, metrics);
}

function fragmentNode(
  node: PlanningNode,
  metrics: WeakMap<object, NodeMetrics>,
  preservedParentDepth: number,
  nodePath: string,
  traversalDepth = 0,
  orderedListValue?: number,
  preservedParentReserve: HtmlFragmentReserve = EMPTY_FRAGMENT_RESERVE
): HtmlFragment[] {
  const nodeMetrics = metrics.get(node) || {
    domNodes: 1,
    elementDepth: 0,
    mediaSlots: ownMediaSlots(node),
    serializedChars: node.toString().length,
    textChars: 0
  };
  const tagName = nodeTagName(node);
  const continuousFragment = continuousRichTextFragment(node, nodeMetrics, preservedParentDepth);
  if (!tagName) {
    return continuousFragment ? [continuousFragment] : textFragments(node.toString());
  }
  if (tagName === 'summary') {
    return metricsFitRow(nodeMetrics, preservedParentDepth, preservedParentReserve)
      ? [fragmentFromMetrics(node.toString(), nodeMetrics)]
      : [
          {
            domNodes: 2,
            html: CONTENT_TOO_COMPLEX_SUMMARY_HTML,
            mediaSlots: 0,
            serializedChars: CONTENT_TOO_COMPLEX_SUMMARY_HTML.length,
            textChars: 16
          }
        ];
  }
  if (PLANNED_ISLAND_TAGS.has(tagName)) {
    return metricsFitRow(nodeMetrics, preservedParentDepth, preservedParentReserve)
      ? [fragmentFromMetrics(node.toString(), nodeMetrics)]
      : [fallbackNoticeFragment()];
  }
  if (continuousFragment) return [continuousFragment];
  if (
    tagName === 'li' &&
    orderedListValue !== undefined &&
    metricsFitRow(nodeMetrics, preservedParentDepth, preservedParentReserve)
  ) {
    let listItemRawAttrs = String(node.rawAttrs || '').trim();
    listItemRawAttrs = rawAttrsWithValue(listItemRawAttrs, 'value', String(orderedListValue));
    const html = elementHtmlWithChildren(
      node,
      (node.childNodes || []).map((child) => child.toString()).join(''),
      listItemRawAttrs
    );
    return [fragmentFromMetrics(html, nodeMetrics, html.length)];
  }
  if (ownMediaSlots(node) > 0 || !node.childNodes?.length) {
    return metricsFitRow(nodeMetrics, preservedParentDepth, preservedParentReserve)
      ? [fragmentFromMetrics(node.toString(), nodeMetrics)]
      : [fallbackNoticeFragment()];
  }
  if (metricsFitRow(nodeMetrics, preservedParentDepth, preservedParentReserve) && orderedListValue === undefined) {
    return [fragmentFromMetrics(node.toString(), nodeMetrics)];
  }

  if (traversalDepth >= MAX_PLANNED_ELEMENT_DEPTH) {
    return flattenDescendantsAtDepthLimit(node, metrics);
  }

  const rawAttrs = String(node.rawAttrs || '').trim();
  const discourseCallout = isPlannedDiscourseCallout(node);
  const wrapperSerializedChars = tagName.length * 2 + rawAttrs.length + 5;
  const canPreserveWrapper =
    preservedParentDepth < MAX_PLANNED_ELEMENT_DEPTH - 1 &&
    wrapperSerializedChars < MAX_SERIALIZED_CHARS_PER_PLANNED_ROW;
  const generatedAttributeReserve = generatedWrapperAttributeReserve(tagName, orderedListValue);
  const childPreservedParentReserve = canPreserveWrapper
    ? combinedFragmentReserve(preservedParentReserve, {
        domNodes: 1,
        serializedChars: wrapperSerializedChars + generatedAttributeReserve
      })
    : preservedParentReserve;
  const orderedListStartCandidate = Number.parseInt(nodeAttribute(node, 'start'), 10);
  const orderedListStart = Number.isNaN(orderedListStartCandidate) ? 1 : orderedListStartCandidate;
  let nextOrderedListValue = orderedListStart;
  const childFragments = node.childNodes.flatMap((child, childIndex) => {
    const childPreservedParentDepth = canPreserveWrapper ? preservedParentDepth + 1 : preservedParentDepth;
    const childMetrics = metrics.get(child);
    if (
      discourseCallout &&
      isDiscourseCalloutTitle(child) &&
      (!childMetrics || !metricsFitRow(childMetrics, childPreservedParentDepth, childPreservedParentReserve))
    ) {
      return [
        {
          domNodes: 2,
          html: CONTENT_TOO_COMPLEX_CALLOUT_TITLE_HTML,
          mediaSlots: 0,
          serializedChars: CONTENT_TOO_COMPLEX_CALLOUT_TITLE_HTML.length,
          textChars: 16
        }
      ];
    }
    let childOrderedListValue: number | undefined;
    if (tagName === 'ol' && nodeTagName(child) === 'li') {
      const explicitValue = Number.parseInt(nodeAttribute(child, 'value'), 10);
      childOrderedListValue = Number.isNaN(explicitValue) ? nextOrderedListValue : explicitValue;
      nextOrderedListValue = childOrderedListValue + 1;
    }
    return fragmentNode(
      child,
      metrics,
      childPreservedParentDepth,
      `${nodePath}.${childIndex}`,
      traversalDepth + 1,
      childOrderedListValue,
      childPreservedParentReserve
    );
  });
  const groups = packFragments(childFragments, childPreservedParentReserve);
  if (!canPreserveWrapper) {
    return groups;
  }
  if (
    groups.some(
      (group) =>
        !fragmentFitsRow({
          domNodes: preservedParentReserve.domNodes + group.domNodes + 1,
          html: group.html,
          mediaSlots: group.mediaSlots,
          serializedChars:
            preservedParentReserve.serializedChars +
            group.serializedChars +
            wrapperSerializedChars +
            generatedAttributeReserve,
          textChars: group.textChars
        })
    )
  ) {
    return packFragments(childFragments, preservedParentReserve);
  }
  return groups.map((group, index) => {
    let groupRawAttrs = continuationRawAttrs(rawAttrs, index);
    if (tagName === 'li' && orderedListValue !== undefined) {
      groupRawAttrs = rawAttrsWithValue(groupRawAttrs, 'value', String(orderedListValue));
      if (index > 0) {
        groupRawAttrs = rawAttrsWithStyle(groupRawAttrs, 'list-style-type: none');
      }
    }
    if (tagName === 'ol') {
      const firstListItemTag = group.html.match(/<li\b[^>]*>/i)?.[0] || '';
      const firstListItemValue = Number.parseInt(fallbackAttribute(firstListItemTag, 'value'), 10);
      groupRawAttrs = rawAttrsWithValue(
        groupRawAttrs,
        'start',
        String(Number.isNaN(firstListItemValue) ? orderedListStart : firstListItemValue)
      );
    }
    const fragment = {
      domNodes: group.domNodes + 1,
      html: elementHtmlWithChildren(node, group.html, groupRawAttrs),
      mediaSlots: group.mediaSlots,
      serializedChars: group.serializedChars + tagName.length * 2 + groupRawAttrs.length + 5,
      textChars: group.textChars
    };
    return fragment;
  });
}

function htmlCompileSegment(fragment: HtmlFragment): PlannedCompileSegment {
  return { fragment, type: 'html' };
}

function packAdjacentCompileHtml(
  segments: readonly PlannedCompileSegment[],
  reserved?: Pick<HtmlFragment, 'domNodes' | 'serializedChars'>
) {
  const packed: PlannedCompileSegment[] = [];
  let pending: HtmlFragment[] = [];
  const flush = () => {
    if (!pending.length) return;
    packed.push(...packFragments(pending, reserved).map(htmlCompileSegment));
    pending = [];
  };
  segments.forEach((segment) => {
    if (segment.type === 'html') {
      pending.push(segment.fragment);
      return;
    }
    flush();
    packed.push(segment);
  });
  flush();
  return packed;
}

function standaloneForumVideo(html: string) {
  const direct = html.match(new RegExp(`^<${FORUM_VIDEO_TAG}\\b([^>]*)>[\\s\\S]*<\\/${FORUM_VIDEO_TAG}\\s*>$`, 'i'));
  const compact = html.match(
    new RegExp(
      `^<div\\b(?=[^>]*\\bclass=(?:"${FORUM_COMPACT_CONTENT_CLASS}"|'${FORUM_COMPACT_CONTENT_CLASS}'))[^>]*><${FORUM_VIDEO_TAG}\\b([^>]*)>[\\s\\S]*<\\/${FORUM_VIDEO_TAG}\\s*><\\/div\\s*>$`,
      'i'
    )
  );
  const attributes = direct?.[1] || compact?.[1] || '';
  const src = fallbackAttribute(attributes, 'src');
  if (!src) return null;
  const poster = fallbackAttribute(attributes, 'poster');
  const referrerPolicy = normalizeMediaReferrerPolicy(rawFallbackAttribute(attributes, 'referrerpolicy'));
  return { src, ...(poster ? { poster } : {}), ...(referrerPolicy ? { referrerPolicy } : {}) };
}

function compileRoleIncludesPolls(role: ForumContentCompileRole, source: Source) {
  if (role === 'signature') return false;
  if (role === 'opening') return isDiscourseSource(source) || source === 'nodeseek';
  if (role === 'quoted-reply') return isDiscourseSource(source);
  return true;
}

function compileFallbackSegments({
  clean,
  pollList,
  source
}: {
  clean: string;
  pollList: readonly TopicPoll[];
  source: Source;
}) {
  const pollsByName = new Map(pollList.flatMap((poll) => (poll.name ? [[poll.name, poll] as const] : [])));
  const pollsById = new Map(pollList.flatMap((poll) => (poll.id ? [[poll.id, poll] as const] : [])));
  const matchedPolls = new Set<TopicPoll>();
  const segments: PlannedCompileSegment[] = [];
  const appendHtml = (value: string) => {
    if (!value.trim()) return;
    planForumContentFallback(value).forEach((row) => {
      const structure = fallbackStructureMetrics(row.html);
      segments.push(
        htmlCompileSegment({
          domNodes: structure.domNodes,
          html: row.html,
          mediaSlots: row.networkMediaCount,
          serializedChars: row.html.length,
          textChars: row.html.replace(/<[^>]+>/g, '').length
        })
      );
    });
  };
  const marker = isDiscourseSource(source)
    ? { attribute: 'name', polls: pollsByName, tag: DISCOURSE_POLL_PLACEHOLDER_TAG }
    : source === 'nodeseek'
      ? { attribute: 'id', polls: pollsById, tag: NODESEEK_POLL_PLACEHOLDER_TAG }
      : null;
  if (!marker) {
    appendHtml(clean);
  } else {
    const markerPattern = new RegExp(`<${marker.tag}\\b[^>]*>\\s*</${marker.tag}\\s*>`, 'gi');
    let consumedLength = 0;
    let match: RegExpExecArray | null;
    while ((match = markerPattern.exec(clean))) {
      appendHtml(clean.slice(consumedLength, match.index));
      const poll = marker.polls.get(fallbackAttribute(match[0], marker.attribute));
      if (poll) {
        matchedPolls.add(poll);
        segments.push({ poll, type: 'poll' });
      }
      consumedLength = markerPattern.lastIndex;
    }
    appendHtml(clean.slice(consumedLength));
  }
  pollList.filter((poll) => !matchedPolls.has(poll)).forEach((poll) => segments.push({ poll, type: 'poll' }));
  return packAdjacentCompileHtml(segments);
}

const DYNAMIC_INLINE_IMAGE_PATTERN = new RegExp(
  `<${FORUM_DYNAMIC_INLINE_IMAGE_TAG}\\b([^>]*)>([\\s\\S]*?)<\\/${FORUM_DYNAMIC_INLINE_IMAGE_TAG}\\s*>`,
  'gi'
);

function normalizeDynamicInlineImageUrl(value: string) {
  const clean = String(value || '').trim();
  return clean.startsWith('//') ? `https:${clean}` : clean;
}

function renderedHtmlMediaSlots(html: string) {
  let mediaSlots = 0;
  FALLBACK_MEDIA_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FALLBACK_MEDIA_TAG_PATTERN.exec(html))) mediaSlots += fallbackMediaSlots(match[0]);
  return mediaSlots;
}

function renderedHtmlFitsBudget(html: string) {
  if (html.length > MAX_SERIALIZED_CHARS_PER_PLANNED_ROW) return false;
  const structure = fallbackStructureMetrics(html);
  return (
    !structure.malformed &&
    structure.domNodes <= MAX_DOM_NODES_PER_PLANNED_ROW &&
    structure.elementDepth <= MAX_PLANNED_ELEMENT_DEPTH &&
    renderedHtmlMediaSlots(html) <= MAX_MEDIA_PER_PLANNED_ROW &&
    html.replace(/<[^>]+>/g, '').length <= MAX_UNSPLIT_TEXT_CHARS
  );
}

function renderedTableHtmlFitsBudget(html: string) {
  if (html.length > MAX_SERIALIZED_CHARS_PER_PLANNED_ROW) return false;
  const structure = fallbackStructureMetrics(html);
  const elementNodes = Array.from(html.matchAll(/<[a-z][a-z0-9-]*\b[^>]*>/gi)).length;
  return (
    !structure.malformed &&
    elementNodes <= MAX_DOM_NODES_PER_PLANNED_ROW &&
    structure.elementDepth <= MAX_PLANNED_ELEMENT_DEPTH &&
    renderedHtmlMediaSlots(html) <= MAX_MEDIA_PER_PLANNED_ROW &&
    html.replace(/<[^>]+>/g, '').length <= MAX_UNSPLIT_TEXT_CHARS
  );
}

type ForumContentAncestorFrameSeed =
  | { readonly kind: 'blockquote'; readonly semanticId: string }
  | {
      readonly calloutType: DiscourseCalloutType;
      readonly defaultExpanded: boolean;
      readonly kind: 'callout';
      readonly semanticId: string;
    }
  | { readonly defaultExpanded: boolean; readonly kind: 'details'; readonly semanticId: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly semanticId: string; readonly start?: number }
  | { readonly kind: 'listItem'; readonly marker?: number; readonly semanticId: string }
  | {
      readonly defaultTabId: string;
      readonly kind: 'terminalTab';
      readonly reportSemanticId: string;
      readonly semanticId: string;
      readonly tabId: string;
    };

type SemanticHtmlWrapper = {
  readonly node: PlanningNode;
};

type SemanticCompileContext = {
  readonly containsSemantic: WeakSet<object>;
  readonly containsTypedDirective: WeakSet<object>;
  readonly metrics: WeakMap<object, NodeMetrics>;
  readonly recognizesDiscourseCallouts: boolean;
  readonly typedDirectives: WeakMap<object, TypedForumContentDirective>;
};

type SemanticCompileEntry = {
  readonly node: PlanningNode;
  readonly path: string;
};

function semanticPart(index: number, length: number): ForumContentPart {
  if (length <= 1) return 'only';
  if (index === 0) return 'first';
  return index === length - 1 ? 'last' : 'middle';
}

function semanticRowBase({
  ancestorFrames = [],
  index,
  length,
  networkMediaCount,
  semanticId
}: {
  ancestorFrames?: readonly ForumContentAncestorFrame[];
  index: number;
  length: number;
  networkMediaCount: number;
  semanticId: string;
}): ForumSemanticRowBase {
  return {
    ancestorFrames,
    keySuffix: `${semanticId}:${index}`,
    networkMediaCount,
    part: semanticPart(index, length),
    segmentIndex: index,
    semanticId
  };
}

function frameForRow(
  seed: ForumContentAncestorFrameSeed,
  index: number,
  length: number,
  followsHeader = false
): ForumContentAncestorFrame {
  const part = followsHeader ? (index === length - 1 ? 'last' : 'middle') : semanticPart(index, length);
  return { ...seed, part } as ForumContentAncestorFrame;
}

function prependAncestorFrame(
  rows: readonly CompiledForumContentRow[],
  seed: ForumContentAncestorFrameSeed,
  followsHeader = false
) {
  return rows.map((row, index): CompiledForumContentRow => ({
    ...row,
    ancestorFrames: [frameForRow(seed, index, rows.length, followsHeader), ...row.ancestorFrames]
  }));
}

function nodeMetricsFromRenderedHtml(html: string): NodeMetrics | null {
  const structure = fallbackStructureMetrics(html);
  if (structure.malformed) return null;
  return {
    domNodes: structure.domNodes,
    elementDepth: structure.elementDepth,
    mediaSlots: renderedHtmlMediaSlots(html),
    serializedChars: html.length,
    textChars: html.replace(/<[^>]+>/g, '').length
  };
}

function combinedSemanticRowMetrics(rows: readonly CompiledForumContentRow[]) {
  const metrics = rows.flatMap((row) => {
    if (row.type === 'codeBlock') {
      return [
        {
          domNodes: row.runs.length + 1,
          elementDepth: 2,
          mediaSlots: 0,
          serializedChars: row.text.length + JSON.stringify(row.runs.map((run) => run.style || null)).length,
          textChars: row.text.length
        }
      ];
    }
    if ('html' in row) {
      const current = nodeMetricsFromRenderedHtml(row.html);
      return current ? [current] : [];
    }
    return [];
  });
  return metrics.length === rows.length ? combinedNodeMetrics(metrics) : null;
}

function codeRowsForNode(
  node: PlanningNode,
  nodePath: string,
  variant?: Extract<CompiledForumContentRow, { type: 'codeBlock' }>['variant']
): CompiledForumContentRow[] | null {
  const normalizedRuns = normalizedCodeRuns(node);
  const ownerRuns = variant
    ? normalizedRuns.map((run) => ({ ...run, text: run.text.replace(/\u00a0/g, ' ') }))
    : normalizedRuns;
  if (!ownerRuns.length) return null;
  const semanticId = `node-${nodePath}`;
  const copyText = ownerRuns.map((run) => run.text).join('');
  return [
    {
      ...semanticRowBase({ index: 0, length: 1, networkMediaCount: 0, semanticId }),
      copyText,
      runs: ownerRuns,
      text: copyText,
      type: 'codeBlock',
      ...(variant ? { variant } : {})
    }
  ];
}

type SemanticTableRow = {
  readonly html: string;
  readonly sectionAttrs: string;
  readonly sectionTag: '' | 'tbody' | 'tfoot' | 'thead';
  readonly spanToFollowingRows: number;
};

function tableCellRowSpan(node: PlanningNode, remainingSectionRows: number) {
  const raw = nodeAttribute(node, 'rowspan');
  if (!/^\d+$/.test(raw)) return 1;
  const value = Number.parseInt(raw, 10);
  return value === 0 ? remainingSectionRows + 1 : Math.min(Math.max(value, 1), MAX_DOM_NODES_PER_PLANNED_ROW);
}

function semanticTableRows(table: PlanningNode) {
  const records: SemanticTableRow[] = [];
  const appendSectionRows = (
    children: readonly PlanningNode[],
    sectionTag: SemanticTableRow['sectionTag'],
    sectionAttrs: string
  ) => {
    const rows = children.filter((child) => nodeTagName(child) === 'tr');
    rows.forEach((row, rowIndex) => {
      const cells = (row.childNodes || []).filter((child) => {
        const tagName = nodeTagName(child);
        return tagName === 'td' || tagName === 'th';
      });
      records.push({
        html: row.toString(),
        sectionAttrs,
        sectionTag,
        spanToFollowingRows: Math.max(0, ...cells.map((cell) => tableCellRowSpan(cell, rows.length - rowIndex - 1) - 1))
      });
    });
  };
  for (const child of table.childNodes || []) {
    const tagName = nodeTagName(child);
    if (tagName === 'tr') appendSectionRows([child], '', '');
    else if (tagName === 'thead' || tagName === 'tbody' || tagName === 'tfoot') {
      appendSectionRows(child.childNodes || [], tagName, String(child.rawAttrs || '').trim());
    }
  }
  return records;
}

function tableHtmlForRows(table: PlanningNode, rows: readonly SemanticTableRow[], continuationIndex: number) {
  const groups: { attrs: string; html: string; tag: SemanticTableRow['sectionTag'] }[] = [];
  rows.forEach((row) => {
    const previous = groups.at(-1);
    if (previous && previous.tag === row.sectionTag && previous.attrs === row.sectionAttrs) previous.html += row.html;
    else groups.push({ attrs: row.sectionAttrs, html: row.html, tag: row.sectionTag });
  });
  const body = groups
    .map((group) => {
      if (!group.tag) return group.html;
      const attrs = continuationIndex ? continuationRawAttrs(group.attrs, continuationIndex) : group.attrs;
      return `<${group.tag}${attrs ? ` ${attrs}` : ''}>${group.html}</${group.tag}>`;
    })
    .join('');
  const attrs = continuationRawAttrs(String(table.rawAttrs || '').trim(), continuationIndex);
  return `<table${attrs ? ` ${attrs}` : ''}>${body}</table>`;
}

function tableConnectedRegions(rows: readonly SemanticTableRow[]) {
  const regions: SemanticTableRow[][] = [];
  let current: SemanticTableRow[] = [];
  let remaining = 0;
  rows.forEach((row) => {
    if (current.length) remaining = Math.max(0, remaining - 1);
    current.push(row);
    remaining = Math.max(remaining, row.spanToFollowingRows);
    if (remaining === 0) {
      regions.push(current);
      current = [];
    }
  });
  if (current.length) regions.push(current);
  return regions;
}

function tableRowsForNode(node: PlanningNode, nodePath: string): CompiledForumContentRow[] | null {
  const rows = semanticTableRows(node);
  if (!rows.length) return null;
  const regions = tableConnectedRegions(rows);
  const segments: SemanticTableRow[][] = [];
  let current: SemanticTableRow[] = [];
  for (const region of regions) {
    const candidate = [...current, ...region];
    if (current.length && !renderedTableHtmlFitsBudget(tableHtmlForRows(node, candidate, segments.length))) {
      segments.push(current);
      current = [];
    }
    const regionCandidate = [...current, ...region];
    if (!renderedTableHtmlFitsBudget(tableHtmlForRows(node, regionCandidate, segments.length))) return null;
    current = regionCandidate;
  }
  if (current.length) segments.push(current);
  const semanticId = `node-${nodePath}`;
  const columns = tableColumnCount(node);
  return segments.map((segment, index) => {
    const html = tableHtmlForRows(node, segment, index);
    return {
      ...semanticRowBase({
        index,
        length: segments.length,
        networkMediaCount: renderedHtmlMediaSlots(html),
        semanticId
      }),
      columns,
      html,
      type: 'table'
    };
  });
}

function compilerNoticeRow(nodePath: string): Extract<CompiledForumContentRow, { type: 'richText' }> {
  const semanticId = `node-${nodePath}-notice`;
  return {
    ...semanticRowBase({ index: 0, length: 1, networkMediaCount: 0, semanticId }),
    html: CONTENT_TOO_COMPLEX_NOTICE_HTML,
    type: 'richText'
  };
}

function wrapperReserve(wrappers: readonly SemanticHtmlWrapper[]): HtmlFragmentReserve {
  return wrappers.reduce<HtmlFragmentReserve>(
    (total, wrapper) => ({
      domNodes: total.domNodes + 1,
      serializedChars:
        total.serializedChars +
        nodeTagName(wrapper.node).length * 2 +
        String(wrapper.node.rawAttrs || '').trim().length +
        5
    }),
    EMPTY_FRAGMENT_RESERVE
  );
}

function wrapSemanticHtml(html: string, wrappers: readonly SemanticHtmlWrapper[], continuationIndex: number) {
  return [...wrappers].reverse().reduce((value, wrapper) => {
    const tagName = nodeTagName(wrapper.node);
    if (!tagName) return value;
    const attrs = continuationRawAttrs(String(wrapper.node.rawAttrs || '').trim(), continuationIndex);
    return `<${tagName}${attrs ? ` ${attrs}` : ''}>${value}</${tagName}>`;
  }, html);
}

function plainSemanticRows(
  entries: readonly SemanticCompileEntry[],
  wrappers: readonly SemanticHtmlWrapper[],
  metrics: WeakMap<object, NodeMetrics>
) {
  if (!entries.length) return [];
  const reserve = wrapperReserve(wrappers);
  const fragments = entries.flatMap((entry) =>
    fragmentNode(entry.node, metrics, wrappers.length, entry.path, 0, undefined, reserve)
  );
  const groups = packFragments(fragments, reserve);
  const semanticId = `node-${entries[0].path}`;
  return groups.map((group, index): CompiledForumContentRow => {
    // Keep compiler-owned dynamic-image ids until materialization has produced
    // every deterministic media variant. They are stripped below before any
    // row reaches a renderer.
    const html = wrapSemanticHtml(group.html, wrappers, index);
    const video = standaloneForumVideo(html);
    const base = semanticRowBase({
      index,
      length: groups.length,
      networkMediaCount: renderedHtmlMediaSlots(html),
      semanticId
    });
    return video ? { ...base, ...video, html, type: 'video' } : { ...base, html, type: 'richText' };
  });
}

function semanticDirectiveRow(directive: TypedForumContentDirective, nodePath: string): CompiledForumContentRow[] {
  const semanticId = `node-${nodePath}`;
  const base = semanticRowBase({ index: 0, length: 1, networkMediaCount: 0, semanticId });
  if (directive.type === 'quote') return [{ ...base, quote: directive.quote, type: 'quote' }];
  return directive.poll ? [{ ...base, poll: directive.poll, type: 'poll' }] : [];
}

function typedRowsInSubtree(
  node: PlanningNode,
  nodePath: string,
  typedDirectives: WeakMap<object, TypedForumContentDirective>
): CompiledForumContentRow[] {
  const directive = typedDirectives.get(node);
  if (directive) return semanticDirectiveRow(directive, nodePath);
  return (node.childNodes || []).flatMap((child, index) =>
    typedRowsInSubtree(child, `${nodePath}.${index}`, typedDirectives)
  );
}

function nodeHasClass(node: PlanningNode, className: string) {
  return nodeAttribute(node, 'class').split(/\s+/).includes(className);
}

function isTerminalCodeNode(node: PlanningNode) {
  return nodeTagName(node) === 'div' && nodeHasClass(node, 'forum-terminal-code');
}

function isBlockCodeNode(node: PlanningNode) {
  if (nodeTagName(node) !== 'code') return false;
  const parentTag = nodeTagName(node.parentNode);
  if (!parentTag) return true;
  if (!/^(?:article|blockquote|body|details|div|li|section)$/.test(parentTag)) return false;
  return (node.parentNode?.childNodes || []).filter(planningNodeHasContent).length === 1;
}

function innerHtml(node: PlanningNode | undefined) {
  return node ? (node.childNodes || []).map((child) => child.toString()).join('') : '';
}

function nodeText(node: PlanningNode | undefined) {
  return String(node?.text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function boundedDisclosureTitle(node: PlanningNode | undefined, fallback: string) {
  const html = innerHtml(node);
  const label = nodeText(node) || fallback;
  if (
    label.length > MAX_UNSPLIT_TEXT_CHARS ||
    JSON.stringify({ html, label }).length > MAX_SERIALIZED_CHARS_PER_PLANNED_ROW ||
    (html && !renderedHtmlFitsBudget(html))
  ) {
    return { html: '内容过于复杂，请在原站查看。', label: '内容过于复杂，请在原站查看。' };
  }
  return { html: html || fallback, label };
}

function disclosureHeaderRow({
  calloutType,
  defaultExpanded,
  disclosureKind,
  hasBody,
  nodePath,
  titleHtml,
  titleLabel
}: {
  calloutType?: DiscourseCalloutType;
  defaultExpanded: boolean;
  disclosureKind: 'callout' | 'details';
  hasBody: boolean;
  nodePath: string;
  titleHtml: string;
  titleLabel: string;
}): Extract<CompiledForumContentRow, { type: 'disclosureHeader' }> {
  const semanticId = `node-${nodePath}`;
  return {
    ...semanticRowBase({ index: 0, length: hasBody ? 2 : 1, networkMediaCount: 0, semanticId }),
    ...(calloutType ? { calloutType } : {}),
    defaultExpanded,
    disclosureKind,
    hasBody,
    titleHtml,
    titleLabel,
    type: 'disclosureHeader'
  };
}

function terminalReportRows(
  node: PlanningNode,
  nodePath: string,
  wrappers: readonly SemanticHtmlWrapper[],
  context: SemanticCompileContext
): CompiledForumContentRow[] {
  const childEntries = (node.childNodes || []).map((child, index) => ({ node: child, path: `${nodePath}.${index}` }));
  const tabEntries = childEntries.filter((entry) => nodeTagName(entry.node) === FORUM_TERMINAL_TAB_TAG);
  if (!tabEntries.length) return [compilerNoticeRow(nodePath)];

  const reportSemanticId = `node-${nodePath}`;
  const tabs = tabEntries.map((entry, index) => ({
    id: `${reportSemanticId}-tab-${index}`,
    title: (() => {
      const fallback = `Tab ${index + 1}`;
      const title = nodeAttribute(entry.node, 'title').trim() || fallback;
      return title.length <= MAX_UNSPLIT_TEXT_CHARS &&
        JSON.stringify(title).length < MAX_SERIALIZED_CHARS_PER_PLANNED_ROW
        ? title
        : fallback;
    })()
  }));
  const headerTabGroups: (typeof tabs)[] = [];
  let currentHeaderTabs: typeof tabs = [];
  for (const tab of tabs) {
    const candidate = [...currentHeaderTabs, tab];
    if (
      currentHeaderTabs.length &&
      (candidate.length + 1 > MAX_DOM_NODES_PER_PLANNED_ROW ||
        JSON.stringify(candidate).length > MAX_SERIALIZED_CHARS_PER_PLANNED_ROW)
    ) {
      headerTabGroups.push(currentHeaderTabs);
      currentHeaderTabs = [];
    }
    currentHeaderTabs = [...currentHeaderTabs, tab];
  }
  if (currentHeaderTabs.length) headerTabGroups.push(currentHeaderTabs);

  const bodyRows = tabEntries.flatMap((entry, index) => {
    const tabId = tabs[index].id;
    const rows = compileSemanticEntries(
      (entry.node.childNodes || []).map((child, childIndex) => ({
        node: child,
        path: `${entry.path}.${childIndex}`
      })),
      wrappers,
      context
    );
    return prependAncestorFrame(
      rows,
      { defaultTabId: tabs[0].id, kind: 'terminalTab', reportSemanticId, semanticId: tabId, tabId },
      true
    );
  });
  const headerRows = headerTabGroups.map(
    (headerTabs, index): Extract<CompiledForumContentRow, { type: 'terminalReportHeader' }> => ({
      ...semanticRowBase({
        index,
        length: headerTabGroups.length,
        networkMediaCount: 0,
        semanticId: reportSemanticId
      }),
      defaultTabId: tabs[0].id,
      tabs: headerTabs,
      type: 'terminalReportHeader'
    })
  );
  const unexpectedRows = childEntries.flatMap((entry) =>
    nodeTagName(entry.node) !== FORUM_TERMINAL_TAB_TAG && planningNodeHasContent(entry.node)
      ? [compilerNoticeRow(entry.path)]
      : []
  );
  return [...headerRows, ...bodyRows, ...unexpectedRows];
}

function compileSemanticEntries(
  entries: readonly SemanticCompileEntry[],
  wrappers: readonly SemanticHtmlWrapper[],
  context: SemanticCompileContext
): CompiledForumContentRow[] {
  const rows: CompiledForumContentRow[] = [];
  let pending: SemanticCompileEntry[] = [];
  const flush = () => {
    rows.push(...plainSemanticRows(pending, wrappers, context.metrics));
    pending = [];
  };
  for (const entry of entries) {
    const { node, path } = entry;
    if (!context.containsSemantic.has(node)) {
      pending.push(entry);
      continue;
    }
    flush();
    const directive = context.typedDirectives.get(node);
    if (directive) {
      rows.push(...semanticDirectiveRow(directive, path));
      continue;
    }
    const tagName = nodeTagName(node);
    if (tagName === 'summary' && context.containsTypedDirective.has(node)) {
      rows.push(compilerNoticeRow(path), ...typedRowsInSubtree(node, path, context.typedDirectives));
      continue;
    }
    if (tagName === FORUM_TERMINAL_REPORT_TAG) {
      rows.push(...terminalReportRows(node, path, wrappers, context));
      continue;
    }
    if (tagName === FORUM_TERMINAL_TAB_TAG) {
      rows.push(
        ...compileSemanticEntries(
          (node.childNodes || []).map((child, index) => ({ node: child, path: `${path}.${index}` })),
          wrappers,
          context
        )
      );
      continue;
    }
    if (PLANNED_ISLAND_TAGS.has(tagName)) {
      rows.push(
        ...(context.containsTypedDirective.has(node)
          ? [compilerNoticeRow(path), ...typedRowsInSubtree(node, path, context.typedDirectives)]
          : plainSemanticRows([entry], wrappers, context.metrics))
      );
      continue;
    }
    if (tagName === 'pre') {
      rows.push(...(codeRowsForNode(node, path) || [compilerNoticeRow(path)]));
      continue;
    }
    if (isBlockCodeNode(node)) {
      rows.push(...(codeRowsForNode(node, path) || [compilerNoticeRow(path)]));
      continue;
    }
    if (isTerminalCodeNode(node)) {
      rows.push(...(codeRowsForNode(node, path, 'terminal') || [compilerNoticeRow(path)]));
      continue;
    }
    if (tagName === 'table') {
      rows.push(
        ...(context.containsTypedDirective.has(node)
          ? compileSemanticEntries(
              (node.childNodes || []).map((child, index) => ({ node: child, path: `${path}.${index}` })),
              [...wrappers, { node }],
              context
            )
          : tableRowsForNode(node, path) || [compilerNoticeRow(path)])
      );
      continue;
    }
    if (tagName === 'details') {
      const children = node.childNodes || [];
      const summary = children.find((child) => nodeTagName(child) === 'summary');
      const bodyEntries = children
        .map((child, index) => ({ node: child, path: `${path}.${index}` }))
        .filter((child) => child.node !== summary);
      const bodyRows = prependAncestorFrame(
        compileSemanticEntries(bodyEntries, wrappers, context),
        { defaultExpanded: nodeHasAttribute(node, 'open'), kind: 'details', semanticId: `node-${path}` },
        true
      );
      const title = boundedDisclosureTitle(summary, '详情');
      rows.push(
        disclosureHeaderRow({
          defaultExpanded: nodeHasAttribute(node, 'open'),
          disclosureKind: 'details',
          hasBody: bodyRows.length > 0,
          nodePath: path,
          titleHtml: title.html,
          titleLabel: title.label
        }),
        ...bodyRows
      );
      continue;
    }
    if (tagName === 'blockquote' && context.recognizesDiscourseCallouts && isPlannedDiscourseCallout(node)) {
      const children = node.childNodes || [];
      const title = children.find((child) => isDiscourseCalloutTitle(child));
      const content = children.find((child) => nodeHasClass(child, DISCOURSE_CALLOUT_CONTENT_CLASS));
      const bodyNodes = content ? content.childNodes || [] : children.filter((child) => child !== title);
      const bodyRows = compileSemanticEntries(
        bodyNodes.map((child, index) => ({ node: child, path: `${path}.${content ? 'content' : 'body'}.${index}` })),
        wrappers,
        context
      );
      const calloutType = nodeAttribute(node, DISCOURSE_CALLOUT_TYPE_ATTRIBUTE) as DiscourseCalloutType;
      const foldValue = nodeAttribute(node, DISCOURSE_CALLOUT_FOLD_ATTRIBUTE);
      const fold = foldValue === 'collapsed' || foldValue === 'expanded' ? foldValue : undefined;
      const framedBody = prependAncestorFrame(
        bodyRows,
        { calloutType, defaultExpanded: fold !== 'collapsed', kind: 'callout', semanticId: `node-${path}` },
        true
      );
      const calloutTitle = boundedDisclosureTitle(title, DISCOURSE_CALLOUT_REGISTRY[calloutType].title);
      rows.push(
        disclosureHeaderRow({
          calloutType,
          defaultExpanded: fold !== 'collapsed',
          disclosureKind: 'callout',
          hasBody: framedBody.length > 0,
          nodePath: path,
          titleHtml: calloutTitle.html,
          titleLabel: calloutTitle.label
        }),
        ...framedBody
      );
      continue;
    }
    if (tagName === 'blockquote') {
      const bodyRows = compileSemanticEntries(
        (node.childNodes || []).map((child, index) => ({ node: child, path: `${path}.${index}` })),
        wrappers,
        context
      );
      rows.push(...prependAncestorFrame(bodyRows, { kind: 'blockquote', semanticId: `node-${path}` }));
      continue;
    }
    if (tagName === 'ol' || tagName === 'ul') {
      const ordered = tagName === 'ol';
      const parsedStart = Number.parseInt(nodeAttribute(node, 'start'), 10);
      const start = Number.isNaN(parsedStart) ? 1 : parsedStart;
      let nextMarker = start;
      const listRows: CompiledForumContentRow[] = [];
      (node.childNodes || []).forEach((child, index) => {
        const childPath = `${path}.${index}`;
        if (nodeTagName(child) !== 'li') {
          listRows.push(...compileSemanticEntries([{ node: child, path: childPath }], wrappers, context));
          return;
        }
        const explicitMarker = Number.parseInt(nodeAttribute(child, 'value'), 10);
        const marker = ordered ? (Number.isNaN(explicitMarker) ? nextMarker : explicitMarker) : undefined;
        if (ordered) nextMarker = (marker || nextMarker) + 1;
        const itemRows = compileSemanticEntries(
          (child.childNodes || []).map((itemChild, itemIndex) => ({
            node: itemChild,
            path: `${childPath}.${itemIndex}`
          })),
          wrappers,
          context
        );
        const nonEmptyRows = itemRows.length
          ? itemRows
          : plainSemanticRows([{ node: child, path: childPath }], wrappers, context.metrics);
        listRows.push(
          ...prependAncestorFrame(nonEmptyRows, {
            kind: 'listItem',
            ...(marker !== undefined ? { marker } : {}),
            semanticId: `node-${childPath}`
          })
        );
      });
      rows.push(
        ...prependAncestorFrame(listRows, {
          kind: 'list',
          ordered,
          semanticId: `node-${path}`,
          ...(ordered ? { start } : {})
        })
      );
      continue;
    }
    const children = (node.childNodes || []).map((child, index) => ({ node: child, path: `${path}.${index}` }));
    const rawAttrs = String(node.rawAttrs || '').trim();
    const canPreserveWrapper =
      Boolean(tagName) &&
      wrappers.length < MAX_PLANNED_ELEMENT_DEPTH - 1 &&
      tagName.length * 2 + rawAttrs.length + 5 < MAX_SERIALIZED_CHARS_PER_PLANNED_ROW;
    rows.push(...compileSemanticEntries(children, canPreserveWrapper ? [...wrappers, { node }] : wrappers, context));
  }
  flush();
  return rows;
}

function semanticRowsFromParsedContent({
  analysis,
  nodes,
  role,
  source,
  unmatchedPolls
}: {
  analysis: ReturnType<typeof analyzeNodes>;
  nodes: readonly PlanningNode[];
  role: ForumContentCompileRole;
  source: Source;
  unmatchedPolls: readonly TopicPoll[];
}) {
  const context: SemanticCompileContext = {
    containsSemantic: analysis.containsSemantic,
    containsTypedDirective: analysis.containsTypedDirective,
    metrics: analysis.metrics,
    recognizesDiscourseCallouts: isDiscourseSource(source),
    typedDirectives: analysis.typedDirectives
  };
  const semanticNodes = sourceSemanticNodes(nodes, role);
  const entries = semanticNodes.map((node, index) => ({ node, path: String(index) }));
  const rootWrappers = semanticNodes === nodes ? [] : [{ node: nodes[0] }];
  const rows = compileSemanticEntries(entries, rootWrappers, context);
  unmatchedPolls.forEach((poll, index) => {
    const semanticId = `unmatched-poll-${index}`;
    rows.push({
      ...semanticRowBase({ index: 0, length: 1, networkMediaCount: 0, semanticId }),
      poll,
      type: 'poll'
    });
  });
  return rows;
}

function semanticRowsFromFallbackSegments(segments: readonly PlannedCompileSegment[]) {
  return segments.flatMap<CompiledForumContentRow>((segment, index) => {
    const semanticId = `fallback-${index}`;
    const base = semanticRowBase({ index: 0, length: 1, networkMediaCount: 0, semanticId });
    if (segment.type === 'poll') return [{ ...base, poll: segment.poll, type: 'poll' }];
    if (segment.type === 'quote') return [{ ...base, quote: segment.quote, type: 'quote' }];
    const html = stripCompilerOwnedAttributes(segment.fragment.html);
    const rowBase = {
      ...base,
      networkMediaCount: segment.fragment.mediaSlots
    };
    const video = standaloneForumVideo(html);
    return [video ? { ...rowBase, ...video, html, type: 'video' } : { ...rowBase, html, type: 'richText' }];
  });
}

function renderingForCompiledRow(html: string, dynamicImagesById: ReadonlyMap<string, DynamicInlineImageDescriptor>) {
  const descriptors: DynamicInlineImageDescriptor[] = [];
  const seenIds = new Set<string>();
  DYNAMIC_INLINE_IMAGE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DYNAMIC_INLINE_IMAGE_PATTERN.exec(html))) {
    const id = fallbackAttribute(match[1] || '', FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE);
    const descriptor = dynamicImagesById.get(id);
    if (descriptor && !seenIds.has(id)) {
      seenIds.add(id);
      descriptors.push(descriptor);
    }
  }
  if (!descriptors.length) return { html: stripCompilerOwnedAttributes(html) };
  if (descriptors.length > MAX_MEDIA_PER_PLANNED_ROW) {
    throw new Error('Dynamic inline image row exceeded the compiler media budget.');
  }
  const rendering: ForumContentRendering = {
    dynamicImages: descriptors.map((descriptor) => ({
      ...descriptor,
      url: normalizeDynamicInlineImageUrl(descriptor.url)
    })),
    template: html
  };
  return { html: resolveForumContentRowHtml({ html: '', rendering }, {}), rendering };
}

function materializeCompiledRows(
  rows: readonly CompiledForumContentRow[],
  dynamicInlineImages: readonly DynamicInlineImageDescriptor[]
) {
  const dynamicImagesById = new Map(dynamicInlineImages.map((descriptor) => [descriptor.id, descriptor] as const));
  return rows.map((row): CompiledForumContentRow => {
    if (row.type !== 'richText' && row.type !== 'table' && row.type !== 'video') return row;
    return { ...row, ...renderingForCompiledRow(row.html, dynamicImagesById) };
  });
}

function compiledForumContentResult(
  rows: readonly CompiledForumContentRow[],
  materializationMetrics: NodeMetrics | null,
  dynamicInlineImages: readonly DynamicInlineImageDescriptor[] = [],
  previewImages: readonly ForumImagePreviewDescriptor[] = []
): CompiledForumContent {
  const materializedRows = materializeCompiledRows(rows, dynamicInlineImages);
  const renderedRowCount = materializedRows.filter((row) => row.type !== 'poll' && row.type !== 'quote').length;
  return {
    materializationBudget: createForumContentMaterializationBudget(
      materializationMetrics,
      renderedRowCount > 0 ? 1 : 0
    ),
    previewImages,
    rows: materializedRows
  };
}

type ForumContentCompileOptions = {
  polls?: readonly TopicPoll[];
  role: ForumContentCompileRole;
  source: Source;
  topicId?: string;
};

function preparedForumContentKey(options: ForumContentCompileOptions) {
  const polls = compileRoleIncludesPolls(options.role, options.source) ? options.polls || [] : [];
  const topicId = options.role === 'opening' && isDiscourseSource(options.source) ? options.topicId || '' : '';
  return JSON.stringify([options.source, options.role === 'opening' ? 'opening' : 'compact', topicId, polls]);
}

function preparedForumContentMatches(
  prepared: PreparedForumContent | undefined,
  contentHtml: string,
  options: ForumContentCompileOptions
): prepared is PreparedForumContent<CompiledForumContent> {
  return Boolean(
    prepared && prepared.contentHtml === contentHtml && prepared.contentPlanKey === preparedForumContentKey(options)
  );
}

function fallbackCompiledForumContent(
  raw: string,
  pollList: readonly TopicPoll[],
  role: ForumContentCompileRole,
  source: Source
) {
  const fallbackClean = raw
    ? role === 'opening'
      ? raw
      : `<div class="${FORUM_COMPACT_CONTENT_CLASS}">${raw}</div>`
    : '';
  const segments = compileFallbackSegments({ clean: fallbackClean, pollList, source });
  return compiledForumContentResult(
    semanticRowsFromFallbackSegments(segments),
    fallbackClean ? null : combinedNodeMetrics([]),
    [],
    forumImagePreviewDescriptorsFromHtmlFallback(raw)
  );
}

function compileParsedForumContent({
  body,
  pollList,
  raw,
  role,
  source,
  topicId
}: ForumContentCompileOptions & {
  body: HTMLElement | null;
  pollList: readonly TopicPoll[];
  raw: string;
}): CompiledForumContent {
  const pollsByName = new Map(pollList.flatMap((poll) => (poll.name ? [[poll.name, poll] as const] : [])));
  const pollsById = new Map(pollList.flatMap((poll) => (poll.id ? [[poll.id, poll] as const] : [])));
  const matchedPolls = new Set<TopicPoll>();
  const extractsOpeningQuotes = role === 'opening' && Boolean(topicId) && isDiscourseSource(source);
  let dynamicInlineImages: readonly DynamicInlineImageDescriptor[] = [];
  let previewImages: readonly ForumImagePreviewDescriptor[] = [];
  try {
    if (body) {
      if (source === 'nodeseek') markNodeSeekReplyReferenceNodes(body, `${sourceCatalog.nodeseek.baseUrl}/`);
      const media = normalizeForumContentMediaNodes(body, { dynamicV2exImages: source === 'v2ex' });
      dynamicInlineImages = media.dynamicInlineImages;
      previewImages = media.previewImages;
    }
    const nodes = (body?.childNodes || []).filter(planningNodeHasContent) as PlanningNode[];
    if (raw.trim() && !nodes.length) throw new Error('Parser returned no renderable content.');
    const analysis = analyzeNodes(nodes, (node) => {
      const tagName = nodeTagName(node);
      if (isDiscourseSource(source) && tagName === DISCOURSE_POLL_PLACEHOLDER_TAG) {
        const poll = pollsByName.get(nodeAttribute(node, 'name'));
        if (poll) matchedPolls.add(poll);
        return { poll, type: 'poll' };
      }
      if (source === 'nodeseek' && tagName === NODESEEK_POLL_PLACEHOLDER_TAG) {
        const poll = pollsById.get(nodeAttribute(node, 'id'));
        if (poll) matchedPolls.add(poll);
        return { poll, type: 'poll' };
      }
      if (extractsOpeningQuotes && tagName === 'aside' && topicId) {
        const quote = discourseQuotedPostMetadataFromNode(node, source as DiscourseSource, topicId);
        return quote ? { quote, type: 'quote' } : null;
      }
      return null;
    });
    const unmatchedPolls = pollList.filter((poll) => !matchedPolls.has(poll));
    const rows = semanticRowsFromParsedContent({ analysis, nodes, role, source, unmatchedPolls });
    return compiledForumContentResult(
      rows,
      rows.length === 1 ? combinedSemanticRowMetrics(rows) : null,
      dynamicInlineImages,
      previewImages
    );
  } catch {
    return fallbackCompiledForumContent(raw, pollList, role, source);
  }
}

export function compileForumContent({
  html,
  polls = [],
  role,
  source,
  topicId
}: ForumContentCompileOptions & { html: string | undefined }): CompiledForumContent {
  const raw = stripCompilerOwnedAttributes(String(html || '').trim());
  const pollList = compileRoleIncludesPolls(role, source) ? polls : [];
  try {
    const clean = raw
      ? role === 'opening'
        ? normalizeRenderableHtml(raw)
        : `<div class="${FORUM_COMPACT_CONTENT_CLASS}">${normalizeRenderableHtml(raw)}</div>`
      : '';
    const body = parseForumContentHtml(`<body>${clean}</body>`).querySelector('body');
    return compileParsedForumContent({ body, pollList, raw, role, source, topicId });
  } catch {
    return fallbackCompiledForumContent(raw, pollList, role, source);
  }
}

export function prepareForumContentHtml(
  contentHtml: string | undefined,
  { polls, role, source, topicId }: ForumContentCompileOptions
): PreparedForumContent<CompiledForumContent> {
  const normalizedContentHtml = String(contentHtml || '');
  const options = { polls, role, source, topicId };
  return {
    contentHtml: normalizedContentHtml,
    contentPlan: compileForumContent({ html: normalizedContentHtml, ...options }),
    contentPlanKey: preparedForumContentKey(options)
  };
}

export function prepareParsedForumContent(
  root: HTMLElement,
  { contentHtml, polls = [], role, source, topicId }: ForumContentCompileOptions & { contentHtml: string }
): PreparedForumContent<CompiledForumContent> {
  const normalizedContentHtml = String(contentHtml || '');
  const trimmedContentHtml = normalizedContentHtml.trim();
  const raw = stripCompilerOwnedAttributes(trimmedContentHtml);
  const compactShell = (root.childNodes || []).find(
    (node) =>
      nodeTagName(node) === 'div' &&
      nodeAttribute(node as PlanningNode, 'class')
        .split(/\s+/)
        .includes(FORUM_COMPACT_CONTENT_CLASS)
  ) as HTMLElement | undefined;
  if (
    raw !== trimmedContentHtml ||
    (raw && normalizeRenderableHtml(raw) !== raw) ||
    (role !== 'opening' && (!compactShell || compactShell.innerHTML !== raw))
  ) {
    return prepareForumContentHtml(normalizedContentHtml, { polls, role, source, topicId });
  }
  const pollList = compileRoleIncludesPolls(role, source) ? polls : [];
  const options = { polls, role, source, topicId };
  return {
    contentHtml: normalizedContentHtml,
    contentPlan: compileParsedForumContent({ body: root, pollList, raw, ...options }),
    contentPlanKey: preparedForumContentKey(options)
  };
}

export function prepareSanitizedForumContent(
  html: unknown,
  {
    afterSanitizeRoot,
    baseUrl,
    polls,
    role,
    source,
    topicId,
    transformRoot
  }: ForumContentCompileOptions & {
    afterSanitizeRoot?: (root: HTMLElement) => void;
    baseUrl: string;
    transformRoot?: (root: HTMLElement) => void;
  }
): PreparedForumContent<CompiledForumContent> {
  const sourceHtml =
    role === 'opening' ? String(html || '') : `<div class="${FORUM_COMPACT_CONTENT_CLASS}">${String(html || '')}</div>`;
  const sanitized = sanitizeContentHtmlWithRoot(sourceHtml, baseUrl, transformRoot);
  afterSanitizeRoot?.(sanitized.root);
  const compactShell = sanitized.root.querySelector(`.${FORUM_COMPACT_CONTENT_CLASS}`);
  const contentRoot = role === 'opening' ? sanitized.root : compactShell;
  const contentHtml = role === 'opening' ? sanitized.root.toString() : compactShell?.innerHTML || '';
  const trimmedContentHtml = contentHtml.trim();
  const raw = stripCompilerOwnedAttributes(trimmedContentHtml);
  const normalized = normalizeRenderableHtml(raw);
  if (!contentRoot) {
    return prepareForumContentHtml(contentHtml, { polls, role, source, topicId });
  }
  stripCompilerOwnedNodeAttributes(contentRoot);
  normalizeForumUserMentionNodes(contentRoot);
  if (normalized !== raw) {
    if (!/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?>/.test(raw)) {
      const paragraph = new HTMLElement('p', {});
      paragraph.set_content([...contentRoot.childNodes]);
      contentRoot.set_content([paragraph]);
    }
  }
  const options = { polls, role, source, topicId };
  const pollList = compileRoleIncludesPolls(role, source) ? polls || [] : [];
  return {
    contentHtml,
    contentPlan: compileParsedForumContent({
      body: sanitized.root,
      pollList,
      raw,
      ...options
    }),
    contentPlanKey: preparedForumContentKey(options)
  };
}

export function prepareReplyContent(
  reply: Reply,
  source: Source,
  role: Extract<ForumContentCompileRole, 'accepted-answer' | 'quoted-reply' | 'reply'> = 'reply'
): PreparedReply {
  const contentOptions = { polls: reply.polls, role, source } as const;
  const preparedContent = preparedForumContentMatches(reply.preparedContent, reply.contentHtml, contentOptions)
    ? reply.preparedContent
    : prepareForumContentHtml(reply.contentHtml, contentOptions);
  const signatureHtml = String(reply.signatureHtml || '');
  const signatureOptions = { role: 'signature', source } as const;
  const preparedSignature = signatureHtml.trim()
    ? preparedForumContentMatches(reply.preparedSignature, signatureHtml, signatureOptions)
      ? reply.preparedSignature
      : prepareForumContentHtml(signatureHtml, signatureOptions)
    : undefined;
  if (reply.preparedContent === preparedContent && reply.preparedSignature === preparedSignature) {
    return reply as PreparedReply;
  }
  return { ...reply, preparedContent, preparedSignature };
}

export function prepareTopicContent(detail: TopicDetail): PreparedTopicDetail {
  const contentOptions = {
    polls: detail.polls,
    role: 'opening',
    source: detail.source,
    topicId: detail.id
  } as const;
  const preparedContent = preparedForumContentMatches(detail.preparedContent, detail.contentHtml, contentOptions)
    ? detail.preparedContent
    : prepareForumContentHtml(detail.contentHtml, contentOptions);
  const replies = detail.replies.map((reply) => prepareReplyContent(reply, detail.source));
  if (detail.preparedContent === preparedContent && replies.every((reply, index) => reply === detail.replies[index])) {
    return detail as PreparedTopicDetail;
  }
  return { ...detail, preparedContent, replies };
}

export function prepareRepliesContent(response: RepliesResponse, source: Source): PreparedRepliesResponse {
  const items = response.items.map((reply) => prepareReplyContent(reply, source));
  return items.every((reply, index) => reply === response.items[index])
    ? (response as PreparedRepliesResponse)
    : { ...response, items };
}

export function requirePreparedForumContent(
  prepared: PreparedForumContent | undefined,
  contentHtml: string | undefined,
  options?: ForumContentCompileOptions
) {
  const normalizedContentHtml = String(contentHtml || '');
  const requiresPollPlan = Boolean(
    options && compileRoleIncludesPolls(options.role, options.source) && options.polls?.length
  );
  if (!prepared && !normalizedContentHtml.trim() && !requiresPollPlan) return EMPTY_COMPILED_FORUM_CONTENT;
  if (
    !prepared ||
    prepared.contentHtml !== normalizedContentHtml ||
    (options && !preparedForumContentMatches(prepared, normalizedContentHtml, options))
  ) {
    throw new Error('论坛内容缺少匹配的预编译计划');
  }
  return prepared.contentPlan as CompiledForumContent;
}
