import {
  FORUM_LINK_CARD_TAG,
  FORUM_TERMINAL_REPORT_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG,
  parseHtml
} from './html';
import {
  DISCOURSE_CALLOUT_ATTRIBUTE,
  DISCOURSE_CALLOUT_TITLE_CLASS,
  DISCOURSE_CALLOUT_TYPE_ATTRIBUTE,
  isDiscourseCalloutType
} from './callouts';
import type { QuotedPostMetadata, Source, TopicPoll } from './models';
import { discourseQuotedPostMetadataFromNode, quotedPostReferenceKey } from './quotedPosts';
import { isDiscourseSource, type DiscourseSource } from './sourceCatalog';
import { markNodeSeekReplyReferenceNodes, normalizeRenderableHtml } from './topicContentHtml';
import { normalizeMediaReferrerPolicy, type MediaReferrerPolicy } from './mediaReferrer';
import {
  FORUM_DYNAMIC_INLINE_IMAGE_TAG,
  FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE,
  INLINE_FORUM_IMAGE_TAG,
  FORUM_STICKER_TAG,
  normalizeForumContentMediaNodes,
  type DynamicInlineImageDescriptor
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
const LIST_CONTINUATION_ATTRIBUTE = 'data-wz-list-continuation';
const DETAILS_GROUP_ATTRIBUTE = 'data-wz-details-group';
const DETAILS_PART_ATTRIBUTE = 'data-wz-details-part';
const CALLOUT_GROUP_ATTRIBUTE = 'data-wz-callout-group';
const CALLOUT_PART_ATTRIBUTE = 'data-wz-callout-part';
const DISCOURSE_POLL_PLACEHOLDER_TAG = 'forum-discourse-poll';
const FORUM_INLINE_IMAGE_TAG = INLINE_FORUM_IMAGE_TAG;
export const FORUM_COMPACT_CONTENT_CLASS = 'forum-reply-content';

function escapeForumContentAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function discoursePollPlaceholder(name: string) {
  return `<${DISCOURSE_POLL_PLACEHOLDER_TAG} name="${escapeForumContentAttribute(name)}"></${DISCOURSE_POLL_PLACEHOLDER_TAG}>`;
}

type ForumContentPlanRow = {
  continuation: 'only' | 'first' | 'middle' | 'last';
  groupKey: string;
  html: string;
  keySuffix: string;
  networkMediaCount: number;
  videoPoster?: string;
  videoReferrerPolicy?: MediaReferrerPolicy;
  videoSrc?: string;
};

type ForumContentPlan = {
  materializationMetrics: NodeMetrics | null;
  rows: readonly ForumContentPlanRow[];
};

export type ForumContentCompileRole = 'accepted-answer' | 'opening' | 'quoted-reply' | 'reply' | 'signature';

export type ForumContentMaterializationBudget = {
  readonly metrics: NodeMetrics | null;
  readonly regionCount: number;
};

export type ForumContentRendering = {
  readonly referrerPolicies?: readonly (MediaReferrerPolicy | undefined)[];
  readonly urls: readonly string[];
  readonly variants: readonly string[];
};

export type CompiledForumContentRow =
  | (ForumContentPlanRow & { rendering?: ForumContentRendering; type: 'html' })
  | (ForumContentPlanRow & {
      poster?: string;
      referrerPolicy?: MediaReferrerPolicy;
      rendering?: ForumContentRendering;
      src: string;
      type: 'video';
    })
  | { keySuffix: string; poll: TopicPoll; type: 'poll' }
  | { keySuffix: string; quote: QuotedPostMetadata; type: 'quote' };

export type CompiledForumContent = {
  materializationBudget: ForumContentMaterializationBudget;
  rows: readonly CompiledForumContentRow[];
};

const PLANNED_ISLAND_TAGS = new Set([
  'iframe',
  FORUM_LINK_CARD_TAG,
  FORUM_TERMINAL_REPORT_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG
]);

function forumContentPlan(
  rows: readonly ForumContentPlanRow[],
  materializationMetrics: NodeMetrics | null = null
): ForumContentPlan {
  return { materializationMetrics, rows };
}

function nodeTagName(node: unknown) {
  const record = node as { rawTagName?: unknown; tagName?: unknown };
  return String(record.rawTagName || record.tagName || '').toLowerCase();
}

type PlanningNode = {
  attributes?: Record<string, string | undefined>;
  childNodes?: PlanningNode[];
  getAttribute?: (name: string) => string | undefined;
  rawAttrs?: unknown;
  rawTagName?: unknown;
  querySelector?: (selector: string) => PlanningNode | null;
  tagName?: unknown;
  text?: string;
  toString: () => string;
};

type NodeMetrics = {
  domNodes: number;
  elementDepth: number;
  mediaSlots: number;
  serializedChars: number;
  textChars: number;
};

export function resolveForumContentRowHtml(
  row: Pick<Extract<CompiledForumContentRow, { type: 'html' | 'video' }>, 'html' | 'rendering'>,
  inlineSizedImageUrls: Readonly<Record<string, boolean | undefined>>,
  isInlineSizedImage: (
    url: string,
    referrerPolicy: MediaReferrerPolicy | undefined,
    identities: Readonly<Record<string, boolean | undefined>>
  ) => boolean = (url, _referrerPolicy, identities) => Boolean(identities[normalizeDynamicInlineImageUrl(url)])
) {
  if (!row.rendering) return row.html;
  const mask = row.rendering.urls.reduce(
    (value, url, index) =>
      value |
      (isInlineSizedImage(url, row.rendering?.referrerPolicies?.[index], inlineSizedImageUrls) ? 1 << index : 0),
    0
  );
  return row.rendering.variants[mask] || row.html;
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
  return String(node.getAttribute?.(name) || node.attributes?.[name] || '');
}

function nodeAttribute(node: PlanningNode | null | undefined, name: string) {
  return rawNodeAttribute(node, name).trim();
}

function nodeReferrerPolicy(node: PlanningNode | null | undefined) {
  return normalizeMediaReferrerPolicy(rawNodeAttribute(node, 'referrerpolicy'));
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
    const ownSerialized = tagName
      ? tagName.length * 2 + String(current.node.rawAttrs || '').length + 5
      : current.node.toString().length;
    metrics.set(current.node, {
      domNodes: 1 + childMetrics.reduce((total, child) => total + child.domNodes, 0),
      elementDepth: tagName ? 1 + childMetrics.reduce((maximum, child) => Math.max(maximum, child.elementDepth), 0) : 0,
      mediaSlots: ownMediaSlots(current.node) + childMetrics.reduce((total, child) => total + child.mediaSlots, 0),
      serializedChars: ownSerialized + childMetrics.reduce((total, child) => total + child.serializedChars, 0),
      textChars: tagName
        ? childMetrics.reduce((total, child) => total + child.textChars, 0)
        : current.node.toString().length
    });
    const typedDirective = typedDirectiveFromNode(current.node);
    if (typedDirective) typedDirectives.set(current.node, typedDirective);
    if (typedDirective || children.some((child) => containsTypedDirective.has(child))) {
      containsTypedDirective.add(current.node);
    }
  }
  return { containsTypedDirective, metrics, typedDirectives };
}

