import { escapeSearchTerm, searchTerms, transformHtmlSegments } from '@/domain/forum/text';

export interface HighlightPart {
  text: string;
  highlighted: boolean;
}

export function highlightTextParts(text: string, query: string): HighlightPart[] {
  const terms = searchTerms(query);
  if (!text || terms.length === 0) {
    return [{ text, highlighted: false }];
  }
  const pattern = new RegExp(`(${terms.map(escapeSearchTerm).join('|')})`, 'gi');
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      highlighted: terms.some((term) => term.toLowerCase() === part.toLowerCase())
    }));
}

export function highlightHtml(html: string, query: string) {
  const terms = searchTerms(query);
  if (!html || terms.length === 0) {
    return html;
  }
  const pattern = new RegExp(`(${terms.map(escapeSearchTerm).join('|')})`, 'gi');
  return transformHtmlSegments(
    html,
    (text) => text.replace(pattern, '<mark>$1</mark>'),
    (tag) => tag
  );
}
