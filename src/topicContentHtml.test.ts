import { describe, expect, it } from 'vitest';
import { FORUM_REPLY_REFERENCE_TAG, markNodeSeekReplyReferenceLinks, normalizeRenderableHtml } from './topicContentHtml';

describe('Android topic content HTML', () => {
  it('normalizes text and existing HTML into renderable content', () => {
    expect(normalizeRenderableHtml('plain < unsafe & text')).toBe('<p>plain &lt; unsafe &amp; text</p>');
    expect(normalizeRenderableHtml('<h2>Title</h2><p>Body</p>')).toBe('<h2>Title</h2><p>Body</p>');
    expect(normalizeRenderableHtml('see <a href="https://example.com">link</a>')).toBe('see <a href="https://example.com">link</a>');
  });

  it('marks V2EX member mentions without changing ordinary member links', () => {
    expect(normalizeRenderableHtml('@<a href="/member/lijianan">lijianan</a> hi')).toBe('<a href="/member/lijianan" class="forum-user-mention">@lijianan</a> hi');
    expect(normalizeRenderableHtml('@<a href="/member/lijianan">lijianan</a> @<a href="/member/cc77">cc77</a>')).toBe('<a href="/member/lijianan" class="forum-user-mention">@lijianan</a> <a href="/member/cc77" class="forum-user-mention">@cc77</a>');
    expect(normalizeRenderableHtml('<a href="/member/lijianan">lijianan</a>')).toBe('<a href="/member/lijianan">lijianan</a>');
  });

  it('marks Yaohuo user mentions with the app mention style', () => {
    expect(normalizeRenderableHtml('问问@<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878">Max、爱芯i</a>')).toBe('问问<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878" class="forum-user-mention">@Max、爱芯i</a>');
    expect(normalizeRenderableHtml('问问<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878">@Max、爱芯i</a>')).toBe('问问<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878" class="forum-user-mention">@Max、爱芯i</a>');
    expect(normalizeRenderableHtml('<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878">Max、爱芯i</a>')).toBe('<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878">Max、爱芯i</a>');
  });

  it('marks Linux.do user mentions with the app mention style', () => {
    expect(normalizeRenderableHtml('<p><a class="mention" href="/u/alice">@alice</a> hello</p>')).toBe('<p><a class="mention forum-user-mention" href="/u/alice">@alice</a> hello</p>');
    expect(normalizeRenderableHtml('<p><a href="https://linux.do/u/alice/summary">@alice</a> hello</p>')).toBe('<p><a href="https://linux.do/u/alice/summary" class="forum-user-mention">@alice</a> hello</p>');
    expect(normalizeRenderableHtml('<p><a href="/u/alice">alice</a></p>')).toBe('<p><a href="/u/alice">alice</a></p>');
  });

  it('extracts leading NodeSeek mention and floor links as a reply reference row', () => {
    const html = [
      '<p>',
      '<a href="https://www.nodeseek.com/member?t=%E7%94%B5%E5%8A%A8%E9%9D%A2%E5%8C%85">@电动面包</a>',
      ' ',
      '<a href="https://www.nodeseek.com/post-793572-1#4">#4</a>',
      ' 后续正文',
      '</p>'
    ].join('');
    const marked = markNodeSeekReplyReferenceLinks(html);

    expect(marked).toContain(`<${FORUM_REPLY_REFERENCE_TAG}`);
    expect(marked).toContain('data-mention="@电动面包"');
    expect(marked).toContain('data-floor="#4"');
    expect(marked).not.toContain('data-floor-href');
    expect(marked).toContain('<p>后续正文</p>');
  });

  it('marks inline NodeSeek reply references without changing paragraph layout', () => {
    const html = [
      '<p>正文里的 ',
      '<a href="https://www.nodeseek.com/member?t=%E7%94%B5%E5%8A%A8%E9%9D%A2%E5%8C%85">@电动面包</a>',
      ' ',
      '<a href="https://www.nodeseek.com/post-793572-1#4">#4</a>',
      '</p>'
    ].join('');
    const marked = markNodeSeekReplyReferenceLinks(html);

    expect(marked).toContain('class="forum-mention-link"');
    expect(marked).toContain('class="forum-floor-link"');
  });

  it('does not mark ordinary links as reply references', () => {
    const html = [
      '<p>',
      '<a href="https://example.com/member?t=%E7%94%B5%E5%8A%A8%E9%9D%A2%E5%8C%85">@电动面包</a>',
      ' ',
      '<a href="https://www.nodeseek.com/post-793572-1#4">帖子</a>',
      '</p>'
    ].join('');

    expect(markNodeSeekReplyReferenceLinks(html)).toBe(html);
  });
});
