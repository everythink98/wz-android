import { describe, expect, it, vi } from 'vitest';
import { HTMLElement, TextNode } from 'node-html-parser';
import { withHtmlWorkBudget } from '../../../tests/helpers/htmlWorkBudget';
import {
  createForumTextIndex,
  elementText,
  escapeHtmlAttribute,
  escapeHtmlFully,
  escapeHtmlText,
  forumElementReplacementNodes,
  forumNodeText,
  hasRenderableHtmlContent,
  parseForumContentHtml,
  parseHtml,
  transformForumElements,
  textExcerpt,
  textExcerptFromPlainText,
  sortTopicsByTime,
  sortTopicsByCreatedAt,
  type ForumTextSegment
} from './html';

function materializeText(segments: ForumTextSegment[]) {
  return segments.map((segment) => segment.tape.text.slice(segment.start, segment.end)).join('');
}

describe('scoped HTML queries', () => {
  it.each([parseHtml, parseForumContentHtml])(
    'retains literal replacement text when parsing produces no children',
    (parse) => {
      for (const replacement of ['<!-- only comment -->', '</p>']) {
        const root = parse('<section><p>old</p><p>keep</p></section>');
        const paragraph = root.querySelector('p')!;
        transformForumElements(root, [paragraph], (node) => forumElementReplacementNodes(node, replacement));
        expect(root.toString()).toBe(`<section>${replacement}<p>keep</p></section>`);
        expect(paragraph.textContent).toBe('old');
        expect(paragraph.parentNode).toBeNull();
      }
    }
  );
  it.each(['*', 'span', '.safe', '[data-proof]'])(
    'finds deep %s descendants with bounded ancestry reads and fresh mutation results',
    (selector) => {
      const depth = 512;
      const root = parseForumContentHtml(
        '<section>' +
          '<span class="safe" data-proof="kept">'.repeat(depth) +
          'body' +
          '</span>'.repeat(depth) +
          '</section>'
      );
      const section = root.firstChild;
      if (!(section instanceof HTMLElement)) throw new Error('Missing section');
      const { result } = withHtmlWorkBudget(depth * 32 + 1000, () => section.querySelectorAll(selector));
      expect(result).toHaveLength(depth);
      const last = result.at(-1)!;
      last.replaceWith('<span class="safe" data-proof="new">new</span>');
      expect(section.querySelectorAll(selector)).toHaveLength(depth);
      expect(section.querySelectorAll(selector).at(-1)?.getAttribute('data-proof')).toBe('new');
      section.querySelectorAll(selector).at(-1)?.remove();
      expect(section.querySelectorAll(selector)).toHaveLength(depth - 1);
    }
  );
});

