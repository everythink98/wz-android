import { describe, expect, it } from 'vitest';
import { escapeHtmlAttribute, escapeHtmlFully, escapeHtmlText } from './html';

describe('HTML escaping', () => {
  it.each([
    ['text', escapeHtmlText, '&amp;&lt;&gt;"\''],
    ['attribute', escapeHtmlAttribute, "&amp;&lt;&gt;&quot;'"],
    ['full', escapeHtmlFully, '&amp;&lt;&gt;&quot;&#39;']
  ] as const)('escapes the exact %s character matrix', (_name, escape, expected) => {
    expect(escape('&<>"\'')).toBe(expected);
    expect(escape('&amp;')).toBe('&amp;amp;');
  });

  it('keeps the existing empty-value conversion', () => {
    expect(escapeHtmlFully(0)).toBe('');
    expect(escapeHtmlFully(null)).toBe('');
  });
});
