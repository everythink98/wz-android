import { parseHtml } from '../../src/domain/forum/html';

export function domNodeCount(html: string) {
  const pending = [...(parseHtml(`<body>${html}</body>`).querySelector('body')?.childNodes || [])];
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    count += 1;
    pending.push(...(current.childNodes || []));
  }
  return count;
}
