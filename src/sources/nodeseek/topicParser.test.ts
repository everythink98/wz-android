import { HTMLElement } from 'node-html-parser';
import { describe, expect, it } from 'vitest';
import { parseForumContentHtml } from '@/domain/forum/html';
import { ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE } from '@/domain/forum/accessRequirements';
import { parseNodeSeekPageDocument } from './protocol';
import { withHtmlDecodedInputBudget, withHtmlWorkBudget } from '../../../tests/helpers/htmlWorkBudget';
import {
  normalizeRenderedNodeSeekPollRoot,
  parseRenderedNodeSeekTopicHtml,
  prepareNodeSeekForumContent
} from './topicParser';

describe('rendered nested reply rows', () => {
  it('derives every overlapping reply row with bounded DOM work and keeps the local reply cursor', () => {
    const depth = 512;
    const html =
      '<h1>Audit</h1><div class="content-item"><article class="post-content">主楼</article></div>' +
      '<div class="comment-item" data-comment-id="2">'.repeat(depth) +
      '<div class="comment-content">回复</div><time datetime="2026-10-11T00:00:00Z"></time>' +
      '</div>'.repeat(depth);
    const document = parseNodeSeekPageDocument(html);
    const { result } = withHtmlWorkBudget(depth * 512 + 10000, () =>
      parseRenderedNodeSeekTopicHtml(document, '42', depth)
    );
    expect(result?.replies).toHaveLength(depth);
    expect(result?.replies.every((reply) => reply.contentHtml === '回复' && reply.commentId === 2)).toBe(true);
    const limited = parseRenderedNodeSeekTopicHtml(document, '42');
    expect(limited?.replies).toHaveLength(30);
    expect(limited?.replyHasMore).toBe(true);
    expect(limited?.replyNextOffset).toBe(30);
    expect(limited?.lastReplyAt).toBe('2026-10-11T00:00:00.000Z');
  });

  it('keeps row-scoped ancestor requirements for avatars and reaction menus', () => {
    const html =
      '<h1>Audit</h1><div class="content-item"><article class="post-content">主楼</article></div>' +
      '<div class="comment-menu"><div class="comment-author"><div class="comment-item" data-comment-id="2">' +
      '<div class="comment-content">first</div><img src="/outside.png"><a href="/space/42"><img src="/inside.png"></a>' +
      '<div class="menu-item" title="点赞" data-count="9"></div>' +
      '<div class="comment-menu"><div class="menu-item clicked" title="加鸡腿" data-count="3"></div></div>' +
      '</div></div></div>';
    const result = parseRenderedNodeSeekTopicHtml(parseNodeSeekPageDocument(html), '42');
    expect(result?.replies[0].authorAvatar).toBe('https://www.nodeseek.com/inside.png');
    expect(result?.replies[0].upvoteCount).toBeUndefined();
    expect(result?.replies[0].likeCount).toBe(3);
    expect(result?.replies[0].liked).toBe(true);
  });
});

function measureNoticeInput<T>(budget: number, read: () => T) {
  const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'replace');
  if (!descriptor?.value) throw new Error('Expected the real text replacement method');
  const replace = String.prototype.replace;
  const exec = RegExp.prototype.exec;
  let units = 0;
  // eslint-disable-next-line no-extend-native -- Measure the real string work and restore its descriptor in finally.
  Object.defineProperty(String.prototype, 'replace', {
    ...descriptor,
    value(this: string, search: string | RegExp, replacement: unknown) {
      if (
        search instanceof RegExp &&
        (['\\s+', '<[^>]*>'].includes(search.source) || search.source.startsWith('&(#x'))
      ) {
        units += this.length;
        if (units > budget) throw new Error(`Permission text processing exceeded ${budget} UTF-16 units`);
      }
      return Reflect.apply(replace, this, [search, replacement]);
    }
  });
  // Count real unanchored notice searches too, so moving the repeated scan cannot satisfy the budget.
  // eslint-disable-next-line no-extend-native -- Count the real notice matcher, then restore it in finally.
  RegExp.prototype.exec = function (input) {
    if (!this.global && this.source.length > 40 && ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE.includes(this.source)) {
      units += input.length;
      if (units > budget) throw new Error(`Permission text processing exceeded ${budget} UTF-16 units`);
    }
    return exec.call(this, input);
  };
  try {
    return { result: read(), units };
  } finally {
    // eslint-disable-next-line no-extend-native -- Restore the matcher captured before instrumentation.
    RegExp.prototype.exec = exec;
    // eslint-disable-next-line no-extend-native -- Restore the exact descriptor captured before the work probe.
    Object.defineProperty(String.prototype, 'replace', descriptor);
  }
}

