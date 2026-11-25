import { parser } from '@lezer/markdown';

const codeNodes = new Set(['InlineCode', 'FencedCode', 'CodeBlock']);

export function maskMarkdownCode(markdown: string) {
  if (!/[`~\t]| {4}/.test(markdown)) return markdown;
  const ranges: { from: number; to: number }[] = [];
  parser.parse(markdown).iterate({
    enter(node) {
      if (!codeNodes.has(node.name)) return;
      ranges.push({ from: node.from, to: node.to });
      return false;
    }
  });
  if (!ranges.length) return markdown;
  let cursor = 0;
  let masked = '';
  for (const { from, to } of ranges) {
    masked += markdown.slice(cursor, from);
    masked += ' '.repeat(to - from);
    cursor = to;
  }
  return masked + markdown.slice(cursor);
}
