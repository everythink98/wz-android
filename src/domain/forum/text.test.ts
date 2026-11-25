import { describe, expect, it, vi } from 'vitest';
import { stripHtml, transformHtmlSegments } from './text';

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

  it('retains spaceless comparisons, quotes, and subsequent real tags in copied body text', () => {
    expect(stripHtml("x<y, 'inline <b>keep</b>' <i>end</i>")).toBe("x<y, 'inline keep' end");
    expect(stripHtml("x<y 'inline <b>keep</b>' <i>end</i>")).toBe("x<y 'inline keep' end");
    expect(stripHtml('x<y and z<b>keep</b>')).toBe('x<y and zkeep');
    expect(stripHtml("a</b, 'inline <b>keep</b>'")).toBe("a</b, 'inline keep'");
  });

  it('skips HTML comments with quotes or greater-than signs while keeping real tags and attributes', () => {
    expect(stripHtml("<!-- don't --><b>keep</b>")).toBe('keep');
    expect(stripHtml("<!-- don't --><b>keep</b> 'later' <i>end</i>")).toBe("keep 'later' end");
    expect(stripHtml("x<y, 'a' <!-- don't --><b>keep</b>")).toBe("x<y, 'a' keep");
    expect(stripHtml("x<y, 'a' <!-- don't --><b>keep</b> 'b'")).toBe("x<y, 'a' keep 'b'");
    expect(stripHtml('<!-- a > b --><b>keep</b>')).toBe('keep');
    expect(stripHtml('<p><a title="1 > 0" data-x=\'a > b\'>keep</a></p><p><img alt="1 > 0" src="photo.png"></p>')).toBe(
      'keep\n1 > 0'
    );
    expect(stripHtml('<!DOCTYPE html><p>keep</p>')).toBe('keep');
  });

  it('closes raw-text script and style elements containing literal comment markers before later comments', () => {
    expect(stripHtml('<script>var x = "<!--";</script><p>visible</p><!-- real comment -->')).toBe('visible');
    expect(stripHtml('<style>/* <!-- */</style><p>visible</p><!-- real comment -->')).toBe('visible');
    expect(stripHtml('<SCRIPT>var x = "</style> <!--";</SCRIPT ><p>visible</p><!-- real -->')).toBe('visible');

    const repeatedStyles = '<style>/* <!-- */</style>'.repeat(2_000) + '<p>visible</p><!-- real comment -->';
    const indexOfSpy = vi.spyOn(String.prototype, 'indexOf');
    try {
      expect(stripHtml(repeatedStyles)).toBe('visible');
      const commentCloseSearches = indexOfSpy.mock.calls.filter(([needle]) => needle === '-->').length;
      expect(commentCloseSearches).toBeLessThanOrEqual(1);
    } finally {
      indexOfSpy.mockRestore();
    }
  });

  it('handles unquoted URL attributes, Unicode attribute names, and once-decoded image alt entities in copied text', () => {
    expect(stripHtml('<p><a href=/search?q=boards>boards</a></p>')).toBe('boards');
    expect(stripHtml('<p><span data-分类="x">分类</span> <div data-分类>正文</div></p>')).toBe('分类 正文');
    expect(stripHtml('<p><img data-分类="x" src=/e?id=1 alt="&hearts;"></p>')).toBe('♥');
    expect(stripHtml('<p><img alt="&amp;hearts;"></p>')).toBe('&hearts;');
    expect(stripHtml('a<b && c>d')).toBe('a<b && c>d');
    expect(stripHtml('x<y a=b<c>keep</c>')).toBe('x<y a=bkeep');
  });

  it('handles consecutive incomplete tags and long body text in linear scan work', () => {
    const incompleteTags = '<a '.repeat(4_000) + '<b>keep</b>';
    expect(stripHtml(incompleteTags)).toBe('<a '.repeat(4_000) + 'keep');

    const unclosedComments = '<!--'.repeat(4_000) + '<b>keep</b>';
    const indexOfSpy = vi.spyOn(String.prototype, 'indexOf');
    try {
      expect(stripHtml(unclosedComments)).toBe('<!--'.repeat(4_000) + 'keep');
      const commentCloseSearches = indexOfSpy.mock.calls.filter(([needle]) => needle === '-->').length;
      expect(commentCloseSearches).toBeLessThanOrEqual(1);
    } finally {
      indexOfSpy.mockRestore();
    }

    const dualPhaseIncomplete = '<a ' + "a=\"f='<b c='k='x\" d=' e=\"' ".repeat(2_000) + '<b>keep</b>';
    const quoteSpy = vi.spyOn(String.prototype, 'indexOf');
    try {
      let textCalls = 0;
      let tagCalls = 0;
      const scanned = transformHtmlSegments(
        dualPhaseIncomplete,
        (segment) => {
          textCalls += 1;
          return segment;
        },
        (tag) => {
          tagCalls += 1;
          return tag === '<b>' || tag === '</b>' ? '' : tag;
        }
      );
      expect(scanned).toBe('<a ' + "a=\"f='<b c='k='x\" d=' e=\"' ".repeat(2_000) + 'keep');
      expect(textCalls).toBe(3);
      expect(tagCalls).toBe(2);
      const quoteSearches = quoteSpy.mock.calls.filter(([needle]) => needle === '"' || needle === "'").length;
      expect(quoteSearches).toBeLessThanOrEqual(20_000);
    } finally {
      quoteSpy.mockRestore();
    }

    const longBody = Array.from(
      { length: 2_000 },
      (_, index) => `<p><a title="i > ${index}">line ${index}</a> <!-- don't > ${index} --></p>`
    ).join('');
    const expectedLong = Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join('\n');
    expect(stripHtml(longBody)).toBe(expectedLong);
  });

  it('handles bracketed attributes, Word conditionals, raw-text end boundaries, entities, and preformatted blocks', () => {
    expect(stripHtml('<p><a [foo]="boards" href="/guides/boards">boards</a></p>')).toBe('boards');
    expect(
      stripHtml('<p><img [foo]="1" alt="&amp;copy; &Lt; &Gt; &#128; &#0; &#x1F600" src="/guides/boards.png"></p>')
    ).toBe('&copy; ≪ ≫ € \uFFFD 😀');
    expect(stripHtml('<![if !supportLists]><p>boards</p><![endif]>')).toBe('boards');
    expect(stripHtml('<script>var x = 1;</script/><p>boards</p>')).toBe('boards');
    expect(stripHtml('<style>.x{color:red}</style unused><p>boards</p>')).toBe('boards');
    expect(stripHtml('<script><!-- <script>var x = "</script><p>hidden</p>"; --></script><p>boards</p>')).toBe(
      'boards'
    );
    expect(stripHtml('<pre><code>x<y &amp;copy;\n\n  &#128; &#0; &#x1F600 &Lt; &Gt; &unknownref;</code></pre>')).toBe(
      'x<y &copy;\n\n  € \uFFFD 😀 ≪ ≫ &unknownref;'
    );
  });
});
