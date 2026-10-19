import type { HTMLElement, Node } from 'node-html-parser';
import type { Reply, TopicDetail, TopicPoll, TopicPollOption } from '@/domain/forum/models';
import {
  absoluteUrl,
  createForumTextIndex,
  elementText,
  escapeHtmlText,
  hasRenderableHtmlContent,
  isRecord,
  parseForumContentHtml,
  parseHtml,
  parsePositiveInteger,
  textExcerpt,
  toIsoString,
  transformForumElements,
  type ForumTextSegment,
  type ForumTextTape
} from '@/domain/forum/html';
import { prepareSanitizedForumContent } from '@/domain/forum/topicContentSplit';
import { accessRequirementFromObject, accessRequirementFromPlainText } from '@/domain/forum/accessRequirements';
import {
  NODESEEK_BASE_URL,
  arrayField,
  nodeSeekExplicitReplyCount,
  nodeSeekEmbeddedUserId,
  nodeSeekRoleLabel,
  nodeSeekSpaceUrl,
  nodeSeekTopicUrl,
  optionalBoolean,
  optionalInteger,
  parseViewCount,
  type NodeSeekPageDocument
} from './protocol';
import { nodeSeekMarkdownCandidateHtml } from './markdown';
import {
  nodeSeekPollPlaceholderHtml,
  normalizeNodeSeekPollPlaceholderNodes,
  normalizeNodeSeekVoteMarkers
} from './polls';
import { NODESEEK_STARDUST_PLACEHOLDER_TAG, normalizeNodeSeekStardustMarkers } from './stardustMarkup';

const BASE_URL = NODESEEK_BASE_URL;

