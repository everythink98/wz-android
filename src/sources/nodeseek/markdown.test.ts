import { describe, expect, it } from 'vitest';
import { MAX_NODESEEK_MARKDOWN_BYTES, nodeSeekMarkdownToHtml } from './markdown';

describe('NodeSeek Markdown', () => {
  it('keeps ordinary Markdown and linkify rendering enabled', () => {
    const html = nodeSeekMarkdownToHtml('**正文** https://example.com/path');

    expect(html).toContain('<strong>正文</strong>');
    expect(html).toContain('<a href="https://example.com/path">');
  });

  it('linkifies bare domains and complete authenticated URLs', () => {
    const html = nodeSeekMarkdownToHtml(
      'www.nodeseek.com/post-1-1 example.com https://reader:secret@example.com/private'
    );

    expect(html).toContain('<a href="http://www.nodeseek.com/post-1-1">www.nodeseek.com/post-1-1</a>');
    expect(html).toContain('<a href="http://example.com/">example.com</a>');
    expect(html).toContain(
      '<a href="https://reader:secret@example.com/private">https://reader:secret@example.com/private</a>'
    );
  });

  it('turns Composer GFM into one semantic header and complete body rows', () => {
    const html = nodeSeekMarkdownToHtml('| E | E | Q |\n| --- | --- | --- |\n| F | G | R |\n| T | G | U |');

    expect(html).toBe(
      '<table>\n<thead>\n<tr>\n<th>E</th>\n<th>E</th>\n<th>Q</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>F</td>\n<td>G</td>\n<td>R</td>\n</tr>\n<tr>\n<td>T</td>\n<td>G</td>\n<td>U</td>\n</tr>\n</tbody>\n</table>\n'
    );
  });

  it('keeps unsupported underline literal while rendering GFM tasks and alignment', () => {
    const html = nodeSeekMarkdownToHtml(
      '~~删除线~~\n\n++下划线++\n\n- [ ] 未完成\n- [x] 已完成\n\n| 左 | 中 | 右 |\n| :-- | :-: | --: |\n| A | B | C |'
    );

    expect(html).toContain('<s>删除线</s>');
    expect(html).toContain('++下划线++');
    expect(html).not.toContain('<ins>');
    expect(html).toContain('☐');
    expect(html).toContain('☑');
    expect(html).not.toContain('<input');
    expect(html).toContain('style="text-align: left"');
    expect(html).toContain('style="text-align: center"');
    expect(html).toContain('style="text-align: right"');
  });

  it('renders known NodeSeek sticker shortcodes without rewriting code literals', () => {
    const html = nodeSeekMarkdownToHtml('**私信正文** :ac04: `:ac04:` :unknown:\n\n```text\n:ac04:\n```');

    expect(html).toContain('<strong>私信正文</strong>');
    expect(html).toContain('class="sticker"');
    expect(html).toContain('src="https://www.nodeseek.com/static/image/sticker/ac/04.png"');
    expect(html).toContain('alt="ac04"');
    expect(html).toContain('<code>:ac04:</code>');
    expect(html).toContain('<pre><code class="language-text">:ac04:\n</code></pre>');
    expect(html).toContain(':unknown:');
    expect(html.match(/static\/image\/sticker\/ac\/04\.png/g)).toHaveLength(1);
  });

  it('returns a fixed safe notice without parsing oversized Markdown', () => {
    const marker = 'must-not-be-rendered.example';
    const html = nodeSeekMarkdownToHtml(`${'x'.repeat(MAX_NODESEEK_MARKDOWN_BYTES)}${marker}`);

    expect(html).toContain('内容过长，无法安全显示');
    expect(html).not.toContain(marker);
    expect(html).not.toContain('<script');
  });

  it('applies the 256 KiB budget to UTF-8 bytes and caps nesting at 100', () => {
    const exactBudget = `${'界'.repeat(Math.floor(MAX_NODESEEK_MARKDOWN_BYTES / 3))}a`;
    const oversized = `${exactBudget}界`;

    expect(new TextEncoder().encode(exactBudget)).toHaveLength(MAX_NODESEEK_MARKDOWN_BYTES);
    expect(nodeSeekMarkdownToHtml(exactBudget)).toContain('界');
    expect(nodeSeekMarkdownToHtml(oversized)).toContain('内容过长，无法安全显示');

    const nested = nodeSeekMarkdownToHtml(`${'> '.repeat(101)}正文`);
    expect(nested.match(/<blockquote>/g)).toHaveLength(100);
  });
});
