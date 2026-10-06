import type { Reply } from '@/domain/forum/models';
import { searchTerms, stripHtml } from '@/domain/forum/text';

const MAX_SEARCH_CACHE_ENTRIES = 4096;
const MAX_SEARCH_CACHE_UNITS = 2 * 1024 * 1024;

export function createReplySearchCache() {
  const entries = new Map<Reply, { html: string; text: string }>();
  let units = 0;
  function remove(reply: Reply, entry: { html: string; text: string }) {
    units -= entry.html.length + entry.text.length;
    entries.delete(reply);
  }
  return {
    text(reply: Reply) {
      const html = reply.contentHtml;
      const cached = entries.get(reply);
      if (cached?.html === html) return cached.text;
      if (cached) remove(reply, cached);
      const text = stripHtml(html).toLowerCase();
      const size = html.length + text.length;
      if (size > MAX_SEARCH_CACHE_UNITS) return text;
      while (units + size > MAX_SEARCH_CACHE_UNITS || entries.size >= MAX_SEARCH_CACHE_ENTRIES) {
        const oldest = entries.entries().next().value;
        if (!oldest) break;
        remove(...oldest);
      }
      entries.set(reply, { html, text });
      units += size;
      return text;
    },
    retain(replies: Reply[]) {
      if (!entries.size) return;
      const current = new Set(replies);
      for (const [reply, entry] of entries) {
        if (!current.has(reply)) remove(reply, entry);
      }
    },
    clear() {
      entries.clear();
      units = 0;
    }
  };
}

export function filterRepliesByQuery(
  replies: Reply[],
  query: string,
  cache?: ReturnType<typeof createReplySearchCache>
) {
  const terms = searchTerms(query).map((term) => term.toLowerCase());
  if (terms.length === 0) return replies;
  return replies.filter((reply) => {
    const text = cache ? cache.text(reply) : stripHtml(reply.contentHtml).toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
