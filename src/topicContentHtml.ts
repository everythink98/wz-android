function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function normalizeRenderableHtml(html: string | undefined) {
  const clean = (html || '').trim();
  if (!clean) {
    return '<p></p>';
  }
  if (/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?>/.test(clean)) {
    return clean;
  }
  return `<p>${escapeHtmlText(clean)}</p>`;
}