describe('forum text indexing', () => {
  it('projects excluded element subtrees to empty ranges while retaining visible escaped text', () => {
    const root = parseForumContentHtml(
      '<script>&lt;script&gt;权限不足&lt;/script&gt;</script><style>权限不足</style>' +
        '<p>&lt;script&gt;权限不足&lt;/script&gt;</p>'
    );
    const excluded = new Set(root.querySelectorAll('script,style'));
    const index = createForumTextIndex(root, excluded);
    expect(materializeText(index.range(root))).toBe('<script>权限不足</script>');
    expect(forumNodeText(root)).toBe('<script>权限不足</script>权限不足<script>权限不足</script>');
    for (const node of excluded) {
      expect(index.range(node)).toEqual([]);
      expect(index.hasText(node)).toBe(false);
    }
  });

  it('registers excluded descendants and new branches without changing held snapshots', () => {
    const root = parseForumContentHtml('<section>hidden<br></section><p>visible</p>');
    const excluded = root.querySelector('section')!;
    const br = root.querySelector('br')!;
    const initial = parseForumContentHtml('<aside>hidden child<span>leaf</span></aside>').firstChild;
    if (!(initial instanceof HTMLElement)) throw new Error('Missing child');
    br.appendChild(initial);
    const index = createForumTextIndex(root, new Set([excluded]));
    const heldRoot = index.range(root);
    for (const node of [excluded, br, initial, ...initial.querySelectorAll('*')]) {
      expect(index.range(node)).toEqual([]);
      expect(index.hasText(node)).toBe(false);
    }
    const addition = parseForumContentHtml('<div>new child<span>new leaf</span></div>').firstChild;
    if (!(addition instanceof HTMLElement)) throw new Error('Missing addition');
    initial.appendChild(addition);
    expect(index.hasText(addition.querySelector('span')!)).toBe(false);
    expect(index.range(addition)).toEqual([]);
    const heldAddition = index.range(addition);
    const visible = parseForumContentHtml('<nav>visible addition</nav>').firstChild;
    if (!(visible instanceof HTMLElement)) throw new Error('Missing visible branch');
    addition.remove();
    visible.appendChild(addition);
    root.appendChild(visible);
    expect(index.hasText(visible)).toBe(true);
    expect(materializeText(index.range(addition))).toBe('new childnew leaf');
    expect(materializeText(heldAddition)).toBe('');
    expect(materializeText(heldRoot)).toBe('visible');
    expect(materializeText(index.range(root))).toBe('visible');
    expect(forumNodeText(excluded)).toBe('hidden\n');
  });

  it('decodes each text leaf once without joining entities across elements', () => {
    const root = parseForumContentHtml('<p>&amp;lt;safe&amp;gt; &am<span>p;#32;</span> &amp;nbsp;</p>');
    expect(elementText(root)).toBe('&lt;safe&gt; &amp;#32; &nbsp;');
    expect(materializeText(createForumTextIndex(root).range(root))).toBe('&lt;safe&gt; &amp;#32; &nbsp;');
  });
  it.each(
    (
      [
        ['opening boundaries', '&#x', false],
        ['closing boundaries', '&amp;#', true]
      ] as const
    ).flatMap(([name, prefix, tail]) =>
      (['initial', 'root-first', 'leaves-first'] as const).map((order) => [name, order, prefix, tail] as const)
    )
  )('indexes long %s entity %s with bounded decoding and parent reads', (_name, order, prefix, tail) => {
    const depth = 1024;
    const ending = prefix.endsWith('x') ? '20;' : '32;';
    const html = tail
      ? '<span>'.repeat(depth) + prefix + '0</span>'.repeat(depth) + ending
      : prefix + '<span>0'.repeat(depth) + ending + '</span>'.repeat(depth);
    const root = parseForumContentHtml(
      order === 'initial' ? html : '<p>ordinary body</p><pre><code>&lt;safe&gt;</code></pre><img src="/body.png">'
    );
    const index = order === 'initial' ? undefined : createForumTextIndex(root);
    const addition = order === 'initial' ? root : parseForumContentHtml(`<section>${html}</section>`).firstChild;
    if (!(addition instanceof HTMLElement)) throw new Error('New subtree is unavailable');
    if (order !== 'initial') root.appendChild(addition);
    const nodes = [addition, ...addition.querySelectorAll('*')];
    if (order === 'leaves-first') nodes.reverse();
    const expected = nodes.map((node) => Boolean(elementText(node)));
    const descriptor = Object.getOwnPropertyDescriptor(TextNode.prototype, 'text');
    if (!descriptor?.get) throw new Error('TextNode text getter is unavailable');
    const decode = descriptor.get;
    const rawDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'rawText');
    if (!rawDescriptor?.get) throw new Error('Element rawText getter is unavailable');
    const readRaw = rawDescriptor.get;
    let decodedInputChars = 0;
    let parentReads = 0;
    const decodeBudget = html.length * 8;
    const parentBudget = nodes.length * 8;
    const parents = [...new Set([root, ...nodes])].map((node) => {
      const descriptor = Object.getOwnPropertyDescriptor(node, 'parentNode');
      if (!descriptor || !('value' in descriptor)) throw new Error('Node parent is not a data property');
      const parent = node.parentNode;
      Object.defineProperty(node, 'parentNode', {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get() {
          if (++parentReads > parentBudget) throw new Error(`New subtree exceeded ${parentBudget} parent reads`);
          return parent;
        }
      });
      return { node, descriptor };
    });
    Object.defineProperty(TextNode.prototype, 'text', {
      ...descriptor,
      get(this: TextNode) {
        decodedInputChars += this.rawText.length;
        if (decodedInputChars > decodeBudget)
          throw new Error(`New subtree decoding exceeded ${decodeBudget} input characters`);
        return decode.call(this);
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'rawText', {
      ...rawDescriptor,
      get(this: HTMLElement) {
        const raw = readRaw.call(this);
        decodedInputChars += raw.length;
        if (decodedInputChars > decodeBudget)
          throw new Error(`New subtree decoding exceeded ${decodeBudget} input characters`);
        return raw;
      }
    });
    try {
      const textIndex = index || createForumTextIndex(root);
      expect(nodes.map((node) => textIndex.hasText(node))).toEqual(expected);
      expect(nodes.map((node) => textIndex.hasText(node))).toEqual(expected);
      for (const node of nodes) {
        const segments = textIndex.range(node);
        expect(segments.length).toBeLessThanOrEqual(1);
      }
      expect(decodedInputChars).toBeLessThanOrEqual(decodeBudget);
      expect(parentReads).toBeLessThanOrEqual(parentBudget);
    } finally {
      Object.defineProperty(TextNode.prototype, 'text', descriptor);
      Object.defineProperty(HTMLElement.prototype, 'rawText', rawDescriptor);
      for (const { node, descriptor } of parents) Object.defineProperty(node, 'parentNode', descriptor);
    }
    if (order !== 'initial') {
      expect(root.querySelector('p')?.text).toBe('ordinary body');
      expect(root.querySelector('code')?.text).toBe('<safe>');
      expect(root.querySelector('img')?.getAttribute('src')).toBe('/body.png');
    }
  });

  it.each([
    ['&nbsp;', '\u00a0'],
    ['&nbsp', '\u00a0'],
    ['&#32', ' '],
    ['&#x80;', '€'],
    ['&#55296;', '\ufffd'],
    ['&#1114112;', '\ufffd'],
    ['&amp;#32;', '&#32;'],
    ['&amp;lt;x&amp;gt;', '&lt;x&gt;']
  ])('decodes a complete text leaf %s exactly once', (input, expected) => {
    const root = parseForumContentHtml('<p>' + input + '</p>');
    expect(forumNodeText(root)).toBe(expected);
    expect(materializeText(createForumTextIndex(root).range(root))).toBe(expected);
  });

  it('keeps entity fragments literal across element boundaries and excludes comments', () => {
    const root = parseForumContentHtml('<p>&nb<span>sp;</span><!-- hidden --> &amp;<i>nbsp;</i><br>end</p>');
    expect(forumNodeText(root)).toBe('&nbsp; &nbsp;\nend');
    expect(elementText(root)).toBe('&nbsp; &nbsp; end');
    expect(materializeText(createForumTextIndex(root).range(root))).toBe('&nbsp; &nbsp;\nend');
  });

  it('keeps leaf text and transformed br descendants independently queryable', () => {
    const root = parseForumContentHtml('<p>&am<span>p;#3</span><b>2;</b></p><br>');
    const child = parseForumContentHtml('<section>&amp;#32;<div>ordinary body</div><br></section>').firstChild;
    if (child) root.querySelector('br')?.appendChild(child);
    const index = createForumTextIndex(root);
    for (const node of [root, ...root.querySelectorAll('*')]) {
      expect(materializeText(index.range(node))).toBe(forumNodeText(node));
      expect(index.hasText(node)).toBe(Boolean(elementText(node)));
    }
  });

  it('indexes independent inserted, replaced and detached branches without changing their content', () => {
    const root = parseForumContentHtml('<article>existing body</article>');
    const index = createForumTextIndex(root);
    const heldRoot = index.range(root);
    const first = parseForumContentHtml(
      '<section>&am<span>p;#3</span><b>2;</b><pre><code>&lt;safe&gt;</code></pre><img src="/proof.png"></section>'
    ).firstChild;
    const second = parseForumContentHtml('<aside>&nbsp;<div>&amp;#X00020;</div><p>&#32</p></aside>').firstChild;
    const detached = parseForumContentHtml('<nav>&#38;#128;<span>&amp;#1114112;</span></nav>').firstChild;
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement) || !(detached instanceof HTMLElement))
      throw new Error('New branches are unavailable');
    root.appendChild(first);
    root.appendChild(second);
    const firstContent = first.toString();
    const secondContent = second.toString();
    for (const branch of [first, second, detached]) {
      const nodes = [branch, ...branch.querySelectorAll('*')].reverse();
      for (const node of nodes) {
        expect(materializeText(index.range(node))).toBe(forumNodeText(node));
        expect(index.hasText(node)).toBe(Boolean(elementText(node)));
      }
    }
    const replacement = parseForumContentHtml('<section>replacement<span>&amp;nbsp;</span></section>').firstChild;
    if (!(replacement instanceof HTMLElement)) throw new Error('Replacement branch is unavailable');
    first.replaceWith(replacement);
    for (const node of [replacement, ...replacement.querySelectorAll('*')])
      expect(materializeText(index.range(node))).toBe(forumNodeText(node));
    expect(materializeText(index.range(first))).toBe(forumNodeText(first));
    expect(first.toString()).toBe(firstContent);
    expect(second.toString()).toBe(secondContent);
    expect(materializeText(heldRoot)).toBe('existing body');
    expect(materializeText(index.range(root))).toBe('existing body');
  });

  it('refreshes nodes moved into a newly indexed branch while held tapes retain the earlier snapshot', () => {
    const root = parseForumContentHtml('<article>old body<aside>&amp;#32;</aside></article>');
    const moved = root.querySelector('aside');
    if (!moved) throw new Error('Moved node is unavailable');
    const index = createForumTextIndex(root);
    const heldMoved = index.range(moved);
    const heldRoot = index.range(root);
    moved.set_content('new body &amp;#128;');
    moved.remove();
    const addition = parseForumContentHtml('<section><div><span>&amp;#X20;</span></div></section>').firstChild;
    if (!(addition instanceof HTMLElement)) throw new Error('New subtree is unavailable');
    addition.appendChild(moved);
    root.appendChild(addition);
    const leaf = addition.querySelector('span');
    if (!leaf) throw new Error('New leaf is unavailable');
    expect(index.hasText(leaf)).toBe(true);
    expect(materializeText(index.range(moved))).toBe('new body &#128;');
    expect(materializeText(index.range(addition))).toBe(forumNodeText(addition));
    expect(materializeText(heldMoved)).toBe('&#32;');
    expect(materializeText(heldRoot)).toBe('old body&#32;');
    expect(materializeText(index.range(root))).toBe('old body&#32;');
  });

  it('indexes newly transformed br children without decoding across independent branches', () => {
    const root = parseForumContentHtml('<p>existing body</p><br>');
    const index = createForumTextIndex(root);
    const br = root.querySelector('br');
    if (!br) throw new Error('Break is unavailable');
    for (const html of ['<section>&amp;#<span>32;</span><br></section>', '<div>&am</div>', '<div>p;#32;</div>']) {
      const branch = parseForumContentHtml(html).firstChild;
      if (!(branch instanceof HTMLElement)) throw new Error('Break child is unavailable');
      br.appendChild(branch);
      for (const node of [branch, ...branch.querySelectorAll('*')].reverse()) {
        expect(materializeText(index.range(node))).toBe(forumNodeText(node));
        expect(index.hasText(node)).toBe(Boolean(elementText(node)));
      }
    }
    expect(materializeText(index.range(br))).toBe('\n');
    expect(materializeText(index.range(root))).toBe('existing body\n');
  });

  it('keeps partial leaves independent in original and newly added snapshots', () => {
    const text = '&Tab;&amp;nbsp;&amp;#' + '0'.repeat(256) + '32;';
    const boundaries = [0, 1, 4, 5, 8, 13, 16, 128, text.length - 2, text.length];
    for (const start of boundaries) {
      for (const end of boundaries.filter((end) => end >= start)) {
        const html = `<section>${text.slice(0, start)}<span>${text.slice(start, end)}</span>${text.slice(end)}</section>`;
        for (const added of [false, true]) {
          const root = parseForumContentHtml(added ? '<p>original body</p>' : html);
          const index = createForumTextIndex(root);
          const branch = added ? parseForumContentHtml(html).firstChild : root;
          if (!(branch instanceof HTMLElement)) throw new Error('Entity subtree is unavailable');
          if (added) root.appendChild(branch);
          for (const node of [branch, ...branch.querySelectorAll('*')].reverse()) {
            expect(materializeText(index.range(node)), `${added}:${start}:${end}`).toBe(forumNodeText(node));
            expect(index.hasText(node), `${added}:${start}:${end}`).toBe(Boolean(forumNodeText(node).trim()));
          }
        }
      }
    }
  });
});

