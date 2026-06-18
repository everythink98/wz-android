import { describe, expect, it } from 'vitest';
import { normalizeRenderableHtml } from './topicContentHtml';

describe('Android topic content HTML', () => {
  it('wraps plain text content as a readable paragraph', () => {
    expect(normalizeRenderableHtml('plain < unsafe & text')).toBe('<p>plain &lt; unsafe &amp; text</p>');
  });

  it('keeps existing HTML content unchanged', () => {
    expect(normalizeRenderableHtml('<h2>Title</h2><p>Body</p>')).toBe('<h2>Title</h2><p>Body</p>');
  });

  it('keeps mixed text and HTML fragments renderable', () => {
    expect(normalizeRenderableHtml('see <a href="https://example.com">link</a>')).toBe('see <a href="https://example.com">link</a>');
  });
});
