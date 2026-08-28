import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/domain/forum/html';
import { normalizeNodeSeekVoteMarkers } from './polls';

describe('NodeSeek poll markup', () => {
  it('normalizes loaded text and NodeSeek anchor labels while preserving inert content', () => {
    const loadedText = 'nsapp://vote?id=7';
    const loadedLink = 'nsapp://vote?id=8';
    const loadedRedirect = 'nsapp://vote?id=10';
    const unloadedLink = 'nsapp://vote?id=9';
    const root = parseHtml(
      `<p>前 ${loadedText} <a href="${loadedLink}">${loadedLink}</a> ` +
        `<a href="/jump/vote">${loadedRedirect}</a> ` +
        `<a href="${unloadedLink}">${unloadedLink}</a> <a href="https://example.com">普通链接</a> 后</p>` +
        `<pre><code>${loadedText}</code></pre>`
    );

    normalizeNodeSeekVoteMarkers(root, ['7', '8', '10']);

    const html = root.toString();
    expect(html.match(/<forum-nodeseek-poll\b/g)).toHaveLength(3);
    expect(html).toContain('<forum-nodeseek-poll id="7"></forum-nodeseek-poll>');
    expect(html).toContain('<forum-nodeseek-poll id="8"></forum-nodeseek-poll>');
    expect(html).toContain('<forum-nodeseek-poll id="10"></forum-nodeseek-poll>');
    expect(html).toContain(`${unloadedLink} <a href="https://example.com">普通链接</a>`);
    expect(html).not.toContain(`<a href="${unloadedLink}">`);
    expect(html).toContain(`<code>${loadedText}</code>`);
  });

  it('keeps one placeholder when the same poll marker is repeated', () => {
    const root = parseHtml('<forum-nodeseek-poll id="7"></forum-nodeseek-poll><p><span>nsapp://vote?id=7</span></p>');

    normalizeNodeSeekVoteMarkers(root, ['7']);

    expect(root.toString().match(/<forum-nodeseek-poll\b/g)).toHaveLength(1);
  });
});