function measureRenderedPollWork<T>(
  root: HTMLElement,
  domBudget: number,
  sliceBudget: number,
  read: () => T,
  textBudget = Infinity
) {
  let sliceUnits = 0;
  let textUnits = 0;
  const sliceDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'slice');
  if (!sliceDescriptor?.value) throw new Error('Expected the real string slice method');
  const slice = String.prototype.slice;
  // eslint-disable-next-line no-extend-native -- Count real copied UTF-16 ranges and restore the exact descriptor.
  Object.defineProperty(String.prototype, 'slice', {
    ...sliceDescriptor,
    value(this: string, ...args: Parameters<typeof slice>) {
      const result = Reflect.apply(slice, this, args);
      sliceUnits += result.length;
      if (sliceUnits > sliceBudget) throw new Error(`Rendered poll replacement exceeded ${sliceBudget} UTF-16 units`);
      return result;
    }
  });
  const textDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'rawText');
  if (!textDescriptor?.get) throw new Error('Expected the real element text decoder input');
  const rawText = textDescriptor.get;
  Object.defineProperty(HTMLElement.prototype, 'rawText', {
    ...textDescriptor,
    get(this: HTMLElement) {
      const result = rawText.call(this);
      textUnits += result.length;
      if (textUnits > textBudget) throw new Error(`Rendered poll text exceeded ${textBudget} UTF-16 units`);
      return result;
    }
  });
  try {
    return { ...withHtmlWorkBudget(domBudget, read, root), sliceUnits, textUnits };
  } finally {
    // eslint-disable-next-line no-extend-native -- Restore the original method even when a work budget fails.
    Object.defineProperty(String.prototype, 'slice', sliceDescriptor);
    Object.defineProperty(HTMLElement.prototype, 'rawText', textDescriptor);
  }
}

const pollForm =
  '<form class="vote-form" data-vote-id="7" data-multiple="true">' +
  '<legend>Systems</legend><p>公开投票 已关闭</p>' +
  '<label><input type="checkbox" name="ids" value="71">First <span class="vote-count">12 票</span></label>' +
  '<label><input type="checkbox" name="ids" value="72" checked>Second <span class="vote-count">5 票</span></label>' +
  '</form>';
const placeholder = '<forum-nodeseek-poll id="7"></forum-nodeseek-poll>';

function topicDocument(body: string) {
  return parseNodeSeekPageDocument(
    '<h1>Rendered poll</h1>' +
      '<div class="content-item" data-comment-id="1"><article class="post-content">' +
      body +
      '</article></div>'
  );
}

