import { describe, expect, it } from 'vitest';
import { parseForumContentHtml } from '@/domain/forum/html';
import type { TopicDetail } from '@/domain/forum/models';
import { prepareTopicShareContent } from './topicShareContent';

const topic: TopicDetail = {
  source: 'linuxdo',
  id: '1',
  title: '测试主题',
  author: 'alice',
  url: 'https://linux.do/t/topic/1',
  createdAt: '',
  contentHtml: '',
  replies: []
};

describe('topic share content', () => {
  it.each(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo'] as const)('allows an image-only opening body from %s', (source) => {
    const result = prepareTopicShareContent({
      ...topic,
      source,
      contentHtml: '<figure><img srcset="https://images.example/only.png 1000w"></figure>'
    });
    expect(result.imageCount).toBe(1);
    expect(parseForumContentHtml(result.html).querySelector('img')?.getAttribute('src')).toBe(
      'https://images.example/only.png'
    );
  });

  it('keeps complete paragraphs, emphasis, lists, code whitespace and table cells without source layout', () => {
    const { html, imageCount } = prepareTopicShareContent({
      ...topic,
      contentHtml:
        '<h2 style="color:red" class="source">正文</h2><p>前<strong>加粗</strong><br>后</p>' +
        '<ol start="3"><li>第一项</li><li>第二项</li></ol><pre><code>  a &lt; b\n    中文 👩‍💻</code></pre>' +
        '<table width="9999"><tr><th colspan="2">表头</th></tr><tr><td>左</td><td>右</td></tr></table><p>末尾</p>'
    });
    const root = parseForumContentHtml(html);
    expect(root.querySelector('h2')?.attributes).toEqual({ style: 'color: red', class: 'source' });
    expect(root.querySelector('p')?.innerHTML).toBe('前<strong>加粗</strong><br>后');
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(root.querySelector('pre')?.textContent).toBe('  a < b\n    中文 👩‍💻');
    expect(root.querySelector('th')?.getAttribute('colspan')).toBe('2');
    expect(root.querySelectorAll('td').map((node) => node.textContent)).toEqual(['左', '右']);
    expect(root.querySelectorAll('p').at(-1)?.textContent).toBe('末尾');
    expect(imageCount).toBe(0);
    expect(html).not.toMatch(/width=/);
  });

  it('keeps sanitized reading styles, semantic classes and legacy font sizes without active CSS', () => {
    const { html } = prepareTopicShareContent({
      ...topic,
      contentHtml:
        '<p style="text-align:center;color:#b02030;font-size:99px;background-image:url(javascript:bad())">' +
        '<span class="bbcode-b bbcode-u">强调</span><font size="5" color="magenta">大字</font>' +
        '<font size="99" color="url(javascript:bad())">普通文字</font></p>'
    });
    const root = parseForumContentHtml(html);
    expect(root.querySelector('p')?.getAttribute('style')).toBe('text-align: center; color: #b02030');
    expect(root.querySelector('span')?.getAttribute('class')).toBe('bbcode-b bbcode-u');
    expect(root.querySelector('font')?.attributes).toEqual({ size: '5', style: 'color: magenta' });
    expect(root.querySelectorAll('font')[1].attributes).toEqual({});
    expect(root.textContent).toBe('强调大字普通文字');
    expect(html).not.toMatch(/javascript:|font-size|background-image/);
  });

  it('uses safe canonical and full resolution sources instead of thumbnails', () => {
    const { html, imageCount } = prepareTopicShareContent({
      ...topic,
      contentHtml:
        '<img src="/canonical-thumb.png" data-forum-original-src="/canonical.png" data-original="/smaller-original.png">' +
        '<img src="/lazy-thumb.png" data-original="/original.png">' +
        '<img src="/responsive-thumb.png" srcset="https://images.example/640.png 640w, https://images.example/2048.png 2048w">' +
        '<a class="lightbox" href="/lightbox-original.png"><img src="/lightbox-thumb.png"></a>' +
        '<img src="/safe.png" data-forum-original-src="file:///secret" data-original="javascript:bad()" ' +
        'srcset="content://secret 9999w">'
    });
    const images = parseForumContentHtml(html).querySelectorAll('img, forum-inline-image, forum-sticker');
    expect(imageCount).toBe(5);
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'https://linux.do/canonical.png',
      'https://linux.do/original.png',
      'https://images.example/2048.png',
      'https://linux.do/lightbox-original.png',
      'https://linux.do/safe.png'
    ]);
    expect(html).not.toMatch(/file:|javascript:|content:|data-original|srcset|data-forum-original-src/);
  });

  it('preserves repeated image instances in order, resolves lazy URLs and restores canonical inline media', () => {
    const { html, imageCount } = prepareTopicShareContent({
      ...topic,
      contentHtml:
        '<p>前<img src="/first.png" referrerpolicy="no-referrer">中<img src="/first.png"></p>' +
        '<forum-inline-image src="/inline.png">inline</forum-inline-image>' +
        '<forum-sticker src="/sticker.gif" alt="表情"></forum-sticker>' +
        '<img src="/blank.png" data-src="/last.png" width="100" height="100">' +
        '<img src="/valid.png" data-src="javascript:bad()">' +
        '<img srcset="https://images.example/srcset.png 1000w">'
    });
    const root = parseForumContentHtml(html);
    const images = root.querySelectorAll('img, forum-inline-image, forum-sticker');
    expect(imageCount).toBe(7);
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      ...['first.png', 'first.png', 'inline.png', 'sticker.gif', 'last.png', 'valid.png'].map(
        (name) => `https://linux.do/${name}`
      ),
      'https://images.example/srcset.png'
    ]);
    expect(images.map((image) => image.getAttribute('data-share-image-index'))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6'
    ]);
    expect(images[0].getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(root.querySelector('forum-inline-image[src="https://linux.do/inline.png"]')).not.toBeNull();
    expect(root.querySelector('forum-sticker')?.getAttribute('src')).toBe('https://linux.do/sticker.gif');
    expect(html).not.toMatch(/\swidth=|\sheight=/);
  });

  it('keeps bounded authored image sizes and emoji semantics without accepting arbitrary styling or forged sizes', () => {
    const { html } = prepareTopicShareContent({
      ...topic,
      contentHtml:
        '<img src="/emoji.png" class="emoji" width="20" height="20">' +
        '<img src="/twemoji.png" class="emoji">' +
        '<forum-sticker src="https://www.nodeseek.com/static/image/sticker/ac/1.png"></forum-sticker>' +
        '<img src="/small.png" width="120px" height="80px">' +
        '<img src="/large.png" width="10000" height="6000" data-share-width="24" data-share-height="24">' +
        '<img src="/percent.png" width="100%" style="width:20px;height:20px">'
    });
    const root = parseForumContentHtml(html);
    const images = root.querySelectorAll('img, forum-inline-image, forum-sticker');
    expect(
      images.map((image) => [image.getAttribute('data-share-width'), image.getAttribute('data-share-height')])
    ).toEqual([
      ['20', '20'],
      ['24', undefined],
      ['150', '130'],
      ['120', '80'],
      [undefined, undefined],
      [undefined, undefined]
    ]);
    expect(images.slice(0, 2).map((image) => image.rawTagName)).toEqual(['forum-inline-image', 'forum-inline-image']);
    expect(root.querySelector('forum-sticker')?.getAttribute('src')).toBe(
      'https://www.nodeseek.com/static/image/sticker/ac/1.png'
    );
    expect(html).not.toMatch(/\sstyle=|\swidth=|\sheight=/);
  });

  it('keeps sticker rows and mixed media lines in their authored order', () => {
    const { html, imageCount } = prepareTopicShareContent({
      ...topic,
      contentHtml:
        '<forum-sticker-row><forum-sticker src="/row.png" width="48" height="48"></forum-sticker></forum-sticker-row>' +
        '<forum-inline-media-line>前<forum-sticker src="/mixed.png" width="40" height="40"></forum-sticker>后</forum-inline-media-line>'
    });
    const root = parseForumContentHtml(html);
    expect(root.childNodes.map((node) => node.toString())).toEqual([
      expect.stringMatching(/^<forum-sticker-row><forum-sticker /),
      expect.stringMatching(/^<forum-inline-media-line>前<forum-sticker /)
    ]);
    expect(root.querySelectorAll('forum-sticker').map((image) => image.getAttribute('data-share-image-index'))).toEqual(
      ['0', '1']
    );
    expect(root.textContent).toBe('前后');
    expect(imageCount).toBe(2);
  });

  it('expands details and every terminal tab, preserves formulas and makes rich media visible without players', () => {
    const { html, imageCount } = prepareTopicShareContent({
      ...topic,
      contentHtml:
        '<details><summary>展开标题</summary><p>折叠正文<img src="/inside.png"></p></details>' +
        '<forum-terminal-report><forum-terminal-tab title="CPU"><div class="forum-terminal-code">  A<br>B</div></forum-terminal-tab>' +
        '<forum-terminal-tab title="网络"><div class="forum-terminal-code">  C</div></forum-terminal-tab></forum-terminal-report>' +
        '<p><forum-math-inline>x &lt; y</forum-math-inline></p><forum-math-block>\\frac{a}{b}</forum-math-block>' +
        '<forum-link-card href="/linked" title="标题 &amp; 内容" description="完整描述" site="本站" image-src="/thumb.png" image-referrerpolicy="same-origin"></forum-link-card>' +
        '<audio src="/audio.mp3"></audio><forum-video src="/video.mp4"></forum-video>' +
        '<forum-video-sticker src="/sticker.webm" data-fallback-src="/fallback.png"></forum-video-sticker>' +
        '<iframe src="https://embed.example/page"></iframe>'
    });
    const root = parseForumContentHtml(html);
    expect(root.textContent).toContain('展开标题折叠正文');
    expect(root.querySelectorAll('pre').map((node) => node.textContent)).toEqual(['  A\nB', '  C', '\\frac{a}{b}']);
    expect(root.querySelector('code')?.textContent).toBe('x < y');
    expect(root.textContent).toContain('标题 & 内容');
    expect(root.textContent).toContain('完整描述');
    expect(root.textContent).toContain('CPU');
    expect(root.textContent).toContain('网络');
    expect(root.querySelector('img[src="https://linux.do/thumb.png"]')?.getAttribute('referrerpolicy')).toBe(
      'same-origin'
    );
    expect(root.querySelectorAll('a').map((node) => node.getAttribute('href'))).toEqual(
      expect.arrayContaining([
        'https://linux.do/linked',
        'https://linux.do/audio.mp3',
        'https://linux.do/video.mp4',
        'https://linux.do/sticker.webm',
        'https://embed.example/page'
      ])
    );
    expect(imageCount).toBe(3);
    expect(html).not.toMatch(/<forum-(?!inline-image\b)|<details|<summary|<audio|<video|<iframe/);
  });

  it('keeps poll options at their authored position and includes unmarked polls without duplicating them', () => {
    const { html } = prepareTopicShareContent({
      ...topic,
      contentHtml: '<p>投票前</p><forum-discourse-poll name="poll"></forum-discourse-poll><p>投票后</p>',
      polls: [
        {
          name: 'poll',
          title: '选择',
          options: [
            { id: 'a', label: 'A < B' },
            { id: 'b', label: 'B' }
          ]
        },
        { id: '2', title: '另一个投票', options: [{ id: 'c', label: 'C' }] }
      ]
    });
    const text = parseForumContentHtml(html).textContent;
    expect(text).toBe('投票前选择A < BB投票后另一个投票C');
    expect(html.match(/选择/g)).toHaveLength(1);
  });

  it('removes active content and unsafe URLs, retains ordinary text and never trusts supplied image indices', () => {
    const { html, imageCount } = prepareTopicShareContent({
      ...topic,
      contentHtml:
        '<script>alert(1)</script><style>p {color:red}</style><p onclick="bad()">安全文字</p>' +
        '<a href="javascript:alert(1)">危险链接</a><img src="file:///secret" data-share-image-index="999">' +
        '<forum-inline-image src="javascript:bad()">bad image</forum-inline-image>' +
        '<forum-link-card href="javascript:bad()" image-src="content://secret" title="安全标题"></forum-link-card>' +
        '<iframe src="javascript:bad()"></iframe><img src="https://images.example/good.png" data-share-image-index="999">'
    });
    expect(html).not.toMatch(/javascript:|file:|content:|onclick|<script|<style|999/);
    expect(html).toContain('安全文字');
    expect(html).toContain('安全标题');
    expect(imageCount).toBe(1);
    expect(
      parseForumContentHtml(html)
        .querySelector('img, forum-inline-image, forum-sticker')
        ?.getAttribute('data-share-image-index')
    ).toBe('0');
  });

  it('rejects unloaded, empty, restricted and oversized bodies without truncating valid content', () => {
    expect(() => prepareTopicShareContent(topic)).toThrow('正文尚未加载');
    expect(() => prepareTopicShareContent({ ...topic, contentHtml: '<script>bad()</script>' })).toThrow(
      '正文没有可分享'
    );
    expect(() =>
      prepareTopicShareContent({
        ...topic,
        contentHtml: '<p>权限不足</p>',
        accessRequirement: { type: 'permission', label: '需权限' }
      })
    ).toThrow('没有权限');
    expect(() => prepareTopicShareContent({ ...topic, contentHtml: '文'.repeat(150_001) })).toThrow('正文过长');
    const allowed = prepareTopicShareContent({
      ...topic,
      contentHtml: `<p>${'完整正文'.repeat(1000)}</p>`,
      accessRequirement: { type: 'level', label: '需等级' }
    });
    expect(parseForumContentHtml(allowed.html).textContent).toBe('完整正文'.repeat(1000));
  });
});
