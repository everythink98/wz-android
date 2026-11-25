import { describe, expect, it } from 'vitest';
import { groupLibraryRecordsByTime, libraryCategoryFilterItems } from '@/features/library/model/libraryFilters';
import { filterRepliesByQuery } from '@/features/topic/model/replySearch';
import { highlightHtml, highlightTextParts } from '@/ui/text/highlight';
import { domNodeCount as htmlDomNodeCount } from '../helpers/domNodeCount';
import { stripHtml, transformHtmlSegments } from '@/domain/forum/text';
import type { Category, Reply, Topic } from '@/domain/forum/models';
import type { TopicRecord } from '@/domain/reader/readerData';

const topic: Topic = {
  source: 'nodeseek',
  id: '1',
  title: 'Hello VPS',
  author: 'alice',
  category: 'Daily',
  categoryId: 'daily',
  url: 'https://example.com/1',
  createdAt: '2026-05-20T00:00:00.000Z',
  replyCount: 2
};

function record(patch: Partial<TopicRecord> & { id: string; savedAt: string }): TopicRecord {
  return {
    topic: {
      ...topic,
      id: patch.id,
      title: `Topic ${patch.id}`,
      category: patch.topic?.category ?? topic.category,
      categoryId: patch.topic?.categoryId ?? topic.categoryId,
      source: patch.topic?.source ?? topic.source
    },
    savedAt: patch.savedAt,
    visitCount: patch.visitCount
  };
}

