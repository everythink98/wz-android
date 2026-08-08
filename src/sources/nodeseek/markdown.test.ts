import { describe, expect, it } from 'vitest';
import { MAX_NODESEEK_MARKDOWN_BYTES, nodeSeekMarkdownToHtml } from './markdown';

describe('NodeSeek Markdown', () => {
  it('keeps ordinary Markdown and linkify rendering enabled', () => {
    const html = nodeSeekMarkdownToHtml('**正文** https://example.com/path');

    expect(html).toContain('<strong>正文</strong>');
    expect(html).toContain('<a href="https://example.com/path">');
  });

  it('[REG-NOTIFY-057] renders known NodeSeek sticker shortcodes without rewriting code literals', () => {
    const html = nodeSeekMarkdownToHtml('**私信正文** :ac04: `:ac04:` :unknown:\n\n```text\n:ac04:\n```');

    expect(html).toContain('<strong>私信正文</strong>');
    expect(html).toContain('class="sticker"');
    expect(html).toContain('src="https://www.nodeseek.com/static/image/sticker/ac/04.png"');
    expect(html).toContain('alt="ac04"');
    expect(html).toContain('<code>:ac04:</code>');
    expect(html).toContain('<div class="forum-terminal-code">:ac04:</div>');
    expect(html).toContain(':unknown:');
    expect(html.match(/static\/image\/sticker\/ac\/04\.png/g)).toHaveLength(1);
  });

  it('[REG-TOPIC-051] returns a fixed safe notice without parsing oversized Markdown', () => {
    const marker = 'must-not-be-rendered.example';
    const html = nodeSeekMarkdownToHtml(`${'x'.repeat(MAX_NODESEEK_MARKDOWN_BYTES)}${marker}`);

    expect(html).toContain('内容过长，无法安全显示');
    expect(html).not.toContain(marker);
    expect(html).not.toContain('<script');
  });

  it('[REG-TOPIC-051] applies the 256 KiB budget to UTF-8 bytes and caps nesting at 100', () => {
    const exactBudget = `${'界'.repeat(Math.floor(MAX_NODESEEK_MARKDOWN_BYTES / 3))}a`;
    const oversized = `${exactBudget}界`;

    expect(new TextEncoder().encode(exactBudget)).toHaveLength(MAX_NODESEEK_MARKDOWN_BYTES);
    expect(nodeSeekMarkdownToHtml(exactBudget)).toContain('界');
    expect(nodeSeekMarkdownToHtml(oversized)).toContain('内容过长，无法安全显示');

    const nested = nodeSeekMarkdownToHtml(`${'> '.repeat(101)}正文`);
    expect(nested.match(/<blockquote>/g)).toHaveLength(100);
  });
});
