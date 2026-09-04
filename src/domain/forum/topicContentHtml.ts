import { elementText, escapeHtmlAttribute, escapeHtmlText, escapeQuotedHtmlTagDelimiters, parseHtml } from './html';
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
    const label = elementText(link);
    if (!isForumUserMentionHref(href) || /<[a-z][^>]*>/i.test(link.innerHTML)) return;
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
    link.set_content([new TextNode(mentionLabel(label))]);
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

function linkReferenceInfo(
  link: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number],
  baseUrl?: string
) {
  const label = elementText(link);
  const href = link.getAttribute('href') || link.attributes?.href || '';
  const url = nodeSeekUrlFromHref(href, baseUrl);
  if (!url) {
    return undefined;
  }
  if (isNodeSeekMentionLink(url, label)) {
    return { type: 'mention' as const, label, href };
  }
  if (isNodeSeekFloorLink(url, label)) {
    return { type: 'floor' as const, label, href };
  }
  return undefined;
}

function leadingReplyReferenceParagraphHtml(
  paragraph: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number],
  baseUrl?: string
) {
  const children = paragraph.childNodes || [];
  let index = 0;
  while (children[index] && !String(children[index].toString()).trim()) {
    index += 1;
  }
  const mentionNode = children[index];
  const mentionInfo =
    mentionNode && (mentionNode as { rawTagName?: string }).rawTagName === 'a'
      ? linkReferenceInfo(mentionNode as ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number], baseUrl)
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
      ? linkReferenceInfo(floorNode as ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number], baseUrl)
      : undefined;
  if (floorInfo?.type !== 'floor') {
    return undefined;
  }
  const restHtml = children
    .slice(index + 1)
    .map((child) => child.toString())
    .join('')
    .replace(/^\s+/, '');
  const referenceHtml = [
    `<${FORUM_REPLY_REFERENCE_TAG}`,
    ` data-mention="${escapeHtmlAttribute(mentionInfo.label)}"`,
    ` data-floor="${escapeHtmlAttribute(floorInfo.label)}"`,
    ` data-floor-href="${escapeHtmlAttribute(floorInfo.href)}"`,
    ` data-user-href="${escapeHtmlAttribute(mentionInfo.href)}"`,
    `></${FORUM_REPLY_REFERENCE_TAG}>`
  ].join('');
  return restHtml ? `${referenceHtml}<p>${restHtml}</p>` : referenceHtml;
}

export function markNodeSeekReplyReferenceNodes(root: ReturnType<typeof parseHtml>, baseUrl?: string) {
  let changed = false;
  root.querySelectorAll('p').forEach((paragraph) => {
    const replacementHtml = leadingReplyReferenceParagraphHtml(paragraph, baseUrl);
    if (replacementHtml) {
      paragraph.replaceWith(replacementHtml);
      changed = true;
    }
  });
  root.querySelectorAll('a[href]').forEach((link) => {
    const info = linkReferenceInfo(link, baseUrl);
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
