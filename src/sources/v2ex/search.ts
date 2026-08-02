import type { SearchSort } from '@/domain/forum/feed';
import { searchTimeRangeStartEpoch, type V2exSearchFilter } from '@/domain/forum/searchFilters';
import type { SearchResponse, Topic } from '@/domain/forum/models';
import { isRecord, textExcerpt, toIsoString } from '@/domain/forum/html';
import { accessRequirementFromObject } from '@/domain/forum/accessRequirements';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import { SOV2EX_URL, V2EX_BASE_URL as BASE_URL } from './protocol';
import { fetchJson, topicId, type V2exOptions } from './reader';

function sov2exHits(data: unknown) {
  if (Array.isArray(data)) {
    return data;
  }
  if (isRecord(data) && Array.isArray(data.hits)) {
    return data.hits;
  }
  if (isRecord(data) && isRecord(data.hits) && Array.isArray(data.hits.hits)) {
    return data.hits.hits;
  }
  if (isRecord(data) && Array.isArray(data.data)) {
    return data.data;
  }
  return [];
}

function sov2exTotal(data: unknown) {
  if (!isRecord(data)) {
    return undefined;
  }
  if (typeof data.total === 'number') {
    return data.total;
  }
  if (isRecord(data.hits)) {
    if (typeof data.hits.total === 'number') {
      return data.hits.total;
    }
    if (isRecord(data.hits.total) && typeof data.hits.total.value === 'number') {
      return data.hits.total.value;
    }
  }
  return undefined;
}

function highlightText(highlight: unknown) {
  if (!isRecord(highlight)) {
    return '';
  }
  for (const key of ['title', 'content', 'reply_list.content', 'postscript_list.content']) {
    const value = highlight[key];
    if (Array.isArray(value) && value.length) {
      return value.join(' ');
    }
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

export async function searchV2ex(
  query: string,
  options: V2exOptions & { limit?: number; page?: number; sort?: SearchSort; filter?: V2exSearchFilter } = {}
): Promise<SearchResponse> {
  const limit = options.limit || 30;
  const page = options.page || 1;
  const from = Math.max(0, page - 1) * limit;
  const activeSort = options.filter?.sort || options.sort;
  const params = new URLSearchParams({
    q: query,
    size: String(limit),
    from: String(from),
    version: '1.0.1'
  });
  if (activeSort === 'time') {
    params.set('sort', 'created');
    params.set('order', '0');
  } else {
    params.set('sort', 'sumup');
  }
  const filter = options.filter;
  if (filter?.node.trim()) {
    params.set('node', filter.node.trim());
  }
  if (filter?.username.trim()) {
    params.set('username', filter.username.trim().replace(/^@+/, ''));
  }
  if (filter?.operator === 'and') {
    params.set('operator', 'and');
  }
  const gte = filter ? searchTimeRangeStartEpoch(filter.timeRange) : undefined;
  if (gte !== undefined) {
    params.set('gte', String(gte));
  }
  const data = await fetchJson<unknown>(`${SOV2EX_URL}/api/search?${params.toString()}`, options);
  const hits = sov2exHits(data);
  const items = hits
    .map((hit) => {
      const source = isRecord(hit) && isRecord(hit._source) ? hit._source : isRecord(hit) ? hit : {};
      const id = topicId(source.id);
      if (!id) {
        return null;
      }
      const createdAt = toIsoString(source.created) || new Date().toISOString();
      const accessRequirement = accessRequirementFromObject(source);
      return {
        source: 'v2ex' as const,
        id,
        title: String(source.title || ''),
        author: String(source.member || source.author || ''),
        category: typeof source.node === 'string' && !/^\d+$/.test(source.node) ? source.node : undefined,
        url: `${BASE_URL}/t/${id}`,
        createdAt,
        lastReplyAt: createdAt,
        replyCount: Number(source.replies || 0),
        excerpt: textExcerpt(highlightText(isRecord(hit) ? hit.highlight : undefined) || source.content || ''),
        ...(accessRequirement ? { accessRequirement } : {})
      };
    })
    .filter(Boolean) as Topic[];
  const total = sov2exTotal(data);
  const hasMore = typeof total === 'number' ? total > from + hits.length : hits.length >= limit;
  const result = {
    items,
    errors: {},
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'sov2ex-search',
    candidateCount: hits.length,
    validCount: items.length,
    droppedCount: Math.max(0, hits.length - items.length),
    isExpectedEmpty: hits.length === 0,
    hasRepeatedCursor: result.nextPage === page
  });
}
