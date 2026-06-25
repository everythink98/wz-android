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

  it('marks V2EX member mentions without changing ordinary member links', () => {
    expect(normalizeRenderableHtml('@<a href="/member/lijianan">lijianan</a> hi')).toBe('<a href="/member/lijianan" class="forum-user-mention">@lijianan</a> hi');
    expect(normalizeRenderableHtml('@<a href="/member/lijianan">lijianan</a> @<a href="/member/cc77">cc77</a>')).toBe('<a href="/member/lijianan" class="forum-user-mention">@lijianan</a> <a href="/member/cc77" class="forum-user-mention">@cc77</a>');
    expect(normalizeRenderableHtml('<a href="/member/lijianan">lijianan</a>')).toBe('<a href="/member/lijianan">lijianan</a>');
  });
});
