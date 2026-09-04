import { describe, expect, it, vi } from 'vitest';
import {
  FORUM_REPLY_REFERENCE_TAG,
  markNodeSeekReplyReferenceNodes,
  markV2exReplyReferenceNodes,
  normalizeForumUserMentionNodes,
  normalizeRenderableHtml
} from './topicContentHtml';
import { parseHtml } from './html';

describe('Android topic content HTML', () => {
  it('rebuilds a large explicit-reference parent once and preserves text order', () => {
    const text = Array.from({ length: 2_000 }, (_, index) => `@alice # ${index + 1} `).join('');
    const root = parseHtml(`<p>${text}</p>`);
    const paragraph = root.querySelector('p')!;
    const replaceChildren = vi.spyOn(paragraph, 'set_content');
    markV2exReplyReferenceNodes(root, '945124');
    expect(replaceChildren).toHaveBeenCalledTimes(1);
    expect(paragraph.textContent).toBe(text);
    expect(paragraph.querySelectorAll('[data-forum-reply-floor]')).toHaveLength(2_000);
    replaceChildren.mockRestore();
  });

  it('preserves adjacent and nested mention order in a large sibling list', () => {
    const root = parseHtml(
      '<p>' +
        '@<a href="/u/alice">alice</a> '.repeat(2_000) +
        '<span>@<a href="/u/bob">bob</a></span><a href="/u/carol"><b>@carol</b></a></p>'
    );
    normalizeForumUserMentionNodes(root);
    expect(root.querySelectorAll('.forum-user-mention')).toHaveLength(2_001);
    expect(root.querySelector('p')?.textContent).toBe('@alice '.repeat(2_000) + '@bob@carol');
    expect(root.querySelector('b')?.textContent).toBe('@carol');
  });
  it('normalizes text and existing HTML into renderable content', () => {
    expect(normalizeRenderableHtml('plain < unsafe & text')).toBe('<p>plain &lt; unsafe &amp; text</p>');
    expect(normalizeRenderableHtml('<h2>Title</h2><p>Body</p>')).toBe('<h2>Title</h2><p>Body</p>');
    expect(normalizeRenderableHtml('see <a href="https://example.com">link</a>')).toBe(
      'see <a href="https://example.com">link</a>'
    );
  });

  it('marks V2EX member mentions without changing ordinary member links', () => {
    expect(normalizeRenderableHtml('@<a href="/member/lijianan">lijianan</a> hi')).toBe(
      '<a href="/member/lijianan" class="forum-user-mention">@lijianan</a> hi'
    );
    expect(normalizeRenderableHtml('@<a href="/member/lijianan">lijianan</a> @<a href="/member/cc77">cc77</a>')).toBe(
      '<a href="/member/lijianan" class="forum-user-mention">@lijianan</a> <a href="/member/cc77" class="forum-user-mention">@cc77</a>'
    );
    expect(normalizeRenderableHtml('<a href="/member/lijianan">lijianan</a>')).toBe(
      '<a href="/member/lijianan">lijianan</a>'
    );
  });

  it('marks Yaohuo user mentions with the app mention style', () => {
    expect(
      normalizeRenderableHtml('问问@<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878">Max、爱芯i</a>')
    ).toBe(
      '问问<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878" class="forum-user-mention">@Max、爱芯i</a>'
    );
    expect(
      normalizeRenderableHtml('问问<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878">@Max、爱芯i</a>')
    ).toBe(
      '问问<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878" class="forum-user-mention">@Max、爱芯i</a>'
    );
    expect(normalizeRenderableHtml('<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878">Max、爱芯i</a>')).toBe(
      '<a href="https://yaohuo.me/bbs/userinfo.aspx?touserid=30878">Max、爱芯i</a>'
    );
  });

  it('marks Linux.do user mentions with the app mention style', () => {
    expect(normalizeRenderableHtml('<p><a class="mention" href="/u/alice">@alice</a> hello</p>')).toBe(
      '<p><a class="mention forum-user-mention" href="/u/alice">@alice</a> hello</p>'
    );
    expect(normalizeRenderableHtml('<p><a href="https://linux.do/u/alice/summary">@alice</a> hello</p>')).toBe(
      '<p><a href="https://linux.do/u/alice/summary" class="forum-user-mention">@alice</a> hello</p>'
    );
    expect(normalizeRenderableHtml('<p><a href="/u/alice">alice</a></p>')).toBe('<p><a href="/u/alice">alice</a></p>');
  });

  it('keeps mention recognition intact when another attribute contains a greater-than sign', () => {
    expect(normalizeRenderableHtml('<p><a title="1 > 0" href="/u/alice">@alice</a> hello</p>')).toBe(
      '<p><a title="1 &gt; 0" href="/u/alice" class="forum-user-mention">@alice</a> hello</p>'
    );
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
    const root = parseHtml(html);
    markNodeSeekReplyReferenceNodes(root);
    const marked = root.toString();

    expect(marked).toContain(`<${FORUM_REPLY_REFERENCE_TAG}`);
    expect(marked).toContain('data-mention="@电动面包"');
    expect(marked).toContain('data-floor="#4"');
    expect(marked).toContain('data-floor-href="https://www.nodeseek.com/post-793572-1#4"');
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
    const root = parseHtml(html);
    markNodeSeekReplyReferenceNodes(root);
    const marked = root.toString();

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

    const root = parseHtml(html);
    expect(markNodeSeekReplyReferenceNodes(root)).toBe(false);
    expect(root.toString()).toBe(html);
  });
});