describe('topic timestamp ordering', () => {
  it.each([sortTopicsByTime, sortTopicsByCreatedAt])('parses each timestamp once and preserves stable ties', (sort) => {
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: index,
      createdAt: `2026-08-${String(((index * 7) % 28) + 1).padStart(2, '0')}T00:00:00Z`
    }));
    const parse = vi.spyOn(Date, 'parse');
    try {
      const sorted = sort(items);
      expect(parse).toHaveBeenCalledTimes(items.length);
      expect(sorted.slice(0, 3).map((item) => item.id)).toEqual([3, 7, 11]);
      expect(items[0].id).toBe(0);
      expect(
        sort([
          { id: 1, createdAt: '' },
          { id: 2, createdAt: 'invalid' }
        ]).map((item) => item.id)
      ).toEqual([1, 2]);
    } finally {
      parse.mockRestore();
    }
  });
});

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

describe('HTML renderability', () => {
  it('keeps an audio-only detail post renderable before and after sanitization', () => {
    expect(hasRenderableHtmlContent('<audio src="https://media.example/song.mp3"></audio>')).toBe(true);
    expect(hasRenderableHtmlContent('<forum-audio src="https://media.example/song.mp3"></forum-audio>')).toBe(true);
  });
});

describe('plain text excerpts', () => {
  it('retains literal entity and tag text while normalizing whitespace', () => {
    expect(textExcerptFromPlainText('  &#32;\n<x>  ')).toBe('&#32; <x>');
    expect(textExcerptFromPlainText(0)).toBe('0');
    expect(textExcerptFromPlainText(null)).toBe('');
  });

  it('keeps the existing truncation after the appropriate text conversion', () => {
    expect(textExcerptFromPlainText('  abc\n def  ', 4)).toBe('abc...');
    expect(textExcerptFromPlainText(' abc ', 3)).toBe('abc');
    expect(textExcerpt('<b>abc</b> def', 4)).toBe('abc...');
    expect(textExcerpt('<b>&#32; &lt;x&gt;</b>')).toBe('<x>');
  });
});