describe('NodeSeek rendered restricted notices', () => {
  it('rejects long numeric entity fringes containing notice words without joining every candidate', () => {
    const depth = 1024;
    const html =
      '<h1>Notice boundary</h1><div id="nsk-body"><div>&#' +
      '0<div>'.repeat(depth) +
      '65;&amp;登录经验交流' +
      '</div>'.repeat(depth) +
      '</div></div>';
    const document = parseNodeSeekPageDocument(html);
    const { result: topic, units } = measureNoticeInput(html.length * 16, () =>
      parseRenderedNodeSeekTopicHtml(document, '42')
    );
    expect(topic).toBeNull();
    expect(units).toBeLessThan(html.length * 16);
  });

  it.each([
    ['escaped text', '&amp;', ''],
    ['literal markup', '&lt;x&gt;', ''],
    ['escaped numeric spelling', '&amp;amp;#65;', ' class="notice"'],
    ['quoted tag delimiters', '&lt;q &quot; &gt;', ''],
    ['nested script text', '&lt;script&gt;', '']
  ])('rejects %s containing notice words without rescanning negative boundaries', (_name, prefix, attribute) => {
    const depth = 1024;
    const html =
      '<h1>Notice boundary</h1><div id="nsk-body">' +
      `<div${attribute}>${prefix}`.repeat(depth) +
      '登录经验交流' +
      (prefix === '&lt;script&gt;' ? '&lt;/script&gt;' : '') +
      '</div>'.repeat(depth) +
      '</div>';
    const document = parseNodeSeekPageDocument(html);
    const { result: topic, units } = measureNoticeInput(html.length * 16, () =>
      parseRenderedNodeSeekTopicHtml(document, '42')
    );
    expect(topic).toBeNull();
    expect(units).toBeLessThan(html.length * 16);
  });

  it.each(['&amp;', '&lt;x&gt;'])(
    'rejects distinct %s boundaries without rescanning every full notice candidate',
    (prefix) => {
      const depth = 1024;
      const html =
        '<title>NodeSeek</title><div id="nsk-body">' +
        `<div>${prefix}`.repeat(depth) +
        '页面暂时无法显示，请稍后重试。' +
        '</div>'.repeat(depth) +
        '</div>';
      const document = parseNodeSeekPageDocument(html);
      const { result: topic, units } = measureNoticeInput(html.length * 16, () =>
        parseRenderedNodeSeekTopicHtml(document, '42')
      );
      expect(topic).toBeNull();
      expect(units).toBeLessThan(html.length * 16);
    }
  );

  it.each([
    'restricted',
    'ordinary',
    'ordinary-prefix',
    'explicit-restricted',
    'explicit-ordinary-prefix',
    'readable-empty'
  ] as const)('recognizes deep %s content with bounded DOM reads', (kind) => {
    const depth = 1024;
    const restricted = kind === 'restricted' || kind === 'explicit-restricted';
    const text = restricted
      ? '权限不足，需要等级 2 才能查看该主题。'
      : kind === 'readable-empty'
        ? ''
        : '页面暂时无法显示，请稍后重试。';
    const attribute = kind.startsWith('explicit')
      ? ' class="notice"'
      : kind === 'readable-empty'
        ? ' class="post-content"'
        : '';
    const prefix = kind.endsWith('prefix') ? 'x' : '';
    const document = parseNodeSeekPageDocument(
      '<title>NodeSeek</title><div id="nsk-body"><div id="nsk-body-left">' +
        `<div${attribute}>${prefix}`.repeat(depth) +
        text +
        '</div>'.repeat(depth) +
        '</div></div>'
    );

    const { result: topic, reads } = withHtmlWorkBudget(
      depth * 224,
      () => parseRenderedNodeSeekTopicHtml(document, '42'),
      document.root
    );

    expect(reads).toBeLessThan(depth * 224);
    if (restricted) {
      expect(topic?.title).toBe('受限帖子');
      expect(topic?.contentHtml).toBe(text);
      expect(topic?.accessRequirement).toEqual({ type: 'level', label: '需等级', detail: text });
    } else if (kind === 'readable-empty') {
      expect(topic?.contentHtml).toBe('<div class="post-content">'.repeat(depth - 1) + '</div>'.repeat(depth - 1));
      expect(topic?.accessRequirement).toBeUndefined();
    } else {
      expect(topic).toBeNull();
    }
  });

  it.each([
    ['short explicit notice', '<div class="notice">无权限</div>', '无权限'],
    ['short fallback ignored', '<div><span>无权限</span></div>', undefined],
    ['literal tag across child', '<div>&lt;x<span>权限不足</span>&gt;</div>', '&lt;x权限不足&gt;'],
    ['named entity across child', '<div>&<span>not allowed</span></div>', '&amp;not allowed'],
    ['media content wins', '<div class="post-content"><img></div><div class="notice">权限不足</div>', '<img>'],
    ['candidate media excluded', '<img class="post-content"><div class="notice">权限不足</div>', '权限不足']
  ])('preserves %s precedence and independent text boundaries', (_name, content, expected) => {
    const document = parseNodeSeekPageDocument(`<title>NodeSeek</title><div id="nsk-body">${content}</div>`);
    const topic = parseRenderedNodeSeekTopicHtml(document, '42');
    expect(topic?.contentHtml).toBe(expected);
    if (content.includes('<img>')) expect(topic?.accessRequirement).toBeUndefined();
  });

  it.each([
    '&amp;#26435;&amp;#38480;&amp;#19981;&amp;#36275;',
    '&amp;amp;#26435;&amp;amp;#38480;&amp;amp;#19981;&amp;amp;#36275;',
    '&am<span>p;#26435;</span>&amp;#38480;&amp;#19981;&amp;#36275;'
  ])('keeps escaped and element-separated entity spellings as plain text: %s', (text) => {
    const document = parseNodeSeekPageDocument(
      `<title>NodeSeek</title><div id="nsk-body"><div class="notice">${text}</div></div>`
    );
    expect(parseRenderedNodeSeekTopicHtml(document, '42')).toBeNull();
  });

  it.each([
    ['script', '权限不足'],
    ['style', '权限不足'],
    ['script', '&#26435;&#38480;&#19981;&#36275;'],
    ['style', '&#26435;&#38480;&#19981;&#36275;'],
    ['script', '&lt;script&gt;权限不足&lt;/script&gt;'],
    ['style', '&lt;script&gt;权限不足&lt;/script&gt;']
  ])('ignores permission words inside an actual %s element: %s', (tag, content) => {
    const document = parseNodeSeekPageDocument(
      `<title>NodeSeek</title><div id="nsk-body"><div class="notice"><${tag}>${content}</${tag}>ordinary</div></div>`
    );
    expect(parseRenderedNodeSeekTopicHtml(document, '42')).toBeNull();
  });

  it.each(['script', 'style'])('keeps visible notice text after an actual %s element', (tag) => {
    const document = parseNodeSeekPageDocument(
      `<title>NodeSeek</title><div id="nsk-body"><div class="notice"><${tag}>ordinary</${tag}>权限不足</div></div>`
    );
    const topic = parseRenderedNodeSeekTopicHtml(document, '42');
    expect(topic?.contentHtml).toBe('权限不足');
    expect(topic?.accessRequirement).toEqual({ type: 'permission', label: '需权限', detail: '权限不足' });
  });

  it('recognizes visible literal markup without interpreting it as another HTML document', () => {
    const document = parseNodeSeekPageDocument(
      '<title>NodeSeek</title><div id="nsk-body"><div class="notice">&lt;script&gt;权限不足&lt;/script&gt;</div></div>'
    );
    const topic = parseRenderedNodeSeekTopicHtml(document, '42');
    expect(topic?.contentHtml).toBe('&lt;script&gt;权限不足&lt;/script&gt;');
    expect(topic?.accessRequirement).toEqual({
      type: 'permission',
      label: '需权限',
      detail: '<script>权限不足</script>'
    });
  });

  it('treats a visible escaped whitespace spelling as readable content before a separate notice', () => {
    const document = parseNodeSeekPageDocument(
      '<title>NodeSeek</title><div id="nsk-body"><div class="post-content">&amp;nbsp;</div><div class="notice">权限不足</div></div>'
    );
    const topic = parseRenderedNodeSeekTopicHtml(document, '42');
    expect(topic?.contentHtml).toBe('&amp;nbsp;');
    expect(topic?.accessRequirement).toBeUndefined();
  });

  it('checks a notice in a separate text snapshot below a transformed line break', () => {
    const document = parseNodeSeekPageDocument(
      '<title>NodeSeek</title><div id="nsk-body"><div class="notice">ordinary<br></div></div>'
    );
    const lineBreak = document.root.querySelector('br');
    const notice = parseForumContentHtml('<section class="notice">权限不足</section>').firstChild;
    if (!lineBreak || !notice) throw new Error('Expected a transformed line break notice');
    lineBreak.appendChild(notice);
    const topic = parseRenderedNodeSeekTopicHtml(document, '42');
    expect(topic?.contentHtml).toBe('权限不足');
    expect(topic?.accessRequirement).toEqual({ type: 'permission', label: '需权限', detail: '权限不足' });
  });

  it('keeps negative ancestor ranges while separate line-break branches interrupt candidate order', () => {
    const depth = 256;
    const document = parseNodeSeekPageDocument(
      '<h1>Audit</h1><div id="nsk-body">' +
        '<div class="notice">ordinary<br>'.repeat(depth) +
        '登录经验交流' +
        '</div>'.repeat(depth) +
        '</div>'
    );
    for (const lineBreak of document.root.querySelectorAll('br')) {
      const notice = parseForumContentHtml('<section class="notice">登录经验交流</section>').firstChild;
      if (!notice) throw new Error('Expected a separate line-break branch');
      lineBreak.appendChild(notice);
    }
    const { result: topic, units } = measureNoticeInput(depth * 200 + 1000, () =>
      parseRenderedNodeSeekTopicHtml(document, '42')
    );
    expect(topic).toBeNull();
    expect(units).toBeLessThan(depth * 200 + 1000);
  });

  it.each([
    [
      '<div class="post-content">generic</div><section class="post-detail"><div class="post-content">detail</div></section><article><div class="post-content">article</div></article>',
      'article'
    ],
    [
      '<article class="post-content">own</article><section class="post-detail"><div class="post-content">detail</div></section>',
      'detail'
    ],
    [
      '<div class="content-item"><div class="content">first</div></div><article><div class="post-content">article</div></article>',
      'first'
    ],
    ['<div class="post-content">generic</div><section class="post-detail post-content">own</section>', 'generic']
  ])('retains body context priority without treating the content node as its own ancestor', (content, expected) => {
    const topic = parseRenderedNodeSeekTopicHtml(parseNodeSeekPageDocument('<h1>Body priority</h1>' + content), '42');
    expect(topic?.contentHtml).toBe(expected);
  });
});

