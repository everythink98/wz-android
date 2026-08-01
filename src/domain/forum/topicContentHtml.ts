import { elementText, escapeQuotedHtmlTagDelimiters, parseHtml } from './html';

export const FORUM_REPLY_REFERENCE_TAG = 'forum-reply-reference';
const FORUM_USER_MENTION_CLASS = 'forum-user-mention';
const NODESEEK_MENTION_CLASS = 'forum-mention-link';
const NODESEEK_FLOOR_CLASS = 'forum-floor-link';

function escapeHtmlText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value: string) {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

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

function isNodeSeekHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'nodeseek.com' || host.endsWith('.nodeseek.com');
}

function nodeSeekUrlFromHref(href: string | undefined, baseUrl?: string) {
  const text = String(href || '').trim();
  if (!text) {
    return undefined;
  }
  const hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(text);
  const hasHost = text.startsWith('//');
  let baseIsNodeSeek = false;
  try {
    baseIsNodeSeek = baseUrl ? isNodeSeekHost(new URL(baseUrl).hostname) : false;
  } catch {
    baseIsNodeSeek = false;
  }
  if (!hasProtocol && !hasHost && !baseIsNodeSeek) {
    return undefined;
  }
  try {
    const url = new URL(text, baseUrl || 'https://www.nodeseek.com/');
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
    ` data-user-href="${escapeHtmlAttribute(mentionInfo.href)}"`,
    `></${FORUM_REPLY_REFERENCE_TAG}>`
  ].join('');
  return restHtml ? `${referenceHtml}<p>${restHtml}</p>` : referenceHtml;
}

export function markNodeSeekReplyReferenceLinks(html: string, baseUrl?: string) {
  try {
    const root = parseHtml(html);
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
      if (!info) {
        return;
      }
      if (info.type === 'mention') {
        appendClass(link, NODESEEK_MENTION_CLASS);
        changed = true;
        return;
      }
      appendClass(link, NODESEEK_FLOOR_CLASS);
      changed = true;
    });
    return changed ? root.toString() : html;
  } catch {
    return html;
  }
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
