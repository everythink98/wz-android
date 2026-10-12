import { HTMLElement, TextNode } from 'node-html-parser';
import { parseHtml } from '@/domain/forum/html';
import { sanitizeContentHtmlWithRoot } from '@/domain/forum/contentSanitizer';
import { normalizeForumStickerMediaHtml } from '@/domain/forum/forumContentMedia';
import { compileForumContent } from '@/domain/forum/topicContentSplit';
import { markNodeSeekReplyReferenceNodes, normalizeForumUserMentionNodes } from '@/domain/forum/topicContentHtml';
import { parseNodeSeekPageDocument } from '@/sources/nodeseek/protocol';
import { normalizeRenderedNodeSeekPollRoot, parseRenderedNodeSeekTopicHtml } from '@/sources/nodeseek/topicParser';
import { sanitizeLinuxDoContentHtml } from '@/sources/linuxdo/parser';
import { parseYaohuoTopicHtml, parseYaohuoRepliesDocument } from '@/sources/yaohuo/topicParser';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export type ContentWork = {
  layout: string;
  size: number;
  inputChars: number;
  fixtureNodes: number;
  operationMs: number;
  arrayVisits: number;
  arrayCopies: number;
  domReads: number;
  decodedInputChars: number;
  rawTextChars: number;
  serializedChars: number;
  replaceInputChars: number;
  sliceOutputChars: number;
  regexInputWork: number;
  outputVerified: boolean;
  descriptorsRestored: boolean;
};