describe('NodeSeek rendered poll content', () => {
  it('keeps the loaded poll when its source marker is repeated within one paragraph', () => {
    const content = prepareNodeSeekForumContent('<p>nsapp://vote?id=7 nsapp://vote?id=7 </p>', {
      role: 'opening',
      polls: [
        {
          id: '7',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' }
          ]
        }
      ]
    });
    expect(content.contentHtml).toBe(placeholder);
  });

  it.each(['decimal twice end cuts', 'invalid hexadecimal start cuts', 'named prefix start cuts'] as const)(
    'preserves long %s fragments with bounded decoding and ordered shell cleanup',
    (kind) => {
      const depth = 1024;
      const content =
        kind === 'decimal twice end cuts'
          ? '<div>' +
            '<section class="embed-vote">'.repeat(depth) +
            '&amp;#' +
            '0</section>'.repeat(depth) +
            '32;</div>'
          : '<div>' +
            (kind === 'invalid hexadecimal start cuts' ? '&#x' : '&not') +
            (kind === 'invalid hexadecimal start cuts'
              ? '0<section class="vote-panel">'
              : 'i<section class="embed-vote">'
            ).repeat(depth) +
            (kind === 'invalid hexadecimal start cuts'
              ? '110000; ordinary body <img src="https://example.com/proof.png">'
              : 'n; ordinary body') +
            '</section>'.repeat(depth) +
            '</div>';
      const controls =
        '<div class="embed-vote"><span class="form-mask">temporary</span></div>' +
        '<div class="embed-vote"><img class="embed-vote"></div><p><img class="vote-panel"></p><p>ordinary body</p>';
      const root = parseForumContentHtml(content + controls);

      const { units } = withHtmlDecodedInputBudget(depth * 128, () => normalizeRenderedNodeSeekPollRoot(root, []));

      expect(units).toBeLessThanOrEqual(depth * 128);
      expect(root.toString()).toBe(content + '<div class="embed-vote"></div><p>ordinary body</p>');
    }
  );

  it.each(['distant', 'none'] as const)('extracts deep forms with bounded work when their panel is %s', (panel) => {
    const depth = 2048;
    const nestedForm = '<span>'.repeat(depth) + pollForm + '</span>'.repeat(depth);
    const content =
      '<p>before</p>' +
      (panel === 'distant' ? `<section class="outer vote-panel">${nestedForm}</section>` : nestedForm) +
      '<p>after</p>';
    const document = topicDocument(content);

    const { result: topic, reads } = withHtmlWorkBudget(
      depth * 224,
      () => parseRenderedNodeSeekTopicHtml(document, '42'),
      document.root
    );

    expect(reads).toBeLessThan(depth * 224);
    expect(topic?.polls).toEqual([
      {
        id: '7',
        title: 'Systems',
        multiple: true,
        public: true,
        closed: true,
        voted: true,
        options: [
          { id: '71', label: 'First', count: 12, selected: false },
          { id: '72', label: 'Second', count: 5, selected: true }
        ]
      }
    ]);
    expect(topic?.contentHtml).toBe(
      panel === 'distant' ? `<p>before</p>${placeholder}<p>after</p>` : content.replace(pollForm, placeholder)
    );
  });

  it.each(['empty', 'text', 'media'] as const)('clears deep %s shells with bounded work', (content) => {
    const depth = 2048;
    const leaf =
      content === 'text'
        ? '<p>ordinary</p>'
        : content === 'media'
          ? '<p><img src="https://example.com/a.png"></p>'
          : '<p> &nbsp; </p>';
    const html = '<div class="embed-vote vote-panel">'.repeat(depth) + leaf + '</div>'.repeat(depth);
    const root = parseForumContentHtml(html);

    const { reads } = withHtmlWorkBudget(depth * 120, () => normalizeRenderedNodeSeekPollRoot(root, []), root);

    expect(reads).toBeLessThan(depth * 120);
    expect(root.toString()).toBe(content === 'empty' ? '' : html);
  });

  it.each([
    ['form itself', pollForm.replace('vote-form', 'vote-form vote-panel'), placeholder],
    [
      'nearest exact panel',
      `<section class="vote-panel">outer<div class="vote-panel">inner${pollForm}</div>tail</section>`,
      `<section class="vote-panel">outer${placeholder}tail</section>`
    ],
    [
      'similar tokens',
      `<section class="vote-panel-extra vote-panelish">${pollForm}</section>`,
      `<section class="vote-panel-extra vote-panelish">${placeholder}</section>`
    ],
    [
      'case-sensitive class',
      `<section class="VOTE-PANEL">${pollForm}</section>`,
      `<section class="VOTE-PANEL">${placeholder}</section>`
    ],
    ['spaced token', `<section class="outer\tvote-panel\ninner">${pollForm}</section>`, placeholder],
    [
      'form without options',
      '<section class="vote-panel">before<form class="vote-form" data-vote-id="7"><legend>broken</legend></form>after</section>',
      '<section class="vote-panel">beforeafter</section>'
    ]
  ])('replaces the right source range for %s', (_name, content, expected) => {
    const topic = parseRenderedNodeSeekTopicHtml(topicDocument(content), '42');
    expect(topic?.contentHtml).toBe(expected);
  });

  it('leaves forms in place when their panel extends beyond the source content range', () => {
    const document = parseNodeSeekPageDocument(
      `<section class="vote-panel"><h1>Rendered poll</h1><div class="content-item" data-comment-id="1"><article class="post-content">${pollForm}</article></div></section>`
    );
    const topic = parseRenderedNodeSeekTopicHtml(document, '42');
    expect(topic?.contentHtml).toBe(pollForm);
    expect(topic?.polls?.[0].id).toBe('7');
  });

  it.each([
    ['mask before embed', '<div class="embed-vote"><span class="form-mask">temporary</span></div>', ''],
    ['embed preorder', '<div class="embed-vote"><img class="embed-vote"></div>', '<div class="embed-vote"></div>'],
    ['embed before panel', '<div class="embed-vote vote-panel"><input class="embed-vote"></div>', ''],
    ['panel before paragraph', '<p><img class="vote-panel"></p>', ''],
    [
      'split named spelling',
      '<div class="embed-vote"><span>&nb</span><span>sp;</span></div>',
      '<div class="embed-vote"><span>&nb</span><span>sp;</span></div>'
    ],
    [
      'escaped named spelling',
      '<div class="vote-panel"><span>&amp;</span><span>nbsp;</span></div>',
      '<div class="vote-panel"><span>&amp;</span><span>nbsp;</span></div>'
    ],
    [
      'partial entity',
      '<div>&nb<span class="vote-panel">sp;</span></div>',
      '<div>&nb<span class="vote-panel">sp;</span></div>'
    ],
    ['partial numeric whitespace', '<div><span class="embed-vote">&#32</span>;</div>', '<div>;</div>'],
    ['partial legacy whitespace', '<div><span class="embed-vote">&nbsp</span>;</div>', '<div>;</div>'],
    [
      'partial numeric content',
      '<div><span class="embed-vote">&#3</span>2;</div>',
      '<div><span class="embed-vote">&#3</span>2;</div>'
    ],
    [
      'partial twice decoded content',
      '<div><span class="embed-vote">&amp;</span>nbsp;</div>',
      '<div><span class="embed-vote">&amp;</span>nbsp;</div>'
    ]
  ])('preserves %s cleanup semantics', (_name, html, expected) => {
    const root = parseForumContentHtml(html);
    normalizeRenderedNodeSeekPollRoot(root, []);
    expect(root.toString()).toBe(expected);
  });

  it('does not treat protected candidates themselves as content', () => {
    const tags = ['img', 'input', 'video', 'audio', 'table', 'pre', 'code', 'svg', 'canvas', 'textarea', 'select'];
    const root = parseForumContentHtml(tags.map((tag) => `<${tag} class="embed-vote"></${tag}>`).join(''));
    normalizeRenderedNodeSeekPollRoot(root, []);
    expect(root.toString()).toBe('');
  });

  it('preserves content in candidates appended below a line break', () => {
    const root = parseForumContentHtml('<br>');
    const candidate = parseForumContentHtml('<section class="vote-panel">ordinary</section>').firstChild;
    const lineBreak = root.querySelector('br');
    if (!lineBreak || !candidate) throw new Error('Expected a line break and a poll shell fixture');
    lineBreak.appendChild(candidate);

    normalizeRenderedNodeSeekPollRoot(root, []);

    expect(root.querySelectorAll('.vote-panel')).toHaveLength(1);
  });
});

