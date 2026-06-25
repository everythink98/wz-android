function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function addHtmlClass(attributes: string, className: string) {
  if (new RegExp(`\\b${className}\\b`).test(attributes)) {
    return attributes;
  }
  if (/\sclass=(["'])(.*?)\1/i.test(attributes)) {
    return attributes.replace(/\sclass=(["'])(.*?)\1/i, (_match, quote: string, value: string) => ` class=${quote}${value} ${className}${quote}`);
  }
  return `${attributes} class="${className}"`;
}

function markForumUserMentions(html: string) {
  return html.replace(/@<a\b([^>]*\bhref=(["'])(?:https?:\/\/(?:www\.)?v2ex\.com)?\/member\/[^"']+\2[^>]*)>([^<]+)<\/a>/gi, (_match, attributes: string, _quote: string, label: string) => (
    `<a${addHtmlClass(attributes, 'forum-user-mention')}>@${label}</a>`
  ));
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
