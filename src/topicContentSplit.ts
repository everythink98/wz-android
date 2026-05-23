import { parseHtml } from './localHtml';

const fallbackBlockPattern = /[\s\S]*?<\/(?:p|div|blockquote|pre|ul|ol|li|table|h[1-6])>/gi;

function splitTopicContentHtmlFallback(clean: string, maxChunkLength: number) {
  const blocks = clean.match(fallbackBlockPattern);
  if (!blocks?.length) {
    return [clean];
  }
  const chunks: string[] = [];
  let current = '';
  let consumedLength = 0;
  for (const block of blocks) {
    current += block;
    consumedLength += block.length;
    if (current.length >= maxChunkLength) {
      chunks.push(current);
      current = '';
    }
  }
  const remainder = clean.slice(consumedLength).trim();
  if (remainder) {
    current += remainder;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks.length ? chunks : [clean];
}

export function splitTopicContentHtml(html: string | undefined, maxChunkLength = 2200) {
  const clean = (html || '').trim();
  if (!clean) {
    return [];
  }
  try {
    const root = parseHtml(`<body>${clean}</body>`);
    const nodes = root.querySelector('body')?.childNodes || [];
    const blocks = nodes.map((node) => node.toString()).filter((value) => value.trim());
    if (!blocks.length) {
      return [clean];
    }
    const chunks: string[] = [];
    let current = '';
    for (const block of blocks) {
      current += block;
      if (current.length >= maxChunkLength) {
        chunks.push(current);
        current = '';
      }
    }
    if (current) {
      chunks.push(current);
    }
    return chunks.length ? chunks : [clean];
  } catch {
    return splitTopicContentHtmlFallback(clean, maxChunkLength);
  }
}