// Observe native work on real nodes; restore descriptors even if the operation throws.
export function measureContentWork<T>(sample: ContentWork, task: () => T, root?: HTMLElement): T {
  const restores: (() => void)[] = [];
  const known = new WeakSet<object>();
  const proxies = new WeakMap<object, object>();
  const originals = new WeakMap<object, object>();
  let setup = false;
  const define = (target: object, key: string, descriptor: PropertyDescriptor) => {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    check(previous, `Missing native descriptor: ${key}`);
    Object.defineProperty(target, key, descriptor);
    restores.push(() => {
      Object.defineProperty(target, key, previous);
      const current = Object.getOwnPropertyDescriptor(target, key);
      check(
        current?.value === previous.value && current?.get === previous.get && current?.set === previous.set,
        `Descriptor was not restored: ${key}`
      );
    });
  };
  const wrapArray = (value: unknown[]) => {
    const original = (originals.get(value) || value) as unknown[];
    const existing = proxies.get(original);
    if (existing) return existing;
    const proxy = new Proxy(original, {
      get(target, key, receiver) {
        if (!setup && (key === 'length' || (typeof key === 'string' && /^\d+$/.test(key)))) sample.domReads++;
        return Reflect.get(target, key, receiver);
      }
    });
    proxies.set(original, proxy);
    originals.set(proxy, original);
    return proxy;
  };
  const register = (root: HTMLElement) => {
    const previousSetup = setup;
    setup = true;
    try {
      const pending = [root];
      while (pending.length) {
        const node = pending.pop();
        if (!node || known.has(node)) continue;
        known.add(node);
        const children = Object.getOwnPropertyDescriptor(node, 'childNodes')?.value as HTMLElement[] | undefined;
        if (children) for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
        for (const key of ['childNodes', 'parentNode', 'rawTagName']) {
          const descriptor = Object.getOwnPropertyDescriptor(node, key);
          if (!descriptor || !('value' in descriptor) || !descriptor.configurable) continue;
          const restored = { ...descriptor };
          define(node, key, {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            get() {
              if (!setup) sample.domReads++;
              return key === 'childNodes' ? wrapArray(descriptor.value) : descriptor.value;
            },
            set(value: unknown) {
              descriptor.value = typeof value === 'object' && value ? originals.get(value) || value : value;
              restored.value = descriptor.value;
              if (key === 'childNodes') for (const child of descriptor.value as HTMLElement[]) register(child);
            }
          });
          // Instance setters must retain the operation's new value when instrumentation is removed.
          restores.pop();
          restores.push(() => Object.defineProperty(node, key, restored));
        }
      }
    } finally {
      setup = previousSetup;
    }
  };
  let started: number | undefined;
  let testing = false;
  const regexBudget =
    (sample.inputChars + sample.fixtureNodes) * 256 * (1 + Math.ceil(Math.log2(sample.inputChars + 1))) + 10_000;
  try {
    for (const key of ['querySelector', 'querySelectorAll', 'closest', 'getAttribute']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
      check(descriptor?.value, `Missing selector: ${key}`);
      define(HTMLElement.prototype, key, {
        ...descriptor,
        value: function (this: HTMLElement, ...args: unknown[]) {
          register(this);
          if (!setup && key === 'getAttribute') sample.domReads++;
          return Reflect.apply(descriptor.value, this, args);
        }
      });
    }
    for (const [key, counter] of [
      ['rawText', 'rawTextChars'],
      ['innerHTML', 'serializedChars']
    ] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
      check(descriptor?.get, `Missing text getter: ${key}`);
      define(HTMLElement.prototype, key, {
        ...descriptor,
        get: function (this: HTMLElement) {
          const result = descriptor.get?.call(this) as string;
          if (!setup) sample[counter] += result.length;
          return result;
        }
      });
    }
    const textDescriptor = Object.getOwnPropertyDescriptor(TextNode.prototype, 'text');
    check(textDescriptor?.get, 'Missing native text decoder');
    define(TextNode.prototype, 'text', {
      ...textDescriptor,
      get: function (this: TextNode) {
        if (!setup) sample.decodedInputChars += this.rawText.length;
        return textDescriptor.get?.call(this);
      }
    });
    const nativeExec = RegExp.prototype.exec;
    const nativeTest = RegExp.prototype.test;
    for (const key of ['exec', 'test']) {
      const descriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, key);
      check(descriptor?.value, `Missing regex method: ${key}`);
      define(RegExp.prototype, key, {
        ...descriptor,
        value: function (this: RegExp, input: string) {
          if (testing) return Reflect.apply(descriptor.value, this, [input]);
          const cursor = this.global || this.sticky ? this.lastIndex : 0;
          testing = key === 'test';
          try {
            const result = key === 'exec' ? nativeExec.call(this, input) : nativeTest.call(this, input);
            if (!setup) {
              // Cursor spans estimate input work, not engine instructions or backtracking.
              sample.regexInputWork += Math.max(
                1,
                typeof input !== 'string'
                  ? 0
                  : key === 'exec' && (this.global || this.sticky)
                    ? (result && typeof result !== 'boolean' ? result.index + result[0].length : input.length) - cursor
                    : input.length
              );
              check(sample.regexInputWork <= regexBudget, 'Repeated regex scans exceeded input budget');
            }
            return result;
          } finally {
            testing = false;
          }
        }
      });
    }
    for (const key of ['filter', 'map', 'find', 'findIndex', 'some', 'every', 'flatMap']) {
      const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, key);
      check(descriptor?.value, `Missing array method: ${key}`);
      define(Array.prototype, key, {
        ...descriptor,
        value: function (this: unknown[], callback: (...args: unknown[]) => unknown, receiver?: unknown) {
          const result = Reflect.apply(descriptor.value, this, [
            function (...args: unknown[]) {
              if (!setup) sample.arrayVisits++;
              return Reflect.apply(callback, receiver, args);
            },
            receiver
          ]);
          if (!setup && Array.isArray(result)) sample.arrayCopies += result.length;
          return result;
        }
      });
    }
    for (const key of ['slice', 'flat']) {
      const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, key);
      check(descriptor?.value, `Missing array method: ${key}`);
      define(Array.prototype, key, {
        ...descriptor,
        value: function (this: unknown[], ...args: unknown[]) {
          const result = Reflect.apply(descriptor.value, this, args) as unknown[];
          if (!setup) sample.arrayCopies += result.length;
          return result;
        }
      });
    }
    for (const [key, counter] of [
      ['replace', 'replaceInputChars'],
      ['slice', 'sliceOutputChars']
    ] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(String.prototype, key);
      check(descriptor?.value, `Missing string method: ${key}`);
      define(String.prototype, key, {
        ...descriptor,
        value: function (this: string, ...args: unknown[]) {
          const result = Reflect.apply(descriptor.value, this, args) as string;
          if (!setup) sample[counter] += key === 'replace' ? this.length : result.length;
          return result;
        }
      });
    }
    if (root) register(root);
    started = performance.now();
    return task();
  } finally {
    setup = true;
    for (let i = restores.length - 1; i >= 0; i--) restores[i]();
    sample.operationMs = started === undefined ? 0 : performance.now() - started;
    sample.descriptorsRestored = true;
  }
}

