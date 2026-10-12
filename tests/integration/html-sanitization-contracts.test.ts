import { describe, expect, it, vi } from 'vitest';

import { decodeHtml, parseHtml, textContentFromHtml } from '@/domain/forum/html';
import { sanitizeContentHtml, sanitizeContentHtmlWithRoot } from '@/domain/forum/contentSanitizer';
import { sanitizeLinuxDoContentHtml } from '@/sources/linuxdo/parser';
import { withHtmlDecodedInputBudget, withHtmlWorkBudget } from '../helpers/htmlWorkBudget';

describe('Android local HTML helpers', () => {
  it.each([
    ['decimal once', '&#', '32'],
    ['hexadecimal twice', '&amp;#x', '20']
  ])('sanitizes long %s entities across metadata boundaries with bounded decoding', (_name, prefix, value) => {
    const depth = 1024;
    const nested = (leaf: string) =>
      '<div class="meta">' +
      prefix +
      '0<div class="meta">'.repeat(depth) +
      value +
      ';12×34 1 KB' +
      leaf +
      '</div>'.repeat(depth + 1);
    const protectedContent = nested('<img src="https://example.com/proof.png">ordinary body');
    const html = nested('') + protectedContent + '<p>ordinary body</p>';

    const { result, units } = withHtmlDecodedInputBudget(depth * 128, () =>
      sanitizeContentHtml(html, 'https://example.com/')
    );

    expect(units).toBeLessThanOrEqual(depth * 128);
    expect(result).toBe(protectedContent + '<p>ordinary body</p>');
  });

  it.each(['ordinary', 'image-protected', 'distinct-meta-text', 'dimension-only', 'file-size-only'] as const)(
    'preserves deep %s div content with bounded image metadata work',
    (kind) => {
      const depth = 1024;
      const opening = kind === 'ordinary' ? '<div>' : '<div class="meta">';
      const leaf =
        kind === 'image-protected'
          ? '图片1920×1080 210 KB<img src="https://example.com/proof.png">'
          : kind === 'dimension-only'
            ? '1920×1080'
            : kind === 'file-size-only'
              ? '210 KB'
              : 'ordinary body';
      const html =
        (opening + (['distinct-meta-text', 'dimension-only', 'file-size-only'].includes(kind) ? 'x ' : '')).repeat(
          depth
        ) +
        leaf +
        '</div>'.repeat(depth);
      const budget = depth * 80;
      const { result: contentHtml, reads } = withHtmlWorkBudget(budget, () =>
        sanitizeContentHtml(html, 'https://example.com/')
      );

      expect(contentHtml).toBe(html);
      expect(reads).toBeLessThanOrEqual(budget);
    }
  );

  it.each([
    ['12×34<span>x</span> 1 KB', true, false],
    ['12×34 1<span> KB</span><span>x</span>', true, false],
    ['12×34 a123 KB', true, false],
    ['12345×12345 1 KB', true, true],
    ['123456×12345 1 KB', true, true],
    ['12345×123456 1 KB', true, false],
    ['image123456×12345 1 KB', false, false],
    ['image12345×12345 1 KB', false, true],
    ['图<span>片</span>6<span>00</span>×4<span>00</span> 1.5<span> M</span>B', false, true],
    ['&#49;&#50;×&#51;&#52; 1 KB', true, true],
    ['&amp;#49;&amp;#50;×&amp;#51;&amp;#52; 1 KB', true, false],
    ['&am<span>p;#49;</span>&amp;#50;×&amp;#51;&amp;#52; 1 KB', true, false],
    ['&amp;#<span>49;</span>&amp;#50;×&amp;#51;&amp;#52; 1 KB', true, false],
    [' \t<span>image</span> 12<br>×34 &amp;nbsp;1 KB ', false, true],
    ['12×34 1 KB<img src="https://example.com/proof.png">', true, false]
  ] as const)('retains image metadata matching boundaries for %s', (body, meta, removed) => {
    const html = `<div id="candidate"${meta ? ' class="meta"' : ''}>${body}</div>`;
    const result = sanitizeContentHtml(html, 'https://example.com/');

    expect(result.includes('id="candidate"')).toBe(!removed);
    if (!removed) expect(result).toBe(html);
  });

  it('decodes candidate entity fragments independently from neighboring content', () => {
    const result = sanitizeContentHtml(
      '&amp;<div id="candidate" class="meta">#49;2×34 1 KB</div>' +
        '<div id="removed" class="meta">&#00000000000000000000000049;2×34 1 KB</div>',
      'https://example.com/'
    );

    expect(result).toBe('&amp;<div id="candidate" class="meta">#49;2×34 1 KB</div>');
  });

  it('removes metadata appended below a void element by a root transform', () => {
    const { root } = sanitizeContentHtmlWithRoot('<div>ordinary body</div><br>', 'https://example.com/', (parsed) => {
      const child = parseHtml('<div id="candidate" class="meta">12×34 1 KB</div>').firstChild;
      if (child) parsed.querySelector('br')?.appendChild(child);
    });

    expect(root.querySelector('#candidate')).toBeNull();
    expect(root.text).toBe('ordinary body\n');
  });

  it.each([4096, 8192])('sanitizes %i nested wrappers without losing safe leaf content', (depth) => {
    const leaf =
      '<section id="safe-body"><P id="literal" data-label="&quot; &amp; &lt; &gt;" OnCliCk="danger()">before &amp; &lt;literal&gt; &#x1F600;</P>' +
      '<!--comment sentinel--><BR><IMG id="safe-image" SRC="/proof.png" OnErRoR="danger()">' +
      '<a id="unsafe-link" href="javascript:alert(1)" onclick="bad()">unsafe link</a>' +
      '<a id="safe-link" href="/safe?q=1&amp;x=2">safe link</a><script>bad()</script><p>after</p></section>';
    const baseUrl = 'https://example.com/base/';
    const shallow = sanitizeContentHtml(leaf, baseUrl);
    const result = sanitizeContentHtml(`${'<DIV>'.repeat(depth)}${leaf}${'</DIV>'.repeat(depth)}`, baseUrl);

    expect(result).toContain(shallow);
    expect(textContentFromHtml(result)).toBe('before & <literal> 😀 unsafe link safe link after');
    expect(result).toContain('SRC="https://example.com/proof.png"');
    expect(result).toContain('href="https://example.com/safe?q=1&x=2"');
    expect(result).toContain('data-label="&quot; &amp; &lt; &gt;"');
    expect(result).not.toMatch(/onclick|onerror|javascript:|<script|comment sentinel/i);
    expect(result).not.toMatch(/<\/(?:BR|IMG)>/i);
  });

  it('flattens deeply nested xterm wrappers while preserving terminal text and styles', () => {
    const leaf =
      '<span class="xterm-fg-46 xterm-bg-18">colored &lt;safe&gt; &amp; &quot;quote&quot;</span>' +
      '<span style="color: #ff0000"><span style="background-color: #ff00ff"></span></span>';
    const report = (depth: number) =>
      '<div class="nsk-magic-tabs"><div class="nsk-magic-tab-title">Report</div><div class="nsk-magic-tab-body">' +
      '<div class="terminal-container"><div class="xterm-rows"><div class="xterm-row">' +
      'before <span style="color: rgb(34, 211, 238)">' +
      '<span>'.repeat(depth) +
      leaf +
      '</span>'.repeat(depth) +
      '</span> after</div><div class="xterm-row">second line</div></div></div></div></div>';
    const baseUrl = 'https://www.nodeseek.com/';
    const shallow = sanitizeContentHtml(report(0), baseUrl);
    const result = sanitizeContentHtml(report(8192), baseUrl);

    expect(result).toBe(shallow);
    expect(result).toContain('<forum-terminal-tab title="Report">');
    expect(textContentFromHtml(result)).toBe('before colored <safe> & "quote" after second line');
    expect(
      parseHtml(result)
        .querySelectorAll('span')
        .map((node) => node.getAttribute('style'))
    ).toEqual(['color: rgb(34, 211, 238)', 'color: #00ff00; background-color: #000087']);
  });

  it('extracts visible text without script or style contents', () => {
    expect(textContentFromHtml('<style>.x{color:red}</style><p>A&nbsp;B<br>C</p><script>alert(1)</script>')).toBe(
      'A B C'
    );
  });

  it('does not leak quoted HTML attributes into visible text', () => {
    expect(textContentFromHtml('<p>正文<img alt="1 > 0" src="photo.png"></p><p>结尾</p>')).toBe('正文 结尾');
  });

  it('removes unsafe link and media protocols from sanitized content', () => {
    const result = sanitizeContentHtml(
      `
      <a href="javascript:alert(1)">js</a>
      <a href="data:text/html,<script>alert(1)</script>">data</a>
      <a href="vbscript:msgbox(1)">vb</a>
      <img src="data:text/html,hello">
      <img src="vbscript:msgbox(1)">
      <forum-video-sticker src="javascript:alert(1)" data-fallback-src="vbscript:msgbox(1)"></forum-video-sticker>
    `,
      'https://example.com/base/'
    );

    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('data:text/html');
    expect(result).not.toContain('vbscript:');
    expect(result).not.toContain('href=');
    expect(result).not.toContain('src=');
    expect(result).not.toContain('data-fallback-src=');
  });

  it('keeps allowed sanitized links and converts relative URLs', () => {
    const result = sanitizeContentHtml(
      `
      <a href="/topic/1">topic</a>
      <a href="mailto:user@example.com">mail</a>
      <img src="images/a.png">
      <img src="//cdn.example.com/a.png">
    `,
      'https://example.com/base/'
    );

    expect(result).toContain('href="https://example.com/topic/1"');
    expect(result).toContain('href="mailto:user@example.com"');
    expect(result).toContain('src="https://example.com/base/images/a.png"');
    expect(result).toContain('src="https://cdn.example.com/a.png"');
  });

  it('restores protected email text and mail links while preserving their labels', () => {
    const encoded = '4230272326273002273a232f322e276c212d2f';
    const result = sanitizeContentHtml(
      `<p>写给 <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encoded}">[email&nbsp;protected]</a></p>
       <p><span class="__cf_email__" data-cfemail="42aaedf9aac2c702273a232f322e276c212d2f">[email&nbsp;protected]</span></p>
       <a href="/cdn-cgi/l/email-protection#${encoded}"><strong>写信</strong></a>
       <a href="https://example.com/cdn-cgi/l/email-protection#${encoded}"><span class="__cf_email__" data-cfemail="${encoded}">[email&nbsp;protected]</span></a>`,
      'https://example.com/'
    );
    const root = parseHtml(result);

    expect(root.querySelectorAll('p').map((node) => node.text)).toEqual([
      '写给 reader@example.com',
      '读者@example.com'
    ]);
    expect(root.querySelectorAll('a').map((node) => ({ href: node.getAttribute('href'), text: node.text }))).toEqual([
      { href: 'mailto:reader@example.com', text: '写信' },
      { href: 'mailto:reader@example.com', text: 'reader@example.com' }
    ]);
    expect(result).not.toMatch(/data-cfemail|email-protection|__cf_email__/);
    expect(sanitizeContentHtml(result, 'https://example.com/')).toBe(result);
  });

  it('keeps malformed email protection readable and ignores unrelated markers and links', () => {
    const malformed = ['invalid', '42', '423', '42ff'];
    const result = sanitizeContentHtml(
      malformed
        .map((encoded) => `<span class="__cf_email__" data-cfemail="${encoded}">[email protected]</span>`)
        .join('') +
        '<span data-cfemail="4230272326273002273a232f322e276c212d2f">ordinary</span>' +
        '<a href="https://example.com/guide?next=/cdn-cgi/l/email-protection#4230272326273002273a232f322e276c212d2f">guide</a>' +
        '<a href="javascript:/cdn-cgi/l/email-protection#4230272326273002273a232f322e276c212d2f">unsafe</a>',
      'https://example.com/'
    );
    const root = parseHtml(result);

    expect(root.querySelectorAll('.__cf_email__').map((node) => node.text)).toEqual(
      malformed.map(() => '[email protected]')
    );
    expect(root.querySelector('span:not(.__cf_email__)')?.text).toBe('ordinary');
    expect(root.querySelectorAll('a').map((node) => node.getAttribute('href'))).toEqual([
      'https://example.com/guide?next=/cdn-cgi/l/email-protection#4230272326273002273a232f322e276c212d2f',
      undefined
    ]);
  });

  it('renders decoded email markup as inert text', () => {
    const result = sanitizeContentHtml(
      '<span class="__cf_email__" data-cfemail="427e2b2f25623130217f3a622d2c2730302d307f232e2730366a736b7c02273a232f322e276c212d2f">[email protected]</span>',
      'https://example.com/'
    );

    expect(parseHtml(result).querySelector('img')).toBeNull();
    expect(textContentFromHtml(result)).toBe('<img src=x onerror=alert(1)>@example.com');
    expect(result).toContain('&lt;img');
  });

  it('scrubs source-controlled forum image layout markers', () => {
    const result = sanitizeContentHtml(
      '<img src="photo.jpg" data-forum-inline-sized="true" data-forum-flow-image-context="standalone">',
      'https://example.com/base/'
    );

    expect(result).not.toContain('data-forum-inline-sized');
    expect(result).not.toContain('data-forum-flow-image-context');
  });

  it('applies a source transform inside the sanitizer parse', () => {
    let transformCount = 0;
    const result = sanitizeContentHtml(
      '<iframe src="https://embed.example.com/post"></iframe>',
      'https://example.com/',
      (root) => {
        transformCount += 1;
        root.querySelector('iframe')?.replaceWith('<p>source transformed</p>');
      }
    );

    expect(transformCount).toBe(1);
    expect(result).toContain('<p>source transformed</p>');
    expect(result).not.toContain('<iframe');
  });

  it('sanitizes media introduced by a source transform', () => {
    const result = sanitizeContentHtml('<p>before</p>', 'https://example.com/', (root) => {
      const injected = parseHtml(
        '<video src="javascript:alert(1)"></video><iframe src="javascript:alert(2)"></iframe><script>alert(3)</script>'
      );
      [...injected.childNodes].forEach((node) => root.appendChild(node));
    });

    expect(result).not.toMatch(/javascript:|<iframe|<script/i);
  });

  it('sanitizes LinuxDo polls and embedded links', () => {
    const result = sanitizeLinuxDoContentHtml(
      `
        <script>alert(1)</script>
        <div class="poll" data-poll-name="choice" onclick="alert(2)"></div>
        <iframe src="https://embed.reddit.com/r/test/comments/abc/title?utm_source=test"></iframe>
        <a href="javascript:alert(3)">unsafe</a>
      `,
      [{ name: 'choice', options: [{ id: 'yes', label: 'Yes' }] }]
    );

    expect(result).toContain('<forum-discourse-poll name="choice"></forum-discourse-poll>');
    expect(result).toContain('<forum-link-card');
    expect(result).toContain('href="https://www.reddit.com/r/test/comments/abc/title"');
    expect(result).not.toMatch(/<script|onclick|javascript:/i);
  });

  it('turns explicit LinuxDo math containers into canonical formula elements', () => {
    const result = sanitizeLinuxDoContentHtml(
      `
        <div class="math math-applied-mathjax math-hidden">(3362 - 2) \\times 24 = 80{,}640</div>
        <p>行内 <span class="math">x^2 + y^2</span>，普通 $z$ 不转换。</p>
      `,
      []
    );

    expect(result).toContain('<forum-math-block>(3362 - 2) \\times 24 = 80{,}640</forum-math-block>');
    expect(result).toContain('<forum-math-inline>x^2 + y^2</forum-math-inline>');
    expect(result).toContain('普通 $z$ 不转换');
    expect(result).not.toMatch(/class="[^"]*\bmath\b/);
  });

  it('sanitizes LinuxDo polls and Callouts together', () => {
    const result = sanitizeLinuxDoContentHtml(
      `
        <blockquote><p>[!warning] 注意<br>正文</p></blockquote>
        <div class="poll" data-poll-name="choice"></div>
      `,
      [{ name: 'choice', options: [{ id: 'yes', label: 'Yes' }] }]
    );

    expect(result).toContain('data-forum-callout-type="warning"');
    expect(result).toContain('<forum-discourse-poll name="choice"></forum-discourse-poll>');
  });

  it('skips Callout traversal for ordinary HTML but scrubs forged semantics', async () => {
    const actual = await import('@/sources/discourse/content');
    const normalizeDiscourseCallouts = vi.fn(actual.normalizeDiscourseCallouts);
    vi.resetModules();
    vi.doMock('@/sources/discourse/content', async () => ({
      ...(await vi.importActual<typeof import('@/sources/discourse/content')>('@/sources/discourse/content')),
      normalizeDiscourseCallouts
    }));
    try {
      const { sanitizeLinuxDoContentHtml } = await import('@/sources/linuxdo/parser');

      expect(sanitizeLinuxDoContentHtml('<blockquote><p>Ordinary quote</p></blockquote>', [])).toContain(
        'Ordinary quote'
      );
      expect(normalizeDiscourseCallouts).not.toHaveBeenCalled();

      const forged = sanitizeLinuxDoContentHtml(
        '<blockquote data-forum-callout="true"><div class="forum-callout-title">Forged</div></blockquote>',
        []
      );
      expect(normalizeDiscourseCallouts).toHaveBeenCalledTimes(1);
      expect(forged).toBe('<blockquote><div>Forged</div></blockquote>');
    } finally {
      vi.doUnmock('@/sources/discourse/content');
      vi.resetModules();
    }
  });

  it('preserves plain code blocks for the semantic compiler', () => {
    const result = sanitizeContentHtml(
      `
      <p>before</p>
      <pre><code>one two
three &lt; four</code></pre>
      <p>after</p>
    `,
      'https://example.com/base/'
    );

    expect(result).toContain('<pre><code>one two\nthree &lt; four</code></pre>');
    expect(result).toContain('<p>before</p>');
    expect(result).toContain('<p>after</p>');
    expect(result).not.toContain('forum-terminal-code');
  });

  it('keeps Bilibili player iframes while sanitizing their attributes', () => {
    const result = sanitizeContentHtml(
      `
      <iframe
        src="//player.bilibili.com/player.html?isOutside=true&bvid=BV1GUdgBdESz&p=1"
        onload="alert(1)"
        style="width:100%"
        allowfullscreen="true"
      ></iframe>
    `,
      'https://www.nodeseek.com/post-1-1'
    );

    expect(result).toContain('<iframe');
    expect(result).toContain('src="https://player.bilibili.com/player.html?isOutside=true&bvid=BV1GUdgBdESz&p=1"');
    expect(result).not.toContain('onload=');
    expect(result).not.toContain('style=');
  });

  it('keeps safe source text color while removing other inline styles', () => {
    const result = sanitizeContentHtml(
      `
      <p style="color: #e00; background: #fff; border-color: red" onclick="alert(1)">red</p>
      <span style="color: rgb(1, 2, 3)">rgb</span>
      <strong style="color: rebeccapurple">keyword</strong>
      <em style="color: url(javascript:alert(1)); font-weight: bold">bad</em>
      <i style="color: not-a-color">invalid</i>
    `,
      'https://example.com/base/'
    );

    expect(result).toContain('style="color: #e00"');
    expect(result).toContain('style="color: rgb(1, 2, 3)"');
    expect(result).toContain('style="color: rebeccapurple"');
    expect(result).not.toContain('background');
    expect(result).not.toContain('border-color');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('font-weight');
    expect(result).not.toContain('not-a-color');
  });

  it('turns Bilibili video image syntax output into a player iframe', () => {
    const result = sanitizeContentHtml(
      `
      <p><img src="https://www.bilibili.com/video/BV1GUdgBdESz/?p=2" alt="image"></p>
    `,
      'https://www.nodeseek.com/post-1-1'
    );

    expect(result).toContain('<iframe');
    expect(result).toContain('src="https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz&p=2"');
    expect(result).not.toContain('<img');
  });

  it('keeps NodeSeek video stickers as playable sticker elements', () => {
    const result = sanitizeContentHtml(
      `
      <p>
        <video autoplay="" loop="" muted="" playsinline="" class="sticker" width="100" height="100">
          <source src="/static/image/sticker/emoji/35.webm" type="video/webm">
          <source src="/static/image/sticker/emoji/35.mov" type="video/mp4">
        </video>
      </p>
    `,
      'https://www.nodeseek.com/post-797740-1'
    );

    expect(result).toContain('<forum-video-sticker');
    expect(result).toContain('class="sticker"');
    expect(result).toContain('src="https://www.nodeseek.com/static/image/sticker/emoji/35.webm"');
    expect(result).toContain('data-fallback-src="https://www.nodeseek.com/static/image/sticker/emoji/35.png"');
    expect(result).toContain('width="100"');
    expect(result).toContain('height="100"');
    expect(result).not.toContain('<video');
    expect(result).not.toContain('<source');
  });

  it('keeps ordinary safe videos as playable content blocks', () => {
    const result = sanitizeContentHtml(
      `
      <video controls onplay="alert(1)" poster="/cover.jpg">
        <source src="/uploads/demo.mp4" type="video/mp4">
      </video>
    `,
      'https://yaohuo.me/bbs-1560017.html'
    );

    expect(result).toContain('<forum-video');
    expect(result).toContain('src="https://yaohuo.me/uploads/demo.mp4"');
    expect(result).toContain('poster="https://yaohuo.me/cover.jpg"');
    expect(result).not.toContain('<video');
    expect(result).not.toContain('<source');
    expect(result).not.toContain('onplay');
  });

  it('normalizes the linux.do audio source shape without losing its fallback link', () => {
    const result = sanitizeLinuxDoContentHtml(
      `
      <audio preload="metadata" controls>
        <source src="https://media.example/song.mp3">
        <a href="https://media.example/song.mp3">https://media.example/song.mp3</a>
      </audio>
    `,
      []
    );

    expect(result).toContain('<forum-audio src="https://media.example/song.mp3">');
    expect(result).toContain('<a href="https://media.example/song.mp3">https://media.example/song.mp3</a>');
    expect(result).not.toContain('<audio');
    expect(result).not.toContain('<source');
  });

  it('normalizes a safe audio src attribute into the same native detail contract', () => {
    const result = sanitizeLinuxDoContentHtml('<audio src="/uploads/short.mp3" controls>打开音频</audio>', []);

    expect(result).toContain('<forum-audio src="https://linux.do/uploads/short.mp3">打开音频</forum-audio>');
    expect(result).not.toContain('<audio');
  });

  it('keeps the original fallback text when linux.do provides an empty audio source', () => {
    const result = sanitizeLinuxDoContentHtml(
      '<audio preload="metadata" controls><source src=""><a>(https://storage.to/DbsrI6Z2p)</a></audio>',
      []
    );

    expect(result).toContain('(https://storage.to/DbsrI6Z2p)');
    expect(result).not.toContain('<audio');
    expect(result).not.toContain('<source');
    expect(result).not.toContain('<forum-audio');
    expect(result).not.toContain('href=');
  });

  it('rejects unsafe audio sources without manufacturing a playable URL', () => {
    const result = sanitizeLinuxDoContentHtml(
      '<audio src="javascript:alert(1)"><source src="data:text/html,hello"><a href="javascript:alert(2)">fallback</a></audio>',
      []
    );

    expect(result).toContain('fallback');
    expect(result).not.toContain('<forum-audio');
    expect(result).not.toMatch(/javascript:|data:text\/html|href=/i);
  });

  it('drops ordinary videos without a safe http source', () => {
    const result = sanitizeContentHtml(
      `
      <video src="javascript:alert(1)"></video>
      <video><source src="data:text/html,hello"></video>
    `,
      'https://yaohuo.me/bbs-1560017.html'
    );

    expect(result).not.toContain('<forum-video');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('data:text/html');
  });

  it('turns untrusted iframes into openable link blocks instead of inline playback', () => {
    const result = sanitizeContentHtml(
      `
      <iframe src="https://www.youtube.com/embed/demo" onload="alert(1)"></iframe>
    `,
      'https://www.nodeseek.com/post-1-1'
    );

    expect(result).not.toContain('<iframe');
    expect(result).toContain('<a');
    expect(result).toContain('href="https://www.youtube.com/embed/demo"');
    expect(result).toContain('嵌入内容 · www.youtube.com');
    expect(result).not.toContain('onload=');
  });

  it('keeps data image sources without allowing data links or non-image data media', () => {
    const result = sanitizeContentHtml(
      `
      <a href="data:image/png;base64,abc123">image link</a>
      <img src="data:image/png;base64,abc123">
      <img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">
      <img src="data:text/html,hello">
    `,
      'https://example.com/base/'
    );

    expect(result).toContain('src="data:image/png;base64,abc123"');
    expect(result).not.toContain('data:image/svg+xml');
    expect(result).not.toContain('href=');
    expect(result).not.toContain('data:text/html');
  });

  it('removes forum image dimension and file size metadata without stripping ordinary metadata', () => {
    const result = sanitizeContentHtml(
      `
      <p>
        <a class="lightbox" href="/uploads/default/original/1x/asset-123.png">
          <img src="/uploads/default/original/1x/asset-123.png" alt="photo">
          <div class="meta">
            <span class="filename">camera-shot.png</span>
            <span class="informations">1920×1080 210 KB</span>
          </div>
        </a>
      </p>
      <div class="meta">附件大小 300 KB</div>
      <div>
        <a href="/uploads/default/original/1x/asset-123.png">
          <img src="/uploads/default/original/1x/asset-123.png" alt="photo">
          <div>图片1468×946 116 KB</div>
        </a>
      </div>
    `,
      'https://linux.do'
    );

    expect(result).toContain('<img');
    expect(result).toContain('附件大小 300 KB');
    expect(result).not.toContain('camera-shot.png');
    expect(result).not.toContain('1920×1080');
    expect(result).not.toContain('210 KB');
    expect(result).not.toContain('图片1468×946 116 KB');
  });

  it('removes image metadata text that uses the original image label', () => {
    const result = sanitizeContentHtml(
      `
      <a href="/uploads/default/original/1x/asset-123.png">
        <img src="/uploads/default/original/1x/asset-123.png" alt="image">
        <div>image1244×152 8.4 KB</div>
      </a>
    `,
      'https://linux.do'
    );

    expect(result).toContain('<img');
    expect(result).not.toContain('image1244×152 8.4 KB');
  });

  it('turns Discourse oneboxes into safe link cards', () => {
    const result = sanitizeContentHtml(
      `
      <aside class="onebox allowlistedgeneric" data-onebox-src="https://bincheck.io/zh" onclick="alert(1)">
        <header class="source">
          <img src="https://cdn3.ldstatic.com/original/site.svg" class="site-icon" alt="">
          <a href="https://bincheck.io/zh" target="_blank">bincheck.io</a>
        </header>
        <article class="onebox-body">
          <div class="aspect-image"><img src="https://cdn3.ldstatic.com/optimized/thumb.png" class="thumbnail" alt=""></div>
          <h3><a href="https://bincheck.io/zh">检查、验证和验证 BIN - 银行识别号 - BIN Check</a></h3>
          <p>免费在线 BIN/IIN 检查器以验证和验证银行识别号的信息</p>
        </article>
      </aside>
    `,
      'https://linux.do'
    );

    expect(result).toContain('<forum-link-card');
    expect(result).toContain('href="https://bincheck.io/zh"');
    expect(result).toContain('site="bincheck.io"');
    expect(result).toContain('title="检查、验证和验证 BIN - 银行识别号 - BIN Check"');
    expect(result).toContain('description="免费在线 BIN/IIN 检查器以验证和验证银行识别号的信息"');
    expect(result).toContain('image-src="https://cdn3.ldstatic.com/optimized/thumb.png"');
    expect(result).toContain('icon-src="https://cdn3.ldstatic.com/original/site.svg"');
    expect(result).not.toContain('<aside');
    expect(result).not.toContain('<img');
    expect(result).not.toContain('onclick');
  });

  it('decodes apostrophe entities', () => {
    expect(decodeHtml('A&apos;B')).toBe("A'B");
  });

  it('decodes each HTML entity only once', () => {
    expect(decodeHtml('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });

  it('decodes numeric entities outside the BMP', () => {
    expect(decodeHtml('&#128512; &#x1F600;')).toBe('😀 😀');
  });
});