function hasHtmlTag(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function nodeSeekTerminalSourceHtml(renderedHtml: string, markdown: unknown) {
  if (!renderedHtml.includes('terminal-container') || typeof markdown !== 'string' || !markdown.trim()) {
    return renderedHtml;
  }
  const root = parseForumContentHtml(renderedHtml);
  const terminals = root
    .querySelectorAll('.terminal-container, pre')
    .filter(
      (node) =>
        (node.matches('.terminal-container') || node.querySelector('code.language-ansi')) &&
        !node.parentNode?.closest('.terminal-container')
    );
  const source = parseForumContentHtml(nodeSeekMarkdownCandidateHtml(markdown));
  const code = source.querySelectorAll('pre').filter((node) => node.querySelector('code.language-ansi'));
  // The same comment's source order owns the full text; an xterm DOM can be empty or windowed.
  // Do not guess a positional pairing when the source and rendered structures disagree.
  if (!terminals.length || terminals.length !== code.length) return renderedHtml;
  const replacements = new Map<Node, Node[]>();
  const parents = new Set<HTMLElement>();
  terminals.forEach((terminal, index) => {
    const display =
      terminal.querySelector('.xterm') ||
      terminal.querySelector('.xterm-rows') ||
      terminal.querySelector('pre, textarea') ||
      terminal;
    if (display !== terminal) {
      const parent = display.parentNode!;
      parent.set_content(parent.childNodes.map((child) => (child === display ? code[index] : child)));
      replacements.set(terminal, terminal.childNodes);
    } else replacements.set(terminal, [code[index]]);
    parents.add(terminal.parentNode!);
  });
  for (const parent of parents) {
    parent.set_content(parent.childNodes.flatMap((child) => replacements.get(child) || [child]));
  }
  return root.toString();
}

function nodeSeekContentCandidateHtml(content: unknown, markdown: unknown) {
  const renderedHtml = typeof content === 'string' ? content.trim() : '';
  if (renderedHtml && hasHtmlTag(renderedHtml)) {
    return nodeSeekTerminalSourceHtml(renderedHtml, markdown);
  }
  const markdownText = typeof markdown === 'string' ? markdown.trim() : '';
  if (markdownText && hasHtmlTag(markdownText)) {
    return markdownText;
  }
  return nodeSeekMarkdownCandidateHtml(markdownText || renderedHtml);
}

export function prepareNodeSeekForumContent(
  html: unknown,
  {
    polls,
    role,
    topicId
  }: {
    polls?: readonly TopicPoll[];
    role: 'opening' | 'reply' | 'signature';
    topicId?: string;
  }
) {
  const pollIds = (polls || []).flatMap((poll) => (poll.id ? [poll.id] : []));
  return prepareSanitizedForumContent(html, {
    baseUrl: BASE_URL,
    polls,
    role,
    source: 'nodeseek',
    topicId,
    transformRoot: (root) => {
      normalizeNodeSeekVoteMarkers(root, pollIds);
      normalizeNodeSeekStardustMarkers(root);
      if (pollIds.length) normalizeRenderedNodeSeekPollRoot(root, pollIds);
    }
  });
}

function nodeSeekDisplayContent(content: unknown, markdown: unknown) {
  return prepareNodeSeekForumContent(nodeSeekContentCandidateHtml(content, markdown), { role: 'reply' });
}

function nodeSeekEditableMarkdown(markdown: unknown) {
  const raw = typeof markdown === 'string' ? markdown : '';
  return raw.trim() && !hasHtmlTag(raw) ? raw : '';
}

function nodeSeekSignatureContent(signature: unknown) {
  const raw = String(signature || '').trim();
  if (!raw) {
    return undefined;
  }
  return prepareNodeSeekForumContent(hasHtmlTag(raw) ? raw : nodeSeekMarkdownCandidateHtml(raw), {
    role: 'signature'
  });
}

export function extractNodeSeekVoteIds(...values: unknown[]) {
  const ids = new Set<string>();
  values.forEach((value) => {
    const html = String(value || '');
    if (!/nsapp:\/\/vote\?id=/i.test(html)) return;
    const root = parseHtml(html);
    normalizeNodeSeekVoteMarkers(root, []).forEach((id) => ids.add(id));
  });
  return [...ids];
}

function nodeSeekElementHasAttribute(element: HTMLElement, name: string) {
  return Object.prototype.hasOwnProperty.call(element.attributes, name);
}

function nodeSeekParentElement(element: HTMLElement | null | undefined) {
  return element?.parentNode && 'rawTagName' in element.parentNode ? (element.parentNode as HTMLElement) : null;
}

function nodeSeekPollAncestorIndex() {
  const contexts = new Map<HTMLElement, { label: HTMLElement | null; panel: HTMLElement | null }>();
  return (element: HTMLElement) => {
    let current: HTMLElement | null = element;
    const pending: HTMLElement[] = [];
    while (current && !contexts.has(current)) {
      pending.push(current);
      current = nodeSeekParentElement(current);
    }
    let context = (current && contexts.get(current)) || { label: null, panel: null };
    while (pending.length) {
      const node = pending.pop()!;
      context = {
        label: String(node.rawTagName || '').toLowerCase() === 'label' ? node : context.label,
        panel: String(node.getAttribute('class') || '')
          .split(/\s+/)
          .includes('vote-panel')
          ? node
          : context.panel
      };
      contexts.set(node, context);
    }
    return context;
  };
}

function nodeSeekPollCountFromElement(element: HTMLElement | null | undefined) {
  if (!element) {
    return undefined;
  }
  const dataCount = optionalInteger(
    element.getAttribute('data-count') || element.getAttribute('data-votes') || element.getAttribute('aria-label')
  );
  if (dataCount !== undefined) {
    return dataCount;
  }
  const text = elementText(element);
  const match = text.match(/(\d[\d,]*)\s*(?:票|votes?)/i);
  return match ? optionalInteger(match[1]) : undefined;
}

function cleanNodeSeekPollOptionLabel(value: string, countText?: string) {
  let label = value;
  if (countText) {
    label = label.replace(countText, ' ');
  }
  return label
    .replace(/\s*\d[\d,]*\s*(?:票|votes?)\b/gi, ' ')
    .replace(/\s*[（(]\s*\d[\d,]*\s*(?:票|votes?)?\s*[)）]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nodeSeekPollIdFromForm(
  form: HTMLElement,
  fallbackIndex: number,
  hiddenId: HTMLElement | undefined,
  linkedId: () => string | undefined
) {
  const rawId =
    form.getAttribute('data-vote-id') ||
    form.getAttribute('data-voteid') ||
    form.getAttribute('data-id') ||
    hiddenId?.getAttribute('value') ||
    linkedId() ||
    String(form.getAttribute('id') || '').match(/(?:vote|poll)[-_]?(\d+)/i)?.[1] ||
    '';
  return String(rawId || `rendered-${fallbackIndex}`).trim();
}

function nodeSeekPollTitleFromForm(titleElement: HTMLElement | undefined, titles: Map<HTMLElement, string>) {
  if (!titleElement) return undefined;
  let title = titles.get(titleElement);
  if (title === undefined) {
    title = (titleElement.getAttribute('data-title') || elementText(titleElement)).trim();
    titles.set(titleElement, title);
  }
  return title || undefined;
}

type NodeSeekPollLabel = { label: string; count: number | undefined; selected: boolean };

function nodeSeekPollOptionFromInput(
  input: HTMLElement,
  explicitLabel: HTMLElement | undefined,
  wrappingLabel: HTMLElement | null,
  labels: Map<HTMLElement, NodeSeekPollLabel>
): TopicPollOption | null {
  const id = String(
    input.getAttribute('value') ||
      input.getAttribute('data-vote-item-id') ||
      input.getAttribute('data-item-id') ||
      input.getAttribute('id') ||
      ''
  ).trim();
  if (!id) {
    return null;
  }
  const labelContainer = wrappingLabel || explicitLabel || nodeSeekParentElement(input);
  if (!labelContainer) return null;
  let content = labels.get(labelContainer);
  if (!content) {
    const countElement = labelContainer.querySelector('.vote-count, .poll-count, .count, [data-count], [data-votes]');
    const countText = elementText(countElement);
    const label = cleanNodeSeekPollOptionLabel(elementText(labelContainer), countText);
    content = {
      label,
      count: label
        ? (nodeSeekPollCountFromElement(countElement) ?? nodeSeekPollCountFromElement(labelContainer))
        : undefined,
      selected: /(?:selected|active|checked)/i.test(String(labelContainer.getAttribute('class') || ''))
    };
    labels.set(labelContainer, content);
  }
  if (!content.label) return null;
  return {
    id,
    label: content.label,
    ...(content.count !== undefined ? { count: content.count } : {}),
    selected: nodeSeekElementHasAttribute(input, 'checked') || content.selected
  };
}

function nodeSeekPollLowerBound<T>(values: readonly T[], start: number, position: (value: T) => number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (position(values[middle]) < start) low = middle + 1;
    else high = middle;
  }
  return low;
}

function nodeSeekElementIndex(root: HTMLElement) {
  const nodes = [root, ...root.querySelectorAll('*')];
  const ranges = new Map<Node, { start: number; end: number }>(
    nodes.map((node, index) => [node, { start: index, end: index }])
  );
  for (let index = nodes.length - 1; index >= 0; index--) {
    const range = ranges.get(nodes[index])!;
    for (const child of nodes[index].childNodes) {
      const descendant = ranges.get(child);
      if (descendant) range.end = Math.max(range.end, descendant.end);
    }
  }
  const position = (node: HTMLElement) => ranges.get(node)!.start;
  const selections = new Map<string, HTMLElement[]>();
  const selected = (selector: string) => {
    let candidates = selections.get(selector);
    if (!candidates) {
      candidates = root.querySelectorAll(selector);
      selections.set(selector, candidates);
    }
    return candidates;
  };
  const first = (candidates: readonly HTMLElement[], form: HTMLElement) => {
    const range = ranges.get(form)!;
    const candidate = candidates[nodeSeekPollLowerBound(candidates, range.start + 1, position)];
    return candidate && position(candidate) <= range.end ? candidate : undefined;
  };
  const all = (candidates: readonly HTMLElement[], scope: HTMLElement) => {
    const range = ranges.get(scope)!;
    return candidates.slice(
      nodeSeekPollLowerBound(candidates, range.start + 1, position),
      nodeSeekPollLowerBound(candidates, range.end + 1, position)
    );
  };
  const textValues = new Map<HTMLElement, string>();
  const htmlValues = new Map<HTMLElement, string>();
  const text = (node: HTMLElement | null | undefined) => {
    if (!node) return '';
    let value = textValues.get(node);
    if (value === undefined) {
      value = elementText(node);
      textValues.set(node, value);
    }
    return value;
  };
  const html = (node: HTMLElement | null | undefined) => {
    if (!node) return '';
    let value = htmlValues.get(node);
    if (value === undefined) {
      value = node.innerHTML;
      htmlValues.set(node, value);
    }
    return value;
  };
  const scoped = new Map<string, (scope: HTMLElement) => HTMLElement | undefined>();
  // A descendant selector requires its qualifying ancestor inside the row, not merely elsewhere in the document.
  // The maximum ancestor position skips nonmatching overlaps without rescanning each nested row's candidates.
  function scopedFirst(key: string, candidates: HTMLElement[], ancestorSelector: string, selfSelector = '') {
    let find = scoped.get(key);
    if (find) return find;
    if (!candidates.length) {
      find = () => undefined;
      scoped.set(key, find);
      return find;
    }
    const ancestors = new Set(selected(ancestorSelector));
    const self = new Set(selfSelector ? selected(selfSelector) : []);
    const nearest = new Map<Node, number>();
    for (const node of nodes) {
      const parent = node.parentNode;
      nearest.set(node, ancestors.has(node) ? position(node) : parent ? (nearest.get(parent) ?? -1) : -1);
    }
    let size = 1;
    while (size < candidates.length) size *= 2;
    const maximum = new Float64Array(size * 2).fill(-1);
    candidates.forEach((node, index) => {
      const parent = node.parentNode;
      maximum[size + index] = self.has(node) ? Infinity : parent ? (nearest.get(parent) ?? -1) : -1;
    });
    for (let index = size - 1; index > 0; index--)
      maximum[index] = Math.max(maximum[index * 2], maximum[index * 2 + 1]);
    function search(
      index: number,
      start: number,
      end: number,
      from: number,
      to: number,
      scopeStart: number
    ): HTMLElement | undefined {
      if (end <= from || start >= to || maximum[index] <= scopeStart) return undefined;
      if (end - start === 1) return candidates[start];
      const middle = (start + end) >>> 1;
      return (
        search(index * 2, start, middle, from, to, scopeStart) ||
        search(index * 2 + 1, middle, end, from, to, scopeStart)
      );
    }
    find = (scope) => {
      const range = ranges.get(scope)!;
      return search(
        1,
        0,
        size,
        nodeSeekPollLowerBound(candidates, range.start + 1, position),
        nodeSeekPollLowerBound(candidates, range.end + 1, position),
        range.start
      );
    };
    scoped.set(key, find);
    return find;
  }
  let authors: HTMLElement[] | undefined;
  const menuHaystacks = new Map<HTMLElement, string>();
  const reactionCandidates = new Map<string, HTMLElement[]>();
  const labels = new Map<string, HTMLElement[]>();
  let labelsReady = false;
  function prepareLabels() {
    if (labelsReady) return;
    labelsReady = true;
    for (const label of selected('label')) {
      const inputId = label.getAttribute('for');
      if (inputId !== undefined) {
        const candidates = labels.get(inputId) || [];
        candidates.push(label);
        labels.set(inputId, candidates);
      }
    }
  }
  let hiddenIds: HTMLElement[] | undefined;
  return {
    nodes,
    first(selector: string, form: HTMLElement) {
      return first(selected(selector), form);
    },
    all(selector: string, scope: HTMLElement) {
      return all(selected(selector), scope);
    },
    text,
    html,
    author(scope: HTMLElement) {
      authors ||= selected('a[href*="/space/"]').filter((node) => text(node));
      return text(first(authors, scope));
    },
    avatar(scope: HTMLElement) {
      return scopedFirst(
        'avatar',
        selected('.comment-author img, .reply-author img, a[href*="/space/"] img, img.avatar'),
        '.comment-author, .reply-author, a[href*="/space/"]',
        'img.avatar'
      )(scope);
    },
    reaction(keywords: string[], scope: HTMLElement) {
      const key = keywords.join('|');
      let candidates = reactionCandidates.get(key);
      if (!candidates) {
        candidates = selected('.comment-menu .menu-item').filter((item) => {
          let haystack = menuHaystacks.get(item);
          if (haystack === undefined) {
            haystack = [
              item.getAttribute('title'),
              item.getAttribute('aria-label'),
              item.getAttribute('class'),
              html(item)
            ]
              .join(' ')
              .toLowerCase();
            menuHaystacks.set(item, haystack);
          }
          return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
        });
        reactionCandidates.set(key, candidates);
      }
      return scopedFirst('reaction:' + key, candidates, '.comment-menu')(scope);
    },
    label(inputId: string, form: HTMLElement) {
      prepareLabels();
      return inputId ? first(labels.get(inputId) || [], form) : undefined;
    },
    hiddenId(form: HTMLElement) {
      hiddenIds ||= selected('input[type="hidden"]').filter(
        (input) =>
          /^(?:vote_?id|id)$/i.test(String(input.getAttribute('name') || '')) &&
          String(input.getAttribute('value') || '').trim()
      );
      return first(hiddenIds, form);
    },
    inputs(form: HTMLElement) {
      const candidates = selected('input[type="radio"], input[type="checkbox"]');
      const range = ranges.get(form)!;
      return candidates.slice(
        nodeSeekPollLowerBound(candidates, range.start + 1, position),
        nodeSeekPollLowerBound(candidates, range.end + 1, position)
      );
    }
  };
}

function nodeSeekPollFormTextIndex(root: HTMLElement) {
  const index = createForumTextIndex(root);
  const patterns = [/vote|poll/i, /不公开|匿名/, /公开/, /已关闭|投票关闭|closed/i, /已投票|已选择|voted/i];
  type Match = { start: number; end: number };
  const tapes = new Map<ForumTextTape, { flags: Match[][]; links: Match[]; digits: Match[] }>();
  const capture = (source: string, pattern: RegExp) =>
    [...source.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))].map((match) => ({
      start: match.index,
      end: match.index + match[0].length
    }));
  const tapeMatches = (tape: ForumTextTape) => {
    let matches = tapes.get(tape);
    if (!matches) {
      matches = {
        flags: patterns.map((pattern) => capture(tape.text, pattern)),
        links: capture(tape.text, /nsapp:\/\/vote\?id=(?=\d)/i),
        digits: capture(tape.text, /\d+/)
      };
      tapes.set(tape, matches);
    }
    return matches;
  };
  return (node: HTMLElement) => {
    const segment = index.range(node)[0];
    if (!segment) return { marker: false, public: undefined, closed: false, voted: false, linkedId: () => undefined };
    const matches = tapeMatches(segment.tape);
    const flags = matches.flags.map((candidates) => {
      const match = candidates[nodeSeekPollLowerBound(candidates, segment.start, (value) => value.start)];
      return Boolean(match && match.end <= segment.end);
    });
    const linked = matches.links[nodeSeekPollLowerBound(matches.links, segment.start, (value) => value.start)];
    const linkedId = () => {
      if (!linked || linked.end >= segment.end) return undefined;
      const run = matches.digits[nodeSeekPollLowerBound(matches.digits, linked.end + 1, (value) => value.end)];
      return run && run.start <= linked.end
        ? segment.tape.text.slice(linked.end, Math.min(run.end, segment.end)) || undefined
        : undefined;
    };
    return {
      marker: flags[0],
      public: flags[1] ? false : flags[2] ? true : undefined,
      closed: flags[3],
      voted: flags[4],
      linkedId
    };
  };
}