export function createContentWorkSample(
  layout: string,
  size: number,
  html: string,
  root = parseHtml(html)
): ContentWork {
  return {
    layout,
    size,
    inputChars: html.length,
    fixtureNodes: root.querySelectorAll('*').length + 1,
    operationMs: 0,
    arrayVisits: 0,
    arrayCopies: 0,
    domReads: 0,
    decodedInputChars: 0,
    rawTextChars: 0,
    serializedChars: 0,
    replaceInputChars: 0,
    sliceOutputChars: 0,
    regexInputWork: 0,
    outputVerified: false,
    descriptorsRestored: false
  };
}

const page = (body: string) =>
  '<title>Poll audit</title><a class="post-title" href="/post-42-1">Poll audit</a>' +
  '<div class="content-item" data-comment-id="1"><a href="/space/1">alice</a><article class="post-content">before' +
  body +
  'after<img src="/safe.png"><pre><code>nsapp://vote?id=99</code></pre></article></div>';
const form = (id: string, options = 2) =>
  `<form class="vote-form" data-vote-id="${id}"><legend>Question ${id}</legend>` +
  Array.from(
    { length: options },
    (_, i) =>
      `<input type="radio" name="vote-item" id="p${id}o${i}" value="${i}">` +
      `<label for="p${id}o${i}"><span class="vote-item-text">Option ${i}</span></label>`
  ).join('') +
  '公开投票</form>';
const yaohuoBase = '<title>sample</title><section><div class="bbscontent">ordinary body</div></section>';
const yaohuoVote =
  '<div class="vote-container"><div class="vote-option-row"><button class="vote-button" data-id="42" data-vid="1"></button><span class="vote-option-text">A</span></div></div>';
