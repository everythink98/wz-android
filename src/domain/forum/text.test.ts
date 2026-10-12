import { describe, expect, it } from 'vitest';
import { stripHtml } from './text';

describe('plain forum text', () => {
  it('copies reply text and code without decoding entities completed across elements', () => {
    const html =
      '<p>Reply &lt;r&gt; &amp;lt;r&amp;gt; &amp;#32; &am<span>p;nbsp;</span></p>' +
      '<pre><code>reply &amp;lt;r&amp;gt;\n&am<span>p;#32;</span></code></pre>';

    expect(stripHtml(html)).toBe('Reply <r> &lt;r&gt; &#32; &amp;nbsp;\nreply &lt;r&gt;\n&amp;#32;');
  });

  it.each([
    ['&am<span>p;lt;</span>', '&amp;lt;'],
    ['&#<b>32;</b>', '&#32;'],
    ['&#x<i>41;</i>', '&#x41;'],
    ['&nb<!-- separate leaves -->sp;', '&nbsp;'],
    ['&am<img alt="p;#32;">', '&am p;#32;']
  ])('preserves entity boundaries in %s', (html, expected) => {
    expect(stripHtml(html)).toBe(expected);
  });

  it('decodes text and image labels once while retaining literal markup', () => {
    expect(
      stripHtml('<p>&lt;x&gt; &amp;lt;x&amp;gt; &amp;amp; &#128512;</p><img alt="&amp;lt;y&amp;gt; &amp;#32;">')
    ).toBe('<x> &lt;x&gt; &amp; 😀\n&lt;y&gt; &#32;');
  });

  it('keeps table, sticker, terminal, ignored content and preformatted whitespace rules', () => {
    expect(
      stripHtml(
        '<script>hidden &amp;</script><style>hidden</style><!-- hidden -->' +
          '<table><tr><td>A</td><td>B</td></tr><tr><td>C<br>D</td></tr></table>' +
          '<p><forum-video-sticker><img alt="[sticker]" src="sticker.png"></forum-video-sticker></p>' +
          '<forum-terminal-report><forum-terminal-tab><pre>first\n\n  second &amp;lt;x&amp;gt;</pre></forum-terminal-tab></forum-terminal-report>'
      )
    ).toBe('AB\nC\nD\n[sticker]\nfirst\n\n  second &lt;x&gt;');
  });
});
