import { decodeHtml } from './html';

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

function htmlTagEnd(html: string, start: number) {
  if (html.startsWith('<!--', start)) {
    const commentEnd = html.indexOf('-->', start + 4);
    return commentEnd < 0 ? -1 : commentEnd + 3;
  }
  const first = html[start + 1];
  const second = html[start + 2];
  if (!first || !(/[A-Za-z!?]/.test(first) || (first === '/' && Boolean(second) && /[A-Za-z]/.test(second)))) {
    return -1;
  }
  let quote = '';
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return -1;
}

export function transformHtmlSegments(
  html: string,
  transformText: (text: string) => string,
  transformTag: (tag: string) => string
) {
  let output = '';
  let textStart = 0;
  let index = 0;
  while (index < html.length) {
    if (html[index] !== '<') {
      index += 1;
      continue;
    }
    const tagEnd = htmlTagEnd(html, index);
    if (tagEnd < 0) {
      index += 1;
      continue;
    }
    output += transformText(html.slice(textStart, index));
    output += transformTag(html.slice(index, tagEnd));
    index = tagEnd;
    textStart = tagEnd;
  }
  return output + transformText(html.slice(textStart));
}

export function stripHtml(html: string | undefined) {
  const preLineBreakToken = '\0WZ_PRE_NL\0';
  let ignoredElement = '';
  let preDepth = 0;
  const text = transformHtmlSegments(
    html || '',
    (segment) => {
      if (ignoredElement) return '';
      return preDepth > 0 ? segment.replace(/\n/g, preLineBreakToken) : segment;
    },
    (tag) => {
      if (tag.startsWith('<!--')) return '';
      const tagMatch = tag.match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)/);
      if (!tagMatch) return '';
      const closing = tagMatch[1] === '/';
      const name = tagMatch[2].toLowerCase();
      if (ignoredElement) {
        if (closing && name === ignoredElement) ignoredElement = '';
        return '';
      }
      if (!closing && (name === 'script' || name === 'style')) {
        ignoredElement = name;
        return '';
      }
      if (name === 'pre') {
        if (closing) {
          preDepth = Math.max(0, preDepth - 1);
          return '\n';
        }
        preDepth += 1;
        return '';
      }
      if (!closing && name === 'img') {
        const label = tag.match(/\b(?:alt|title)=(["'])(.*?)\1/i)?.[2] || '';
        return label ? ` ${label} ` : ' ';
      }
      if (!closing && (name === 'br' || name === 'li')) return '\n';
      if (closing && /^(?:p|div|blockquote|ul|ol|tr|h[1-6])$/.test(name)) return '\n';
      return '';
    }
  );
  return decodeHtml(text)
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/\n[ \t\f\v]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replaceAll(preLineBreakToken, '\n')
    .trim();
}