type Case = {
  layout: string;
  fixture: (n: number) => string;
  execute: (html: string) => unknown;
  verify: (output: unknown, n: number) => void;
  compiler?: boolean;
};
const stringOutput = (output: unknown) => {
  check(typeof output === 'string', 'Expected HTML output');
  return output;
};
const sanitize = (html: string) => sanitizeContentHtmlWithRoot(html, 'https://www.nodeseek.com').contentHtml;
const references = (html: string) => {
  const root = parseHtml(html);
  normalizeForumUserMentionNodes(root);
  markNodeSeekReplyReferenceNodes(root, 'https://www.nodeseek.com');
  return root.innerHTML;
};
const kept = (output: unknown) => check(stringOutput(output).includes('keep'), 'Surrounding body was lost');
const cases: Case[] = [
  ...[
    ['wide-hidden', '<div hidden>drop</div>'],
    ['wide-script', '<script>drop</script>'],
    ['wide-iframe', '<iframe src="javascript:alert(1)"></iframe>'],
    ['wide-image-metadata', '<div class="meta">12×34 1 KB</div>']
  ].map(([layout, fragment]) => ({
    layout,
    fixture: (n: number) => `<section>${fragment.repeat(n)}<p>keep</p></section>`,
    execute: sanitize,
    verify: (output: unknown) => check(output === '<section><p>keep</p></section>', 'Wide cleanup changed body')
  })),
  ...[
    ['wide-cloudflare', '<span class="__cf_email__" data-cfemail="026342602c616d6f">hidden</span>', 'a@b.com'],
    ['wide-video', '<video src="https://cdn.example/video.mp4"></video>', '<forum-video'],
    ['wide-audio', '<audio src="https://cdn.example/audio.mp3"></audio>', '<forum-audio'],
    [
      'wide-onebox',
      '<aside class="onebox" data-onebox-src="https://example.com/card"><h3><a href="https://example.com/card">Card</a></h3><p>Description</p></aside>',
      '<forum-link-card'
    ],
    [
      'wide-magic-tabs',
      '<div class="nsk-magic-tabs"><div class="nsk-magic-tab-title">Report</div><div class="nsk-magic-tab-body"><pre>output</pre></div></div>',
      'output'
    ],
    ['wide-ansi-reports', '<section><p>💻 CPU</p><code class="language-ansi">output</code></section>', 'output']
  ].map(([layout, fragment, required]) => ({
    layout,
    fixture: (n: number) => '<section>' + fragment.repeat(n) + '<p>keep</p></section>',
    execute: sanitize,
    verify: (output: unknown) => {
      kept(output);
      check(stringOutput(output).includes(required), `${layout}: replacement lost`);
    }
  })),
  {
    layout: 'wide-sticker',
    fixture: (n) =>
      '<section>' +
      '<p><img class="sticker" src="https://www.nodeseek.com/static/image/sticker/1.png"></p>'.repeat(n) +
      '<p>keep</p></section>',
    execute: (html) => normalizeForumStickerMediaHtml(html),
    verify: (output, n) => {
      kept(output);
      check((stringOutput(output).match(/<forum-sticker(?:\s|>)/g) || []).length === n, 'Sticker count changed');
    }
  },
  {
    layout: 'wide-references',
    fixture: (n) =>
      '<section>' +
      '<p><a href="/member?t=alice">@alice</a> <a href="/post-2-1#3">#3</a> tail</p>'.repeat(n) +
      '</section>',
    execute: references,
    verify: (output, n) =>
      check((stringOutput(output).match(/<forum-reply-reference/g) || []).length === n, 'Reply references changed')
  },
  {
    layout: 'deep-unrelated-links',
    fixture: (n) => '<a href="https://example.com">x'.repeat(n) + '</a>'.repeat(n),
    execute: references,
    verify: (output, n) =>
      check(
        stringOutput(output) === '<a href="https://example.com">x'.repeat(n) + '</a>'.repeat(n),
        'Ordinary links changed'
      )
  },
  ...[
    ['deep-member-links', '/member?t=alice'],
    ['deep-floor-links', '/post-2-1#3']
  ].map(([layout, href]) => ({
    layout,
    fixture: (n: number) => `<a href="${href}">x`.repeat(n) + 'last' + '</a>'.repeat(n),
    execute: references,
    verify: (output: unknown, n: number) =>
      check(output === `<a href="${href}">x`.repeat(n) + 'last' + '</a>'.repeat(n), 'Ordinary reference labels changed')
  })),
  ...['span', 'div'].map((tag) => ({
    layout: `compiler-${tag}`,
    compiler: true,
    fixture: (n: number) => `<${tag}>x`.repeat(n) + 'last' + `</${tag}>`.repeat(n),
    execute: (html: string) => compileForumContent({ html, role: 'opening', source: 'nodeseek' }),
    verify: (output: unknown, n: number) => {
      const plan = output as ReturnType<typeof compileForumContent>;
      const text = plan.rows
        .flatMap((row) =>
          (JSON.parse(row.selectionToken) as { owners: { text: string }[] }).owners.map((owner) => owner.text)
        )
        .join('');
      check(text.replace(/\s/g, '').includes('x'.repeat(n) + 'last'), 'Compiler changed copied body');
    }
  })),
  ...['wide-options', 'many-forms', 'deep-many-forms', 'nested-forms'].map((layout) => ({
    layout,
    fixture: (n: number) =>
      page(
        layout === 'wide-options'
          ? form('7', n)
          : layout === 'nested-forms'
            ? '<pre><code>safe code</code></pre>' +
              Array.from({ length: n }, (_, i) => `<form class="vote-form" data-vote-id="${i + 1}">`).join('') +
              '<label><input type="radio" name="vote-item" value="a">A</label><label><input type="radio" name="vote-item" value="b">B</label>' +
              '</form>'.repeat(n)
            : (layout === 'deep-many-forms' ? '<section>'.repeat(n) : '') +
              Array.from({ length: n }, (_, i) => form(String(i + 1))).join('') +
              (layout === 'deep-many-forms' ? '</section>'.repeat(n) : '')
      ),
    execute: (html: string) => parseRenderedNodeSeekTopicHtml(parseNodeSeekPageDocument(html), '42'),
    verify: (output: unknown, n: number) => {
      const topic = output as ReturnType<typeof parseRenderedNodeSeekTopicHtml>;
      check(topic?.polls?.length === (layout === 'wide-options' ? 1 : n), 'Poll count changed');
      check(topic.polls[0].options.length === (layout === 'wide-options' ? n : 2), 'Poll options changed');
      check(
        topic.contentHtml.includes('before') &&
          topic.contentHtml.includes(
            layout === 'nested-forms'
              ? '<pre><code>safe code</code></pre>'
              : '<pre><code>nsapp://vote?id=99</code></pre>'
          ),
        'Poll cleanup damaged code/body'
      );
    }
  })),
  ...['form-mask', 'vote-panel', 'p'].map((tag) => ({
    layout: `wide-shell-${tag}`,
    fixture: (n: number) =>
      '<section>' + (tag === 'p' ? '<p></p>' : `<div class="${tag}"></div>`).repeat(n) + '<p>keep</p></section>',
    execute: (html: string) => {
      const root = parseHtml(html);
      normalizeRenderedNodeSeekPollRoot(root, []);
      return root.innerHTML;
    },
    verify: kept
  })),
  {
    layout: 'nodeseek-nested-replies',
    fixture: (n) =>
      '<h1>Audit</h1><div class="content-item"><article class="post-content">主楼</article></div>' +
      '<div class="comment-item" data-comment-id="2">'.repeat(n) +
      '<div class="comment-content">回复</div><time datetime="2026-10-11T00:00:00Z"></time>' +
      '</div>'.repeat(n),
    execute: (html) => parseRenderedNodeSeekTopicHtml(parseNodeSeekPageDocument(html), '42'),
    verify: (output) => {
      const topic = output as ReturnType<typeof parseRenderedNodeSeekTopicHtml>;
      check(
        topic?.contentHtml === '主楼' &&
          topic.replies?.length === 30 &&
          topic.replies.every((reply) => reply.contentHtml === '回复' && reply.commentId === 2),
        'Nested reply output changed'
      );
      check(
        topic.replyHasMore === true &&
          topic.replyNextPage === 1 &&
          topic.replyNextOffset === 30 &&
          topic.lastReplyAt === '2026-10-11T00:00:00.000Z',
        'Nested reply pagination metadata changed'
      );
    }
  },
  {
    layout: 'linuxdo-nested-math',
    fixture: (n) => '<div class="math">'.repeat(n) + 'x &amp; y' + '</div>'.repeat(n),
    execute: (html) => sanitizeLinuxDoContentHtml(html, []),
    verify: (output) => check(stringOutput(output).includes('forum-math-block'), 'Math body lost')
  },
  {
    layout: 'linuxdo-wide-math',
    fixture: (n) => '<span class="math">x</span>'.repeat(n),
    execute: (html) => sanitizeLinuxDoContentHtml(html, []),
    verify: (output, n) =>
      check((stringOutput(output).match(/<forum-math-inline/g) || []).length === n, 'Math count changed')
  },
  {
    layout: 'discourse-deep-callout',
    fixture: (n) =>
      '<blockquote><p>[!warning] before ' +
      '<span>'.repeat(n) +
      'Title\nBody' +
      '</span>'.repeat(n) +
      ' after</p><p>Tail</p></blockquote>',
    execute: (html) => sanitizeLinuxDoContentHtml(html, []),
    verify: (output) =>
      check(stringOutput(output).includes('Tail') && stringOutput(output).includes('Body'), 'Callout body lost')
  },
  {
    layout: 'discourse-deep-wide-callouts',
    fixture: (n) =>
      '<span>'.repeat(n) + '<blockquote><p>[!note]Title</p><p>Body</p></blockquote>'.repeat(n) + '</span>'.repeat(n),
    execute: (html) => sanitizeLinuxDoContentHtml(html, []),
    verify: (output, n) => {
      const root = parseHtml(stringOutput(output));
      check(root.querySelectorAll('[data-forum-callout-type="note"]').length === n, 'Callout count changed');
      check(root.textContent === 'TitleBody'.repeat(n), 'Callout text changed');
      check(root.querySelectorAll('span').length === n, 'Ordinary ancestors lost');
    }
  },
  {
    layout: 'linuxdo-nested-policy',
    fixture: (n) => '<div class="policy">'.repeat(n) + 'ordinary' + '</div>'.repeat(n),
    execute: (html) => sanitizeLinuxDoContentHtml(html, []),
    verify: (output) => check(stringOutput(output).includes('ordinary'), 'Policy body lost')
  },
  {
    layout: 'linuxdo-wide-loaded-polls',
    fixture: (n) => '<div class="poll" data-poll-name="a">A</div>'.repeat(n),
    execute: (html) =>
      sanitizeLinuxDoContentHtml(html, [{ id: 'a', name: 'a', title: 'poll', options: [{ id: '1', label: 'A' }] }]),
    verify: (output, n) =>
      check((stringOutput(output).match(/<forum-discourse-poll/g) || []).length === n, 'Loaded polls changed')
  },
  ...['ordinary', 'vote', 'floor'].map((kind) => ({
    layout: `yaohuo-deep-outside-${kind}`,
    fixture: (n: number) =>
      yaohuoBase +
      '<section>' +
      '<div>'.repeat(n) +
      (kind === 'ordinary'
        ? 'ordinary other'
        : kind === 'vote'
          ? yaohuoVote
          : '<a href="/bbs/book_re.aspx?id=42&amp;tofloor=12">12楼</a>') +
      '</div>'.repeat(n) +
      '</section>',
    execute: (html: string) => parseYaohuoTopicHtml(html, { id: '42' }),
    verify: (output: unknown) => {
      const topic = output as ReturnType<typeof parseYaohuoTopicHtml>;
      check(topic?.contentHtml.includes('ordinary body'), 'Fallback body changed');
    }
  })),
  {
    layout: 'yaohuo-wide-attachments',
    fixture: (n) =>
      '<title>sample</title><div class="bbscontent">before' +
      '<div class="attachment"><a href="/bbs/download.aspx?id=1">download</a></div>'.repeat(n) +
      'after</div>',
    execute: (html) => parseYaohuoTopicHtml(html, { id: '42' }),
    verify: (output, n) => {
      const topic = output as ReturnType<typeof parseYaohuoTopicHtml>;
      check(
        topic?.contentHtml.includes('before') &&
          topic.contentHtml.includes('after') &&
          (topic.contentHtml.match(/download\.aspx/g) || []).length === n,
        'Adjacent attachments lost'
      );
    }
  },
  ...['wide', 'nested'].map((kind) => ({
    layout: `yaohuo-${kind}-loaded-poll-copies`,
    fixture: (n: number) =>
      '<title>sample</title><section><div class="bbscontent">body' +
      (kind === 'wide'
        ? yaohuoVote.repeat(n)
        : '<div class="vote-container">'.repeat(n) + 'ordinary body' + '</div>'.repeat(n)) +
      '</div></section>' +
      yaohuoVote,
    execute: (html: string) => parseYaohuoTopicHtml(html, { id: '42' }),
    verify: (output: unknown, n: number) => {
      const topic = output as ReturnType<typeof parseYaohuoTopicHtml>;
      check(topic?.polls?.length === 1, 'Loaded poll copies changed the poll count');
      check(
        topic.polls[0].options[0].id === '1' &&
          topic.polls[0].options[0].label === 'A' &&
          topic.polls[0].options[0].selected === false,
        'Loaded poll option changed'
      );
      if (kind === 'wide') check(topic.contentHtml === 'body', 'Loaded poll copies remain in the body');
      else {
        const root = parseHtml(topic.contentHtml);
        check(root.textContent === 'bodyordinary body', 'Nonmatching poll containers lost text');
        check(root.querySelectorAll('div.vote-container').length === n, 'Nonmatching containers removed');
      }
    }
  })),
  {
    layout: 'yaohuo-deep-reply',
    fixture: (n) =>
      '<div class="line1"><span class="floornumber0">1楼</span><div class="retext">' +
      '<span>'.repeat(n) +
      'body' +
      '</span>'.repeat(n) +
      '</div></div>',
    execute: (html) => parseYaohuoRepliesDocument(parseHtml(html)),
    verify: (output) => {
      const replies = output as ReturnType<typeof parseYaohuoRepliesDocument>;
      check(replies.items.length === 1 && replies.items[0].contentHtml.includes('body'), 'Reply body lost');
    }
  },
  {
    layout: 'selector-scoped-descendants',
    fixture: (n) => '<section class="scope">' + '<div>'.repeat(n) + 'keep' + '</div>'.repeat(n) + '</section>',
    execute: (html) => {
      const root = parseHtml(html);
      const scope = root.querySelector('.scope');
      check(scope, 'Scope absent');
      const a = scope.querySelectorAll('div').length;
      const b = scope.querySelectorAll('*').length;
      const added = parseHtml('<span>added</span>').firstChild;
      check(added, 'Added node absent');
      scope.appendChild(added);
      const c = scope.querySelectorAll('span').length;
      return [a, b, c];
    },
    verify: (output, n) =>
      check(JSON.stringify(output) === JSON.stringify([n, n, 1]), 'Scoped selector or fresh query changed')
  }
];

