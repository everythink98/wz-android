import { decodeHtmlAttribute, decodeHtmlEntities } from './html';
import { htmlTagAttribute, transformHtmlSegments } from './htmlSegments';

export { transformHtmlSegments };

export function escapeSearchTerm(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function searchTerms(query: string) {
  const seen = new Set<string>();
  return query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term && !term.startsWith('-'))
    .filter((term) => {
      const key = term.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.length - left.length);
}

export function stripHtml(html: string | undefined) {
  const preLineBreakToken = '\0WZ_PRE_NL\0';
  let preDepth = 0;
  const text = transformHtmlSegments(
    html || '',
    (segment) => decodeHtmlEntities(preDepth > 0 ? segment.replace(/\n/g, preLineBreakToken) : segment),
    (tag) => {
      if (tag.startsWith('<!--') || tag.startsWith('<!')) return '';
      const tagMatch = tag.match(/^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/);
      if (!tagMatch) return '';
      const closing = tagMatch[1] === '/';
      const name = tagMatch[2].toLowerCase();
      if (name === 'script' || name === 'style') return '';
      if (name === 'pre') {
        if (closing) {
          preDepth = Math.max(0, preDepth - 1);
          return '\n';
        }
        preDepth += 1;
        return '';
      }
      if (!closing && name === 'img') {
        const label = htmlTagAttribute(tag, 'alt') || htmlTagAttribute(tag, 'title') || '';
        return label ? ` ${decodeHtmlAttribute(label)} ` : ' ';
      }
      if (!closing && (name === 'br' || name === 'li')) return '\n';
      if (closing && /^(?:p|div|blockquote|ul|ol|tr|h[1-6])$/.test(name)) return '\n';
      return '';
    },
    () => ''
  );
  return text
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/\n[ \t\f\v]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replaceAll(preLineBreakToken, '\n')
    .trim();
}
