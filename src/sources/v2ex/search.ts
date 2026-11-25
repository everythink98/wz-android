import { normalizeTopicId } from '@/domain/forum/numericValues';
import type { SearchSort } from '@/domain/forum/feed';
import { searchTimeRangeStartEpoch, type V2exSearchFilter } from '@/domain/forum/searchFilters';
import type { SearchResponse, Topic } from '@/domain/forum/models';
import { isRecord, textExcerptFromPlainText, toIsoString } from '@/domain/forum/html';
import { accessRequirementFromObject } from '@/domain/forum/accessRequirements';
import { annotateSourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { SOV2EX_URL, V2EX_BASE_URL as BASE_URL } from './protocol';
import { fetchJson, type V2exOptions } from './reader';

const SOV2EX_MAX_PAGE_SIZE = 50;
const SOV2EX_MAX_PAGING_DEPTH = 1000;

function sov2exHits(data: unknown) {
  if (isRecord(data) && (data.error || data.success === false)) {
    throw Object.assign(new Error('V2EX 搜索来源返回错误，请重试'), { reason: 'parse_empty' });
  }
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
  throw Object.assign(new Error('V2EX 搜索响应缺少结果列表，请重试'), { reason: 'parse_empty' });
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
  const limit = Math.max(1, Math.min(SOV2EX_MAX_PAGE_SIZE, Math.trunc(options.limit || 30)));
  const page = options.page || 1;
  const from = Math.max(0, page - 1) * limit;
  const size = Math.max(0, Math.min(limit, SOV2EX_MAX_PAGING_DEPTH - from));
  const activeSort = options.filter?.sort || options.sort;
  const params = new URLSearchParams({
    q: query,
    size: String(size),
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
  const data =
    size > 0 ? await fetchJson<unknown>(`${SOV2EX_URL}/api/search?${params.toString()}`, options) : undefined;
  const hits = size > 0 ? sov2exHits(data) : [];
  const items = hits
    .map((hit) => {
      const source = isRecord(hit) && isRecord(hit._source) ? hit._source : isRecord(hit) ? hit : {};
      const id = normalizeTopicId(source.id);
      if (!id) {
        return null;
      }
      const createdAt = toIsoString(source.created);
      const accessRequirement = accessRequirementFromObject(source);
      const highlighted = highlightText(isRecord(hit) ? hit.highlight : undefined);
      return {
        source: 'v2ex' as const,
        id,
        title: String(source.title || ''),
        author: String(source.member || source.author || ''),
        category: typeof source.node === 'string' && !/^\d+$/.test(source.node) ? source.node : undefined,
        url: `${BASE_URL}/t/${id}`,
        createdAt,
        lastReplyAt: createdAt || undefined,
        replyCount: Number(source.replies || 0),
        excerpt: highlighted
          ? textExcerptFromPlainText(highlighted.replace(/<\/?em>/gi, ''))
          : textExcerptFromPlainText(source.content || ''),
        ...(accessRequirement ? { accessRequirement } : {})
      };
    })
    .filter(Boolean) as Topic[];
  const total = sov2exTotal(data);
  const hasMore =
    hits.length > 0 &&
    from + hits.length < SOV2EX_MAX_PAGING_DEPTH &&
    (typeof total === 'number' ? total > from + hits.length : hits.length >= size);
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