function metricsFitRow(metrics: NodeMetrics, preservedParentDepth = 0) {
  return (
    metrics.domNodes <= MAX_DOM_NODES_PER_PLANNED_ROW &&
    metrics.mediaSlots <= MAX_MEDIA_PER_PLANNED_ROW &&
    metrics.serializedChars <= MAX_SERIALIZED_CHARS_PER_PLANNED_ROW &&
    metrics.textChars <= MAX_UNSPLIT_TEXT_CHARS &&
    preservedParentDepth + metrics.elementDepth <= MAX_PLANNED_ELEMENT_DEPTH
  );
}

export function canCoalesceForumContentRows(budgets: readonly ForumContentMaterializationBudget[]) {
  if (budgets.some((budget) => !budget.metrics)) return false;
  const metrics = combinedNodeMetrics(budgets.flatMap((budget) => (budget.metrics ? [budget.metrics] : [])));
  const regionCount = budgets.reduce((total, budget) => total + budget.regionCount, 0);
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

function nestedContinuation(
  outer: string,
  inner: ForumContentPlanRow['continuation']
): ForumContentPlanRow['continuation'] {
  if (outer === 'first') return inner === 'only' || inner === 'first' ? 'first' : 'middle';
  if (outer === 'last') return inner === 'only' || inner === 'last' ? 'last' : 'middle';
  if (outer === 'middle') return 'middle';
  return inner;
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

function packFragments(
  fragments: HtmlFragment[],
  reserved: Pick<HtmlFragment, 'domNodes' | 'serializedChars'> = { domNodes: 0, serializedChars: 0 }
) {
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

function fragmentNode(
  node: PlanningNode,
  metrics: WeakMap<object, NodeMetrics>,
  preservedParentDepth: number,
  nodePath: string,
  traversalDepth = 0,
  orderedListValue?: number,
  trustedContinuationGroups: ReadonlySet<string> = new Set()
): HtmlFragment[] {
  const nodeMetrics = metrics.get(node) || {
    domNodes: 1,
    elementDepth: 0,
    mediaSlots: ownMediaSlots(node),
    serializedChars: node.toString().length,
    textChars: 0
  };
  const tagName = nodeTagName(node);
  if (!tagName) {
    return textFragments(node.toString());
  }
  if (tagName === 'summary') {
    return metricsFitRow(nodeMetrics, preservedParentDepth)
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
    return metricsFitRow(nodeMetrics, preservedParentDepth)
      ? [fragmentFromMetrics(node.toString(), nodeMetrics)]
      : [fallbackNoticeFragment()];
  }
  if (tagName === 'li' && orderedListValue !== undefined && metricsFitRow(nodeMetrics, preservedParentDepth)) {
    let listItemRawAttrs = rawAttrsWithoutValue(String(node.rawAttrs || '').trim(), LIST_CONTINUATION_ATTRIBUTE);
    listItemRawAttrs = rawAttrsWithValue(listItemRawAttrs, 'value', String(orderedListValue));
    const html = elementHtmlWithChildren(
      node,
      (node.childNodes || []).map((child) => child.toString()).join(''),
      listItemRawAttrs
    );
    return [fragmentFromMetrics(html, nodeMetrics, html.length)];
  }
  if (ownMediaSlots(node) > 0 || !node.childNodes?.length) {
    return metricsFitRow(nodeMetrics, preservedParentDepth)
      ? [fragmentFromMetrics(node.toString(), nodeMetrics)]
      : [fallbackNoticeFragment()];
  }
  if (metricsFitRow(nodeMetrics, preservedParentDepth) && orderedListValue === undefined) {
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
  const orderedListStartCandidate = Number.parseInt(nodeAttribute(node, 'start'), 10);
  const orderedListStart = Number.isNaN(orderedListStartCandidate) ? 1 : orderedListStartCandidate;
  let nextOrderedListValue = orderedListStart;
  const childFragments = node.childNodes.flatMap((child, childIndex) => {
    const childPreservedParentDepth = canPreserveWrapper ? preservedParentDepth + 1 : preservedParentDepth;
    const childMetrics = metrics.get(child);
    if (
      discourseCallout &&
      isDiscourseCalloutTitle(child) &&
      (!childMetrics || !metricsFitRow(childMetrics, childPreservedParentDepth))
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
      trustedContinuationGroups
    );
  });
  const generatedAttributeReserve =
    (tagName === 'ol' ? 32 : 0) +
    (tagName === 'li' && orderedListValue !== undefined ? 96 : 0) +
    (tagName === 'details' ? nodePath.length + 96 : 0) +
    (discourseCallout ? nodePath.length + 96 : 0);
  const groups = packFragments(
    childFragments,
    canPreserveWrapper
      ? { domNodes: 1, serializedChars: wrapperSerializedChars + generatedAttributeReserve }
      : undefined
  );
  if (!canPreserveWrapper) {
    return groups;
  }
  if (
    groups.some(
      (group) =>
        !fragmentFitsRow({
          domNodes: group.domNodes + 1,
          html: group.html,
          mediaSlots: group.mediaSlots,
          serializedChars: group.serializedChars + wrapperSerializedChars + generatedAttributeReserve,
          textChars: group.textChars
        })
    )
  ) {
    return packFragments(childFragments);
  }
  return groups.map((group, index) => {
    let groupRawAttrs = continuationRawAttrs(rawAttrs, index);
    if (tagName === 'li' && orderedListValue !== undefined) {
      groupRawAttrs = rawAttrsWithoutValue(groupRawAttrs, LIST_CONTINUATION_ATTRIBUTE);
      groupRawAttrs = rawAttrsWithValue(groupRawAttrs, 'value', String(orderedListValue));
      if (index > 0) {
        groupRawAttrs = rawAttrsWithValue(groupRawAttrs, LIST_CONTINUATION_ATTRIBUTE, 'true');
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
    if (tagName === 'details') {
      const inheritedGroupCandidate = nodeAttribute(node, DETAILS_GROUP_ATTRIBUTE);
      const inheritedGroup = trustedContinuationGroups.has(inheritedGroupCandidate) ? inheritedGroupCandidate : '';
      const inheritedPart = inheritedGroup ? nodeAttribute(node, DETAILS_PART_ATTRIBUTE) : '';
      groupRawAttrs = rawAttrsWithValue(groupRawAttrs, DETAILS_GROUP_ATTRIBUTE, inheritedGroup || nodePath);
      groupRawAttrs = rawAttrsWithValue(
        groupRawAttrs,
        DETAILS_PART_ATTRIBUTE,
        nestedContinuation(inheritedPart, continuationFor(index, groups.length))
      );
    }
    if (discourseCallout) {
      const inheritedGroupCandidate = nodeAttribute(node, CALLOUT_GROUP_ATTRIBUTE);
      const inheritedGroup = trustedContinuationGroups.has(inheritedGroupCandidate) ? inheritedGroupCandidate : '';
      const inheritedPart = inheritedGroup ? nodeAttribute(node, CALLOUT_PART_ATTRIBUTE) : '';
      groupRawAttrs = rawAttrsWithValue(groupRawAttrs, CALLOUT_GROUP_ATTRIBUTE, inheritedGroup || nodePath);
      groupRawAttrs = rawAttrsWithValue(
        groupRawAttrs,
        CALLOUT_PART_ATTRIBUTE,
        nestedContinuation(inheritedPart, continuationFor(index, groups.length))
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

function plannedRowsForTopLevelNode(
  node: PlanningNode,
  groupIndex: number,
  metrics: WeakMap<object, NodeMetrics>,
  trustedContinuationGroups: ReadonlySet<string>
): ForumContentPlanRow[] {
  const groupKey = `block-${groupIndex}`;
  const fragments = fragmentNode(node, metrics, 0, groupKey, 0, undefined, trustedContinuationGroups);
  const videoSrc = nodeTagName(node) === FORUM_VIDEO_TAG ? nodeAttribute(node, 'src') : '';
  const videoPoster = nodeTagName(node) === FORUM_VIDEO_TAG ? nodeAttribute(node, 'poster') : '';
  const videoReferrerPolicy = nodeTagName(node) === FORUM_VIDEO_TAG ? nodeReferrerPolicy(node) : undefined;
  return fragments.map((fragment, index) => ({
    continuation: continuationFor(index, fragments.length),
    groupKey,
    html: fragment.html,
    keySuffix: `${groupKey}:${index}`,
    networkMediaCount: fragment.mediaSlots,
    ...(fragments.length === 1 && fragment.html !== CONTENT_TOO_COMPLEX_NOTICE_HTML && videoSrc
      ? {
          videoSrc,
          ...(videoPoster ? { videoPoster } : {}),
          ...(videoReferrerPolicy ? { videoReferrerPolicy } : {})
        }
      : {})
  }));
}

function planParsedForumContent(
  clean: string,
  nodes: PlanningNode[],
  metrics: WeakMap<object, NodeMetrics>,
  trustedContinuationGroups: ReadonlySet<string> = new Set()
): ForumContentPlan {
  if (!clean) {
    return forumContentPlan([], {
      domNodes: 0,
      elementDepth: 0,
      mediaSlots: 0,
      serializedChars: 0,
      textChars: 0
    });
  }
  if (!nodes.length) {
    return forumContentPlan(planForumContentFallback(clean));
  }
  const parsedHtml = nodes.map((node) => node.toString()).join('');
  const totalMetrics = combinedNodeMetrics(
    nodes.flatMap((node) => {
      const current = metrics.get(node);
      return current ? [current] : [];
    })
  );
  if (
    metricsFitRow(totalMetrics) &&
    parsedHtml === clean &&
    (nodes.length === 1 || totalMetrics.textChars <= TARGET_TEXT_CHARS_PER_PLANNED_ROW)
  ) {
    const mediaSlots = totalMetrics.mediaSlots;
    return forumContentPlan(
      [
        {
          continuation: 'only',
          groupKey: 'block-0',
          html: clean,
          keySuffix: 'block-0:0',
          networkMediaCount: mediaSlots,
          ...(nodes.length === 1 && nodeTagName(nodes[0]) === FORUM_VIDEO_TAG && nodeAttribute(nodes[0], 'src')
            ? {
                videoSrc: nodeAttribute(nodes[0], 'src'),
                ...(nodeAttribute(nodes[0], 'poster') ? { videoPoster: nodeAttribute(nodes[0], 'poster') } : {}),
                ...(nodeReferrerPolicy(nodes[0]) ? { videoReferrerPolicy: nodeReferrerPolicy(nodes[0]) } : {})
              }
            : {})
        }
      ],
      totalMetrics
    );
  }
  return forumContentPlan(
    nodes.flatMap((node, index) => plannedRowsForTopLevelNode(node, index, metrics, trustedContinuationGroups))
  );
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

function typedRowsWithinNode(
  node: PlanningNode,
  typedDirectives: WeakMap<object, TypedForumContentDirective>
): PlannedCompileSegment[] {
  const directive = typedDirectives.get(node);
  if (directive?.type === 'quote') return [{ quote: directive.quote, type: 'quote' }];
  if (directive?.type === 'poll') return directive.poll ? [{ poll: directive.poll, type: 'poll' }] : [];
  return (node.childNodes || []).flatMap((child) => typedRowsWithinNode(child, typedDirectives));
}

function failClosedTypedContainerSegments(
  node: PlanningNode,
  typedDirectives: WeakMap<object, TypedForumContentDirective>
): PlannedCompileSegment[] {
  const html = nodeTagName(node) === 'summary' ? CONTENT_TOO_COMPLEX_SUMMARY_HTML : CONTENT_TOO_COMPLEX_NOTICE_HTML;
  return [
    htmlCompileSegment({
      domNodes: 2,
      html,
      mediaSlots: 0,
      serializedChars: html.length,
      textChars: 16
    }),
    ...typedRowsWithinNode(node, typedDirectives)
  ];
}

function wrapCompileSegmentsInNode({
  canPreserveWrapper,
  childSegments,
  discourseCallout,
  node,
  nodePath,
  orderedListStart,
  orderedListValue,
  rawAttrs,
  wrapperSerializedChars
}: {
  canPreserveWrapper: boolean;
  childSegments: readonly PlannedCompileSegment[];
  discourseCallout: boolean;
  node: PlanningNode;
  nodePath: string;
  orderedListStart: number;
  orderedListValue?: number;
  rawAttrs: string;
  wrapperSerializedChars: number;
}) {
  const tagName = nodeTagName(node);
  const generatedAttributeReserve =
    (tagName === 'ol' ? 32 : 0) +
    (tagName === 'li' && orderedListValue !== undefined ? 96 : 0) +
    (tagName === 'details' ? nodePath.length + 104 : 0) +
    (discourseCallout ? nodePath.length + 104 : 0);
  const unwrapped = () => packAdjacentCompileHtml(childSegments);
  if (!canPreserveWrapper) return unwrapped();
  const packed = packAdjacentCompileHtml(childSegments, {
    domNodes: 1,
    serializedChars: wrapperSerializedChars + generatedAttributeReserve
  });
  const htmlCount = packed.filter((segment) => segment.type === 'html').length;
  let htmlIndex = 0;
  const wrapped = packed.map((segment): PlannedCompileSegment => {
    if (segment.type !== 'html') return segment;
    const index = htmlIndex++;
    let groupRawAttrs = continuationRawAttrs(rawAttrs, index);
    if (tagName === 'li' && orderedListValue !== undefined) {
      groupRawAttrs = rawAttrsWithoutValue(groupRawAttrs, LIST_CONTINUATION_ATTRIBUTE);
      groupRawAttrs = rawAttrsWithValue(groupRawAttrs, 'value', String(orderedListValue));
      if (index > 0) {
        groupRawAttrs = rawAttrsWithValue(groupRawAttrs, LIST_CONTINUATION_ATTRIBUTE, 'true');
        groupRawAttrs = rawAttrsWithStyle(groupRawAttrs, 'list-style-type: none');
      }
    }
    if (tagName === 'ol') {
      const firstListItemTag = segment.fragment.html.match(/<li\b[^>]*>/i)?.[0] || '';
      const firstListItemValue = Number.parseInt(fallbackAttribute(firstListItemTag, 'value'), 10);
      groupRawAttrs = rawAttrsWithValue(
        groupRawAttrs,
        'start',
        String(Number.isNaN(firstListItemValue) ? orderedListStart : firstListItemValue)
      );
    }
    if (tagName === 'details') {
      groupRawAttrs = rawAttrsWithValue(groupRawAttrs, DETAILS_GROUP_ATTRIBUTE, `compile-${nodePath}`);
      groupRawAttrs = rawAttrsWithValue(groupRawAttrs, DETAILS_PART_ATTRIBUTE, continuationFor(index, htmlCount));
    }
    if (discourseCallout) {
      groupRawAttrs = rawAttrsWithValue(groupRawAttrs, CALLOUT_GROUP_ATTRIBUTE, `compile-${nodePath}`);
      groupRawAttrs = rawAttrsWithValue(groupRawAttrs, CALLOUT_PART_ATTRIBUTE, continuationFor(index, htmlCount));
    }
    const html = elementHtmlWithChildren(node, segment.fragment.html, groupRawAttrs);
    return htmlCompileSegment({
      domNodes: segment.fragment.domNodes + 1,
      html,
      mediaSlots: segment.fragment.mediaSlots,
      serializedChars: segment.fragment.serializedChars + tagName.length * 2 + groupRawAttrs.length + 5,
      textChars: segment.fragment.textChars
    });
  });
  return wrapped.every((segment) => segment.type !== 'html' || fragmentFitsRow(segment.fragment))
    ? wrapped
    : unwrapped();
}

function compileNodeWithTypedRows({
  containsTypedDirective,
  metrics,
  node,
  nodePath,
  orderedListValue,
  preservedParentDepth,
  traversalDepth,
  typedDirectives
}: {
  containsTypedDirective: WeakSet<object>;
  metrics: WeakMap<object, NodeMetrics>;
  node: PlanningNode;
  nodePath: string;
  orderedListValue?: number;
  preservedParentDepth: number;
  traversalDepth: number;
  typedDirectives: WeakMap<object, TypedForumContentDirective>;
}): PlannedCompileSegment[] {
  const directive = typedDirectives.get(node);
  if (directive?.type === 'quote') return [{ quote: directive.quote, type: 'quote' }];
  if (directive?.type === 'poll') return directive.poll ? [{ poll: directive.poll, type: 'poll' }] : [];
  if (!containsTypedDirective.has(node)) {
    return fragmentNode(node, metrics, preservedParentDepth, nodePath, traversalDepth, orderedListValue).map(
      htmlCompileSegment
    );
  }

  const tagName = nodeTagName(node);
  if (tagName === 'summary' || PLANNED_ISLAND_TAGS.has(tagName)) {
    return failClosedTypedContainerSegments(node, typedDirectives);
  }
  const children = node.childNodes || [];
  if (!tagName || !children.length) return [];
  const rawAttrs = String(node.rawAttrs || '').trim();
  const discourseCallout = isPlannedDiscourseCallout(node);
  const wrapperSerializedChars = tagName.length * 2 + rawAttrs.length + 5;
  const canPreserveWrapper =
    preservedParentDepth < MAX_PLANNED_ELEMENT_DEPTH - 1 &&
    wrapperSerializedChars < MAX_SERIALIZED_CHARS_PER_PLANNED_ROW;
  const childPreservedParentDepth = canPreserveWrapper ? preservedParentDepth + 1 : preservedParentDepth;
  const orderedListStartCandidate = Number.parseInt(nodeAttribute(node, 'start'), 10);
  const orderedListStart = Number.isNaN(orderedListStartCandidate) ? 1 : orderedListStartCandidate;
  let nextOrderedListValue = orderedListStart;
  const childSegments = children.flatMap((child, childIndex) => {
    const childMetrics = metrics.get(child);
    if (
      discourseCallout &&
      isDiscourseCalloutTitle(child) &&
      !containsTypedDirective.has(child) &&
      (!childMetrics || !metricsFitRow(childMetrics, childPreservedParentDepth))
    ) {
      return [
        htmlCompileSegment({
          domNodes: 2,
          html: CONTENT_TOO_COMPLEX_CALLOUT_TITLE_HTML,
          mediaSlots: 0,
          serializedChars: CONTENT_TOO_COMPLEX_CALLOUT_TITLE_HTML.length,
          textChars: 16
        })
      ];
    }
    let childOrderedListValue: number | undefined;
    if (tagName === 'ol' && nodeTagName(child) === 'li') {
      const explicitValue = Number.parseInt(nodeAttribute(child, 'value'), 10);
      childOrderedListValue = Number.isNaN(explicitValue) ? nextOrderedListValue : explicitValue;
      nextOrderedListValue = childOrderedListValue + 1;
    }
    return compileNodeWithTypedRows({
      containsTypedDirective,
      metrics,
      node: child,
      nodePath: `${nodePath}.${childIndex}`,
      orderedListValue: childOrderedListValue,
      preservedParentDepth: childPreservedParentDepth,
      traversalDepth: traversalDepth + 1,
      typedDirectives
    });
  });
  return wrapCompileSegmentsInNode({
    canPreserveWrapper,
    childSegments,
    discourseCallout,
    node,
    nodePath,
    orderedListStart,
    orderedListValue,
    rawAttrs,
    wrapperSerializedChars
  });
}

function standaloneForumVideo(html: string) {
  const direct = html.match(new RegExp(`^<${FORUM_VIDEO_TAG}\\b([^>]*)>[\\s\\S]*<\\/${FORUM_VIDEO_TAG}\\s*>$`, 'i'));
  const compact = html.match(
    new RegExp(
      `^<div\\s+class=(?:"${FORUM_COMPACT_CONTENT_CLASS}"|'${FORUM_COMPACT_CONTENT_CLASS}')><${FORUM_VIDEO_TAG}\\b([^>]*)>[\\s\\S]*<\\/${FORUM_VIDEO_TAG}\\s*><\\/div\\s*>$`,
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

function compiledRowsFromPlannedSegments(segments: readonly PlannedCompileSegment[]) {
  type CompileOutputGroup =
    { type: 'html'; fragments: HtmlFragment[] } | Extract<PlannedCompileSegment, { type: 'poll' | 'quote' }>;
  const groups: CompileOutputGroup[] = [];
  segments.forEach((segment) => {
    if (segment.type === 'html') {
      const previous = groups.at(-1);
      if (previous?.type === 'html') previous.fragments.push(segment.fragment);
      else groups.push({ fragments: [segment.fragment], type: 'html' });
      return;
    }
    groups.push(segment);
  });
  return groups.flatMap<CompiledForumContentRow>((group, groupIndex) => {
    if (group.type === 'poll') {
      return [
        {
          keySuffix: `poll:${groupIndex}:${group.poll.name || group.poll.id || 'anonymous'}`,
          poll: group.poll,
          type: 'poll'
        }
      ];
    }
    if (group.type === 'quote') {
      return [
        {
          keySuffix: `quote:${groupIndex}:${quotedPostReferenceKey(group.quote.reference)}`,
          quote: group.quote,
          type: 'quote'
        }
      ];
    }
    const groupKey = groups.length > 1 ? `${groupIndex}:block-0` : 'block-0';
    return group.fragments.map((fragment, index) => {
      const video = standaloneForumVideo(fragment.html);
      const plannedRow = {
        continuation: continuationFor(index, group.fragments.length),
        groupKey,
        html: fragment.html,
        keySuffix: `${groupKey}:${index}`,
        networkMediaCount: fragment.mediaSlots
      };
      return video ? { ...plannedRow, ...video, type: 'video' as const } : { ...plannedRow, type: 'html' as const };
    });
  });
}

function compileRoleIncludesPolls(role: ForumContentCompileRole, source: Source) {
  if (role === 'signature') return false;
  if (role === 'opening' || role === 'quoted-reply') return isDiscourseSource(source);
  return true;
}

function compiledRowsFromForumPlan(plan: ForumContentPlan): CompiledForumContentRow[] {
  return plan.rows.map((row) => {
    const { videoPoster, videoReferrerPolicy, videoSrc, ...publicRow } = row;
    const video = videoSrc
      ? {
          src: videoSrc,
          ...(videoPoster ? { poster: videoPoster } : {}),
          ...(videoReferrerPolicy ? { referrerPolicy: videoReferrerPolicy } : {})
        }
      : standaloneForumVideo(row.html);
    return video ? { ...publicRow, ...video, type: 'video' as const } : { ...publicRow, type: 'html' as const };
  });
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
  if (!isDiscourseSource(source)) {
    appendHtml(clean);
  } else {
    const markerPattern = new RegExp(
      `<${DISCOURSE_POLL_PLACEHOLDER_TAG}\\b[^>]*>\\s*</${DISCOURSE_POLL_PLACEHOLDER_TAG}\\s*>`,
      'gi'
    );
    let consumedLength = 0;
    let match: RegExpExecArray | null;
    while ((match = markerPattern.exec(clean))) {
      appendHtml(clean.slice(consumedLength, match.index));
      const poll = pollsByName.get(fallbackAttribute(match[0], 'name'));
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
  if (!descriptors.length) return { html };
  if (descriptors.length > MAX_MEDIA_PER_PLANNED_ROW) {
    throw new Error('Dynamic inline image row exceeded the compiler media budget.');
  }
  const descriptorIndexById = new Map(descriptors.map((descriptor, index) => [descriptor.id, index] as const));
  const variants = Array.from({ length: 1 << descriptors.length }, (_, mask) => {
    DYNAMIC_INLINE_IMAGE_PATTERN.lastIndex = 0;
    const variant = html.replace(DYNAMIC_INLINE_IMAGE_PATTERN, (_tag, rawAttrs: string, label: string) => {
      const id = fallbackAttribute(rawAttrs, FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE);
      const index = descriptorIndexById.get(id);
      if (index === undefined) return '';
      const publicAttrs = rawAttrsWithoutValue(rawAttrs, FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE);
      return mask & (1 << index)
        ? `<${FORUM_INLINE_IMAGE_TAG}${publicAttrs ? ` ${publicAttrs}` : ''}>${label}</${FORUM_INLINE_IMAGE_TAG}>`
        : `<img${publicAttrs ? ` ${publicAttrs}` : ''}>`;
    });
    if (!renderedHtmlFitsBudget(variant)) {
      throw new Error('Dynamic inline image variant exceeded the compiler render budget.');
    }
    return variant;
  });
  const rendering: ForumContentRendering = {
    referrerPolicies: descriptors.map((descriptor) => descriptor.referrerPolicy),
    urls: descriptors.map((descriptor) => normalizeDynamicInlineImageUrl(descriptor.url)),
    variants
  };
  return { html: variants[0], rendering };
}

function materializeCompiledRows(
  rows: readonly CompiledForumContentRow[],
  dynamicInlineImages: readonly DynamicInlineImageDescriptor[]
) {
  if (!dynamicInlineImages.length) return rows;
  const dynamicImagesById = new Map(dynamicInlineImages.map((descriptor) => [descriptor.id, descriptor] as const));
  return rows.map((row): CompiledForumContentRow => {
    if (row.type !== 'html' && row.type !== 'video') return row;
    return { ...row, ...renderingForCompiledRow(row.html, dynamicImagesById) };
  });
}

function compiledForumContentResult(
  rows: readonly CompiledForumContentRow[],
  materializationMetrics: NodeMetrics | null,
  dynamicInlineImages: readonly DynamicInlineImageDescriptor[] = []
): CompiledForumContent {
  const materializedRows = materializeCompiledRows(rows, dynamicInlineImages);
  const renderedRowCount = materializedRows.filter((row) => row.type === 'html' || row.type === 'video').length;
  return {
    materializationBudget: createForumContentMaterializationBudget(
      materializationMetrics,
      renderedRowCount > 0 ? 1 : 0
    ),
    rows: materializedRows
  };
}

export function compileForumContent({
  html,
  polls = [],
  role,
  source,
  topicId
}: {
  html: string | undefined;
  polls?: readonly TopicPoll[];
  role: ForumContentCompileRole;
  source: Source;
  topicId?: string;
}): CompiledForumContent {
  const raw = String(html || '').trim();
  let clean = raw;
  const pollList = compileRoleIncludesPolls(role, source) ? polls : [];
  const pollsByName = new Map(pollList.flatMap((poll) => (poll.name ? [[poll.name, poll] as const] : [])));
  const matchedPolls = new Set<TopicPoll>();
  const extractsOpeningQuotes = role === 'opening' && Boolean(topicId) && isDiscourseSource(source);
  let dynamicInlineImages: readonly DynamicInlineImageDescriptor[] = [];
  try {
    clean = raw
      ? role === 'opening'
        ? normalizeRenderableHtml(raw)
        : `<div class="${FORUM_COMPACT_CONTENT_CLASS}">${normalizeRenderableHtml(raw)}</div>`
      : '';
    const body = parseHtml(`<body>${clean}</body>`).querySelector('body');
    if (body) {
      if (source === 'nodeseek') markNodeSeekReplyReferenceNodes(body, 'https://www.nodeseek.com/');
      dynamicInlineImages = normalizeForumContentMediaNodes(body, { dynamicV2exImages: source === 'v2ex' });
      const materializedHtml = body.innerHTML;
      if (materializedHtml.trim() || !clean.trim()) clean = materializedHtml;
    }
    const nodes = (body?.childNodes || []).filter((node) => node.toString().trim()) as PlanningNode[];
    const analysis = analyzeNodes(nodes, (node) => {
      const tagName = nodeTagName(node);
      if (isDiscourseSource(source) && tagName === DISCOURSE_POLL_PLACEHOLDER_TAG) {
        const poll = pollsByName.get(nodeAttribute(node, 'name'));
        if (poll) matchedPolls.add(poll);
        return { poll, type: 'poll' };
      }
      if (extractsOpeningQuotes && tagName === 'aside' && topicId) {
        const quote = discourseQuotedPostMetadataFromNode(node, source as DiscourseSource, topicId);
        return quote ? { quote, type: 'quote' } : null;
      }
      return null;
    });
    const hasTypedNodes = nodes.some((node) => analysis.containsTypedDirective.has(node));
    const unmatchedPolls = pollList.filter((poll) => !matchedPolls.has(poll));
    if (!hasTypedNodes && !unmatchedPolls.length) {
      const plan = planParsedForumContent(clean, nodes, analysis.metrics);
      return compiledForumContentResult(
        compiledRowsFromForumPlan(plan),
        plan.materializationMetrics,
        dynamicInlineImages
      );
    }
    const segments = packAdjacentCompileHtml([
      ...nodes.flatMap((node, nodeIndex) =>
        compileNodeWithTypedRows({
          containsTypedDirective: analysis.containsTypedDirective,
          metrics: analysis.metrics,
          node,
          nodePath: String(nodeIndex),
          preservedParentDepth: 0,
          traversalDepth: 0,
          typedDirectives: analysis.typedDirectives
        })
      ),
      ...unmatchedPolls.map((poll): PlannedCompileSegment => ({ poll, type: 'poll' }))
    ]);
    return compiledForumContentResult(compiledRowsFromPlannedSegments(segments), null, dynamicInlineImages);
  } catch {
    const fallbackClean = raw
      ? role === 'opening'
        ? raw
        : `<div class="${FORUM_COMPACT_CONTENT_CLASS}">${raw}</div>`
      : '';
    const segments = compileFallbackSegments({ clean: fallbackClean, pollList, source });
    return compiledForumContentResult(
      compiledRowsFromPlannedSegments(segments),
      fallbackClean ? null : combinedNodeMetrics([])
    );
  }
}
