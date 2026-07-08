import { FORUM_LINK_CARD_TAG, FORUM_TERMINAL_REPORT_TAG, FORUM_VIDEO_TAG, parseHtml } from './localHtml';

const FALLBACK_BLOCK_TAGS = new Set(['p', 'div', 'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'details', 'summary', 'iframe', FORUM_VIDEO_TAG, FORUM_LINK_CARD_TAG, FORUM_TERMINAL_REPORT_TAG, 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function nodeTagName(node: unknown) {
  const record = node as { rawTagName?: unknown; tagName?: unknown };
  return String(record.rawTagName || record.tagName || '').toLowerCase();
}

export function forumVideoBlockFromHtml(html: string | undefined) {
  const clean = (html || '').trim();
  if (!clean) {
    return null;
  }
  try {
    const body = parseHtml(`<body>${clean}</body>`).querySelector('body');
    const nodes = (body?.childNodes || []).filter((node) => node.toString().trim());
    if (nodes.length !== 1 || nodeTagName(nodes[0]) !== FORUM_VIDEO_TAG) {
      return null;
    }
    const node = nodes[0] as unknown as { getAttribute?: (name: string) => string | undefined };
    const src = typeof node.getAttribute === 'function'
      ? node.getAttribute('src') || ''
      : '';
    return src ? { src } : null;
  } catch {
    return null;
  }
}

function fallbackTopLevelBlocks(clean: string) {
  const blocks: string[] = [];
  const stack: string[] = [];
  const tagPattern = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;
  let consumedLength = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(clean))) {
    const fullTag = match[0] || '';
    const tagName = (match[1] || '').toLowerCase();
    if (!FALLBACK_BLOCK_TAGS.has(tagName)) {
      continue;
    }
    const closing = /^<\//.test(fullTag);
    const selfClosing = /\/\s*>$/.test(fullTag);
    if (!closing && !selfClosing) {
      stack.push(tagName);
      continue;
    }
    if (closing) {
      const openIndex = stack.lastIndexOf(tagName);
      if (openIndex < 0) {
        continue;
      }
      stack.splice(openIndex);
    }
    if (stack.length === 0) {
      blocks.push(clean.slice(consumedLength, tagPattern.lastIndex));
      consumedLength = tagPattern.lastIndex;
    }
  }
  return { blocks, consumedLength };
}

function splitTopicContentHtmlFallback(clean: string, maxChunkLength: number) {
  const { blocks, consumedLength } = fallbackTopLevelBlocks(clean);
  if (!blocks?.length) {
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