function removeEmptyRenderedNodeSeekPollShells(root: HTMLElement) {
  transformForumElements(root, root.querySelectorAll('.form-mask'), () => []);
  const protectedTags = new Set([
    'img',
    'video',
    'audio',
    'table',
    'pre',
    'code',
    'svg',
    'canvas',
    'input',
    'textarea',
    'select',
    NODESEEK_STARDUST_PLACEHOLDER_TAG
  ]);
  for (const selector of ['.embed-vote', '.vote-panel', 'p']) {
    const candidates = root.querySelectorAll(selector);
    if (!candidates.length) continue;
    const text = createForumTextIndex(root);
    const protectedSubtrees = new Map<Node, boolean>();
    const elements = [root, ...root.querySelectorAll('*')];
    for (let index = elements.length - 1; index >= 0; index--) {
      const element = elements[index];
      protectedSubtrees.set(
        element,
        protectedTags.has(String(element.rawTagName || '').toLowerCase()) ||
          element.childNodes.some((child) => protectedSubtrees.get(child))
      );
    }
    // Earlier preorder removals cannot change a later candidate's own subtree.
    // Rebuild between phases, and exclude the candidate itself as querySelector did.
    transformForumElements(root, candidates, (element) => {
      if (!text.hasText(element) && !element.childNodes.some((child) => protectedSubtrees.get(child))) {
        return [];
      }
    });
  }
}

