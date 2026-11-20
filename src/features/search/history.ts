export const MAX_RECENT_SEARCHES = 20;
export const MAX_SEARCH_HISTORY_QUERY_LENGTH = 120;

export function normalizeSearchHistoryEntry(text: string) {
  const query = text.trim().slice(0, MAX_SEARCH_HISTORY_QUERY_LENGTH).trimEnd();
  return { query, key: query.toLowerCase() };
}

export function normalizeSearchHistory(value: unknown, removedKeys?: ReadonlySet<string>) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set(removedKeys);
  const history: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const { query, key } = normalizeSearchHistoryEntry(item);
    if (!query || seen.has(key)) {
      continue;
    }
    seen.add(key);
    history.push(query);
    if (history.length >= MAX_RECENT_SEARCHES) {
      break;
    }
  }
  return history;
}

export function searchHistoryFromRaw(raw: string | null) {
  if (!raw) {
    return [];
  }
  try {
    return normalizeSearchHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function sameSearchHistory(left: string[] | null | undefined, right: string[] | null | undefined) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}