describe('NodeSeek rendered poll work', () => {
  const controls = '<p>before</p><img src="/safe.png"><pre><code>nsapp://vote?id=99</code></pre><p>after</p>';
  const optionForm = (id: string, count: number, wrapping: boolean) =>
    `<form class="vote-form" data-vote-id="${id}"><legend>Question ${id}</legend>` +
    Array.from({ length: count }, (_, index) => {
      const input = `<input type="radio" name="vote-item" id="p${id}o${index}" value="${index}"${index === 1 ? ' checked' : ''}>`;
      const label = `<span>Option ${index}</span><span class="vote-count">${index + 1} 票</span>`;
      return wrapping
        ? `<label for="p${id}o${index}">${input}${label}</label>`
        : `${input}<label for="p${id}o${index}">${label}</label>`;
    }).join('') +
    '公开投票</form>';
  const assertControls = (html: string | undefined) => {
    expect(html).toContain('<p>before</p>');
    expect(html).toContain('<p>after</p>');
    expect(html).toContain('<img src="/safe.png">');
    expect(html).toContain('<pre><code>nsapp://vote?id=99</code></pre>');
  };

  it.each([false, true])('keeps the first split linked id and hidden-id precedence (%s)', (hidden) => {
    const document = topicDocument(
      '<form class="ordinary" id="poll-9">' +
        (hidden ? '<input type="hidden" name="vote_id" value="008">' : '') +
        '<label for="">wrong empty id</label><label><input type="radio" name="other" value="a">A</label>' +
        '<input type="radio" name="other" id="b" value="b"><label for="b">First B</label><label for="b">Second B</label>' +
        'Ns<span>App://Vo</span>Te?Id=<span>001</span>23 nsapp://vote?id=999 ' +
        '<span>不公</span>开 <span>投票</span>关闭 <span>VO</span>TED</form>'
    );
    const topic = parseRenderedNodeSeekTopicHtml(document, '42');

    expect(topic?.polls?.[0]).toMatchObject({
      id: hidden ? '008' : '00123',
      public: false,
      closed: true,
      voted: true,
      options: [
        { id: 'a', label: 'A', selected: false },
        { id: 'b', label: 'First B', selected: false }
      ]
    });
  });

  it.each([false, true])('reads wide option labels once while preserving wrapped-label priority (%s)', (wrapping) => {
    const count = 512;
    const document = topicDocument(controls + optionForm('7', count, wrapping));
    const elementCount = document.root.querySelectorAll('*').length + 1;
    const { result: topic } = measureRenderedPollWork(
      document.root,
      elementCount * 384,
      document.html.length * 24,
      () => parseRenderedNodeSeekTopicHtml(document, '42')
    );

    expect(topic?.polls?.[0].options).toEqual(
      Array.from({ length: count }, (_, index) => ({
        id: String(index),
        label: `Option ${index}`,
        count: index + 1,
        selected: index === 1
      }))
    );
    expect(topic?.polls?.[0].voted).toBe(true);
    assertControls(topic?.contentHtml);
  });

  it.each(['none', 'distant'] as const)('finds the shared %s panel without walking every form ancestor', (panel) => {
    const depth = 512;
    const count = 128;
    const forms = Array.from({ length: count }, (_, index) => optionForm(String(index + 1), 2, false)).join('');
    const nested = '<section>'.repeat(depth) + forms + '</section>'.repeat(depth);
    const content = panel === 'distant' ? `<div class="vote-panel">${nested}</div>` : nested;
    const document = topicDocument(controls + content);
    const elementCount = document.root.querySelectorAll('*').length + 1;
    const { result: topic } = measureRenderedPollWork(document.root, elementCount * 384, Infinity, () =>
      parseRenderedNodeSeekTopicHtml(document, '42')
    );

    expect(topic?.polls?.map((poll) => poll.id)).toEqual(
      Array.from({ length: count }, (_, index) => String(index + 1))
    );
    const placeholders = Array.from(
      { length: count },
      (_, index) => `<forum-nodeseek-poll id="${index + 1}"></forum-nodeseek-poll>`
    ).join('');
    expect(topic?.contentHtml).toBe(
      controls +
        (panel === 'distant'
          ? '<forum-nodeseek-poll id="128"></forum-nodeseek-poll>'
          : '<section>'.repeat(depth) + placeholders + '</section>'.repeat(depth))
    );
  });

  it('replaces many disjoint form ranges with bounded copied text and preserves source order', () => {
    const count = 256;
    const content =
      controls +
      Array.from({ length: count }, (_, index) => optionForm(String(index + 1), 2, false) + `separator${index}`).join(
        ''
      );
    const document = topicDocument(content);
    const { result: topic } = measureRenderedPollWork(document.root, Infinity, document.html.length * 24, () =>
      parseRenderedNodeSeekTopicHtml(document, '42')
    );

    expect(topic?.polls?.map((poll) => poll.id)).toEqual(
      Array.from({ length: count }, (_, index) => String(index + 1))
    );
    expect(topic?.contentHtml).toBe(
      controls +
        Array.from(
          { length: count },
          (_, index) => `<forum-nodeseek-poll id="${index + 1}"></forum-nodeseek-poll>separator${index}`
        ).join('')
    );
  });

  it.each(['form-mask', 'embed-vote', 'vote-panel', 'paragraph'] as const)(
    'removes wide %s shells without repeatedly copying their sibling array',
    (kind) => {
      const count = 1024;
      const shell = kind === 'paragraph' ? '<p>&nbsp;</p>' : `<div class="${kind}">&nbsp;</div>`;
      const root = parseForumContentHtml(shell.repeat(count) + controls);
      const elementCount = root.querySelectorAll('*').length + 1;
      measureRenderedPollWork(root, elementCount * 80, Infinity, () => normalizeRenderedNodeSeekPollRoot(root, []));

      expect(root.toString()).toBe(controls);
    }
  );

  it.each(['ordinary', 'double entity', 'linked state'] as const)(
    'extracts nested %s forms without rescanning shared descendants or complete text',
    (kind) => {
      const depth = 512;
      const prefix = kind === 'double entity' ? '&amp;amp;' : 'ordinary';
      const open = Array.from(
        { length: depth },
        (_, index) =>
          `<form class="vote-form"${kind === 'linked state' ? '' : ` data-vote-id="${index + 1}"`}>${prefix}`
      ).join('');
      const options =
        '<label><input type="radio" name="vote-item" value="a">A</label><label><input type="radio" name="vote-item" value="b">B</label>';
      const state = kind === 'linked state' ? '不公开 已关闭 已选择 nsapp://vote?id=77' : '公开投票';
      const document = topicDocument(controls + open + options + state + '</form>'.repeat(depth));
      const elementCount = document.root.querySelectorAll('*').length + 1;
      const { result: topic } = measureRenderedPollWork(
        document.root,
        elementCount * 384,
        document.html.length * 24,
        () => parseRenderedNodeSeekTopicHtml(document, '42'),
        document.html.length * 16
      );

      expect(topic?.polls).toHaveLength(depth);
      expect(topic?.polls?.map((poll) => poll.id)).toEqual(
        Array.from({ length: depth }, (_, index) => (kind === 'linked state' ? '77' : String(index + 1)))
      );
      expect(
        topic?.polls?.every(
          (poll) => poll.options.length === 2 && poll.options[0].label === 'A' && poll.options[1].label === 'B'
        )
      ).toBe(true);
      expect(topic?.polls?.every((poll) => poll.public === (kind !== 'linked state'))).toBe(true);
      if (kind === 'linked state') expect(topic?.polls?.every((poll) => poll.closed && poll.voted)).toBe(true);
      assertControls(topic?.contentHtml);
    }
  );

  it('reuses deep label and title text shared by nested forms while keeping input selection', () => {
    const count = 256;
    const depth = 512;
    const content =
      Array.from({ length: count }, (_, index) => `<form class="vote-form" data-vote-id="${index + 1}">`).join('') +
      `<legend>${'<span>'.repeat(depth)}Question${'</span>'.repeat(depth)}</legend>` +
      ['a', 'b']
        .map(
          (id) =>
            `<label>${'<span>'.repeat(depth)}<input type="radio" name="vote-item" value="${id}"${id === 'b' ? ' checked' : ''}>${id.toUpperCase()}<span class="vote-count">1 票</span>${'</span>'.repeat(depth)}</label>`
        )
        .join('') +
      '</form>'.repeat(count);
    const document = topicDocument(controls + content);
    const elementCount = document.root.querySelectorAll('*').length + 1;
    const { result: topic } = measureRenderedPollWork(
      document.root,
      elementCount * 384,
      document.html.length * 24,
      () => parseRenderedNodeSeekTopicHtml(document, '42'),
      document.html.length * 16
    );

    expect(topic?.polls).toHaveLength(count);
    expect(topic?.polls?.every((poll) => poll.title === 'Question')).toBe(true);
    expect(topic?.polls?.[0].options).toEqual([
      { id: 'a', label: 'A', count: 1, selected: false },
      { id: 'b', label: 'B', count: 1, selected: true }
    ]);
    assertControls(topic?.contentHtml);
  });
});