function parseRenderedNodeSeekPollForms(root: HTMLElement, html: string, contentOffset: number) {
  const elements = nodeSeekElementIndex(root);
  const text = nodeSeekPollFormTextIndex(root);
  const forms = root.querySelectorAll('form').filter((form) => {
    const marker = [
      form.getAttribute('class'),
      form.getAttribute('id'),
      form.getAttribute('action'),
      form.getAttribute('data-vote-id'),
      form.getAttribute('data-voteid')
    ].join(' ');
    return (
      /vote|poll/i.test(marker) ||
      text(form).marker ||
      elements
        .inputs(form)
        .some((input) => /^(?:ids?|ids\[\]|vote|vote-item|option)$/i.test(String(input.getAttribute('name') || '')))
    );
  });
  if (!forms.length) {
    return { html, polls: undefined };
  }
  const ancestors = nodeSeekPollAncestorIndex();
  const labels = new Map<HTMLElement, NodeSeekPollLabel>();
  const titles = new Map<HTMLElement, string>();
  const parsedPolls = forms.map((form, index): TopicPoll | null => {
    const inputs = elements.inputs(form);
    const options = inputs
      .map((input) =>
        nodeSeekPollOptionFromInput(
          input,
          elements.label(String(input.getAttribute('id') || '').trim(), form),
          ancestors(input).label,
          labels
        )
      )
      .filter((option): option is TopicPollOption => Boolean(option));
    if (!options.length) {
      return null;
    }
    const formText = text(form);
    const explicitMultiple = optionalBoolean(form.getAttribute('data-multiple') ?? form.getAttribute('multiple'));
    const multiple =
      explicitMultiple ?? inputs.some((input) => String(input.getAttribute('type') || '').toLowerCase() === 'checkbox');
    const publicState = formText.public;
    const closed = formText.closed || undefined;
    const voted = options.some((option) => option.selected) || formText.voted || undefined;
    return {
      id: nodeSeekPollIdFromForm(form, index, elements.hiddenId(form), formText.linkedId),
      title: nodeSeekPollTitleFromForm(
        elements.first('legend', form) ||
          elements.first('.vote-title', form) ||
          elements.first('.poll-title', form) ||
          elements.first('[data-title]', form) ||
          elements.first('h1, h2, h3, h4', form),
        titles
      ),
      multiple,
      ...(publicState !== undefined ? { public: publicState } : {}),
      ...(closed ? { closed } : {}),
      ...(voted ? { voted } : {}),
      options
    };
  });
  const polls = parsedPolls.filter((poll): poll is TopicPoll => Boolean(poll));
  const replacements = new Map<string, { end: number; html: string; start: number }>();
  forms.forEach((form, index) => {
    const poll = parsedPolls[index];
    const target = poll?.id ? ancestors(form).panel || form : form;
    const start = target.range[0] - contentOffset;
    const end = target.range[1] - contentOffset;
    if (start < 0 || end < start || end > html.length) {
      return;
    }
    replacements.set(`${start}:${end}`, {
      end,
      html: poll?.id ? nodeSeekPollPlaceholderHtml(poll.id) : '',
      start
    });
  });
  // Keep right-to-left source offsets, including overlapping ranges, without copying each intermediate document.
  type Piece = { source: string; start: number; end: number; next: Piece | null };
  let tail: Piece | null = null;
  let boundary = html.length;
  for (const replacement of [...replacements.values()].sort((left, right) => right.start - left.start)) {
    if (replacement.end < boundary) {
      tail = { source: html, start: replacement.end, end: boundary, next: tail };
    } else {
      let skipped = replacement.end - boundary;
      while (tail && skipped >= tail.end - tail.start) {
        skipped -= tail.end - tail.start;
        tail = tail.next;
      }
      if (tail) tail.start += skipped;
    }
    tail = { source: replacement.html, start: 0, end: replacement.html.length, next: tail };
    boundary = replacement.start;
  }
  const pieces = [html.slice(0, boundary)];
  while (tail) {
    pieces.push(tail.source.slice(tail.start, tail.end));
    tail = tail.next;
  }
  const replacedHtml = pieces.join('');
  return {
    html: replacedHtml.trim(),
    polls: polls.length ? polls : undefined
  };
}

export function normalizeRenderedNodeSeekPollRoot(root: HTMLElement, pollIds: Iterable<string>) {
  removeEmptyRenderedNodeSeekPollShells(root);
  normalizeNodeSeekPollPlaceholderNodes(root, pollIds);
}

export function mergeNodeSeekPolls(...groups: (readonly TopicPoll[] | undefined)[]) {
  const seen = new Set<string>();
  const polls: TopicPoll[] = [];
  for (const group of groups) {
    for (const poll of group || []) {
      const key = poll.id || poll.name || JSON.stringify(poll.options.map((option) => option.id));
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      polls.push(poll);
    }
  }
  return polls.length ? polls : undefined;
}

export function normalizeReplies(
  comments: unknown[],
  {
    skipFirst,
    start = 0,
    floorOffset = 0,
    contentOverrides = [],
    skipUnmatchedContent = false
  }: {
    skipFirst: boolean;
    start?: number;
    floorOffset?: number;
    contentOverrides?: readonly Reply[];
    skipUnmatchedContent?: boolean;
  }
) {
  const source = skipFirst ? comments.slice(1) : comments;
  const overridesByCommentId = new Map(
    contentOverrides.flatMap((reply) => (reply.commentId ? [[reply.commentId, reply] as const] : []))
  );
  const overridesByFloor = new Map(
    contentOverrides.flatMap((reply) => (reply.floor ? [[reply.floor, reply] as const] : []))
  );
  return source
    .slice(start)
    .filter(isRecord)
    .map((comment, index) => {
      const poster = isRecord(comment.poster) ? comment.poster : {};
      const authorId = nodeSeekEmbeddedUserId(poster);
      const authorUrl = absoluteUrl(poster.profile, BASE_URL) || (authorId ? nodeSeekSpaceUrl(authorId) : undefined);
      const authorLevelLabel = nodeSeekRoleLabel(poster);
      const rawMarkdown = typeof comment.markdown === 'string' ? comment.markdown : '';
      const contentMarkdown = nodeSeekEditableMarkdown(rawMarkdown);
      const floorIndex = optionalInteger(comment.floorIndex ?? comment.floor);
      const floor = floorIndex ?? floorOffset + start + index + 1;
      const commentId = optionalInteger(comment.commentId);
      const contentOverride =
        (commentId ? overridesByCommentId.get(commentId) : undefined) || overridesByFloor.get(floor);
      const preparedContent =
        contentOverride?.preparedContent ||
        (skipUnmatchedContent ? undefined : nodeSeekDisplayContent(comment.content, rawMarkdown));
      const preparedSignature =
        contentOverride?.preparedSignature ||
        (skipUnmatchedContent ? undefined : nodeSeekSignatureContent(comment.signature));
      const contentHtml = contentOverride?.contentHtml || preparedContent?.contentHtml || '';
      const signatureHtml = contentOverride?.signatureHtml || preparedSignature?.contentHtml;
      return {
        author: String(poster.name || ''),
        authorAvatar: absoluteUrl(poster.avatar, BASE_URL),
        authorId: authorId || undefined,
        authorUrl,
        ...(authorLevelLabel ? { authorLevelLabel } : {}),
        contentHtml,
        ...(preparedContent ? { preparedContent } : {}),
        ...(contentMarkdown ? { contentMarkdown } : {}),
        createdAt: toIsoString(isRecord(comment.time) ? comment.time.createdDate : comment.createdDate),
        floor,
        commentId,
        upvoteCount: optionalInteger(comment.upvoteCount),
        likeCount: optionalInteger(comment.likeCount),
        dislikeCount: optionalInteger(comment.dislikeCount),
        upvoted: optionalBoolean(comment.upvoted),
        liked: optionalBoolean(comment.liked),
        disliked: optionalBoolean(comment.disliked),
        ...(poster.isMe === true ? { canEdit: true, canLike: false } : {}),
        isOp: poster.isOp === true || String(poster.info || '').trim() === '楼主' || undefined,
        hot: comment.hot === true || undefined,
        pinned: comment.pined === true || comment.pinned === true || undefined,
        signatureHtml,
        ...(preparedSignature ? { preparedSignature } : {})
      };
    });
}

