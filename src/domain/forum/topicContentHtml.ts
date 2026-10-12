import {
  createForumTextIndex,
  elementText,
  escapeHtmlAttribute,
  escapeHtmlText,
  escapeQuotedHtmlTagDelimiters,
  forumElementReplacementNodes,
  parseHtml,
  transformForumElements,
  type ForumTextSegment
} from './html';
import { HTMLElement, TextNode, type Node } from 'node-html-parser';
import { isNodeSeekHost, sourceCatalog } from './sourceCatalog';

export const FORUM_REPLY_REFERENCE_TAG = 'forum-reply-reference';
const FORUM_USER_MENTION_CLASS = 'forum-user-mention';
const NODESEEK_MENTION_CLASS = 'forum-mention-link';
const NODESEEK_FLOOR_CLASS = 'forum-floor-link';

function addHtmlClass(attributes: string, className: string) {
  if (new RegExp(`\\b${className}\\b`).test(attributes)) {
    return attributes;
  }
  if (/\sclass=(["'])(.*?)\1/i.test(attributes)) {
    return attributes.replace(
      /\sclass=(["'])(.*?)\1/i,
      (_match, quote: string, value: string) => ` class=${quote}${value} ${className}${quote}`
    );
  }
  return `${attributes} class="${className}"`;
}

function hrefAttribute(attributes: string) {
  return attributes.match(/\bhref=(["'])(.*?)\1/i)?.[2] || '';
}

function isForumUserMentionHref(href: string) {
  return (
    /^(?:https?:\/\/(?:www\.)?v2ex\.com)?\/member\/[^/?#"'<>]+/i.test(href) ||
    /^(?:https?:\/\/(?:www\.)?linux\.do)?\/u\/[^?#"'<>]+/i.test(href) ||
    /^(?:https?:\/\/(?:www\.)?yaohuo\.me)?\/(?:bbs\/)?userinfo\.aspx\?[^"'<>]*\b(?:touserid|userid)=\d+/i.test(href)
  );
}

function mentionLabel(label: string) {
  return `@${label.replace(/^@+/, '')}`;
}

function markForumUserMentions(html: string) {
  return escapeQuotedHtmlTagDelimiters(html)
    .replace(
      /@<a\b([^>]*\bhref=(["'])[^"']+\2[^>]*)>([^<]+)<\/a>/gi,
      (match, attributes: string, _quote: string, label: string) =>
        isForumUserMentionHref(hrefAttribute(attributes))
          ? `<a${addHtmlClass(attributes, FORUM_USER_MENTION_CLASS)}>${mentionLabel(label)}</a>`
          : match
    )
    .replace(
      /<a\b([^>]*\bhref=(["'])[^"']+\2[^>]*)>(@[^<]+)<\/a>/gi,
      (match, attributes: string, _quote: string, label: string) =>
        isForumUserMentionHref(hrefAttribute(attributes))
          ? `<a${addHtmlClass(attributes, FORUM_USER_MENTION_CLASS)}>${mentionLabel(label)}</a>`
          : match
    );
}

export function normalizeForumUserMentionNodes(root: HTMLElement) {
  const previousByParent = new Map<HTMLElement, Map<Node, Node | undefined>>();
  root.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!isForumUserMentionHref(href)) return;
    if (link.childNodes.some((child) => child instanceof HTMLElement && /^[a-z]/i.test(child.rawTagName || ''))) return;
    const label = elementText(link);
    if (/<[a-z][^>]*>/i.test(link.innerHTML)) return;
    const parent = link.parentNode;
    let siblings = parent ? previousByParent.get(parent) : undefined;
    if (parent && !siblings) {
      siblings = new Map(parent.childNodes.map((child, index, children) => [child, children[index - 1]]));
      previousByParent.set(parent, siblings);
    }
    const previous = siblings?.get(link);
    const previousText = previous && !previous.rawTagName ? String(previous.rawText || '') : '';
    if (!label.startsWith('@') && !previousText.endsWith('@')) return;
    if (!label.startsWith('@') && previous) {
      previous.rawText = previousText.slice(0, -1);
    }
    appendClass(link, FORUM_USER_MENTION_CLASS);
    link.set_content([new TextNode(escapeHtmlText(mentionLabel(label)))]);
  });
}

export function markV2exReplyReferenceNodes(root: HTMLElement, topicId?: string) {
  root.querySelectorAll('*').forEach((node) => {
    Object.keys(node.attributes).forEach((name) => {
      if (name.toLowerCase().startsWith('data-forum-reply-')) node.removeAttribute(name);
    });
  });
  if (!topicId || !/^\d+$/.test(topicId)) return;
  const topicUrl = `${sourceCatalog.v2ex.baseUrl}/t/${topicId}`;
  const pending = [root];
  while (pending.length) {
    const parent = pending.pop()!;
    if (
      /^(?:a|pre|code|blockquote|math|script|style)$/i.test(parent.rawTagName || '') ||
      /(?:forum-math|forum-terminal)/i.test(parent.getAttribute('class') || '') ||
      /math|terminal/i.test(parent.rawTagName || '')
    )
      continue;
    const children: Node[] = [];
    let changed = false;
    let previousMention: string | undefined;
    for (const child of parent.childNodes) {
      if (child instanceof HTMLElement) {
        children.push(child);
        pending.push(child);
        previousMention = undefined;
        if (child.rawTagName === 'a' && /^@/.test(child.textContent)) {
          try {
            const url = new URL(child.getAttribute('href') || '', sourceCatalog.v2ex.baseUrl);
            const username = url.pathname.match(/^\/member\/([^/]+)\/?$/)?.[1];
            if (/^https?:$/.test(url.protocol) && /^(?:www\.)?v2ex\.com$/i.test(url.hostname) && username) {
              previousMention = decodeURIComponent(username);
            }
          } catch {
            /* Invalid member links remain ordinary content. */
          }
        }
        continue;
      }
      const text = child.textContent;
      const firstContentIndex = previousMention ? text.search(/\S/) : -1;
      const pattern = /(?:@([A-Za-z0-9_-]{1,32})(\s+))?(#\s*(\d+))(?![\w]|\.\d)/g;
      let offset = 0;
      for (const match of text.matchAll(pattern)) {
        const index = match.index!;
        const username = match[1] || (index === firstContentIndex ? previousMention : undefined);
        const floor = Number(match[4]);
        if (
          !username ||
          !Number.isSafeInteger(floor) ||
          floor <= 0 ||
          (match[1] && index > 0 && /[\w@]/.test(text[index - 1]))
        )
          continue;
        if (index > offset) children.push(new TextNode(escapeHtmlText(text.slice(offset, index))));
        if (match[1]) {
          const mention = new HTMLElement('a', {});
          mention.setAttribute('href', `${sourceCatalog.v2ex.baseUrl}/member/${encodeURIComponent(username)}`);
          mention.setAttribute('class', FORUM_USER_MENTION_CLASS);
          mention.set_content(escapeHtmlText(`@${username}`));
          children.push(mention, new TextNode(escapeHtmlText(match[2])));
        }
        const link = new HTMLElement('a', {});
        link.setAttribute('href', topicUrl);
        link.setAttribute('class', NODESEEK_FLOOR_CLASS);
        link.setAttribute('data-forum-reply-floor', String(floor));
        link.setAttribute('data-forum-reply-author', username);
        link.set_content(escapeHtmlText(match[3]));
        children.push(link);
        offset = index + match[0].length;
        changed = true;
      }
      if (offset) {
        if (offset < text.length) children.push(new TextNode(escapeHtmlText(text.slice(offset))));
      } else children.push(child);
      previousMention = undefined;
    }
    if (changed) parent.set_content(children);
  }
}

function nodeSeekUrlFromHref(href: string | undefined, baseUrl?: string) {
  const text = String(href || '').trim();
  if (!text) {
    return undefined;
  }
  const hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(text);
  const hasHost = text.startsWith('//');
  let baseIsNodeSeek;
  try {
    baseIsNodeSeek = baseUrl ? isNodeSeekHost(new URL(baseUrl).hostname) : false;
  } catch {
    baseIsNodeSeek = false;
  }
  if (!hasProtocol && !hasHost && !baseIsNodeSeek) {
    return undefined;
  }
  try {
    const url = new URL(text, baseUrl || `${sourceCatalog.nodeseek.baseUrl}/`);
    return isNodeSeekHost(url.hostname) ? url : undefined;
  } catch {
    return undefined;
  }
}

function hasClass(className: string, value: string) {
  return className.split(/\s+/).includes(value);
}

function appendClass(
  link: { attributes?: Record<string, string | undefined>; setAttribute?: (name: string, value: string) => void },
  value: string
) {
  const current = String(link.attributes?.class || '').trim();
  if (hasClass(current, value)) {
    return;
  }
  const next = [current, value].filter(Boolean).join(' ');
  if (typeof link.setAttribute === 'function') {
    link.setAttribute('class', next);
    return;
  }
  if (link.attributes) {
    link.attributes.class = next;
  }
}

function isNodeSeekMentionLink(url: URL, label: string) {
  return url.pathname.replace(/\/+$/, '') === '/member' && Boolean(url.searchParams.get('t')) && /^@\S/.test(label);
}

function isNodeSeekFloorLink(url: URL, label: string) {
  const floor = label.match(/^#(\d+)$/)?.[1];
  return Boolean(floor) && /^\/post-\d+-\d+\/?$/i.test(url.pathname) && url.hash === `#${floor}`;
}

function referenceLabelRange(segments: ForumTextSegment[]) {
  const segment = segments[0];
  if (!segment) return { prefix: '', length: 0, label: () => '' };
  const { text, nonWhitespacePrefix: counts } = segment.tape;
  const first = counts[segment.start];
  const last = counts[segment.end];
  if (first === last) return { prefix: '', length: 0, label: () => '' };
  const boundary = (target: number) => {
    let low = segment.start + 1;
    let high = segment.end;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (counts[middle] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const start = boundary(first + 1) - 1;
  const end = boundary(last);
  return {
    prefix: text.slice(start, Math.min(end, start + 2)),
    length: end - start,
    label: () => text.slice(start, end).replace(/\s+/g, ' ').trim()
  };
}

function linkReferenceInfo(
  link: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number],
  baseUrl: string | undefined,
  text: ReturnType<typeof createForumTextIndex>,
  includeLabel = true
) {
  const href = link.getAttribute('href') || link.attributes?.href || '';
  const url = nodeSeekUrlFromHref(href, baseUrl);
  if (!url) {
    return undefined;
  }
  const range = referenceLabelRange(text.range(link));
  if (isNodeSeekMentionLink(url, range.prefix)) {
    return { type: 'mention' as const, label: includeLabel ? range.label() : range.prefix, href };
  }
  if (range.length !== url.hash.length || range.prefix[0] !== '#') return undefined;
  const label = range.label();
  if (isNodeSeekFloorLink(url, label)) {
    return { type: 'floor' as const, label, href };
  }
  return undefined;
}

function leadingReplyReferenceParagraphHtml(
  paragraph: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number],
  baseUrl: string | undefined,
  text: ReturnType<typeof createForumTextIndex>
) {
  const children = paragraph.childNodes || [];
  let index = 0;
  while (children[index] && !String(children[index].toString()).trim()) {
    index += 1;
  }
  const mentionNode = children[index];
  const mentionInfo =
    mentionNode && (mentionNode as { rawTagName?: string }).rawTagName === 'a'
      ? linkReferenceInfo(
          mentionNode as ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number],
          baseUrl,
          text,
          false
        )
      : undefined;
  if (mentionInfo?.type !== 'mention') {
    return undefined;
  }
  index += 1;
  while (children[index] && !String(children[index].toString()).trim()) {
    index += 1;
  }
  const floorNode = children[index];
  const floorInfo =
    floorNode && (floorNode as { rawTagName?: string }).rawTagName === 'a'
      ? linkReferenceInfo(
          floorNode as ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number],
          baseUrl,
          text
        )
      : undefined;
  if (floorInfo?.type !== 'floor') {
    return undefined;
  }
  const mentionLabel = referenceLabelRange(text.range(mentionNode as HTMLElement)).label();
  const restHtml = children
    .slice(index + 1)
    .map((child) => child.toString())
    .join('')
    .replace(/^\s+/, '');
  const referenceHtml = [
    `<${FORUM_REPLY_REFERENCE_TAG}`,
    ` data-mention="${escapeHtmlAttribute(mentionLabel)}"`,
    ` data-floor="${escapeHtmlAttribute(floorInfo.label)}"`,
    ` data-floor-href="${escapeHtmlAttribute(floorInfo.href)}"`,
    ` data-user-href="${escapeHtmlAttribute(mentionInfo.href)}"`,
    `></${FORUM_REPLY_REFERENCE_TAG}>`
  ].join('');
  return restHtml ? `${referenceHtml}<p>${restHtml}</p>` : referenceHtml;
}

export function markNodeSeekReplyReferenceNodes(root: ReturnType<typeof parseHtml>, baseUrl?: string) {
  if (!root.querySelector('a[href]')) return false;
  let changed = false;
  const paragraphText = createForumTextIndex(root);
  transformForumElements(root, root.querySelectorAll('p'), (paragraph) => {
    const replacementHtml = leadingReplyReferenceParagraphHtml(paragraph, baseUrl, paragraphText);
    if (replacementHtml) {
      changed = true;
      return forumElementReplacementNodes(paragraph, replacementHtml);
    }
  });
  const links = root.querySelectorAll('a[href]');
  if (!links.length) return changed;
  const linkText = createForumTextIndex(root);
  links.forEach((link) => {
    const info = linkReferenceInfo(link, baseUrl, linkText, false);
    if (!info) return;
    appendClass(link, info.type === 'mention' ? NODESEEK_MENTION_CLASS : NODESEEK_FLOOR_CLASS);
    changed = true;
  });
  return changed;
}

export function normalizeRenderableHtml(html: string | undefined) {
  const clean = (html || '').trim();
  if (!clean) {
    return '<p></p>';
  }
  if (/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?>/.test(clean)) {
    return markForumUserMentions(clean);
  }
  return `<p>${escapeHtmlText(clean)}</p>`;
}
