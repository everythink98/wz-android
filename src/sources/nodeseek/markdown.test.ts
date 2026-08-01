import { describe, expect, it } from 'vitest';
import { MAX_NODESEEK_MARKDOWN_BYTES, nodeSeekMarkdownToHtml } from './markdown';

describe('NodeSeek Markdown', () => {
  it('keeps ordinary Markdown and linkify rendering enabled', () => {
    const html = nodeSeekMarkdownToHtml('**正文** https://example.com/path');

    expect(html).toContain('<strong>正文</strong>');
    expect(html).toContain('<a href="https://example.com/path">');
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