export function normalizePostData(
  data: Record<string, unknown>,
  id: string,
  url: string,
  replyLimit = 30,
  rendered?: TopicDetail
): TopicDetail {
  const comments = arrayField(data.comments);
  const first = isRecord(comments[0]) ? comments[0] : {};
  const op = isRecord(data.op) ? data.op : {};
  const poster = isRecord(first.poster) ? first.poster : {};
  const category = isRecord(data.category) ? data.category : isRecord(data.node) ? data.node : {};
  const categoryLink = String(data.categoryLink || '');
  const categoryId =
    typeof category.key === 'string'
      ? category.key
      : typeof data.category === 'string'
        ? data.category
        : categoryLink.match(/\/categories\/([^/?#]+)/)?.[1];
  const categoryName =
    typeof category.name === 'string'
      ? category.name
      : typeof data.categoryWord === 'string'
        ? data.categoryWord
        : undefined;
  const allReplies = normalizeReplies(comments, {
    skipFirst: true,
    contentOverrides: rendered?.replies,
    skipUnmatchedContent: Boolean(rendered?.replies.length)
  });
  const replies = allReplies.slice(0, replyLimit);
  const replyCount = nodeSeekExplicitReplyCount(data);
  const hasLocalRemainder = allReplies.length > replyLimit;
  const createdAt =
    toIsoString(isRecord(first.time) ? first.time.createdDate : data.createdDate) || new Date().toISOString();
  const lastComment = comments.at(-1);
  let lastCommentDate: unknown;
  if (isRecord(lastComment)) {
    lastCommentDate = isRecord(lastComment.time) ? lastComment.time.createdDate : lastComment.createdDate;
  }
  const lastReplyAt = toIsoString(lastCommentDate || data.updatedDate) || createdAt;
  const accessRequirement = accessRequirementFromObject(data);
  const authorId = nodeSeekEmbeddedUserId(op) || nodeSeekEmbeddedUserId(poster);
  const authorUrl =
    absoluteUrl(op.profile || poster.profile, BASE_URL) || (authorId ? nodeSeekSpaceUrl(authorId) : undefined);
  const authorLevelLabel = nodeSeekRoleLabel(poster) || nodeSeekRoleLabel(op);
  return {
    source: 'nodeseek',
    id,
    title: String(data.title || ''),
    author: String(op.name || poster.name || ''),
    authorAvatar: absoluteUrl(op.avatar || poster.avatar, BASE_URL),
    authorId: authorId || undefined,
    authorUrl,
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    categoryId,
    category: categoryName,
    url,
    createdAt,
    lastReplyAt,
    ...(replyCount !== undefined ? { replyCount } : {}),
    viewCount: parseViewCount(data.views),
    excerpt: rendered?.excerpt || textExcerpt(first.content || first.markdown),
    contentHtml: rendered?.contentHtml || nodeSeekContentCandidateHtml(first.content, first.markdown),
    commentId: optionalInteger(first.commentId),
    canEdit: poster.isMe === true,
    upvoteCount: optionalInteger(first.upvoteCount),
    likeCount: optionalInteger(first.likeCount),
    dislikeCount: optionalInteger(first.dislikeCount),
    upvoted: optionalBoolean(first.upvoted),
    liked: optionalBoolean(first.liked),
    disliked: optionalBoolean(first.disliked),
    collectionCount: optionalInteger(data.collectionCount),
    collected: optionalBoolean(data.collected),
    locked: optionalBoolean(data.locked),
    ...(accessRequirement ? { accessRequirement } : {}),
    replies,
    replyHasMore: hasLocalRemainder,
    replyNextPage: hasLocalRemainder ? 1 : null,
    replyNextOffset: hasLocalRemainder ? replies.length : null
  };
}

export function mergeRenderedNodeSeekReply(rendered: Reply, embedded?: Reply): Reply {
  if (!embedded) {
    return rendered;
  }
  return {
    ...embedded,
    ...rendered,
    author: rendered.author || embedded.author,
    contentHtml: rendered.contentHtml || embedded.contentHtml,
    createdAt: rendered.createdAt || embedded.createdAt,
    commentId: rendered.commentId ?? embedded.commentId,
    upvoteCount: rendered.upvoteCount ?? embedded.upvoteCount,
    likeCount: rendered.likeCount ?? embedded.likeCount,
    dislikeCount: rendered.dislikeCount ?? embedded.dislikeCount,
    upvoted: rendered.upvoted ?? embedded.upvoted,
    liked: rendered.liked ?? embedded.liked,
    disliked: rendered.disliked ?? embedded.disliked,
    canEdit: embedded.canEdit ?? rendered.canEdit,
    canLike: embedded.canLike ?? rendered.canLike,
    canDelete: embedded.canDelete ?? rendered.canDelete,
    deletePath: embedded.deletePath ?? rendered.deletePath,
    contentMarkdown: embedded.contentMarkdown ?? rendered.contentMarkdown
  };
}

export function matchingEmbeddedNodeSeekReply(reply: Reply, embeddedReplies: Reply[]) {
  return embeddedReplies.find((item) =>
    reply.commentId && item.commentId
      ? item.commentId === reply.commentId
      : Boolean(reply.floor && item.floor === reply.floor)
  );
}

export function mergeRenderedNodeSeekTopic(rendered: TopicDetail, embedded?: TopicDetail): TopicDetail {
  const renderedReplies = rendered.replies.map((reply, index) => ({
    ...reply,
    floor: reply.floor ?? index + 1
  }));
  if (!embedded) {
    return { ...rendered, replies: renderedReplies };
  }
  const replies = renderedReplies.length
    ? renderedReplies.map((reply) =>
        mergeRenderedNodeSeekReply(reply, matchingEmbeddedNodeSeekReply(reply, embedded.replies))
      )
    : embedded.replies;
  const useRenderedCursor = Boolean(rendered.replies.length && rendered.replyHasMore);
  const replyHasMore = useRenderedCursor || Boolean(embedded.replyHasMore);
  return {
    ...embedded,
    ...rendered,
    title: rendered.title || embedded.title,
    author: rendered.author || embedded.author,
    contentHtml: rendered.contentHtml || embedded.contentHtml,
    createdAt: rendered.createdAt || embedded.createdAt,
    commentId: rendered.commentId ?? embedded.commentId,
    canEdit: embedded.canEdit ?? rendered.canEdit,
    upvoteCount: rendered.upvoteCount ?? embedded.upvoteCount,
    likeCount: rendered.likeCount ?? embedded.likeCount,
    dislikeCount: rendered.dislikeCount ?? embedded.dislikeCount,
    upvoted: rendered.upvoted ?? embedded.upvoted,
    liked: rendered.liked ?? embedded.liked,
    disliked: rendered.disliked ?? embedded.disliked,
    collectionCount: rendered.collectionCount ?? embedded.collectionCount,
    collected: rendered.collected ?? embedded.collected,
    locked: rendered.locked ?? embedded.locked,
    ...(typeof embedded.replyCount === 'number'
      ? { replyCount: embedded.replyCount }
      : typeof rendered.replyCount === 'number'
        ? { replyCount: rendered.replyCount }
        : {}),
    replies,
    replyHasMore,
    replyNextPage: replyHasMore ? (useRenderedCursor ? rendered.replyNextPage : embedded.replyNextPage) : null,
    replyNextOffset: replyHasMore ? (useRenderedCursor ? rendered.replyNextOffset : embedded.replyNextOffset) : null
  };
}

function renderedNodeSeekTime(element: ReturnType<ReturnType<typeof parseHtml>['querySelector']>) {
  return toIsoString(element?.getAttribute('datetime') || element?.getAttribute('title') || elementText(element));
}

function renderedNodeSeekCommentId(element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number]) {
  const dataCommentId = parsePositiveInteger(element.getAttribute('data-comment-id'));
  if (dataCommentId) {
    return dataCommentId;
  }
  const source = `${element.getAttribute('id') || ''}`;
  const match = source.match(/comment[-_]?(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

type NodeSeekElementIndex = ReturnType<typeof nodeSeekElementIndex>;

function renderedNodeSeekFirst(
  element: HTMLElement | null | undefined,
  selector: string,
  elements: NodeSeekElementIndex
) {
  return element ? elements.first(selector, element) || null : null;
}

function renderedNodeSeekAll(
  element: HTMLElement | null | undefined,
  selector: string,
  elements: NodeSeekElementIndex
) {
  return element ? elements.all(selector, element) : [];
}

function renderedNodeSeekText(element: HTMLElement | null | undefined, elements: NodeSeekElementIndex) {
  return elements.text(element);
}

function renderedNodeSeekAuthor(element: HTMLElement | null | undefined, elements: NodeSeekElementIndex) {
  if (!element) {
    return '';
  }
  return (
    renderedNodeSeekText(renderedNodeSeekFirst(element, '.author-name', elements), elements) ||
    renderedNodeSeekText(renderedNodeSeekFirst(element, '.comment-author', elements), elements) ||
    renderedNodeSeekText(renderedNodeSeekFirst(element, '.reply-author', elements), elements) ||
    elements.author(element) ||
    ''
  );
}

function renderedNodeSeekAvatar(element: HTMLElement | null | undefined, elements: NodeSeekElementIndex) {
  if (!element) {
    return undefined;
  }
  return absoluteUrl(elements.avatar(element)?.getAttribute('src'), BASE_URL);
}

function renderedNodeSeekFloor(
  element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number],
  elements: NodeSeekElementIndex
) {
  const linkFloor = parsePositiveInteger(
    renderedNodeSeekText(renderedNodeSeekFirst(element, '.floor-link', elements), elements)
  );
  if (linkFloor) {
    return linkFloor;
  }
  const id = String(element.getAttribute('id') || '');
  return /^\d+$/.test(id) ? Number(id) : undefined;
}

function renderedNodeSeekReactionItem(
  element: HTMLElement | null | undefined,
  keywords: string[],
  elements: NodeSeekElementIndex
) {
  return element ? elements.reaction(keywords, element) || null : null;
}

function renderedNodeSeekReactionCount(
  element: HTMLElement | null | undefined,
  keywords: string[],
  elements: NodeSeekElementIndex
) {
  const item = renderedNodeSeekReactionItem(element, keywords, elements);
  if (!item) {
    return undefined;
  }
  return optionalInteger(
    renderedNodeSeekText(renderedNodeSeekFirst(item, 'span', elements), elements) ||
      item.getAttribute('data-count') ||
      item.getAttribute('title') ||
      renderedNodeSeekText(item, elements)
  );
}

function renderedNodeSeekReactionClicked(
  element: HTMLElement | null | undefined,
  keywords: string[],
  elements: NodeSeekElementIndex
) {
  const item = renderedNodeSeekReactionItem(element, keywords, elements);
  return item
    ? String(item.getAttribute('class') || '')
        .split(/\s+/)
        .includes('clicked') || undefined
    : undefined;
}

function renderedNodeSeekSignature(element: HTMLElement | null | undefined, elements: NodeSeekElementIndex) {
  const signature = renderedNodeSeekFirst(element, '.signature, .post-signature, .content-signature', elements);
  const html = elements.html(signature);
  return html ? prepareNodeSeekForumContent(html, { role: 'signature' }) : undefined;
}

function renderedNodeSeekIsOp(element: HTMLElement | null | undefined, elements: NodeSeekElementIndex) {
  return (
    Boolean(
      renderedNodeSeekFirst(element, '.is-poster, .poster-badge', elements) ||
      renderedNodeSeekText(renderedNodeSeekFirst(element, '.role-tag', elements), elements).trim() === '楼主'
    ) || undefined
  );
}

function renderedNodeSeekRoleLabel(element: HTMLElement | null | undefined, elements: NodeSeekElementIndex) {
  const authorInfo =
    renderedNodeSeekFirst(element, '.author-info, .post-info, .comment-author, .reply-author', elements) || element;
  const labels = renderedNodeSeekAll(authorInfo, '.role-tag, .nsk-badge', elements)
    .filter(
      (badge) =>
        !String(badge.getAttribute('class') || '')
          .split(/\s+/)
          .some((className) => className === 'is-poster' || className === 'poster-badge')
    )
    .map((badge) => renderedNodeSeekText(badge, elements))
    .filter((label) => label && label !== '楼主');
  return labels.join(' · ') || undefined;
}

function nodeSeekMetaContent(root: ReturnType<typeof parseHtml>, selector: string) {
  return String(root.querySelector(selector)?.getAttribute('content') || '').trim();
}

function nodeSeekRenderedTitle(root: ReturnType<typeof parseHtml>, restrictedNotice?: string) {
  const titleElement =
    root.querySelector('.post-title a') ||
    root.querySelector('a.post-title') ||
    root.querySelector('article .post-title') ||
    root.querySelector('.post-detail .post-title') ||
    root.querySelector('.post-title') ||
    root.querySelector('h1');
  const title =
    elementText(titleElement) ||
    nodeSeekMetaContent(root, 'meta[property="og:title"]') ||
    nodeSeekMetaContent(root, 'meta[name="twitter:title"]') ||
    elementText(root.querySelector('title'));
  if (title && title !== 'NodeSeek') {
    return title;
  }
  return restrictedNotice ? '受限帖子' : title;
}

function nodeSeekRestrictedNotice(root: ReturnType<typeof parseHtml>, nodes: readonly HTMLElement[]) {
  const textIndex = createForumTextIndex(root, new Set(root.querySelectorAll('script, style')));
  const facts = new Map<Node, { start: number; end: number; media: boolean }>();
  const mediaTags = new Set(['img', 'video', 'pre', 'code']);
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    const fact = { start: index, end: index, media: mediaTags.has(String(node.rawTagName || '').toLowerCase()) };
    for (const child of node.childNodes) {
      const childFact = facts.get(child);
      fact.media ||= childFact?.media === true;
      fact.end = Math.max(fact.end, childFact?.end ?? index);
    }
    facts.set(node, fact);
  }
  const text = (node: HTMLElement | null | undefined) => {
    const segment = node && textIndex.range(node)[0];
    return segment ? segment.tape.text.slice(segment.start, segment.end).replace(/\s+/g, ' ').trim() : '';
  };
  const restricted = root.querySelector('.restricted-post') || root.querySelector('.post-restricted');
  const restrictedText = text(restricted);
  if (accessRequirementFromPlainText(restrictedText)) return restrictedText;
  const readableContent = root
    .querySelectorAll('.post-content, .comment-content, .reply-content, .content-item .content')
    .some((node) => textIndex.hasText(node) || node.childNodes.some((child) => facts.get(child)?.media));
  if (readableContent) return '';
  function findNotice(candidates: HTMLElement[], minLength = 0) {
    const negatives: { through: number; segment: ForumTextSegment }[] = [];
    for (const node of candidates) {
      const fact = facts.get(node)!;
      while (negatives.length && negatives[negatives.length - 1].through < fact.start) negatives.pop();
      const segment = textIndex.range(node)[0];
      if (!segment) continue;
      const negative = negatives[negatives.length - 1]?.segment;
      if (negative?.tape === segment.tape && segment.start >= negative.start && segment.end <= negative.end) continue;
      const value = text(node);
      if (value.length >= minLength && accessRequirementFromPlainText(value)) return value;
      // DOM order controls lifetime; only a subrange of the same negative text snapshot can be skipped.
      negatives.push({ through: fact.end, segment });
    }
    return '';
  }
  const explicitText = findNotice(root.querySelectorAll('.empty-state, .notice, .alert'));
  if (explicitText) return explicitText;
  if (!root.querySelector('#nsk-body')) return '';
  const bodyLeft = root.querySelector('#nsk-body-left') || root.querySelector('#nsk-body');
  const bodyRange = bodyLeft && facts.get(bodyLeft);
  return findNotice(
    (bodyRange ? nodes.slice(bodyRange.start + 1, bodyRange.end + 1) : []).filter(
      (node) => !['script', 'style', 'svg'].includes(String(node.rawTagName || '').toLowerCase())
    ),
    4
  );
}

export function parseRenderedNodeSeekTopicHtml(
  document: NodeSeekPageDocument,
  id: string,
  replyLimit = 30,
  page = 1
): TopicDetail | null {
  const { html, root } = document;
  const firstContentItem = root.querySelector('.content-item');
  const contentRows = root.querySelectorAll(
    '.content-item, .comment-item, .comment-list > li, .comments > li, [id^="comment-"]'
  );
  const elements = nodeSeekElementIndex(root);
  const firstContentItemIsReplyContainer = String(firstContentItem?.rawTagName || '').toLowerCase() === 'li';
  const identifiedFirstReply = Boolean(
    page > 1 &&
    firstContentItem &&
    (renderedNodeSeekFloor(firstContentItem, elements) ||
      renderedNodeSeekCommentId(firstContentItem) ||
      (firstContentItemIsReplyContainer &&
        (renderedNodeSeekAuthor(firstContentItem, elements) ||
          hasRenderableHtmlContent(
            renderedNodeSeekFirst(
              firstContentItem,
              '.post-content, .comment-content, .reply-content, .content',
              elements
            )?.innerHTML
          ))))
  );
  const markdownByCommentId = new Map<number, unknown>();
  const markdownByFloor = new Map<number, unknown>();
  const sourceFloor = (row: HTMLElement) =>
    row === firstContentItem && !identifiedFirstReply ? 0 : renderedNodeSeekFloor(row, elements);
  const postData = document.embedded?.postData;
  if (html.includes('terminal-container') && isRecord(postData)) {
    for (const comment of arrayField(postData.comments)) {
      if (!isRecord(comment)) continue;
      const commentId = optionalInteger(comment.commentId);
      const floor = optionalInteger(comment.floorIndex ?? comment.floor);
      if (commentId !== undefined) {
        markdownByCommentId.set(commentId, markdownByCommentId.has(commentId) ? undefined : comment.markdown);
      }
      if (floor !== undefined) {
        markdownByFloor.set(floor, markdownByFloor.has(floor) ? undefined : comment.markdown);
      }
    }
    const seenCommentIds = new Set<number>();
    const seenFloors = new Set<number>();
    for (const row of contentRows) {
      const commentId = renderedNodeSeekCommentId(row);
      const floor = sourceFloor(row);
      if (commentId !== undefined) {
        if (seenCommentIds.has(commentId)) markdownByCommentId.set(commentId, undefined);
        seenCommentIds.add(commentId);
      }
      if (floor !== undefined) {
        if (seenFloors.has(floor)) markdownByFloor.set(floor, undefined);
        seenFloors.add(floor);
      }
    }
  }
  const sourceMarkdownFor = (row: HTMLElement | null) => {
    if (!row) return undefined;
    const commentId = renderedNodeSeekCommentId(row);
    if (commentId) return markdownByCommentId.get(commentId);
    const floor = sourceFloor(row);
    return floor === undefined ? undefined : markdownByFloor.get(floor);
  };
  const restrictedNotice = nodeSeekRestrictedNotice(root, elements.nodes);
  let contentElement =
    firstContentItem?.querySelector('.post-content') || firstContentItem?.querySelector('.content') || null;
  if (!contentElement) {
    const contents = root.querySelectorAll('.post-content');
    const ancestors = new Map<HTMLElement, { article: boolean; detail: boolean }>();
    function contextFor(node: HTMLElement) {
      const pending: HTMLElement[] = [];
      let current: HTMLElement | null = node;
      while (current && !ancestors.has(current)) {
        pending.push(current);
        current = current.parentNode;
      }
      let context = (current && ancestors.get(current)) || { article: false, detail: false };
      while (pending.length) {
        const parent = pending.pop()!;
        context = {
          article: context.article || String(parent.rawTagName || '').toLowerCase() === 'article',
          detail:
            context.detail ||
            String(parent.getAttribute('class') || '')
              .split(/\s+/)
              .includes('post-detail')
        };
        ancestors.set(parent, context);
      }
      return context;
    }
    contentElement =
      contents.find((node) => node.parentNode && contextFor(node.parentNode).article) ||
      contents.find((node) => node.parentNode && contextFor(node.parentNode).detail) ||
      contents[0] ||
      null;
  }
  const title = nodeSeekRenderedTitle(root, restrictedNotice);
  const renderedContentHasForm = Boolean(contentElement?.querySelector('form'));
  const renderedContentOuterHtml =
    contentElement && renderedContentHasForm ? html.slice(contentElement.range[0], contentElement.range[1]) : '';
  const renderedContentOpeningEnd = renderedContentOuterHtml.indexOf('>');
  const renderedContentClosingStart = renderedContentOuterHtml
    .toLowerCase()
    .lastIndexOf(`</${String(contentElement?.rawTagName || '').toLowerCase()}`);
  const rawRenderedContentHtml =
    renderedContentOpeningEnd >= 0 && renderedContentClosingStart > renderedContentOpeningEnd
      ? renderedContentOuterHtml.slice(renderedContentOpeningEnd + 1, renderedContentClosingStart)
      : '';
  const renderedContentSource = String(
    renderedContentHasForm && rawRenderedContentHtml ? rawRenderedContentHtml : contentElement?.innerHTML || ''
  );
  const renderedPolls =
    contentElement && renderedContentHasForm && rawRenderedContentHtml
      ? parseRenderedNodeSeekPollForms(
          contentElement,
          renderedContentSource,
          contentElement.range[0] + renderedContentOpeningEnd + 1
        )
      : { html: renderedContentSource, polls: undefined };
  const renderedContentHtml = renderedPolls.html.trim();
  const contentHtml = renderedContentHtml || escapeHtmlText(restrictedNotice);
  if (!title || (!contentHtml && !identifiedFirstReply)) {
    return null;
  }
  const accessRequirement = accessRequirementFromPlainText(restrictedNotice);
  const authorContainer =
    firstContentItem || root.querySelector('article') || root.querySelector('.post-detail') || root;
  const categoryLink =
    firstContentItem?.querySelector('.content-category a[href*="/categories/"], a[href*="/categories/"]') ||
    root.querySelector('article a[href*="/categories/"]') ||
    root.querySelector('.post-detail a[href*="/categories/"]') ||
    root.querySelector('.post-info a[href*="/categories/"]') ||
    root.querySelector('a[href*="/categories/"]');
  const categoryHref = categoryLink?.getAttribute('href') || '';
  const createdAt =
    renderedNodeSeekTime(
      firstContentItem?.querySelector('time') ||
        root.querySelector('article time') ||
        root.querySelector('.post-detail time') ||
        root.querySelector('time')
    ) || new Date().toISOString();
  const cleanedContentHtml = nodeSeekTerminalSourceHtml(
    renderedContentHtml ? renderedPolls.html : contentHtml,
    sourceMarkdownFor(firstContentItem)
  );
  const replyRows = contentRows.filter((row) => {
    if (row === firstContentItem && !identifiedFirstReply) return false;
    const replyContent = renderedNodeSeekFirst(
      row,
      '.post-content, .comment-content, .reply-content, .content',
      elements
    );
    return Boolean(
      renderedNodeSeekCommentId(row) ||
      renderedNodeSeekFloor(row, elements) ||
      renderedNodeSeekAuthor(row, elements) ||
      hasRenderableHtmlContent(replyContent?.innerHTML)
    );
  });
  const allReplies = replyRows.map((row) => {
    const replyContent = renderedNodeSeekFirst(
      row,
      '.post-content, .comment-content, .reply-content, .content',
      elements
    );
    const preparedContent = prepareNodeSeekForumContent(
      nodeSeekTerminalSourceHtml(elements.html(replyContent), sourceMarkdownFor(row)),
      { role: 'reply' }
    );
    const preparedSignature = renderedNodeSeekSignature(row, elements);
    const authorHref = renderedNodeSeekFirst(row, 'a[href*="/space/"]', elements)?.getAttribute('href') || '';
    const authorId = authorHref.match(/\/space\/(\d+)/)?.[1];
    const authorLevelLabel = renderedNodeSeekRoleLabel(row, elements);
    return {
      author: renderedNodeSeekAuthor(row, elements),
      authorAvatar: renderedNodeSeekAvatar(row, elements),
      authorId,
      authorUrl: authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
      ...(authorLevelLabel ? { authorLevelLabel } : {}),
      contentHtml: preparedContent.contentHtml,
      preparedContent,
      createdAt: renderedNodeSeekTime(renderedNodeSeekFirst(row, 'time', elements)) || '',
      floor: renderedNodeSeekFloor(row, elements),
      commentId: renderedNodeSeekCommentId(row),
      upvoteCount: renderedNodeSeekReactionCount(row, ['点赞', 'good-one', 'upvote'], elements),
      likeCount: renderedNodeSeekReactionCount(row, ['加鸡腿', 'chicken-leg'], elements),
      dislikeCount: renderedNodeSeekReactionCount(row, ['反对', 'bad-one', 'oppose', 'dislike'], elements),
      upvoted: renderedNodeSeekReactionClicked(row, ['点赞', 'good-one', 'upvote'], elements),
      liked: renderedNodeSeekReactionClicked(row, ['加鸡腿', 'chicken-leg'], elements),
      disliked: renderedNodeSeekReactionClicked(row, ['反对', 'bad-one', 'oppose', 'dislike'], elements),
      isOp: renderedNodeSeekIsOp(row, elements),
      hot: Boolean(renderedNodeSeekFirst(row, '.hot-badge', elements)) || undefined,
      pinned: Boolean(renderedNodeSeekFirst(row, '.pined-badge, .pinned-badge, .pin-badge', elements)) || undefined,
      signatureHtml: preparedSignature?.contentHtml,
      ...(preparedSignature ? { preparedSignature } : {})
    };
  });
  const replies = allReplies.slice(0, replyLimit);
  const lastReplyAt = allReplies.at(-1)?.createdAt || createdAt;
  const authorHref = renderedNodeSeekFirst(authorContainer, 'a[href*="/space/"]', elements)?.getAttribute('href') || '';
  const authorId = authorHref.match(/\/space\/(\d+)/)?.[1];
  const authorLevelLabel = renderedNodeSeekRoleLabel(authorContainer, elements);
  return {
    source: 'nodeseek',
    id,
    title,
    author: renderedNodeSeekAuthor(authorContainer, elements),
    authorAvatar: renderedNodeSeekAvatar(authorContainer, elements),
    authorId,
    authorUrl: authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    categoryId: categoryHref.match(/\/categories\/([^/?#]+)/)?.[1],
    category: elementText(categoryLink) || undefined,
    url: nodeSeekTopicUrl(id),
    createdAt,
    lastReplyAt,
    excerpt: textExcerpt(cleanedContentHtml || contentHtml),
    contentHtml: cleanedContentHtml,
    ...(renderedPolls.polls ? { polls: renderedPolls.polls } : {}),
    ...(accessRequirement ? { accessRequirement } : {}),
    commentId: firstContentItem ? renderedNodeSeekCommentId(firstContentItem) : undefined,
    upvoteCount: renderedNodeSeekReactionCount(firstContentItem, ['点赞', 'good-one', 'upvote'], elements),
    likeCount: renderedNodeSeekReactionCount(firstContentItem, ['加鸡腿', 'chicken-leg'], elements),
    dislikeCount: renderedNodeSeekReactionCount(firstContentItem, ['反对', 'bad-one', 'oppose', 'dislike'], elements),
    upvoted: renderedNodeSeekReactionClicked(firstContentItem, ['点赞', 'good-one', 'upvote'], elements),
    liked: renderedNodeSeekReactionClicked(firstContentItem, ['加鸡腿', 'chicken-leg'], elements),
    disliked: renderedNodeSeekReactionClicked(firstContentItem, ['反对', 'bad-one', 'oppose', 'dislike'], elements),
    collectionCount: renderedNodeSeekReactionCount(
      firstContentItem,
      ['收藏', 'star', 'favorite', 'collect', 'bookmark'],
      elements
    ),
    replies,
    replyHasMore: allReplies.length > replyLimit,
    replyNextPage: allReplies.length > replyLimit ? 1 : null,
    replyNextOffset: allReplies.length > replyLimit ? replies.length : null
  };
}
