import { describe, expect, it } from 'vitest';
import { parseForumContentHtml, parseHtml } from '@/domain/forum/html';
import { normalizeNodeSeekPollPlaceholderNodes, normalizeNodeSeekVoteMarkers } from './polls';
import { withHtmlWorkBudget } from '../../../tests/helpers/htmlWorkBudget';

describe('NodeSeek poll markup', () => {
  it.each(['anchors', 'text leaves'] as const)('normalizes wide marker %s with bounded work', (shape) => {
    const count = 1024;
    const root = parseForumContentHtml(
      '<section>' +
        (shape === 'anchors'
          ? '<a href="/jump">nsapp://vote?id=7</a>'
          : 'before nsapp://vote?id=7 after<span>separator</span>'
        ).repeat(count) +
        '</section><pre><code>nsapp://vote?id=8</code></pre><img src="/proof.png">'
    );
    const parent = root.querySelector('section');
    if (!parent) throw new Error('Missing marker container');
    const budget = (root.querySelectorAll('*').length + 1) * 192 + 10000;
    const { result: discovered, reads } = withHtmlWorkBudget(
      budget,
      () => normalizeNodeSeekVoteMarkers(root, shape === 'anchors' ? [] : ['7']),
      root
    );

    expect(reads).toBeLessThanOrEqual(budget);
    expect(discovered).toEqual(['7']);
    expect(root.querySelectorAll('a')).toHaveLength(0);
    expect(root.querySelectorAll('forum-nodeseek-poll')).toHaveLength(shape === 'anchors' ? 0 : 1);
    if (shape === 'anchors') expect(parent.textContent.match(/nsapp:\/\/vote\?id=7/g)).toHaveLength(count);
    else {
      expect(parent.textContent.match(/before/g)).toHaveLength(count);
      expect(parent.textContent.match(/after/g)).toHaveLength(count);
      expect(parent.querySelectorAll('span')).toHaveLength(count);
    }
    expect(root.querySelector('code')?.text).toBe('nsapp://vote?id=8');
    expect(root.querySelector('img')?.getAttribute('src')).toBe('/proof.png');
  });

  it('discovers nested text and later anchor markers in source order', () => {
    const root = parseForumContentHtml(
      '<section>nsapp://vote?id=8</section><a href="/jump">nsapp://vote?id=7</a>' +
        '<aside>nsapp://vote?id=9<span>nsapp://vote?id=8</span></aside>' +
        '<pre><code>nsapp://vote?id=10</code></pre>'
    );

    expect(normalizeNodeSeekVoteMarkers(root, [])).toEqual(['8', '7', '9']);
    expect(root.querySelectorAll('forum-nodeseek-poll')).toHaveLength(0);
    expect(root.textContent).toBe(
      'nsapp://vote?id=8nsapp://vote?id=7nsapp://vote?id=9nsapp://vote?id=8nsapp://vote?id=10'
    );
    expect(root.querySelectorAll('a')).toHaveLength(0);
    expect(root.querySelector('code')?.text).toBe('nsapp://vote?id=10');
  });

  it.each(['paragraph', 'siblings', 'nested'] as const)(
    'normalizes many repeated placeholders with bounded work: %s',
    (shape) => {
      const count = 2048;
      const placeholder = '<forum-nodeseek-poll id="7"></forum-nodeseek-poll>';
      const html =
        shape === 'paragraph'
          ? '<p>' + placeholder.repeat(count) + '</p>'
          : shape === 'siblings'
            ? placeholder.repeat(count)
            : ('<div>' + placeholder).repeat(count) + 'ordinary body' + '</div>'.repeat(count);
      const root = parseForumContentHtml(html);
      const budget = (root.querySelectorAll('*').length + 1) * 128 + 10000;
      const { reads } = withHtmlWorkBudget(budget, () => normalizeNodeSeekPollPlaceholderNodes(root, ['7']), root);
      expect(reads).toBeLessThanOrEqual(budget);
      expect(root.querySelectorAll('forum-nodeseek-poll')).toHaveLength(1);
      expect(root.textContent).toBe(shape === 'nested' ? 'ordinary body' : '');
    }
  );
  it('preserves ordinary nested div content with bounded work while clearing adjacent poll shells', () => {
    const depth = 1024;
    const root = parseForumContentHtml(
      '<div>'.repeat(depth) +
        '<p>ordinary body<img src="https://example.com/media.png"><code>nsapp://vote?id=7</code>' +
        '<forum-nodeseek-poll id="7"></forum-nodeseek-poll></p>' +
        '</div>'.repeat(depth) +
        '<p>提交投票</p><div id="vote-shell">（可多选）<forum-nodeseek-poll id="11"></forum-nodeseek-poll></div>'
    );
    const budget = depth * 64;

    const { reads } = withHtmlWorkBudget(budget, () => normalizeNodeSeekPollPlaceholderNodes(root, ['7', '11']), root);

    expect(reads).toBeLessThanOrEqual(budget);
    expect(root.querySelectorAll('div')).toHaveLength(depth);
    expect(root.querySelectorAll('forum-nodeseek-poll').map((node) => node.getAttribute('id'))).toEqual(['7', '11']);
    expect(root.querySelector('img')?.getAttribute('src')).toBe('https://example.com/media.png');
    expect(root.querySelector('code')?.text).toBe('nsapp://vote?id=7');
    expect(root.textContent).toBe('ordinary bodynsapp://vote?id=7');
    expect(root.querySelector('#vote-shell')).toBeNull();
  });

  it.each([
    ['markers', 'div'],
    ['markers', 'p'],
    ['markers', 'none'],
    ['placeholders', 'none']
  ] as const)('normalizes deep %s with bounded work when its nearest container is %s', (entry, container) => {
    const depth = 16_384;
    const loaded = ['8', '7', '11'];
    const leaf =
      entry === 'markers'
        ? 'before nsapp://vote?id=8 <a href="/jump/vote">nsapp://vote?id=7</a> nsapp://vote?id=8 ' +
          '<a href="nsapp://vote?id=9">nsapp://vote?id=9</a>'
        : 'before <forum-nodeseek-poll id="8"></forum-nodeseek-poll>' +
          '<forum-nodeseek-poll id="7"></forum-nodeseek-poll><forum-nodeseek-poll id="8"></forum-nodeseek-poll>' +
          '<forum-nodeseek-poll id="9"></forum-nodeseek-poll>';
    const body =
      '<span>'.repeat(depth) +
      leaf +
      ' <a href="https://example.com/safe">safe link</a><img src="https://example.com/media.png"> after' +
      '</span>'.repeat(depth);
    const root = parseForumContentHtml(
      (container === 'none' ? body : `<${container}>${body}</${container}>`) +
        '<pre><code>nsapp://vote?id=7</code></pre><p>提交投票</p>' +
        '<div id="vote-shell">（可多选）<forum-nodeseek-poll id="11"></forum-nodeseek-poll></div>'
    );
    const budget = depth * 80;
    let discovered: string[] | undefined;
    const { reads } = withHtmlWorkBudget(
      budget,
      () => {
        if (entry === 'markers') discovered = normalizeNodeSeekVoteMarkers(root, loaded);
        else normalizeNodeSeekPollPlaceholderNodes(root, loaded);
      },
      root
    );

    expect(reads).toBeLessThanOrEqual(budget);
    if (entry === 'markers') expect(discovered).toEqual(['8', '7', '9']);
    expect(root.querySelectorAll('forum-nodeseek-poll').map((node) => node.getAttribute('id'))).toEqual(
      entry === 'markers' ? ['8', '7', '11'] : ['8', '7', '9', '11']
    );
    expect(root.querySelectorAll('span')).toHaveLength(depth);
    expect(root.querySelectorAll('a').map((node) => node.getAttribute('href'))).toEqual(['https://example.com/safe']);
    expect(root.querySelector('img')?.getAttribute('src')).toBe('https://example.com/media.png');
    expect(root.querySelector('code')?.text).toBe('nsapp://vote?id=7');
    expect(root.textContent).toMatch(/before[\s\S]*safe link[\s\S]*after[\s\S]*nsapp:\/\/vote\?id=7/);
    if (entry === 'markers') expect(root.textContent).toContain('nsapp://vote?id=9');
    expect(root.querySelector('#vote-shell')).toBeNull();
    expect(root.textContent).not.toContain('提交投票');
    expect(root.textContent).not.toContain('可多选');
  });

  it.each([false, true])(
    'preserves a deep subtree and normalizes its markers in source order: markers=%s',
    (markers) => {
      const depth = 16_384;
      const source = markers
        ? 'before nsapp://vote?id=7 <a href="/jump/vote">nsapp://vote?id=8</a> after'
        : 'ordinary content';
      const html =
        '<span>'.repeat(depth) +
        '<div><p>' +
        source +
        '</p></div>' +
        '</span>'.repeat(depth) +
        '<pre><code>nsapp://vote?id=7</code></pre>';
      const root = parseForumContentHtml(html);

      const discovered = normalizeNodeSeekVoteMarkers(root, markers ? ['7', '8'] : []);

      expect(discovered).toEqual(markers ? ['7', '8'] : []);
      expect(root.querySelectorAll('span')).toHaveLength(depth);
      expect(root.querySelector('pre')?.text).toBe('nsapp://vote?id=7');
      if (markers) {
        expect(root.querySelectorAll('forum-nodeseek-poll').map((node) => node.getAttribute('id'))).toEqual(['7', '8']);
        expect(root.querySelector('p')?.text).toBe('before  after');
      } else expect(root.toString()).toBe(html);
    }
  );

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

  it('preserves outer containers when a single poll did not need deduplication', () => {
    const placeholder = '<forum-nodeseek-poll id="7"></forum-nodeseek-poll>';
    const root = parseForumContentHtml('<div><div>提交投票' + placeholder + '</div></div>');
    normalizeNodeSeekPollPlaceholderNodes(root, ['7']);
    expect(root.toString()).toBe('<div>' + placeholder + '</div>');
  });

  it('keeps polls inside adjacent marker shells and removes only duplicate polls', () => {
    const root = parseForumContentHtml(
      '<p><span>提交投票</span><forum-nodeseek-poll id="1"></forum-nodeseek-poll>提交投票</p><forum-nodeseek-poll id="2"></forum-nodeseek-poll>'
    );
    normalizeNodeSeekPollPlaceholderNodes(root, ['1', '2']);
    expect(root.querySelectorAll('forum-nodeseek-poll').map((node) => node.getAttribute('id'))).toEqual(['1', '2']);
  });

  it.each([
    ['span', ''],
    ['section', '">提交<span>投票</span>']
  ])('removes deferred %s marker shells after deduplicating their polls', (tag, label) => {
    const first = '<forum-nodeseek-poll id="2"></forum-nodeseek-poll>';
    const second = '<forum-nodeseek-poll id="1"></forum-nodeseek-poll>';
    const safe = '<pre><code>safe code</code></pre><aside id="ordinary-empty"></aside><section>ordinary body</section>';
    const root = parseForumContentHtml(first + `<${tag}>${label}${first}</${tag}>` + second + safe);

    normalizeNodeSeekPollPlaceholderNodes(root, ['1', '2']);

    expect(root.toString()).toBe(first + second + safe);
  });

  it('clears consecutive duplicate poll shells in the original cleanup order', () => {
    const placeholder = '<forum-nodeseek-poll id="7"></forum-nodeseek-poll>';
    const root = parseForumContentHtml(
      placeholder +
        '<section>ordinary <span>' +
        placeholder +
        '</span><span>' +
        placeholder +
        '</span>' +
        placeholder +
        ' after</section>'
    );

    normalizeNodeSeekPollPlaceholderNodes(root, ['7']);

    expect(root.toString()).toBe(placeholder + '<section>ordinary  after</section>');
  });
});