const COMMENT_AT = /<!--[\s\S]*?-->/y;
const WORD_CONDITIONAL_AT = /<!\[(?:if(?:(?=[\t\n\f\r !(])(?:[^<>\]]|\](?!>))*|)\]|(?:endif|else)[\t\n\f\r ]*\])>/iy;
const DOCTYPE_AT = /<!doctype(?:>|[\t\n\f\r ](?:[^<>"']|"[^"]*"|'[^']*')*>)/iy;
const CLOSING_TAG_AT = /<\/[A-Za-z][A-Za-z0-9:-]*[\t\n\f\r ]*>/y;
const OPEN_TAG_HEAD_AT = /<[A-Za-z][A-Za-z0-9:-]*/y;
const WS_AT = /[\t\n\f\r ]+/y;
const TAG_END_AT = /\/?>/y;
const ATTR_BOOLEAN_NAME_AT =
  /(?=[A-Za-z_:\u00a0-\ufdcf\ufdf0-\ufffd[(@#*?.$])[^\x00-\x20\x7f-\x9f\ufdd0-\ufdef\ufffe\uffff"'&/<=>`]*(?:[A-Za-z0-9_\u00a0-\ufdcf\ufdf0-\ufffd])[^\x00-\x20\x7f-\x9f\ufdd0-\ufdef\ufffe\uffff"'&/<=>`]*/y;
const ATTR_VALUED_NAME_AT =
  /(?=[0-9-])[^\x00-\x20\x7f-\x9f\ufdd0-\ufdef\ufffe\uffff"'&/<=>`]*(?:[A-Za-z0-9_\u00a0-\ufdcf\ufdf0-\ufffd])[^\x00-\x20\x7f-\x9f\ufdd0-\ufdef\ufffe\uffff"'&/<=>`]*/y;
const ATTR_ASSIGN_AT = /[\t\n\f\r ]*=[\t\n\f\r ]*/y;
const ATTR_QUOTED_AT = /"[^"]*"|'[^']*'/y;
const ATTR_UNQUOTED_AT = /[^\t\n\f\r "'<>`]+/y;
const RAW_TEXT_OPEN_TAG_NAME = /^<(script|style)(?=[\t\n\f\r />])/i;
const RAW_END_WS_SLASH_AT = /[\t\n\f\r /]+/y;
const RAW_END_ATTR_NAME_AT = /[^\t\n\f\r /=>]+/y;
const RAW_END_UNQUOTED_AT = /[^\t\n\f\r >]+/y;

function matchSticky(pattern: RegExp, input: string, offset: number) {
  pattern.lastIndex = offset;
  return pattern.exec(input);
}

function referenceRawEndTagEnd(html: string, afterTagName: number) {
  let cursor = afterTagName;
  while (cursor < html.length) {
    const ws = matchSticky(RAW_END_WS_SLASH_AT, html, cursor);
    if (ws) cursor += ws[0].length;
    if (cursor >= html.length) return -1;
    if (html[cursor] === '>') return cursor + 1;
    const name = matchSticky(RAW_END_ATTR_NAME_AT, html, cursor);
    if (!name) return -1;
    cursor += name[0].length;
    const assign = matchSticky(ATTR_ASSIGN_AT, html, cursor);
    if (!assign) continue;
    cursor += assign[0].length;
    if (cursor >= html.length) return -1;
    if (html[cursor] === '>') return cursor + 1;
    if (html[cursor] === '"' || html[cursor] === "'") {
      const quoted = matchSticky(ATTR_QUOTED_AT, html, cursor);
      if (!quoted) return -1;
      cursor += quoted[0].length;
      continue;
    }
    const unquoted = matchSticky(RAW_END_UNQUOTED_AT, html, cursor);
    if (unquoted) cursor += unquoted[0].length;
  }
  return -1;
}

function referenceRawTextClose(html: string, from: number, tagName: 'script' | 'style'): [number, number] | null {
  if (tagName === 'style') {
    const closeHead = /<\/style(?=[\t\n\f\r />])/gi;
    closeHead.lastIndex = from;
    const match = closeHead.exec(html);
    if (!match) return null;
    const end = referenceRawEndTagEnd(html, match.index + 7);
    return end >= 0 ? [match.index, end] : null;
  }
  let escaped = false;
  let doubleEscaped = false;
  let cursor = from;
  while (cursor < html.length) {
    if (!escaped && html.startsWith('<!--', cursor)) {
      let dashes = cursor + 4;
      while (dashes < html.length && html[dashes] === '-') dashes += 1;
      if (dashes < html.length && html[dashes] === '>') {
        cursor = dashes + 1;
      } else {
        escaped = true;
        cursor = dashes;
      }
      continue;
    }
    if (escaped && html.startsWith('-->', cursor)) {
      escaped = false;
      doubleEscaped = false;
      cursor += 3;
      continue;
    }
    if (escaped && !doubleEscaped) {
      const innerOpen = matchSticky(/<script[\t\n\f\r />]/iy, html, cursor);
      if (innerOpen) {
        doubleEscaped = true;
        cursor += innerOpen[0].length;
        continue;
      }
    }
    if (doubleEscaped) {
      const innerClose = matchSticky(/<\/script[\t\n\f\r />]/iy, html, cursor);
      if (innerClose) {
        doubleEscaped = false;
        cursor += innerClose[0].length;
        continue;
      }
    } else {
      const outerClose = matchSticky(/<\/script(?=[\t\n\f\r />])/iy, html, cursor);
      if (outerClose) {
        const end = referenceRawEndTagEnd(html, cursor + 8);
        return end >= 0 ? [cursor, end] : null;
      }
    }
    cursor += 1;
  }
  return null;
}

// Independent unmemoized forward-scanning oracle for valid HTML tag and comment boundaries.
function referenceHtmlSegments(html: string) {
  const segments: [string, string][] = [];
  let textStart = 0;
  for (let start = 0; start < html.length; start++) {
    if (html[start] !== '<') continue;
    let end = -1;
    const comment = matchSticky(COMMENT_AT, html, start);
    if (comment) {
      end = start + comment[0].length;
    } else if (!html.startsWith('<!--', start)) {
      const conditional = matchSticky(WORD_CONDITIONAL_AT, html, start);
      const doctype = conditional ? null : matchSticky(DOCTYPE_AT, html, start);
      const closing = conditional || doctype ? null : matchSticky(CLOSING_TAG_AT, html, start);
      if (conditional) {
        end = start + conditional[0].length;
      } else if (doctype) {
        end = start + doctype[0].length;
      } else if (closing) {
        end = start + closing[0].length;
      } else {
        const head = matchSticky(OPEN_TAG_HEAD_AT, html, start);
        if (head) {
          let cursor = start + head[0].length;
          const immediateEnd = matchSticky(TAG_END_AT, html, cursor);
          if (immediateEnd) {
            end = cursor + immediateEnd[0].length;
          } else {
            const firstSpace = matchSticky(WS_AT, html, cursor);
            if (firstSpace) {
              cursor += firstSpace[0].length;
              while (cursor < html.length) {
                const ws = matchSticky(WS_AT, html, cursor);
                if (ws) cursor += ws[0].length;
                const tagEnd = matchSticky(TAG_END_AT, html, cursor);
                if (tagEnd) {
                  end = cursor + tagEnd[0].length;
                  break;
                }
                const booleanName = matchSticky(ATTR_BOOLEAN_NAME_AT, html, cursor);
                const valuedName = booleanName ? null : matchSticky(ATTR_VALUED_NAME_AT, html, cursor);
                const attrName = booleanName || valuedName;
                if (!attrName) break;
                cursor += attrName[0].length;
                const assign = matchSticky(ATTR_ASSIGN_AT, html, cursor);
                if (assign) {
                  cursor += assign[0].length;
                  const quoted = matchSticky(ATTR_QUOTED_AT, html, cursor);
                  if (quoted) {
                    cursor += quoted[0].length;
                    continue;
                  }
                  const unquoted = matchSticky(ATTR_UNQUOTED_AT, html, cursor);
                  if (!unquoted) break;
                  cursor += unquoted[0].length;
                  if (cursor < html.length && html[cursor] !== '>' && !matchSticky(WS_AT, html, cursor)) break;
                  continue;
                }
                if (valuedName) break;
                if (cursor < html.length && !matchSticky(WS_AT, html, cursor) && !matchSticky(TAG_END_AT, html, cursor))
                  break;
              }
            }
          }
        }
      }
    }
    if (end < 0) continue;
    const tag = html.slice(start, end);
    segments.push(['text', html.slice(textStart, start)], ['tag', tag]);
    textStart = end;
    const rawTextMatch = RAW_TEXT_OPEN_TAG_NAME.exec(tag);
    if (rawTextMatch) {
      const closeTag = referenceRawTextClose(html, end, rawTextMatch[1].toLowerCase() as 'script' | 'style');
      if (!closeTag) break;
      const [closeStart, closeEnd] = closeTag;
      segments.push(['text', html.slice(textStart, closeStart)], ['tag', html.slice(closeStart, closeEnd)]);
      textStart = closeEnd;
      start = closeEnd - 1;
      continue;
    }
    start = end - 1;
  }
  segments.push(['text', html.slice(textStart)]);
  return segments;
}

describe('Android feature helpers', () => {
  it('preserves valid tag boundaries, comments and callback order across seeded HTML inputs', () => {
    let seed = 2026100501;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const tokens = [
      '<a ',
      '<b x=',
      '<a title="',
      "<a title='",
      '<!--',
      '-->',
      '>',
      '/>',
      '"',
      "'",
      '<',
      '</b>',
      '😀',
      '&amp;',
      'x',
      '\n',
      '<pre>',
      '</pre>',
      '<script>',
      '</script>',
      '</script/>',
      '</SCRIPT >',
      '</scriptx>',
      '<style>',
      '</style>',
      '</style unused>',
      '<img alt="图示">',
      '<y,',
      '<!DOCTYPE html>',
      '<![if !mso]>',
      '<![endif]>',
      '[foo]="boards"',
      '[foo]',
      'data-a="1 > 0"',
      'href=/search?q=boards',
      'data-分类="x"',
      'data-分类',
      '='
    ];
    const fixtures = [
      '',
      '<a '.repeat(1000),
      '<!--'.repeat(1000),
      '<![if !mso '.repeat(1000),
      '<a x="<b >',
      "<a x='<'<b >",
      '<p>good</p>',
      '<a '.repeat(1000) + '>',
      "x<y, 'inline <b>keep</b>' <i>end</i>",
      "<!-- don't --><b>keep</b>",
      '<!-- a > b --><b>keep</b>',
      '<a ' + "a=\"f='<b c='k='x\" d=' e=\"' ".repeat(200) + '<b>keep</b>',
      '<a href=/search?q=boards>boards</a>',
      '<a [foo]="boards" href="/guides/boards">boards</a>',
      '<a [foo] href="/guides/boards">boards</a>',
      '<![if !supportLists]><p>boards</p><![endif]>',
      '<span data-分类="x">keep</span>',
      '<div data-分类>keep</div>',
      'a<b && c>d',
      'a<b - c > d',
      'a<b * c > d',
      'a<b != c > d',
      'x<y a=b<c>keep</c>',
      '<script>var x = "<!--";</script><p>visible</p><!-- real comment -->',
      '<script>var x = 1;</script/><p>visible</p>',
      '<script><!-- <script>var x = "</script>boards"; --></script><p>visible</p>',
      '<script><!--><script>var x = 1;</script><p>visible</p>',
      '<style>/* <!-- */</style><p>visible</p><!-- real comment -->',
      '<style>.a{}</style unused><p>visible</p>',
      '<style>.a{}</style data-note="1 > 0"><p>visible</p>',
      '<SCRIPT>var x = "</style> </scriptx> <!--";</SCRIPT ><p>visible</p><!-- real -->',
      '<script>var x = "<a title=\\"";</script><p>visible</p><a title="y">end</a>'
    ];
    for (let index = 0; index < 10_000; index++) {
      fixtures.push(Array.from({ length: random() % 80 }, () => tokens[random() % tokens.length]).join(''));
    }
    for (const [caseIndex, html] of fixtures.entries()) {
      const actual: [string, string][] = [];
      const output = transformHtmlSegments(
        html,
        (text) => {
          actual.push(['text', text]);
          return `T${text}`;
        },
        (tag) => {
          actual.push(['tag', tag]);
          return `G${tag}`;
        }
      );
      const expected = referenceHtmlSegments(html);
      expect(actual, `seed=2026100501 case=${caseIndex}`).toEqual(expected);
      expect(output).toBe(expected.map(([kind, value]) => `${kind === 'text' ? 'T' : 'G'}${value}`).join(''));
    }
  });
  it('builds plain text highlight parts from positive search terms', () => {
    expect(highlightTextParts('Hello VPS blocked', 'hello -blocked vps')).toEqual([
      { text: 'Hello', highlighted: true },
      { text: ' ', highlighted: false },
      { text: 'VPS', highlighted: true },
      { text: ' blocked', highlighted: false }
    ]);
  });

  it('highlights html text without touching tags', () => {
    expect(highlightHtml('<p>Hello <strong>VPS</strong></p>', 'vps hello')).toBe(
      '<p><mark>Hello</mark> <strong><mark>VPS</mark></strong></p>'
    );
  });

  it('never inserts search highlights into quoted html attributes containing greater-than signs', () => {
    expect(highlightHtml('<p><a title="VPS > private link">visible link</a></p>', 'link')).toBe(
      '<p><a title="VPS > private link">visible <mark>link</mark></a></p>'
    );
    expect(highlightHtml("x<y, 'inline <b>keep</b>' <i>end</i>", 'keep')).toBe(
      "x<y, 'inline <b><mark>keep</mark></b>' <i>end</i>"
    );
    expect(highlightHtml("<!-- don't keep --><b>keep</b>", 'keep')).toBe("<!-- don't keep --><b><mark>keep</mark></b>");
    expect(highlightHtml('<a href=/search?q=boards>boards</a>', 'boards')).toBe(
      '<a href=/search?q=boards><mark>boards</mark></a>'
    );
    expect(highlightHtml('<span data-分类="boards">boards</span>', 'boards')).toBe(
      '<span data-分类="boards"><mark>boards</mark></span>'
    );
    expect(highlightHtml('<script>var x = "<!--";</script><p>visible</p><!-- real comment -->', 'visible')).toBe(
      '<script>var x = "<!--";</script><p><mark>visible</mark></p><!-- real comment -->'
    );
    expect(highlightHtml('<style>/* <!-- */</style><p>visible</p><!-- real comment -->', 'visible')).toBe(
      '<style>/* <!-- */</style><p><mark>visible</mark></p><!-- real comment -->'
    );
  });

  it('highlights strictly inside decoded text segments without rewriting URLs, bracketed attrs, conditionals, raw blocks, entities, or preformatted code', () => {
    expect(
      highlightHtml(
        '<p><a href="/guides/boards">Read boards</a> <img src="https://cdn.example/guides/boards.png" alt="boards"></p>',
        'boards'
      )
    ).toBe(
      '<p><a href="/guides/boards">Read <mark>boards</mark></a> <img src="https://cdn.example/guides/boards.png" alt="boards"></p>'
    );
    expect(highlightHtml('<a [foo]="boards" href="/guides/boards">boards</a>', 'boards')).toBe(
      '<a [foo]="boards" href="/guides/boards"><mark>boards</mark></a>'
    );
    expect(highlightHtml('<img [src]="boards" src="/guides/boards.png" alt="boards"><p>boards</p>', 'boards')).toBe(
      '<img [src]="boards" src="/guides/boards.png" alt="boards"><p><mark>boards</mark></p>'
    );
    expect(highlightHtml('<![if !boards]><p>boards</p><![endif]>', 'boards')).toBe(
      '<![if !boards]><p><mark>boards</mark></p><![endif]>'
    );
    expect(highlightHtml('<script>var boards = 1;</script/><p>boards</p>', 'boards')).toBe(
      '<script>var boards = 1;</script/><p><mark>boards</mark></p>'
    );
    expect(
      highlightHtml('<script><!-- <script>var boards = "</script>boards"; --></script><p>boards</p>', 'boards')
    ).toBe('<script><!-- <script>var boards = "</script>boards"; --></script><p><mark>boards</mark></p>');
    expect(highlightHtml('<style>.boards{color:red}</style unused><p>boards</p>', 'boards')).toBe(
      '<style>.boards{color:red}</style unused><p><mark>boards</mark></p>'
    );

    const comparisonMatch = highlightHtml('<p>x<y and boards</p>', 'y');
    expect(comparisonMatch).toBe('<p>x&lt;<mark>y</mark> and boards</p>');
    expect(stripHtml(comparisonMatch)).toBe('x<y and boards');

    const comparisonSpanMatch = highlightHtml('<p>x<y</p>', 'x<y');
    expect(comparisonSpanMatch).toBe('<p><mark>x&lt;y</mark></p>');
    expect(stripHtml(comparisonSpanMatch)).toBe('x<y');

    expect(highlightHtml('<p>A&amp;B</p>', 'A&B')).toBe('<p><mark>A&amp;B</mark></p>');
    expect(highlightHtml('<p>A &amp; B</p>', 'A & B')).toBe('<p><mark>A</mark> <mark>&amp;</mark> <mark>B</mark></p>');
    expect(highlightHtml('<p>A &amp; B</p>', 'amp')).toBe('<p>A &amp; B</p>');
    expect(highlightHtml('<p>x &lt; y</p>', 'lt')).toBe('<p>x &lt; y</p>');
    expect(highlightHtml('<p>x &lt; y</p>', '<')).toBe('<p>x <mark>&lt;</mark> y</p>');

    const copyEntityHtml = '<p>&copy; 2026 &amp;copy;</p>';
    const highlightedCopySymbol = highlightHtml(copyEntityHtml, '©');
    expect(highlightedCopySymbol).toContain('<mark>');
    expect(stripHtml(highlightedCopySymbol)).toBe(stripHtml(copyEntityHtml));
    const highlightedCopyWord = highlightHtml(copyEntityHtml, 'copy');
    expect(highlightedCopyWord).toBe('<p>&copy; 2026 &amp;<mark>copy</mark>;</p>');
    expect(stripHtml(highlightedCopyWord)).toBe(stripHtml(copyEntityHtml));

    const richEntities = '<p>price &#128; &#x1F600 &Lt; &Gt;</p>';
    const highlightedEntities = highlightHtml(richEntities, '€ 😀');
    expect(highlightedEntities).toContain('<mark>');
    expect(stripHtml(highlightedEntities)).toBe('price € 😀 ≪ ≫');

    const preHtml = '<pre><code>const boards = "a&lt;b";\n\n  x<y boards</code></pre>';
    const highlightedPre = highlightHtml(preHtml, 'boards');
    expect(highlightedPre).toBe(
      '<pre><code>const <mark>boards</mark> = "a&lt;b";\n\n  x&lt;y <mark>boards</mark></code></pre>'
    );
    expect(stripHtml(highlightedPre)).toBe(stripHtml(preHtml));
    const highlightedPreEntity = highlightHtml(preHtml, 'a<b');
    expect(highlightedPreEntity).toContain('<mark>a&lt;b</mark>');
    expect(stripHtml(highlightedPreEntity)).toBe(stripHtml(preHtml));
  });

  it('keeps uncommon attributes and literal unknown entities when marking visible text', () => {
    const html = '<p><a !flag="boards" +flag="boards" href="/guides/boards">boards</a> &copycat;</p>';
    const highlighted = highlightHtml(html, 'boards cat');

    expect(highlighted).toBe(
      '<p><a !flag="boards" +flag="boards" href="/guides/boards"><mark>boards</mark></a> &amp;copy<mark>cat</mark>;</p>'
    );
    expect(stripHtml(highlighted)).toBe('boards &copycat;');
    expect(stripHtml(html)).toBe('boards &copycat;');
  });

  it('keeps dense planned-row highlights inside serialized and DOM budgets', () => {
    const html = `<p>${'a '.repeat(6_000)}</p>`;

    const highlighted = highlightHtml(html, 'a');
    const markCount = highlighted.match(/<mark>/g)?.length || 0;

    expect(markCount).toBeGreaterThan(0);
    expect(markCount).toBeLessThan(6_000);
    expect(highlighted).toMatch(/^<p><mark>a<\/mark>/);
    expect(stripHtml(highlighted)).toBe(stripHtml(html));
    expect(highlighted.length).toBeLessThanOrEqual(16_384);
    expect(htmlDomNodeCount(highlighted)).toBeLessThanOrEqual(80);
  });

  it('copies rendered reply text without html while keeping visible line breaks', () => {
    expect(
      stripHtml(
        '<p>Hello <a href="https://example.com">link</a></p><ul><li>One</li><li>Two</li></ul><pre><code>const x = 1;\n\nconsole.log(x);</code></pre><p><img src="x.png"><img alt="图示" src="y.png"></p>'
      )
    ).toBe('Hello link\nOne\nTwo\nconst x = 1;\n\nconsole.log(x);\n图示');
  });

  it('never copies quoted html attribute fragments containing greater-than signs', () => {
    expect(stripHtml('<p><a title="VPS > private link">visible link</a></p>')).toBe('visible link');
  });

  it('groups library records by recency', () => {
    const records = [
      record({ id: '1', savedAt: '2026-05-23T03:00:00.000Z' }),
      record({ id: '2', savedAt: '2026-05-20T03:00:00.000Z', topic: { ...topic, category: 'App' } }),
      record({
        id: '3',
        savedAt: '2026-05-10T03:00:00.000Z',
        topic: { ...topic, category: 'Other', categoryId: 'other' }
      })
    ];

    expect(
      groupLibraryRecordsByTime(records, new Date('2026-05-23T12:00:00.000Z')).map((section) => section.label)
    ).toEqual(['今天', '本周', '更早']);
  });

  it('builds library category filters only from the selected source', () => {
    const categories: Category[] = [
      { source: 'v2ex', id: 'create', name: '分享创造' },
      { source: 'nodeseek', id: 'daily', name: '日常' },
      { source: 'linuxdo', id: '4', name: '开发调优' }
    ];

    expect(libraryCategoryFilterItems(categories, 'linuxdo')).toEqual([
      { value: 'all', label: '全部' },
      { value: 'linuxdo:4', label: '开发调优' }
    ]);
    expect(libraryCategoryFilterItems(categories, 'all').map((item) => item.value)).toEqual([
      'all',
      'v2ex:create',
      'nodeseek:daily',
      'linuxdo:4'
    ]);
  });

  it('filters replies with case-insensitive positive terms and preserves empty-query input', () => {
    const replies: Reply[] = [
      { floor: 1, author: 'alice', createdAt: '2026-05-23T01:00:00.000Z', contentHtml: '<p>Hello VPS</p>' },
      { floor: 2, author: 'bob', createdAt: '2026-05-23T02:00:00.000Z', contentHtml: '<p>Other</p>' }
    ];
    expect(filterRepliesByQuery(replies, 'Hello VPS')).toEqual([replies[0]]);
    expect(filterRepliesByQuery(replies, 'vps missing')).toEqual([]);
    expect(filterRepliesByQuery(replies, '   -ignored ')).toBe(replies);
  });
});