export async function verifyContentChain(
  run: (name: string, task: () => Promise<void>, metrics?: Record<string, unknown>) => Promise<void>
) {
  const metrics = {
    workInstrumentation: 'native-array+native-string+real-DOM+decoder-input',
    samples: [] as ContentWork[],
    codeCopiesVerified: 0
  };
  await run(
    'content-hermes-body-poll-chain-audit',
    async () => {
      check('HermesInternal' in globalThis, 'Body/poll chain proof requires Hermes');
      for (const fixture of cases)
        for (const size of fixture.compiler ? [2048, 16_384] : [512, 4096]) {
          const html = fixture.fixture(size);
          const sample = createContentWorkSample(fixture.layout, size, html);
          const { fixtureNodes } = sample;
          metrics.samples.push(sample);
          const output = measureContentWork(sample, () => fixture.execute(html));
          fixture.verify(output, size);
          sample.outputVerified = true;
          check(
            sample.arrayVisits + sample.arrayCopies <= fixtureNodes * 512 + 10_000,
            `${fixture.layout}: repeated array scans/copies`
          );
          check(sample.domReads <= fixtureNodes * 1024 + 10_000, `${fixture.layout}: repeated DOM traversal`);
          check(
            sample.decodedInputChars + sample.rawTextChars <= html.length * 64 + 10_000,
            `${fixture.layout}: repeated decoding/text reads`
          );
          check(sample.serializedChars <= html.length * 64 + 10_000, `${fixture.layout}: repeated serialization`);
          check(sample.replaceInputChars <= html.length * 128 + 10_000, `${fixture.layout}: repeated normalization`);
          check(sample.sliceOutputChars <= html.length * 64 + 10_000, `${fixture.layout}: repeated HTML slicing`);
        }
      for (const role of ['opening', 'reply'] as const)
        for (const prefix of [
          '<a href="/member?t=alice">@alice</a> <a href="/post-2-1#3">#3</a>',
          '<img class="sticker" src="https://www.nodeseek.com/static/image/sticker/1.png">'
        ]) {
          const plan = compileForumContent({
            role,
            source: 'nodeseek',
            html: `<p>${prefix} <pre><code>&lt;safe&gt;\ncode</code></pre></p>`
          });
          const code = plan.rows.find((row) => row.type === 'codeBlock');
          check(
            code?.type === 'codeBlock' && code.copyText === '<safe>\ncode',
            'Replacement changed native code parser mode'
          );
          metrics.codeCopiesVerified++;
          const literalPlan = compileForumContent({
            role,
            source: 'nodeseek',
            html: `<p>${prefix} <pre><code>&amp;lt;safe&amp;gt;\n&am<span>p;#32;</span></code></pre></p>`
          });
          const literalCode = literalPlan.rows.find((row) => row.type === 'codeBlock');
          check(
            literalCode?.type === 'codeBlock' && literalCode.copyText === '&lt;safe&gt;\n&amp;#32;',
            'Code copy re-decoded literal entity text'
          );
          metrics.codeCopiesVerified++;
        }
    },
    metrics
  );
}
